(function () {
'use strict';
// ============================================================
// STATE — the single source of truth for everything that changes.
//
// Ownership contract (who may WRITE each slice):
//   state.input   -> input.js only
//   state.melon   -> physics.js only
//   state.terrain -> level setup only (main.js for now)
//   state.camera  -> renderer.js only (presentation state)
//   state.fx      -> physics writes impact events, renderer decays them
//   state.telemetry -> physics.js only; hud.js reads
//
// Renderer reads everything, writes only camera + fx decay.
// This is what keeps the sim deterministic later: replaying inputs
// against physics state alone must reproduce a run, so nothing
// presentational may feed back into the melon slice.
// ============================================================

const { CONFIG } = window.FF;

function createState() {
  const state = {
    // Simulation tick counter — becomes the replay clock in later stages.
    tick: 0,

    input: {
      rawAxis: 0,     // instantaneous intent: -1 (left), 0, +1 (right)
      torqueAxis: 0,  // smoothed axis actually applied by physics
    },

    melon: null,      // set by resetMelon
    prevMelon: null,  // previous-step snapshot for render interpolation

    // Terrain is a list of polylines (arrays of {x, y} points).
    // Stage 1 = one long flat polyline; stage 2 just adds points here.
    terrain: [],

    camera: {
      x: 0,
      y: 0,
      initialized: false,
    },

    fx: {
      squash: 0,        // 0..~0.3, visual squash amount
      squashAngle: 0,   // world angle of last impact normal
    },

    telemetry: {
      grounded: false,
      lastImpactVn: null,       // normal speed of last landing (px/s)
      lastImpactAngleDeg: null, // major-axis vs surface misalignment (0..90°)
      lastImpactTick: -1,
    },
  };

  resetMelon(state, 0, -CONFIG.semiMinor - 200);
  return state;
}

function resetMelon(state, x, y) {
  state.melon = {
    x, y,           // center, world px (ground is y = 0, y is down)
    angle: 0,       // radians; positive = clockwise on screen
    vx: 0,
    vy: 0,
    omega: 0,       // angular velocity, rad/s
  };
  state.prevMelon = { ...state.melon };
  state.fx.squash = 0;
  state.telemetry.lastImpactVn = null;
  state.telemetry.lastImpactAngleDeg = null;
}

// Called at the top of every physics step so the renderer can
// interpolate between the previous and current state.
function snapshotPrev(state) {
  const m = state.melon, p = state.prevMelon;
  p.x = m.x; p.y = m.y; p.angle = m.angle;
}

Object.assign(window.FF, { createState, resetMelon, snapshotPrev });
})();
