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
  // Sun as SPHERICAL ANGLES — the same 3D direction as before, in
  // coordinates a person can picture. Bearing is where the light comes
  // from around the clock (screen plane); elevation lifts it out of
  // the screen toward the viewer: 0deg = grazing/rim-lit, 90deg = flat
  // frontal light. Converted to a unit vector internally.
  sunBearingDeg: 260,    // was sunAngleDeg: upper-left in a y-down world
  sunElevationDeg: 45,   // spherical: 0 = grazing/rim-lit, 90 = flat frontal
  shadeEcc: 1.0,         // shading-normal eccentricity boost (1 = honest)
  // ---- Four uniform bands ----
  // Every band has the SAME three controls: on/off, threshold, and
  // lightness delta. They stack darkest -> brightest over the base
  // fill; thresholds are clamped into ascending order at read time so
  // a band can never paint over a brighter one. Band 1 defaults on
  // (it is the classic single lit cap); the rest default off.
  // Softness: 0 = hard cel edge (a step at the threshold), 100 = fully
  // diffuse (a smooth Lambert ramp). Implemented as nested iso-contours
  // across the transition with graduated alpha — the same solver, just
  // asked for several thresholds instead of one. Per band, so band 1
  // can stay razor-hard while band 3 blooms.
  // ---- The colour palette: one LAW, two ANCHORS ----
  // The Lo/Hi curve is the LIGHTING LAW: how any material's colour
  // responds to shadow and highlight. It is GLOBAL — no species may
  // bring its own curve — which is what makes every playable shade
  // identically under the one sun (the aesthetic analogue of
  // airTorqueScale = 1.0). Each body has two material anchors: its
  // seeded base colour, and a PATTERN anchor derived from it by a
  // three-channel offset (what the pigment IS, relative to the body).
  // Ramp A = law(base); ramp B = law(patternAnchor). The offset below
  // is the DEFAULT (the watermelon stripe); a species whose pattern is
  // a genuinely different material overrides it with ONE offset triple
  // (FRUITS[x].patternOffset) — never a curve. Regions name a SLOT
  // ('A2'), never a hex, so every melon's palette stays its own while
  // the assignment holds across the cast.
  rampLoDL: -30, rampLoDH: -30, rampLoDS: -10, // law: shadow end
  rampHiDL: 30,  rampHiDH: -20, rampHiDS: -40, // law: highlight end
  rampBDL: -15,  rampBDH: 25,  rampBDS: 0,     // DEFAULT pattern-anchor offset

  // ---- Three roles: SHADOW, BASE, HIGHLIGHT ----
  // The melon has exactly three lighting regions, and the palette has
  // exactly three slots per ramp — so A1/A2/A3 are the shadow/base/
  // highlight fills and B1/B2/B3 their pattern colours. Base is the
  // body fill (no threshold); shadow owns everywhere DARKER than its
  // threshold, highlight everywhere brighter. There is no second
  // colour system: slots decide every colour, always.
  shadowOn: true,   shadowTau: 0.20, shadowSoft: 0,
  highlightOn: true, highlightTau: 0.98, highlightSoft: 0,
  // Slot assignments (a slot name like 'A2', never a hex).
  baseFillSlot: 'A2',      basePatSlot: 'B2',
  shadowFillSlot: 'A1',    shadowPatSlot: 'B1',
  highlightFillSlot: 'A3', highlightPatSlot: 'B3',
  // ---- Rim: a fourth REGION, with its own fill and pattern slots ----
  // Masked by the shadow so the form's own darkness eats it: visible
  // over base and highlight, gone where the shadow begins.
  rim: false,
  rimWidth: 3.5,         // world px
  rimCutoff: 1,          // how far it wraps (0..1; 1 = the full silhouette)
  rimOffsetDeg: 0,       // slide it off the anti-sun point
  rimMask: 'shadow',     // 'none' | 'shadow' | 'highlight'
  rimFillSlot: 'A3', rimPatSlot: 'B3',

  // Pattern visibility now comes from the COLOUR DISTANCE between a
  // region's fill slot and its pattern slot — as in real cel painting
  // — so there is no global alpha to accidentally zero. Each mask
  // carries its own internal subtlety (net mottle ~0.3 coverage,
  // crackle streaks ~0.16, veins ~0.56), so full opacity still reads
  // as delicate.
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
  // panel: 'left' = colour generation, 'right' = assignment & lighting.
  // Symmetric ranges, and each channel is ONE bar with two handles:
  // A start and A end on the same scale, so the span is visible rather
  // than inferred. The handles may cross — an inverted ramp (lighter
  // shadow than highlight) is a legitimate look, not an error.
  { panel: 'left', group: 'Palette', label: 'dL*  shadow / highlight', type: 'dual',
    lo: 'rampLoDL', hi: 'rampHiDL', min: -50, max: 50, step: 1 },
  { panel: 'left', group: 'Palette', label: 'dHue shadow / highlight', type: 'dual',
    lo: 'rampLoDH', hi: 'rampHiDH', min: -180, max: 180, step: 1 },
  { panel: 'left', group: 'Palette', label: 'dSat shadow / highlight', type: 'dual',
    lo: 'rampLoDS', hi: 'rampHiDS', min: -100, max: 100, step: 1 },
  // (The pattern-anchor offset is edited in the palette grid's B cell,
  // where it targets the STAGED SPECIES' effective offset — a slider
  // here would edit only the default and silently miss any species
  // override, which is exactly the tool/render disagreement this
  // refactor removed.)
  { panel: 'left', group: 'Palette', key: '__assign', label: 'click assigns to', type: 'assign' },
  { panel: 'left', group: 'Palette', key: '__palette', label: '', type: 'palette' },

  { panel: 'right', group: 'Sun', key: 'sunBearingDeg', label: 'sun bearing', type: 'range', min: 0, max: 360, step: 1 },
  { panel: 'right', group: 'Sun', key: 'sunElevationDeg', label: 'sun elevation', type: 'range', min: 0, max: 90, step: 1 },
  { panel: 'right', group: 'Sun', key: 'shadeEcc', label: 'shading ecc', type: 'range', min: 1, max: 3, step: 0.05 },

  { panel: 'right', group: 'Base', key: 'baseFillSlot', label: 'fill', type: 'slot' },
  { panel: 'right', group: 'Base', key: 'basePatSlot', label: 'pattern', type: 'slot' },

  { panel: 'right', group: 'Shadow', key: 'shadowOn', label: 'enabled', type: 'bool' },
  { panel: 'right', group: 'Shadow', key: 'shadowTau', label: 'threshold', type: 'range', min: 0.02, max: 0.9, step: 0.01 },
  { panel: 'right', group: 'Shadow', key: 'shadowSoft', label: 'softness', type: 'range', min: 0, max: 100, step: 1 },
  { panel: 'right', group: 'Shadow', key: 'shadowFillSlot', label: 'fill', type: 'slot' },
  { panel: 'right', group: 'Shadow', key: 'shadowPatSlot', label: 'pattern', type: 'slot' },

  { panel: 'right', group: 'Highlight', key: 'highlightOn', label: 'enabled', type: 'bool' },
  { panel: 'right', group: 'Highlight', key: 'highlightTau', label: 'threshold', type: 'range', min: 0.1, max: 0.98, step: 0.01 },
  { panel: 'right', group: 'Highlight', key: 'highlightSoft', label: 'softness', type: 'range', min: 0, max: 100, step: 1 },
  { panel: 'right', group: 'Highlight', key: 'highlightFillSlot', label: 'fill', type: 'slot' },
  { panel: 'right', group: 'Highlight', key: 'highlightPatSlot', label: 'pattern', type: 'slot' },

  { panel: 'right', group: 'Rim', key: 'rim', label: 'rim light', type: 'bool' },
  { panel: 'right', group: 'Rim', key: 'rimWidth', label: 'width', type: 'range', min: 1, max: 9, step: 0.5 },
  { panel: 'right', group: 'Rim', key: 'rimCutoff', label: 'wrap', type: 'range', min: 0.05, max: 1, step: 0.01 },
  { panel: 'right', group: 'Rim', key: 'rimOffsetDeg', label: 'rotate', type: 'range', min: -180, max: 180, step: 1 },
  { panel: 'right', group: 'Rim', key: 'rimFillSlot', label: 'fill', type: 'slot' },
  { panel: 'right', group: 'Rim', key: 'rimPatSlot', label: 'pattern', type: 'slot' },
  { panel: 'right', group: 'Rim', key: 'rimMask', label: 'mask', type: 'select', options: ['none', 'shadow', 'highlight'] },

  { panel: 'right', group: 'Shadows', key: 'contactShadow', label: 'contact shadow', type: 'bool' },
  { panel: 'right', group: 'Shadows', key: 'contactFrac', label: 'contact height', type: 'range', min: 0.08, max: 0.5, step: 0.01 },
  { panel: 'right', group: 'Shadows', key: 'contactAlpha', label: 'contact alpha', type: 'range', min: 0.05, max: 0.5, step: 0.01 },
  { panel: 'right', group: 'Shadows', key: 'contactMaxM', label: 'contact range m', type: 'range', min: 0.1, max: 2, step: 0.05 },
  { panel: 'right', group: 'Shadows', key: 'castShadow', label: 'cast shadow', type: 'bool' },
  { panel: 'right', group: 'Shadows', key: 'castAlpha', label: 'cast alpha', type: 'range', min: 0.05, max: 0.5, step: 0.01 },
  { panel: 'right', group: 'Shadows', key: 'castStretch', label: 'cast stretch', type: 'range', min: 0.6, max: 2.5, step: 0.05 },
  { panel: 'right', group: 'Shadows', key: 'castFlat', label: 'cast thickness', type: 'range', min: 0.1, max: 0.7, step: 0.01 },
  { panel: 'right', group: 'Shadows', key: 'castSoft', label: 'cast penumbra', type: 'bool' },
  { panel: 'right', group: 'Shadows', key: 'castMaxM', label: 'cast range m', type: 'range', min: 1, max: 8, step: 0.25 },

  { panel: 'right', group: 'Pattern', key: 'showPattern', label: 'rind pattern', type: 'bool' },

  { panel: 'right', group: 'Ink', key: 'inkMode', label: 'ink', type: 'select', options: ['none', 'silhouette', 'weighted'] },
  { panel: 'right', group: 'Ink', key: 'inkWidth', label: 'ink width', type: 'range', min: 0.5, max: 6, step: 0.25 },
  { panel: 'right', group: 'Ink', key: 'inkDarkK', label: 'ink darkness', type: 'range', min: 0.2, max: 0.85, step: 0.01 },

  { panel: 'right', group: 'Motion', key: 'smear', label: 'speed smear', type: 'bool' },
  { panel: 'right', group: 'Motion', key: 'smearThresh', label: 'smear at px/s', type: 'range', min: 600, max: 2600, step: 50 },
  { panel: 'right', group: 'Motion', key: 'smearAmount', label: 'smear amount', type: 'range', min: 0.05, max: 0.4, step: 0.01 },
  { panel: 'right', group: 'Motion', key: 'speedLines', label: 'speed lines', type: 'bool' },
  { panel: 'right', group: 'Motion', key: 'speedThresh', label: 'lines at px/s', type: 'range', min: 800, max: 3000, step: 50 },
  { panel: 'right', group: 'Motion', key: 'impactStar', label: 'impact star', type: 'bool' },
  { panel: 'right', group: 'Motion', key: 'impactSize', label: 'star size', type: 'range', min: 0.8, max: 3, step: 0.1 },
];

