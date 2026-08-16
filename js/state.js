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
      // The tick the field was released (gridstart.js). Pace is
    // measured from here, not from the race's construction.
    goTick: null,
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
    // Grid pin: while set, x and y are held here (see gridstart.js).
    // null for every body outside the pre-race sequence.
    pinX: null,
    pinY: null,
    respawnAtTick: 0,  // tick at which a dead body revives
    protectTick: 0,    // smash-immune until tick exceeds this
    hitSeverity: 0,    // TOTAL terrain severity this step (all contacts)
    pairSeverity: 0,   // TOTAL melon-contact severity this step
    pairWorst: 0,      // the single worst pair blow (blame breadcrumbs ride it)
    hitNx: 0, hitNy: -1,   // escape normal of the worst terrain blow
    pairNx: 0, pairNy: -1, // escape normal of the worst rival blow
    hitJn: 0, pairJn: 0,   // raw impulse of those blows (the drama budget)
    // ---- The cluster ledger (damage.js clusterStep) ----
    // SIM STATE: a landing is judged as one event — dissipated energy
    // summed across its contact cluster — so the running ledger is as
    // integrated as a velocity. Clones (finish-line fast-forward, the
    // splat predictor) carry it via plain scalar copy; the resume
    // snapshot stores and restores it.
    clusterOpen: 0,    // 1 while a contact cluster is accumulating
    clusterE: 0,       // running severity total of the open cluster
    clusterN: 0,       // contact ticks in the open cluster
    clusterGround: 0,  // consecutive contact ticks (roll-on boundary)
    clusterAir: 0,     // contact-free ticks since last hit (gap boundary)
    clusterPairE: 0,   // the traffic share of the open cluster's total

    // ---- THE SCHEMA IS DECLARED, NOT ACCRETED (2026-08-13) --------
    // Every field the sim or presentation will EVER write on a body is
    // declared here, at neutral values, so all bodies share ONE hidden
    // class for the life of the page. These used to be bolted on
    // lazily by whichever system touched a body first — names.js added
    // name, physics added restitution and the flight ledger on first
    // use, racewatch added deathCount on first splat — in an order
    // that depended on WHAT HAPPENED to that body. To the JS engine,
    // property order is object identity: each ordering is a distinct
    // hidden class, so every race rebuild dealt fresh shape variants
    // into the hottest loops in the game (stepBody, the solvers, the
    // renderer's body pass), whose inline caches went megamorphic
    // after the first rebuild and never recovered for the life of the
    // page. Measured (2026-08-13, headless 4-leg cup): leg 1 settles
    // ~420ms/1000 ticks, legs 2-4 settle 590-720 — the SAME leg run
    // four times degrades identically, heap flat, invariant to leg
    // order and tick resets; with this block, all four legs settle
    // 310-360, flat forever AND ~25% faster than leg 1 ever was. This
    // was the "races 3 and 4 feel wrong until I refresh" bug: a
    // refresh hands the engine fresh caches. Field notes:
    //   * neutral values are chosen so every existing falsy-guard
    //     (`m.x || 0`, `=== undefined ? fallback`) behaves identically
    //   * flight anchors start at the SPAWN y, the value the launch
    //     edge would write on the first airborne tick anyway
    //   * restitution starts at the live neutral; stepBody overwrites
    //     it every tick a body steps, so this is a placeholder shape
    //     slot, never a stale physics value
    // ADDING A BODY FIELD? Declare it here first. A lazy write
    // elsewhere will still work — and will quietly re-open this bug.
    finishTick: null,        // stamped at the line (main.js observer)
    restitution: CONFIG.restitution, // the flare's product (physics, per tick)
    flareAxisAtHit: 0,       // certificate breadcrumb (physics)
    airTicks: 0,             // flight ledger (physics)
    flightTicks: 0,
    flightApexY: y,
    launchY: y,
    chainIndex: 0,
    lastFlightTicks: 0,
    lastFallPx: 0,
    hitRxn: 0,               // r x n at the worst blow (the spin term's lever)
    hitOmegaPre: 0,          // spin at that blow's approach
    recentPacePx: null,      // pace window (racewatch -> finish estimator)
    deathCount: 0,           // splats this race (racewatch -> estimator)
    name: '',                // the MELON's name — the character (roster.js)
    // THE PILOT: who is driving this body — a bot ('Bot Gary') or the
    // player (their username). A melon is a body; the pilot is the
    // brain that entered it. `name` used to carry both jobs, which is
    // why nothing could tell "the melon Gourdzilla" apart from
    // "whoever is racing it".
    pilot: '',
    // WHAT THIS MELON IS WEARING: [{ id, u, v, rot, s }] from decals.js.
    // Presentation only — nothing here can reach a physical law.
    decals: null,
    bodyColor: null,         // pigment (resetBots / the player's dressing)
    patKey: null,            // rind pattern key (the player's dressing)
    pairOtherName: '',       // traffic blame breadcrumbs (pair solver)
    pairOtherE: 0,
    pairIStiffened: false,
    pairShare: 0,
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
// Spawn height: the body's BOTTOM this far above the ground. Was 2 m
// (a visible drop onto the grid); now 0.25 m, so the field is already
// composed when the camera arrives rather than raining into place.
// Paired with the grid's y-pin (gridstart.js): while pinned the
// melons hold this height instead of settling, which keeps the row
// level on uneven terrain.
//
// The height is not only cosmetic: a hovering body has NO ground
// contact, so nothing opposes the motor and a revving melon spins to
// its limit, landing at GO with real speed. Lower hover means less
// drop time before the wheels bite, so the launch advantage shrinks
// with this number — measured below.
const GRID_DROP = 25;

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
//
// `cast` (optional) is an explicit field description — one entry per
// bot, from roster.js — and when present it is AUTHORITATIVE: species,
// scale, pigment, rind, melon name, pilot and brain all come from it,
// and the seeded deal below is skipped entirely. That is what makes
// the permanent cast permanent: Bot Gary's melon is the same body on
// every device, every day, because it was authored rather than dealt.
// Without a cast (harnesses, netplay, any caller that just wants
// bodies) the original seeded deal runs unchanged, so nothing that
// existed before this parameter behaves differently.
function resetBots(state, count, x, y, sizeSeed, gridStart, cast) {
  state.bots.length = 0;
  const g0 = gridStart === undefined ? 1 : gridStart;
  for (let i = 0; i < count; i++) {
    const entry = cast && cast[i];
    if (entry) {
      const F = window.FF.FRUITS;
      const fruit = entry.fruit || 'watermelon';
      const mult = (F && F[fruit] && F[fruit].sizeMult) || 1;
      const melon = createBody(x, y, (entry.scale || 1) * mult, fruit);
      melon.name = entry.melon || '';
      melon.pilot = entry.pilot || '';
      if (entry.color) melon.bodyColor = entry.color;
      if (entry.patKey) melon.patKey = entry.patKey;
      gridPlace(state, melon, g0 + i, x, y);
      melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
      state.bots.push({
        melon,
        prevMelon: { ...melon },
        input: { rawAxis: 0, torqueAxis: 0, rawBounce: 0, bounceAxis: 0 },
        brainName: entry.brain || 'cruise',
        brain: (window.FF.pilot && window.FF.pilot.create)
          ? window.FF.pilot.create(entry.brain || 'cruise') : null,
      });
      continue;
    }
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

// ---- THE IDENTITY OF RECORD (2026-08-14) --------------------------
// WHO a racer is, for anything that keys data: the PILOT. A melon is
// a body and can be swapped, renamed, or shared — a cup ranks
// competitors across four races, so keying its table by melon name
// would rank the fruit rather than the field.
//
// It is also the only key that cannot be broken by a player with a
// sense of humour: nothing stops someone naming their melon "The
// Rindfather", and any structure keyed on melon name would then merge
// them with Bot Gary into one row. Pilot names are unique by
// construction — the cast is authored, and the player is the only
// other pilot in a solo race.
//
// Falls back to the melon name for bodies that have no pilot yet
// (netplay peers, harness fields), so every caller gets a usable key
// without needing to know which kind of race it is in.
function racerKey(m) {
  return (m && (m.pilot || m.name)) || '?';
}

// ---- GRID ORDER (ruled 2026-08-16) ----------------------------------
// Slot each racer for the grid. keys = every racer's identity, in
// [players..., bots...] order; order = the previous leg's finishing
// order (keys, pole first), or null.
//
// No order (leg 1, practice, any fresh race): THE PLAYER STARTS LAST —
// the unknown entrant at the back of a field of eleven knowns — and
// the rest keep their relative order in the front slots. With an
// order: slot = finishing position, everyone, no special case; a key
// the order does not know (cast drift safety) appends behind the
// matched field, relative order kept.
function computeGridSlots(keys, order, playerIdx) {
  const n = keys.length;
  const slots = new Array(n).fill(-1);
  if (!order || !order.length) {
    let s = 0;
    for (let i = 0; i < n; i++) if (i !== playerIdx) slots[i] = s++;
    if (playerIdx >= 0 && playerIdx < n) slots[playerIdx] = n - 1;
    return slots;
  }
  const rank = new Map();
  order.forEach((k, i) => { if (!rank.has(k)) rank.set(k, i); });
  const matched = [], unmatched = [];
  for (let i = 0; i < n; i++) {
    if (rank.has(keys[i])) matched.push(i); else unmatched.push(i);
  }
  matched.sort((a, b) => rank.get(keys[a]) - rank.get(keys[b]));
  let s = 0;
  for (const i of matched) slots[i] = s++;
  for (const i of unmatched) slots[i] = s++;
  return slots;
}

// Re-place every body by the given slots (same [players..., bots...]
// indexing as computeGridSlots). prev snapshots re-sync so the first
// drawn frame cannot interpolate a body across the grid.
function applyGridSlots(state, slots, lineX, fallbackY) {
  const all = state.players.concat(state.bots);
  for (let i = 0; i < all.length && i < slots.length; i++) {
    gridPlace(state, all[i].melon, slots[i], lineX, fallbackY);
    Object.assign(all[i].prevMelon, all[i].melon);
  }
}


// Namespace registration (classic scripts, no modules).
window.FF = window.FF || {};
Object.assign(window.FF, { createState, resetMelon, resetPlayers, resetBots, snapshotPrev, setBodyScale, racerKey, computeGridSlots, applyGridSlots });
})();