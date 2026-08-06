(function () {
'use strict';
// ============================================================
// CONFIG — the single source of truth for every tunable number.
//
// Rules of the house:
//   * Physics reads CONFIG every step; nothing caches these values,
//     so the debug sliders take effect live.
//   * DEFAULTS is frozen. CONFIG is the mutable working copy.
//   * SCHEMA drives the debug panel — add a tunable here and it
//     automatically appears as a slider. One place to edit, ever.
//
// Units: pixels, seconds, radians. World-space pixels are decoupled
// from screen pixels by the camera, so these stay stable across devices.
// ============================================================

const DEFAULTS = Object.freeze({
  // --- Simulation ---
  physicsHz: 120,          // fixed timestep frequency
  solverIterations: 6,     // contact solve passes per step

  // --- World ---
  gravity: 2400,           // px/s^2, y-down

  // --- Melon body ---
  semiMajor: 46,           // a: half-length of long axis (px)
  semiMinor: 36,           // b: half-length of short axis (px)
  mass: 1,                 // arbitrary unit; everything scales off it

  // --- Motor (player torque) ---
  // NOTE: an ellipse rolling on its flat side must lift its center over
  // a "corner" every half-turn (center height oscillates b -> a -> b).
  // Below ~18000 the motor can't beat that gravity barrier and the melon
  // rocks in place — verified by headless torque sweep. Keep above it.
  // Static climb limit: sin(θ) = T / (m·g·r_contact). At 75000 with the
  // default melon that's ~42° from a standstill; steeper slopes need
  // carried momentum. Tuned via headless sweep 2026-08-06: 0→3 m/s in
  // ~0.35s, top ~10.5 m/s, brake-to-zero from top in ~0.7s.
  motorTorque: 75000,      // peak torque at zero spin
  maxAngVel: 55,           // rad/s where motor torque tapers to zero
  brakeBoost: 1.3,         // torque multiplier when spinning against ω
  airTorqueScale: 0.55,    // torque authority while airborne
  inputResponse: 24,       // how fast input eases to target (1/s)

  // --- Surface interaction ---
  friction: 0.95,          // Coulomb μ at contact
  rollingResistance: 0.025, // contact losses; also damps contact bounce at speed
  restitution: 0.18,       // bounciness (0..1)
  restitutionThreshold: 90,// impacts slower than this don't bounce (px/s)

  // --- Damping (air resistance & spin decay) ---
  linearDamping: 0.035,     // 1/s
  angularDamping: 0.12,    // 1/s

  // --- Contact solver stability ---
  positionCorrection: 0.6, // fraction of penetration fixed per step
  penetrationSlop: 0.4,    // allowed overlap before correction (px)

  // --- Juice (visual only, physics never reads these) ---
  squashStrength: 0.00022, // impact impulse -> squash amount
  squashDecay: 9,          // 1/s
  cameraLerp: 5.5,         // camera follow speed (1/s)
});

// Mutable working copy — the debug panel writes here.
const CONFIG = { ...DEFAULTS };

// Slider schema for debug.js. Grouped for readability in the panel.
const SCHEMA = [
  { group: 'Motor' },
  { key: 'motorTorque',    min: 5000, max: 150000, step: 1000 },
  { key: 'maxAngVel',      min: 5,    max: 120,   step: 1 },
  { key: 'brakeBoost',     min: 1,    max: 4,     step: 0.1 },
  { key: 'airTorqueScale', min: 0,    max: 1.5,   step: 0.05 },
  { key: 'inputResponse',  min: 2,    max: 40,    step: 1 },

  { group: 'World' },
  { key: 'gravity',        min: 400,  max: 5000,  step: 50 },
  { key: 'friction',       min: 0,    max: 2,     step: 0.05 },
  { key: 'rollingResistance', min: 0, max: 0.1,   step: 0.002 },
  { key: 'restitution',    min: 0,    max: 0.9,   step: 0.02 },

  { group: 'Melon' },
  { key: 'semiMajor',      min: 20,   max: 90,    step: 1 },
  { key: 'semiMinor',      min: 15,   max: 80,    step: 1 },
  { key: 'linearDamping',  min: 0,    max: 1,     step: 0.02 },
  { key: 'angularDamping', min: 0,    max: 2,     step: 0.02 },

  { group: 'Feel' },
  { key: 'squashStrength', min: 0,    max: 0.001, step: 0.00002 },
  { key: 'cameraLerp',     min: 0.5,  max: 20,    step: 0.5 },
];

function resetConfig() {
  Object.assign(CONFIG, DEFAULTS);
}

// Derived quantities — computed, never stored, so they can't go stale.
function melonInertia() {
  // Solid ellipse about its center: I = m(a² + b²)/4
  const { mass, semiMajor: a, semiMinor: b } = CONFIG;
  return (mass * (a * a + b * b)) / 4;
}

// Namespace registration (classic scripts, no modules).
window.FF = window.FF || {};
Object.assign(window.FF, { DEFAULTS, CONFIG, SCHEMA, resetConfig, melonInertia });
})();