// ---- Derived sun (recomputed on read; cheap) ----
function sun() {
  // Spherical -> unit vector. The screen-plane component shrinks by
  // cos(elevation) as the light lifts toward the viewer, so the total
  // direction stays normalized without any extra bookkeeping.
  const a = P.sunBearingDeg * Math.PI / 180;
  const e = P.sunElevationDeg * Math.PI / 180;
  const ce = Math.cos(e);
  return { x: Math.cos(a) * ce, y: Math.sin(a) * ce, lz: Math.sin(e), angle: a };
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

// Offset a colour by (dL* , dHue, dSat-points), solving lightness in
// CIE L* so steps stay perceptually even across hues. Cached.
const offsetCache = new Map();
function offsetColor(hex, dL, dH, dS) {
  const ck = hex + '|' + dL.toFixed(1) + '|' + dH.toFixed(1) + '|' + dS.toFixed(1);
  let c = offsetCache.get(ck);
  if (c) return c;
  const [r0, g0, b0] = hexRgb(hex);
  const Lb = lstarOf(r0, g0, b0);
  let [h, sat] = rgbToHsl(r0, g0, b0);
  h = ((h + dH) % 360 + 360) % 360;
  sat = Math.max(0, Math.min(1, sat + dS / 100));
  const Lt = Math.max(4, Math.min(96, Lb + dL));
  let lo = 0.02, hi = 0.98;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const rgb = hslToRgb(h, sat, mid);
    if (lstarOf(rgb[0], rgb[1], rgb[2]) < Lt) lo = mid; else hi = mid;
  }
  c = rgbHex(hslToRgb(h, sat, (lo + hi) / 2));
  if (offsetCache.size > 2000) offsetCache.clear();
  offsetCache.set(ck, c);
  return c;
}

