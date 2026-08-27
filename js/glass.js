// GLASS — pure logic for the UI-glass layer (2026-08-24).
//
// THE LAYER RULING (Eddie): the game is two materials. The WORLD is
// diegetic — 320 register, one light, quantized palette. The GLASS is
// everything outside the fiction: HUD pills, the thumbstick, position
// tags. Glass draws at device resolution, in the HUD palette, and
// does NOT pass through the light column — a dashboard glows the same
// at midnight. This file holds the glass layer's PURE logic so
// verify-hud-glass can hold it headless; renderer.js consumes it.
//
// THE STICK CONTRAST RULING (Eddie, 2026-08-24, second reading): the
// stick keeps its ORIGINAL single-stroke visual and adapts by COLOUR
// alone — light strokes over dark world, dark strokes over light
// world, chosen by sampled luminance with hysteresis and a fade.
// The earlier self-contrast under-strokes are retired by ruling.
// STATED TRADE, kept on record: with a single adaptive tone, a
// structural contrast guarantee against arbitrary pixels does not
// exist — near the switch thresholds the ratio is weak, and the
// hysteresis band makes lingering there rare, not impossible. What
// IS promised (and verified): the switch always selects whichever
// variant contrasts MORE with the sampled world.
(function () {
'use strict';
const G = typeof window !== 'undefined' ? window : globalThis;
G.FF = G.FF || {};

// ---- WCAG 2.x math ----
function chan(c8) {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLuminance(r, g, b) {
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrastRatio(rgb1, rgb2) {
  const l1 = relLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const l2 = relLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- Stick themes ----
// LIGHT = light strokes on a dark under-stroke (for dark worlds).
// DARK  = dark strokes on a light under-stroke (for pale worlds).
// Both pairs must clear 3:1 (verify-hud-glass C-family holds this).
const STICK_THEMES = {
  // THE CANONICAL WHITE (shading owns it; glass loads after shading).
  LIGHT: { main: (window.FF.shading && window.FF.shading.WHITE_RGB)
    || [246, 246, 246] },              // light strokes, for dark worlds
  DARK: { main: [22, 28, 22] },       // dark strokes, for pale worlds
};

// Hysteresis: flip to DARK above LUM_HI, back to LIGHT below LUM_LO.
// The dead band stops a dappled cloud field strobing the control.
// THE BAND STRADDLES THE CROSSOVER (max-contrast ruling): the two
// variants contrast EQUALLY with a background at
//   (L_bg + 0.05)^2 = (L_light + 0.05)(L_dark + 0.05)
// which for these tones is L_bg ~ 0.20 — above it the dark strokes
// win, below it the light ones do. The first thresholds (0.45/0.62)
// were tuned by eye for the retired self-contrast look and held
// LIGHT deep into dark-wins territory; verify-hud-glass C2 caught
// it. Verified: outside this band the switch always selects the
// higher-contrast variant.
const LUM_HI = 0.26;
const LUM_LO = 0.15;
function stickThemeNext(current, lum) {
  if (current === 'LIGHT' && lum > LUM_HI) return 'DARK';
  if (current === 'DARK' && lum < LUM_LO) return 'LIGHT';
  return current === 'DARK' ? 'DARK' : 'LIGHT';
}

// ---- Position-tag (glass pill) style ----
// The HUD pill, verbatim from the dev buttons' CSS so the glass reads
// as one family: dark olive fill, hairline green border, full radius,
// Geist Mono. Text is WHITE by ruling (2026-08-24) — the ordinal is
// broadcast telemetry, not a podium display; the finish screen keeps
// its gold/silver/bronze language.
const TAG_STYLE = {
  bg: [10, 14, 10], bgAlpha: 0.9,
  border: [42, 90, 52],
  text: (window.FF.shading && window.FF.shading.WHITE_RGB)
    || [246, 246, 246],   // canonical white (ruled 2026-08-27)
  numPx: 12, sufPx: 9,      // CSS px; suffix rides the shoulder
  padX: 8, padY: 4,
  liftPx: 14,               // pill bottom above the anchor point
};

G.FF.glass = {
  relLuminance, contrastRatio,
  STICK_THEMES, stickThemeNext, LUM_HI, LUM_LO,
  TAG_STYLE,
};
if (typeof module !== 'undefined' && module.exports) module.exports = G.FF.glass;
})();
