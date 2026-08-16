// ============================================================
// TERRAIN — seeded, streaming, endless track generation. (v2)
//
// Principles:
//  * DETERMINISTIC: same seed => identical terrain, always. The RNG
//    (mulberry32) is self-contained integer math — no Math.random,
//    no engine-dependent behavior. This is the foundation the ghost
//    system stands on: a run is (seed + recorded positions).
//    GENERATOR CHANGES BREAK RECORDED GHOSTS — this is v2
//    (2026-08-17, the dialect rework); pre-launch that costs
//    nothing, post-launch it means versioning.
//  * STREAMING: chunks are generated ahead of the melon and pruned
//    behind it, so the polyline stays small forever. Pruning never
//    affects future generation — the generator's cursor (x, y, rng
//    state) is independent of the point list.
//  * THE DIALECT LAW (v2): variance WITHIN a track reads as noise;
//    variance BETWEEN tracks reads as identity. Every numeric range
//    a chunk draws from is itself drawn ONCE per track seed — the
//    RECIPE — so chunks rhyme within a track and differ across
//    tracks. Today's daily lives at 10-13 degrees and never flats;
//    tomorrow's is a 17-degree washboard. Same vocabulary,
//    different games.
//  * NET-DOWNHILL LAW: every chunk ends at or below where it began
//    (y-down, so delta >= 0). Uphills exist only INSIDE roller
//    bumps, kicker ramps, and the gap double's launch.
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
const rrr = (rng, range) => rr(rng, range[0], range[1]);

// ---- THE RECIPE ------------------------------------------------------
// Drawn once per track from a SALTED stream (so recipe drawing can
// never shift the chunk stream). Each field is a sub-range of the
// global envelope: a centre, then a width, clamped inside.
function subRange(r, gLo, gHi, wLo, wHi) {
  const c = rr(r, gLo, gHi);
  const w = rr(r, wLo, wHi) * (gHi - gLo) * 0.5;
  return [Math.max(gLo, c - w), Math.min(gHi, c + w)];
}

function trackRecipe(seed) {
  const r = mulberry32((seed ^ 0x52454350) >>> 0);   // 'RECP'
  // Chunk weights: drawn inside bounds, then normalised. A track can
  // speak with NO flats (rest notes are a dialect choice), and may
  // not speak the gap double at all.
  const w = {
    slope: rr(r, 0.25, 0.50),
    roller: rr(r, 0.15, 0.40),
    flat: rr(r, 0.00, 0.30),
    kicker: rr(r, 0.06, 0.24),
    gap: r() < 0.55 ? rr(r, 0.03, 0.12) : 0,
  };
  const total = w.slope + w.roller + w.flat + w.kicker + w.gap;
  for (const k of Object.keys(w)) w[k] /= total;

  return {
    weights: w,
    // straight descents: this track's grades live in a lane
    slopeLen: subRange(r, 400, 900, 0.3, 0.9),
    slopeGrade: subRange(r, 0.12, 0.35, 0.25, 0.7),
    // flats: the rest note, with the ruled whisper of tilt — always
    // down-or-level (0..0.03) so the net-downhill law is untouched
    flatLen: subRange(r, 250, 550, 0.3, 0.9),
    flatGrade: subRange(r, 0.0, 0.03, 0.3, 1.0),
    // rollers: ONE wavelength per train (the pumpable law); skew
    // leans every bump in a train the same organic way
    rollLen: subRange(r, 280, 560, 0.3, 0.8),
    rollAmp: subRange(r, 40, 95, 0.3, 0.8),
    rollGrade: subRange(r, 0.08, 0.2, 0.3, 0.9),
    rollSkew: subRange(r, 0.35, 0.65, 0.4, 1.0),
    // kickers: the transition is the earning mechanism (see the law
    // at kickerPlan); heat scales how big this dialect jumps
    kickTrans: subRange(r, 60, 240, 0.3, 0.9),
    kickHeat: rr(r, 0.8, 1.25),
    // the gap double: width, and forgiveness — how far the receiver
    // sits BELOW the launch lip. 0 is a same-height precision exam;
    // 70 is a wide-window park jump. A recipe parameter, not a
    // one-time ruling.
    gapLen: subRange(r, 260, 520, 0.3, 0.8),
    gapDrop: subRange(r, 0, 70, 0.3, 1.0),
  };
}