// Build this melon's full palette: both ramps, every slot, keyed by
// 'A1'..'An' / 'B1'..'Bn'. Cached per (base colour + law + offset) so
// a race of twelve melons solves twelve palettes, not twelve per frame.
//
// `patOff` is a species' PATTERN-ANCHOR offset (FRUITS[x].patternOffset)
// — the one per-species colour fact: what the pattern pigment is,
// relative to the body (a red star is not a lighting response of
// orange). Falsy = the default offset in P (the watermelon stripe).
// The LIGHTING LAW (the Lo/Hi curve) is global and is applied to both
// anchors identically: A = law(base), B = law(base + patOff). No
// species may bring its own curve — the pattern anchor shades under
// the same sun as the body it sits on.
const paletteCache = new Map();
function palette(hex, patOff) {
  const n = 3; // three roles, three slots: shadow / base / highlight
  const o = patOff || { dL: P.rampBDL, dH: P.rampBDH, dS: P.rampBDS };
  const ck = [hex, P.rampLoDL, P.rampLoDH, P.rampLoDS,
    P.rampHiDL, P.rampHiDH, P.rampHiDS, o.dL, o.dH, o.dS].join(',');
  let pal = paletteCache.get(ck);
  if (pal) return pal;
  const anchor = offsetColor(hex, o.dL, o.dH, o.dS); // the second material
  pal = { slots: [], n };
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const dL = P.rampLoDL + (P.rampHiDL - P.rampLoDL) * t;
    const dH = P.rampLoDH + (P.rampHiDH - P.rampLoDH) * t;
    const dS = P.rampLoDS + (P.rampHiDS - P.rampLoDS) * t;
    pal['A' + (i + 1)] = offsetColor(hex, dL, dH, dS);
    pal['B' + (i + 1)] = offsetColor(anchor, dL, dH, dS);
    pal.slots.push('A' + (i + 1));
  }
  for (let i = 0; i < n; i++) pal.slots.push('B' + (i + 1));
  if (paletteCache.size > 200) paletteCache.clear();
  paletteCache.set(ck, pal);
  return pal;
}

