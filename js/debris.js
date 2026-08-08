// ============================================================
// DEBRIS — the smash made visible: pooled melon fragments.
//
// Two-tier physics doctrine: melons are citizens of the full solver;
// debris is scenery with momentum. Fragments get gravity, circle-vs-
// terrain bounce, and (while "hot") circle-vs-circle guts collisions
// via a spatial hash — but they never enter the melon contact solver.
//
// Lifecycle:
//   HOT  (~1.5s): fully simulated, collides with other hot fragments.
//   COLD: asleep on the terrain. Zero cost. Persistent for the race —
//         lap wreckage accumulates until respawn clears it.
//   Racers plow through debris: any fragment (hot or cold) inside a
//   racing melon's radius is woken and flung with the melon's contact-
//   point velocity. One-way — debris never deflects a racer.
//
// The burst is physics-derived: each fragment spawns at a point of the
// dying ellipse and inherits that point's rigid-body velocity
// (v + w x r) plus a radial burst — so a spinning melon explodes into
// a spiral and a nose-first slam sprays forward. Every random number
// comes from a mulberry32 stream seeded by (tick, bodyIndex): identical
// runs produce identical wreckage, keeping debris ghost-compatible.
//
// Pool is hard-capped; when full, the oldest COLD fragment is evicted
// first, so endless sessions can't leak memory.
// ============================================================

