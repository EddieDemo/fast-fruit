(function () {
'use strict';
// ============================================================
// DECALS — what a melon is wearing, and where.
//
// THE JOKE THIS PROTECTS (Eddie, 2026-08-14). The comedy is not
// "melons are characters". It is that EVERYONE IN THIS WORLD TREATS
// MELONS AS CHARACTERS WHILE THE MELONS REMAIN RESOLUTELY FRUIT. The
// game says "release this melon" with a straight face. Give a melon
// eyes and the game has admitted the joke; the deadpan collapses.
// But let a PLAYER stick googly eyes onto their melon and the melon
// is still just a melon — now with googly eyes on it, which is
// funnier, because a person did that on purpose.
//
// So: no authored faces, ever. Decoration is something the player
// applies, and it is what marks a melon as OWNED.
//
// LAWS
//   * PRESENTATION ONLY. A decal must never touch physics — no mass,
//     no collision, no effect on any law. This is a game whose entire
//     thesis is uniform laws; a hat with mass would be a genuine
//     violation, and a cosmetic that changed handling would be
//     pay-to-win in a game that cannot afford it.
//   * DECALS ROTATE WITH THE BODY. They are stuck to a spinning
//     fruit, so they spin with it. Nothing floats level above a
//     melon's "head": that is the line between a physics racer and a
//     cartoon.
//   * THEY LIVE ON THE MELON, NOT THE PLAYER. Gerald wears the
//     sunglasses; the melon you won yesterday does not. A released
//     melon takes its outfit with it, which is meant to sting.
//   * BOTS WEAR AT MOST ONE, AND MOST WEAR NONE. Enough to show the
//     feature exists and to sharpen a character (Ten Ton Tessie in
//     crash-test markings, Second Place Steve wearing a 2). Dress the
//     whole grid and the fruit-first deadpan dies.
//   * NOTHING A BOT WEARS IS UNOBTAINABLE. The moment a bot has an
//     item the player cannot win, the wardrobe becomes costume.
//
// RARITY IS ARITHMETIC, NOT A GRADE. There are no tiers: a
// "legendary" moustache is a worse joke than a moustache. Scarcity
// comes from SET SIZE — a flag set with fifty members makes any one
// flag rare by counting, while an eye set of eight completes quickly.
// A uniform law rather than a per-item stat, and it avoids the
// casino grammar entirely.
//
// ITEMS ARE UNLIMITED ONCE OWNED. You do not own "a star sticker",
// you own THE star sticker, and you may apply it to as many melons as
// you like as often as you like. That deletes the duplicate problem:
// an award is always something new or nothing.
//
// NEVER GRANT A PAIR. Eyes are handed out one at a time, always — a
// one-eyed melon is a better joke than a two-eyed one, and hunting a
// matching second eye is a reason to race that costs nothing to
// build.
// ============================================================

// ---- PLACEMENT: the stored form of "where is it stuck" -------------
//
// A decal's position is stored in SURFACE coordinates, not screen
// coordinates, and this is the decision that has to be right on day
// one: seeded placement and (later) drag-to-place must produce the
// SAME stored shape, so adding the placement UI is a UI job rather
// than a migration.
//
//   u    longitude on the spheroid, 0..PI (0 = left rim, PI = right)
//   v    latitude,  0..PI (0 = top, PI = bottom)
//   rot  the decal's own roll on the surface, radians
//   s    scale, as a fraction of the body's semi-minor axis
//
// WHY SPHEROID COORDINATES. The rind pattern already treats the body
// as a spheroid and unprojects each pixel through
// u = acos(x/a), phi = acos((y/b)/sin u) — so a decal expressed the
// same way inherits exact foreshortening for free: it compresses
// toward the rim and stretches at the centre, as something stuck to a
// curved surface must. Store a screen offset instead and stickers
// look pasted onto the camera rather than onto fruit, which is
// precisely the "cutesy" failure the whole feature is avoiding.
//
// The body rotates in the screen plane (it rolls like a wheel), so
// the visible hemisphere never changes and the decal simply turns
// with the body — the raster is built once in body space and rotated,
// exactly as the rind is.

// Forward projection: surface (u, v) -> body-space pixel offset.
// The inverse of the renderer's unprojection, so the two cannot
// disagree about where a point on the surface is.
//
// The body is an ellipsoid with semi-axes a (screen x, the long
// axis), b (screen y) and c (depth). It is a spheroid of revolution
// about the long axis — that is what rolling means — so c = b.
//
//   X =  cos(u) · a
//   Y =  cos(v) · sin(u) · b
//   Z =  sin(v) · sin(u) · c     (towards the viewer; dropped on screen)
//
// THE SIGN MATTERS AND IT IS NOT FREE TO CHOOSE. The renderer
// unprojects with u = acos(x/a) (buildMarbleStripes), which IMPLIES
// x = +a·cos(u). An earlier version of this file wrote x = -a·cos(u),
// so the two disagreed and every decal landed mirrored: numbers came
// out backwards while symmetric art looked perfectly fine, which is
// the worst kind of bug — invisible on most of the catalogue.
function project(u, v, a, b) {
  return { x: Math.cos(u) * a, y: Math.cos(v) * Math.sin(u) * b };
}

// ---- HOW A DECAL IS DRAWN: PER PIXEL, NOT PER SHAPE ---------------
//
// A decal is NOT transformed as a shape. It is sampled per pixel,
// exactly the way buildMarbleStripes builds the rind: every pixel of
// the body is unprojected to its surface point, and the decal answers
// "am I here, and where in my own art?".
//
// TWO EARLIER ATTEMPTS WERE WRONG, both instructively:
//
//   1. A SCALAR foreshorten, squashing the decal toward the body
//      centre. Wrong because a spheroid compresses ANISOTROPICALLY —
//      near the pointy ends only horizontally, near the girth only
//      vertically. It also happened to look correct in the first
//      proof, because every test decal sat on a principal axis where
//      the radial direction coincides with the true one. A proof
//      whose cases cannot fail proves nothing.
//
//   2. An AFFINE transform from the surface Jacobian. Correct to
//      first order and genuinely better — it got the two-axis
//      compression and the shear — but an affine map is a flat
//      parallelogram tangent at one point, so the decal's straight
//      edges stayed straight. A sticker on a curved body BOWS: its
//      edges become arcs. At any real sticker size the flatness is
//      the thing the eye notices, and it reads as a card floating on
//      an angled plane rather than something plastered on.
//
// The honest method is geodesic: measure the arc distance and
// direction from the decal's centre to the surface point, on the
// unit sphere the body is a scaled copy of, and use that as texture
// coordinates. Straight lines in sticker space then become curves on
// screen, which is what being stuck to a curved thing means.

// The surface point in REAL body units (pixels).
function pointAt(u, v, a, b) {
  const su = Math.sin(u), c = b;   // spheroid of revolution: depth = b
  return { x: Math.cos(u) * a, y: Math.cos(v) * su * b, z: Math.sin(v) * su * c };
}

// The same point on the UNIT sphere the body is a scaled copy of.
// Paths are constructed here and then measured on the real body.
function unitAt(u, v) {
  const su = Math.sin(u);
  return { x: Math.cos(u), y: Math.cos(v) * su, z: Math.sin(v) * su };
}

// Orthonormal tangent frame at (u, v), in real units, oriented as
// SCREEN RIGHT and SCREEN DOWN.
//
// Raw parameter derivatives point left and up (X = a·cos u falls as u
// grows; Y = b·cos v·sin u falls as v grows), and art is written the
// way images are — x right, y down. Negating here once means no art
// routine has to remember, and it is why an earlier version rendered
// every number backwards and swapped grin with frown.
function tangentsAt(u, v, a, b) {
  const su = Math.sin(u), cu = Math.cos(u), sv = Math.sin(v), cv = Math.cos(v);
  const c = b;
  const norm = (t) => {
    const l = Math.sqrt(t.x * t.x + t.y * t.y + t.z * t.z) || 1;
    return { x: t.x / l, y: t.y / l, z: t.z / l };
  };
  return {
    tu: norm({ x: a * su, y: -b * cv * cu, z: -c * sv * cu }),  // screen right
    tv: norm({ x: 0, y: b * sv * su, z: -c * cv * su }),        // screen down
  };
}

// ---- THE SAMPLING FUNCTION -----------------------------------------
// Where does surface point (u, v) fall inside a decal centred at
// (u0, v0)? Returns the offset in PIXELS OF ARC ALONG THE SURFACE,
// resolved onto the decal's own axes — Riemannian normal coordinates,
// which is the honest model of a sticker.
//
// A STICKER IS INEXTENSIBLE. Equal distances in sticker space must be
// equal ARC LENGTHS on the body.
//
// WHAT FORESHORTENING ACTUALLY LOOKS LIKE, corrected after bug 7: it
// is RADIAL, not uniform. On a sphere the exact exponential map keeps
// a sticker's tangential extent — a circle printed near a ball's rim
// projects as an ellipse squished only toward the rim, never along
// it, so the two side edges of a square sticker draw the SAME height.
// An earlier version of this comment claimed the far edge draws
// shorter; that intuition belongs to latitude-aligned rectangles
// (countries on a globe), not to stickers, and believing it is partly
// why bug 7 went unnoticed.
//
// TWO EARLIER VERSIONS EACH GOT HALF OF THIS, and it is worth knowing
// which half, because the failures look similar:
//
//   * ANGLE ON THE UNIT SPHERE. Arc-correct on a sphere, but the body
//     is a spheroid with a/b about 1.28, so every decal came out
//     stretched sideways by exactly that ratio (measured: 1.276).
//
//   * CHORD PROJECTED ONTO THE TANGENT PLANE. True proportions at the
//     centre, but a chord SATURATES as the surface bends away: points
//     further round project to nearly the same tangent coordinate, so
//     the sticker stretched around the curve and its far edge drew the
//     SAME length as its near edge. Visibly wrong — a sticker cannot
//     stretch.
//
// The path from centre to point is the great circle of the underlying
// sphere, measured on the REAL body: its length is integrated with the
// semi-axes applied, so it is arc length on the spheroid rather than
// an angle. It is exact in both limits — a sphere, and a vanishing
// patch.
//
// BUG 7, THE ONE THIS FUNCTION STILL CONTAINS: between those limits
// the stand-in path is not a geodesic, and scaling it anisotropically
// onto the body ROTATES ITS INITIAL HEADING, so off-axis points get
// their (sx, sy) split mis-assigned. The error vanishes at the girth
// and grows toward the poles, and it grows superquadratically with
// decal size: ~0.3px at eye size, ~2px at base marking size, 5-13px
// at flag size (b = 128), where it drew the poleward edge of the flag
// ~8% TALLER than the equatorward edge. Ground truth (shooting true
// geodesics on the spheroid) says the two edges are near-equal, the
// poleward one marginally SHORTER. Eddie saw it on the flag.
// Regression pair: verify-decals-flagedge.js, verify-decals-truegeo.js.
//
// THE RENDERER THEREFORE DOES NOT SAMPLE THROUGH THIS FUNCTION.
// It samples through buildStickerMesh below, which shoots the true
// geodesics once at bake time. sampleAt is kept as the closed-ish
// small-patch REFERENCE — the two must agree in the small-decal limit
// (verify-decals-mesh.js checks this) — and for callers that need a
// cheap answer for a tiny patch.
const ARC_STEPS = 8;   // Simpson intervals; error below a thousandth here

function sampleAt(u, v, u0, v0, rot, a, b) {
  const c = b;
  const p0 = unitAt(u0, v0), p1 = unitAt(u, v);
  let dot = p0.x * p1.x + p0.y * p1.y + p0.z * p1.z;
  dot = Math.max(-1, Math.min(1, dot));
  const ang = Math.acos(dot);
  if (ang < 1e-7) return { x: 0, y: 0 };
  const sa = Math.sin(ang);
  if (sa < 1e-9) return { x: 0, y: 0 };

  // Speed along the great-circle path, measured on the real body.
  const speed = (t) => {
    const w0 = -ang * Math.cos((1 - t) * ang) / sa;
    const w1 = ang * Math.cos(t * ang) / sa;
    const dx = (p0.x * w0 + p1.x * w1) * a;
    const dy = (p0.y * w0 + p1.y * w1) * b;
    const dz = (p0.z * w0 + p1.z * w1) * c;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  // Composite Simpson over [0,1].
  let arc = speed(0) + speed(1);
  for (let i = 1; i < ARC_STEPS; i++) {
    arc += speed(i / ARC_STEPS) * (i % 2 ? 4 : 2);
  }
  arc *= 1 / (3 * ARC_STEPS);

  // Initial heading of that path, in the real tangent frame at the
  // centre: the DIRECTION the sticker's ink runs from its middle.
  const h0 = -ang * Math.cos(ang) / sa, h1 = ang / sa;
  const hx = (p0.x * h0 + p1.x * h1) * a;
  const hy = (p0.y * h0 + p1.y * h1) * b;
  const hz = (p0.z * h0 + p1.z * h1) * c;
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  const { tu, tv } = tangentsAt(u0, v0, a, b);
  const cu2 = (hx * tu.x + hy * tu.y + hz * tu.z) / hl;
  const cv2 = (hx * tv.x + hy * tv.y + hz * tv.z) / hl;

  let sx = arc * cu2, sy = arc * cv2;
  if (rot) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const rx = sx * cr + sy * sr;
    sy = -sx * sr + sy * cr;
    sx = rx;
  }
  return { x: sx, y: sy };
}

// The inverse of the renderer's own unprojection, kept so a caller
// with a surface point can find its pixel (placement UI, hit-testing).
function unproject(px, py, a, b) {
  const ex = px / a, ey = py / b;
  if (ex * ex + ey * ey > 1) return null;
  const u = Math.acos(Math.max(-1, Math.min(1, ex)));
  const su = Math.sin(u);
  const k = su < 0.04 ? 0 : Math.max(-1, Math.min(1, ey / su));
  return { u, v: Math.acos(k) };
}

// How much the surface faces the viewer at (u, v): 1 head-on, 0
// edge-on. Used ONLY for culling and for dimming a decal as it turns
// away — never for shape, which is sampleAt's job.
function foreshorten(u, v) {
  return Math.max(0, Math.sin(u) * Math.sin(v));
}

// Is this point on the visible face at all? (Kept for when protruding
// objects land — a flat decal on the far side is simply not drawn.)
function visible(u, v) {
  return foreshorten(u, v) > 0.02;
}

// ---- THE STICKER MESH: TRUE GEODESICS, SHOT ONCE AT BAKE ----------
//
// The fix for bug 7. Instead of asking a closed-ish formula where a
// pixel falls inside the sticker, the sticker answers where IT falls
// on the body: the true exponential map is computed on an N x N grid
// of sticker coordinates by shooting real geodesics on the spheroid
// (constrained 3D integration — step, re-project the point to the
// surface, re-project the velocity to the tangent plane, renormalise),
// and each pixel is then read back through the mesh by point-in-
// triangle plus barycentric interpolation.
//
// This is exact up to two errors, both measured and bounded in
// verify-decals-mesh.js: the integrator step (fixed at MESH_STEP px of
// arc) and the within-cell affine interpolation, whose sagitta at flag
// size and N = 17 is ~0.13px. Total boundary error against a
// fine-step reference stays under a quarter pixel at the largest
// catalogue item — against the 5-13px the closed form was off by.
//
// Cost lives entirely at bake: ~N^2 geodesic shots per worn decal —
// measured ~2.5ms at flag size, far less for small items — cached
// with the raster. The per-pixel
// query (bucket lookup, a couple of triangle tests) is CHEAPER than
// sampleAt's nine-sample Simpson.
//
// DETERMINISM: fixed step counts derived from arc length, no
// randomness, no time. Same outfit, same mesh, every bake.
// MESH RESOLUTION IS A LAW, NOT A CONSTANT (2026-08-15, with player
// scaling): interpolation error grows with the square of cell arc, so
// N derives from the sticker's size — cells are capped at ~9% of b
// (12px on the b=128 reference, where the bound was measured), which
// holds visible-face screen error at or under 0.3px at ANY size the
// editor allows — measured at the cap and at the N ceiling, up to a
// flag wrapping the whole melon. The editor's ceiling is s = 2.6, set
// by the flag itself: flag art is letterboxed to 2:3 (half-height
// 0.62), so covering the quarter-meridian arc (~1.57b) vertically
// takes 2.6, not 2.0 — the whole-melon ruling means the WHOLE melon.
// The floor keeps tiny stickers from degenerating to a quad; the
// ceiling bounds bake cost. Preview meshes (live drag) run at double
// the cell cap — quarter the vertices, error still under a pixel —
// and the crisp bake lands on release.
const MESH_CELL = 0.094;  // max cell arc, as a fraction of b
const MESH_N_MIN = 9;
const MESH_N_MAX = 57;
const MESH_STEP = 1.0;    // integrator step, px of arc
const MESH_GRID = 24;     // spatial index resolution over the mesh bbox

function meshNFor(half, b, coarse) {
  const cap = b * MESH_CELL * (coarse ? 2 : 1);
  const n = Math.ceil(2 * half / cap) + 1;
  return Math.max(MESH_N_MIN, Math.min(MESH_N_MAX, n));
}

function surfProject(p, a, b, c) {
  // Pull a slightly-off point back to the surface along the radius.
  // First order, but steps are MESH_STEP long: drift is far below the
  // interpolation error, and the verify script measures the total.
  const f = Math.sqrt((p.x / a) ** 2 + (p.y / b) ** 2 + (p.z / c) ** 2) || 1;
  return { x: p.x / f, y: p.y / f, z: p.z / f };
}

function surfTangential(vel, p, a, b, c) {
  let nx = p.x / (a * a), ny = p.y / (b * b), nz = p.z / (c * c);
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const d = vel.x * nx + vel.y * ny + vel.z * nz;
  return { x: vel.x - d * nx, y: vel.y - d * ny, z: vel.z - d * nz };
}

function shootGeodesic(p0, dir, arcLen, a, b, c) {
  const steps = Math.max(8, Math.ceil(arcLen / MESH_STEP));
  const h = arcLen / steps;
  let p = p0, v = dir;
  for (let i = 0; i < steps; i++) {
    p = surfProject({ x: p.x + v.x * h, y: p.y + v.y * h, z: p.z + v.z * h }, a, b, c);
    v = surfTangential(v, p, a, b, c);
    const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    v = { x: v.x / l, y: v.y / l, z: v.z / l };
  }
  return p;
}

// Build the mesh for one worn decal. half is the sticker's half-size
// in px of arc (wd.s * b). Returns null if the whole sticker is on
// the far side.
// ONE POINT of a sticker on the body — the mesh's per-node maths for a
// single sticker-local (sx, sy), so a FEATURE (a pupil) can be found on
// the rolled body without rasterising anything (2026-09-04, the pupil
// guarantee). Body space, unrotated; z < 0 means the far side.
function stickerPoint(u0, v0, rot, half, a, b, sx, sy) {
  const c = b;
  const su = Math.sin(u0), cu = Math.cos(u0), sv = Math.sin(v0), cv = Math.cos(v0);
  const p0 = { x: cu * a, y: cv * su * b, z: sv * su * c };
  const { tu, tv } = tangentsAt(u0, v0, a, b);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const fx = sx * cr - sy * sr;
  const fy = sx * sr + sy * cr;
  const rho = Math.sqrt(fx * fx + fy * fy);
  if (rho < 1e-9) return p0;
  let d = {
    x: (fx * tu.x + fy * tv.x) / rho,
    y: (fx * tu.y + fy * tv.y) / rho,
    z: (fx * tu.z + fy * tv.z) / rho,
  };
  d = surfTangential(d, p0, a, b, c);
  const dl = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
  d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
  return shootGeodesic(p0, d, rho, a, b, c);
}
function buildStickerMesh(u0, v0, rot, half, a, b, coarse) {
  const c = b;
  const su = Math.sin(u0), cu = Math.cos(u0), sv = Math.sin(v0), cv = Math.cos(v0);
  const p0 = { x: cu * a, y: cv * su * b, z: sv * su * c };
  const { tu, tv } = tangentsAt(u0, v0, a, b);
  const cr = Math.cos(rot), sr = Math.sin(rot);

  const N = meshNFor(half, b, coarse), M = N * N;
  const X = new Float64Array(M), Y = new Float64Array(M), Z = new Float64Array(M);
  const SX = new Float64Array(M), SY = new Float64Array(M);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const sx = (i / (N - 1) * 2 - 1) * half;
      const sy = (j / (N - 1) * 2 - 1) * half;
      SX[k] = sx; SY[k] = sy;
      // Sticker coords -> frame vector. sampleAt outputs
      // out = [[cr, sr], [-sr, cr]] * frame, so the forward map is the
      // inverse: frame = [[cr, -sr], [sr, cr]] * out. Rotation parity
      // with sampleAt is verified, not assumed (verify-decals-mesh).
      const fx = sx * cr - sy * sr;
      const fy = sx * sr + sy * cr;
      const rho = Math.sqrt(fx * fx + fy * fy);
      if (rho < 1e-9) { X[k] = p0.x; Y[k] = p0.y; Z[k] = p0.z; continue; }
      let d = {
        x: (fx * tu.x + fy * tv.x) / rho,
        y: (fx * tu.y + fy * tv.y) / rho,
        z: (fx * tu.z + fy * tv.z) / rho,
      };
      d = surfTangential(d, p0, a, b, c);
      const dl = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
      d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
      const p = shootGeodesic(p0, d, rho, a, b, c);
      X[k] = p.x; Y[k] = p.y; Z[k] = p.z;
    }
  }

  // Triangles, front-pruned: a cell all of whose corners sit behind
  // the body (z < 0) can never be seen and is dropped. Cells that
  // straddle the silhouette are kept; the per-hit z test below rejects
  // the wrapped part pixel by pixel.
  const tris = [];
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const k00 = j * N + i, k10 = k00 + 1, k01 = k00 + N, k11 = k01 + 1;
      if (Z[k00] < 0 && Z[k10] < 0 && Z[k01] < 0 && Z[k11] < 0) continue;
      tris.push(k00, k10, k11, k00, k11, k01);
    }
  }
  if (!tris.length) return null;

  // Spatial index: bucket triangle bboxes over the mesh bbox so the
  // per-pixel query tests a couple of candidates, not every cell.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let t = 0; t < tris.length; t++) {
    const k = tris[t];
    if (X[k] < bx0) bx0 = X[k]; if (X[k] > bx1) bx1 = X[k];
    if (Y[k] < by0) by0 = Y[k]; if (Y[k] > by1) by1 = Y[k];
  }
  const G = MESH_GRID;
  const gw = (bx1 - bx0) || 1, gh = (by1 - by0) || 1;
  const buckets = new Array(G * G);
  const nt = tris.length / 3;
  for (let t = 0; t < nt; t++) {
    const ka = tris[t * 3], kb = tris[t * 3 + 1], kc = tris[t * 3 + 2];
    const tx0 = Math.min(X[ka], X[kb], X[kc]), tx1 = Math.max(X[ka], X[kb], X[kc]);
    const ty0 = Math.min(Y[ka], Y[kb], Y[kc]), ty1 = Math.max(Y[ka], Y[kb], Y[kc]);
    const gi0 = Math.max(0, Math.floor((tx0 - bx0) / gw * G));
    const gi1 = Math.min(G - 1, Math.floor((tx1 - bx0) / gw * G));
    const gj0 = Math.max(0, Math.floor((ty0 - by0) / gh * G));
    const gj1 = Math.min(G - 1, Math.floor((ty1 - by0) / gh * G));
    for (let gj = gj0; gj <= gj1; gj++) {
      for (let gi = gi0; gi <= gi1; gi++) {
        const bi = gj * G + gi;
        (buckets[bi] || (buckets[bi] = [])).push(t);
      }
    }
  }
  return { X, Y, Z, SX, SY, tris, buckets, bx0, by0, gw, gh, half, N };
}