// Resolve a slot name against a melon's palette, clamping gracefully
// when the step count shrinks below a stored assignment.
function slotColor(hex, slot, patOff) {
  const pal = palette(hex, patOff);
  if (pal[slot]) return pal[slot];
  const letter = (slot && slot[0] === 'B') ? 'B' : 'A';
  const idx = Math.max(1, Math.min(pal.n, parseInt((slot || 'A1').slice(1), 10) || 1));
  return pal[letter + idx];
}

// Multiplicative darken (debris rind tints, ink)// Multiplicative darken (debris rind tints, ink)
function shadeHex(hex, k) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex([Math.round(r * k), Math.round(g * k), Math.round(b * k)]);
}

// The active band list, darkest -> brightest, derived from P.
function bands() {
  // Shadow first (it owns the dark complement and sits beneath), then
  // highlight. Base isn't a band — it's the body fill.
  const out = [];
  if (P.shadowOn) {
    out.push({ key: 'shadow', tau: P.shadowTau, soft: P.shadowSoft, inv: true,
      fillSlot: P.shadowFillSlot, patSlot: P.shadowPatSlot });
  }
  if (P.highlightOn) {
    out.push({ key: 'highlight', tau: P.highlightTau, soft: P.highlightSoft, inv: false,
      fillSlot: P.highlightFillSlot, patSlot: P.highlightPatSlot });
  }
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

// Iso-contour of diffuse == tau, projected to the WORLD frame around
// the body's center. The surface is the (aS, b, b) spheroid — or, when
// `taper` is nonzero, the TAPERED surface of revolution matching the
// renderer's egg profile: { (aX, b·g(X)·Y, b·g(X)·Z) : X²+Y²+Z²=1 }
// with g(X) = 1 − taper·X. Its implicit form X² + (y²+z²)/(b·g)² = 1
// gives the normal in closed form, so the light genuinely follows the
// egg's asymmetry: the highlight drifts toward the fat end, the core
// shadow wraps the pointy end tighter. taper = 0 reduces EXACTLY to
// the spheroid math (refinement and clamp iterations are gated), so
// every melon is bit-identical to the pre-taper rig by construction.
// Returns null when the whole face is below tau, and {full:true} when
// the whole face is above (fill everything).
function isoContour(angle, a, b, tau, spokes, taper) {
  const T = taper || 0;
  const { Lx, Ly, Lz, ca, sa } = bodyLight(angle);
  const aS = a * P.shadeEcc;
  const diffuse = (ux, uy, uz) => {
    let nx, ny, nz;
    if (T) {
      // ∇F of the tapered implicit at the parameter point: the axial
      // component gains a taper term, the radial ones divide by g.
      const g = 1 - T * ux;
      nx = (ux + T * (1 - ux * ux) / g) / aS;
      ny = uy / (b * g);
      nz = uz / (b * g);
    } else {
      nx = ux / aS; ny = uy / b; nz = uz / b;
    }
    return (nx * Lx + ny * Ly + nz * Lz) / Math.sqrt(nx * nx + ny * ny + nz * nz);
  };
  let ux = aS * Lx, uy = b * Ly, uz = b * Lz;
  const un = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= un; uy /= un; uz /= un;
  if (T) {
    // The spheroid pole is only a SEED on the egg: fixed projected-
    // gradient ascent (numeric tangent gradient) walks it to the true
    // brightest point. Presentation tier — Math.* and iteration are free.
    let step = 0.22;
    for (let it = 0; it < 10; it++) {
      const e = 1e-4;
      // Tangent basis at u.
      let rx0 = 0, ry0 = 0, rz0 = 1;
      if (Math.abs(uz) > 0.9) { rx0 = 1; rz0 = 0; }
      let t1x = uy * rz0 - uz * ry0, t1y = uz * rx0 - ux * rz0, t1z = ux * ry0 - uy * rx0;
      const t1n = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
      t1x /= t1n; t1y /= t1n; t1z /= t1n;
      const t2x = uy * t1z - uz * t1y, t2y = uz * t1x - ux * t1z, t2z = ux * t1y - uy * t1x;
      const d0 = diffuse(ux, uy, uz);
      const g1 = (diffuse(ux + e * t1x, uy + e * t1y, uz + e * t1z) - d0) / e;
      const g2 = (diffuse(ux + e * t2x, uy + e * t2y, uz + e * t2z) - d0) / e;
      let vx = ux + step * (g1 * t1x + g2 * t2x);
      let vy = uy + step * (g1 * t1y + g2 * t2y);
      let vz = uz + step * (g1 * t1z + g2 * t2z);
      const vn = Math.sqrt(vx * vx + vy * vy + vz * vz);
      vx /= vn; vy /= vn; vz /= vn;
      if (diffuse(vx, vy, vz) >= d0) { ux = vx; uy = vy; uz = vz; }
      else step *= 0.5;
    }
  }
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
    // Parameter point on the unit sphere -> point on the surface.
    const Xp = c * ux + s2 * tx;
    const G = T ? 1 - T * Xp : 1;
    let px = a * Xp, py = b * G * (c * uy + s2 * ty);
    const pz = b * G * (c * uz + s2 * tz);
    if (pz < 0) {
      if (T) {
        // Clamp to the TAPERED silhouette: scale s so the point lands
        // on X² + (y/(b·g(X)))² = 1. Fixed-point from the ellipse
        // estimate; g varies slowly, three passes converge fully.
        let s = 1;
        const rr0 = Math.sqrt((px / a) * (px / a) + (py / (b * G)) * (py / (b * G)));
        if (rr0 > 1e-9) s = 1 / rr0;
        for (let it = 0; it < 3; it++) {
          const X2 = s * px / a;
          const g2 = 1 - T * X2;
          const f = X2 * X2 + (s * py / (b * g2)) * (s * py / (b * g2));
          if (f > 1e-9) s /= Math.sqrt(f);
        }
        px *= s; py *= s;
      } else {
        const rr = Math.sqrt((px / a) * (px / a) + (py / b) * (py / b));
        if (rr > 1e-9) { px /= rr; py /= rr; }
      }
    }
    pts.push([px * ca - py * sa, px * sa + py * ca]);
  }
  if (!anyBoundary) return { full: true };
  return { pts };
}