(function () {
'use strict';

const { CONFIG, mulberry32, segStartIndex, dmath } = window.FF;
const dsin = dmath.sin, dcos = dmath.cos;
const dhyp = (x, y) => Math.sqrt(x * x + y * y); // sqrt IS pinned; hypot is not

const MAX_FRAGS = 900; // sized for tessellated ~68-fragment bursts
const HOT_TICKS = 180;        // 1.5s of full simulation after the burst
const WAKE_TICKS = 120;       // hot time granted when a racer shoves a fragment
const CELL = 24;              // spatial hash cell size (px)
const FRAG_RESTITUTION = 0.35;

const fragments = [];
for (let i = 0; i < MAX_FRAGS; i++) {
  fragments.push({
    active: false, cold: false, rind: false, grounded: false, kind: 0,
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, omega: 0, r: 4,
    hotUntil: 0, rest: 0, born: 0,
  });
}
let spawnCursor = 0;

function reset() {
  for (const f of fragments) f.active = false;
  spawnCursor = 0;
  stains.length = 0;
}

// Prefer a free slot; else evict the oldest cold fragment; else (a
// race of pure carnage) recycle whatever the cursor points at.
function allocate() {
  for (let n = 0; n < MAX_FRAGS; n++) {
    const i = (spawnCursor + n) % MAX_FRAGS;
    if (!fragments[i].active) { spawnCursor = (i + 1) % MAX_FRAGS; return fragments[i]; }
  }
  let oldest = -1, oldestBorn = Infinity;
  for (let i = 0; i < MAX_FRAGS; i++) {
    if (fragments[i].cold && fragments[i].born < oldestBorn) { oldest = i; oldestBorn = fragments[i].born; }
  }
  if (oldest >= 0) { spawnCursor = (oldest + 1) % MAX_FRAGS; return fragments[oldest]; }
  const f = fragments[spawnCursor];
  spawnCursor = (spawnCursor + 1) % MAX_FRAGS;
  return f;
}

// ---- The burst: tessellated, contact-aimed, conservation-honest ----
//
// Three laws, in order of importance:
//  1. CONTINUITY. Frame zero must look like the intact melon with
//     cracks in it, not a swap: fragments spawn AS cells of the
//     ellipse, tiling its silhouette in place. The velocity field
//     then pulls it apart.
//  2. CONSERVATION. A melon is a VOLUME; the silhouette only shows
//     the front layer. On smashing, occluded depth unpacks onto the
//     ground plane, so the honest debris field is BIGGER than the
//     silhouette (~1.4x here). Sizes follow fracture's power law:
//     few big rind slabs, many small flesh flecks.
//  3. CONTACT PHYSICS. Real smashes fail from the contact point, not
//     the center: fine fragmentation in the crush zone, big surviving
//     slabs on the far side, matter squirting ALONG the escape normal
//     the killing blow recorded — a nose-dive sprays forward, a flat
//     pancake slam squirts sideways, a rival hit throws you away from
//     the rival.
function spawnFromBody(m, state, tick, bodyIndex) {
  // Deterministic per-smash stream: same run, same carnage.
  const rng = mulberry32((Math.imul(tick | 0, 2654435761) ^ Math.imul(bodyIndex + 1, 40503)) >>> 0);
  const a = m.a, b = m.b; // the body's own silhouette bursts
  const cos = dcos(m.angle), sin = dsin(m.angle);

  // Escape normal of the killing blow (away from what hit us).
  let nx = 0, ny = -1;
  if (m.pairSeverity >= m.hitSeverity && (m.pairNx || m.pairNy)) { nx = m.pairNx; ny = m.pairNy; }
  else if (m.hitNx || m.hitNy) { nx = m.hitNx; ny = m.hitNy; }
  // (byPair/kJn/energyK are derived just below, after the contact point)
  const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
  nx /= nlen; ny /= nlen;

  // Contact point: the melon's surface in the -n direction.
  const rContact = radiusInWorldDir(-nx, -ny, cos, sin, a, b);
  const cpx = m.x - nx * rContact;
  const cpy = m.y - ny * rContact;

  // SEVERITY DECIDES DEATH; IMPULSE DECIDES DRAMA. Severity carries a
  // curvature multiplier (a slow tip landing legitimately kills), but
  // the energy available to throw pulp is the raw impulse of the blow
  // — the angle must not amplify it. A slow bad-angle death is a QUIET
  // death: crack, slump, small halo. Only genuine speed earns the
  // violent spray. energyK also scales the FLYER FRACTION below, so
  // gentle deaths shed fewer pieces, not just slower ones.
  const byPair = m.pairSeverity >= m.hitSeverity;
  const kJn = (byPair ? m.pairJn : m.hitJn) || 1500;
  const shockBase = 40 + Math.min(520, kJn * 0.09);
  const energyK = Math.min(1, kJn / 4000);

  // Every melon's pulp wears ITS OWN green: rind fragments tint from
  // the owner's body color (two darkened shades), so a debris field is
  // readable history — you can see WHO died here. Flesh stays the
  // universal pink; a scatter of near-black SEEDS completes the
  // watermelon fiction. Colors are presentation-only strings riding on
  // sim-tier fragments: identical on every peer, never read by motion.
  const baseCol = window.FF.racerColor ? window.FF.racerColor(state, bodyIndex) : '#00ff00';
  const pulp = (window.FF.FRUITS && window.FF.FRUITS[m.fruit] && window.FF.FRUITS[m.fruit].pulp)
    || { flesh: '#ff4757', fleshLight: '#ff6b7d', seed: '#222222', rindK: 0.72, slabK: 0.52 };
  const rindCol = shadeHex(baseCol, pulp.rindK);
  const slabCol = shadeHex(baseCol, pulp.slabK);

  // Cell recipe: radial band (k), size band (r), kind, and direction
  // bias: 'far' = along +n (survivors), 'near' = along -n (the crush
  // zone), 'any' = full circle.
  // Tangent to the escape normal (the "along the ground" direction for
  // a terrain smash): the SMASH signature is matter squirting around
  // the contact, not radiating from the center.
  const tx = -ny, ty = nx;

  const recipe = [
    { n: 4 + (rng() < 0.5 ? 1 : 0), k0: 0.72, k1: 0.9, base: 15,  kind: 3, dir: 'far',  pFly: 0.08 },
    { n: 8,  k0: 0.82, k1: 1.0,  base: 10,  kind: 2, dir: 'any',  pFly: 0.2 },
    { n: 14, k0: 0.4,  k1: 0.72, base: 9.4, kind: 1, dir: 'any',  pFly: 0.28 },
    { n: 40, k0: 0.05, k1: 0.62, base: 6.1, kind: 0, dir: 'near', pFly: 0.4 },
  ];

  for (const band of recipe) {
    for (let i = 0; i < band.n; i++) {
      let delta;
      if (band.dir === 'far') delta = (rng() - 0.5) * 2.1;
      else if (band.dir === 'near') delta = Math.PI + (rng() - 0.5) * 3.5;
      else delta = rng() * Math.PI * 2;
      const cd = dcos(delta), sd = dsin(delta);
      const dx = nx * cd - ny * sd;
      const dy = nx * sd + ny * cd;

      const rEll = radiusInWorldDir(dx, dy, cos, sin, a, b);
      const k = band.k0 + rng() * (band.k1 - band.k0);
      const f = allocate();
      f.active = true; f.cold = false; f.grounded = false;
      f.kind = band.kind;
      f.rind = band.kind >= 2;
      // CONTINUITY: spawn AT the cell.
      f.x = m.x + dx * rEll * k;
      f.y = m.y + dy * rEll * k;

      // Continuous skewed sizes: many small, few large, the occasional
      // outlier — uniformity is the machine tell.
      f.r = band.base * (0.55 + 1.25 * rng() * rng()) * (rng() < 0.06 ? 1.55 : 1);
      // Seeds: a scatter of the flesh becomes small dark pips.
      f.seed = band.kind <= 1 && rng() < 0.13;
      if (f.seed) f.r *= 0.72;
      f.col = f.seed ? pulp.seed
        : band.kind === 3 ? slabCol
        : band.kind === 2 ? rindCol
        : band.kind === 1 ? pulp.flesh
        : pulp.fleshLight;
      makeShard(f, rng);

      // SMASH ENERGY MODEL: most fragments are SLUMPERS — they receive
      // almost no shock and simply drop where the melon was (this is
      // what forms the heap). A crush-zone minority are FLYERS, and
      // their shock is TANGENT-DOMINANT: matter squirts around the
      // contact, hugging the ground, because the ground is in the way.
      const rx = f.x - m.x, ry = f.y - m.y;
      let ax = f.x - cpx, ay = f.y - cpy;
      const alen = Math.sqrt(ax * ax + ay * ay) || 1;
      const proximity = Math.max(0.3, 1 - alen / (2.2 * a));
      const isFlyer = rng() < band.pFly * (0.35 + 0.9 * energyK) * (0.5 + proximity);
      let shock = shockBase * proximity * (0.7 + rng() * 0.6);
      let sxv, syv;
      if (isFlyer) {
        const side = (rx * tx + ry * ty) >= 0 ? 1 : -1;
        // 78% along the tangent (their side), 22% along the escape normal.
        sxv = (tx * side * 0.78 + nx * 0.22) * shock * 0.9;
        syv = (ty * side * 0.78 + ny * 0.22) * shock * 0.9;
      } else {
        shock *= 0.08; // slumpers: detach, drop, pile up
        sxv = (ax / alen) * shock;
        syv = (ay / alen) * shock;
      }
      // Inherit the parent's point velocity WITH THE REBOUND REMOVED:
      // the solver granted the body a bounce along +n, but smashing IS
      // the failure to bounce — that energy went into fracture. Without
      // this, the entire pile launches skyward on the parent's rebound
      // (measured: mean vy -571 lofting the heap half a second into
      // the air, scattering it before it could form).
      let pvx = m.vx - m.omega * ry;
      let pvy = m.vy + m.omega * rx;
      const rb = pvx * nx + pvy * ny;
      if (rb > 0) { pvx -= nx * rb * 0.85; pvy -= ny * rb * 0.85; }
      const jit = isFlyer ? 60 : 18;
      f.vx = pvx + sxv + (rng() - 0.5) * jit;
      f.vy = pvy + syv + (rng() - 0.5) * jit;
      f.angle = rng() * Math.PI * 2;
      f.omega = m.omega + (rng() - 0.5) * (band.kind === 3 ? 8 : (isFlyer ? 26 : 12));
      f.hotUntil = tick + HOT_TICKS;
      f.rest = 0;
      f.born = tick;
    }
  }

  // The stain: the fragments account for the solids; this is the
  // liquid. The track remembers in two mediums.
  spawnStain(state, cpx, tick, rng);
}

// Seeded irregular shard polygons — fracture STATISTICS, not fracture
// simulation. Verts in local fragment units (scaled by r at draw):
//  * slabs/rind: curved plates — an outer arc and an inner arc, so a
//    rind shard REMEMBERS its curvature: the strongest "this was a
//    melon" cue available.
//  * flesh chunks: crooked convex lumps.
//  * flecks: near-round droplets (the crush zone is wet; wet is round).
function makeShard(f, rng) {
  const v = [];
  if (f.seed) {
    // Seed pip: small near-round droplet.
    for (let i = 0; i < 5; i++) {
      const t = (i / 5) * Math.PI * 2 + (rng() - 0.5) * 0.2;
      const rr = 0.85 + rng() * 0.2;
      v.push(dcos(t) * rr, dsin(t) * rr * 0.8);
    }
    f.verts = v;
    return;
  }
  if (f.kind >= 2) {
    // Rind: same CHUNK FAMILY as flesh — irregular CONVEX lumps — but
    // elongated and more angular (rind is tougher; its pieces are
    // slabbier). The earlier curved-arc plates were concave shapes,
    // and at 15-30px on a busy field concave silhouettes read as
    // glitch, not curvature. Chunkiness is the honest cue at this
    // art scale; the two-green palette carries the rind identity.
    const n = 5 + (rng() < 0.4 ? 1 : 0);
    const stretch = 1.25 + rng() * 0.3;
    const squash = 0.75 + rng() * 0.15;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const rr = 0.72 + rng() * 0.42; // narrower jitter: solid, not spiky
      v.push(dcos(t) * rr * stretch, dsin(t) * rr * squash);
    }
  } else if (f.kind === 1) {
    const n = 5 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const rr = 0.55 + rng() * 0.75;
      v.push(dcos(t) * rr, dsin(t) * rr);
    }
  } else {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const rr = 0.8 + rng() * 0.3;
      v.push(dcos(t) * rr, dsin(t) * rr);
    }
  }
  f.verts = v;
}

