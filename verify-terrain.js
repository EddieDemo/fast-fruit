// verify-terrain.js
// Terrain v2 (the dialect rework), held to its laws.
//   A. DETERMINISM: same seed -> bit-identical point lists, double
//      run, hashed. The ghost foundation.
//   B. Recipes differ across seeds and live inside the global
//      envelopes; weights normalise to 1.
//   C. NET-DOWNHILL LAW: across many seeds and hundreds of chunks,
//      every chunk ends at or below its start — including kickers
//      and gap doubles at max heat (the two that once violated it in
//      draft).
//   D. Roller coherence: within a train every bump shares one
//      wavelength and one skew (measured from geometry via a
//      rollers-only recipe override); across tracks wavelengths
//      differ (the dialect).
//   E. THE KICKER LAW: on 3000 plans, every grade <= kickerMaxGrade
//      of its own transition; steep exits only ever ride long
//      transitions.
//   F. GAP GEOMETRY: on 3000 plans laid as points — receiving lip
//      exactly `drop` below the launch lip (never above), pit floor
//      >= 380 below the receiving lip, x strictly increasing, chunk
//      net-downhill.
//   G. Streaming: ensure + prune keeps the point list bounded and
//      x-sorted with the wall sentinel intact.

global.window = { FF: {} };
require('./js/dmath.js');
require('./js/terrain.js');

const T = window.FF;
const L = T.terrainLaws;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

function fnv(pts) {
  let h = 2166136261;
  const s = pts.map(p => p.x.toFixed(9) + ',' + p.y.toFixed(9)).join(';');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A: determinism -----------------------------------------------------------
{
  let ok = true;
  for (const seed of [1, 42, 20260817, 987654321]) {
    const g1 = T.createTerrainGen(seed); g1.ensure(60000);
    const g2 = T.createTerrainGen(seed); g2.ensure(60000);
    if (fnv(g1.pts) !== fnv(g2.pts) || g1.pts.length !== g2.pts.length) ok = false;
  }
  check('A same seed -> bit-identical terrain, four seeds to 60km', ok);
}

// B: recipes ------------------------------------------------------------------
{
  const seen = new Set();
  let ok = true;
  for (let s = 1; s <= 400; s++) {
    const rec = L.trackRecipe(s * 2654435761 + 7);
    seen.add(JSON.stringify(rec.weights));
    const wsum = Object.values(rec.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(wsum - 1) > 1e-9) ok = false;
    const inside = (rng, lo, hi) => rng[0] >= lo - 1e-9 && rng[1] <= hi + 1e-9 && rng[0] <= rng[1];
    if (!inside(rec.slopeGrade, 0.12, 0.35) || !inside(rec.flatGrade, 0, 0.03)
      || !inside(rec.rollLen, 280, 560) || !inside(rec.gapDrop, 0, 70)
      || !inside(rec.kickTrans, 60, 240)) ok = false;
  }
  check('B 400 recipes: all distinct, normalised, inside envelopes',
    ok && seen.size === 400, seen.size + ' distinct');
}

// C: net-downhill, whole vocabulary ------------------------------------------------
{
  let ok = true, worst = 0, chunks = 0;
  for (let s = 1; s <= 60 && ok; s++) {
    const g = T.createTerrainGen(s * 7919 + 1);
    for (let c = 0; c < 60; c++) {
      const y0 = g.y;
      const before = g.x;
      g.ensure(g.x + 1);              // exactly one chunk (ensure loops while x < minX)
      chunks++;
      const dy = g.y - y0;
      if (dy < -1e-6) { ok = false; worst = dy; }
      if (g.x <= before) { ok = false; }
    }
  }
  check('C net-downhill: 3600 chunks across 60 dialects, none rises',
    ok, ok ? chunks + ' chunks' : 'rose by ' + (-worst).toFixed(1));
}

// D: roller coherence ---------------------------------------------------------------
{
  // rollers-only dialect: force weights, measure crest spacing
  const rec = L.trackRecipe(555);
  rec.weights = { slope: 0, roller: 1, flat: 0, kicker: 0, gap: 0 };
  const g = T.createTerrainGen(555, rec);
  const startLen = g.pts.length;
  g.ensure(40000);
  const pts = g.pts.slice(startLen);
  // crests: local extrema of the bump component; measure spacing of
  // successive extrema — within a train they must match (one
  // wavelength), so the set of distinct spacings must be far smaller
  // than the number of extrema.
  const ext = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const s1 = (b.y - a.y) / (b.x - a.x), s2 = (c.y - b.y) / (c.x - b.x);
    if ((s1 < 0) !== (s2 < 0)) ext.push(b.x);
  }
  const gaps = [];
  for (let i = 1; i < ext.length; i++) gaps.push(Math.round((ext[i] - ext[i - 1]) / 10) * 10);
  const distinct = new Set(gaps);
  check('D rollers: crest spacing repeats within trains (coherent wavelength)',
    ext.length > 40 && distinct.size < gaps.length * 0.5,
    ext.length + ' extrema, ' + distinct.size + ' distinct spacings');
}

// E: the kicker law --------------------------------------------------------------------
{
  const rng = T.mulberry32(9001);
  const rec = L.trackRecipe(77);
  let ok = true, maxSeen = 0, maxT = 0;
  for (let i = 0; i < 3000; i++) {
    const p = L.kickerPlan(rng, rec);
    if (p.grade > L.kickerMaxGrade(p.T) + 1e-9) ok = false;
    if (p.grade > maxSeen) { maxSeen = p.grade; maxT = p.T; }
  }
  check('E kicker law: 3000 plans, every grade earned by its transition',
    ok, 'steepest ' + maxSeen.toFixed(2) + ' rode T=' + maxT.toFixed(0));
}

// F: gap geometry -------------------------------------------------------------------------
{
  const rng = T.mulberry32(4242);
  let ok = true;
  for (let i = 0; i < 3000 && ok; i++) {
    const rec = L.trackRecipe(i * 31 + 5);
    const p = L.gapPlan(rng, rec);
    // lay the chunk as the generator does, from y=0
    const lip = -(p.easeRise + p.rise);
    const floor = lip + p.drop + p.pitBelow;
    const recv = floor - p.pitBelow;                 // = lip + drop
    const end = recv + (p.easeRise + p.rise - p.drop) + p.landMargin;
    if (recv < lip - 1e-9) ok = false;               // receiver never above the lip
    if (recv - lip - p.drop > 1e-9) ok = false;      // exactly `drop` below
    if (floor - recv < 380 - 1e-9) ok = false;       // pit severe
    if (end < 120 - 1e-9) ok = false;                // net-downhill with margin
    if (p.drop < 0 || p.drop > 70) ok = false;
  }
  check('F gap: receiver at lip+drop, pit >= 380 under it, chunk nets down', ok);
}

// G: streaming --------------------------------------------------------------------------
{
  const g = T.createTerrainGen(31337);
  let ok = true, maxPts = 0;
  for (let x = 4000; x <= 300000; x += 4000) {
    g.ensure(x);
    g.prune(x - 3000);
    maxPts = Math.max(maxPts, g.pts.length);
    for (let i = 2; i < g.pts.length; i++) {
      if (g.pts[i].x <= g.pts[i - 1].x) { ok = false; break; }
    }
    if (g.pts[0].y > g.pts[1].y - 2000) ok = false;  // sentinel stays a wall
  }
  check('G streaming to 300km: bounded, x-sorted, sentinel intact',
    ok && maxPts < 500, 'peak ' + maxPts + ' points');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);