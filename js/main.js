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
const SPAWN = { x: 120 };
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
let modeName = 'Track 1';
let provider = providers[modeName];

function respawnRace() {
  window.FF.debris.reset(); // wreckage persists per race, not across them
  provider.reset();
  provider.update(SPAWN.x - KEEP_BEHIND - 800, SPAWN.x + GEN_AHEAD);
  state.terrain = [provider.pts];
  state.period = provider.period;

  const humans = netSession ? netSession.ls.playerCount : 1;
  const localSlot = netSession ? netSession.ls.localSlot : 0;
  // Netplay feeds every player's input from the lockstep buffer;
  // solo aliases the UI input straight into player 0.
  resetPlayers(state, humans, localSlot, SPAWN.x, -CONFIG.semiMinor - 200, !netSession);
  resetBots(state, Math.max(0, GRID_SIZE - humans), SPAWN.x - 46 * humans, -CONFIG.semiMinor - 200);

  // Deal the cast: seeded from the race seed, so every peer, ghost,
  // and daily shares the same roster.
  const castSeed = TRACKS[modeName] ? TRACKS[modeName].seed : SEED;
  window.FF.assignRosterNames(state, castSeed);

  state.raceStartTick = state.tick;
  state.raceStartX = SPAWN.x;

  const race = state.race;
  const def = TRACKS[modeName];
  race.mode = def ? 'track' : 'endless';
  race.lapLengthPx = def ? def.lapLengthM * 100 : 0;
  race.laps = def ? def.laps : 0;
  race.lapIndex = 0;
  race.lapStartTick = state.tick;
  race.splits.length = 0;
  race.bestLapTicks = null;
  race.finishedTick = null;

  state.camera.initialized = false; // snap camera, don't pan across the map
}

function selectMode(name) {
  if (!providers[name]) return;
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
      if (msg && msg.t === 'i') netSession.ls.addRemote(msg.s, msg.k, msg.a);
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
initDebugPanel(state);
const renderer = createRenderer(canvas);
const hud = createHud(state);

document.getElementById('respawn-btn').addEventListener('click', () => {
  if (netSession) return; // a solo respawn would desync a lockstep race
  respawnRace();
});

// ---- Lap accounting (tick-accurate: called after every physics step) ----
function checkLapCrossings() {
  const race = state.race;
  if (race.mode !== 'track' || race.finishedTick !== null) return;
  const dist = state.melon.x - state.raceStartX;
  const lap = Math.floor(dist / race.lapLengthPx);
  if (lap > race.lapIndex) {
    for (let l = race.lapIndex; l < Math.min(lap, race.laps); l++) {
      const t = state.tick - race.lapStartTick;
      race.lapStartTick = state.tick;
      if (t >= MIN_LAP_TICKS) {
        race.splits.push(t);
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
function checkAutoRestart() {
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
      netSession.sendInput(ls.queueLocal(ls.queuedThrough + 1, state.input.rawAxis));
    }
    let stalled = false;
    while (accumulator >= stepDt) {
      const next = state.tick + 1;
      if (!ls.ready(next)) { stalled = true; break; }
      const ins = ls.inputs(next);
      for (let i = 0; i < state.players.length; i++) {
        state.players[i].input.rawAxis = ins[i];
      }
      step(state, stepDt);
      checkLapCrossings();
      ls.prune(next);
      accumulator -= stepDt;
    }
    if (stalled) accumulator = Math.min(accumulator, stepDt * 4); // no spiral
    netSession.setStatus(stalled ? 'waiting for peers…' : '');
  } else {
    while (accumulator >= stepDt) {
      step(state, stepDt);
      checkLapCrossings();
      accumulator -= stepDt;
    }
    checkAutoRestart();
  }

  const alpha = accumulator / stepDt;
  renderer.render(state, alpha, dtFrame);
  hud.update(dtFrame);
  window.FF.audio.update(state, dtFrame);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

})();
