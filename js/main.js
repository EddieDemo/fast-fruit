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
// Provider revision last captured into state.terrain — declared HERE
// because respawnRace (which seeds it) runs at boot, long before the
// frame loop's code is reached; a later `let` was a temporal dead
// zone and a black screen (measured, 2026-08-18).
let lastProviderRev = -1;
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
    // The world as a strand list: real terrain plus the wall strand
    // (stage 1 moved the sentinel out of the point list; it is
    // physics-only — slab.js collides it, the renderer skips it).
    polys() { return [gen.pts, gen.wall, ...gen.branches]; },
    // Endless branches only ever append; the count IS the revision.
    get rev() { return gen.branches.length; },
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
  // THE LIFECYCLE LAW (fix 2026-08-26, found on device: races
  // inherited the party conveyor, countdown HUD and metric tags after
  // any exit that skipped the polite teardown): BUILDING A RACE WORLD
  // ENDS ANY SESSION. No exit path needs to remember, because the
  // rebuild itself is the teardown. The hooks were each gated on the
  // session; nothing had ever checked the session DIES with the world
  // it was captured in.
  if (!(opts && opts.session)) state.session = null;
  // An OPEN SESSION (party chassis): unreachable laps and no ghost
  // like the exhibition, but the player keeps their own melon and the
  // grid ceremony runs — everyone starts together, then loops freely.
  const session = !!(opts && opts.session);
  window.FF.debris.reset(); // wreckage persists per race, not across them
  provider.reset();
  provider.update(SPAWN.x - KEEP_BEHIND - 800, SPAWN.x + GEN_AHEAD);
  // The strand list: track providers hand back [pts]; the endless
  // provider adds the wall strand (physics-only, renderer skips it).
  // The strand list (stage 4): primary first — surfaceAt's
  // first-poly-wins rule makes the PRIMARY strand canonical for
  // overlapped spine intervals — then the wall, then branches.
  state.terrain = provider.polys ? provider.polys() : [provider.pts];
  lastProviderRev = provider.rev !== undefined ? provider.rev : -1;
  state.period = provider.period;
  // THE SPINE IS BUILT BEFORE THE GRID (stage 2): grid placement now
  // asks the spine for the surface, so the spine must exist before
  // resetPlayers/resetBots below. The degenerate spine binds the
  // terrain it answers from; raceStartX (set further down) equals
  // SPAWN.x, the same startX given here.
  // METRIC (stage 3): the lap unit is the template's ARC length —
  // provider.lapArc — not its x-span. Endless has no lap.
  state.spine = window.FF.trackSpace.metricSpine(SPAWN.x,
    provider.lapArc || null, state.terrain);

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
  // ---- THE PERMANENT CAST -----------------------------------------
  // Solo races field the authored roster (roster.js): eleven rivals,
  // each a fixed pilot driving a fixed melon with a fixed body. The
  // TWELFTH seat is the local body, and it belongs to the STAND-IN —
  // on the menu the autopilot drives Second Place Steve, and in a real
  // race the player takes that exact seat. So the cast is complete in
  // both cases and the rivals never change. Netplay still deals bodies
  // the old way: a peer guessing wrong about another player's mass is
  // a desync, and the handshake does not carry specs yet.
  const R = window.FF.roster;
  const explicitField = !!(CONFIG.botRoster && CONFIG.botRoster.length);
  const cast = (R && !netSession && !explicitField) ? R.field() : null;
  resetBots(state, cast ? cast.length : botCount,
    SPAWN.x, -CONFIG.semiMinor - 200, (castSeed ^ 0x51ED) >>> 0, humans, cast);
  // Track furniture (27k): minted DORMANT after the field so
  // canonical indices append; candidate ARCS from the salted stream;
  // placed by the wake law (physics.js tryWakeProp) when the leader
  // closes in — never against unstreamed ground.
  window.FF.mintFurniture(state, (state.race.seed || 0) >>> 0,
    state.race.lapLengthPx || 40000, SPAWN.x);


  // A CUP KEEPS ITS CAST. With the permanent roster this is now true
  // by construction — the field is the same twelve characters on every
  // track, every day — so the seeded name deal only runs for fields
  // the roster did not build (netplay, harnesses, explicit rosters).
  const cupSeed = (window.FF.cup && window.FF.cup.nameSeed) ? window.FF.cup.nameSeed() : null;
  if (!cast) {
    window.FF.assignRosterNames(state, (cupSeed === null || cupSeed === undefined) ? castSeed : cupSeed);
  }

  // THE PLAYER IS A PILOT. Their melon is the body; their username is
  // who is driving it. Applied to every human body in the race — in
  // netplay a peer's username arrives with the handshake later, so
  // for now each peer labels its own.
  if (window.FF.melon.playerName && state.players[localSlot]) {
    state.players[localSlot].melon.pilot = window.FF.melon.playerName();
  }

  // Dress the local player in their PERSISTENT melon (solo only:
  // the MP handshake doesn't carry specs yet, and a peer guessing
  // wrong about your mass is a desync — netplay races scale 1.0
  // until the handshake field ships).
  if (!netSession && !exhibition) {
    const spec = window.FF.melon.active();
    const d = window.FF.melon.deriveSpec(spec);
    window.FF.setBodyScale(state.melon, d.scale);
    if (!window.FF.devSpecies(null)) {
      state.melon.patKey = d.patternKey; // rind follows the SEED, not the name
      state.melon.bodyColor = d.bodyColor; // and so does the green
    }
    if (spec.name) state.melon.name = spec.name;
    // The outfit rides with the body, same as the rind and the green
    // — unless the dev override is dressing a different SPECIES, in
    // which case the wrap belongs to a melon that is not here (the
    // applier owns that ruling; this build-time write must not
    // re-dress the body behind it).
    state.melon.decals = window.FF.devSpecies(null) ? null : (spec.decals || null);
  } else if (!netSession && exhibition && cast) {
    // THE MENU'S LOCAL BODY IS THE STAND-IN. Behind the panel the seat
    // the player will take is driven by its own character, so the
    // exhibition shows the complete cast of twelve rather than the
    // player's melon racing a lap they did not drive.
    const si = window.FF.roster.standIn();
    if (si) {
      window.FF.setBodyScale(state.melon, si.scale);
      state.melon.name = si.melon;
      state.melon.pilot = si.pilot;
      state.melon.patKey = si.patKey;
      if (si.color) state.melon.bodyColor = si.color;
    }
  }

  // ---- THE GRID ORDER (ruled 2026-08-16) ---------------------------
  // Solo races re-grid the whole field after the cast is dressed:
  // mid-cup, everyone starts where they finished the previous leg —
  // the grid is the last result made physical, the leg winner on
  // pole, and the walk becomes a recap that ends on the front-runner.
  // With no previous leg (leg 1, practice, any fresh race) the player
  // starts LAST: the unknown entrant behind eleven knowns, which also
  // opens the walk on the player's own melon. Netplay keeps protocol
  // slots; the exhibition is scenery and grids as dealt.
  if (!netSession && !exhibition) {
    const keys = state.players.map(p => window.FF.racerKey(p.melon))
      .concat(state.bots.map(b => window.FF.racerKey(b.melon)));
    const order = (window.FF.cup && window.FF.cup.isRunning && window.FF.cup.isRunning())
      ? window.FF.cup.gridOrder() : null;
    const slots = window.FF.computeGridSlots(keys, order, localSlot);
    window.FF.applyGridSlots(state, slots, SPAWN.x, -CONFIG.semiMinor - 200);
  }

  state.raceStartTick = state.tick;
  state.raceStartX = SPAWN.x;
  // TRACK-SPACE (stage 0.5): progress consumers read the SPINE, not
  // raw x. Since stage 2 the spine is built earlier (above, before
  // the grid) because placement queries it too.
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
  // lapLengthPx is a LAP OF ARC since stage 3 (the spine's unit):
  // finish targets, splits, and the HUD's lap position all follow.
  race.lapLengthPx = def ? (provider.lapArc || def.lapLengthM * 100) : 0;
  // The race's SEED (stage 5): the key for every seeded per-race
  // decision — today, the bots' fork commitments. Endless races key
  // on the world seed the same way.
  // Sessions ride this line too (2026-08-26): a session provider
  // CARRIES ITS SEED, and the whole conditions pipeline below — hour,
  // stage, sky generate/gate/fallback, moon — runs on it unchanged.
  // (The device sameness: the hill provider had no seed, so every
  // session rolled sky zero.)
  race.seed = (def ? def.seed : (provider.seed || 0)) >>> 0;
  // PHASE 5.1 — THE HOUR. Chosen from the race seed and the cup leg,
  // so it is deterministic (same track, same leg, same light) and a
  // cup still walks through different hours. Set here, beside the
  // seed it derives from, rather than in the flow layer: this is the
  // one place that already knows both which track and which leg.
  if (window.FF.palette && window.FF.palette.setTime) {
    // cup.current() — NOT cup.state(), which I invented and which
    // would have silently evaluated to leg 0 for every race, quietly
    // deleting the sequencing half of the ruling.
    const cupNow = (window.FF.cup && window.FF.cup.current) ? window.FF.cup.current() : null;
    const leg = (cupNow && cupNow.leg) || 0;
    // The BASE decides whether the cup's hours can repeat. A cup
    // passes its DAY, so its legs land on consecutive — therefore
    // distinct — hours; a one-off race passes its own track seed and
    // simply looks like itself.
    const hourBase = cupNow && cupNow.day ? cupNow.day : race.seed;
    window.FF.palette.setTime(window.FF.palette.timeForSeed(hourBase, leg));
    // PHASE 6 SELECTION. Two orthogonal draws, deliberately: 5.1's
    // hybrid still chooses the ROLE (so a cup walks through the day
    // and consecutive legs never repeat an hour — a guarantee that
    // cost a measured 157-of-300 failure to get right, and is not
    // reopened here), and the TRACK seed then chooses which sky of
    // that role. Variety arrives without touching the proven half.
    if (window.FF.palette.setSky && window.FF.sky) {
      const skyLib = window.FF.sky;
      // THE STAGE IS ONE DECISION. Sky and ground rolled separately
      // could hand a track a lime sky over an ochre desert; the
      // reference never does that — Asia is a cyan sky AND green
      // fields. So the track rolls a STAGE, and the stage names both.
      const stage = skyLib.stageForSeed(race.seed);
      if (window.FF.palette.setGround) window.FF.palette.setGround(stage.ground);
      const ground = skyLib.groundHex(stage.ground);
      // The sky is GENERATED from the seed, gated against the cast,
      // the band budget and the ground it will sit above. A roll that
      // fails every attempt falls back to the hour's authored classic
      // rather than shipping something that failed a law.
      const role = window.FF.palette.getTime();
      const gen = skyLib.generate ? skyLib.generate(role, race.seed, ground) : null;
      if (gen && gen.generated) {
        // THE SPEC ITSELF, not a name. Registering it would give a
        // one-race value a permanent entry in a global table, which
        // is exactly the leak that measured 11 specs to 61 over fifty
        // races.
        window.FF.palette.setSky(gen);
      } else {
        window.FF.palette.setSky(skyLib.skyForSeed(role, race.seed));
      }
    }
    // The moon's position: seeded per track, so night races differ
    // from one another without any of them being random.
    if (window.FF.palette.setSunSeed) window.FF.palette.setSunSeed(race.seed);
  }
  // An unreachable lap target is the whole trick: finishedTick is
  // never set, so every downstream rule (finish screen, career write,
  // ghost save) stays correct without knowing this race is different.
  race.laps = (exhibition || session) ? Number.MAX_SAFE_INTEGER
    : (def ? def.laps : 0);
  race.lapIndex = 0;
  race.lapStartTick = state.tick;
  race.splits.length = 0;
  race.bestLapTicks = null;
  race.finishedTick = null;

  state.camera.initialized = false; // snap camera, don't pan across the map

  // The exhibition must never record: it is a track-mode race, so the
  // recorder would happily bank an autopilot lap as the player's.
  if (session) {
    // A session is not a race: nothing banked, nothing replayed.
    if (window.FF.ghost.stopRecording) window.FF.ghost.stopRecording();
  }
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

