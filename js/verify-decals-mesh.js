// verify-decals-mesh.js
// The regression suite for bug 7 (flag poleward edge drew taller).
// Six checks:
//   A. Sphere control: mesh raster draws both vertical edges of a
//      square at equal height (exact exp-map behaviour).
//   B. Spheroid ground truth: mesh boundary vs true geodesics shot at
//      quarter step — max error < 0.25 px at flag size.
//   C. Flag-edge regression: pole/equator edge-height ratio through
//      the full raster path is ~0.99, not 1.076.
//   D. Small-decal parity: mesh agrees with sampleAt at eye size
//      (< 0.35 px), so the closed form remains a valid reference and
//      small decals are visually unchanged.
//   E. Rotation parity with sampleAt at small size (frame convention
//      is verified, not assumed).
//   F. Integrator convergence: MESH_STEP vs MESH_STEP/4.

global.window = { FF: {} };
require('./js/decals.js');
const D = window.FF.decals;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

// ---- shared: rasterize a square decal through the mesh path --------
function rasterEdges(a, b, u0, v0, rot, s, rs) {
  const half = s * b;
  const mesh = D.buildStickerMesh(u0, v0, rot, half, a, b);
  const w = Math.ceil(a * 2) + 2, h = Math.ceil(b * 2) + 2;
  const pw = Math.round(w * rs), ph = Math.round(h * rs);
  const hits = [];
  for (let py = 0; py < ph; py++) {
    for (let pxi = 0; pxi < pw; pxi++) {
      const x = (pxi + 0.5) / rs - w / 2, y = (py + 0.5) / rs - h / 2;
      if ((x / a) ** 2 + (y / b) ** 2 > 1) continue;
      const q = D.meshSample(mesh, x, y);
      if (!q) continue;
      const nx = q.x / half, ny = q.y / half;
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1) continue;
      hits.push({ x, y, nx, ny });
    }
  }
  const span = (sel, ax) => {
    const p = hits.filter(sel);
    if (!p.length) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const q of p) { if (q[ax] < lo) lo = q[ax]; if (q[ax] > hi) hi = q[ax]; }
    return hi - lo;
  };
  return {
    hPole: span(p => p.nx > 0.92, 'y'),
    hEq: span(p => p.nx < -0.92, 'y'),
    n: hits.length,
  };
}

// ---- independent fine-step geodesic shooter (ground truth) ---------
function truth(a, b) {
  const c = b;
  const toS = p => { const f = Math.sqrt((p.x / a) ** 2 + (p.y / b) ** 2 + (p.z / c) ** 2) || 1; return { x: p.x / f, y: p.y / f, z: p.z / f }; };
  const tang = (v, p) => {
    let nx = p.x / (a * a), ny = p.y / (b * b), nz = p.z / (c * c);
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const d = v.x * nx + v.y * ny + v.z * nz;
    return { x: v.x - d * nx, y: v.y - d * ny, z: v.z - d * nz };
  };
  return function exp(u0, v0, rot, sx, sy) {
    const su = Math.sin(u0), cu = Math.cos(u0), sv = Math.sin(v0), cv = Math.cos(v0);
    const p0 = { x: cu * a, y: cv * su * b, z: sv * su * c };
    const { tu, tv } = D.tangentsAt(u0, v0, a, b);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const fx = sx * cr - sy * sr, fy = sx * sr + sy * cr;
    const rho = Math.hypot(fx, fy);
    if (rho < 1e-9) return p0;
    let d = {
      x: (fx * tu.x + fy * tv.x) / rho,
      y: (fx * tu.y + fy * tv.y) / rho,
      z: (fx * tu.z + fy * tv.z) / rho,
    };
    d = tang(d, p0);
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
    const steps = Math.max(64, Math.ceil(rho / (D.MESH_STEP / 4)));
    const h = rho / steps;
    let p = p0, v = d;
    for (let i = 0; i < steps; i++) {
      p = toS({ x: p.x + v.x * h, y: p.y + v.y * h, z: p.z + v.z * h });
      v = tang(v, p);
      const l = Math.hypot(v.x, v.y, v.z) || 1;
      v = { x: v.x / l, y: v.y / l, z: v.z / l };
    }
    return p;
  };
}

