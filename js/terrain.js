// ============================================================
// TERRAIN — seeded, streaming, endless track generation.
//
// Principles:
//  * DETERMINISTIC: same seed => identical terrain, always. The RNG
//    (mulberry32) is self-contained integer math — no Math.random,
//    no engine-dependent behavior. This is the foundation the ghost
//    system will stand on: a run is (seed + recorded positions).
//  * STREAMING: chunks are generated ahead of the melon and pruned
//    behind it, so the polyline stays ~150-300 points forever.
//    Pruning never affects future generation — the generator's
//    cursor (x, y, rng state) is independent of the point list.
//  * The chunk vocabulary trends DOWNHILL (y-down, so y increases):
//    mostly descents, sporadic flat breathers, occasional kicker
//    ramps that climb briefly then drop away into a jump.
//
// pts[0] is a wall sentinel: a tall near-vertical face just behind
// the oldest real point, so the melon can't roll backwards off the
// pruned edge of the world. prune() repositions it as it advances.
// ============================================================

(function () {
'use strict';

// Deterministic 32-bit RNG. Do not replace with Math.random — ever.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random in range [lo, hi).
const rr = (rng, lo, hi) => lo + rng() * (hi - lo);

function createTerrainGen(seed) {
  const gen = {
    seed,
    rng: null,
    x: 0,
    y: 0,
    pts: [],

    reset() {
      this.rng = mulberry32(this.seed);
      this.x = -1300;
      this.y = 0;
      this.pts.length = 0;
      this.pts.push({ x: -1380, y: -2600 }); // wall sentinel
      this.pts.push({ x: this.x, y: this.y });
      this.flat(1900); // runway: the 12 m grid apron + launch straight
    },

    // ---- primitive vocabulary (same shapes as the old test track) ----
    push() { this.pts.push({ x: this.x, y: this.y }); },
    flat(len) { this.x += len; this.push(); },
    slope(len, dy) { this.x += len; this.y += dy; this.push(); },
    // Raised-cosine bump on a linearly descending baseline.
    bump(len, amp, baseDy, segs = 12) {
      const x0 = this.x, y0 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        this.pts.push({
          x: x0 + len * t,
          y: y0 + baseDy * t + amp * 0.5 * (1 - window.FF.dmath.cos(2 * Math.PI * t)),
        });
      }
      this.x = x0 + len;
      this.y = y0 + baseDy;
    },

    // Generate chunks until the terrain extends past minX.
    ensure(minX) {
      while (this.x < minX) nextChunk(this);
    },

    // Drop points behind minX and advance the wall sentinel.
    prune(minX) {
      const pts = this.pts;
      while (pts.length > 3 && pts[2].x < minX) pts.splice(1, 1);
      pts[0].x = pts[1].x - 80;
      pts[0].y = pts[1].y - 2600;
    },
  };

  gen.reset();
  return gen;
}

// ---- Chunk vocabulary ----
// Weights: ~40% straight descent, ~30% rolling descent, ~16% flat
// breather, ~14% kicker jump. All chunks are net-downhill or neutral,
// so the track trends down forever; short uphills only appear inside
// rolling bumps and kicker ramps.
function nextChunk(g) {
  const r = g.rng;
  const pick = r();

  if (pick < 0.40) {
    // Straight descent: 7°–19° down.
    const len = rr(r, 400, 900);
    g.slope(len, len * rr(r, 0.12, 0.35));
  } else if (pick < 0.70) {
    // Rolling descent: 2–4 bumps (up or down) on a descending baseline.
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const len = rr(r, 300, 520);
      const amp = (r() < 0.5 ? -1 : 1) * rr(r, 40, 90);
      g.bump(len, amp, len * rr(r, 0.08, 0.2));
    }
  } else if (pick < 0.86) {
    // Flat breather.
    g.flat(rr(r, 250, 550));
  } else {
    // Kicker jump: short approach, steep up-ramp, drop face falling
    // further than the ramp rose (net downhill), landing downslope.
    g.flat(rr(r, 120, 220));
    const rise = rr(r, 90, 150);
    g.slope(rr(r, 170, 260), -rise);
    g.slope(12, rise + rr(r, 140, 280));
    g.slope(rr(r, 420, 700), rr(r, 130, 220));
  }
}

window.FF = window.FF || {};
// Terrain surface height (world y) at world x, or null outside the
// polylines. Assumes x-ordered points (both generators guarantee it).
// Shared by the renderer (markers) and physics (respawn placement).
function terrainYAt(terrain, wx) {
  for (const poly of terrain) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      if (wx >= a.x && wx <= b.x && b.x > a.x) {
        const t = (wx - a.x) / (b.x - a.x);
        return a.y + (b.y - a.y) * t;
      }
    }
  }
  return null;
}

// First segment index whose END could reach xLo (points are x-sorted).
// Callers scan forward from here and stop when segment start > xHi —
// turns O(n) terrain scans into O(log n + k).
function segStartIndex(poly, xLo) {
  let lo = 0, hi = poly.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poly[mid + 1].x < xLo) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

window.FF.segStartIndex = segStartIndex;
window.FF.terrainYAt = terrainYAt;
window.FF.createTerrainGen = createTerrainGen;
window.FF.mulberry32 = mulberry32;

})();
