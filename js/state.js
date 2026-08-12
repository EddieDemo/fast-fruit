(function () {
'use strict';
// ============================================================
// STATE — the single source of truth for everything that changes.
//
// Ownership contract (who may WRITE each slice):
//   state.input   -> input.js only
//   state.melon   -> physics.js only
//   state.terrain -> level setup only (main.js for now)
//   state.bots    -> physics.js writes bot melons; main.js owns
//                    bot inputs (constant hold-right) and bot count
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
    // Tick at which the current race began (set on respawn). The
    // stopwatch shows (tick - raceStartTick) / physicsHz: sim time,
    // not wall time, so it's deterministic and pauses with the sim.
    raceStartTick: 0,
    // World x where the current race began (set on respawn) — the
    // distance tracker measures from here, in sim space like the clock.
    raceStartX: 0,

    input: {
      rawAxis: 0,     // instantaneous spin intent, [-1, +1]
      rawBounce: 0,   // instantaneous flare intent, [-1, +1] (up = bouncy)
      bounceAxis: 0,  // smoothed flare actually applied by physics
      torqueAxis: 0,  // smoothed axis actually applied by physics
    },

    melon: null,      // ALIAS of players[localSlot].melon (the local racer)
    prevMelon: null,  // alias of that player's prev snapshot

    // All human racers in CANONICAL SLOT ORDER — every peer simulates
    // this array identically (same order, same inputs), which is what
    // keeps lockstep multiplayer bit-identical. Solo play is just one
    // player whose input object IS state.input.
    players: [],      // [{ melon, prevMelon, input: {rawAxis, torqueAxis} }]
    localSlot: 0,

    // Hold-right bots: same body shape, same physics path, inputs
    // pinned to full right. Unlike the old single ghost, bots DO
    // collide — with the player and with each other.
    bots: [], // filled by resetBots: { melon, prevMelon, input }

    // Terrain is a list of polylines (arrays of {x, y} points).
    terrain: [],

    // Periodicity of the world: null in endless mode; { L, D } in
    // track mode (terrain repeats every L px across, D px down).
    // Physics uses this for minimum-image collisions; the renderer
    // uses it to draw each body at its image nearest the camera.
    period: null,

    // Race accounting (main.js writes, hud.js reads). Ticks, not
    // seconds — sim time, deterministic like everything else.
    race: {
      mode: 'endless',   // 'endless' | 'track'
      lapLengthPx: 0,
      laps: 0,
      lapIndex: 0,       // floor(distance / lapLength)
      lapStartTick: 0,
      splits: [],        // completed lap durations, in ticks
      bestLapTicks: null,
      finishedTick: null,
    },

    camera: {
      x: 0,
      y: 0,
      initialized: false,
    },

    lastDeath: null, // presentation-only death certificate (local player)

    fx: {
      // (squash moved onto the bodies themselves: m.squash / m.squashAngle)
      flash: 0,         // 0..1 near-miss flash (renderer decays it)
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

// Shape lookup: b/a for a species, defaulting to the CONFIG ellipse.
const REF_VOL = CONFIG.semiMajor * CONFIG.semiMinor * CONFIG.semiMinor;
function fruitAspect(species) {
  const F = window.FF.FRUITS;
  return (F && F[species] && F[species].aspect) || (CONFIG.semiMinor / CONFIG.semiMajor);
}
function fruitTaper(species) {
  const F = window.FF.FRUITS;
  return (F && F[species] && F[species].taper) || 0;
}

// Tapered-body physique (the egg). Uniform density over the profile
// y = ±b·(1−τ·x/a)·sqrt(1−(x/a)²) gives closed forms (odd terms
// vanish under the symmetric integrals):
//   area   = πab (EXACTLY the ellipse's — the taper moves area, it
//            doesn't add any)
//   COM    = −aτ/4 along the major axis (toward the fat end). The
//            body origin IS the COM — the impulse solver's lever arms
//            and invI are only honest about the mass center — so the
//            boundary lives at +aτ/4 in body frame (m.sh).
//   volume = (4/3)πab²·(1+τ²/5): mass keeps the volume law with the
//            taper correction
//   I_com  = m·[(a² + b²(1+τ²/2))/4 − (aτ/4)²] (lamina, parallel-axis)
// Convention note: 2D dynamics (COM, inertia) follow the LAMINA and
// mass magnitude follows the VOLUME law — the same mixed convention
// the ellipse bodies already use (volume mass, lamina inertia).
function taperedMassInertia(a, b, taper) {
  const mass = CONFIG.mass * (a * b * b) / REF_VOL * (1 + taper * taper / 5);
  const sh = a * taper / 4;
  const inertia = mass * ((a * a + b * b * (1 + taper * taper / 2)) / 4 - sh * sh);
  return { mass, inertia, sh };
}

function createBody(x, y, scale, fruit) {
  const sc = scale || 1;
  const species = fruit || 'watermelon';
  // ---- Per-body mass & inertia: the fruit-roster foundation, done ----
  // Density normalized so the scale-1.0 player has EXACTLY the tuned
  // mass (CONFIG.mass): every existing number stays calibrated for
  // them. Mass follows VOLUME (spheroid: a*b^2 ~ s^3), so +/-5% size
  // is +/-16% mass; lamina inertia I = m(a^2+b^2)/4 ~ s^5. The
  // square-cube law is EMBRACED: impulses scale with mass against a
  // fixed smash threshold, so bigger melons are pack-dominant but
  // land-fragile — ants survive falls, elephants don't.
  // SHAPE comes from the registry: melons inherit the CONFIG ellipse,
  // a dragon ball is a sphere, an egg brings `taper` and with it the
  // tapered physique above. taper = 0 takes the ORIGINAL expressions
  // verbatim, so every melon's mass and inertia are bit-identical.
  const aspect = fruitAspect(species);
  const taper = fruitTaper(species);
  const a = CONFIG.semiMajor * sc;
  const b = a * aspect;
  let mass, inertia, sh;
  if (taper) {
    ({ mass, inertia, sh } = taperedMassInertia(a, b, taper));
  } else {
    mass = CONFIG.mass * (a * b * b) / REF_VOL;
    inertia = mass * (a * a + b * b) / 4;
    sh = 0;
  }
  return {
    a, b,
    fruit: species,      // registry tag: shape, palette and pulp
    taper,               // 0 = ellipse (exact legacy path everywhere)
    sh,                  // geometric center's offset in the COM frame
    squash: 0,           // per-body deformation (strain), presentation-tier
    squashAngle: 0,      // world angle of the deforming contact normal
    invM: 1 / mass,
    invI: 1 / inertia,
    x, y,           // center, world px (y is down)
    angle: 0,       // radians; positive = clockwise on screen
    vx: 0,
    vy: 0,
    omega: 0,       // angular velocity, rad/s
    grounded: false,// contact status from the LAST step; motor reads it

    // Smash life-cycle (physics.js owns these after creation):
    alive: true,
    respawnAtTick: 0,  // tick at which a dead body revives
    protectTick: 0,    // smash-immune until tick exceeds this
    hitSeverity: 0,    // worst terrain-contact severity this step
    pairSeverity: 0,   // worst melon-contact severity this step
    hitNx: 0, hitNy: -1,   // escape normal of the worst terrain blow
    pairNx: 0, pairNy: -1, // escape normal of the worst rival blow
    hitJn: 0, pairJn: 0,   // raw impulse of those blows (the drama budget)
  };
}

// ---- THE STARTING GRID (Eddie's spec, 2026-08-10) ----
// Every track carries 12 m of flat apron just before the start line;
// each METRE of it is one racer's spawn box. Racer n (players first
// in canonical slot order, then bots) spawns centred in the n-th
// metre before the line, body bottom 2 m above the surface, angle 0,
// at rest — twelve racers drop onto the apron side by side and the
// race starts when they cross the line. Placement is a pure function
// of grid index and terrain, identical on every lockstep peer.
const METRE = 100;      // world px per metre
const GRID_DROP = 200;  // spawn height: body bottom 2 m above ground

function gridPlace(state, melon, gridIndex, lineX, fallbackY) {
  const gx = lineX - (gridIndex + 0.5) * METRE; // centre of the metre
  melon.x = gx;
  const gy = window.FF.terrainYAt(state.terrain, gx);
  // No terrain yet (boot-time createState): keep the caller's y.
  melon.y = gy === null ? fallbackY : gy - melon.b - GRID_DROP;
}

// Set up `count` human players in canonical slot order on the grid:
// slot 0 takes the first metre before the LINE at x, slot 1 the
// second, and so on. localSlot picks which player this machine
// controls; aliasLocalInput wires the UI input object straight into
// that player (solo/back-compat path) — netplay passes false and
// feeds ALL inputs from the lockstep buffer.
function resetPlayers(state, count, localSlot, x, y, aliasLocalInput) {
  state.players.length = 0;
  for (let i = 0; i < count; i++) {
    const melon = createBody(x, y);
    gridPlace(state, melon, i, x, y);
    melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
    state.players.push({
      melon,
      prevMelon: { ...melon },
      input: { rawAxis: 0, torqueAxis: 0, rawBounce: 0, bounceAxis: 0 },
    });
  }
  state.localSlot = localSlot;
  if (aliasLocalInput) state.players[localSlot].input = state.input;
  state.melon = state.players[localSlot].melon;
  state.prevMelon = state.players[localSlot].prevMelon;
  state.melon.squash = 0;
  state.fx.flash = 0;
  state.telemetry.lastImpactVn = null;
  state.telemetry.lastImpactAngleDeg = null;
}

// Back-compat solo reset: one player, locally controlled.
function resetMelon(state, x, y) {
  resetPlayers(state, 1, 0, x, y, true);
}

// Spawn `count` bots on the grid, continuing where the humans end:
// bot i takes metre (gridStart + i + 1) before the line at x.
// gridStart defaults to 1 (one human) for legacy callers.
function resetBots(state, count, x, y, sizeSeed, gridStart) {
  state.bots.length = 0;
  const g0 = gridStart === undefined ? 1 : gridStart;
  for (let i = 0; i < count; i++) {
    // Seeded size variety, keyed to the grid slot (identical on every
    // peer; bot #4 is always bot #4's size). Triangular distribution
    // 0.85..1.18 centered near 1: mostly mid-sized, the odd runt, the
    // odd whopper — like actual produce. The player stays exactly 1.0.
    // Square-cube consequences are embraced and now pronounced: the
    // whopper (~1.6x mass) bullies the pack but dies on landings the
    // mid-pack shrugs off; the runt (~0.6x mass) gets battered around
    // and is nearly unkillable. Personality from physics alone.
    // Sizes re-deal per RACE (sizeSeed = the race's cast seed), so the
    // casting rotates: today's daily might hand the whopper body to
    // Gourdzilla; tomorrow Just Dave inherits the doom. Identical on
    // every peer. Without a seed (headless suites), the deal is the
    // legacy fixed one.
    const srng = window.FF.mulberry32((((sizeSeed === undefined ? 0xB07 : sizeSeed) >>> 0) + i * 2654435761) >>> 0);
    // Species deal FIRST (its multiplier feeds the body factory):
    // seeded grids field roughly 40% watermelon / 30% cantaloupe /
    // 30% honeydew, identical on every peer, per-daily casting.
    // Legacy (seedless) grids stay all-watermelon for suite stability.
    let fruit = 'watermelon';
    // An explicit CONFIG.botRoster names the field outright — one entry
    // per bot — bypassing the seeded species deal. Scalable: any future
    // "the grid is X, Y and three Zs" is a one-line config change.
    const roster = CONFIG.botRoster;
    let brainName = 'cruise';
    if (roster && roster.length) {
      // An entry is either a species string (every existing roster and
      // harness) or { fruit, brain } — backward compatible on purpose,
      // so naming a brain is a one-line roster edit rather than a
      // parallel array that can fall out of sync with it.
      const entry = roster[i % roster.length];
      if (entry && typeof entry === 'object') {
        fruit = entry.fruit || 'watermelon';
        brainName = entry.brain || 'cruise';   // per-slot override (harnesses)
      } else {
        fruit = entry;
      }
    } else if (sizeSeed !== undefined) {
      const rSp = srng(); // always drawn: stream position is sacred
      fruit = rSp < 0.3 ? 'cantaloupe' : rSp < 0.6 ? 'honeydew' : 'watermelon';
      if (fruit === 'cantaloupe' && !CONFIG.botCantaloupe) fruit = 'watermelon';
      if (fruit === 'honeydew' && !CONFIG.botHoneydew) fruit = 'watermelon';
    }
    const u = (srng() + srng()) / 2; // triangular: middles common, extremes rare
    const F = window.FF.FRUITS;
    const mult = (F && F[fruit] && F[fruit].sizeMult) || 1;
    const melon = createBody(x, y, (0.85 + u * 0.33) * mult, fruit);
    // The bot's PIGMENT: its own colour seed (pure arithmetic off the
    // race's cast seed — no srng draw, so the sacred stream and the
    // size deal are untouched), pushed through the species' anchor
    // band. Presentation data riding on the body, like the player's.
    const cseed = (((sizeSeed === undefined ? 0xB07 : sizeSeed) >>> 0) + Math.imul(i + 1, 2654435761)) >>> 0;
    if (window.FF.shading && window.FF.shading.anchorColor) {
      melon.bodyColor = window.FF.shading.anchorColor(fruit, (cseed ^ 0xC010A) >>> 0);
    } else if (typeof console !== 'undefined' && !resetBots._warned) {
      // Headless suites legitimately run without shading.js; a BROWSER
      // without it is a stale partial copy — say so LOUDLY, because
      // the visible symptom (legacy green bodies under correct species
      // patterns) looks like a colour bug, not a deployment one.
      resetBots._warned = true;
      console.warn('FF: shading.anchorColor missing — stale shading.js? Bots will wear legacy fallback greens.');
    }
    gridPlace(state, melon, g0 + i, x, y);
    melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
    state.bots.push({
      melon,
      prevMelon: { ...melon },
      // The brain drives this input every tick (physics.js pilot pass);
      // the values here are just its resting state.
      input: { rawAxis: 1, torqueAxis: 0, rawBounce: 0, bounceAxis: 0 },
      brain: (window.FF.pilot && window.FF.pilot.create) ? window.FF.pilot.create(brainName) : null,
      brainName,
    });
  }
}

// Called at the top of every physics step so the renderer can
// interpolate between the previous and current state.
function snapshotPrev(state) {
  for (const pl of state.players) {
    const gm = pl.melon, gp = pl.prevMelon;
    gp.x = gm.x; gp.y = gm.y; gp.angle = gm.angle;
  }
  for (const b of state.bots) {
    const gm = b.melon, gp = b.prevMelon;
    gp.x = gm.x; gp.y = gm.y; gp.angle = gm.angle;
  }
}

// Re-derive a body's physique at a given scale — the same laws
// createBody applies (volume mass, lamina inertia, tapered when the
// species tapers). Used to dress the player in their persistent
// melon's spec.
function setBodyScale(m, scale) {
  const sc = scale || 1;
  m.a = CONFIG.semiMajor * sc;
  m.b = m.a * fruitAspect(m.fruit);
  const taper = fruitTaper(m.fruit);
  m.taper = taper;
  if (taper) {
    const { mass, inertia, sh } = taperedMassInertia(m.a, m.b, taper);
    m.sh = sh;
    m.invM = 1 / mass;
    m.invI = 1 / inertia;
  } else {
    m.sh = 0;
    const mass = CONFIG.mass * (m.a * m.b * m.b) / REF_VOL;
    m.invM = 1 / mass;
    m.invI = 1 / (mass * (m.a * m.a + m.b * m.b) / 4);
  }
}

Object.assign(window.FF, { createState, resetMelon, resetPlayers, resetBots, snapshotPrev, setBodyScale });
})();