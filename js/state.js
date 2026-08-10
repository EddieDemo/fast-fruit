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
      rawAxis: 0,     // instantaneous intent: -1 (left), 0, +1 (right)
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
  // a dragon ball is a sphere. Everything downstream (collider,
  // curvature, mass, inertia, debris, renderer) already reads a/b per
  // body, so a new shape needs no changes anywhere else.
  const aspect = fruitAspect(species);
  const a = CONFIG.semiMajor * sc;
  const b = a * aspect;
  // Density-normalized against the reference ellipse, so mass still
  // follows real volume (a*b^2) whatever the shape.
  const mass = CONFIG.mass * (a * b * b) / REF_VOL;
  const inertia = mass * (a * a + b * b) / 4;
  return {
    a, b,
    fruit: species,      // registry tag: shape, palette and pulp
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

// Set up `count` human players in canonical slot order. Slot 0 spawns
// at (x, y); further slots cascade up-and-behind like bots. localSlot
// picks which player this machine controls; aliasLocalInput wires the
// UI input object straight into that player (solo/back-compat path) —
// netplay passes false and feeds ALL inputs from the lockstep buffer.
function resetPlayers(state, count, localSlot, x, y, aliasLocalInput) {
  state.players.length = 0;
  for (let i = 0; i < count; i++) {
    const melon = createBody(x - 46 * i, y - 92 * i);
    melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
    state.players.push({
      melon,
      prevMelon: { ...melon },
      input: { rawAxis: 0, torqueAxis: 0 },
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

// Spawn `count` bots in a diagonal cascade up-and-behind the player
// spawn: spaced so no pair overlaps at rest, clear of the back wall,
// and they tumble down onto the runway as the race starts.
function resetBots(state, count, x, y, sizeSeed) {
  state.bots.length = 0;
  // Horizontal spacing adapts to the pack size: the endless-mode wall
  // face sits ~420px behind spawn, and every bot must land in front of
  // it. Diagonal spacing stays >= ~95px so no pair overlaps at rest.
  const dx = Math.min(60, 370 / Math.max(count, 1));
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
    if (roster && roster.length) {
      fruit = roster[i % roster.length];
    } else if (sizeSeed !== undefined) {
      const rSp = srng(); // always drawn: stream position is sacred
      fruit = rSp < 0.3 ? 'cantaloupe' : rSp < 0.6 ? 'honeydew' : 'watermelon';
      if (fruit === 'cantaloupe' && !CONFIG.botCantaloupe) fruit = 'watermelon';
      if (fruit === 'honeydew' && !CONFIG.botHoneydew) fruit = 'watermelon';
    }
    const u = (srng() + srng()) / 2; // triangular: middles common, extremes rare
    const F = window.FF.FRUITS;
    const mult = (F && F[fruit] && F[fruit].sizeMult) || 1;
    const melon = createBody(x - dx * (i + 1), y - 90 * (i + 1), (0.85 + u * 0.33) * mult, fruit);
    melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
    state.bots.push({
      melon,
      prevMelon: { ...melon },
      input: { rawAxis: 1, torqueAxis: 0 }, // hold right, forever
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
// createBody applies (volume mass, lamina inertia). Used to dress the
// player in their persistent melon's spec.
function setBodyScale(m, scale) {
  const sc = scale || 1;
  m.a = CONFIG.semiMajor * sc;
  m.b = m.a * fruitAspect(m.fruit);
  const mass = CONFIG.mass * (m.a * m.b * m.b) / REF_VOL;
  m.invM = 1 / mass;
  m.invI = 1 / (mass * (m.a * m.a + m.b * m.b) / 4);
}

Object.assign(window.FF, { createState, resetMelon, resetPlayers, resetBots, snapshotPrev, setBodyScale });
})();
