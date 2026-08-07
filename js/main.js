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

const { CONFIG, createState, resetMelon, resetBots, step, initInput, createRenderer,
        createHud, initDebugPanel, createTerrainGen, TRACKS, createTrackProvider } = window.FF;

const SEED = 20260806;   // endless-mode world seed
const BOT_COUNT = 11;    // hold-right rivals spawned on load (0 = solo); 12-melon grid
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

  resetMelon(state, SPAWN.x, -CONFIG.semiMinor - 200);
  resetBots(state, BOT_COUNT, SPAWN.x, -CONFIG.semiMinor - 200);

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

document.getElementById('respawn-btn').addEventListener('click', respawnRace);

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
  while (accumulator >= stepDt) {
    step(state, stepDt);
    checkLapCrossings();
    accumulator -= stepDt;
  }
  checkAutoRestart();

  const alpha = accumulator / stepDt;
  renderer.render(state, alpha, dtFrame);
  hud.update(dtFrame);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

})();