// Where does body pixel (x, y) fall inside the sticker? Returns the
// offset in px of arc — same contract as sampleAt — or null. The
// barycentric solve accepts flipped triangles (a cell folded at the
// silhouette still answers); the interpolated z rejects the far side.
function meshSample(mesh, x, y) {
  if (!mesh) return null;
  const G = MESH_GRID;
  const gi = Math.floor((x - mesh.bx0) / mesh.gw * G);
  const gj = Math.floor((y - mesh.by0) / mesh.gh * G);
  if (gi < 0 || gi >= G || gj < 0 || gj >= G) return null;
  const cand = mesh.buckets[gj * G + gi];
  if (!cand) return null;
  const { X, Y, Z, SX, SY, tris } = mesh;
  const EPS = 1e-4;
  for (let n = 0; n < cand.length; n++) {
    const t = cand[n] * 3;
    const ka = tris[t], kb = tris[t + 1], kc = tris[t + 2];
    const ax = X[ka], ay = Y[ka];
    const abx = X[kb] - ax, aby = Y[kb] - ay;
    const acx = X[kc] - ax, acy = Y[kc] - ay;
    const det = abx * acy - acx * aby;
    if (Math.abs(det) < 1e-12) continue;
    const px = x - ax, py = y - ay;
    const l1 = (px * acy - acx * py) / det;
    if (l1 < -EPS || l1 > 1 + EPS) continue;
    const l2 = (abx * py - px * aby) / det;
    if (l2 < -EPS || l1 + l2 > 1 + EPS) continue;
    const l0 = 1 - l1 - l2;
    if (Z[ka] * l0 + Z[kb] * l1 + Z[kc] * l2 < 0) continue;
    return {
      x: SX[ka] * l0 + SX[kb] * l1 + SX[kc] * l2,
      y: SY[ka] * l0 + SY[kb] * l1 + SY[kc] * l2,
    };
  }
  return null;
}

// ---- THE ART -------------------------------------------------------
// Each decal draws itself PER PIXEL in its own flat coordinates, where
// (nx, ny) run -1..1 across the sticker. Returning null means "not me
// here" — that is how a heart is heart-shaped rather than a square
// with a heart printed on it.
//
// Per-pixel rather than canvas drawing calls, because the decal is
// sampled through the geodesic mapping: there is no flat canvas to
// draw on, only a question asked once per body pixel.
// THE INK is the canonical off-black (shading.PIGMENTS.INK, 2026-09-04);
// it had been (26, 26, 18) — a warm trace of that value, now the pigment.
const INK = window.FF.shading.INK_RGB;