// Darken a #rrggbb color by factor k (presentation util).
function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const rr = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const bb = Math.round((n & 255) * k);
  return '#' + ((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1);
}

// Ellipse radius along a WORLD direction (dx,dy).
function radiusInWorldDir(dx, dy, cos, sin, a, b) {
  const bx = dx * cos + dy * sin;
  const by = -dx * sin + dy * cos;
  return (a * b) / Math.sqrt(b * b * bx * bx + a * a * by * by);
}

// ---- Confetti burst: the ORIGINAL center-radial uniform spray. ----
// Preserved by design decision (user note, 2026-08-07): an internal
// pressure release IS center-radial, so this is exactly the right
// physics for a balloon pop scattering confetti. Reserved for the
// balloons in docs/physics-witnesses.md. Do not delete as dead code.
function confettiBurst(x, y, baseVx, baseVy, tick, seed, count) {
  const rng = mulberry32((seed >>> 0) || 1);
  const n = count || 18;
  for (let i = 0; i < n; i++) {
    const f = allocate();
    const t = rng() * Math.PI * 2;
    const burst = 140 + rng() * 320;
    f.active = true; f.cold = false; f.grounded = false;
    f.kind = 0;
    f.seed = false;
    f.col = null;
    f.verts = null; // confetti renders as rectangles: paper IS square
    f.rind = rng() < 0.5;
    f.x = x; f.y = y;
    f.vx = baseVx + dcos(t) * burst;
    f.vy = baseVy + dsin(t) * burst;
    f.angle = rng() * Math.PI * 2;
    f.omega = (rng() - 0.5) * 30;
    f.r = 2.5 + rng() * 3;
    f.hotUntil = tick + HOT_TICKS;
    f.rest = 0;
    f.born = tick;
  }
}