// THE NAMING CEREMONY IS SEQUENCED BY FLOW (flow's 'naming' state),
// not fired here at boot. Called from this point it raced the menu
// for the screen and lost, then surfaced mid-race over an armed grid
// — naming your melon started the countdown. flow.init now gates on
// melon.needsName() and enters the ceremony BEFORE the menu, with the
// exhibition running behind it.
//
// The name still has to reach the BODY, though: flow can't know about
// state.melon. A melon named at boot is applied to the racer the next
// time a race is built (main's respawnRace copies spec.name), and the
// gate resolves before any race exists — so there is nothing to patch
// up here. Renaming later goes through the same path.

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
// ---- OPEN-SESSION ENTRY (party chassis, 2026-08-25) --------------
// An event module hands over its provider and session config; this is
// the ONLY door — it owns provider switching and the race rebuild so
// event modules never touch main's internals.
window.FF.world._install({
  state,
  buildSession(name, providerObj, sessionOpts, extras) {
    providers[name] = providerObj;
    modeName = name;
    provider = providerObj;
    respawnRace({ session: true });
    const s = window.FF.session.begin(state, sessionOpts);
  // THE CONVEYOR RETURNS YOU TO YOUR OWN GRID SLOT (re-fixed
  // 2026-08-25, second device finding): the first anchor projected a
  // landing surface at revive time using the DEATH y as the reference
  // — and project() is a ring search around that point, so a
  // reference deep in the run-out picked wrong faces and planted
  // bodies inside the floor. No projection at revive time at all:
  // capture every body's ACTUAL granted grid position now, at session
  // start, and hand each body exactly its own spot back. "Back at the
  // start" means YOUR start.
  const bodies0 = [state.players[0].melon].concat(state.bots.map((b) => b.melon));
  // THE PLACEMENT LAW (derby stage 2, 2026-08-26x): a session may
  // carry its own spawn arrangement — sessionOpts.place(bodies,
  // state) runs HERE, after the default grid line, BEFORE the
  // respawn anchors are captured below, so "back at the start" means
  // your PACK spot, not the race grid's. Absent place, nothing
  // changes: every existing session spawns exactly as before.
  if (sessionOpts && typeof sessionOpts.place === 'function') {
    sessionOpts.place(bodies0, state);
  }
  s.respawnX = SPAWN.x;                       // legacy fallback
    s.respawnXs = bodies0.map((m) => m.x);
    s.respawnYs = bodies0.map((m) => m.y);
    if (extras) Object.assign(s, extras);
    return s;
  },
  toDaily() {
  // MIDNIGHT ROLLOVER (fix 2026-08-26, device freeze at 01:48: a cup
  // started before midnight, MAIN MENU pressed after — the new day's
  // track was never registered at boot, provider came back undefined,
  // provider.reset threw and killed the frame loop). Resolve the
  // provider exactly as boot does: register today's def on demand,
  // fall back to Track 1. The same lesson the practice button learned
  // on 2026-08-17.
  modeName = (window.FF.dailyTrackName && window.FF.dailyTrackName()) || 'Track 1';
  if (!providers[modeName]) {
    const def = window.FF.trackDefByName(modeName);
    if (def) providers[modeName] = createTrackProvider(def);
  }
    provider = providers[modeName] || providers['Track 1'];
    respawnRace();
  },
});

