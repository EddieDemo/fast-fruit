// verify-decals-truegeo.js
// Ground truth for the flag-edge report: the TRUE exponential map on
// the spheroid, computed by shooting geodesics numerically (constrained
// 3D integration: step, re-project point to surface, re-project
// velocity to tangent, renormalise). Compare the projected heights of
// a square sticker's poleward and equatorward edges under
//   (a) the true exp map, and
//   (b) sampleAt's unit-sphere-great-circle stand-in,
// at the same placement used in verify-decals-flagedge.js.

global.window = { FF: {} };
require('/home/claude/ff/js/decals.js');
const D = window.FF.decals;

const a = 128 * 1.28, b = 128, c = b;
const u0 = 0.65, v0 = Math.PI / 2;
const s = 0.30, half = s * b;

// --- surface helpers ---
function toSurface(p) {
  // Newton on f(t): point scaled toward surface along the normal-ish
  // radial: simplest robust projection — scale so the implicit eq = 1.
  // (Adequate: steps are tiny, drift is tiny.)
  const f = Math.sqrt((p.x / a) ** 2 + (p.y / b) ** 2 + (p.z / c) ** 2);
  return { x: p.x / f, y: p.y / f, z: p.z / f };
}
function normalAt(p) {
  const n = { x: p.x / (a * a), y: p.y / (b * b), z: p.z / (c * c) };
  const l = Math.hypot(n.x, n.y, n.z);
  return { x: n.x / l, y: n.y / l, z: n.z / l };
}
function tangentialize(vel, p) {
  const n = normalAt(p);
  const d = vel.x * n.x + vel.y * n.y + vel.z * n.z;
  return { x: vel.x - d * n.x, y: vel.y - d * n.y, z: vel.z - d * n.z };
}
// Shoot a geodesic of arc length L from point p0 with unit tangent dir.
function shoot(p0, dir, L) {
  const STEPS = Math.max(64, Math.ceil(L / 0.25));
  const h = L / STEPS;
  let p = { ...p0 }, v = { ...dir };
  for (let i = 0; i < STEPS; i++) {
    p = toSurface({ x: p.x + v.x * h, y: p.y + v.y * h, z: p.z + v.z * h });
    v = tangentialize(v, p);
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    v = { x: v.x / l, y: v.y / l, z: v.z / l };
  }
  return p;
}

// centre point and REAL orthonormal frame (same as tangentsAt)
const su = Math.sin(u0), cu = Math.cos(u0), sv = Math.sin(v0), cv = Math.cos(v0);
const p0 = { x: cu * a, y: cv * su * b, z: sv * su * c };
const { tu, tv } = D.tangentsAt(u0, v0, a, b);

// exp map: sticker coords (sx, sy) -> 3D point
function expMap(sx, sy) {
  const rho = Math.hypot(sx, sy);
  if (rho < 1e-9) return p0;
  const ct = sx / rho, st = sy / rho;
  let dir = {
    x: ct * tu.x + st * tv.x,
    y: ct * tu.y + st * tv.y,
    z: ct * tu.z + st * tv.z,
  };
  dir = tangentialize(dir, p0);
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
  return shoot(p0, dir, rho);
}

function edgeHeight(sx) {
  let lo = Infinity, hi = -Infinity;
  for (let t = -1; t <= 1.0001; t += 0.05) {
    const p = expMap(sx, t * half);
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  return hi - lo;
}
function edgeHeightSampleAt(sxTarget) {
  // Invert sampleAt numerically: find surface (u,v) whose sticker
  // coords are (sxTarget, sy) for sweeps of sy, record projected Y.
  let lo = Infinity, hi = -Infinity;
  const N = 400;
  for (let iu = 0; iu <= N; iu++) for (let iv = 0; iv <= N; iv++) {
    const u = 0.02 + (Math.PI - 0.04) * iu / N;
    const v = 0.02 + (Math.PI - 0.04) * iv / N;
    const q = D.sampleAt(u, v, u0, v0, 0, a, b);
    if (Math.abs(q.x - sxTarget) > half * 0.04) continue;
    if (Math.abs(q.y) > half) continue;
    const Y = Math.cos(v) * Math.sin(u) * b;
    if (Y < lo) lo = Y;
    if (Y > hi) hi = Y;
  }
  return hi - lo;
}

console.log('placement u0=%s v0=pi/2, a/b=%s, half=%s px', u0, (a / b).toFixed(2), half);
const tP = edgeHeight(+half), tE = edgeHeight(-half);
console.log('TRUE exp map     pole edge h=%s  equator edge h=%s  ratio=%s',
  tP.toFixed(1), tE.toFixed(1), (tP / tE).toFixed(3));
const sP = edgeHeightSampleAt(+half), sE = edgeHeightSampleAt(-half);
console.log('sampleAt         pole edge h=%s  equator edge h=%s  ratio=%s',
  sP.toFixed(1), sE.toFixed(1), (sP / sE).toFixed(3));

// Also: corner positions, true vs sampleAt-inverted, to localise error.
for (const [sx, sy, name] of [[half, half, 'pole-bottom'], [-half, half, 'eq-bottom']]) {
  const p = expMap(sx, sy);
  console.log('corner %s  true (x,y)=(%s, %s)', name.padEnd(12), p.x.toFixed(1), p.y.toFixed(1));
}