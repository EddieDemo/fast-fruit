// verify-decals-flagedge.js
// Reproduces Eddie's report: for a decal placed toward a pole, the
// poleward edge appears LARGER on screen than the equatorward edge,
// which is backwards for something wrapped around a convex body.
//
// Method: rasterize a square decal exactly the way decalRaster does
// (unproject each pixel, sampleAt, inside test), then measure the
// on-screen HEIGHT of the vertical edge nearest the pole vs the one
// nearest the equator, and the on-screen WIDTH of the top/bottom edges
// at each end. Also compute the analytic expectation on the sphere.

global.window = { FF: {} };
require('/home/claude/ff/js/decals.js');
const D = window.FF.decals;

const a = 128 * 1.28, b = 128;       // body semi-axes, px (a/b = 1.28)
const rs = 2;                        // raster scale, matches RSCALE in-race

// Decal: centred toward the RIGHT pole (u0 small; u=0 is x=+a),
// front meridian (v0 = pi/2), no rotation. Square, half-size = s*b.
const u0 = 0.65, v0 = Math.PI / 2, rot = 0;
const s = 0.30;                      // generous size so effects are visible
const half = s * b;

const w = Math.ceil(a * 2) + 2, h = Math.ceil(b * 2) + 2;
const pw = Math.round(w * rs), ph = Math.round(h * rs);

// For each pixel, record sticker coords if inside the square.
// Edge bands: |nx| in [0.92, 1] = vertical edges; |ny| likewise.
let rows = new Map();  // for right/left edge: pixel-x band -> [minY,maxY]
const hits = [];
for (let py = 0; py < ph; py++) {
  for (let pxi = 0; pxi < pw; pxi++) {
    const x = (pxi + 0.5) / rs - w / 2, y = (py + 0.5) / rs - h / 2;
    const ex = x / a, ey = y / b;
    if (ex * ex + ey * ey > 1) continue;
    const surf = D.unproject(x, y, a, b);
    if (!surf) continue;
    const q = D.sampleAt(surf.u, surf.v, u0, v0, rot, a, b);
    const nx = q.x / half, ny = q.y / half;
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1) continue;
    hits.push({ x, y, nx, ny });
  }
}
if (!hits.length) { console.log('NO HITS — placement off-body?'); process.exit(1); }

function span(sel, axis) {
  const pts = hits.filter(sel);
  if (!pts.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const v = p[axis]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
}

// Screen-right (+x) is toward the pole here. nx=+1 edge is poleward.
const hPole = span(p => p.nx > 0.92, 'y');       // height of poleward vertical edge
const hEq   = span(p => p.nx < -0.92, 'y');      // height of equatorward vertical edge
const wTop    = span(p => p.ny < -0.92, 'x');    // width of top edge
const wBottom = span(p => p.ny > 0.92, 'x');     // width of bottom edge
const wTotal  = span(() => true, 'x');
const hTotal  = span(() => true, 'y');

console.log('decal centre u0=%s  a/b=%s  half=%spx', u0, (a / b).toFixed(2), half);
console.log('total screen extent      w=%s  h=%s', wTotal.toFixed(1), hTotal.toFixed(1));
console.log('poleward edge height     %s px', hPole.toFixed(1));
console.log('equatorward edge height  %s px', hEq.toFixed(1));
console.log('ratio pole/equator       %s   (expected < 1)', (hPole / hEq).toFixed(3));

// Analytic expectation on the SPHERE (c=b limit along v): an edge of
// arc height 2*half sitting on the circle of radius r=sin(u)*b spans
// half-angle D=half/r and draws 2*r*sin(D) tall on screen at v0=pi/2.
function edgeHeightAt(u) {
  const r = Math.sin(u) * b;
  const dHalf = half / r;
  return 2 * r * Math.sin(dHalf);
}
// Where do the two edges actually sit in u? Walk sampleAt along ny=0.
function uAtNx(target) {
  // bisect along the front meridian row (y such that v=pi/2 -> y=0? no:
  // v=pi/2 => Y=0). March x at y=0.
  let bestU = null, bestD = Infinity;
  for (let x = -a; x <= a; x += 0.25) {
    const surf = D.unproject(x, 0, a, b);
    if (!surf) continue;
    const q = D.sampleAt(surf.u, surf.v, u0, v0, rot, a, b);
    const nx = q.x / half;
    const d = Math.abs(nx - target);
    if (d < bestD) { bestD = d; bestU = surf.u; }
  }
  return bestU;
}
const uPole = uAtNx(1), uEq = uAtNx(-1);
console.log('edge u positions         pole %s  equator %s', uPole.toFixed(3), uEq.toFixed(3));
console.log('analytic edge heights    pole %s  equator %s  ratio %s',
  edgeHeightAt(uPole).toFixed(1), edgeHeightAt(uEq).toFixed(1),
  (edgeHeightAt(uPole) / edgeHeightAt(uEq)).toFixed(3));