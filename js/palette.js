// ============================================================
// PALETTE — the semantic colour registry (PIXEL 320, Phase 0.1).
//
// NOT a second colour system. The shading module already runs the
// one true system: a single global lighting LAW generating per-body
// ramps into named slots ('A2', never a hex). This module is the
// REGISTRY over that law and over the world's static colours: every
// tone the game legitimately emits gets registered here, so that
// (a) grid-honesty telemetry and the verify-px-honesty suite can ask
//     "is this pixel a colour the game MEANT?", and
// (b) Phase 5's light states have one table to grow columns on
//     (states other than STANDARD are reserved, deliberately
//     unimplemented until the indexed-sprite work of Phase 2.3).
//
// Registration is additive and idempotent. Dynamic tones (the law's
// cached band/offset solves, the seeded anchors) register at their
// cache-fill sites in shading.js — one hook per solver, no per-call-
// site plumbing. Static tones (world COLORS, bot accents, place
// colours) register at renderer init.
//
// Node-safe: the verify suite loads this file directly.
// ============================================================
(function () {
'use strict';

const ramps = new Map();      // name -> [hex, ...] in ramp order
const members = new Set();    // int 0xRRGGBB of every registered tone

// ---- LIGHT COLUMNS (Phase 5) ----
// A light state is a COLUMN of the palette table: every tone the game
// emits resolves through lit(), so changing the state shifts the
// whole world coherently — melons, ground, checker, sky, signage —
// because they are all reading one table. This is the Out Run
// mechanism itself, not an imitation: the pixels do not change, the
// palette they index does.
//
// DISCIPLINE: light moves in STEPS through hue/sat/lightness of the
// palette, never through alpha or a brightness multiply. A multiply
// reads as a filter over pixel art; a column swap reads as light.
// Deltas are SCALES on lightness and saturation, plus an absolute
// hue rotation. Additive deltas were wrong twice over: adding
// saturation to a GREY invents a hue (the ground turned warm-brown
// under BRIGHT), and subtracting lightness crushes dark tones to
// black (DARK put the ground at #020202). Scaling keeps greys grey
// and preserves the relative structure of every ramp.
//
// NOTE on the discipline: multiplying here is fine — the result is a
// discrete, registered palette entry. What stays forbidden is
// multiplying at COMPOSITE time over pixels, which mints blends and
// reads as a filter laid over pixel art.
const COLUMNS = {
  BRIGHT:   { mL: 1.14, mS: 1.10, dH: 0 },
  STANDARD: { mL: 1,    mS: 1,    dH: 0 },
  DIM:      { mL: 0.74, mS: 0.86, dH: 4 },
  DARK:     { mL: 0.48, mS: 0.70, dH: 9 },
};
const STATES = Object.keys(COLUMNS);
let current = 'STANDARD';
let version = 0;              // bumped on every change: caches watch it
const litCache = new Map();

function rgbToHslLocal(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgbLocal(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// The single door: any tone, resolved for the current light column.
// STANDARD is the identity, so vector mode and every existing check
// see byte-identical output until a state is actually selected.
function lit(hex) {
  if (current === 'STANDARD') return hex;
  const ck = current + '|' + hex;
  const hit = litCache.get(ck);
  if (hit !== undefined) return hit;
  const col = COLUMNS[current] || COLUMNS.STANDARD;
  const k = toInt(hex);
  if (k === null) return hex;
  let [h, sat, l] = rgbToHslLocal((k >> 16) & 255, (k >> 8) & 255, k & 255);
  h += col.dH;
  sat = Math.max(0, Math.min(1, sat * col.mS));
  l = Math.max(0, Math.min(1, l * col.mL));
  const [r, g, b] = hslToRgbLocal(h, sat, l);
  const out = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  litCache.set(ck, out);
  members.add(toInt(out));      // the lit tone is legitimate too
  return out;
}
function setLight(state) {
  if (!COLUMNS[state] || state === current) return current;
  current = state;
  version++;
  return current;
}
function getLight() { return current; }
function lightVersion() { return version; }

function toInt(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('rgba') || h.startsWith('rgb')) {
    const m = h.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return ((+m[1] & 255) << 16) | ((+m[2] & 255) << 8) | (+m[3] & 255);
  }
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  const v = parseInt(h, 16);
  return Number.isNaN(v) ? null : v;
}

function register(name, tones) {
  if (!ramps.has(name)) ramps.set(name, []);
  const ramp = ramps.get(name);
  for (const t of (Array.isArray(tones) ? tones : [tones])) {
    const k = toInt(t);
    if (k === null) continue;
    if (ramp.indexOf(t) === -1) ramp.push(t);
    members.add(k);
  }
  return ramp.length;
}

function registerTone(name, hex) { return register(name, [hex]); }

function tone(name, i) {
  const ramp = ramps.get(name);
  return ramp ? (ramp[Math.max(0, Math.min(ramp.length - 1, i | 0))] || null) : null;
}

function isMemberInt(k) { return members.has(k); }
function isMemberHex(hex) { const k = toInt(hex); return k !== null && members.has(k); }

function stats() {
  return { ramps: ramps.size, tones: members.size, states: STATES.slice() };
}
function rampNames() { return [...ramps.keys()]; }

const api = { register, registerTone, tone, isMemberInt, isMemberHex,
  toInt, stats, rampNames, STATES, COLUMNS, lit, setLight, getLight,
  lightVersion };

if (typeof window !== 'undefined') {
  window.FF = window.FF || {};
  window.FF.palette = api;
}
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