// Rim arcs: perimeter angles (ellipse parameter t) where the outward
// 2D normal faces AWAY from the sun beyond the cutoff. Returns [t0,t1]
// (t1 > t0, radians) or null. With `taper`, the peak is the parameter
// whose unit outward normal on the tapered profile points along the
// anti-sun direction — the Gauss-map inverse, found by bisection on
// the cross product around the ellipse seed (the tapered normal is
// N(t) ∝ (b·(cos t·g + τ·sin²t), a·sin t), which reduces to the
// ellipse's (b·cos t, a·sin t) at τ = 0, so the closed form below IS
// the τ = 0 answer and melons never enter the search).
function rimArc(angle, a, b, taper) {
  const s = sun();
  // Away-from-sun direction in the body frame:
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const dx = -(s.x * ca + s.y * sa), dy = -(-s.x * sa + s.y * ca);
  // Normal at parameter t is (cos t / a, sin t / b) normalized; find
  // the t of maximum alignment and wrap by cutoff.
  let tPeak = Math.atan2(dy * b, dx * a);
  const T = taper || 0;
  if (T) {
    const h = (t) => {
      const c = Math.cos(t), s2 = Math.sin(t);
      const g = 1 - T * c;
      return (b * (c * g + T * s2 * s2)) * dy - (a * s2) * dx; // N × d
    };
    let lo = tPeak - 0.9, hi = tPeak + 0.9;
    if (h(lo) * h(hi) > 0) { lo = tPeak - 1.6; hi = tPeak + 1.6; }
    if (h(lo) * h(hi) <= 0) {
      for (let k = 0; k < 22; k++) {
        const mid = (lo + hi) / 2;
        if (h(lo) * h(mid) <= 0) hi = mid; else lo = mid;
      }
      tPeak = (lo + hi) / 2;
    } // else: pathological direction — keep the ellipse seed
  }
  tPeak += P.rimOffsetDeg * Math.PI / 180;
  const halfSpan = P.rimCutoff * Math.PI;
  return { tPeak, halfSpan, ca, sa };
}

