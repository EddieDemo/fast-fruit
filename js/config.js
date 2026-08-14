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
  airTorqueScale: 1,    // AIR AUTHORITY: parity with ground torque.
  // The rolling constraint still makes the air ~3x more responsive on
  // its own (grounded, the motor drags the whole mass through traction
  // — effective inertia ~3.5x; airborne there is only the body's I),
  // so 1.0 needs no multiplier to feel freer. Measured: a 40 rad/s
  // race spin dies in ~0.35s — decisive but AIMABLE. (5 reversed in
  // 0.09s and was unusably twitchy; 0.65 took 0.53s and felt sluggish.)
  inputResponse: 24,       // how fast input eases to target (1/s)
  bounceResponse: 48,      // the FLARE's own easing (2026-08-13).
  // Steering is a steering skill; the flare is a TIMING skill. At the
  // shared 24/s a panic flick reached 90% deflection 92ms after the
  // thumb did, so last-instant saves were judged at roughly half the
  // deflection the player was holding. 48 halves the lag (~46ms to
  // 90%) without touching the steering feel. Thumb-sweep on device
  // before locking, per house law.

  // --- Surface interaction ---
  friction: 0.95,          // Coulomb μ at contact
  rollingResistance: 0.025, // contact losses; also damps contact bounce at speed
  restitution: 0.18,       // NEUTRAL bounciness (flare stick centred)
  ringLog: 1,              // DEBUG BUILD: ring-vs-reality logger ON —
                           // one line per event to console + RINGLOG;
                           // turn off (or set 0 here) after the hunt
  ghosts: 0,               // ghost racer + challenge codes: OFF for now
                           // (kept in the code; flip to 1 to bring the
                           // ghost, its banner and share button back)
  practiceSplat: 0,        // THE PRACTICE RING IS A DEV TOOL (Eddie's
                           // ruling, 2026-08-13): off by default, flip
                           // via the tune panel when debugging the
                           // predictor. The player-facing signal is
                           // dangerRim below.
  dangerRim: 1,            // the shipped landing-fate signal: a rim on
                           // the airborne player's BODY (renderer.js)
                           // driven by the same predictor the oracle
                           // brain races on. Three states: nothing =
                           // this landing is safe as held; amber = it
                           // kills as held but flare saves it; red =
                           // no stick position survives, steer. Moving
                           // the flare mid-air re-answers it live.
  bounceMax: 0.7,          // full-flare ceiling — capped well below 1: e=1
                           // is immortality under the energy law, and big
                           // drops must still demand the multi-bounce bleed
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
  squashStrength: 0.00006, // STRAIN dial: (severity / mass) -> squash.
  // Re-derived when squash became curvature-aware and mass-normalized
  // (the old 0.00022 was calibrated against raw impulse and saturates
  // the 0.3 clamp instantly under the new quantity). At 0.00006 a
  // gentle flat landing reads ~0.04, a hard tip landing ~0.22 — the
  // deformation is now a truthful preview of how close to bursting.
  squashCurve: 0.7,        // STRAIN RESPONSE: squash = 0.3 * (s/ref)^curve.
  // Real rind stiffens as it compresses — the first squash comes easily,
  // each extra bit costs more — so an exponent below 1 spreads the
  // visible range across ordinary hits while leaving headroom at the top.
  // (Linear response pinned ~40% of real-race impacts at the clamp, where
  // a hard landing and a near-death slam looked identical.) Swept against
  // a real race: routine bumps read ~0.09, hard hits ~0.22, the worst
  // 0.30, with only ~2% clipped — the whole range now carries meaning.
  // (0.55 is the punchier alternative: routine ~0.11.)
  squashRef: 2473,         // strain (severity/mass) reading as full squash — rescaled by 2200/4450, so near-death deformation looks the same
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
    airTorqueScale: 1, inputResponse: 24, bounceResponse: 48,
    friction: 0.95, rollingResistance: 0.025,
    restitution: 0.18, restitutionThreshold: 90,
    linearDamping: 0.035, angularDamping: 0.12,
    squashStrength: 0.00006, cameraLerp: 5.5,
    smashThreshold: 2175, curvExponent: 1.25, // energy units (damage.js); calibrated 2026-08-11 on the TIP-FIRST marginal (4.0m drop), the event class that actually kills.
    // 2026-08-13: carried onto the cluster law by Loose 1's swept
    // ratio (2081 x 2300/2200) — proportional, NOT independently
    // swept; re-tune if this preset returns to active duty.
  }),
  // Bouncier, floatier, a touch more out-of-control at speed:
  // higher restitution + lower bounce threshold, less grip and
  // damping, more air authority, slightly lazier camera.
  'Loose 1': Object.freeze({
    gravity: 2400,
    semiMajor: 46, semiMinor: 36,
    motorTorque: 80000, maxAngVel: 60, brakeBoost: 1.3,
    airTorqueScale: 1, inputResponse: 24, bounceResponse: 48,
    friction: 0.9, rollingResistance: 0.018,
    restitution: 0.34, restitutionThreshold: 55,
    linearDamping: 0.028, angularDamping: 0.09,
    squashStrength: 0.00008, cameraLerp: 4.5,
    // Severity = contact impulse x (R_flat / R_contact)^curvExponent.
    // Envelope fitted to real landing telemetry (1797 paired landings):
    // smash = exceptional speed AND bad angle, never speed alone.
    // At 5400/1.7: flat-side lethal ~40 m/s (unreachable), 45-degree
    // tilt lethal ~19, tip lethal ~11.5. Kills only the worst ~5% of
    // unprepared tumbling landings; a prepared flat landing survives
    // any achievable speed. Smash = exceptional speed AND bad angle.
    // Re-tuned WITH curvExponent 1.25 (2026-08-08): softening the tip
  // penalty from 1.7 cut bot deaths 78% (2.64 -> 0.59/race), so the
  // threshold came down to restore the carnage baseline. Swept: 5400 ->
  // 0.59 deaths, 4450 -> 1.80, 4200 -> 2.33, 3900 -> 2.79. At 4200 the
  // pack runs 302m/2.33 deaths; 4450 gives 316m/1.80 — chosen for a
  // slightly more forgiving game now that real air control lets a
  // skilled pilot save a bad landing.
  // ENERGY units since 2026-08-11 (damage.js): severity = dissipated
  // energy (kilo-units) x stress concentration. Calibrated on the
  // race-death ENSEMBLE at the boot configuration (10x60s sweep:
  // melon-family deaths 4.95/race matching the impulse law's ~5.0
  // baseline; spheres exactly 0). Recalibrated 2026-08-11 for the
  // SHAPE-TOUGHNESS law (orientation-independent severity — see
  // damage.js): the constant per-species factor now rides every
  // landing, not just tips, so the threshold sits higher than the
  // tip-weighted law needed. Bounciness is armour; where you land no
  // longer matters, what you are does.
  // CLUSTER-LAW RECALIBRATION (2026-08-13): severity is now the SUM
  // of dissipated energy across a landing's contact cluster (see
  // damage.js), which charges wedge landings and corner-split hits
  // their honest total — so the threshold rises to hold the carnage
  // baseline. Swept 6 seeds x 45s vs the max-rule build on identical
  // tracks: max-rule 33.5 deaths/race; cluster at 2200 -> 37.2, 2300
  // -> 31.7 (chosen: first value at/under baseline, slightly
  // forgiving, same call as the 4450 pick). NOTE: sweep ran in the
  // headless harness, whose absolute death rates run far above the
  // 4.95/race noted at the 2026-08-11 calibration — environment
  // difference unresolved (terrain recipe? policy vintage?). The
  // RATIO is robust (both rules shared the environment); re-sweep on
  // the canonical harness before locking.
  smashThreshold: 2300,
  // Size-toughness exponent k: a body's effective threshold scales as
  // s^k (via its mass ratio). k=0: raw square-cube (big melons ~34%
  // more land-fragile at s=1.15). k=2: area-law structural honesty —
  // thicker rind on bigger fruit, gentle residual penalty. k=3: fully
  // size-neutral lethal SPEED. The fruit roster's materials dial.
  sizeToughness: 2.35,
  // ---- Bot species toggles (launch config) ----
  // Flip to false to keep a species off the grid. The species DRAW
  // still happens (the seeded stream is consumed identically), so
  // toggling one species never reshuffles anyone else's size or
  // pattern — disabled draws simply land as watermelon. Solo-safe;
  // in netplay all peers must share these values or bodies desync.
  botCantaloupe: false,
  botHoneydew: false,
  // THE FIELD COMES FROM THE ROSTER (2026-08-14). roster.js names
  // every character — pilot, melon, brain and body — so the field is
  // authored content rather than a species list, and this is null by
  // default. It survives as an OVERRIDE for callers that genuinely
  // want to describe a field themselves: harnesses ("the grid is one
  // dragon ball and eleven melons"), balance sweeps, and netplay.
  // A non-empty value here takes precedence over the roster, so
  // setting it is how a suite opts out of the permanent cast.
  botRoster: null,

  // BRAINS MOVED TO THE ROSTER (2026-08-14). A brain belongs to the
  // PILOT, not to the fruit: driving skill is a property of the thing
  // steering, and a melon is a body. roster.js now names every
  // character's pilot, melon and brain in one authored table, so the
  // clever racer cannot drift away from the melon it drives. This map
  // survives as a per-melon-name OVERRIDE for fields the roster does
  // not build (netplay, harnesses); empty by default.
  botBrains: {},
  // The LAWS OF MELON NATURE — uniform physical rules across the size
  // family, tuned so distinct characters equalize in WIN RATE without
  // ever fudging an individual or an outcome:
  //   sizeEngineExp: motor torque ~ s^g (g=4 is accel-neutral;
  //     lower g leaves big melons torquey but slower to spool)
  //   sizeRevExp: rev limit ~ (1/s)^q — small wheels rev higher, as
  //     in every real vehicle; q=1 makes TOP SPEED size-neutral
  // Tournament-tuned (36-race win-rate harness, 2026-08-08): these
  // values balance WIN PERCENTAGE across the 0.85-1.18 size family
  // while keeping every physical character distinct — the whopper
  // still dies 4x/race and podiums anyway; the runt is still nearly
  // immortal. Laws, not favors.
  sizeEngineExp: 3.5,
  // SHARPNESS PENALTY exponent: the contact-curvature ratio is raised
  // to this power. Contact mechanics supports ~1.0-1.5 (contact patch
  // ~sqrt of the ratio, plus a stiffness term); 1.7 was chosen by feel
  // and over-egged the tip. At 1.25 a tip landing is ~1.8x as punishing
  // as a flank landing (was ~2.2x); flank landings are unaffected.
  sizeRevExp: 0.4, curvExponent: 1.25,
  }),
});
const DEFAULT_PRESET = 'Loose 1';