// Ten vertices of a five-pointed star, alternating outer/inner, tip
// UP — art y runs down, so up is -y. Two proportions exist on purpose:
// the STICKER star is chunky (inner 0.47 of outer — a cartoon star),
// the FLAG star is the pentagram (inner 0.382) because a flag's star
// is an emblem, not a cartoon.
function starPts(R, r) {
  const out = [];
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 ? r : R;
    const a = -Math.PI / 2 + k * Math.PI / 5;
    out.push(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  return out;
}
const STAR_PTS = starPts(0.95, 0.45);
const FLAG_STAR_PTS = starPts(1.0, 0.382);

// Even-odd point-in-polygon over a flat vertex list.
function polyHit(pts, nx, ny) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > ny) !== (yj > ny)
      && nx < (xj - xi) * (ny - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// One placed star: centre (cx, cy), circumradius R, tip aimed along
// aim radians (null = tip up). The test point is moved into the
// star's frame rather than the vertices being rebuilt.
function starHit(pts, x, y, cx, cy, R, aim) {
  let dx = (x - cx) / R, dy = (y - cy) / R;
  if (dx * dx + dy * dy > 1) return false;         // cheap reject
  if (aim !== null && aim !== undefined) {
    const t = aim + Math.PI / 2;                   // tip-up is -90deg
    const c = Math.cos(-t), s = Math.sin(-t);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    dx = rx; dy = ry;
  }
  return polyHit(pts, dx, dy);
}
// THE CANONICAL WHITE (shading.js owns it; ruled 2026-08-24). The
// old literal [246,248,242] carried a green trace nobody authored —
// re-pinned to the shared colourless pigment, a ~2-unit shift.
const WHITE = window.FF.shading.WHITE_RGB;   // one source; shading loads first
const BLACK = INK;   // a PAINTED black is the ink, never the void (the sky's #000000 lights nothing)

function ring(nx, ny, r, w) {
  const d = Math.sqrt(nx * nx + ny * ny);
  return Math.abs(d - r) < w;
}
function disc(nx, ny, r) { return nx * nx + ny * ny < r * r; }

// FEATURES (2026-09-04, Eddie: the pupils in pixel view "turn from one
// pixel to a couple of pixels and generally look a bit messy during
// rotation"). An art routine may declare POINT FEATURES in its own
// normalised coords (nx, ny; y down): the bake's majority vote gets a
// second pass that, when the feature would be under ~1.5 sprite px,
// clears whatever the vote made of it inside the white and STAMPS
// exactly one pixel at its projected centre — every rotation frame,
// never stretched, never gone. Above that size (the pre-race pan, the
// editor) the vote is left alone: ruled fine as-is on device.
// `white` is the disc the pupil sits in (the clearing radius).
const FEATURES = {
  googly: { white: 0.98, pupil: { x: 0.22, y: -0.18, r: 0.34 } },
  wide: { white: 0.98, pupil: { x: 0, y: 0, r: 0.30 } },
  sleepy: { white: 0.98, pupil: { x: 0, y: 0.28, r: 0.30 } },
  angry: { white: 0.98, pupil: { x: 0, y: 0.05, r: 0.30 } },
};
const ART = {
  // --- eyes: always granted singly, never as a pair ---
  googly(nx, ny) {
    // NO RIM. The dark ring read as a printed outline rather than a
    // sticker — and the shading rig already separates the eye from the
    // melon, since a white takes the band light differently from a
    // green. The pupil sits off-centre, which is what makes it googly.
    if (!disc(nx, ny, 0.98)) return null;
    if (disc(nx - 0.22, ny + 0.18, 0.34)) return INK;
    return WHITE;
  },
  // NO STROKES ON THE WHITE EYES (Eddie, 2026-09-04, from the pixel-
  // view mockup): at 6-7 px an outline ate a third of the sticker and
  // the eye read as a dark blob. Whites and the pupil only; a lid or
  // a brow is where the white STOPS (the cut), not a line. Pupils all
  // 0.30 of the disc so wide and googly differ by position alone.
  wide(nx, ny) {
    if (!disc(nx, ny, 0.98)) return null;
    if (disc(nx, ny, 0.30)) return INK;               // the centred stare
    return WHITE;
  },
  sleepy(nx, ny) {
    if (!disc(nx, ny, 0.98)) return null;
    if (ny < -0.12) return null;                       // heavy lid: the cut
    if (disc(nx, ny - 0.28, 0.30)) return INK;
    return WHITE;
  },
  angry(nx, ny) {
    if (!disc(nx, ny, 0.98)) return null;
    if (ny < -0.15 + nx * 0.35) return null;           // the brow: a slanted cut
    if (disc(nx, ny - 0.05, 0.30)) return INK;
    return WHITE;
  },
  bloodshot(nx, ny) {
    if (!disc(nx, ny, 0.98)) return null;
    if (!disc(nx, ny, 0.88)) return INK;
    if (disc(nx, ny, 0.28)) return INK;
    // veins: a few radial streaks
    const a = Math.atan2(ny, nx), d = Math.sqrt(nx * nx + ny * ny);
    if (d > 0.34 && Math.abs(Math.sin(a * 3.5)) > 0.93) return [198, 58, 48];
    return WHITE;
  },
  spiral(nx, ny) {
    if (!disc(nx, ny, 0.98)) return null;
    if (!disc(nx, ny, 0.88)) return INK;
    const d = Math.sqrt(nx * nx + ny * ny), a = Math.atan2(ny, nx);
    const t = (a + Math.PI) / (2 * Math.PI);
    return (((d * 3.2 - t) % 1 + 1) % 1) < 0.45 ? INK : WHITE;
  },
  xeye(nx, ny) {
    if (!disc(nx, ny, 0.98)) return null;
    if (Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.20 && disc(nx, ny, 0.9)) return INK;
    return null;
  },
  // --- mouths ---
  // y counts DOWN, so a SMILE dips in the middle: the ends sit higher
  // than the centre. Verified by sampling the routine rather than by
  // reasoning about the sign — the first attempt had these two
  // swapped, and an arch reads as a frown no matter what it is called.
  grin(nx, ny) {
    const y = ny + 0.2;
    if (Math.abs(y + (nx * nx * 0.9 - 0.45)) < 0.17 && Math.abs(nx) < 0.86) return INK;
    return null;
  },
  frown(nx, ny) {
    const y = ny - 0.15;
    if (Math.abs(y - (nx * nx * 0.9 - 0.45)) < 0.17 && Math.abs(nx) < 0.86) return INK;
    return null;
  },
  oh(nx, ny) {
    if (disc(nx, ny * 1.25, 0.62)) return INK;
    return null;
  },
  smirk(nx, ny) {
    const y = ny - nx * 0.35;
    if (Math.abs(y - (nx * nx * 0.5 - 0.2)) < 0.15 && nx > -0.7 && nx < 0.8) return INK;
    return null;
  },
  lips(nx, ny) {
    const t = Math.abs(nx);
    if (t > 0.92) return null;
    const upper = -0.1 - 0.32 * Math.sqrt(Math.max(0, 1 - t * t)) + (Math.abs(nx) < 0.18 ? 0.16 : 0);
    const lower = 0.12 + 0.42 * Math.sqrt(Math.max(0, 1 - t * t));
    if (ny > upper && ny < lower) return [196, 42, 74];
    return null;
  },
  // --- markings ---
  crashtest(nx, ny) {
    // The quartered circle from a crash-test dummy's temple. The black
    // rim removed (Eddie, 2026-09-04: "remove the black outer stroke")
    // — at 11 px it is four blocks, and the rim was a fifth thing.
    if (!disc(nx, ny, 0.95)) return null;
    const q = (nx > 0) === (ny > 0);
    return q ? PLAIN.yellow : INK;
  },
  // MARKINGS IN EIGHT COLOURS (Eddie, 2026-09-04): the heart and the
  // star take their ink from the item (`color`, a plain-wrap colour
  // key) the way flagwrap takes its flag — one routine each, not
  // sixteen. The old single colours (heart 214,54,74; star 246,206,44)
  // retuned to the wrap palette so the whole set is one palette.
  heart(nx, ny, item) {
    const x = nx * 1.15, y = -ny * 1.15 + 0.25;
    const v = Math.pow(x * x + y * y - 0.36, 3) - x * x * y * y * y * 0.55;
    return v < 0 ? markInk(item, 'red') : null;
  },
  // A REAL five-pointed star, tip up. The formula this replaced
  // (0.42 + 0.46·|cos(2.5a)|) drew five wide rounded lobes phased to
  // point screen-right — a flower pretending, which is presumably why
  // no item ever referenced it. This one is the 10-vertex polygon,
  // even-odd tested: outer radius 0.95, inner 0.45 — chunkier than the
  // pentagram's 0.38, because a sticker star is a cartoon star.
  star(nx, ny, item) {
    return polyHit(STAR_PTS, nx, ny) ? markInk(item, 'yellow') : null;
  },
  // THE POLKA DOT (Eddie, 2026-09-04): a plain disc, no stroke, in the
  // plain-wrap colours. ONE DOT PER STICKER — the polka pattern is the
  // player's to compose by wearing several (MAX_DECALS caps it; not
  // moved for this). Sized at 75% of the ORIGINAL googly: s = 0.30 x
  // 0.75 = 0.225 of the semi-minor, which on today's base of 0.375 is
  // an item size of 0.6 — 16 world px, 3-4 px in pixel view; a dot is
  // the one sticker with no interior to lose at that size.
  dot(nx, ny, item) {
    return disc(nx, ny, 0.98) ? markInk(item, 'white') : null;
  },
  // MORE MARKINGS (Eddie, 2026-09-04, from docs/proofs/mock-more.png).
  // The diamond and the crescent in the plain colours; the bullseye,
  // the teardrop and the roundel in their own. All markings size (2x),
  // where the pixel-view sheet showed each one holding at 11 px.
  diamond(nx, ny, item) {
    return (Math.abs(nx) * 0.85 + Math.abs(ny)) < 0.95 ? markInk(item, 'red') : null;
  },
  crescent(nx, ny, item) {
    // a disc with a second disc bitten out of its upper-right
    return (disc(nx, ny, 0.95) && !disc(nx + 0.42, ny - 0.15, 0.80)) ? markInk(item, 'white') : null;
  },
  bullseye(nx, ny) {
    if (disc(nx, ny, 0.33)) return PLAIN.red;
    if (disc(nx, ny, 0.66)) return WHITE;
    if (disc(nx, ny, 0.98)) return PLAIN.red;
    return null;
  },
  cross(nx, ny, item) {
    // the medic cross: two square-ended bars, arm 0.34 of the box
    if ((Math.abs(nx) < 0.34 && Math.abs(ny) < 0.95) || (Math.abs(ny) < 0.34 && Math.abs(nx) < 0.95)) return markInk(item, 'red');
    return null;
  },
  teardrop(nx, ny, item) {
    // a disc below, a point above (y runs down: the point is at ny -0.98)
    if (ny > 0.05 && disc(nx, ny - 0.35, 0.62)) return markInk(item, 'cyan');
    if (ny <= 0.05 && ny > -0.98) {
      const w = 0.62 * (ny + 0.98) / 1.03;
      if (Math.abs(nx) < w) return markInk(item, 'cyan');
    }
    return null;
  },
  bolt(nx, ny) {
    const x = nx, y = ny;
    if (y < 0 && x > -0.55 + y * 0.5 && x < 0.15 + y * 0.5) return [246, 206, 44];
    if (y >= 0 && x > -0.15 + y * 0.5 && x < 0.55 + y * 0.5) return [246, 206, 44];
    return null;
  },
  // --- flags -------------------------------------------------------
  // Drawn to the real 2:3 proportion inside the square art space, so a
  // flag is a flag rather than a stretched square. A dark keyline keeps
  // the white band from dissolving into a pale melon.
  flag(nx, ny, item) {
    // NO KEYLINE. The dark border was there to stop a white band
    // dissolving into a pale melon, but it made the sticker read as
    // printed-and-outlined rather than stuck on. The bands run to the
    // edge; the shading law keeps them legible, since a flag's white
    // and a melon's green diverge under the same light.
    const H = 0.62;                       // half-height for 2:3 at full width
    if (Math.abs(ny) > H || Math.abs(nx) > 0.88) return null;
    return flagInk(FLAGS[(item && item.flag) || 'fr'], nx, ny);
  },

  // --- flag WRAPS (ruled 2026-08-16) ---------------------------------
  // A wrap covers the whole visible face, and the trick that keeps it
  // reading as a FLAG is BLEED, the print-production move: the flag
  // rect keeps its true proportions on the flat central region of the
  // face, and the artboard extends WRAP_BLEED per side by edge-clamp
  // sampling — bands run on along their run, fields extend their
  // colour, and no emblem grows, because no emblem in the catalogue
  // touches its flag's boundary. The margins land exactly where the
  // surface foreshortens, so they mostly vanish into the curvature:
  // expendable colour spends the distorted real estate, the emblem
  // keeps the legible middle. Full coverage by construction — clamped
  // coordinates are always inside the rect, so a wrap has no
  // letterbox and never returns null.
  flagwrap(nx, ny, item) {
    const H = 0.62;
    const S = 1 + 2 * WRAP_BLEED;
    const f = FLAGS[(item && item.flag) || 'fr'];
    // THE FACE-SPACE CROSS (2026-09-04, St Piran's): a wrap compresses
    // the flag's width 1.5x onto the face and (fitted) its height 1x,
    // so a cross defined on the artboard came out thinner across than
    // down. The cross is an emblem laid on the FACE: half-thickness
    // `t` in ny, the vertical arm narrowed by the melon's aspect so
    // both bars are the same thickness in pixels (measured 3/3 px at
    // phone scale for t 0.22). Resolved before the ground, like every
    // emblem. Wraps only — the flag-sticker set is empty by ruling.
    if (f && f.cross) {
      const c = f.cross;
      if (Math.abs(ny) < c.t || Math.abs(nx) < c.t / FACE_ASPECT) return c.color;
    }
    // THE CHECKER (2026-09-04): a face-space grid, `cols` cells across
    // the face and rows derived so cells are SQUARE IN PIXELS, two
    // colours. Ruled four across from the sheet, then five on device
    // (~4 px a cell on a phone melon). The whole wrap is the grid —
    // no artboard, no letterbox.
    // THE SPLIT (2026-09-04, from docs/proofs/mock-halves-dots.png): two
    // plain colours across a face-space divide — 'h' top/bottom, 'v'
    // left/right, 'd' a diagonal aspect-corrected to 45 deg in pixels,
    // 'q' quarters. Sixteen hand-authored pairs (option 3: a set of
    // looks, not a grid), the way the flags were chosen.
    if (f && f.split) {
      const sp = f.split;
      const first = sp.mode === 'h' ? ny < 0
        : sp.mode === 'v' ? nx < 0
        : sp.mode === 'd' ? (nx / FACE_ASPECT + ny) < 0
        : ((nx < 0) === (ny < 0));
      return first ? sp.a : sp.b;
    }
    if (f && f.checker) {
      const k = f.checker;
      const rows = Math.max(1, Math.round(k.cols / FACE_ASPECT));
      const i = Math.floor((nx + 1) * 0.5 * k.cols), j = Math.floor((ny + 1) * 0.5 * rows);
      return ((i + j) & 1) === 0 ? k.a : k.b;
    }
    const fx = Math.max(-0.88, Math.min(0.88, nx * S));
    // FIT TO FACE (2026-09-04, the striped flags): `fit: 'face'` maps
    // the flag's height onto the WHOLE face so every stripe gets an
    // equal share — six Pride stripes at ~2.6 px on a phone melon,
    // where the default clamp (the tricolours' law: height onto the
    // middle two-thirds, end bands run out) squeezed the middle four
    // to 2 px and gave red and violet a third each. Default unchanged:
    // no existing wrap moves.
    const fy = (f && f.fit === 'face') ? ny * H : Math.max(-H, Math.min(H, ny * S));
    return flagInk(f, fx, fy);
  },

  // --- numbers: varsity block, with a derived outline ---------------
  // The 5x7 bitmap this replaced could not carry an athletic face: slab
  // serifs and a heavy stroke need resolution. Authored at 16x20, and
  // the OUTLINE is derived from the stroke at load time rather than
  // drawn twice, so a new numeral is one grid and not two.
  glyph(nx, ny, item) {
    const g = VARSITY[(item && item.glyph) || '2'];
    if (!g) return null;
    const cx = Math.floor((nx * 0.5 + 0.5) * g.w);
    const cy = Math.floor((ny * 0.5 + 0.5) * g.h);
    if (cx < 0 || cx >= g.w || cy < 0 || cy >= g.h) return null;
    const v = g.cells[cy * g.w + cx];
    return v === 2 ? VARSITY_FILL : v === 1 ? VARSITY_EDGE : null;
  },
};

// Flag palettes, left band to right band.
// A flag is either BANDS (vertical hoist-to-fly, or horizontal
// top-to-bottom — art y runs down, so bands[0] is the TOP band) or a
// FIELD carrying geometry: a disc, placed stars, or both. The
// geometric primitives arrived the day flags needed them (2026-08-15,
// jp/vn/bd/cn) and no sooner. All coordinates are ART UNITS inside the
// letterbox (x in [-0.88, 0.88], y in [-0.62, 0.62]); derivations from
// each flag's official construction sit beside the numbers.
//
// China's five stars come from the official 30x20 construction grid,
// one square unit = width/30 = 0.058667 art units (the letterbox is a
// hair taller than 2:3, so the grid hangs from the TOP edge and the
// spare height stays field — invisible on a red field). Each small
// star aims its tip at the big star's centre, per the construction.
// The wrap's bleed per side, as a fraction of the flag artboard.
// 0.25 puts the true-proportion flag on the central two-thirds; the
// final number is a proof-render ruling, not arithmetic.
const WRAP_BLEED = 0.25;
// The standard melon's a:b, for face-space emblems that must read
// square in pixels (the cross). Every species scales a and b together
// (derivePhysique), so one ratio serves.
const FACE_ASPECT = window.FF.CONFIG.semiMajor / window.FF.CONFIG.semiMinor;
// A wrap's fixed pose: centred on the visible face at full square
// coverage. Not resizable, not movable, not rotatable — a wrap is
// binary. s = 2.0 covers the face; the mesh resolution law already
// handles the size.
const WRAP_POSE = { u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.0 };
// The one sticker size (PIXEL 320). Chosen so a size-1 art box lands
// ~6 px across at race scale — the floor for a readable icon — and
// multiplied by each item's own `size` so visual weight matches.
// 0.30 -> 0.375 (Eddie, 2026-09-04, v373: "make all non-wrap decals
// 25% bigger — that should help with legibility in pixel view"). One
// authored size still; the wrap pose is untouched. Stored stickers
// on existing saves are scaled once by melon.js's migrate (flag
// stickerS375), so a worn eye grows with the new ones.
const STICKER_S = 0.375;

// The flag's ink at a point INSIDE the rect — the letterbox lives in
// the callers (the sticker letterboxes, the wrap clamps).
// OVERLAYS FIRST (Wave A, 2026-08-16): an emblem sits ON the ground
// whether the ground is a field or bands — Ghana's black star rides
// the gold band — so stars and discs test before the ground resolves.
// Bands may carry WEIGHTS (Spain 1:2:1, Colombia 2:1:1, Thailand
// 1:1:2:1:1); absent weights mean equal, as ever.
function flagInk(f, nx, ny) {
  if (!f) return null;
  const H = 0.62;
  if (f.stars) {
    for (const st of f.stars) {
      if (starHit(FLAG_STAR_PTS, nx, ny, st.x, st.y, st.r, st.aim)) return st.color;
    }
  }
  if (f.disc) {
    const dx = nx - f.disc.x, dy = ny - f.disc.y;
    if (dx * dx + dy * dy <= f.disc.r * f.disc.r) return f.disc.color;
  }
  // The CANTON (first needed by the USA, 2026-08-16): a rect anchored
  // at the hoist-top, resolved after emblems (its stars sit ON it)
  // and before the ground (it sits on the stripes). Under the wrap's
  // edge-clamp its blue extends into the bleed at the hoist and top,
  // exactly as a real flag's canton meets the pole.
  if (f.canton) {
    const c = f.canton;
    if (nx <= c.x1 && ny <= c.y1) return c.color;
  }
  if (f.bands) {
    const t = f.h ? (ny + H) / (2 * H)  // horizontal bands, top down
                  : (nx + 0.88) / 1.76; // vertical bands, hoist to fly
    const B2 = f.bands;
    if (f.weights) {
      const total = f.weights.reduce((a, w) => a + w, 0);
      let acc = 0;
      for (let i = 0; i < B2.length; i++) {
        acc += f.weights[i] / total;
        if (t < acc) return B2[i];
      }
      return B2[B2.length - 1];
    }
    return B2[Math.max(0, Math.min(B2.length - 1, Math.floor(t * B2.length)))];
  }
  return f.field;
}

const CN_U = 1.76 / 30;
const CN = (gx, gy) => ({ x: -0.88 + gx * CN_U, y: -0.62 + gy * CN_U });
const CN_BIG = CN(5, 5);
const FLAGS = {
  fr: { h: false, bands: [[0, 85, 164], WHITE, [239, 65, 53]] },
  ie: { h: false, bands: [[22, 155, 98], WHITE, [255, 136, 62]] },
  it: { h: false, bands: [[0, 140, 69], WHITE, [205, 33, 42]] },
  de: { h: true, bands: [INK, [221, 0, 0], [255, 206, 0]] },
  pl: { h: true, bands: [WHITE, [220, 20, 60]] },
  // disc radius: 3/10 of flag height = 0.3 * 1.24
  jp: { field: WHITE,
        disc: { x: 0, y: 0, r: 0.372, color: [188, 0, 45] } },
  // disc radius 1/5 of flag length = 0.2 * 1.76; centre 9/20 of the
  // length from the hoist, so it reads centred on a flying flag
  bd: { field: [0, 106, 78],
        disc: { x: -0.088, y: 0, r: 0.352, color: [244, 42, 65] } },
  // star circumradius 3/10 of flag height, tip up
  vn: { field: [218, 37, 29],
        stars: [{ x: 0, y: 0, r: 0.372, aim: null, color: [255, 222, 0] }] },
  // ---- WAVE A (2026-08-16, see docs/flag-roadmap.md) ---------------
  // Free with today's primitives, colours official-ish.
  id: { h: true, bands: [[215, 25, 32], WHITE] },           // Indonesia
  nl: { h: true, bands: [[174, 28, 40], WHITE, [33, 70, 139]] },
  ng: { h: false, bands: [[0, 135, 68], WHITE, [0, 135, 68]] },
  hu: { h: true, bands: [[206, 42, 52], WHITE, [71, 112, 80]] },
  at: { h: true, bands: [[237, 41, 57], WHITE, [237, 41, 57]] },
  be: { h: false, bands: [INK, [253, 218, 36], [239, 51, 64]] },
  ro: { h: false, bands: [[0, 43, 127], [252, 209, 22], [206, 17, 38]] },
  ci: { h: false, bands: [[247, 126, 0], WHITE, [0, 158, 96]] },
  // band + star: the emblem rides the middle band (overlays-first law)
  gh: { h: true, bands: [[206, 17, 38], [252, 201, 0], [0, 107, 63]],
        stars: [{ x: 0, y: 0, r: 0.2, aim: null, color: INK }] },
  sn: { h: false, bands: [[0, 133, 63], [253, 220, 35], [227, 27, 35]],
        stars: [{ x: 0, y: 0, r: 0.18, aim: null, color: [0, 133, 63] }] },
  cm: { h: false, bands: [[0, 122, 61], [206, 17, 38], [252, 209, 22]],
        stars: [{ x: 0, y: 0, r: 0.18, aim: null, color: [252, 209, 22] }] },
  // weighted bands
  es: { h: true, weights: [1, 2, 1],
        bands: [[170, 21, 27], [241, 189, 0], [170, 21, 27]] },       // civil flag
  co: { h: true, weights: [2, 1, 1],
        bands: [[252, 209, 22], [0, 56, 147], [206, 17, 38]] },
  th: { h: true, weights: [1, 1, 2, 1, 1],
        bands: [[165, 25, 49], WHITE, [45, 42, 74],
                WHITE, [165, 25, 49]] },
  // USA (2026-08-16): 13 equal stripes; canton height = 7 stripes
  // exactly (7/13 of the letterbox), length 0.4 of the flag; 50 stars
  // in the official 9-row 6/5 alternation on the 12x10 canton grid,
  // generated, not typed. Star radius ~0.031 of flag height — dots at
  // sticker size, a star field at wrap size, both correct.
  us: (() => {
    const RED = [178, 34, 52], WHT = WHITE, BLU = [60, 59, 110]; // WHT: the canonical pigment
    const bands = [];
    for (let i = 0; i < 13; i++) bands.push(i % 2 ? WHT : RED);
    const x0 = -0.88, y0 = -0.62;
    const cw = 0.4 * 1.76, ch = (7 / 13) * 1.24;
    const stars = [];
    for (let r = 0; r < 9; r++) {
      const y = y0 + (r + 1) * ch / 10;
      const cols = r % 2 ? [2, 4, 6, 8, 10] : [1, 3, 5, 7, 9, 11];
      for (const cc of cols) {
        stars.push({ x: x0 + cc * cw / 12, y, r: 0.038, aim: null, color: WHT });
      }
    }
    return { h: true, bands, stars,
      canton: { x1: x0 + cw, y1: y0 + ch, color: BLU } };
  })(),
  cn: { field: [238, 28, 37],
        stars: [
          { x: CN_BIG.x, y: CN_BIG.y, r: 3 * CN_U, aim: null, color: [255, 222, 0] },
          ...[[10, 2], [12, 4], [12, 7], [10, 9]].map(([gx, gy]) => {
            const p = CN(gx, gy);
            return { x: p.x, y: p.y, r: CN_U,
              aim: Math.atan2(CN_BIG.y - p.y, CN_BIG.x - p.x), color: [255, 222, 0] };
          }),
        ] },
};

// ---- THE PLAIN PALETTE (2026-09-04, v378): FORTY-TWO COLOURS.
// Twelve hues x (dark / base / light) and six neutrals from canonical
// black to canonical white. The six base hues that shipped first are
// the tempered set beside the flag colours; the six between them
// (orange, lime, teal, azure, violet, pink) are each the OKLCH
// midpoint of their two neighbours (perceptual hue, lightness and
// chroma, via oklab.js); light is the base at L +0.17 and 55% chroma
// (pastel, not washed), dark at L -0.24 and 60% chroma (earthy, not
// muddy — dark orange IS the brown, dark yellow the ochre). The
// neutrals step from INK to WHITE in equal OKLab lightness (0.151 a
// step; equal RGB steps would bunch the dark end). The two ends are
// the pigments by reference. Authored as literals from that
// derivation (docs/proofs/mock-42.png); a formula here would move
// them whenever oklab.js moved.
const PLAIN = {
  red: [222, 32, 40], 'dark-red': [115, 16, 18], 'light-red': [240, 142, 132],
  orange: [240, 135, 0], 'dark-orange': [135, 79, 22], 'light-orange': [255, 210, 174],
  yellow: [250, 208, 0], 'dark-yellow': [158, 135, 50], 'light-yellow': [243, 222, 146],
  lime: [160, 191, 21], 'dark-lime': [95, 112, 32], 'light-lime': [212, 232, 159],
  green: [36, 168, 72], 'dark-green': [20, 87, 36], 'light-green': [151, 211, 158],
  teal: [0, 174, 149], 'dark-teal': [16, 93, 80], 'light-teal': [155, 218, 203],
  cyan: [0, 178, 196], 'dark-cyan': [21, 99, 108], 'light-cyan': [160, 224, 234],
  azure: [0, 139, 194], 'dark-azure': [0, 67, 96], 'light-azure': [137, 188, 220],
  blue: [28, 84, 220], 'dark-blue': [23, 55, 128], 'light-blue': [112, 149, 223],
  violet: [144, 63, 216], 'dark-violet': [77, 35, 116], 'light-violet': [182, 145, 227],
  magenta: [214, 44, 160], 'dark-magenta': [107, 17, 78], 'light-magenta': [237, 147, 200],
  pink: [223, 29, 106], 'dark-pink': [113, 12, 51], 'light-pink': [242, 143, 166],
  // the neutral ladder — dark black is the INK, light white is the WHITE
  'medium-black': [63, 63, 63], 'light-black': [105, 105, 105],
  'dark-white': [149, 149, 149], 'medium-white': [197, 197, 197],
};
PLAIN['dark-black'] = INK;
PLAIN['light-white'] = WHITE;
PLAIN.black = INK;      // the short names the first eight items used
PLAIN.white = WHITE;
const PLAIN_KEYS = Object.keys(PLAIN).filter((k) => k !== 'black' && k !== 'white');   // the 42, for the item tables
for (const k of Object.keys(PLAIN)) FLAGS['plain-' + k] = { field: PLAIN[k] };

// ---- 2026-09-04: Cornwall, Pride, Trans (docs/proofs/mock-flags*.png)
// St Piran's: black field, white cross drawn in FACE space (see
// flagwrap), half-thickness 0.22 — ruled "a touch thinner" than 0.28.
// RE-RULED on device (Eddie, 2026-09-04, from the picker at editor
// scale): "the bands are too thick — approach them the same as the
// other banded flags." The cross's bar is now the thickness of a
// tricolour's band on the face: a band is a third of the artboard's
// 1.24 height, mapped through the wrap's 1.5x, = 0.276 of the
// semi-minor; half-thickness 0.138. (0.22 had been 1.6x a band.) At
// phone pixel view that is ~2 px, as Austria's white band is.
FLAGS.kw = { field: BLACK, cross: { t: 0.138, color: WHITE } };
// The six-stripe Pride flag and the Trans flag: horizontal bands
// under the SAME wrap law as every tricolour (the height onto the
// middle two-thirds, end bands run out) — `fit: 'face'` was tried
// and re-ruled off on device the same day; the key stays in
// flagwrap for a flag that wants it.
FLAGS.pride = { h: true,
  bands: [[228, 3, 3], [255, 140, 0], [255, 237, 0], [0, 128, 38], [0, 76, 255], [115, 41, 130]] };
FLAGS.trans = { h: true,
  bands: [[91, 206, 250], [245, 169, 184], WHITE, [245, 169, 184], [91, 206, 250]] };
// ---- 2026-09-04: CHECKER wraps (docs/proofs/mock-checker.png), four
// across, five colour pairs as ruled. (Blue/cyan was shown merging
// toward one colour at 1:1 — chosen with that on the sheet.)
// Re-ruled on device the same day: FIVE across (5 x 4 cells; ~4 px a
// cell at phone pixel view).
const CHECK = 5;
FLAGS['check-bw'] = { checker: { cols: CHECK, a: BLACK, b: WHITE } };
FLAGS['check-mb'] = { checker: { cols: CHECK, a: PLAIN.magenta, b: BLACK } };
FLAGS['check-yb'] = { checker: { cols: CHECK, a: PLAIN.yellow, b: BLACK } };
FLAGS['check-bc'] = { checker: { cols: CHECK, a: PLAIN.blue, b: PLAIN.cyan } };
FLAGS['check-rw'] = { checker: { cols: CHECK, a: PLAIN.red, b: WHITE } };
// ---- 2026-09-04: SPLIT wraps, sixteen authored pairs (option 3)
const SPLITS = {
  // halves, top over bottom — the ones that read as objects
  'half-rw': ['h', PLAIN.red, WHITE], 'half-bw': ['h', INK, WHITE], 'half-yw': ['h', PLAIN.yellow, WHITE],
  'half-uw': ['h', PLAIN.blue, WHITE], 'half-gw': ['h', PLAIN.green, WHITE],
  // quarters — the kits
  'quad-rk': ['q', PLAIN.red, INK], 'quad-uw': ['q', PLAIN.blue, WHITE], 'quad-yk': ['q', PLAIN.yellow, INK], 'quad-gw': ['q', PLAIN.green, WHITE],
  // diagonals — the colour-on-colour designs
  'diag-mc': ['d', PLAIN.magenta, PLAIN.cyan], 'diag-uy': ['d', PLAIN.blue, PLAIN.yellow], 'diag-ry': ['d', PLAIN.red, PLAIN.yellow],
  'diag-cw': ['d', PLAIN.cyan, WHITE], 'diag-mk': ['d', PLAIN.magenta, INK],
  // left / right
  'side-bw': ['v', INK, WHITE], 'side-ru': ['v', PLAIN.red, PLAIN.blue],
};
for (const k of Object.keys(SPLITS)) FLAGS[k] = { split: { mode: SPLITS[k][0], a: SPLITS[k][1], b: SPLITS[k][2] } };
// A marking's ink: the item's colour key resolved through the same
// table as the plain wraps (white and black by pigment reference).
function markInk(item, fallback) {
  const k = (item && item.color) || fallback;
  return PLAIN[k] || PLAIN[fallback];
}


// ---- THE VARSITY FACE ----------------------------------------------
// Authored as a picture, because a block athletic numeral is a shape
// and not a formula: '#' is stroke, '.' is empty.
const VARSITY_SRC = {
  '2': [
    '....########....',
    '..############..',
    '.####......####.',
    '###..........###',
    '###..........###',
    '..............##',
    '..............##',
    '.............###',
    '............###.',
    '...........###..',
    '..........###...',
    '.........###....',
    '........###.....',
    '.......###......',
    '......###.......',
    '.....###........',
    '....###.........',
    '################',
    '################',
    '################',
  ],
};
// Canonical white here too (found by verify-cloud-rig H5 on its
// first run): the varsity numeral fill was a third hand-typed
// near-white carrying the same unauthored green trace.
const VARSITY_FILL = WHITE;
const VARSITY_EDGE = INK;   // the ink (was a second copy of the warm 26,26,18; 2026-09-04)

// { w, h, cells } per glyph: 2 = stroke, 1 = outline, 0 = empty. The
// outline is every empty cell touching a stroke cell, which is what
// gives the face its collegiate double line without authoring it.
const VARSITY = (() => {
  const out = {};
  for (const ch of Object.keys(VARSITY_SRC)) {
    const rows = VARSITY_SRC[ch];
    const h = rows.length, w = rows[0].length;
    const cells = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (rows[y][x] === '#') cells[y * w + x] = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cells[y * w + x]) continue;
        let touch = false;
        for (let dy = -1; dy <= 1 && !touch; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
            if (cells[yy * w + xx] === 2) { touch = true; break; }
          }
        if (touch) cells[y * w + x] = 1;
      }
    }
    out[ch] = { w, h, cells };
  }
  return out;
})();

