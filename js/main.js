// ============================================================
// MAIN — composition root, mode system, and game loop.
//
// Modes: 'Endless' (streaming random downhill) or a named entry from
// the TRACKS registry (periodic lap circuit). Both are exposed through
// a common terrain-provider interface: reset() + update(loX, hiX).
// Switching modes rebuilds the world and restarts the race.
//
// Loop: fixed-timestep physics with an accumulator, interpolated
// rendering. Lap-crossing detection runs INSIDE the step loop so
// splits are tick-accurate and deterministic.
// ============================================================

(function () {
'use strict';

const { CONFIG, createState, resetMelon, resetPlayers, resetBots, step, initInput,
        createRenderer, createHud, initDebugPanel, createTerrainGen, TRACKS,
        createTrackProvider, createLockstep } = window.FF;

const SEED = 20260806;   // endless-mode world seed
const GRID_SIZE = 12;    // total racers; bots fill whatever humans don't
const NET_DELAY = 6;     // lockstep input delay in ticks (~50ms at 120Hz)
const GEN_AHEAD = 3600;  // terrain kept generated in front of the leaders
const KEEP_BEHIND = 2600; // and behind the backmarkers
const SPAWN = { x: 0 }; // the start LINE is world position 0: the lap
// seam, the "0" distance marker, and the flag are all the same place.
const MIN_LAP_TICKS = 240; // ignore "laps" under 2s (line back-and-forth)
const FINISH_RESTART_TICKS = 360; // 3s to read the finish time, then a fresh race

// ---- Terrain providers, one per mode ----
function createEndlessProvider(seed) {
  const gen = createTerrainGen(seed);
  return {
    period: null,
    get pts() { return gen.pts; },
    reset() { gen.reset(); },
    update(loX, hiX) { gen.ensure(hiX); gen.prune(loX); },
  };
}

const providers = { 'Endless': createEndlessProvider(SEED) };
for (const name of Object.keys(TRACKS)) {
  providers[name] = createTrackProvider(TRACKS[name]);
}

// ---- Bootstrap ----
const canvas = document.getElementById('game');
const state = createState();
// DAILY ONLY (Eddie, 2026-08-12). Everyone races the same track each
// day, and there is no in-game way to pick another. Track 1 and the
// whole registry stay in the code — the harnesses race them, and
// re-exposing a track picker later is a UI change, not a rebuild.
let modeName = (window.FF.dailyTrackName && window.FF.dailyTrackName()) || 'Track 1';
if (!providers[modeName]) {
  const def = window.FF.trackDefByName(modeName);
  if (def) providers[modeName] = createTrackProvider(def);
}
let provider = providers[modeName] || providers['Track 1'];

// opts (exhibition only): { roster, endless } — a race whose lap
// target is unreachable and whose grid is a uniform field. Kept as
// arguments rather than module state so an ordinary respawn can never
// inherit exhibition settings by accident.
function respawnRace(opts) {
  const exhibition = !!(opts && opts.endless);
  window.FF.debris.reset(); // wreckage persists per race, not across them
  provider.reset();
  provider.update(SPAWN.x - KEEP_BEHIND - 800, SPAWN.x + GEN_AHEAD);
  state.terrain = [provider.pts];
  state.period = provider.period;

  const humans = netSession ? netSession.ls.playerCount : 1;
  const localSlot = netSession ? netSession.ls.localSlot : 0;
  // Netplay feeds every player's input from the lockstep buffer;
  // solo aliases the UI input straight into player 0.
  // Deal the cast: seeded from the race seed, so every peer, ghost,
  // and daily shares the same roster. Sizes deal from an independent
  // stream of the same seed — the CASTING rotates per race (today's
  // daily might hand the whopper body to Gourdzilla; tomorrow it's
  // Just Dave's doom), identically on every peer.
  const castSeed = window.FF.trackDefByName(modeName) ? window.FF.trackDefByName(modeName).seed : SEED;

  // THE GRID: SPAWN.x is the start LINE; humans take the first metres
  // of the flat apron behind it, bots continue from metre humans+1.
  resetPlayers(state, humans, localSlot, SPAWN.x, -CONFIG.semiMinor - 200, !netSession);
  // A configured roster sets the field size; otherwise fill the grid.
  const roster = (opts && opts.roster) || CONFIG.botRoster;
  const savedRoster = CONFIG.botRoster;
  if (opts && opts.roster) CONFIG.botRoster = opts.roster.slice(0, Math.max(0, opts.roster.length - humans));
  const botCount = CONFIG.botRoster && CONFIG.botRoster.length
    ? CONFIG.botRoster.length
    : Math.max(0, GRID_SIZE - humans);
  resetBots(state, botCount, SPAWN.x, -CONFIG.semiMinor - 200, (castSeed ^ 0x51ED) >>> 0, humans);

  // A CUP KEEPS ITS CAST. Names are normally dealt from the race
  // seed, which would field four different sets of rivals across a
  // cup and make its points table meaningless. Mid-cup the DAY's seed
  // names the field instead — same twelve melons, four races.
  const cupSeed = (window.FF.cup && window.FF.cup.nameSeed) ? window.FF.cup.nameSeed() : null;
  window.FF.assignRosterNames(state, (cupSeed === null || cupSeed === undefined) ? castSeed : cupSeed);

  // Dress the local player in their PERSISTENT melon (solo only:
  // the MP handshake doesn't carry specs yet, and a peer guessing
  // wrong about your mass is a desync — netplay races scale 1.0
  // until the handshake field ships).
  // The exhibition's local body is just another watermelon in the
  // field — dressing it in the player's persistent melon would put
  // their racer on the menu twice (portrait and world) and imply the
  // background race is theirs.
  if (!netSession && !exhibition) {
    const spec = window.FF.melon.active();
    const d = window.FF.melon.derive(spec.seed);
    window.FF.setBodyScale(state.melon, d.scale);
    state.melon.patKey = d.patternKey; // rind follows the SEED, not the name
    state.melon.bodyColor = d.bodyColor; // and so does the green
    if (spec.name) state.melon.name = spec.name;
  }

  state.raceStartTick = state.tick;
  state.raceStartX = SPAWN.x;
  // A NEW RACE STARTS FROM A CENTRED WHEEL. Whatever drove the world
  // a moment ago — the menu's exhibition, the post-flag autopilot —
  // must not leak a held throttle into the grid.
  if (!netSession) {
    state.input.rawAxis = 0; state.input.rawBounce = 0;
    state.input.torqueAxis = 0; state.input.bounceAxis = 0;
  }
  // Clear last race's finish stamps: a body persists across respawns,
  // so a stale stamp would show the previous race's time.
  for (const pl of state.players) pl.melon.finishTick = null;
  for (const b of state.bots) b.melon.finishTick = null;

  const race = state.race;
  const def = window.FF.trackDefByName(modeName);
  race.mode = def ? 'track' : 'endless';
  race.lapLengthPx = def ? def.lapLengthM * 100 : 0;
  // An unreachable lap target is the whole trick: finishedTick is
  // never set, so every downstream rule (finish screen, career write,
  // ghost save) stays correct without knowing this race is different.
  race.laps = def ? (exhibition ? Number.MAX_SAFE_INTEGER : def.laps) : 0;
  race.lapIndex = 0;
  race.lapStartTick = state.tick;
  race.splits.length = 0;
  race.bestLapTicks = null;
  race.finishedTick = null;

  state.camera.initialized = false; // snap camera, don't pan across the map

  // The exhibition must never record: it is a track-mode race, so the
  // recorder would happily bank an autopilot lap as the player's.
  if (exhibition) {
    if (window.FF.ghost.stopRecording) window.FF.ghost.stopRecording();
    // Scenery does not line up on a grid and count itself down.
    if (window.FF.gridStart) window.FF.gridStart.cancel();
  } else {
    window.FF.ghost.onRaceStart(state);
    // Netplay starts on the lockstep clock, not a local ceremony.
    if (window.FF.gridStart && !netSession) {
      // A thumb still down from the last race must not launch this
      // one: begin() is told, and only a fresh press counts.
      const touching = !!(window.FF.getInputSticks && window.FF.getInputSticks(0).length);
      window.FF.gridStart.begin(state, { touching });
    }
  }
  if (opts && opts.roster) CONFIG.botRoster = savedRoster;
}

// Ensure a provider exists for any resolvable track name (registry or
// self-describing daily), creating it on demand.
function ensureProvider(name) {
  if (providers[name]) return providers[name];
  const def = window.FF.trackDefByName(name);
  if (!def) return null;
  providers[name] = createTrackProvider(def);
  return providers[name];
}

function selectMode(name) {
  if (!ensureProvider(name)) return;
  modeName = name;
  provider = providers[name];
  respawnRace();
}

// Expose the mode system for the debug panel (must precede initDebugPanel).
let netSession = null;

// Begin a multiplayer race. mp.js calls this on every peer once the
// channels are open and the host has assigned slots. Transport is
// abstract: sendInput broadcasts a wire message; the returned receive
// is called for every arriving message.
window.FF.currentModeName = () => modeName;
window.FF.selectTrackByName = selectMode;

// The daily indicator is RETIRED. It labelled a choice that no
// longer exists — there is one track a day and no way to leave it —
// so it was a permanent caption on a screen that needs its space for
// racing. dailyTrackName() still names the day on the menu, where a
// player is actually deciding something.

// ---- The naming ceremony: one-time, first boot ----
// The gate reads the URL and the stored preference BEFORE any
// dev-only module registers, so nothing flashes on screen for a
// player between boot and the first apply().
if (window.FF.devtools) {
  window.FF.devtools.init();
  // The ring logger writes a console line per airborne episode: a
  // debugging instrument, not a shipped feature.
  window.FF.devtools.register({
    show: () => { CONFIG.ringLog = 1; },
    hide: () => { CONFIG.ringLog = 0; },
  });
}
if (window.FF.studio) window.FF.studio.init();

window.FF.melon.maybeAskName((name) => {
  // Apply immediately: the melon you just named is the one on track.
  if (!netSession && state.players.length) {
    state.melon.name = name;
  }
});

// ---- Challenge links choose their track at boot ----
// A shared ghost names its track; dailies are self-describing, so a
// link from any past day still reconstructs that day's world.
(function acceptChallengeTrack() {
  const t = window.FF.ghost.getChallengeTrack && window.FF.ghost.getChallengeTrack();
  if (t && t !== modeName) selectMode(t);
})();

window.FF.netStart = function ({ count, slot, sendInput, setStatus }) {
  netSession = {
    ls: createLockstep(count, slot, NET_DELAY),
    sendInput,
    setStatus: setStatus || (() => {}),
  };
  modeName = 'Track 1'; // multiplayer races the canonical circuit
  provider = providers[modeName];
  respawnRace();
  return {
    receive(msg) {
      if (msg && msg.t === 'i') netSession.ls.addRemote(msg.s, msg.k, msg.a, msg.b);
    },
    stop() { netSession = null; respawnRace(); },
  };
};

window.FF.modes = {
  names: Object.keys(providers),
  select: selectMode,
  active: () => modeName,
};

respawnRace();
initInput(state, canvas);
// During the pan a touch means "I'm ready": it plants the stick AND
// skips the rest of the camera move. Never ignored — an input that
// does nothing reads as broken on a touch screen.
canvas.addEventListener('pointerdown', () => {
  if (window.FF.gridStart) window.FF.gridStart.arm(state);
}, { passive: true });
for (const ev of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(ev, () => {
    if (window.FF.gridStart) window.FF.gridStart.noteRelease();
  }, { passive: true });
}
window.addEventListener('keyup', () => {
  if (window.FF.gridStart) window.FF.gridStart.noteRelease();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') return;
  if (window.FF.gridStart) window.FF.gridStart.arm(state);
});
initDebugPanel(state);
const renderer = createRenderer(canvas);
const hud = createHud(state);
// Boot into the menu: the grid sits assembled behind the panel. After
// the renderer, so the menu's rotating preview can draw immediately.
if (window.FF.ticker) window.FF.ticker.init();
if (window.FF.exhibition) window.FF.exhibition.init();
// Phones do not get a graceful exit, so the write that matters is the
// one before backgrounding. Both events, because browsers disagree
// about which they fire.
if (typeof document !== 'undefined') {
  const flush = () => {
    const st = window.FF.flow && window.FF.flow.state;
    if (!netSession && st === 'race' && window.FF.resume) {
      window.FF.resume.save(state, { netplay: false });
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);
}

if (window.FF.flow) window.FF.flow.init(state, {
  respawn: () => respawnRace(),
  // Put the game on a named track with a given field, exactly as
  // starting that race would — then resume.js overwrites the bodies.
  rebuild: (trackName, botCount) => {
    if (trackName && ensureProvider(trackName)) {
      modeName = trackName;
      provider = providers[trackName];
    }
    respawnRace();
  },
  isNetplay: () => !!netSession,
  // The live terrain provider, so the finish-line fast-forward can
  // generate track ahead of bodies that are still racing.
  provider: () => provider,
  // The exhibition's hooks: main.js owns track providers and race
  // setup, so it hands the module a way to ask rather than letting it
  // reach into the plumbing.
  // Build a race on a named track (a cup leg, or practice on leg 1).
  startLeg: (trackName) => {
    if (trackName && ensureProvider(trackName)) {
      modeName = trackName;
      provider = providers[trackName];
    }
    respawnRace();
  },
  exhibition: {
    gameState: () => state,
    configureRace: (cfg) => {
      if (cfg.track && ensureProvider(cfg.track)) {
        modeName = cfg.track;
        provider = providers[cfg.track];
      }
      respawnRace({ roster: cfg.roster, endless: cfg.endless });
    },
  },
});

// The floating restart button is RETIRED: it did exactly what the
// pause screen's RESTART already does, and a one-tap race reset
// sitting permanently over the play area is a mis-tap waiting to
// happen. Restarting is a decision, so it lives behind pause with
// the other decisions.

// ---- Lap accounting (tick-accurate: called after every physics step) ----
// ---- THE OBSERVER STEP ----
// Everything that WATCHES the race — finish stamps, overtakes, laps,
// streaks, airtime — runs here, once per SIMULATED TICK, immediately
// after the tick it describes.
//
// Two bugs died with this. (1) The player's finish time read as a dash:
// the observer used to run once per FRAME, after flow.onFrame had
// already captured the standings, so on the one frame that mattered
// the player's own stamp did not exist yet. Record, then report — the
// observer must see the tick before the screen that reports it does.
// (2) At 120Hz physics on a 60Hz display the observer saw every OTHER
// tick, so every tick-measured rule in racewatch (pass hysteresis,
// cooldowns, airtime, streak sampling) was running on half the data
// it was tuned against. Both were the same mistake: an observer
// sampling frames while measuring ticks.
// The pre-race sequence advances on the SIM clock, before the step
// it governs.
function gridTick() {
  if (window.FF.gridStart) window.FF.gridStart.update(state);
}

// Half rate (30fps) for a world nobody is looking straight at.
const WORLD_DRAW_MS = 1000 / 30;
let lastWorldDraw = 0;

function observeTick() {
  if (window.FF.raceWatch) window.FF.raceWatch.update(state);
}

function checkLapCrossings() {
  const race = state.race;
  if (race.mode !== 'track' || race.finishedTick !== null) return;
  const dist = state.melon.x - state.raceStartX;
  const lap = Math.floor(dist / race.lapLengthPx);
  if (lap > race.lapIndex) {
    for (let l = race.lapIndex; l < Math.min(lap, race.laps); l++) {
      const t = state.tick - race.lapStartTick;
      race.lapStartTick = state.tick;
      // l < 0 is the FIRST crossing of the start line (the grid spawns
      // racers behind it): reset the lap clock, record nothing.
      if (l >= 0 && t >= MIN_LAP_TICKS) {
        // Cap: an endless exhibition would otherwise grow this array
        // without limit for as long as the menu is open.
        race.splits.push(t);
        if (race.splits.length > 64) race.splits.shift();
        if (race.bestLapTicks === null || t < race.bestLapTicks) race.bestLapTicks = t;
      }
    }
    race.lapIndex = lap;
    if (lap >= race.laps) race.finishedTick = state.tick;
  } else if (lap < race.lapIndex) {
    race.lapIndex = lap; // rolled backwards over the line
  }
}

// After the chequered flag: hold for a beat so the frozen finish time
// and final splits can be read, then restart the race clean.
//
// LEGACY PATH ONLY. When flow.js is present the state machine owns
// everything after the flag: the finish screen shows the standings
// and the autopilot keeps the field racing behind it until the player
// chooses RETRY or MAIN MENU. Leaving this timer armed restarted the
// race under the results panel a few seconds after finishing — the
// world silently resetting behind a screen that was still describing
// the old race. The guard existed before, was lost in an edit, and
// only became visible once the finish screen stopped freezing the
// sim: exactly the kind of interaction a "harmless" timer creates.
function checkAutoRestart() {
  if (window.FF.flow) return;
  if (netSession) return; // peers can't unilaterally restart a shared race
  const race = state.race;
  if (race.mode !== 'track' || race.finishedTick === null) return;
  if (state.tick >= race.finishedTick + FINISH_RESTART_TICKS) respawnRace();
}

// ---- Fixed-timestep loop ----
const MAX_FRAME_DT = 0.1; // clamp huge gaps (tab switch) — avoid spiral of death
let accumulator = 0;
let last = performance.now();

function frame(now) {
  let dtFrame = (now - last) / 1000;
  last = now;
  if (dtFrame > MAX_FRAME_DT) dtFrame = MAX_FRAME_DT;

  // Stream/tile the world to cover every body, leader to backmarker.
  let loX = state.melon.x, hiX = state.melon.x;
  for (const b of state.bots) {
    if (b.melon.x < loX) loX = b.melon.x;
    if (b.melon.x > hiX) hiX = b.melon.x;
  }
  provider.update(loX - KEEP_BEHIND, hiX + GEN_AHEAD);

  const stepDt = 1 / CONFIG.physicsHz;
  accumulator += dtFrame;
  if (netSession) {
    const ls = netSession.ls;
    // Input production FREE-RUNS ahead with bounded lookahead —
    // gating it on sim progress starves the other peers (measured).
    while (ls.queuedThrough < state.tick + 1 + ls.delay + 10) {
      netSession.sendInput(ls.queueLocal(ls.queuedThrough + 1, state.input.rawAxis, state.input.rawBounce));
    }
    let stalled = false;
    while (accumulator >= stepDt) {
      const next = state.tick + 1;
      if (!ls.ready(next)) { stalled = true; break; }
      const ins = ls.inputs(next);
      for (let i = 0; i < state.players.length; i++) {
        state.players[i].input.rawAxis = ins[i].a;
        state.players[i].input.rawBounce = ins[i].b;
      }
      step(state, stepDt);
      checkLapCrossings();
      observeTick();   // netplay had no observer at all before this
      ls.prune(next);
      accumulator -= stepDt;
    }
    if (stalled) accumulator = Math.min(accumulator, stepDt * 4); // no spiral
    netSession.setStatus(stalled ? 'waiting for peers…' : '');
  } else {
    // The state machine gates the SOLO sim. Menus and pause are
    // frozen worlds; the FINISH screen is not — the field keeps
    // racing behind the results panel with the player's body on
    // autopilot, which is what makes the flag feel like a moment in a
    // race rather than the game stopping dead.
    const fs = window.FF.flow && window.FF.flow.state;
    const ex = window.FF.exhibition;
    // The menu steps ONLY while the exhibition says so — it owns the
    // battery policy (hidden tab, idle timeout), not this loop.
    const exhibiting = fs === 'menu' && ex && ex.running && ex.shouldStep();
    const racing = !window.FF.flow || fs === 'race' || fs === 'finish' || exhibiting;
    if (racing) {
      while (accumulator >= stepDt) {
        // Autopilot writes the same input fields the stick does, so
        // the sim cannot tell the difference (no-op while a human is
        // driving).
        gridTick();
        if (window.FF.autopilot) window.FF.autopilot.drive(state);
        step(state, stepDt);
        checkLapCrossings();
        observeTick();
        accumulator -= stepDt;
      }
      checkAutoRestart();
    } else {
      accumulator = 0;
    }
    // AFTER the observer: the finish screen captures standings the
    // moment race.finishedTick appears, and it must find every stamp
    // already written.
    if (window.FF.flow) window.FF.flow.onFrame(state);
    // A race in progress is saved on a heartbeat. Only while actually
    // racing: a finished or abandoned race has nothing to resume, and
    // saving the menu's exhibition would offer to "resume" scenery.
    if (racing && fs === 'race' && window.FF.resume) {
      window.FF.resume.tick(state, { netplay: !!netSession });
    }
  }

  // Shader Studio takes the frame over when active (sim pauses too:
  // the accumulator keeps draining above, but we skip render+HUD).
  if (window.FF.studio && window.FF.studio.active) {
    window.FF.studio.frame(dtFrame, state.input.rawAxis);
    requestAnimationFrame(frame);
    return;
  }

  // The player wears the melon designed in the Shader Studio: species,
  // base colour and rind pattern all follow the stage. Re-applied every
  // frame so it survives respawns and track changes.
  const design = window.FF.studio && window.FF.studio.design;
  if (design && state.melon) {
    if (design.color) state.melon.bodyColor = design.color;
    if (design.patKey) state.melon.patKey = design.patKey;
    // Wearing a species means wearing its BODY, not just its paint:
    // aspect, taper, sizeMult, mass, inertia, collider path. Without
    // this the player raced a melon ellipse in dragon-ball paint —
    // wrong silhouette, wrong shading geometry (bands solve on the
    // actual body, so an ellipse catches the sun differently than a
    // sphere), and wrong physics (tips that can smash on a "ball").
    // Solo only: in a lockstep race a local body change is a desync.
    if (design.fruit && design.fruit !== state.melon.fruit && !netSession) {
      state.melon.fruit = design.fruit;
      const spec = window.FF.melon.active();
      const d = window.FF.melon.derive(spec.seed);
      const mult = (window.FF.FRUITS[design.fruit] && window.FF.FRUITS[design.fruit].sizeMult) || 1;
      // Same law as the bots: persistent physique scale x species mult.
      window.FF.setBodyScale(state.melon, d.scale * mult);
    }
  }

  const alpha = accumulator / stepDt;
  // ---- THE WORLD RENDERS AT HALF RATE BEHIND A PANEL ----
  // While a screen is up, most of the world is covered by a panel and
  // dimmed by a scrim — but it must keep MOVING (the field is still
  // racing, and the menu runs an exhibition). Simulation is untouched;
  // only the drawing is halved, which is the single largest saving
  // available at the moment the results appear, and it doubles as a
  // battery win on the menu.
  const fs2 = window.FF.flow && window.FF.flow.state;
  const covered = fs2 && fs2 !== 'race';
  if (!covered || (now - lastWorldDraw) >= WORLD_DRAW_MS) {
    lastWorldDraw = now;
    renderer.render(state, alpha, dtFrame);
  }
  hud.update(dtFrame);
  window.FF.audio.update(state, dtFrame);
  window.FF.deaths.update(state);
  window.FF.ghost.update(state);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

})();