// ---- Stains: the track remembers in liquid ----
const MAX_STAINS = 200;
const stains = []; // {x, y, r, seed, born}

function spawnStain(state, wx, tick, rng) {
  const wy = window.FF.terrainYAt(state.terrain, wx);
  if (wy === null) return;
  if (stains.length >= MAX_STAINS) stains.shift(); // oldest out
  stains.push({ x: wx, y: wy, r: 26 + rng() * 26, seed: (rng() * 1e9) | 0, born: tick });
}

// ---- Circle-vs-terrain bounce (the ellipse collider's little sibling) ----
function collideFragTerrain(f, terrain) {
  f.grounded = false;
  let sawTerrain = false;
  const cullR = f.r + 60;
  for (const poly of terrain) {
    const start = segStartIndex(poly, f.x - cullR);
    for (let i = start; i < poly.length - 1; i++) {
      const A = poly[i], B = poly[i + 1];
      if (A.x > f.x + cullR) break;
      if (B.x < f.x - cullR) continue;
      sawTerrain = true;
      const abx = B.x - A.x, aby = B.y - A.y;
      const len2 = abx * abx + aby * aby || 1;
      let t = ((f.x - A.x) * abx + (f.y - A.y) * aby) / len2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const cx = A.x + abx * t, cy = A.y + aby * t;
      // TUNNEL RESCUE: if the center is BELOW the surface line at its
      // own x (terrain is y(x): no overhangs), a fast fragment crossed
      // the infinitely thin floor in one step — the closest-point
      // reflection below would treat it as arriving from underneath
      // and push it deeper. Teleport it back to the surface and kill
      // any remaining downward speed. Handles ANY injection velocity,
      // so no future shove/burst tuning can reopen this hole.
      if (Math.abs(abx) > 1e-9 && f.x >= Math.min(A.x, B.x) && f.x <= Math.max(A.x, B.x)) {
        const yLine = A.y + aby * ((f.x - A.x) / abx);
        if (f.y - yLine > 0.5) {
          f.y = yLine - f.r;
          if (f.vy > 0) f.vy = 0;
          f.vx *= 0.7;
          f.grounded = true;
          continue;
        }
      }
      const dx = f.x - cx, dy = f.y - cy;
      const d = dhyp(dx, dy);
      if (d >= f.r || d < 1e-9) continue;
      const nx = dx / d, ny = dy / d;
      f.x += nx * (f.r - d);
      f.y += ny * (f.r - d);
      const vn = f.vx * nx + f.vy * ny;
      if (vn < 0) {
        // Kind-aware energy loss: heavy slabs barely travel (a smash
        // is OVER quickly — the aftermath is a pile, not a rain), and
        // WET FLESH DOES NOT BOUNCE: it splats and stays. Bounce is
        // the loudest "dry and light" signal a material can send, so
        // the pink kinds get near-zero restitution and hard damping.
        // Seeds are the one exception — they're hard little pips, and
        // letting them skitter is honest.
        const damp = f.seed ? 0.8
          : f.kind === 3 ? 0.55 : f.kind === 2 ? 0.66 : f.kind === 1 ? 0.6 : 0.62;
        const rest = f.seed ? 0.3 : f.kind >= 2 ? 0.18 : 0.05;
        f.vx -= (1 + rest) * vn * nx;
        f.vy -= (1 + rest) * vn * ny;
        f.vx *= damp; f.vy *= damp;
        f.omega *= f.kind >= 2 ? 0.8 : 0.9;
      }
      f.grounded = true;
    }
  }
  return sawTerrain;
}