// Sample an item's art at flat coordinates -1..1. Returns [r,g,b] or
// null for transparent.
function sampleArt(item, nx, ny) {
  const fn = ART[item && item.art];
  if (!fn) return null;
  return fn(nx, ny, item);
}
// PAINT (v380, 2026-09-04): a worn decal may carry `paint`, a plain
// colour key. A painted decal is its SILHOUETTE in that one colour —
// every colour replaced, ink included (ruled: "painting an eye would
// turn it into a coloured polka dot"). Wraps included: a painted flag
// is a plain wrap. This is the one sampling door the rasters use.
function sampleWorn(wd, item, nx, ny) {
  const c = sampleArt(item, nx, ny);
  if (!c || !wd || !wd.paint) return c;
  return PLAIN[wd.paint] || c;
}

// ---- THE CATALOGUE -------------------------------------------------
// Sets, and the items in them. A set's SIZE is its rarity, so adding
// members to a set makes each one scarcer without any stat changing.
// `art` names the drawing routine; the renderer owns the pixels.
// ---- THE CATALOGUE -------------------------------------------------
// WHAT A PLAYER CAN ACTUALLY WIN. Distinct from the ART REGISTRY above,
// which holds every routine that has been drawn: art can exist without
// being released, and releasing it is a one-line edit here.
//
// ID SCHEME, chosen to survive a catalogue that grows for years:
//
//     <set>-<variant>              eye-googly, mark-heart
//     flag-<iso3166alpha2>         flag-fr, flag-de, flag-jp
//     num-<family>-<glyph>         num-varsity-2, num-stencil-7
//
// IDS ARE PERMANENT. Once a player owns 'mark-heart' that string sits
// in their save forever, so renaming an id orphans their item. Family
// comes BEFORE the glyph in numbers so a second font is an obvious
// addition rather than a rename, and flags use the ISO code so two
// hundred of them need no invention.
//
// RARITY IS SET SIZE, so the shape of the catalogue matters more than
// its contents: a flag set that will end up at fifty members makes any
// one flag rare by arithmetic, while a four-member marking set stays
// common forever. Today's small sets read as common permanently — that
// is a decision, not an accident.
const SETS = {
  eyes: {
    label: 'EYES',
    // Handed out ONE at a time and never as a pair. A one-eyed melon
    // is a better joke than a two-eyed one, and hunting a matching
    // second eye is a reason to race that costs nothing to build.
    single: true,
    // FIVE EYES (Eddie, 2026-09-04): wide, sleepy and x-eye had been
    // drawn since the first eye pass and never listed; angry is new.
    // The set grows 1 -> 5, so the googly is no longer the certain
    // first eye roll (rarity is set size).
    // EYE SIZE (Eddie, on device, 2026-09-04): 1 -> 1.5 ("50% bigger"),
    // then "25% smaller — they're too large now" -> 1.125: 0.42 of the
    // semi-minor, ~8 px in pixel view. Worn eyes are scaled by
    // melon.js's migrate (flags eyesDots150, then eyes075).
    items: [
      { id: 'eye-googly', label: 'googly eye', art: 'googly', size: 1.125 },
      { id: 'eye-wide', label: 'wide eye', art: 'wide', size: 1.125 },
      { id: 'eye-sleepy', label: 'sleepy eye', art: 'sleepy', size: 1.125 },
      { id: 'eye-angry', label: 'angry eye', art: 'angry', size: 1.125 },
      { id: 'eye-x', label: 'x eye', art: 'xeye', size: 1.125 },
    ],
  },
  markings: {
    label: 'MARKINGS',
    items: [
      // `size` is a multiplier on the seeded placement scale. Items do
      // not fill their art box equally — a googly eye is a disc that
      // touches every edge, while a flag occupies only the middle 2:3
      // and a heart rather less — so a single global size renders some
      // items visibly smaller than others. Each item declares its own.
      // EIGHT COLOURS EACH (Eddie, 2026-09-04): the plain-wrap palette.
      // The two original ids keep their ids (worn ones need no
      // migration) and become the red heart and the yellow star. One
      // set of sixteen, ruled: "I don't care that they'll be rare."
      { id: 'mark-heart', label: 'red heart', art: 'heart', size: 2, color: 'red' },
      { id: 'mark-heart-yellow', label: 'yellow heart', art: 'heart', size: 2, color: 'yellow' },
      { id: 'mark-heart-green', label: 'green heart', art: 'heart', size: 2, color: 'green' },
      { id: 'mark-heart-cyan', label: 'cyan heart', art: 'heart', size: 2, color: 'cyan' },
      { id: 'mark-heart-blue', label: 'blue heart', art: 'heart', size: 2, color: 'blue' },
      { id: 'mark-heart-magenta', label: 'magenta heart', art: 'heart', size: 2, color: 'magenta' },
      { id: 'mark-heart-white', label: 'white heart', art: 'heart', size: 2, color: 'white' },
      { id: 'mark-heart-black', label: 'black heart', art: 'heart', size: 2, color: 'black' },
      // A star's box is tips-only at the edges, like the heart's lobes:
      // same multiplier keeps their visual weight matched.
      { id: 'mark-star', label: 'yellow star', art: 'star', size: 2, color: 'yellow' },
      { id: 'mark-star-red', label: 'red star', art: 'star', size: 2, color: 'red' },
      { id: 'mark-star-green', label: 'green star', art: 'star', size: 2, color: 'green' },
      { id: 'mark-star-cyan', label: 'cyan star', art: 'star', size: 2, color: 'cyan' },
      { id: 'mark-star-blue', label: 'blue star', art: 'star', size: 2, color: 'blue' },
      { id: 'mark-star-magenta', label: 'magenta star', art: 'star', size: 2, color: 'magenta' },
      { id: 'mark-star-white', label: 'white star', art: 'star', size: 2, color: 'white' },
      { id: 'mark-star-black', label: 'black star', art: 'star', size: 2, color: 'black' },
      // POLKA DOTS (2026-09-04): individual dots; wear several for the
      // pattern. size 0.6 = 75% of the original googly (see ART.dot);
      // then 50% bigger on device the same day -> 0.9 (0.3375 of the
      // semi-minor, ~5-6 px in pixel view). Worn dots scaled once by
      // melon.js's migrate (flag eyesDots150).
      { id: 'mark-dot-red', label: 'red dot', art: 'dot', size: 0.9, color: 'red' },
      { id: 'mark-dot-yellow', label: 'yellow dot', art: 'dot', size: 0.9, color: 'yellow' },
      { id: 'mark-dot-green', label: 'green dot', art: 'dot', size: 0.9, color: 'green' },
      { id: 'mark-dot-cyan', label: 'cyan dot', art: 'dot', size: 0.9, color: 'cyan' },
      { id: 'mark-dot-blue', label: 'blue dot', art: 'dot', size: 0.9, color: 'blue' },
      { id: 'mark-dot-magenta', label: 'magenta dot', art: 'dot', size: 0.9, color: 'magenta' },
      { id: 'mark-dot-white', label: 'white dot', art: 'dot', size: 0.9, color: 'white' },
      { id: 'mark-dot-black', label: 'black dot', art: 'dot', size: 0.9, color: 'black' },
      // THE DOT LADDER (2026-09-04, Eddie: "dot x2 the biggest, the third
      // x1.5"): spot 1.35, big spot 1.8 -> 2 (v380, ruled: the roundel's size) — same routine; they STACK (the
      // pile order is the editor's), so a dot on a big spot is an eye of
      // any colour, and a spot between them an iris.
      { id: 'mark-spot-red', label: 'red spot', art: 'dot', size: 1.35, color: 'red' },
      { id: 'mark-spot-yellow', label: 'yellow spot', art: 'dot', size: 1.35, color: 'yellow' },
      { id: 'mark-spot-green', label: 'green spot', art: 'dot', size: 1.35, color: 'green' },
      { id: 'mark-spot-cyan', label: 'cyan spot', art: 'dot', size: 1.35, color: 'cyan' },
      { id: 'mark-spot-blue', label: 'blue spot', art: 'dot', size: 1.35, color: 'blue' },
      { id: 'mark-spot-magenta', label: 'magenta spot', art: 'dot', size: 1.35, color: 'magenta' },
      { id: 'mark-spot-white', label: 'white spot', art: 'dot', size: 1.35, color: 'white' },
      { id: 'mark-spot-black', label: 'black spot', art: 'dot', size: 1.35, color: 'black' },
      { id: 'mark-bigspot-red', label: 'red big spot', art: 'dot', size: 2, color: 'red' },
      { id: 'mark-bigspot-yellow', label: 'yellow big spot', art: 'dot', size: 2, color: 'yellow' },
      { id: 'mark-bigspot-green', label: 'green big spot', art: 'dot', size: 2, color: 'green' },
      { id: 'mark-bigspot-cyan', label: 'cyan big spot', art: 'dot', size: 2, color: 'cyan' },
      { id: 'mark-bigspot-blue', label: 'blue big spot', art: 'dot', size: 2, color: 'blue' },
      { id: 'mark-bigspot-magenta', label: 'magenta big spot', art: 'dot', size: 2, color: 'magenta' },
      { id: 'mark-bigspot-white', label: 'white big spot', art: 'dot', size: 2, color: 'white' },
      { id: 'mark-bigspot-black', label: 'black big spot', art: 'dot', size: 2, color: 'black' },
      // MORE MARKINGS (2026-09-04): diamond and crescent in the plain
      // colours; bullseye, teardrop, crash-test roundel as themselves.
      { id: 'mark-diamond-red', label: 'red diamond', art: 'diamond', size: 2, color: 'red' },
      { id: 'mark-diamond-yellow', label: 'yellow diamond', art: 'diamond', size: 2, color: 'yellow' },
      { id: 'mark-diamond-green', label: 'green diamond', art: 'diamond', size: 2, color: 'green' },
      { id: 'mark-diamond-cyan', label: 'cyan diamond', art: 'diamond', size: 2, color: 'cyan' },
      { id: 'mark-diamond-blue', label: 'blue diamond', art: 'diamond', size: 2, color: 'blue' },
      { id: 'mark-diamond-magenta', label: 'magenta diamond', art: 'diamond', size: 2, color: 'magenta' },
      { id: 'mark-diamond-white', label: 'white diamond', art: 'diamond', size: 2, color: 'white' },
      { id: 'mark-diamond-black', label: 'black diamond', art: 'diamond', size: 2, color: 'black' },
      { id: 'mark-crescent-red', label: 'red crescent', art: 'crescent', size: 2, color: 'red' },
      { id: 'mark-crescent-yellow', label: 'yellow crescent', art: 'crescent', size: 2, color: 'yellow' },
      { id: 'mark-crescent-green', label: 'green crescent', art: 'crescent', size: 2, color: 'green' },
      { id: 'mark-crescent-cyan', label: 'cyan crescent', art: 'crescent', size: 2, color: 'cyan' },
      { id: 'mark-crescent-blue', label: 'blue crescent', art: 'crescent', size: 2, color: 'blue' },
      { id: 'mark-crescent-magenta', label: 'magenta crescent', art: 'crescent', size: 2, color: 'magenta' },
      { id: 'mark-crescent-white', label: 'white crescent', art: 'crescent', size: 2, color: 'white' },
      { id: 'mark-crescent-black', label: 'black crescent', art: 'crescent', size: 2, color: 'black' },
      { id: 'mark-bullseye', label: 'bullseye', art: 'bullseye', size: 2 },
      { id: 'mark-teardrop', label: 'teardrop', art: 'teardrop', size: 2, color: 'cyan' },
      { id: 'mark-crashtest', label: 'crash-test roundel', art: 'crashtest', size: 2 },
      // EVERY COLOURED SHAPE IN EVERY COLOUR (v379, 2026-09-04, Eddie:
      // "make sure all shapes that come in different colors have a
      // version for every single color we now have"). The eight first
      // colours keep their ids above; these are the other thirty-four
      // per shape. The tray question stands parked by ruling.
      { id: 'mark-heart-dark-red', label: 'dark red heart', art: 'heart', size: 2, color: 'dark-red' },
      { id: 'mark-heart-light-red', label: 'light red heart', art: 'heart', size: 2, color: 'light-red' },
      { id: 'mark-heart-dark-orange', label: 'dark orange heart', art: 'heart', size: 2, color: 'dark-orange' },
      { id: 'mark-heart-orange', label: 'orange heart', art: 'heart', size: 2, color: 'orange' },
      { id: 'mark-heart-light-orange', label: 'light orange heart', art: 'heart', size: 2, color: 'light-orange' },
      { id: 'mark-heart-dark-yellow', label: 'dark yellow heart', art: 'heart', size: 2, color: 'dark-yellow' },
      { id: 'mark-heart-light-yellow', label: 'light yellow heart', art: 'heart', size: 2, color: 'light-yellow' },
      { id: 'mark-heart-dark-lime', label: 'dark lime heart', art: 'heart', size: 2, color: 'dark-lime' },
      { id: 'mark-heart-lime', label: 'lime heart', art: 'heart', size: 2, color: 'lime' },
      { id: 'mark-heart-light-lime', label: 'light lime heart', art: 'heart', size: 2, color: 'light-lime' },
      { id: 'mark-heart-dark-green', label: 'dark green heart', art: 'heart', size: 2, color: 'dark-green' },
      { id: 'mark-heart-light-green', label: 'light green heart', art: 'heart', size: 2, color: 'light-green' },
      { id: 'mark-heart-dark-teal', label: 'dark teal heart', art: 'heart', size: 2, color: 'dark-teal' },
      { id: 'mark-heart-teal', label: 'teal heart', art: 'heart', size: 2, color: 'teal' },
      { id: 'mark-heart-light-teal', label: 'light teal heart', art: 'heart', size: 2, color: 'light-teal' },
      { id: 'mark-heart-dark-cyan', label: 'dark cyan heart', art: 'heart', size: 2, color: 'dark-cyan' },
      { id: 'mark-heart-light-cyan', label: 'light cyan heart', art: 'heart', size: 2, color: 'light-cyan' },
      { id: 'mark-heart-dark-azure', label: 'dark azure heart', art: 'heart', size: 2, color: 'dark-azure' },
      { id: 'mark-heart-azure', label: 'azure heart', art: 'heart', size: 2, color: 'azure' },
      { id: 'mark-heart-light-azure', label: 'light azure heart', art: 'heart', size: 2, color: 'light-azure' },
      { id: 'mark-heart-dark-blue', label: 'dark blue heart', art: 'heart', size: 2, color: 'dark-blue' },
      { id: 'mark-heart-light-blue', label: 'light blue heart', art: 'heart', size: 2, color: 'light-blue' },
      { id: 'mark-heart-dark-violet', label: 'dark violet heart', art: 'heart', size: 2, color: 'dark-violet' },
      { id: 'mark-heart-violet', label: 'violet heart', art: 'heart', size: 2, color: 'violet' },
      { id: 'mark-heart-light-violet', label: 'light violet heart', art: 'heart', size: 2, color: 'light-violet' },
      { id: 'mark-heart-dark-magenta', label: 'dark magenta heart', art: 'heart', size: 2, color: 'dark-magenta' },
      { id: 'mark-heart-light-magenta', label: 'light magenta heart', art: 'heart', size: 2, color: 'light-magenta' },
      { id: 'mark-heart-dark-pink', label: 'dark pink heart', art: 'heart', size: 2, color: 'dark-pink' },
      { id: 'mark-heart-pink', label: 'pink heart', art: 'heart', size: 2, color: 'pink' },
      { id: 'mark-heart-light-pink', label: 'light pink heart', art: 'heart', size: 2, color: 'light-pink' },
      { id: 'mark-heart-medium-black', label: 'medium black heart', art: 'heart', size: 2, color: 'medium-black' },
      { id: 'mark-heart-light-black', label: 'light black heart', art: 'heart', size: 2, color: 'light-black' },
      { id: 'mark-heart-dark-white', label: 'dark white heart', art: 'heart', size: 2, color: 'dark-white' },
      { id: 'mark-heart-medium-white', label: 'medium white heart', art: 'heart', size: 2, color: 'medium-white' },
      { id: 'mark-star-dark-red', label: 'dark red star', art: 'star', size: 2, color: 'dark-red' },
      { id: 'mark-star-light-red', label: 'light red star', art: 'star', size: 2, color: 'light-red' },
      { id: 'mark-star-dark-orange', label: 'dark orange star', art: 'star', size: 2, color: 'dark-orange' },
      { id: 'mark-star-orange', label: 'orange star', art: 'star', size: 2, color: 'orange' },
      { id: 'mark-star-light-orange', label: 'light orange star', art: 'star', size: 2, color: 'light-orange' },
      { id: 'mark-star-dark-yellow', label: 'dark yellow star', art: 'star', size: 2, color: 'dark-yellow' },
      { id: 'mark-star-light-yellow', label: 'light yellow star', art: 'star', size: 2, color: 'light-yellow' },
      { id: 'mark-star-dark-lime', label: 'dark lime star', art: 'star', size: 2, color: 'dark-lime' },
      { id: 'mark-star-lime', label: 'lime star', art: 'star', size: 2, color: 'lime' },
      { id: 'mark-star-light-lime', label: 'light lime star', art: 'star', size: 2, color: 'light-lime' },
      { id: 'mark-star-dark-green', label: 'dark green star', art: 'star', size: 2, color: 'dark-green' },
      { id: 'mark-star-light-green', label: 'light green star', art: 'star', size: 2, color: 'light-green' },
      { id: 'mark-star-dark-teal', label: 'dark teal star', art: 'star', size: 2, color: 'dark-teal' },
      { id: 'mark-star-teal', label: 'teal star', art: 'star', size: 2, color: 'teal' },
      { id: 'mark-star-light-teal', label: 'light teal star', art: 'star', size: 2, color: 'light-teal' },
      { id: 'mark-star-dark-cyan', label: 'dark cyan star', art: 'star', size: 2, color: 'dark-cyan' },
      { id: 'mark-star-light-cyan', label: 'light cyan star', art: 'star', size: 2, color: 'light-cyan' },
      { id: 'mark-star-dark-azure', label: 'dark azure star', art: 'star', size: 2, color: 'dark-azure' },
      { id: 'mark-star-azure', label: 'azure star', art: 'star', size: 2, color: 'azure' },
      { id: 'mark-star-light-azure', label: 'light azure star', art: 'star', size: 2, color: 'light-azure' },
      { id: 'mark-star-dark-blue', label: 'dark blue star', art: 'star', size: 2, color: 'dark-blue' },
      { id: 'mark-star-light-blue', label: 'light blue star', art: 'star', size: 2, color: 'light-blue' },
      { id: 'mark-star-dark-violet', label: 'dark violet star', art: 'star', size: 2, color: 'dark-violet' },
      { id: 'mark-star-violet', label: 'violet star', art: 'star', size: 2, color: 'violet' },
      { id: 'mark-star-light-violet', label: 'light violet star', art: 'star', size: 2, color: 'light-violet' },
      { id: 'mark-star-dark-magenta', label: 'dark magenta star', art: 'star', size: 2, color: 'dark-magenta' },
      { id: 'mark-star-light-magenta', label: 'light magenta star', art: 'star', size: 2, color: 'light-magenta' },
      { id: 'mark-star-dark-pink', label: 'dark pink star', art: 'star', size: 2, color: 'dark-pink' },
      { id: 'mark-star-pink', label: 'pink star', art: 'star', size: 2, color: 'pink' },
      { id: 'mark-star-light-pink', label: 'light pink star', art: 'star', size: 2, color: 'light-pink' },
      { id: 'mark-star-medium-black', label: 'medium black star', art: 'star', size: 2, color: 'medium-black' },
      { id: 'mark-star-light-black', label: 'light black star', art: 'star', size: 2, color: 'light-black' },
      { id: 'mark-star-dark-white', label: 'dark white star', art: 'star', size: 2, color: 'dark-white' },
      { id: 'mark-star-medium-white', label: 'medium white star', art: 'star', size: 2, color: 'medium-white' },
      { id: 'mark-dot-dark-red', label: 'dark red dot', art: 'dot', size: 0.9, color: 'dark-red' },
      { id: 'mark-dot-light-red', label: 'light red dot', art: 'dot', size: 0.9, color: 'light-red' },
      { id: 'mark-dot-dark-orange', label: 'dark orange dot', art: 'dot', size: 0.9, color: 'dark-orange' },
      { id: 'mark-dot-orange', label: 'orange dot', art: 'dot', size: 0.9, color: 'orange' },
      { id: 'mark-dot-light-orange', label: 'light orange dot', art: 'dot', size: 0.9, color: 'light-orange' },
      { id: 'mark-dot-dark-yellow', label: 'dark yellow dot', art: 'dot', size: 0.9, color: 'dark-yellow' },
      { id: 'mark-dot-light-yellow', label: 'light yellow dot', art: 'dot', size: 0.9, color: 'light-yellow' },
      { id: 'mark-dot-dark-lime', label: 'dark lime dot', art: 'dot', size: 0.9, color: 'dark-lime' },
      { id: 'mark-dot-lime', label: 'lime dot', art: 'dot', size: 0.9, color: 'lime' },
      { id: 'mark-dot-light-lime', label: 'light lime dot', art: 'dot', size: 0.9, color: 'light-lime' },
      { id: 'mark-dot-dark-green', label: 'dark green dot', art: 'dot', size: 0.9, color: 'dark-green' },
      { id: 'mark-dot-light-green', label: 'light green dot', art: 'dot', size: 0.9, color: 'light-green' },
      { id: 'mark-dot-dark-teal', label: 'dark teal dot', art: 'dot', size: 0.9, color: 'dark-teal' },
      { id: 'mark-dot-teal', label: 'teal dot', art: 'dot', size: 0.9, color: 'teal' },
      { id: 'mark-dot-light-teal', label: 'light teal dot', art: 'dot', size: 0.9, color: 'light-teal' },
      { id: 'mark-dot-dark-cyan', label: 'dark cyan dot', art: 'dot', size: 0.9, color: 'dark-cyan' },
      { id: 'mark-dot-light-cyan', label: 'light cyan dot', art: 'dot', size: 0.9, color: 'light-cyan' },
      { id: 'mark-dot-dark-azure', label: 'dark azure dot', art: 'dot', size: 0.9, color: 'dark-azure' },
      { id: 'mark-dot-azure', label: 'azure dot', art: 'dot', size: 0.9, color: 'azure' },
      { id: 'mark-dot-light-azure', label: 'light azure dot', art: 'dot', size: 0.9, color: 'light-azure' },
      { id: 'mark-dot-dark-blue', label: 'dark blue dot', art: 'dot', size: 0.9, color: 'dark-blue' },
      { id: 'mark-dot-light-blue', label: 'light blue dot', art: 'dot', size: 0.9, color: 'light-blue' },
      { id: 'mark-dot-dark-violet', label: 'dark violet dot', art: 'dot', size: 0.9, color: 'dark-violet' },
      { id: 'mark-dot-violet', label: 'violet dot', art: 'dot', size: 0.9, color: 'violet' },
      { id: 'mark-dot-light-violet', label: 'light violet dot', art: 'dot', size: 0.9, color: 'light-violet' },
      { id: 'mark-dot-dark-magenta', label: 'dark magenta dot', art: 'dot', size: 0.9, color: 'dark-magenta' },
      { id: 'mark-dot-light-magenta', label: 'light magenta dot', art: 'dot', size: 0.9, color: 'light-magenta' },
      { id: 'mark-dot-dark-pink', label: 'dark pink dot', art: 'dot', size: 0.9, color: 'dark-pink' },
      { id: 'mark-dot-pink', label: 'pink dot', art: 'dot', size: 0.9, color: 'pink' },
      { id: 'mark-dot-light-pink', label: 'light pink dot', art: 'dot', size: 0.9, color: 'light-pink' },
      { id: 'mark-dot-medium-black', label: 'medium black dot', art: 'dot', size: 0.9, color: 'medium-black' },
      { id: 'mark-dot-light-black', label: 'light black dot', art: 'dot', size: 0.9, color: 'light-black' },
      { id: 'mark-dot-dark-white', label: 'dark white dot', art: 'dot', size: 0.9, color: 'dark-white' },
      { id: 'mark-dot-medium-white', label: 'medium white dot', art: 'dot', size: 0.9, color: 'medium-white' },
      { id: 'mark-spot-dark-red', label: 'dark red spot', art: 'dot', size: 1.35, color: 'dark-red' },
      { id: 'mark-spot-light-red', label: 'light red spot', art: 'dot', size: 1.35, color: 'light-red' },
      { id: 'mark-spot-dark-orange', label: 'dark orange spot', art: 'dot', size: 1.35, color: 'dark-orange' },
      { id: 'mark-spot-orange', label: 'orange spot', art: 'dot', size: 1.35, color: 'orange' },
      { id: 'mark-spot-light-orange', label: 'light orange spot', art: 'dot', size: 1.35, color: 'light-orange' },
      { id: 'mark-spot-dark-yellow', label: 'dark yellow spot', art: 'dot', size: 1.35, color: 'dark-yellow' },
      { id: 'mark-spot-light-yellow', label: 'light yellow spot', art: 'dot', size: 1.35, color: 'light-yellow' },
      { id: 'mark-spot-dark-lime', label: 'dark lime spot', art: 'dot', size: 1.35, color: 'dark-lime' },
      { id: 'mark-spot-lime', label: 'lime spot', art: 'dot', size: 1.35, color: 'lime' },
      { id: 'mark-spot-light-lime', label: 'light lime spot', art: 'dot', size: 1.35, color: 'light-lime' },
      { id: 'mark-spot-dark-green', label: 'dark green spot', art: 'dot', size: 1.35, color: 'dark-green' },
      { id: 'mark-spot-light-green', label: 'light green spot', art: 'dot', size: 1.35, color: 'light-green' },
      { id: 'mark-spot-dark-teal', label: 'dark teal spot', art: 'dot', size: 1.35, color: 'dark-teal' },
      { id: 'mark-spot-teal', label: 'teal spot', art: 'dot', size: 1.35, color: 'teal' },
      { id: 'mark-spot-light-teal', label: 'light teal spot', art: 'dot', size: 1.35, color: 'light-teal' },
      { id: 'mark-spot-dark-cyan', label: 'dark cyan spot', art: 'dot', size: 1.35, color: 'dark-cyan' },
      { id: 'mark-spot-light-cyan', label: 'light cyan spot', art: 'dot', size: 1.35, color: 'light-cyan' },
      { id: 'mark-spot-dark-azure', label: 'dark azure spot', art: 'dot', size: 1.35, color: 'dark-azure' },
      { id: 'mark-spot-azure', label: 'azure spot', art: 'dot', size: 1.35, color: 'azure' },
      { id: 'mark-spot-light-azure', label: 'light azure spot', art: 'dot', size: 1.35, color: 'light-azure' },
      { id: 'mark-spot-dark-blue', label: 'dark blue spot', art: 'dot', size: 1.35, color: 'dark-blue' },
      { id: 'mark-spot-light-blue', label: 'light blue spot', art: 'dot', size: 1.35, color: 'light-blue' },
      { id: 'mark-spot-dark-violet', label: 'dark violet spot', art: 'dot', size: 1.35, color: 'dark-violet' },
      { id: 'mark-spot-violet', label: 'violet spot', art: 'dot', size: 1.35, color: 'violet' },
      { id: 'mark-spot-light-violet', label: 'light violet spot', art: 'dot', size: 1.35, color: 'light-violet' },
      { id: 'mark-spot-dark-magenta', label: 'dark magenta spot', art: 'dot', size: 1.35, color: 'dark-magenta' },
      { id: 'mark-spot-light-magenta', label: 'light magenta spot', art: 'dot', size: 1.35, color: 'light-magenta' },
      { id: 'mark-spot-dark-pink', label: 'dark pink spot', art: 'dot', size: 1.35, color: 'dark-pink' },
      { id: 'mark-spot-pink', label: 'pink spot', art: 'dot', size: 1.35, color: 'pink' },
      { id: 'mark-spot-light-pink', label: 'light pink spot', art: 'dot', size: 1.35, color: 'light-pink' },
      { id: 'mark-spot-medium-black', label: 'medium black spot', art: 'dot', size: 1.35, color: 'medium-black' },
      { id: 'mark-spot-light-black', label: 'light black spot', art: 'dot', size: 1.35, color: 'light-black' },
      { id: 'mark-spot-dark-white', label: 'dark white spot', art: 'dot', size: 1.35, color: 'dark-white' },
      { id: 'mark-spot-medium-white', label: 'medium white spot', art: 'dot', size: 1.35, color: 'medium-white' },
      { id: 'mark-bigspot-dark-red', label: 'dark red big spot', art: 'dot', size: 2, color: 'dark-red' },
      { id: 'mark-bigspot-light-red', label: 'light red big spot', art: 'dot', size: 2, color: 'light-red' },
      { id: 'mark-bigspot-dark-orange', label: 'dark orange big spot', art: 'dot', size: 2, color: 'dark-orange' },
      { id: 'mark-bigspot-orange', label: 'orange big spot', art: 'dot', size: 2, color: 'orange' },
      { id: 'mark-bigspot-light-orange', label: 'light orange big spot', art: 'dot', size: 2, color: 'light-orange' },
      { id: 'mark-bigspot-dark-yellow', label: 'dark yellow big spot', art: 'dot', size: 2, color: 'dark-yellow' },
      { id: 'mark-bigspot-light-yellow', label: 'light yellow big spot', art: 'dot', size: 2, color: 'light-yellow' },
      { id: 'mark-bigspot-dark-lime', label: 'dark lime big spot', art: 'dot', size: 2, color: 'dark-lime' },
      { id: 'mark-bigspot-lime', label: 'lime big spot', art: 'dot', size: 2, color: 'lime' },
      { id: 'mark-bigspot-light-lime', label: 'light lime big spot', art: 'dot', size: 2, color: 'light-lime' },
      { id: 'mark-bigspot-dark-green', label: 'dark green big spot', art: 'dot', size: 2, color: 'dark-green' },
      { id: 'mark-bigspot-light-green', label: 'light green big spot', art: 'dot', size: 2, color: 'light-green' },
      { id: 'mark-bigspot-dark-teal', label: 'dark teal big spot', art: 'dot', size: 2, color: 'dark-teal' },
      { id: 'mark-bigspot-teal', label: 'teal big spot', art: 'dot', size: 2, color: 'teal' },
      { id: 'mark-bigspot-light-teal', label: 'light teal big spot', art: 'dot', size: 2, color: 'light-teal' },
      { id: 'mark-bigspot-dark-cyan', label: 'dark cyan big spot', art: 'dot', size: 2, color: 'dark-cyan' },
      { id: 'mark-bigspot-light-cyan', label: 'light cyan big spot', art: 'dot', size: 2, color: 'light-cyan' },
      { id: 'mark-bigspot-dark-azure', label: 'dark azure big spot', art: 'dot', size: 2, color: 'dark-azure' },
      { id: 'mark-bigspot-azure', label: 'azure big spot', art: 'dot', size: 2, color: 'azure' },
      { id: 'mark-bigspot-light-azure', label: 'light azure big spot', art: 'dot', size: 2, color: 'light-azure' },
      { id: 'mark-bigspot-dark-blue', label: 'dark blue big spot', art: 'dot', size: 2, color: 'dark-blue' },
      { id: 'mark-bigspot-light-blue', label: 'light blue big spot', art: 'dot', size: 2, color: 'light-blue' },
      { id: 'mark-bigspot-dark-violet', label: 'dark violet big spot', art: 'dot', size: 2, color: 'dark-violet' },
      { id: 'mark-bigspot-violet', label: 'violet big spot', art: 'dot', size: 2, color: 'violet' },
      { id: 'mark-bigspot-light-violet', label: 'light violet big spot', art: 'dot', size: 2, color: 'light-violet' },
      { id: 'mark-bigspot-dark-magenta', label: 'dark magenta big spot', art: 'dot', size: 2, color: 'dark-magenta' },
      { id: 'mark-bigspot-light-magenta', label: 'light magenta big spot', art: 'dot', size: 2, color: 'light-magenta' },
      { id: 'mark-bigspot-dark-pink', label: 'dark pink big spot', art: 'dot', size: 2, color: 'dark-pink' },
      { id: 'mark-bigspot-pink', label: 'pink big spot', art: 'dot', size: 2, color: 'pink' },
      { id: 'mark-bigspot-light-pink', label: 'light pink big spot', art: 'dot', size: 2, color: 'light-pink' },
      { id: 'mark-bigspot-medium-black', label: 'medium black big spot', art: 'dot', size: 2, color: 'medium-black' },
      { id: 'mark-bigspot-light-black', label: 'light black big spot', art: 'dot', size: 2, color: 'light-black' },
      { id: 'mark-bigspot-dark-white', label: 'dark white big spot', art: 'dot', size: 2, color: 'dark-white' },
      { id: 'mark-bigspot-medium-white', label: 'medium white big spot', art: 'dot', size: 2, color: 'medium-white' },
      { id: 'mark-diamond-dark-red', label: 'dark red diamond', art: 'diamond', size: 2, color: 'dark-red' },
      { id: 'mark-diamond-light-red', label: 'light red diamond', art: 'diamond', size: 2, color: 'light-red' },
      { id: 'mark-diamond-dark-orange', label: 'dark orange diamond', art: 'diamond', size: 2, color: 'dark-orange' },
      { id: 'mark-diamond-orange', label: 'orange diamond', art: 'diamond', size: 2, color: 'orange' },
      { id: 'mark-diamond-light-orange', label: 'light orange diamond', art: 'diamond', size: 2, color: 'light-orange' },
      { id: 'mark-diamond-dark-yellow', label: 'dark yellow diamond', art: 'diamond', size: 2, color: 'dark-yellow' },
      { id: 'mark-diamond-light-yellow', label: 'light yellow diamond', art: 'diamond', size: 2, color: 'light-yellow' },
      { id: 'mark-diamond-dark-lime', label: 'dark lime diamond', art: 'diamond', size: 2, color: 'dark-lime' },
      { id: 'mark-diamond-lime', label: 'lime diamond', art: 'diamond', size: 2, color: 'lime' },
      { id: 'mark-diamond-light-lime', label: 'light lime diamond', art: 'diamond', size: 2, color: 'light-lime' },
      { id: 'mark-diamond-dark-green', label: 'dark green diamond', art: 'diamond', size: 2, color: 'dark-green' },
      { id: 'mark-diamond-light-green', label: 'light green diamond', art: 'diamond', size: 2, color: 'light-green' },
      { id: 'mark-diamond-dark-teal', label: 'dark teal diamond', art: 'diamond', size: 2, color: 'dark-teal' },
      { id: 'mark-diamond-teal', label: 'teal diamond', art: 'diamond', size: 2, color: 'teal' },
      { id: 'mark-diamond-light-teal', label: 'light teal diamond', art: 'diamond', size: 2, color: 'light-teal' },
      { id: 'mark-diamond-dark-cyan', label: 'dark cyan diamond', art: 'diamond', size: 2, color: 'dark-cyan' },
      { id: 'mark-diamond-light-cyan', label: 'light cyan diamond', art: 'diamond', size: 2, color: 'light-cyan' },
      { id: 'mark-diamond-dark-azure', label: 'dark azure diamond', art: 'diamond', size: 2, color: 'dark-azure' },
      { id: 'mark-diamond-azure', label: 'azure diamond', art: 'diamond', size: 2, color: 'azure' },
      { id: 'mark-diamond-light-azure', label: 'light azure diamond', art: 'diamond', size: 2, color: 'light-azure' },
      { id: 'mark-diamond-dark-blue', label: 'dark blue diamond', art: 'diamond', size: 2, color: 'dark-blue' },
      { id: 'mark-diamond-light-blue', label: 'light blue diamond', art: 'diamond', size: 2, color: 'light-blue' },
      { id: 'mark-diamond-dark-violet', label: 'dark violet diamond', art: 'diamond', size: 2, color: 'dark-violet' },
      { id: 'mark-diamond-violet', label: 'violet diamond', art: 'diamond', size: 2, color: 'violet' },
      { id: 'mark-diamond-light-violet', label: 'light violet diamond', art: 'diamond', size: 2, color: 'light-violet' },
      { id: 'mark-diamond-dark-magenta', label: 'dark magenta diamond', art: 'diamond', size: 2, color: 'dark-magenta' },
      { id: 'mark-diamond-light-magenta', label: 'light magenta diamond', art: 'diamond', size: 2, color: 'light-magenta' },
      { id: 'mark-diamond-dark-pink', label: 'dark pink diamond', art: 'diamond', size: 2, color: 'dark-pink' },
      { id: 'mark-diamond-pink', label: 'pink diamond', art: 'diamond', size: 2, color: 'pink' },
      { id: 'mark-diamond-light-pink', label: 'light pink diamond', art: 'diamond', size: 2, color: 'light-pink' },
      { id: 'mark-diamond-medium-black', label: 'medium black diamond', art: 'diamond', size: 2, color: 'medium-black' },
      { id: 'mark-diamond-light-black', label: 'light black diamond', art: 'diamond', size: 2, color: 'light-black' },
      { id: 'mark-diamond-dark-white', label: 'dark white diamond', art: 'diamond', size: 2, color: 'dark-white' },
      { id: 'mark-diamond-medium-white', label: 'medium white diamond', art: 'diamond', size: 2, color: 'medium-white' },
      { id: 'mark-crescent-dark-red', label: 'dark red crescent', art: 'crescent', size: 2, color: 'dark-red' },
      { id: 'mark-crescent-light-red', label: 'light red crescent', art: 'crescent', size: 2, color: 'light-red' },
      { id: 'mark-crescent-dark-orange', label: 'dark orange crescent', art: 'crescent', size: 2, color: 'dark-orange' },
      { id: 'mark-crescent-orange', label: 'orange crescent', art: 'crescent', size: 2, color: 'orange' },
      { id: 'mark-crescent-light-orange', label: 'light orange crescent', art: 'crescent', size: 2, color: 'light-orange' },
      { id: 'mark-crescent-dark-yellow', label: 'dark yellow crescent', art: 'crescent', size: 2, color: 'dark-yellow' },
      { id: 'mark-crescent-light-yellow', label: 'light yellow crescent', art: 'crescent', size: 2, color: 'light-yellow' },
      { id: 'mark-crescent-dark-lime', label: 'dark lime crescent', art: 'crescent', size: 2, color: 'dark-lime' },
      { id: 'mark-crescent-lime', label: 'lime crescent', art: 'crescent', size: 2, color: 'lime' },
      { id: 'mark-crescent-light-lime', label: 'light lime crescent', art: 'crescent', size: 2, color: 'light-lime' },
      { id: 'mark-crescent-dark-green', label: 'dark green crescent', art: 'crescent', size: 2, color: 'dark-green' },
      { id: 'mark-crescent-light-green', label: 'light green crescent', art: 'crescent', size: 2, color: 'light-green' },
      { id: 'mark-crescent-dark-teal', label: 'dark teal crescent', art: 'crescent', size: 2, color: 'dark-teal' },
      { id: 'mark-crescent-teal', label: 'teal crescent', art: 'crescent', size: 2, color: 'teal' },
      { id: 'mark-crescent-light-teal', label: 'light teal crescent', art: 'crescent', size: 2, color: 'light-teal' },
      { id: 'mark-crescent-dark-cyan', label: 'dark cyan crescent', art: 'crescent', size: 2, color: 'dark-cyan' },
      { id: 'mark-crescent-light-cyan', label: 'light cyan crescent', art: 'crescent', size: 2, color: 'light-cyan' },
      { id: 'mark-crescent-dark-azure', label: 'dark azure crescent', art: 'crescent', size: 2, color: 'dark-azure' },
      { id: 'mark-crescent-azure', label: 'azure crescent', art: 'crescent', size: 2, color: 'azure' },
      { id: 'mark-crescent-light-azure', label: 'light azure crescent', art: 'crescent', size: 2, color: 'light-azure' },
      { id: 'mark-crescent-dark-blue', label: 'dark blue crescent', art: 'crescent', size: 2, color: 'dark-blue' },
      { id: 'mark-crescent-light-blue', label: 'light blue crescent', art: 'crescent', size: 2, color: 'light-blue' },
      { id: 'mark-crescent-dark-violet', label: 'dark violet crescent', art: 'crescent', size: 2, color: 'dark-violet' },
      { id: 'mark-crescent-violet', label: 'violet crescent', art: 'crescent', size: 2, color: 'violet' },
      { id: 'mark-crescent-light-violet', label: 'light violet crescent', art: 'crescent', size: 2, color: 'light-violet' },
      { id: 'mark-crescent-dark-magenta', label: 'dark magenta crescent', art: 'crescent', size: 2, color: 'dark-magenta' },
      { id: 'mark-crescent-light-magenta', label: 'light magenta crescent', art: 'crescent', size: 2, color: 'light-magenta' },
      { id: 'mark-crescent-dark-pink', label: 'dark pink crescent', art: 'crescent', size: 2, color: 'dark-pink' },
      { id: 'mark-crescent-pink', label: 'pink crescent', art: 'crescent', size: 2, color: 'pink' },
      { id: 'mark-crescent-light-pink', label: 'light pink crescent', art: 'crescent', size: 2, color: 'light-pink' },
      { id: 'mark-crescent-medium-black', label: 'medium black crescent', art: 'crescent', size: 2, color: 'medium-black' },
      { id: 'mark-crescent-light-black', label: 'light black crescent', art: 'crescent', size: 2, color: 'light-black' },
      { id: 'mark-crescent-dark-white', label: 'dark white crescent', art: 'crescent', size: 2, color: 'dark-white' },
      { id: 'mark-crescent-medium-white', label: 'medium white crescent', art: 'crescent', size: 2, color: 'medium-white' },
      // THE MEDIC CROSS (v378, 2026-09-04; docs/proofs/mock-16-cross.png): arms 0.34 of the box, square-ended, no stroke — the most legible shape in the tray at 11 px — in all forty-two plain colours.
      { id: 'mark-cross-dark-red', label: 'dark red cross', art: 'cross', size: 2, color: 'dark-red' },
      { id: 'mark-cross-red', label: 'red cross', art: 'cross', size: 2, color: 'red' },
      { id: 'mark-cross-light-red', label: 'light red cross', art: 'cross', size: 2, color: 'light-red' },
      { id: 'mark-cross-dark-orange', label: 'dark orange cross', art: 'cross', size: 2, color: 'dark-orange' },
      { id: 'mark-cross-orange', label: 'orange cross', art: 'cross', size: 2, color: 'orange' },
      { id: 'mark-cross-light-orange', label: 'light orange cross', art: 'cross', size: 2, color: 'light-orange' },
      { id: 'mark-cross-dark-yellow', label: 'dark yellow cross', art: 'cross', size: 2, color: 'dark-yellow' },
      { id: 'mark-cross-yellow', label: 'yellow cross', art: 'cross', size: 2, color: 'yellow' },
      { id: 'mark-cross-light-yellow', label: 'light yellow cross', art: 'cross', size: 2, color: 'light-yellow' },
      { id: 'mark-cross-dark-lime', label: 'dark lime cross', art: 'cross', size: 2, color: 'dark-lime' },
      { id: 'mark-cross-lime', label: 'lime cross', art: 'cross', size: 2, color: 'lime' },
      { id: 'mark-cross-light-lime', label: 'light lime cross', art: 'cross', size: 2, color: 'light-lime' },
      { id: 'mark-cross-dark-green', label: 'dark green cross', art: 'cross', size: 2, color: 'dark-green' },
      { id: 'mark-cross-green', label: 'green cross', art: 'cross', size: 2, color: 'green' },
      { id: 'mark-cross-light-green', label: 'light green cross', art: 'cross', size: 2, color: 'light-green' },
      { id: 'mark-cross-dark-teal', label: 'dark teal cross', art: 'cross', size: 2, color: 'dark-teal' },
      { id: 'mark-cross-teal', label: 'teal cross', art: 'cross', size: 2, color: 'teal' },
      { id: 'mark-cross-light-teal', label: 'light teal cross', art: 'cross', size: 2, color: 'light-teal' },
      { id: 'mark-cross-dark-cyan', label: 'dark cyan cross', art: 'cross', size: 2, color: 'dark-cyan' },
      { id: 'mark-cross-cyan', label: 'cyan cross', art: 'cross', size: 2, color: 'cyan' },
      { id: 'mark-cross-light-cyan', label: 'light cyan cross', art: 'cross', size: 2, color: 'light-cyan' },
      { id: 'mark-cross-dark-azure', label: 'dark azure cross', art: 'cross', size: 2, color: 'dark-azure' },
      { id: 'mark-cross-azure', label: 'azure cross', art: 'cross', size: 2, color: 'azure' },
      { id: 'mark-cross-light-azure', label: 'light azure cross', art: 'cross', size: 2, color: 'light-azure' },
      { id: 'mark-cross-dark-blue', label: 'dark blue cross', art: 'cross', size: 2, color: 'dark-blue' },
      { id: 'mark-cross-blue', label: 'blue cross', art: 'cross', size: 2, color: 'blue' },
      { id: 'mark-cross-light-blue', label: 'light blue cross', art: 'cross', size: 2, color: 'light-blue' },
      { id: 'mark-cross-dark-violet', label: 'dark violet cross', art: 'cross', size: 2, color: 'dark-violet' },
      { id: 'mark-cross-violet', label: 'violet cross', art: 'cross', size: 2, color: 'violet' },
      { id: 'mark-cross-light-violet', label: 'light violet cross', art: 'cross', size: 2, color: 'light-violet' },
      { id: 'mark-cross-dark-magenta', label: 'dark magenta cross', art: 'cross', size: 2, color: 'dark-magenta' },
      { id: 'mark-cross-magenta', label: 'magenta cross', art: 'cross', size: 2, color: 'magenta' },
      { id: 'mark-cross-light-magenta', label: 'light magenta cross', art: 'cross', size: 2, color: 'light-magenta' },
      { id: 'mark-cross-dark-pink', label: 'dark pink cross', art: 'cross', size: 2, color: 'dark-pink' },
      { id: 'mark-cross-pink', label: 'pink cross', art: 'cross', size: 2, color: 'pink' },
      { id: 'mark-cross-light-pink', label: 'light pink cross', art: 'cross', size: 2, color: 'light-pink' },
      { id: 'mark-cross-dark-black', label: 'dark black cross', art: 'cross', size: 2, color: 'dark-black' },
      { id: 'mark-cross-medium-black', label: 'medium black cross', art: 'cross', size: 2, color: 'medium-black' },
      { id: 'mark-cross-light-black', label: 'light black cross', art: 'cross', size: 2, color: 'light-black' },
      { id: 'mark-cross-dark-white', label: 'dark white cross', art: 'cross', size: 2, color: 'dark-white' },
      { id: 'mark-cross-medium-white', label: 'medium white cross', art: 'cross', size: 2, color: 'medium-white' },
      { id: 'mark-cross-light-white', label: 'light white cross', art: 'cross', size: 2, color: 'light-white' },
    ],
  },
  flags: {
    label: 'FLAGS',
    // EMPTY BY RULING (Eddie, 2026-08-18, the PIXEL 320 cut). At 320
    // a sticker occupies ~5-8 px across: not a small canvas, a
    // DIFFERENT MEDIUM. Flags carry their identity in fine geometry
    // (cantons, stars, emblems, text) that cannot survive at that
    // size, so the sticker-flag set is retired wholesale — the WRAPS
    // set carries national identity instead, where field-and-band
    // geometry reads across a 12-body field.
    // Catalogue/registry split (2026-08-16 lesson): the flag ART
    // stays in the registry, so saves carrying flag ids keep them
    // harmlessly, orientation checks still work, and the day a flag
    // earns a hand-authored 6 px icon it returns by re-listing.
    items: [],
  },
  wraps: {
    label: 'WRAPS',
    // The luxury edition of the flag you already love (ruled
    // 2026-08-16, its own set): one per flag, earned by the roll like
    // everything else, rarity from the arithmetic as always. wrap:
    // true is the behaviour flag the editor and place() read — fixed
    // pose, binary apply, pinned to the bottom of the pile.
    // WRAP ELIGIBILITY LAW (Eddie, 2026-08-18): a wrap ships only if
    // its identity is FIELD-AND-BAND geometry — stripes, crosses,
    // triband, a large centred disc. Anything whose identity needs a
    // canton, stars, an emblem or text does NOT ship, because at 320
    // it resolves to a coloured rectangle that lies about which
    // country it is. Retired on this law: wrap-cn (stars in a
    // canton), wrap-us (canton + 50 stars). Their art stays in the
    // registry per the catalogue/registry split.
    // The set is no longer flags-only: pirate, egg and friends land
    // here, authored AS ~18 px silhouette-changing colour blocking —
    // which is what actually reads across a field.
    items: [
      { id: 'wrap-fr', label: 'France', art: 'flagwrap', flag: 'fr', wrap: true },
      { id: 'wrap-ie', label: 'Ireland', art: 'flagwrap', flag: 'ie', wrap: true },
      { id: 'wrap-it', label: 'Italy', art: 'flagwrap', flag: 'it', wrap: true },
      { id: 'wrap-de', label: 'Germany', art: 'flagwrap', flag: 'de', wrap: true },
      { id: 'wrap-pl', label: 'Poland', art: 'flagwrap', flag: 'pl', wrap: true },
      { id: 'wrap-jp', label: 'Japan', art: 'flagwrap', flag: 'jp', wrap: true },
      { id: 'wrap-vn', label: 'Vietnam', art: 'flagwrap', flag: 'vn', wrap: true },
      { id: 'wrap-bd', label: 'Bangladesh', art: 'flagwrap', flag: 'bd', wrap: true },
      { id: 'wrap-id', label: 'Indonesia', art: 'flagwrap', flag: 'id', wrap: true },
      { id: 'wrap-nl', label: 'Netherlands', art: 'flagwrap', flag: 'nl', wrap: true },
      { id: 'wrap-ng', label: 'Nigeria', art: 'flagwrap', flag: 'ng', wrap: true },
      { id: 'wrap-hu', label: 'Hungary', art: 'flagwrap', flag: 'hu', wrap: true },
      { id: 'wrap-at', label: 'Austria', art: 'flagwrap', flag: 'at', wrap: true },
      { id: 'wrap-be', label: 'Belgium', art: 'flagwrap', flag: 'be', wrap: true },
      { id: 'wrap-ro', label: 'Romania', art: 'flagwrap', flag: 'ro', wrap: true },
      { id: 'wrap-ci', label: "C\u00f4te d'Ivoire", art: 'flagwrap', flag: 'ci', wrap: true },
      { id: 'wrap-gh', label: 'Ghana', art: 'flagwrap', flag: 'gh', wrap: true },
      { id: 'wrap-sn', label: 'Senegal', art: 'flagwrap', flag: 'sn', wrap: true },
      { id: 'wrap-cm', label: 'Cameroon', art: 'flagwrap', flag: 'cm', wrap: true },
      { id: 'wrap-es', label: 'Spain', art: 'flagwrap', flag: 'es', wrap: true },
      { id: 'wrap-co', label: 'Colombia', art: 'flagwrap', flag: 'co', wrap: true },
      { id: 'wrap-th', label: 'Thailand', art: 'flagwrap', flag: 'th', wrap: true },
      // ---- PLAIN WRAPS (2026-09-04): block colours, see PLAIN above.
      // Same set as the flags, so the set-size law makes every wrap
      // a little rarer (22 -> 30 members) — a decision, stated.
      { id: 'wrap-red', label: 'red', art: 'flagwrap', flag: 'plain-red', wrap: true },
      { id: 'wrap-yellow', label: 'yellow', art: 'flagwrap', flag: 'plain-yellow', wrap: true },
      { id: 'wrap-green', label: 'green', art: 'flagwrap', flag: 'plain-green', wrap: true },
      { id: 'wrap-cyan', label: 'cyan', art: 'flagwrap', flag: 'plain-cyan', wrap: true },
      { id: 'wrap-blue', label: 'blue', art: 'flagwrap', flag: 'plain-blue', wrap: true },
      { id: 'wrap-magenta', label: 'magenta', art: 'flagwrap', flag: 'plain-magenta', wrap: true },
      { id: 'wrap-white', label: 'white', art: 'flagwrap', flag: 'plain-white', wrap: true },
      { id: 'wrap-black', label: 'black', art: 'flagwrap', flag: 'plain-black', wrap: true },
      // ---- v378: the rest of the forty-two (see PLAIN); wrap-black is dark black, wrap-white is light white
      { id: 'wrap-dark-red', label: 'dark red', art: 'flagwrap', flag: 'plain-dark-red', wrap: true },
      { id: 'wrap-light-red', label: 'light red', art: 'flagwrap', flag: 'plain-light-red', wrap: true },
      { id: 'wrap-dark-orange', label: 'dark orange', art: 'flagwrap', flag: 'plain-dark-orange', wrap: true },
      { id: 'wrap-orange', label: 'orange', art: 'flagwrap', flag: 'plain-orange', wrap: true },
      { id: 'wrap-light-orange', label: 'light orange', art: 'flagwrap', flag: 'plain-light-orange', wrap: true },
      { id: 'wrap-dark-yellow', label: 'dark yellow', art: 'flagwrap', flag: 'plain-dark-yellow', wrap: true },
      { id: 'wrap-light-yellow', label: 'light yellow', art: 'flagwrap', flag: 'plain-light-yellow', wrap: true },
      { id: 'wrap-dark-lime', label: 'dark lime', art: 'flagwrap', flag: 'plain-dark-lime', wrap: true },
      { id: 'wrap-lime', label: 'lime', art: 'flagwrap', flag: 'plain-lime', wrap: true },
      { id: 'wrap-light-lime', label: 'light lime', art: 'flagwrap', flag: 'plain-light-lime', wrap: true },
      { id: 'wrap-dark-green', label: 'dark green', art: 'flagwrap', flag: 'plain-dark-green', wrap: true },
      { id: 'wrap-light-green', label: 'light green', art: 'flagwrap', flag: 'plain-light-green', wrap: true },
      { id: 'wrap-dark-teal', label: 'dark teal', art: 'flagwrap', flag: 'plain-dark-teal', wrap: true },
      { id: 'wrap-teal', label: 'teal', art: 'flagwrap', flag: 'plain-teal', wrap: true },
      { id: 'wrap-light-teal', label: 'light teal', art: 'flagwrap', flag: 'plain-light-teal', wrap: true },
      { id: 'wrap-dark-cyan', label: 'dark cyan', art: 'flagwrap', flag: 'plain-dark-cyan', wrap: true },
      { id: 'wrap-light-cyan', label: 'light cyan', art: 'flagwrap', flag: 'plain-light-cyan', wrap: true },
      { id: 'wrap-dark-azure', label: 'dark azure', art: 'flagwrap', flag: 'plain-dark-azure', wrap: true },
      { id: 'wrap-azure', label: 'azure', art: 'flagwrap', flag: 'plain-azure', wrap: true },
      { id: 'wrap-light-azure', label: 'light azure', art: 'flagwrap', flag: 'plain-light-azure', wrap: true },
      { id: 'wrap-dark-blue', label: 'dark blue', art: 'flagwrap', flag: 'plain-dark-blue', wrap: true },
      { id: 'wrap-light-blue', label: 'light blue', art: 'flagwrap', flag: 'plain-light-blue', wrap: true },
      { id: 'wrap-dark-violet', label: 'dark violet', art: 'flagwrap', flag: 'plain-dark-violet', wrap: true },
      { id: 'wrap-violet', label: 'violet', art: 'flagwrap', flag: 'plain-violet', wrap: true },
      { id: 'wrap-light-violet', label: 'light violet', art: 'flagwrap', flag: 'plain-light-violet', wrap: true },
      { id: 'wrap-dark-magenta', label: 'dark magenta', art: 'flagwrap', flag: 'plain-dark-magenta', wrap: true },
      { id: 'wrap-light-magenta', label: 'light magenta', art: 'flagwrap', flag: 'plain-light-magenta', wrap: true },
      { id: 'wrap-dark-pink', label: 'dark pink', art: 'flagwrap', flag: 'plain-dark-pink', wrap: true },
      { id: 'wrap-pink', label: 'pink', art: 'flagwrap', flag: 'plain-pink', wrap: true },
      { id: 'wrap-light-pink', label: 'light pink', art: 'flagwrap', flag: 'plain-light-pink', wrap: true },
      { id: 'wrap-medium-black', label: 'medium black', art: 'flagwrap', flag: 'plain-medium-black', wrap: true },
      { id: 'wrap-light-black', label: 'light black', art: 'flagwrap', flag: 'plain-light-black', wrap: true },
      { id: 'wrap-dark-white', label: 'dark white', art: 'flagwrap', flag: 'plain-dark-white', wrap: true },
      { id: 'wrap-medium-white', label: 'medium white', art: 'flagwrap', flag: 'plain-medium-white', wrap: true },
      // ---- 2026-09-04: Cornwall, Pride, Trans
      { id: 'wrap-kw', label: 'Cornwall', art: 'flagwrap', flag: 'kw', wrap: true },
      { id: 'wrap-pride', label: 'Pride', art: 'flagwrap', flag: 'pride', wrap: true },
      { id: 'wrap-trans', label: 'Trans', art: 'flagwrap', flag: 'trans', wrap: true },
      // ---- 2026-09-04: checkers, four across
      { id: 'wrap-check-bw', label: 'black & white checker', art: 'flagwrap', flag: 'check-bw', wrap: true },
      { id: 'wrap-check-mb', label: 'magenta & black checker', art: 'flagwrap', flag: 'check-mb', wrap: true },
      { id: 'wrap-check-yb', label: 'yellow & black checker', art: 'flagwrap', flag: 'check-yb', wrap: true },
      { id: 'wrap-check-bc', label: 'blue & cyan checker', art: 'flagwrap', flag: 'check-bc', wrap: true },
      { id: 'wrap-check-rw', label: 'red & white checker', art: 'flagwrap', flag: 'check-rw', wrap: true },
      // ---- 2026-09-04: splits (see SPLITS)
      { id: 'wrap-half-rw', label: 'red over white', art: 'flagwrap', flag: 'half-rw', wrap: true },
      { id: 'wrap-half-bw', label: 'black over white', art: 'flagwrap', flag: 'half-bw', wrap: true },
      { id: 'wrap-half-yw', label: 'yellow over white', art: 'flagwrap', flag: 'half-yw', wrap: true },
      { id: 'wrap-half-uw', label: 'blue over white', art: 'flagwrap', flag: 'half-uw', wrap: true },
      { id: 'wrap-half-gw', label: 'green over white', art: 'flagwrap', flag: 'half-gw', wrap: true },
      { id: 'wrap-quad-rk', label: 'red & black quarters', art: 'flagwrap', flag: 'quad-rk', wrap: true },
      { id: 'wrap-quad-uw', label: 'blue & white quarters', art: 'flagwrap', flag: 'quad-uw', wrap: true },
      { id: 'wrap-quad-yk', label: 'yellow & black quarters', art: 'flagwrap', flag: 'quad-yk', wrap: true },
      { id: 'wrap-quad-gw', label: 'green & white quarters', art: 'flagwrap', flag: 'quad-gw', wrap: true },
      { id: 'wrap-diag-mc', label: 'magenta / cyan diagonal', art: 'flagwrap', flag: 'diag-mc', wrap: true },
      { id: 'wrap-diag-uy', label: 'blue / yellow diagonal', art: 'flagwrap', flag: 'diag-uy', wrap: true },
      { id: 'wrap-diag-ry', label: 'red / yellow diagonal', art: 'flagwrap', flag: 'diag-ry', wrap: true },
      { id: 'wrap-diag-cw', label: 'cyan / white diagonal', art: 'flagwrap', flag: 'diag-cw', wrap: true },
      { id: 'wrap-diag-mk', label: 'magenta / black diagonal', art: 'flagwrap', flag: 'diag-mk', wrap: true },
      { id: 'wrap-side-bw', label: 'black | white', art: 'flagwrap', flag: 'side-bw', wrap: true },
      { id: 'wrap-side-ru', label: 'red | blue', art: 'flagwrap', flag: 'side-ru', wrap: true },
    ],
  },
  numbers: {
    label: 'NUMBERS',
    // EMPTY BY DECISION (2026-08-15): the varsity '2' was cut on look.
    // The glyph machinery below it stays — the set returns when the
    // numerals get a face worth shipping, and the roster ruling that
    // Second Place Steve wears a '2' (nothing a bot wears may be
    // unobtainable) is PARKED until it does.
    items: [],
  },
};