window.FF._state = state;   // read-only presentation handle (results overlays)
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
  const dist = state.spine.progressOf(state.melon);
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
  // TERRAIN RECAPTURE (2026-08-18): polys() returns a SPREAD — the
  // live pts reference plus whatever branch arrays exist right now.
  // Rebuilds replace those arrays, so the captured spread must be
  // refreshed when the provider says so, and the spine (built FROM
  // the capture) with it. Changes land outside body reach by the
  // KEEP_BEHIND / GEN_AHEAD margins, so the swap is physically
  // inert for every live body.
  if (provider.rev !== undefined && provider.rev !== lastProviderRev) {
    lastProviderRev = provider.rev;
    state.terrain = provider.polys ? provider.polys() : [provider.pts];
    state.spine = window.FF.trackSpace.metricSpine(SPAWN.x,
      provider.lapArc || null, state.terrain);
  }

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
      if (window.FF.session) window.FF.session.update(state);
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
    //
    // 'naming' counts too: that screen is a scrim over the SAME
    // exhibition, so excluding it left the backdrop running but never
    // advanced — the field froze mid-race the moment a player opened a
    // rename, and lurched back into motion on the way out.
    const exhibiting = (fs === 'menu' || fs === 'naming')
      && ex && ex.running && ex.shouldStep();
    const racing = !window.FF.flow || fs === 'race' || fs === 'finish' || exhibiting;
    if (racing) {
      while (accumulator >= stepDt) {
        // Autopilot writes the same input fields the stick does, so
        // the sim cannot tell the difference (no-op while a human is
        // driving).
        gridTick();
        if (window.FF.autopilot) window.FF.autopilot.drive(state);
        step(state, stepDt);
        // The open-session chassis ticks WITH the sim — same fixed
        // step, same determinism stream; inert when no session runs.
        if (window.FF.session) window.FF.session.update(state);
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
    // LIFECYCLE ANNOUNCEMENTS (refactor step 4, 2026-08-26): the
    // frame boundary announces deterministic sim moments to the
    // events bus — HERE, outside the fixed-step loop, so listeners
    // (which may rebuild worlds) never run mid-step. One announcement
    // per session end; the latch resets when a new session begins.
    if (state.session && state.session.over && !state.session._announced) {
      state.session._announced = true;
      if (window.FF.events) {
        window.FF.events.emit('session:over', {}, state);
        // THE NAMED MOMENT (derby stage 3): an event that named its
        // end ('derby:over') gets it announced here too — same
        // latch, same boundary, delivery (data, event, state).
        if (state.session.announce) {
          window.FF.events.emit(state.session.announce,
            state.session.announceData || {}, state);
        }
      }
    }
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
  // THE SPECIES APPLIER RUNS UNCONDITIONALLY (fixed 2026-08-27d).
  // It used to live INSIDE the `if (design)` gate below — so on any
  // normal race (studio never opened, design null) the dev override
  // never reached the player at all. The override is orthogonal to
  // whether a melon has been dressed in the studio: applySpeciesDesign
  // resolves want = override || design || current, and is idempotent,
  // so this is a no-op on every frame that changes nothing.
  // Solo only: a local body change in a lockstep race is a desync.
  if (state.melon && !netSession) {
    const spec0 = window.FF.melon.active();
    const d0 = window.FF.melon.deriveSpec(spec0);
    window.FF.applySpeciesDesign(state.melon,
      (design && design.species) || null, d0.scale);
  }
  if (design && state.melon && !window.FF.devSpecies(null)) {
    // (Gated on the override probe: these writes re-applied the SAVED
    // pigment every frame and re-greened the beach ball — the decal
    // stomp's colour twin, found on device 2026-08-27f.)
    if (design.color) state.melon.bodyColor = design.color;
    if (design.patKey) state.melon.patKey = design.patKey;
    // Wearing a species means wearing its BODY, not just its paint:
    // aspect, taper, sizeMult, mass, inertia, collider path. Without
    // this the player raced a melon ellipse in dragon-ball paint —
    // wrong silhouette, wrong shading geometry (bands solve on the
    // actual body, so an ellipse catches the sun differently than a
    // sphere), and wrong physics (tips that can smash on a "ball").
    // Solo only: in a lockstep race a local body change is a desync.
    // (The species application moved ABOVE this gate — see the
    // comment there. A design's species reaches the door through the
    // unconditional call; nothing species-related belongs here.)
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