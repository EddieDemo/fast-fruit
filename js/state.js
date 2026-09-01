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
    bots: [],
    props: [],            // track furniture: bodies without seats (27j) // filled by resetBots: { melon, prevMelon, input }

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
      fwd: 1,          // travel sign at the focus: +1 right, -1 left
                       // (the camera NEVER rotates — ruled 2026-08-17)
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
function speciesAspect(species) {
  const F = window.FF.OBJECTS;
  return (F && F[species] && F[species].aspect) || (CONFIG.semiMinor / CONFIG.semiMajor);
}
function speciesTaper(species) {
  const F = window.FF.OBJECTS;
  return (F && F[species] && F[species].taper) || 0;
}
// THE SHAPE TAG (Law 1, rectangular props 2026-08-28): shape dispatch
// is on an EXPLICIT tag, never on field presence. `taper` remains a
// PHYSICAL parameter — the egg's mass, support and boundary all use
// its value — it simply stops being the thing that selects a branch.
// Default 'ellipse'; a registry entry declaring `taper` without a
// shape still resolves to 'egg', so the tag can never contradict the
// physique of a body that predates it.
function speciesShape(species) {
  const F = window.FF.OBJECTS;
  const s = F && F[species] && F[species].shape;
  if (s) return s;
  return speciesTaper(species) ? 'egg' : 'ellipse';
}
// Vertex list for a polygon species, in registry units (px at
// sizeMult 1). Returned raw; derivePhysique is the ONLY caller and it
// normalises (see polyPhysique).
function speciesPoly(species) {
  const F = window.FF.OBJECTS;
  return (F && F[species] && F[species].poly) || null;
}
// THE PHYSICAL ANNEX, third entry (ruled 2026-08-26): DENSITY is a
// SPECIES CONSTANT — intrinsic, never varying with an individual's
// size. mass = density x volume (x the melon calibration): two beach
// balls of different sizes share one density and differ in mass by
// volume alone. Unit: relative to the implicit melon density
// (CONFIG.mass / REF_VOL is the 1.0) — and a real watermelon is
// roughly water, so real-world relative densities port straight in.
// Default 1.0, and x1.0 is bit-exact: every pre-annex body's mass is
// unchanged to the bit (suite-held).
function speciesDensity(species) {
  const F = window.FF.OBJECTS;
  const d = F && F[species] && F[species].density;
  return d === undefined ? 1 : d;
}
// A species' hull GENERATOR spec (boulders): { R, sidesMin, sidesMax }.
// Absent = the species uses a fixed vertex list, as every poly
// species did before boulders.
function speciesHullGen(species) {
  const F = window.FF.OBJECTS;
  return (F && F[species] && F[species].hullGen) || null;
}
// Side count from the SAME seed, on its own stream offset so that
// changing the side range cannot shift the vertex stream (the two
// draws stay independent — the stream is sacred).
function hullSides(gen, hullSeed) {
  const lo = gen.sidesMin || 6, hi = gen.sidesMax || 8;
  if (hi <= lo) return lo;
  const r = window.FF.mulberry32(((hullSeed >>> 0) ^ 0x5EED51DE) >>> 0);
  return lo + Math.floor(r() * (hi - lo + 1));
}
function speciesToughnessMult(species) {
  const F = window.FF.OBJECTS;
  const t = F && F[species] && F[species].toughnessMult;
  return t === undefined ? 1 : t;
}
function speciesRestitutionFloor(species) {
  const F = window.FF.OBJECTS;
  return (F && F[species] && F[species].restitutionFloor) || 0;
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
function taperedMassInertia(a, b, taper, _density) {
  if (_density === undefined) _density = 1;
  const mass = CONFIG.mass * (a * b * b) / REF_VOL * (1 + taper * taper / 5) * _density;
  const sh = a * taper / 4;
  const inertia = mass * ((a * a + b * b * (1 + taper * taper / 2)) / 4 - sh * sh);
  return { mass, inertia, sh };
}

// ---- POLYGON PHYSIQUE (rectangular props, phase 1) ----------------
// Closed form over a convex polygon, uniform lamina. Standard
// signed-triangle formulae, summed over edges (v_i -> v_i+1):
//   2A     = SUM cross_i
//   C      = (1/(6A)) SUM (v_i + v_i+1) * cross_i
//   J_o/A  = (1/12) SUM cross_i (v_i.v_i + v_i.v_i+1 + v_i+1.v_i+1)
//   J_com  = J_o - A|C|^2                      (parallel axis)
// Returned already CENTRED on the COM and in canonical winding
// (positive area, i.e. counter-clockwise in maths axes / clockwise on
// screen since y is down). Both normalisations happen HERE, once, so
// no downstream reader ever has to ask whether a vertex list is raw:
// ambiguity about that is how contact normals end up inverted.
//
// THE VOLUME CONVENTION (stated, 2026-08-28). Mass follows the
// VOLUME law like every other body; the polygon is treated as a PRISM
// whose depth equals its y-extent, the same "square cross-section"
// reading that makes the ellipse a spheroid revolved about its major
// axis. The ellipse's factor a*b^2 is its spheroid volume less the
// common 4pi/3; the prism's volume is (2hx)(2hy)(2hz) with hz = hy,
// so the comparable factor is 8*hx*hy^2 * 3/(4pi). One convention,
// applied to both families; REF_VOL still normalises the melon to
// CONFIG.mass exactly.
// ---- BOULDER HULLS: PER-INSTANCE GEOMETRY (phase 1, 2026-08-30) ---
// Ruled by Eddie: boulders are slightly irregular convex 6-8 gons, no
// two alike, and they are FRAGMENTS OF THE TERRAIN in the lore.
//
// CONVEXITY IS A LOAD-BEARING PROMISE, NOT A HOPE. Every consumer of
// a hull assumes convex: SAT (polyVsPoly), the affine melon cell, the
// egg's per-edge cell, and the terrain sweep. A concave hull does not
// crash any of them — it produces WRONG CONTACTS QUIETLY, which is
// the worst failure this codebase has a name for.
//
// THE CHECK IS THE GUARANTEE. The first draft of this comment argued
// convexity "by construction" from a bound on the radius band — that
// argument was WRONG and the measurement said so: the angular jitter
// can push two vertices closer than the even spacing the arithmetic
// assumed, so a short vertex between two long ones can still go
// reflex. Measured at the shipped parameters: 359 of 24000 hulls
// (1.5%) are born concave. They are CAUGHT and replaced by the convex
// hull of the same points. What the construction actually buys is
// rarity, not safety.
//
// THE FALLBACK IS BOUNDED, and that is measured too: hulling drops at
// most one vertex (24000-seed sweep: 7->6 thirty-eight times, 8->7
// three hundred and twenty, 8->6 once, and n=6 never falls back at
// all), so every boulder stays inside Eddie's ruled 6-8 sides. A
// tighter band WOULD cut the fallback rate, and was rejected on
// measurement: at jitter 1/5 and band 0.88-1.12 the rate falls to 1
// in 12000 but the face-length ratio climbs from 0.47 to 0.64 —
// rounder, more regular rocks with fewer SMALL faces, and small faces
// are exactly what Eddie's tipping ruling needs.
//
// FACE SIZE IS A GAMEPLAY PARAMETER, not decoration (Eddie's tipping
// ruling): a boulder resting on a SMALL face is unsteady and can be
// tipped by a fast melon; one with no small faces never can. The
// radial band is therefore a physics dial, and the suite measures the
// face-length spread it produces.
const BOULDER_R_LO = 0.86, BOULDER_R_HI = 1.14;
const BOULDER_ANG_JITTER = 1 / 3;   // fraction of the even spacing

function hullOf(pts) {
  // Monotone chain. Deterministic: ties break on the sort's own
  // total order (x then y), never on input order.
  const P = pts.slice().sort((u, v) => (u[0] - v[0]) || (u[1] - v[1]));
  if (P.length < 3) return P;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function isConvex(verts) {
  const n = verts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n], c = verts[(i + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr === 0) continue;              // collinear: no information
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

// seed -> vertex list, in registry units (px before scale). The
// caller owns the seed; the same seed is the same boulder forever.
function boulderHull(seed, R, nSides) {
  const r = window.FF.mulberry32(seed >>> 0);
  const n = Math.max(3, nSides | 0);
  const step = 2 * Math.PI / n;
  const verts = [];
  for (let i = 0; i < n; i++) {
    // THE STREAM IS SACRED: both draws happen for every vertex, in
    // the same order, whatever the values are used for.
    const jitter = (r() - 0.5) * 2 * BOULDER_ANG_JITTER * step;
    const rad = R * (BOULDER_R_LO + (BOULDER_R_HI - BOULDER_R_LO) * r());
    const t = i * step + jitter;
    verts.push([rad * Math.cos(t), rad * Math.sin(t)]);
  }
  if (isConvex(verts)) return verts;
  boulderHull._fellBack = (boulderHull._fellBack || 0) + 1;
  return hullOf(verts);
}
window.FF.boulderHull = boulderHull;
window.FF._isConvex = isConvex;
window.FF._hullOf = hullOf;


const PRISM_K = 3 / (4 * Math.PI) * 8;   // prism factor -> ellipse's units
function polyPhysique(verts, scale, _density) {
  if (_density === undefined) _density = 1;
  // Scale into body units first: every quantity below is then in px.
  const P = [];
  for (let i = 0; i < verts.length; i++) {
    P.push([verts[i][0] * scale, verts[i][1] * scale]);
  }
  let A2 = 0, cx = 0, cy = 0, J = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const cr = p[0] * q[1] - q[0] * p[1];
    A2 += cr;
    cx += (p[0] + q[0]) * cr;
    cy += (p[1] + q[1]) * cr;
    J += cr * (p[0] * p[0] + p[0] * q[0] + q[0] * q[0]
      + p[1] * p[1] + p[1] * q[1] + q[1] * q[1]);
  }
  // CANONICAL WINDING: a clockwise list gives negative area. Reverse
  // it and re-derive rather than taking absolute values — the sign
  // must leave the list, not just the scalars, or a face normal
  // computed downstream still points inward.
  if (A2 < 0) {
    P.reverse();
    A2 = -A2; cx = -cx; cy = -cy; J = -J;
  }
  const area = A2 / 2;
  const comX = cx / (3 * A2), comY = cy / (3 * A2);
  const Jo = J / 12;                              // area moment about origin
  const Jcom = Jo - area * (comX * comX + comY * comY);
  // Re-centre on the COM: the solver's lever arms and invI are only
  // ever honest about the mass centre (the same law the egg's `sh`
  // exists to satisfy).
  const poly = [];
  let hx = 0, hy = 0, circum = 0;
  for (let i = 0; i < P.length; i++) {
    const vx = P[i][0] - comX, vy = P[i][1] - comY;
    poly.push([vx, vy]);
    if (Math.abs(vx) > hx) hx = Math.abs(vx);
    if (Math.abs(vy) > hy) hy = Math.abs(vy);
    const r = Math.sqrt(vx * vx + vy * vy);
    if (r > circum) circum = r;
  }
  const mass = CONFIG.mass * (PRISM_K * hx * hy * hy) / REF_VOL * _density;
  const inertia = mass * (Jcom / area);   // lamina: I/m = J_com / A
  return { poly, mass, inertia, a: hx, b: hy, boundR: circum, area };
}

// ---- THE ONE PHYSIQUE DOOR ----------------------------------------
// createBody and setBodyScale both derive a body's physique, and used
// to do it with two copies of the same arithmetic. A shape family is
// exactly the kind of addition that leaves one copy behind (the
// buildLapTemplate lesson: a private copy of the chunk vocabulary
// meant a whole rework never reached races). One function; the fork
// cannot open.
//
// `boundR` is given to EVERY body, not just polygons: the broad phase
// then reads one field unconditionally instead of branching. For the
// smooth families it is exactly today's expression, a * (1 + taper),
// so the change is numerically inert — which the bit-identity gate
// proves rather than assumes.
// hullSeed (2026-08-30, boulders phase 1): an OPTIONAL per-instance
// geometry seed. A species whose registry entry carries `hullGen`
// grows its vertices from this seed instead of a fixed vertex list,
// so no two boulders are alike. Absent seed or absent hullGen = the
// shipped path, untouched, which the gates prove rather than assume.
function derivePhysique(species, scale, hullSeed) {
  const sc = scale || 1;
  const shape = speciesShape(species);
  const _density = speciesDensity(species);
  if (shape === 'poly') {
    const gen = speciesHullGen(species);
    const verts = (gen && hullSeed !== undefined && hullSeed !== null)
      ? boulderHull(hullSeed, gen.R, hullSides(gen, hullSeed))
      : speciesPoly(species);
    if (verts && verts.length >= 3) {
      const p = polyPhysique(verts, sc, _density);
      return { shape, a: p.a, b: p.b, taper: 0, sh: 0, poly: p.poly,
        boundR: p.boundR, mass: p.mass, inertia: p.inertia };
    }
    // A species tagged 'poly' with no usable vertex list is an
    // authoring error, not a shape. Fall through to the ellipse so a
    // typo is a wrong-looking body, never a crash — the registry's
    // standing habit (devSpecies) — and say so once.
    if (!derivePhysique._warned) {
      derivePhysique._warned = true;
      console.warn('derivePhysique: poly species with no vertices:', species);
    }
  }
  const aspect = speciesAspect(species);
  const taper = speciesTaper(species);
  const a = CONFIG.semiMajor * sc;
  const b = a * aspect;
  const boundR = a * (1 + taper);
  if (taper) {
    const { mass, inertia, sh } = taperedMassInertia(a, b, taper, _density);
    return { shape: 'egg', a, b, taper, sh, poly: null, boundR, mass, inertia };
  }
  const mass = CONFIG.mass * (a * b * b) / REF_VOL * _density;
  return { shape: 'ellipse', a, b, taper: 0, sh: 0, poly: null, boundR,
    mass, inertia: mass * (a * a + b * b) / 4 };
}

// THE DEV OVERRIDE, resolved in ONE place (fixed 2026-08-27c).
// It shipped honouring only createBody — but the frame loop's design
// path re-applies the player's SAVED species every frame and stomped
// it, and the bot paths computed sizeMult from the pre-override name,
// so an overridden body would have worn the wrong scale. Every site
// that resolves a species now asks here. Registered-only: a typo
// falls through, never a crash.
function devSpecies(name) {
  const ov = window.FF.DEV_FIELD_SPECIES;
  return (ov && window.FF.OBJECTS && window.FF.OBJECTS[ov]) ? ov : name;
}
// THE UNIFORM LAW (ruled 2026-08-27f): under the override every body
// is THAT species — "not a version of the beachball with certain
// characteristics of themselves carried over" (Eddie). One canonical
// scale (1 x sizeMult), one pigment (the species anchor at one fixed
// seed). The device found the gap: roster bodies kept their authored
// melon greens and per-character scales — a field of green,
// different-sized "beach balls".
const DEV_SPECIES_SEED = 0xB07;
function devPigment(species) {
  const SH = window.FF.shading;
  return (SH && SH.anchorColor) ? SH.anchorColor(species, DEV_SPECIES_SEED) : null;
}

// THE SPECIES APPLIER: wearing a species means wearing its BODY —
// species tag AND its sizeMult-scaled physique. Idempotent via
// _appliedSpecies, so the frame loop calls it freely; returns true
// only when it actually changed something. Exported because main's
// design path is a frame loop that no headless suite can drive: this
// is the real door BOTH the game and the suite go through.
function applySpeciesDesign(melon, wantRaw, baseScale) {
  const want = devSpecies(wantRaw || melon.species);
  const overridden = !!devSpecies(null);
  // THE OUTFIT FOLLOWS THE BODY (ruled 2026-08-27e): under the dev
  // override a saved wrap is your MELON's outfit, not this body's —
  // a beach ball in a national flag is unreadable (you cannot tell
  // whether the gores are lighting correctly under a wrap). Stashed,
  // not destroyed: clearing the flag restores it. Purely a dev-dial
  // behaviour; normal decal law is untouched.
  if (overridden && melon.decals) {
    melon._decalsStash = melon.decals;
    melon.decals = null;
  } else if (!overridden && melon._decalsStash) {
    melon.decals = melon._decalsStash;
    melon._decalsStash = null;
  }
  if (!want || melon._appliedSpecies === want) return false;
  const F = window.FF.OBJECTS;
  melon.species = want;
  const mult = (F && F[want] && F[want].sizeMult) || 1;
  // Uniform law: the override ignores the personal physique scale.
  setBodyScale(melon, (overridden ? 1 : (baseScale || 1)) * mult);
  if (overridden) {
    if (melon._pigmentStash === undefined) melon._pigmentStash = melon.bodyColor || null;
    const pig = devPigment(want);
    if (pig) melon.bodyColor = pig;
  } else if (melon._pigmentStash !== undefined) {
    melon.bodyColor = melon._pigmentStash;
    melon._pigmentStash = undefined;
  }
  melon._appliedSpecies = want;
  return true;
}

function createBody(x, y, scale, fruit) {
  const sc = scale || 1;
  const species = devSpecies(fruit || 'watermelon');
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
  const ph = derivePhysique(species, sc);
  const { a, b, taper, sh, mass, inertia } = ph;
  return {
    a, b,
    species: species,      // registry tag: shape, palette and pulp
    shape: ph.shape,     // EXPLICIT dispatch tag (Law 1): 'ellipse' | 'egg' | 'poly'
    poly: ph.poly,       // COM-centred, canonically wound; null for smooth bodies
    boundR: ph.boundR,   // broad-phase bound, every family (see derivePhysique)
    taper,               // physical parameter, NOT the shape selector
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
    // THE CONTACT BREADCRUMB (derby stage 3, blessed 2026-08-26):
    // neutral sim telemetry in the flightTicks mold — WHO last
    // touched this body (CANONICAL INDEX: player first, bots in
    // spawn order — physics refreshes canonIdx every step), and
    // when. The first cut stamped racerKey and the suite caught the
    // class: keys are names, names can collide, and a colliding
    // breadcrumb credits SOMEBODY — a signal that cannot say "I
    // don't know". The index is unique by construction. Stamped by
    // the pair pass on real contact; read by mode law (fatal-blow
    // attribution), never by physics itself. Plain scalars.
    canonIdx: -1,
    lastContactIdx: -1,
    lastContactTick: -1,
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
const METRE = window.FF.CONFIG.pxPerMetre;   // world px per metre (one source)
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
  // The SPINE answers surface questions (stage 2). No spine yet
  // (boot-time createState, bare suite worlds): keep the caller's y,
  // exactly as the old null return did.
  // Since stage 3 the x-keyed question carries a reference y — the
  // apron is x-monotone, so the projection foot IS the surface at gx.
  const sp = (state.spine && state.spine.projectPoint)
    ? state.spine.projectPoint(gx, fallbackY) : null;
  melon.y = sp === null ? fallbackY : sp.y - melon.b - GRID_DROP;
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
      const F = window.FF.OBJECTS;
      const ovB = devSpecies(null);
      const fruit = devSpecies(entry.species || 'watermelon');
      const mult = (F && F[fruit] && F[fruit].sizeMult) || 1;
      // Uniform law under the override: the authored per-character
      // scale and pigment belong to a body that is not here.
      const melon = createBody(x, y, ovB ? mult : (entry.scale || 1) * mult, fruit);
      melon.name = entry.melon || '';
      melon.pilot = entry.pilot || '';
      if (entry.color && !ovB) melon.bodyColor = entry.color; // (!ovB is belt-and-braces: the uniform write below also wins — M66 equivalent-mutant record)
      if (ovB) melon.bodyColor = devPigment(fruit) || melon.bodyColor;
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
        fruit = entry.species || 'watermelon';
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
    const F = window.FF.OBJECTS;
    fruit = devSpecies(fruit);
    const ovB = devSpecies(null);   // uniform law: draw u regardless
    // (the stream is sacred), ignore it under the override.
    const mult = (F && F[fruit] && F[fruit].sizeMult) || 1;
    const melon = createBody(x, y, (ovB ? 1 : (0.85 + u * 0.33)) * mult, fruit);
    // The bot's PIGMENT: its own colour seed (pure arithmetic off the
    // race's cast seed — no srng draw, so the sacred stream and the
    // size deal are untouched), pushed through the species' anchor
    // band. Presentation data riding on the body, like the player's.
    const cseed = (((sizeSeed === undefined ? 0xB07 : sizeSeed) >>> 0) + Math.imul(i + 1, 2654435761)) >>> 0;
    if (window.FF.shading && window.FF.shading.anchorColor) {
      melon.bodyColor = window.FF.shading.anchorColor(fruit,
        ovB ? DEV_SPECIES_SEED : (cseed ^ 0xC010A) >>> 0);
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
// TRACK FURNITURE (ruled 2026-08-27j): props are BODIES WITHOUT
// SEATS — state.props, their own list (never bots: 52 sites assume
// state.bots means racers, and threading an exception through all of
// them forever is how a beach ball reaches a podium). A prop:
//  - joins the physics (bodyList + canonIdx, appended AFTER players
//    and bots so no existing index ever shifts — breadcrumbs and
//    path hashes are untouched by construction);
//  - is excluded from everything else BY LIST MEMBERSHIP: standings,
//    respawns, spectate, tags, puffs all enumerate players+bots and
//    simply never see it. Exclusion is free; only inclusion is code.
//  - does not respawn: knocked off the world is GONE (ruled);
//  - places from a SALTED stream derived from the track seed — never
//    the generator's own sequence, so terrain geometry is
//    bit-identical with furniture on or off (suite-held);
//  - kills as ENVIRONMENT WITH FLAVOUR: the pair pass stamps its
//    canonIdx like anyone's; the death site resolves a prop-shoved
//    death to m.deathByProp (the comedy is the point).
function mintFurniture(state, trackSeed, lapArc, spawnX, restSites, flatSites) {
  state.props = [];
  if (!window.FF.CONFIG.spawnFurniture) return;
  const FCFG = window.FF.CONFIG.furniture;
  const arc = lapArc || 40000;
  const FOB = window.FF.OBJECTS;
  // SEPARATION IS GLOBAL, not per species (phase 3): a box resting
  // against a beach ball clips exactly as badly as two balls do. One
  // claimed list spans the whole mint. The ball is minted first and
  // starts from an empty list, so its placements are bit-unmoved; a
  // later species is the one that must yield.
  const claimed = [];
  // ONE KIND AT A TIME, each off its OWN salted stream (phase 3). The
  // loop is the only new thing: the body of it is the ball's law
  // verbatim, so the ball's draws — count, shuffle, pigment, in that
  // order — land on exactly the numbers they did before.
  for (const kind of FCFG.kinds) {
    if (!FOB || !FOB[kind.species]) continue;   // unregistered: not a crash
    // STATED-TEMPORARY disable (2026-08-30): a disabled kind is
    // skipped BEFORE its stream is opened — zero draws, so every
    // other kind's deal is bit-unmoved, and re-enabling deals the
    // disabled kind's own numbers exactly as it always did.
    if (kind.disabled) continue;
    // The salted stream: same track, same spots, forever; and zero
    // draws from any stream the generator owns. DRAW ORDER IS LAW:
    // COUNT, then the shuffle, then per-prop pigment — reordering the
    // draws re-rolls every track. PER SPECIES since phase 3, so a new
    // prop species can never disturb an existing one's placements.
    const rng = window.FF.mulberry32(((trackSeed >>> 0) ^ kind.salt) >>> 0);
    // WAKE CANDIDATES (ruled 2026-08-27k): the dice are ALL thrown at
    // mint — N candidate ARCS in the mid-lap band, sorted ascending so
    // the walk meets them in travel order. Arc, not x: terrain
    // STREAMS, and "the ground at x" is multivalued under a fold —
    // spine.surfaceAt(s) is single-valued on the riding surface, walls
    // skipped, the same convention the respawn fallback trusts. (The
    // v311 mint added an arc fraction to a world X — the ball could
    // sit over void at build and fall off the world; module suites on
    // a flat infinite poly could not see it.)
    //
    // CANDIDATES ARE THE SPECIES' OWN SITES (phase 3). A sphere takes
    // REST SITES: dips the world holds a body in, computed from the
    // lap template at provider construction. An arbitrary arc is
    // usually a HILLSIDE — a ball placed there rolls away long before
    // anyone arrives (measured: 1360-1662 px/s, gone from the streamed
    // window in 12-15 s), which is why furniture was never met on
    // device. A box takes FLAT SITES, and refuses any run shorter than
    // its own footprint: a dip would make it bridge the vee and rock
    // on two corners. Either way the ordinary solver holds it — no
    // pin, no drag, no exemption. What happens AFTER the first strike
    // is the game's, not ours.
    const source = kind.sites === 'flat' ? (flatSites || []) : (restSites || []);
    // FOOTPRINT: derived, never guessed. The run must hold the whole
    // body with room either side.
    const ph = window.FF.derivePhysique(kind.species,
      (FOB[kind.species].sizeMult) || 1);
    const footprint = ph.boundR * 2 + FCFG.wakeGap * 2;
    const band = source.filter((q) =>
      q.s > 0.15 * arc && q.s < 0.9 * arc      // never on the grid or the closer
      && (q.len === undefined || q.len >= footprint));
    // HOW MANY: the count is the FIRST draw off the stream.
    const count = kind.countMin
      + Math.floor(rng() * (kind.countMax - kind.countMin + 1));
    // THE DEAL. One shuffled walk of the band, sites handed out
    // round-robin so no two props ever share a site or a fallback —
    // and a claimed site is refused if it sits within minSeparation of
    // one already taken, so two resting props cannot clip. Props MAY
    // end up neighbours; they may not overlap. When sites run short
    // the later props simply get fewer candidates (and at worst one),
    // which the wake walk already tolerates.
    // Per-kind fallback cap (2026-08-30): claims are GLOBAL, so a
    // deep candidate list is a land grab — capped kinds leave the
    // band shareable. Absent, the old FCFG.candidates rules and the
    // list assembly is bit-identical (the ball is unmoved).
    const capN = kind.candidatesCap || FCFG.candidates;
    const lists = [];
    for (let i = 0; i < count; i++) lists.push([]);
    if (band.length) {
      const pool = band.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      let turn = 0;
      for (const site of pool) {
        if (lists.every((l) => l.length >= capN)) break;
        let clash = false;
        for (const c of claimed) {
          if (Math.abs(c - site.s) < kind.minSeparation) { clash = true; break; }
        }
        if (clash) continue;
        // round-robin to the next prop still short of a full list
        let guard = 0;
        while (lists[turn % count].length >= capN && guard++ < count) turn++;
        lists[turn % count].push(site.s);
        claimed.push(site.s);
        turn++;
      }
    }
    // STATED FALLBACK, PER KIND. A 'rest' species with no sites falls
    // back to the old band draw — honest about being a hillside, and
    // no real track lands there (8 seeds, 30-45 sites each, none
    // barren). A 'flat' species does NOT: the entire point of a flat
    // site is that a box on a slope is wrong, so a box with no run to
    // stand on simply is not minted. Inventing a home would contradict
    // the law that chose the site source in the first place.
    if (kind.sites === 'flat') {
      for (let i = lists.length - 1; i >= 0; i--) {
        if (lists[i].length < 1) lists.splice(i, 1);
      }
    } else {
      for (const list of lists) {
        while (list.length < 1) list.push((0.25 + rng() * 0.6) * arc);
      }
    }
    for (const cands of lists) {
      cands.sort((a, b) => a - b);
      // THE STACK DEAL (2026-08-30, authored stacks ruling). DRAW
      // ORDER IS LAW for this kind's stream: after count and the
      // shuffle above, each stack draws its TIER COUNT, then one
      // pigment per tier, in tier order. A non-stack kind draws
      // exactly what it always drew (tiers = 1, no tier draw).
      const tiers = kind.stackMin
        ? kind.stackMin + Math.floor(rng() * (kind.stackMax - kind.stackMin + 1))
        : 1;
      let base = null;
      for (let tier = 0; tier < tiers; tier++) {
        // Minted DORMANT: a record, parked far above the void it must
        // never touch — no stepping, no bodyList, no render until the
        // wake law (physics.js tryWakeProp) places it against streamed
        // ground. The placement solve happens ONLY at wake time.
        const p = createBody((spawnX || 0), -100000,
          (FOB[kind.species].sizeMult) || 1, kind.species);
        p.dormant = true;
        if (tier === 0) {
          // The BASE owns the wake walk and probes clearance for the
          // WHOLE column (it knows its height via stackTiers).
          p.wake = { cands, idx: 0 };
          p.stackTiers = tiers;
          base = p;
        } else {
          // Upper tiers carry no walk: they wake the same tick the
          // base does, placed relative to the base's wake pose
          // (tryWakeProp's stackBase branch). Same-tick is
          // GUARANTEED by list order — the base is minted first, so
          // the wake sweep clears its dormant flag before any tier
          // asks.
          p.stackBase = base;
          p.stackTier = tier;
        }
        p.name = kind.name;
        // The furniture's pigment: the species anchor, seeded from the
        // SAME salted stream (the seed owns the colour, one per prop —
        // one per TIER for a stack).
        if (window.FF.shading && window.FF.shading.anchorColor) {
          p.bodyColor = window.FF.shading.anchorColor(kind.species,
            (rng() * 0xFFFFFFFF) >>> 0);
        }
        // PER-INSTANCE GEOMETRY (boulders, phase 2). The hull seed is
        // PURE ARITHMETIC off this kind's own salted seed and the
        // prop's index — NO rng() draw. That is deliberate and it is
        // the bot-pigment pattern: a draw here would sit inside a
        // stream whose order is law, and every kind minted after a
        // boulder would deal different numbers the day the side range
        // changed. Arithmetic disturbs nothing, and the seed is still
        // "same track, same boulders, forever".
        if (speciesHullGen(kind.species)) {
          p.hullSeed = (((trackSeed >>> 0) ^ kind.salt)
            + Math.imul(state.props.length + 1, 2654435761)) >>> 0;
          // Re-derive: createBody above ran before the seed existed,
          // so its hull is the registry fallback. One door
          // (setBodyScale) recomputes vertices, mass, inertia and
          // boundR together — they must never disagree.
          setBodyScale(p, (FOB[kind.species].sizeMult) || 1);
        }
        p.pilot = '';
        p.isProp = true;
        p.input = { rawAxis: 0, rawBounce: 0, torqueAxis: 0, bounceAxis: 0,
          hopEligible: false, hopPending: 0, hopBuffer: 0 };
        state.props.push(p);
      }
    }
  }
}

function snapshotPrev(state) {
  for (const pl of state.players) {
    const gm = pl.melon, gp = pl.prevMelon;
    gp.x = gm.x; gp.y = gm.y; gp.angle = gm.angle;
  }
  for (const b of state.bots) {
    const gm = b.melon, gp = b.prevMelon;
    gp.x = gm.x; gp.y = gm.y; gp.angle = gm.angle;
  }
  for (const p of state.props || []) {
    if (!p.prev) p.prev = { x: p.x, y: p.y, angle: p.angle };
    p.prev.x = p.x; p.prev.y = p.y; p.prev.angle = p.angle;
  }
}

// Re-derive a body's physique at a given scale — the same laws
// createBody applies (volume mass, lamina inertia, tapered when the
// species tapers). Used to dress the player in their persistent
// melon's spec.
function setBodyScale(m, scale) {
  // m.hullSeed carries per-instance geometry when the species grows
  // its own hull; undefined for every other body, which is the
  // shipped path.
  const ph = derivePhysique(m.species, scale || 1, m.hullSeed);
  m.a = ph.a;
  m.b = ph.b;
  m.taper = ph.taper;
  m.shape = ph.shape;
  m.poly = ph.poly;
  m.boundR = ph.boundR;
  m.sh = ph.sh;
  m.invM = 1 / ph.mass;
  m.invI = 1 / ph.inertia;
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
Object.assign(window.FF, { createState, resetMelon, resetPlayers, resetBots, mintFurniture, devSpecies, applySpeciesDesign, speciesDensity, snapshotPrev, setBodyScale, racerKey, computeGridSlots, applyGridSlots,
  derivePhysique, speciesShape });
})();