const ALL = [];
for (const [setId, set] of Object.entries(SETS)) {
  for (const it of set.items) ALL.push(Object.assign({ set: setId }, it));
}
function byId(id) { return ALL.find(i => i.id === id) || null; }

// ---- WHAT A MELON IS WEARING ---------------------------------------
// SIX decals (2026-09-04, Eddie: "cap should change to 6, from 5" —
// polka and the composed looks wanted one more), untyped: six of
// anything. Typed slots ("one eye, one mouth, four stickers") would
// push every melon toward the same face and undo the variety the
// wardrobe exists to create — a melon covered in six dots is a valid
// and funny choice.
const MAX_DECALS = 6;

// A worn decal is { id, u, v, rot, s }. Stored on the melon spec.
function worn(spec) {
  return (spec && Array.isArray(spec.decals)) ? spec.decals : [];
}

// SEEDED PLACEMENT, for now. The item lands somewhere sensible for
// its kind, derived from the melon's seed plus the item, so a given
// melon always wears it in the same spot on every device — and so
// the game slapping it on wherever is itself deadpan. Drag-to-place
// will write the same four numbers.
function place(spec, itemId, index) {
  const item = byId(itemId);
  // A WRAP HAS ONE POSE. No seed, no region, no roll of the dice —
  // centred, full coverage, square. The stored form is the same
  // { id, u, v, rot, s } as everything else, so nothing downstream
  // knows wraps exist.
  if (item && item.wrap) {
    return { id: itemId, u: WRAP_POSE.u, v: WRAP_POSE.v,
      rot: WRAP_POSE.rot, s: WRAP_POSE.s };
  }
  const seed = ((spec && spec.seed) || 0) ^ hash(itemId + ':' + index);
  const rng = window.FF.mulberry32(seed >>> 0);
  const set = item ? item.set : 'markings';
  // Regions keep the arrangement readable without dictating a face:
  // eyes sit high, mouths low, everything else roams. The player will
  // be able to overrule all of it later.
  let u, v;
  if (set === 'eyes') {
    u = 0.9 + rng() * 1.35;          // across the middle of the face
    v = 0.75 + rng() * 0.5;          // upper half
  } else if (set === 'mouths') {
    u = 1.2 + rng() * 0.75;
    v = 1.75 + rng() * 0.5;          // lower half
  } else if (item && item.art === 'glyph') {
    // GLYPHS MUST STAY READABLE. Numbers and letters carry meaning in
    // their shape, so unlike a star or a heart they do not survive
    // being flung at the rim: at the pointy end a decal renders 35%
    // narrower and near the girth 30% flatter (re-derived under the
    // true-geodesic mesh after bug 7 — the old law exaggerated the
    // girth squash), which turns a 7 into a smear. Everything else may roam; a glyph is pinned near the
    // centre of the face, where the surface is closest to head-on.
    u = 1.30 + rng() * 0.55;
    v = 1.30 + rng() * 0.55;
  } else {
    u = 0.75 + rng() * 1.65;
    v = 0.85 + rng() * 1.4;
  }
  return {
    id: itemId,
    u, v,
    rot: (rng() - 0.5) * 0.7,
    // PIXEL 320 (Eddie, 2026-08-18): ONE authored sticker size. The
    // seeded 0.24-0.36 spread rendered 3-8 px at 320 — the small end
    // could not carry an identity at all, and a size the player
    // cannot judge is not variety, it is a lottery. item.size still
    // applies: art boxes differ (a googly eye fills its box, a heart
    // does not), so the multiplier equalises VISUAL weight.
    s: STICKER_S * ((item && item.size) || 1),
  };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A signature of what a melon wears, for the raster cache key: decals
// are composited INTO the pattern raster (that is what gives them the
// rind's own foreshortening and its caching), so two melons that wear
// different things must not share a raster.
function signature(spec) {
  const d = worn(spec);
  if (!d.length) return '';
  return '+' + d.map(x => x.id + ',' + x.u.toFixed(2) + ',' + x.v.toFixed(2)
    + ',' + x.rot.toFixed(2) + ',' + x.s.toFixed(2) + (x.paint ? ',' + x.paint : '')).join(';');
}

// The scale ceiling BY KIND (ruled 2026-08-16): wraps are fixed (the
// knob never appears); flag STICKERS cap at 1.2, low enough that the
// emblem-too-big failure mode is retired from the sticker path too —
// full coverage is the wrap's job now; everything else keeps the
// full-coverage ceiling.
function maxScaleFor(item) {
  if (!item) return 2.6;
  if (item.wrap) return WRAP_POSE.s;
  if (item.art === 'flag') return 1.2;
  return 2.6;
}

// Paint an item's art flat onto a square canvas — the tray chips and
// the award card share this, so a sticker can never look different in
// the two places it is shown small.
function paintArt(cv, item) {
  const c2 = cv.getContext('2d');
  const S = cv.width;
  const img = c2.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ink = sampleArt(item, (x / (S - 1)) * 2 - 1, (y / (S - 1)) * 2 - 1);
      if (!ink) continue;
      const o = (y * S + x) * 4;
      img.data[o] = ink[0]; img.data[o + 1] = ink[1];
      img.data[o + 2] = ink[2]; img.data[o + 3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
}

window.FF = window.FF || {};
window.FF.decals = {
  SETS, ALL, byId, MAX_DECALS,
  project, unproject, pointAt, unitAt, tangentsAt, sampleAt, foreshorten, visible,
  buildStickerMesh, meshSample, meshNFor, MESH_STEP, MESH_N_MIN, MESH_N_MAX, MESH_CELL,
  stickerPoint, FEATURES,
  ART, VARSITY, FLAGS, sampleArt, sampleWorn, PLAIN, PLAIN_KEYS,
  worn, place, signature, paintArt, maxScaleFor, WRAP_POSE, WRAP_BLEED,
};
})();