// ---- Hot guts-on-guts: equal-mass circle pairs ----
function collideFragPair(A, B) {
  if (A.born === B.born) return; // one melon's remains
  const dx = B.x - A.x, dy = B.y - A.y;
  const rr = A.r + B.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 < 1e-9) return;
  const d = Math.sqrt(d2);
  const nx = dx / d, ny = dy / d;
  const pen = (rr - d) * 0.5;
  A.x -= nx * pen; A.y -= ny * pen;
  B.x += nx * pen; B.y += ny * pen;
  const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
  if (vn < 0) {
    const j = (-(1 + 0.3) * vn) / 2;
    A.vx -= j * nx; A.vy -= j * ny;
    B.vx += j * nx; B.vy += j * ny;
  }
}

// Burst-mates NEVER collide with each other: they are one melon's
// remains, and the tessellation deliberately overlaps (1.25x matter
// in 1x space) — any mutual collision detonates the pile like
// pressurized foam (measured twice: at spawn, and again the moment a
// timed grace expired). The settled heap rests overlapped, which is
// exactly what a mound looks like. Fragments from DIFFERENT smashes
// still collide, and racers still plow everything.
let simTick = 0;

// Spatial hash rebuilt per step from hot fragments only. Built and
// iterated in index order, so pair processing stays deterministic.
const grid = new Map();
const NEIGHBOR = [[0, 0], [1, 0], [0, 1], [1, 1], [1, -1]]; // forward half-space: each pair once