// Mutable working copy — the debug panel writes here.
// BUILD STAMP. Shown on the menu, so a screenshot always identifies
// the build it came from. Two rounds of "the fix isn't working" have
// turned out to be a stale file rather than a wrong one, and nothing
// on screen could tell us apart. Bump it with any shipped change.
const BUILD = '2026-08-14p';

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
  { key: 'airTorqueScale', min: 0,    max: 12,    step: 0.25 },
  { key: 'inputResponse',  min: 2,    max: 40,    step: 1 },
  { key: 'bounceResponse', min: 2,    max: 96,    step: 2 },

  { group: 'World' },
  { key: 'gravity',        min: 400,  max: 5000,  step: 50 },
  { key: 'friction',       min: 0,    max: 2,     step: 0.05 },
  { key: 'rollingResistance', min: 0, max: 0.1,   step: 0.002 },
  { key: 'restitution',    min: 0,    max: 0.9,   step: 0.02 },
  { key: 'bounceMax',      min: 0.3,  max: 0.95,  step: 0.01 },
  { key: 'ghosts',         min: 0,    max: 1,     step: 1 },
  { key: 'practiceSplat',  min: 0,    max: 1,     step: 1 },
  { key: 'dangerRim',      min: 0,    max: 1,     step: 1 },
  { key: 'ringLog',        min: 0,    max: 1,     step: 1 },

  { group: 'Melon' },
  { key: 'semiMajor',      min: 20,   max: 90,    step: 1 },
  { key: 'semiMinor',      min: 15,   max: 80,    step: 1 },
  { key: 'linearDamping',  min: 0,    max: 1,     step: 0.02 },
  { key: 'angularDamping', min: 0,    max: 2,     step: 0.02 },

  { group: 'Smash' },
  { key: 'smashThreshold', min: 500,  max: 8000,  step: 50 },
  { key: 'curvExponent',   min: 0,    max: 2,     step: 0.05 },

  { group: 'Feel' },
  { key: 'squashStrength', min: 0,    max: 0.0002, step: 0.000005 },
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
Object.assign(window.FF, { BUILD, DEFAULTS, CONFIG, SCHEMA, PRESETS, applyPreset, getActivePreset, resetConfig, melonInertia });
})();