// ---- PLANS -----------------------------------------------------------
// Set-piece primitives decide their numbers in PURE planners the suite
// holds to their laws; the generator only lays points. Every plan
// carries easeRise explicitly so net-downhill is arithmetic, not hope.

// THE KICKER TRANSITION LAW (2026-08-17): the old kicker's flat
// crashed into its ramp at a hard crease, and the crease is what
// capped fair steepness — the melon slammed the angle change. Real
// lips curve into the takeoff. So max ramp grade is EARNED by
// transition length: a long smooth lead-in buys a vicious exit, a
// short one stays mellow. Uniform, honest, no per-kicker fudge.
function kickerMaxGrade(T) {
  return 0.45 + 0.9 * (T / 240);
}

function kickerPlan(r, rec) {
  const T = rrr(r, rec.kickTrans);
  const grade = Math.min(kickerMaxGrade(T),
    rr(r, 0.45, kickerMaxGrade(T)) * rec.kickHeat);
  const easeRise = 0.5 * grade * T;
  const rampLen = rr(r, 160, 260);
  const rise = grade * rampLen;
  return {
    approach: rr(r, 120, 220),
    T, grade, easeRise, rampLen, rise,
    extraBelow: rr(r, 140, 280),        // the face bottoms out this far
    landLen: rr(r, 420, 700),           //   below the chunk start
    landDy: rr(r, 130, 220),
  };
}

// THE GAP DOUBLE (2026-08-17, a NEW WORD, not a kicker edit): ramp,
// VOID, receiving ramp. A kicker is a step down — the ground always
// catches you, the skill is rotation. A gap is a hole — the skill is
// SPEED JUDGMENT to clear distance. The receiving ramp mirrors the
// launch, so a jump inside the speed window lands with its velocity
// along the slope: the geometry IS the reward, and the damage law
// pays it out with zero new rules. The pit is a deep V the polyline
// expresses directly — deep enough that falling in is severe-to-
// fatal, the death system's existing business.
function gapPlan(r, rec) {
  const T = rrr(r, rec.kickTrans);
  const grade = rr(r, 0.45, kickerMaxGrade(T));
  const easeRise = 0.5 * grade * T;
  const rampLen = rr(r, 170, 250);
  const rise = grade * rampLen;
  return {
    approach: rr(r, 120, 200),
    T, grade, easeRise, rampLen, rise,
    gapLen: rrr(r, rec.gapLen),
    drop: rrr(r, rec.gapDrop),          // receiver below the launch lip
    pitBelow: rr(r, 380, 520),          // floor below the RECEIVING lip
    landLen: rampLen * rr(r, 1.1, 1.5), // the mirror, running long
    landMargin: rr(r, 120, 200),        // net-downhill by at least this
  };
}

