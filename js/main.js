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

const { CONFIG, createState, step, initInput, createRenderer, createHud, initDebugPanel } = window.FF;

// ---- Level (stage 1: one long flat runway) ----
// Terrain is already a polyline, so stage 2 is "add more points".
function buildFlatLevel(state) {
  const HALF_LENGTH = 200000; // effectively endless in both directions
  state.terrain = [
    [
      { x: -HALF_LENGTH, y: 0 },
      { x: HALF_LENGTH, y: 0 },
    ],
  ];
}

// ---- Bootstrap ----
const canvas = document.getElementById('game');
const state = createState();
buildFlatLevel(state);

initInput(state, canvas);
initDebugPanel(state);
const renderer = createRenderer(canvas);
const hud = createHud(state);

// ---- Fixed-timestep loop ----
const MAX_FRAME_DT = 0.1; // clamp huge gaps (tab switch) — avoid spiral of death
let accumulator = 0;
let last = performance.now();

function frame(now) {
  let dtFrame = (now - last) / 1000;
  last = now;
  if (dtFrame > MAX_FRAME_DT) dtFrame = MAX_FRAME_DT;

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