window.FF = window.FF || {};
// ---- Cast-shadow projection solver ----
// The TRUE footprint: the rotated body's two silhouette extremes
// (tangent parallel to the sun ray — rotation-dependent, so a
// tumbling body's shadow wobbles in width), each ray-marched along
// the sun onto the terrain via the caller-supplied ground function.
// Returns the footprint interval + local slope, or null.
function castFootprint(cx, cy, angle, a, b, groundYAt, taper) {
  const s2 = sun();
  // Ray direction: FROM the sun, through the body, toward the ground.
  let dx = -s2.x, dy = -s2.y;
  if (dy < 0.2) { dy = 0.2; } // keep rays descending enough to land
  const dn = Math.sqrt(dx * dx + dy * dy);
  dx /= dn; dy /= dn;
  // Silhouette extremes: body-frame direction of the ray, then the
  // tangency points for that direction (support form).
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const bx = dx * ca + dy * sa, by = -dx * sa + dy * ca;
  // Tangent parallel to (bx,by): extreme offset = perpendicular support.
  const px = -by, py = bx; // perpendicular in body frame
  const T = taper || 0;
  let o1x, o1y, o2x, o2y;
  if (!T) {
    // Ellipse: closed-form support, symmetric (r(-d) = r(d)).
    const denom = Math.sqrt(a * a * px * px + b * b * py * py) || 1;
    o1x = (a * a * px) / denom; o1y = (b * b * py) / denom;
    o2x = -o1x; o2y = -o1y;
  } else {
    // Egg: support of p(t) = (a·cos t, b·sin t·g(cos t)) is NOT
    // symmetric — the fat end reaches further. Coarse scan + fixed
    // golden refinement, one per extreme. Presentation tier.
    const support = (qx, qy) => {
      const f = (t) => {
        const c = Math.cos(t), s3 = Math.sin(t);
        return qx * a * c + qy * b * s3 * (1 - T * c);
      };
      let bestT = 0, bestV = -Infinity;
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        const v = f(t);
        if (v > bestV) { bestV = v; bestT = t; }
      }
      let lo = bestT - Math.PI / 32, hi = bestT + Math.PI / 32;
      for (let k = 0; k < 14; k++) {
        const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
        if (f(m1) < f(m2)) lo = m1; else hi = m2;
      }
      const t = (lo + hi) / 2, c = Math.cos(t), s3 = Math.sin(t);
      return [a * c, b * s3 * (1 - T * c)];
    };
    [o1x, o1y] = support(px, py);
    [o2x, o2y] = support(-px, -py);
  }
  // World-frame extreme points:
  const e1x = cx + (o1x * ca - o1y * sa), e1y = cy + (o1x * sa + o1y * ca);
  const e2x = cx + (o2x * ca - o2y * sa), e2y = cy + (o2x * sa + o2y * ca);
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