function stepDebris(state, dt) {
  const tick = state.tick;
  simTick = tick;
  const terrain = state.terrain;
  const period = state.period;

  // 1. Integrate + terrain for hot fragments; settle to cold.
  for (const f of fragments) {
    if (!f.active || f.cold) continue;
    f.vy += CONFIG.gravity * dt;
    // Clamp: a fragment faster than ~18px/step can skip the thin
    // terrain line entirely. Debris never needs to be this fast.
    const sp2 = f.vx * f.vx + f.vy * f.vy;
    if (sp2 > 2200 * 2200) {
      const k = 2200 / Math.sqrt(sp2);
      f.vx *= k; f.vy *= k;
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.angle += f.omega * dt;
    const sawTerrain = collideFragTerrain(f, terrain);

    // Off-world reaper: a fragment with no terrain anywhere below its
    // x (flung past the pruned edge) is falling into the void forever.
    // Without this, void-fallers stay hot eternally and eat the frame
    // budget — measured: 17% of real time before this guard existed.
    f.offWorld = sawTerrain ? 0 : (f.offWorld || 0) + 1;
    if (f.offWorld > 60) { f.active = false; continue; }

    const slowLim = f.kind === 3 ? 95 : f.kind === 2 ? 70 : 45;
    const slow = dhyp(f.vx, f.vy) < slowLim && Math.abs(f.omega) < (f.kind >= 2 ? 6 : 4);
    f.rest = (f.grounded && slow) ? f.rest + 1 : 0;
    if (f.rest > 10 || (tick > f.hotUntil && f.grounded)) {
      f.cold = true; f.vx = 0; f.vy = 0; f.omega = 0;
    } else if (tick > f.hotUntil + 360) {
      // Hard failsafe: nothing stays hot past 3s over budget.
      if (f.grounded) { f.cold = true; f.vx = 0; f.vy = 0; f.omega = 0; }
      else f.active = false;
    }
  }

  // 2. Hot-on-hot collisions via the hash.
  grid.clear();
  for (let i = 0; i < MAX_FRAGS; i++) {
    const f = fragments[i];
    if (!f.active || f.cold) continue;
    const k = Math.floor(f.x / CELL) * 100003 + Math.floor(f.y / CELL);
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(i);
  }
  for (const [k, arr] of grid) {
    const cx = Math.floor(k / 100003), cy = k - cx * 100003;
    for (const [ox, oy] of NEIGHBOR) {
      const other = (ox === 0 && oy === 0) ? arr : grid.get((cx + ox) * 100003 + (cy + oy));
      if (!other) continue;
      for (let i = 0; i < arr.length; i++) {
        const start = (other === arr) ? i + 1 : 0;
        for (let j = start; j < other.length; j++) {
          collideFragPair(fragments[arr[i]], fragments[other[j]]);
        }
      }
    }
  }

  // 3. Racers plow through debris (one-way, minimum-image aware).
  const bodyR = (CONFIG.semiMajor + CONFIG.semiMinor) / 2;
  for (const pl of state.players) racerShove(pl.melon, state, bodyR, period, tick);
  for (const b of state.bots) racerShove(b.melon, state, bodyR, period, tick);
}

function racerShove(m, state, bodyR, period, tick) {
  if (!m.alive) return;
  const speedy = dhyp(m.vx, m.vy) > 30 || Math.abs(m.omega) > 2;
  if (!speedy) return; // parked melons don't churn their surroundings
  for (const f of fragments) {
    if (!f.active) continue;
    // Fragment's image nearest this racer (wreckage from other laps).
    let fx = f.x, fy = f.y, sx = 0, sy = 0;
    if (period) {
      const k = Math.round((f.x - m.x) / period.L);
      if (k !== 0) { sx = k * period.L; sy = k * period.D; fx -= sx; fy -= sy; }
    }
    const dx = fx - m.x, dy = fy - m.y;
    const rr = bodyR + f.r + 2;
    if (dx * dx + dy * dy > rr * rr) continue;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / d, ny = dy / d;
    // Wake and fling. Two hard-won details here: (1) pure contact-
    // point velocity is ~zero at the bottom of a rolling wheel, which
    // is exactly where fragments rest — so the kick is speed-scaled or
    // plowing reads as nothing. (2) The wake is VELOCITY-ONLY and its
    // vertical component always sprays UP: fragments beneath the melon
    // have n pointing down, and any downward positional shove punts
    // them through the infinitely thin terrain line (measured: 200px
    // underground). Up-and-forward is also what gravel does.
    const pvx = m.vx - m.omega * dy;
    const pvy = m.vy + m.omega * dx;
    const speed = dhyp(m.vx, m.vy);
    const kick = 120 + speed * 0.25;
    f.cold = false;
    f.hotUntil = tick + WAKE_TICKS;
    f.rest = 0;
    // WET AND HEAVY. Three rules layered on the fling:
    //  * MASS: the target velocity is blended in by inverse fragment
    //    area (clamped) — this is the pulp's effective mass. A fleck
    //    takes the full fling; a rind slab shoulders aside at ~15% of
    //    it and mostly keeps resting. Differentiated response to the
    //    same disturbance is how the eye reads weight.
    //  * GROUND-HUGGING: the vertical pop is cut ~3x — a rolling
    //    melon SLOSHES pulp forward and sideways along the ground,
    //    it doesn't loft it. Airborne pulp reads light. (Enough lift
    //    remains to keep fragments off the terrain-tunnel failure
    //    mode the original up-pop existed to prevent.)
    //  * SLOW TUMBLE: angular kick halved and mass-scaled — wet lumps
    //    rotate sluggishly; flutter is lightness.
    const massK = Math.min(1, Math.max(0.15, 25 / (f.r * f.r)));
    // Mass scales BOTH the target and the blend rate: the shove
    // reapplies every overlap step, so a blend alone converges heavy
    // pieces to the full fling anyway (measured: 16 contact steps ate
    // a 0.15 blend). An impulse buys less velocity against more
    // matter, so the heavy target is genuinely lower, not just slower
    // to reach.
    const mix = 0.15 + 0.85 * massK;
    // Rim fields at high spin inject absurd speeds (measured ~3000
    // px/s: 26px/step, clean through the terrain line between two
    // frames). Cap the fling at the source.
    let pvxC = pvx;
    if (pvxC > 1100) pvxC = 1100; else if (pvxC < -1100) pvxC = -1100;
    const txv = (pvxC * 0.5 + nx * kick + m.vx * 0.25) * mix;
    // Vertical: mostly ignore the rim's velocity field — a spinning
    // wheel flings sticky debris skyward (mud on a tire), but wet
    // pulp doesn't ride the rim. Small share, hard ceiling.
    let tyRaw = pvy * 0.15 - Math.abs(ny) * kick * 0.22 - 25;
    if (tyRaw < -240) tyRaw = -240;
    if (tyRaw > 160) tyRaw = 160; // and never drive pulp hard INTO the floor
    const tyv = tyRaw * mix;
    f.vx += (txv - f.vx) * massK;
    f.vy += (tyv - f.vy) * massK;
    f.omega += nx * 4 * massK;
  }
}

window.FF = window.FF || {};
window.FF.debris = { fragments, stains, reset, spawnFromBody, confettiBurst, step: stepDebris };

})();
