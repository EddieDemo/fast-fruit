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

// Light states: STANDARD only in Phase 0. Columns (BRIGHT / DIM /
// DARK / hue casts) land with Phase 5 — the list exists now so code
// can reference states without a later signature change.
const STATES = ['STANDARD'];

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
  toInt, stats, rampNames, STATES };

if (typeof window !== 'undefined') {
  window.FF = window.FF || {};
  window.FF.palette = api;
}
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();