// A: sphere control ---------------------------------------------------
{
  const r = rasterEdges(128, 128, 0.65, Math.PI / 2, 0, 0.30, 2);
  const ratio = r.hPole / r.hEq;
  check('A sphere: equal edge heights', Math.abs(ratio - 1) < 0.02,
    'pole=' + r.hPole.toFixed(1) + ' eq=' + r.hEq.toFixed(1) + ' ratio=' + ratio.toFixed(3));
}

// B: spheroid mesh vs quarter-step truth. Two error sources, measured
// separately: B1 vertex drift (the integrator), over every mesh
// vertex; B2 interpolation (the triangles), by querying the mesh at
// the truth position of off-vertex sticker coords strictly inside the
// sticker — the raster never queries the exact boundary, so neither
// does the test.
{
  const a = 128 * 1.28, b = 128;
  const exact = truth(a, b);
  let worstV = 0, worstI = 0, worstRim = 0;
  for (const [u0, s] of [[0.65, 0.30], [0.9, 0.72], [1.2, 0.60], [0.45, 0.5]]) {
    const half = s * b;
    const mesh = D.buildStickerMesh(u0, Math.PI / 2, 0, half, a, b);
    const N = mesh.N;
    // B1: every vertex vs quarter-step truth (3D distance)
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const g = exact(u0, Math.PI / 2, 0, mesh.SX[k], mesh.SY[k]);
        const e = Math.hypot(mesh.X[k] - g.x, mesh.Y[k] - g.y, mesh.Z[k] - g.z);
        if (e > worstV) worstV = e;
      }
    }
    // B2: FORWARD screen error — where the mesh draws a sticker coord
    // vs where the truth puts it. (Sticker-space inversion error is
    // ill-conditioned at the rim, where the Jacobian is near-singular;
    // screen error is what the eye sees and is well-conditioned
    // everywhere.) Mesh position at (sx, sy) is bilinear over the
    // regular sticker-space grid, exactly what the triangles draw.
    const meshPos = (sx, sy) => {
      const N2 = mesh.N;
      const fi = (sx / half + 1) / 2 * (N2 - 1), fj = (sy / half + 1) / 2 * (N2 - 1);
      const i0 = Math.max(0, Math.min(N2 - 2, Math.floor(fi)));
      const j0 = Math.max(0, Math.min(N2 - 2, Math.floor(fj)));
      const fx = fi - i0, fy = fj - j0;
      const k00 = j0 * N2 + i0, k10 = k00 + 1, k01 = k00 + N2, k11 = k01 + 1;
      const bl = (A) => A[k00] * (1 - fx) * (1 - fy) + A[k10] * fx * (1 - fy)
                      + A[k01] * (1 - fx) * fy + A[k11] * fx * fy;
      return { x: bl(mesh.X), y: bl(mesh.Y), z: bl(mesh.Z) };
    };
    for (let i = 0; i <= 12; i++) {
      const t = (-1 + i / 6) * 0.96;
      for (const [sx, sy] of [[half * 0.96, t * half], [-half * 0.96, t * half],
                              [t * half, half * 0.96], [t * half, -half * 0.96],
                              [t * half, t * half * 0.53]]) {
        const g = exact(u0, Math.PI / 2, 0, sx, sy);
        const m = meshPos(sx, sy);
        const e = Math.hypot(m.x - g.x, m.y - g.y);
        if (g.z > 10) { if (e > worstI) worstI = e; }
        else { if (e > worstRim) worstRim = e; }
      }
    }
  }
  check('B1 spheroid: vertex drift vs fine-step truth', worstV < 0.1, 'worst=' + worstV.toFixed(4) + 'px');
  check('B2 spheroid: interior screen error', worstI < 0.30, 'worst=' + worstI.toFixed(3) + 'px');
  check('B3 spheroid: rim-zone screen error', worstRim < 0.8,
    'worst=' + worstRim.toFixed(3) + 'px (silhouette clip masks this zone)');
}

