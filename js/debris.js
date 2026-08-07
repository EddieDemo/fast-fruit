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

const MAX_FRAGS = 640; // sized for doubled bursts before eviction kicks in
const HOT_TICKS = 180;        // 1.5s of full simulation after the burst
const WAKE_TICKS = 120;       // hot time granted when a racer shoves a fragment
const CELL = 24;              // spatial hash cell size (px)
const FRAG_RESTITUTION = 0.35;

const fragments = [];
for (let i = 0; i < MAX_FRAGS; i++) {
  fragments.push({
    active: false, cold: false, rind: false, grounded: false,
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, omega: 0, r: 4,
    hotUntil: 0, rest: 0, born: 0,
  });
}
let spawnCursor = 0;

function reset() {
  for (const f of fragments) f.active = false;
  spawnCursor = 0;
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

// ---- The burst ----
function spawnFromBody(m, state, tick, bodyIndex) {
  // Deterministic per-smash stream: same run, same carnage.
  const rng = mulberry32((Math.imul(tick | 0, 2654435761) ^ Math.imul(bodyIndex + 1, 40503)) >>> 0);
  const a = CONFIG.semiMajor, b = CONFIG.semiMinor;
  const cos = dcos(m.angle), sin = dsin(m.angle);
  const count = 32 + Math.floor(rng() * 13); // 32-44 fragments per smash

  for (let i = 0; i < count; i++) {
    const f = allocate();
    const t = rng() * Math.PI * 2;
    const isRind = rng() < 0.42;
    // Rind bits come from the perimeter, flesh from the interior.
    const k = isRind ? 0.9 + rng() * 0.1 : 0.25 + rng() * 0.6;
    const lx = a * k * dcos(t);
    const ly = b * k * dsin(t);
    const wx = m.x + lx * cos - ly * sin;
    const wy = m.y + lx * sin + ly * cos;
    const rx = wx - m.x, ry = wy - m.y;
    const rlen = dhyp(rx, ry) || 1;
    const burst = 140 + rng() * 320;

    f.active = true; f.cold = false; f.grounded = false;
    f.x = wx; f.y = wy;
    // Rigid-body point velocity + radial burst + jitter.
    f.vx = m.vx - m.omega * ry + (rx / rlen) * burst + (rng() - 0.5) * 120;
    f.vy = m.vy + m.omega * rx + (ry / rlen) * burst + (rng() - 0.5) * 120;
    f.angle = rng() * Math.PI * 2;
    f.omega = m.omega + (rng() - 0.5) * 24;
    f.r = 3 + rng() * 4;
    f.rind = isRind;
    f.hotUntil = tick + HOT_TICKS;
    f.rest = 0;
    f.born = tick;
  }
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
      const dx = f.x - cx, dy = f.y - cy;
      const d = dhyp(dx, dy);
      if (d >= f.r || d < 1e-9) continue;
      const nx = dx / d, ny = dy / d;
      f.x += nx * (f.r - d);
      f.y += ny * (f.r - d);
      const vn = f.vx * nx + f.vy * ny;
      if (vn < 0) {
        f.vx -= (1 + FRAG_RESTITUTION) * vn * nx;
        f.vy -= (1 + FRAG_RESTITUTION) * vn * ny;
        f.vx *= 0.82; f.vy *= 0.82; // contact energy loss
        f.omega *= 0.9;
      }
      f.grounded = true;
    }
  }
  return sawTerrain;
}

// ---- Hot guts-on-guts: equal-mass circle pairs ----
function collideFragPair(A, B) {
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

// Spatial hash rebuilt per step from hot fragments only. Built and
// iterated in index order, so pair processing stays deterministic.
const grid = new Map();
const NEIGHBOR = [[0, 0], [1, 0], [0, 1], [1, 1], [1, -1]]; // forward half-space: each pair once

function stepDebris(state, dt) {
  const tick = state.tick;
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

    const slow = dhyp(f.vx, f.vy) < 45 && Math.abs(f.omega) < 4;
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
    f.vx = pvx * 0.5 + nx * kick + m.vx * 0.2;
    f.vy = pvy * 0.5 - Math.abs(ny) * kick * 0.6 - 80;
    f.omega += nx * 8;
  }
}

window.FF = window.FF || {};
window.FF.debris = { fragments, reset, spawnFromBody, step: stepDebris };

})();
