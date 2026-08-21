// ============================================================
// OKLAB / OKLCH — the authoring and generation colour space.
//
// WHY A THIRD COLOUR SPACE, AND WHY IT IS NOT A THIRD COLOUR SYSTEM.
//
// The shading law speaks HSL and the world is painted in hex. Nothing
// about that changes: this module is a DRAWING BOARD. A sky ramp (and
// a ground kit) is designed here, converted ONCE to hex, and from
// that point every downstream consumer — the palette registry,
// lit(), the rows the renderer blits — sees exactly what it saw
// before. There is no second system to keep in sync; there is a
// better place to make decisions before they become hex.
//
// THE REASON IS GENERATION, NOT AESTHETICS. In HSL the same three
// numbers mean different things at different hues: saturation 100 /
// lightness 50 is a usable deep blue and an unusable highlighter
// yellow-green. So "roll a colour with saturation between 60 and 90"
// is safe at some hues and lurid at others, and a seeded generator
// built on it needs a table of per-hue exceptions — which is the
// "crazy colour" problem arriving by the back door.
//
// OKLCh is built so that does not happen. L is perceived lightness
// (0.7 looks equally light at blue and at yellow), C is chroma with
// the same meaning at every hue, h is the hue angle. "Not crazy"
// becomes a bounded range instead of a table, which is the whole
// reason the generator can be trusted.
//
// It also delivers what an N-step palette promises. Evenly spaced
// steps in HSL do not LOOK evenly spaced — lightness compresses near
// white, so the last entries of a ramp into white crowd together. In
// OKLCh even steps look even.
//
// Reference: Björn Ottosson's OKLab (2020). The matrices below are
// his, verified in the suite against known conversions.
//
// Node-safe: the suites and the bench load this directly.
// ============================================================
(function () {
'use strict';

const G = (typeof window !== 'undefined' ? window : global);
G.FF = G.FF || {};

// ---- sRGB transfer ---------------------------------------------------
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---- linear sRGB <-> OKLab -------------------------------------------
function linearToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}
function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  return {
    r: 4.0767416621 * l_ * l_ * l_ - 3.3077115913 * m_ * m_ * m_ + 0.2309699292 * s_ * s_ * s_,
    g: -1.2684380046 * l_ * l_ * l_ + 2.6097574011 * m_ * m_ * m_ - 0.3413193965 * s_ * s_ * s_,
    b: -0.0041960863 * l_ * l_ * l_ - 0.7034186147 * m_ * m_ * m_ + 1.7076147010 * s_ * s_ * s_,
  };
}

// ---- hex <-> OKLCh ---------------------------------------------------
const DEG = 180 / Math.PI;
function hexToOklch(hex) {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const lab = linearToOklab(r, g, b);
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = Math.atan2(lab.b, lab.a) * DEG;
  if (h < 0) h += 360;
  return { L: lab.L, C, h };
}

const inGamut = (v) => v >= -1e-6 && v <= 1 + 1e-6;

// ---- GAMUT CLIPPING --------------------------------------------------
// Some (L, C, h) triples do not exist in sRGB — a chroma the screen
// cannot show. The rule is: HOLD LIGHTNESS AND HUE, REDUCE CHROMA
// until it fits. That is the least destructive move for our purposes,
// because lightness carries the ramp's structure (the whole field/
// burst shape is a lightness journey) and hue carries its identity;
// chroma is the axis that can give way without the ramp changing
// shape.
//
// Bisection with a FIXED iteration count, so the result is
// deterministic to the bit on every machine — a generator that rolls
// a slightly different colour on a different device would break the
// seed law.
const CLIP_ITERS = 24;
function oklchToHex(L, C, h) {
  L = L < 0 ? 0 : L > 1 ? 1 : L;
  C = C < 0 ? 0 : C;
  const rad = ((h % 360) + 360) % 360 / DEG;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const fits = (c) => {
    const lin = oklabToLinear(L, c * ca, c * sa);
    return inGamut(lin.r) && inGamut(lin.g) && inGamut(lin.b);
  };
  let use = C;
  if (!fits(C)) {
    let lo = 0, hi = C;
    for (let i = 0; i < CLIP_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    use = lo;
  }
  const lin = oklabToLinear(L, use * ca, use * sa);
  const to8 = (v) => {
    const s = linearToSrgb(v < 0 ? 0 : v > 1 ? 1 : v);
    const n = Math.round(s * 255);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  };
  const r = to8(lin.r), g = to8(lin.g), b = to8(lin.b);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
// Was this triple clipped? The generator wants to know, because a
// heavily clipped roll is a roll that did not get what it asked for.
function clippedC(L, C, h) {
  const rad = ((h % 360) + 360) % 360 / DEG;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const fits = (c) => {
    const lin = oklabToLinear(L, c * ca, c * sa);
    return inGamut(lin.r) && inGamut(lin.g) && inGamut(lin.b);
  };
  if (fits(C)) return C;
  let lo = 0, hi = C;
  for (let i = 0; i < CLIP_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// ---- PERCEPTUAL DISTANCE ---------------------------------------------
// In OKLab "how different do these two look" is simply the straight
// line between them. The legibility law used a redmean approximation
// because HSL could not answer the question; it can be exact now.
function deltaE(hexA, hexB) {
  const A = hexToOklch(hexA), B = hexToOklch(hexB);
  const ar = A.h / DEG, br = B.h / DEG;
  const dL = A.L - B.L;
  const da = A.C * Math.cos(ar) - B.C * Math.cos(br);
  const db = A.C * Math.sin(ar) - B.C * Math.sin(br);
  return Math.sqrt(dL * dL + da * da + db * db);
}

const api = { srgbToLinear, linearToSrgb, linearToOklab, oklabToLinear,
  hexToOklch, oklchToHex, clippedC, deltaE, CLIP_ITERS };
G.FF.oklab = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