// ---- the generator ---------------------------------------------------
function createTerrainGen(seed, recipeOverride) {
  const gen = {
    seed,
    recipe: recipeOverride || trackRecipe(seed),
    rng: null,
    x: 0,
    y: 0,
    lastKind: '',
    pts: [],

    reset() {
      this.rng = mulberry32(this.seed);
      this.x = -1300;
      this.y = 0;
      this.lastKind = '';
      this.pts.length = 0;
      this.pts.push({ x: -1380, y: -2600 }); // wall sentinel
      this.pts.push({ x: this.x, y: this.y });
      this.flat(1900); // runway: the 12 m grid apron + launch straight
    },

    // ---- primitive vocabulary ----
    push() { this.pts.push({ x: this.x, y: this.y }); },
    flat(len) { this.x += len; this.push(); },
    slope(len, dy) { this.x += len; this.y += dy; this.push(); },
    // Raised-cosine bump on a linearly descending baseline, with a
    // SKEW: the peak sits at fraction p of the length (0.5 =
    // symmetric, the old shape). Both halves are half-cosines, so
    // the slope is continuous through the peak and zero at the ends.
    bump(len, amp, baseDy, p = 0.5, segs = 12) {
      const x0 = this.x, y0 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const h = t <= p
          ? 0.5 * (1 - window.FF.dmath.cos(Math.PI * t / p))
          : 0.5 * (1 + window.FF.dmath.cos(Math.PI * (t - p) / (1 - p)));
        this.pts.push({ x: x0 + len * t, y: y0 + baseDy * t + amp * h });
      }
      this.x = x0 + len;
      this.y = y0 + baseDy;
    },
    // Quadratic ease from level into a grade over length T: the slope
    // runs 0 -> grade with constant curvature, so the approach meets
    // the ramp with NO CREASE. This is what the kicker law buys its
    // steepness with.
    easeInto(T, grade, segs = 6) {
      const x0 = this.x, y0 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        this.pts.push({ x: x0 + T * t, y: y0 - 0.5 * grade * T * t * t });
      }
      this.x = x0 + T;
      this.y = y0 - 0.5 * grade * T;
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

// ---- Chunk vocabulary, spoken in the track's dialect -----------------
function nextChunk(g) {
  const r = g.rng;
  const rec = g.recipe;
  const w = rec.weights;
  const pick = r();
  let kind;
  if (pick < w.slope) kind = 'slope';
  else if (pick < w.slope + w.roller) kind = 'roller';
  else if (pick < w.slope + w.roller + w.flat) kind = 'flat';
  else if (pick < w.slope + w.roller + w.flat + w.kicker) kind = 'kicker';
  else kind = 'gap';
  // placement grammar: a rest note never follows a rest note
  if (kind === 'flat' && g.lastKind === 'flat') kind = 'slope';
  g.lastKind = kind;

  if (kind === 'slope') {
    const len = rrr(r, rec.slopeLen);
    g.slope(len, len * rrr(r, rec.slopeGrade));
  } else if (kind === 'roller') {
    // THE PUMPABLE LAW: one wavelength, one skew, one sign per TRAIN
    // — a rhythm you can find, not four unrelated bumps. Amplitude
    // jitters a little so it breathes.
    const n = 2 + Math.floor(r() * 3);
    const len = rrr(r, rec.rollLen);
    const skew = rrr(r, rec.rollSkew);
    const sign = r() < 0.5 ? -1 : 1;
    const amp0 = rrr(r, rec.rollAmp);
    for (let i = 0; i < n; i++) {
      g.bump(len, sign * amp0 * rr(r, 0.85, 1.15), len * rrr(r, rec.rollGrade), skew);
    }
  } else if (kind === 'flat') {
    // the rest note, with the ruled whisper of tilt
    const len = rrr(r, rec.flatLen);
    g.slope(len, len * rrr(r, rec.flatGrade));
  } else if (kind === 'kicker') {
    const p = kickerPlan(r, rec);
    g.flat(p.approach);
    g.easeInto(p.T, p.grade);
    g.slope(p.rampLen, -p.rise);
    // the face: from the lip (easeRise + rise above start) down to
    // extraBelow BELOW the chunk start — net-downhill by arithmetic
    g.slope(12, p.easeRise + p.rise + p.extraBelow);
    g.slope(p.landLen, p.landDy);
  } else {
    const p = gapPlan(r, rec);
    g.flat(p.approach);
    g.easeInto(p.T, p.grade);
    g.slope(p.rampLen, -p.rise);
    // launch lip: easeRise + rise above chunk start. The V: down to
    // the floor (drop + pitBelow under the lip), a short flat, up to
    // the receiving lip exactly `drop` below the launch lip.
    g.slope(p.gapLen * 0.45, p.drop + p.pitBelow);
    g.slope(p.gapLen * 0.10, 0);
    g.slope(p.gapLen * 0.45, -p.pitBelow);
    // the mirror: descends past the start line so the chunk nets down
    g.slope(p.landLen, (p.easeRise + p.rise - p.drop) + p.landMargin);
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
// The pure parts, exported so the suite holds the laws to themselves
// rather than doing geometry archaeology on point lists.
window.FF.terrainLaws = { trackRecipe, kickerPlan, gapPlan, kickerMaxGrade, subRange };

})();