// Resolve P.rimMask into { tau, inside } or null.
//   inside:true  -> rim shows only INSIDE that contour (lit bands)
//   inside:false -> rim shows only OUTSIDE it (core shadow's dark region)
// Falls back to null when the chosen band is disabled, so a mask can
// never silently reference a region that isn't being drawn.
function rimMaskRegion() {
  const m = P.rimMask;
  if (m === 'shadow' && P.shadowOn) return { tau: P.shadowTau, inside: true };
  if (m === 'highlight' && P.highlightOn) return { tau: P.highlightTau, inside: false };
  return null;
}

// The shipped colour defaults, kept as data so the studio's reset
// button and the boot values can never disagree.
const PALETTE_DEFAULTS = {
  rampLoDL: -30, rampLoDH: -30, rampLoDS: -10,
  rampHiDL: 30,  rampHiDH: -20, rampHiDS: -40,
  rampBDL: -15,  rampBDH: 25,  rampBDS: 0,
};
function resetPalette() {
  for (const k in PALETTE_DEFAULTS) P[k] = PALETTE_DEFAULTS[k];
}

window.FF.shading = {
  PALETTE_DEFAULTS, resetPalette,
  rimMaskRegion, palette, slotColor, offsetColor,
  castFootprint,
  P, SCHEMA, sun, bands, bandColor, shadeHex, hslToRgb, lstarOf,
  bodyLight, isoContour, rimArc,
};

})();