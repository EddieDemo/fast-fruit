// ============================================================
// SHADING — the lighting rig. First-class module: ONE sun, one set
// of band thresholds, one parameter table — and everything visual
// (melons, ghosts, smoke, shadows, ink) QUERIES it. Art direction is
// data here: the Shader Studio (studio.js) edits P live and the whole
// game re-lights, because nothing else owns a lighting constant.
//
// Structure:
//   P        — the live parameter state (defaults = today's look)
//   SCHEMA   — self-describing parameter table; the studio builds its
//              UI from this, so new effects appear there automatically
//   color    — perceptual color solvers (CIE L* band colors, cached)
//   geometry — exact spheroid Lambert solvers (iso-contours, brightest
//              point, rim arcs) — the analytic heart
// ============================================================

(function () {
'use strict';

// ---- The live parameter state (defaults = the current shipped look) ----
const P = {
  // Sun
  sunAngleDeg: 233,      // atan2(-0.8,-0.6) ~ 233deg: upper-left (y-down)
  sunLz: 0.42,           // elevation toward the viewer
  shadeEcc: 1.0,         // shading-normal eccentricity boost (1 = honest)
  // Bands (multi-band cel). Regions evaluated darkest -> brightest.
  shadowBand: false,     // core-shadow band on the dark side
  shadowTau: 0.08,       // diffuse below this = core shadow
  shadowDL: -8,          // its L* delta
  litTau: 0.52,          // main lit band threshold
  litDL: 11,             // its L* delta
  band2: false,          // second, brighter lit band
  band2Tau: 0.78,
  band2DL: 18,
  // Specular ping
  specular: false,
  specTau: 0.965,        // appears only when the pose aligns this well
  specSize: 0.16,        // radius as fraction of minor axis
  specDL: 30,
  // Rim light (bright crescent hugging the silhouette opposite the sun)
  rim: false,
  rimWidth: 3.5,         // world px
  rimCutoff: 0.35,       // how far around the dark side it wraps (0..1)
  rimDL: 14,
  // Contact shadow (body darkens near its ground touch)
  contactShadow: false,
  contactFrac: 0.22,     // band height as fraction of minor axis
  contactAlpha: 0.18,
  contactMaxM: 0.6,      // fades out beyond this many metres off the ground
  // Cast shadow (ellipse projected onto the terrain)
  castShadow: false,
  castAlpha: 0.22,
  castStretch: 1.0,      // extra along-slope elongation on the true footprint
  castFlat: 0.3,         // shadow thickness as fraction of its length
  castSoft: false,       // penumbra ring at half alpha
  castMaxM: 3.5,         // fades with height, gone beyond this
  // Pattern
  showPattern: true,     // rind pattern layer (stripes / net / crackle)
  // Ink
  inkMode: 'none',       // 'none' | 'silhouette' | 'weighted'
  inkWidth: 2.0,
  inkDarkK: 0.55,        // outline = darken(body, k)
  // Motion (animation tier)
  smear: false,
  smearThresh: 1400,     // px/s
  smearAmount: 0.16,     // max stretch fraction
  speedLines: false,
  speedThresh: 1600,
  impactStar: false,
  impactSize: 1.6,       // multiples of minor axis
};

// ---- The schema: the studio builds its UI from this ----
const SCHEMA = [
  { group: 'Sun', key: 'sunAngleDeg', label: 'sun angle', type: 'range', min: 0, max: 360, step: 1 },
  { group: 'Sun', key: 'sunLz', label: 'sun elevation', type: 'range', min: 0.05, max: 1, step: 0.01 },
  { group: 'Sun', key: 'shadeEcc', label: 'shading ecc', type: 'range', min: 1, max: 3, step: 0.05 },
  { group: 'Bands', key: 'shadowBand', label: 'core shadow', type: 'bool' },
  { group: 'Bands', key: 'shadowTau', label: 'shadow tau', type: 'range', min: -0.4, max: 0.4, step: 0.01 },
  { group: 'Bands', key: 'shadowDL', label: 'shadow dL*', type: 'range', min: -25, max: 0, step: 1 },
  { group: 'Bands', key: 'litTau', label: 'lit tau', type: 'range', min: 0.1, max: 0.9, step: 0.01 },
  { group: 'Bands', key: 'litDL', label: 'lit dL*', type: 'range', min: 2, max: 30, step: 1 },
  { group: 'Bands', key: 'band2', label: '2nd lit band', type: 'bool' },
  { group: 'Bands', key: 'band2Tau', label: 'band2 tau', type: 'range', min: 0.5, max: 0.98, step: 0.01 },
  { group: 'Bands', key: 'band2DL', label: 'band2 dL*', type: 'range', min: 5, max: 40, step: 1 },
  { group: 'Highlights', key: 'specular', label: 'specular ping', type: 'bool' },
  { group: 'Highlights', key: 'specTau', label: 'spec align', type: 'range', min: 0.85, max: 0.999, step: 0.001 },
  { group: 'Highlights', key: 'specSize', label: 'spec size', type: 'range', min: 0.05, max: 0.4, step: 0.01 },
  { group: 'Highlights', key: 'specDL', label: 'spec dL*', type: 'range', min: 10, max: 45, step: 1 },
  { group: 'Highlights', key: 'rim', label: 'rim light', type: 'bool' },
  { group: 'Highlights', key: 'rimWidth', label: 'rim width', type: 'range', min: 1, max: 9, step: 0.5 },
  { group: 'Highlights', key: 'rimCutoff', label: 'rim wrap', type: 'range', min: 0.05, max: 0.9, step: 0.01 },
  { group: 'Highlights', key: 'rimDL', label: 'rim dL*', type: 'range', min: 4, max: 30, step: 1 },
  { group: 'Shadows', key: 'contactShadow', label: 'contact shadow', type: 'bool' },
  { group: 'Shadows', key: 'contactFrac', label: 'contact height', type: 'range', min: 0.08, max: 0.5, step: 0.01 },
  { group: 'Shadows', key: 'contactAlpha', label: 'contact alpha', type: 'range', min: 0.05, max: 0.5, step: 0.01 },
  { group: 'Shadows', key: 'contactMaxM', label: 'contact range m', type: 'range', min: 0.1, max: 2, step: 0.05 },
  { group: 'Shadows', key: 'castShadow', label: 'cast shadow', type: 'bool' },
  { group: 'Shadows', key: 'castAlpha', label: 'cast alpha', type: 'range', min: 0.05, max: 0.5, step: 0.01 },
  { group: 'Shadows', key: 'castStretch', label: 'cast stretch', type: 'range', min: 0.6, max: 2.5, step: 0.05 },
  { group: 'Shadows', key: 'castFlat', label: 'cast thickness', type: 'range', min: 0.1, max: 0.7, step: 0.01 },
  { group: 'Shadows', key: 'castSoft', label: 'cast penumbra', type: 'bool' },
  { group: 'Shadows', key: 'castMaxM', label: 'cast range m', type: 'range', min: 1, max: 8, step: 0.25 },
  { group: 'Pattern', key: 'showPattern', label: 'rind pattern', type: 'bool' },
  { group: 'Ink', key: 'inkMode', label: 'ink', type: 'select', options: ['none', 'silhouette', 'weighted'] },
  { group: 'Ink', key: 'inkWidth', label: 'ink width', type: 'range', min: 0.5, max: 6, step: 0.25 },
  { group: 'Ink', key: 'inkDarkK', label: 'ink darkness', type: 'range', min: 0.2, max: 0.85, step: 0.01 },
  { group: 'Motion', key: 'smear', label: 'speed smear', type: 'bool' },
  { group: 'Motion', key: 'smearThresh', label: 'smear at px/s', type: 'range', min: 600, max: 2600, step: 50 },
  { group: 'Motion', key: 'smearAmount', label: 'smear amount', type: 'range', min: 0.05, max: 0.4, step: 0.01 },
  { group: 'Motion', key: 'speedLines', label: 'speed lines', type: 'bool' },
  { group: 'Motion', key: 'speedThresh', label: 'lines at px/s', type: 'range', min: 800, max: 3000, step: 50 },
  { group: 'Motion', key: 'impactStar', label: 'impact star', type: 'bool' },
  { group: 'Motion', key: 'impactSize', label: 'star size', type: 'range', min: 0.8, max: 3, step: 0.1 },
];

// ---- Derived sun (recomputed on read; cheap) ----
function sun() {
  const a = P.sunAngleDeg * Math.PI / 180;
  return { x: Math.cos(a), y: Math.sin(a), lz: P.sunLz, angle: a };
}

// ---- Perceptual color solvers ----
function srgbLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lstarOf(rr, gg, bb) {
  const Y = 0.2126 * srgbLin(rr) + 0.7152 * srgbLin(gg) + 0.0722 * srgbLin(bb);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - C / 2;
  let r, g, b;
  if (h < 60) { r = C; g = X; b = 0; } else if (h < 120) { r = X; g = C; b = 0; }
  else if (h < 180) { r = 0; g = C; b = X; } else if (h < 240) { r = 0; g = X; b = C; }
  else if (h < 300) { r = X; g = 0; b = C; } else { r = C; g = 0; b = X; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(rgb) {
  return '#' + ((1 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).toString(16).slice(1);
}

// Band color: base shifted by dL in CIE L*, warm-hued when brightening
// (sunlight, not whitewash), hue-neutral when darkening. Cached.
const bandCache = new Map();
function bandColor(hex, dL) {
  if (!dL) return hex;
  const ck = hex + '|' + dL;
  let c = bandCache.get(ck);
  if (c) return c;
  const [r0, g0, b0] = hexRgb(hex);
  const Lb = lstarOf(r0, g0, b0);
  const Lt = Math.max(6, Math.min(92, Lb + dL));
  const deficit = Math.abs((Lb + dL) - Lt);
  let [h, s, l] = rgbToHsl(r0, g0, b0);
  if (dL > 0) {
    const hueShift = 0.22 + Math.min(0.3, (deficit / Math.max(1, dL)) * 0.3);
    h = h - (h - 60) * hueShift * 0.35; // toward sunny yellow
  }
  let lo = 0.02, hi = 0.98;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const rgb = hslToRgb(h, s, mid);
    if (lstarOf(rgb[0], rgb[1], rgb[2]) < Lt) lo = mid; else hi = mid;
  }
  c = rgbHex(hslToRgb(h, s, (lo + hi) / 2));
  bandCache.set(ck, c);
  return c;
}

// Multiplicative darken (debris rind tints, ink)
function shadeHex(hex, k) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex([Math.round(r * k), Math.round(g * k), Math.round(b * k)]);
}

// The active band list, darkest -> brightest, derived from P.
function bands() {
  const out = [];
  if (P.shadowBand) out.push({ tau: P.shadowTau, dL: 0, baseDL: P.shadowDL });
  out.push({ tau: P.litTau, dL: P.litDL });
  if (P.band2) out.push({ tau: Math.max(P.band2Tau, P.litTau + 0.02), dL: P.band2DL });
  return out;
}

// ---- Geometry: exact spheroid Lambert solvers ----
// Light in the body frame for a body at `angle`.
function bodyLight(angle) {
  const s = sun();
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let Lx = s.x * ca + s.y * sa;
  let Ly = -s.x * sa + s.y * ca;
  let Lz = s.lz;
  const n = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
  return { Lx: Lx / n, Ly: Ly / n, Lz: Lz / n, ca, sa };
}

// Iso-contour of diffuse == tau on the (a,b,b) spheroid (shading axes
// exaggerated by shadeEcc), projected to the WORLD frame around the
// body's center. Returns null when the whole face is below tau, and
// {full:true} when the whole face is above (fill everything).
function isoContour(angle, a, b, tau, spokes) {
  const { Lx, Ly, Lz, ca, sa } = bodyLight(angle);
  const aS = a * P.shadeEcc;
  const diffuse = (ux, uy, uz) => {
    const nx = ux / aS, ny = uy / b, nz = uz / b;
    return (nx * Lx + ny * Ly + nz * Lz) / Math.sqrt(nx * nx + ny * ny + nz * nz);
  };
  let ux = aS * Lx, uy = b * Ly, uz = b * Lz;
  const un = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= un; uy /= un; uz /= un;
  const peak = diffuse(ux, uy, uz);
  if (peak <= tau) return null;
  // Whole-face check: the darkest visible point is roughly the
  // antipode of the pole clamped to the rim; sample the rim opposite.
  let rx = 0, ry = 0, rz = 1;
  if (Math.abs(uz) > 0.9) { rx = 1; rz = 0; }
  let e1x = uy * rz - uz * ry, e1y = uz * rx - ux * rz, e1z = ux * ry - uy * rx;
  const e1n = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
  e1x /= e1n; e1y /= e1n; e1z /= e1n;
  const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x;
  const N = spokes || 32;
  const pts = [];
  let anyBoundary = false;
  for (let i = 0; i < N; i++) {
    const phi = (i / N) * Math.PI * 2;
    const dx = Math.cos(phi), dy = Math.sin(phi);
    const tx = dx * e1x + dy * e2x, ty = dx * e1y + dy * e2y, tz = dx * e1z + dy * e2z;
    let lo = 0, hi = Math.PI;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const c = Math.cos(mid), s2 = Math.sin(mid);
      if (diffuse(c * ux + s2 * tx, c * uy + s2 * ty, c * uz + s2 * tz) > tau) lo = mid;
      else hi = mid;
    }
    if (hi < Math.PI - 1e-3) anyBoundary = true;
    const psi = (lo + hi) / 2;
    const c = Math.cos(psi), s2 = Math.sin(psi);
    let px = a * (c * ux + s2 * tx), py = b * (c * uy + s2 * ty);
    const pz = b * (c * uz + s2 * tz);
    if (pz < 0) {
      const rr = Math.sqrt((px / a) * (px / a) + (py / b) * (py / b));
      if (rr > 1e-9) { px /= rr; py /= rr; }
    }
    pts.push([px * ca - py * sa, px * sa + py * ca]);
  }
  if (!anyBoundary) return { full: true };
  return { pts };
}

// Brightest point projected to the world frame (specular anchor) plus
// its alignment quality (peak diffuse).
function specPoint(angle, a, b) {
  const { Lx, Ly, Lz, ca, sa } = bodyLight(angle);
  const aS = a * P.shadeEcc;
  let ux = aS * Lx, uy = b * Ly, uz = b * Lz;
  const un = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= un; uy /= un; uz /= un;
  const nx = ux / aS, ny = uy / b, nz = uz / b;
  const peak = (nx * Lx + ny * Ly + nz * Lz) / Math.sqrt(nx * nx + ny * ny + nz * nz);
  const px = a * ux, py = b * uy;
  return { x: px * ca - py * sa, y: px * sa + py * ca, z: b * uz, peak };
}

// Rim arcs: perimeter angles (ellipse parameter t) where the outward
// 2D normal faces AWAY from the sun beyond the cutoff. Returns [t0,t1]
// (t1 > t0, radians) or null.
function rimArc(angle, a, b) {
  const s = sun();
  // Away-from-sun direction in the body frame:
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const dx = -(s.x * ca + s.y * sa), dy = -(-s.x * sa + s.y * ca);
  // Normal at parameter t is (cos t / a, sin t / b) normalized; find
  // the t of maximum alignment and wrap by cutoff.
  const tPeak = Math.atan2(dy * b, dx * a);
  const halfSpan = P.rimCutoff * Math.PI;
  return { tPeak, halfSpan, ca, sa };
}

window.FF = window.FF || {};
// ---- Cast-shadow projection solver ----
// The TRUE footprint: the rotated ellipse's two silhouette extremes
// (tangent parallel to the sun ray — rotation-dependent, so a
// tumbling body's shadow wobbles in width), each ray-marched along
// the sun onto the terrain via the caller-supplied ground function.
// Returns the footprint interval + local slope, or null.
function castFootprint(cx, cy, angle, a, b, groundYAt) {
  const s2 = sun();
  // Ray direction: FROM the sun, through the body, toward the ground.
  let dx = -s2.x, dy = -s2.y;
  if (dy < 0.2) { dy = 0.2; } // keep rays descending enough to land
  const dn = Math.sqrt(dx * dx + dy * dy);
  dx /= dn; dy /= dn;
  // Silhouette extremes: body-frame direction of the ray, then the
  // tangency points of the ellipse for that direction (support form).
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const bx = dx * ca + dy * sa, by = -dx * sa + dy * ca;
  // Tangent parallel to (bx,by): extreme offset = perpendicular support.
  const px = -by, py = bx; // perpendicular in body frame
  const denom = Math.sqrt(a * a * px * px + b * b * py * py) || 1;
  const ox = (a * a * px) / denom, oy = (b * b * py) / denom;
  // World-frame extreme points:
  const e1x = cx + (ox * ca - oy * sa), e1y = cy + (ox * sa + oy * ca);
  const e2x = cx - (ox * ca - oy * sa), e2y = cy - (ox * sa + oy * ca);
  // Ray-march each to the terrain (secant-ish stepping).
  const land = (x0, y0) => {
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const gx = x0 + dx * t, gy = y0 + dy * t;
      const g = groundYAt(gx);
      if (g === null) return null;
      const gap = g - gy;
      if (Math.abs(gap) < 1.5) return { x: gx, y: g };
      t += gap / dy * 0.9;
      if (t < -400 || t > 4000) return null;
    }
    const gx = x0 + dx * t;
    const g = groundYAt(gx);
    return g === null ? null : { x: gx, y: g };
  };
  const h1 = land(e1x, e1y), h2 = land(e2x, e2y);
  if (!h1 || !h2) return null;
  const mx = (h1.x + h2.x) / 2;
  const gy0 = groundYAt(mx - 6), gy1 = groundYAt(mx + 6);
  const slope = (gy0 === null || gy1 === null) ? 0 : Math.atan2(gy1 - gy0, 12);
  const half = Math.sqrt((h2.x - h1.x) * (h2.x - h1.x) + (h2.y - h1.y) * (h2.y - h1.y)) / 2;
  return { x: mx, y: (h1.y + h2.y) / 2, half, slope };
}

window.FF.shading = {
  castFootprint,
  P, SCHEMA, sun, bands, bandColor, shadeHex, hslToRgb, lstarOf,
  bodyLight, isoContour, specPoint, rimArc,
};

})();