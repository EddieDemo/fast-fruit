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

  // --- Smash rule (structural timing; thresholds live in presets) ---
  respawnDelayTicks: 60,   // 0.5s at 120Hz between smash and respawn
  spawnProtectTicks: 120,  // 1s of immunity after any (re)spawn

  // --- Contact solver stability ---
  positionCorrection: 0.6, // fraction of penetration fixed per step
  penetrationSlop: 0.4,    // allowed overlap before correction (px)

  // --- Juice (visual only, physics never reads these) ---
  squashStrength: 0.00022, // impact impulse -> squash amount
  squashDecay: 9,          // 1/s
  cameraLerp: 5.5,         // camera follow speed (1/s)
});

// ---- Presets ----
// Complete feel-snapshots saved in code. Each preset covers every
// SCHEMA-tunable key, so applying one fully restores that feel even
// after slider fiddling. DEFAULTS supplies the structural constants
// presets never touch (physicsHz, solver, mass, slop...).
const PRESETS = Object.freeze({
  // The original stage-2 tune: grippy, planted, moderate bounce.
  'OG 1': Object.freeze({
    gravity: 2400,
    semiMajor: 46, semiMinor: 36,
    motorTorque: 75000, maxAngVel: 55, brakeBoost: 1.3,
    airTorqueScale: 0.55, inputResponse: 24,
    friction: 0.95, rollingResistance: 0.025,
    restitution: 0.18, restitutionThreshold: 90,
    linearDamping: 0.035, angularDamping: 0.12,
    squashStrength: 0.00022, cameraLerp: 5.5,
    smashThreshold: 4700, curvExponent: 1.7,
  }),
  // Bouncier, floatier, a touch more out-of-control at speed:
  // higher restitution + lower bounce threshold, less grip and
  // damping, more air authority, slightly lazier camera.
  'Loose 1': Object.freeze({
    gravity: 2400,
    semiMajor: 46, semiMinor: 36,
    motorTorque: 80000, maxAngVel: 60, brakeBoost: 1.3,
    airTorqueScale: 0.65, inputResponse: 24,
    friction: 0.9, rollingResistance: 0.018,
    restitution: 0.34, restitutionThreshold: 55,
    linearDamping: 0.028, angularDamping: 0.09,
    squashStrength: 0.0003, cameraLerp: 4.5,
    // Severity = contact impulse x (R_flat / R_contact)^curvExponent.
    // Envelope fitted to real landing telemetry (1797 paired landings):
    // smash = exceptional speed AND bad angle, never speed alone.
    // At 5400/1.7: flat-side lethal ~40 m/s (unreachable), 45-degree
    // tilt lethal ~19, tip lethal ~11.5. Kills only the worst ~5% of
    // unprepared tumbling landings; a prepared flat landing survives
    // any achievable speed. Smash = exceptional speed AND bad angle.
    smashThreshold: 5400, curvExponent: 1.7,
  }),
});
const DEFAULT_PRESET = 'Loose 1';

// Mutable working copy — the debug panel writes here.
const CONFIG = { ...DEFAULTS, ...PRESETS[DEFAULT_PRESET] };
let activePreset = DEFAULT_PRESET;

function applyPreset(name) {
  if (!PRESETS[name]) return;
  activePreset = name;
  Object.assign(CONFIG, PRESETS[name]);
}

function getActivePreset() {
  return activePreset;
}

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

  { group: 'Smash' },
  { key: 'smashThreshold', min: 400,  max: 9000,  step: 50 },
  { key: 'curvExponent',   min: 0,    max: 2,     step: 0.05 },

  { group: 'Feel' },
  { key: 'squashStrength', min: 0,    max: 0.001, step: 0.00002 },
  { key: 'cameraLerp',     min: 0.5,  max: 20,    step: 0.5 },
];

// Restore the active preset (undoes slider fiddling).
function resetConfig() {
  Object.assign(CONFIG, DEFAULTS, PRESETS[activePreset]);
}

// Derived quantities — computed, never stored, so they can't go stale.
function melonInertia() {
  // Solid ellipse about its center: I = m(a² + b²)/4
  const { mass, semiMajor: a, semiMinor: b } = CONFIG;
  return (mass * (a * a + b * b)) / 4;
}

// Namespace registration (classic scripts, no modules).
window.FF = window.FF || {};
Object.assign(window.FF, { DEFAULTS, CONFIG, SCHEMA, PRESETS, applyPreset, getActivePreset, resetConfig, melonInertia });
})();