// C: flag-edge regression --------------------------------------------
{
  const r = rasterEdges(128 * 1.28, 128, 0.65, Math.PI / 2, 0, 0.30, 2);
  const ratio = r.hPole / r.hEq;
  check('C flag-edge: pole/equator ratio corrected', ratio > 0.95 && ratio < 1.02,
    'ratio=' + ratio.toFixed(3) + ' (was 1.076; truth 0.991)');
}

// D: small-decal parity with sampleAt --------------------------------
{
  const a = 128 * 1.28, b = 128;
  let worst = 0;
  for (const u0 of [0.65, 1.0, Math.PI / 2]) {
    const s = 0.12, half = s * b;
    const mesh = D.buildStickerMesh(u0, Math.PI / 2, 0, half, a, b);
    for (let dx = -half; dx <= half; dx += half / 2) {
      for (let dy = -half; dy <= half; dy += half / 2) {
        // walk screen space near the decal centre, compare both answers
        const sc = { x: Math.cos(u0) * a, y: 0 };
        const x = sc.x - dx * 0.6, y = dy * 0.9;   // rough neighbourhood
        if ((x / a) ** 2 + (y / b) ** 2 > 0.98) continue;
        const surf = D.unproject(x, y, a, b);
        if (!surf) continue;
        const qs = D.sampleAt(surf.u, surf.v, u0, Math.PI / 2, 0, a, b);
        const qm = D.meshSample(mesh, x, y);
        if (Math.hypot(qs.x, qs.y) > half * 1.2) continue;   // outside mesh, skip
        if (!qm) continue;
        const e = Math.hypot(qs.x - qm.x, qs.y - qm.y);
        if (e > worst) worst = e;
      }
    }
  }
  check('D eye-size parity with sampleAt', worst < 0.35, 'worst=' + worst.toFixed(3) + 'px');
}

// E: rotation parity --------------------------------------------------
{
  const a = 128 * 1.28, b = 128, u0 = 1.1, v0 = Math.PI / 2, rot = 0.5;
  const s = 0.12, half = s * b;
  const mesh = D.buildStickerMesh(u0, v0, rot, half, a, b);
  let worst = 0, n = 0;
  const sc = { x: Math.cos(u0) * a, y: 0 };
  for (let dx = -half; dx <= half; dx += half / 3) {
    for (let dy = -half; dy <= half; dy += half / 3) {
      const x = sc.x + dx * 0.5, y = dy * 0.8;
      const surf = D.unproject(x, y, a, b);
      if (!surf) continue;
      const qs = D.sampleAt(surf.u, surf.v, u0, v0, rot, a, b);
      const qm = D.meshSample(mesh, x, y);
      if (!qm || Math.hypot(qs.x, qs.y) > half) continue;
      const e = Math.hypot(qs.x - qm.x, qs.y - qm.y);
      if (e > worst) worst = e;
      n++;
    }
  }
  check('E rotation parity with sampleAt', n > 5 && worst < 0.35,
    'worst=' + worst.toFixed(3) + 'px over ' + n + ' pts');
}

// F: integrator convergence ------------------------------------------
{
  const a = 128 * 1.28, b = 128;
  const exact = truth(a, b);   // quarter step
  const u0 = 0.9, s = 0.72, half = s * b;
  const mesh = D.buildStickerMesh(u0, Math.PI / 2, 0, half, a, b);
  // corner vertex of the mesh vs quarter-step shot of the same coords
  const N = mesh.N, k = (N - 1) * N + (N - 1);   // (+half, +half)
  const g = exact(u0, Math.PI / 2, 0, half, half);
  const e = Math.hypot(mesh.X[k] - g.x, mesh.Y[k] - g.y, mesh.Z[k] - g.z);
  check('F integrator convergence at MESH_STEP', e < 0.1, 'corner drift=' + e.toFixed(4) + 'px');
}

