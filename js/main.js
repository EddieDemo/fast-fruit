// ============================================================
// MAIN — composition root and game loop. Classic scripts:
// index.html loads every module before this file, each one
// registering itself on window.FF. This file wires them up.
//
// Loop: fixed-timestep physics with an accumulator, interpolated
// rendering. Physics rate lives in CONFIG (default 120 Hz) so the
// sim feels identical on a 60 Hz phone and a 144 Hz monitor —
// and stays deterministic for the ghost system later.
// ============================================================

(function () {
'use strict';

const { CONFIG, createState, resetMelon, step, initInput, createRenderer, createHud, initDebugPanel, createTerrainGen } = window.FF;

// ---- Level: endless seeded downhill run ----
// Change SEED for a different world; the same seed always produces the
// same track — that's the contract the ghost/sharing system relies on.
const SEED = 20260806;
const GEN_AHEAD = 3600;  // keep this much terrain generated in front
const KEEP_BEHIND = 2600; // and this much behind before pruning

const SPAWN = { x: 120 };
const canvas = document.getElementById('game');
const state = createState();
const terrainGen = createTerrainGen(SEED);
state.terrain = [terrainGen.pts]; // live reference: gen streams into it
terrainGen.ensure(SPAWN.x + GEN_AHEAD);
resetMelon(state, SPAWN.x, -CONFIG.semiMinor - 200);

initInput(state, canvas);
initDebugPanel(state);
const renderer = createRenderer(canvas);
const hud = createHud(state);

// Quick respawn: rebuild the world from the seed and drop at the start.
document.getElementById('respawn-btn').addEventListener('click', () => {
  terrainGen.reset();
  terrainGen.ensure(SPAWN.x + GEN_AHEAD);
  resetMelon(state, SPAWN.x, -CONFIG.semiMinor - 200);
  state.camera.initialized = false; // snap camera, don't pan across the map
});

// ---- Fixed-timestep loop ----
const MAX_FRAME_DT = 0.1; // clamp huge gaps (tab switch) — avoid spiral of death
let accumulator = 0;
let last = performance.now();

function frame(now) {
  let dtFrame = (now - last) / 1000;
  last = now;
  if (dtFrame > MAX_FRAME_DT) dtFrame = MAX_FRAME_DT;

  // Stream the world: extend ahead of the melon, prune far behind.
  // Done per-frame (not per-step) — the margins dwarf one frame's travel.
  terrainGen.ensure(state.melon.x + GEN_AHEAD);
  terrainGen.prune(state.melon.x - KEEP_BEHIND);

  const stepDt = 1 / CONFIG.physicsHz;
  accumulator += dtFrame;
  while (accumulator >= stepDt) {
    step(state, stepDt);
    accumulator -= stepDt;
  }

  const alpha = accumulator / stepDt;
  renderer.render(state, alpha, dtFrame);
  hud.update(dtFrame);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

})();