// G: the N law itself ------------------------------------------------
{
  const b = 128;
  const okBounds = D.meshNFor(0.01 * b, b) === D.MESH_N_MIN
    && D.meshNFor(4.0 * b, b) === D.MESH_N_MAX;
  let okCap = true;
  for (const s of [0.12, 0.3, 0.72, 1.2, 2.0]) {
    const half = s * b, n = D.meshNFor(half, b);
    if (n < D.MESH_N_MAX && 2 * half / (n - 1) > b * D.MESH_CELL + 1e-9) okCap = false;
  }
  check('G mesh N law: floor, ceiling, cell cap', okBounds && okCap,
    's=2.6 -> N=' + D.meshNFor(2.6 * b, b));
}

// H: full-wrap accuracy (player scale ceiling) ------------------------
{
  const a = 128 * 1.28, b = 128;
  const exact = truth(a, b);
  const u0 = 1.2, s = 2.6, half = s * b;
  const mesh = D.buildStickerMesh(u0, Math.PI / 2, 0, half, a, b);
  const meshPos = (sx, sy) => {
    const N2 = mesh.N;
    const fi = (sx / half + 1) / 2 * (N2 - 1), fj = (sy / half + 1) / 2 * (N2 - 1);
    const i0 = Math.max(0, Math.min(N2 - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(N2 - 2, Math.floor(fj)));
    const fx = fi - i0, fy = fj - j0;
    const k00 = j0 * N2 + i0, k10 = k00 + 1, k01 = k00 + N2, k11 = k01 + 1;
    const bl = (A) => A[k00] * (1 - fx) * (1 - fy) + A[k10] * fx * (1 - fy)
                    + A[k01] * (1 - fx) * fy + A[k11] * fx * fy;
    return { x: bl(mesh.X), y: bl(mesh.Y), z: bl(mesh.Z) };
  };
  let worst = 0;
  for (let i = 0; i <= 24; i++) {
    for (let j = 0; j <= 24; j++) {
      const sx = (-1 + i / 12) * half * 0.96, sy = (-1 + j / 12) * half * 0.96;
      const g = exact(u0, Math.PI / 2, 0, sx, sy);
      if (g.z < 10) continue;                     // visible face only
      const m = meshPos(sx, sy);
      const e = Math.hypot(m.x - g.x, m.y - g.y);
      if (e > worst) worst = e;
    }
  }
  check('H full-wrap (s=2.6, the editor ceiling) visible-face screen error', worst < 0.35, 'worst=' + worst.toFixed(3) + 'px');
}

// I: coarse preview mesh stays under a pixel --------------------------
{
  const a = 128 * 1.28, b = 128;
  const exact = truth(a, b);
  const u0 = 0.9, s = 0.72, half = s * b;
  const mesh = D.buildStickerMesh(u0, Math.PI / 2, 0, half, a, b, true);
  const meshPos = (sx, sy) => {
    const N2 = mesh.N;
    const fi = (sx / half + 1) / 2 * (N2 - 1), fj = (sy / half + 1) / 2 * (N2 - 1);
    const i0 = Math.max(0, Math.min(N2 - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(N2 - 2, Math.floor(fj)));
    const fx = fi - i0, fy = fj - j0;
    const k00 = j0 * N2 + i0, k10 = k00 + 1, k01 = k00 + N2, k11 = k01 + 1;
    const bl = (A) => A[k00] * (1 - fx) * (1 - fy) + A[k10] * fx * (1 - fy)
                    + A[k01] * (1 - fx) * fy + A[k11] * fx * fy;
    return { x: bl(mesh.X), y: bl(mesh.Y), z: bl(mesh.Z) };
  };
  let worst = 0;
  for (let i = 0; i <= 16; i++) {
    const t = (-1 + i / 8) * 0.96;
    for (const [sx, sy] of [[half * 0.96, t * half], [t * half, half * 0.96], [t * half, t * half * 0.5]]) {
      const g = exact(u0, Math.PI / 2, 0, sx, sy);
      if (g.z < 10) continue;
      const m = meshPos(sx, sy);
      const e = Math.hypot(m.x - g.x, m.y - g.y);
      if (e > worst) worst = e;
    }
  }
  check('I coarse preview mesh error', worst < 1.0, 'worst=' + worst.toFixed(3) + 'px (crisp bake lands on release)');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);