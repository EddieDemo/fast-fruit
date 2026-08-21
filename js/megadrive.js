// ============================================================
// MEGA DRIVE / GENESIS VDP PALETTE — a device gamut.
//
// BENCH-ONLY FOR NOW (Eddie, 2026-08-20). Nothing in the game loads
// this: it exists so the sky bench can show, beside the real preview,
// what a sky would look like if it had to live inside the hardware's
// colours. That containment is deliberate — the measurements below
// say a naive snap would break three shipped systems, so this is a
// LOOKING GLASS, not a filter.
//
// THE HARDWARE. The VDP stores colour as 9 bits — three per channel,
// so EIGHT levels each and 512 colours in total. The DAC ramp is not
// linear: measured, the gaps between adjacent levels run 52, 35, 29,
// 28, 28, 34, 49 — tight in the middle, wide at the ends. Using an
// evenly spaced 0/36/73/... ramp is the commonest way to get this
// wrong and it makes everything slightly too bright in the shadows.
//
// The other half of the constraint is SIMULTANEITY: the hardware
// shows 64 at once, as four banks of sixteen with entry 0 of each
// transparent — so 61 unique plus a backdrop. That is not modelled
// here, because it is not a colour-conversion problem; it is a design
// discipline. Measured for scale, a frame of ours spends roughly 100
// distinct colours (24 sky, ~48 melon bands, terrain, text, decals).
//
// WHY A SNAP IS A LOOKING GLASS AND NOT A FILTER. Measured against
// the shipped game:
//   * sky palettes lose 40-55% of their entries — noon 24 -> 11,
//     asia-lime 16 -> 8. The palette stops being what you asked for,
//     which is the thing Phase 7 existed to fix.
//   * 14 of 35 seeded melon anchors COLLIDE, so racers that are meant
//     to look like themselves become the same melon.
//   * four of the five hours produce an IDENTICAL terrain colour
//     after snapping. The grey-axis step here is deltaE 0.091 to
//     0.325, and the light column's moves are smaller than that —
//     the hardware's grid is coarser than the distinctions our
//     lighting makes.
// The honest conclusion is that a strict fork would have to author
// INSIDE these 512 rather than round into them afterwards, and would
// have to make the hours a palette swap rather than a computed tint —
// which is what the hardware actually did.
//
// Node-safe.
// ============================================================
(function () {
'use strict';

const G = (typeof window !== 'undefined' ? window : global);
G.FF = G.FF || {};

// The measured DAC output for the eight levels, in 8-bit terms.
const LEVELS = [0, 52, 87, 116, 144, 172, 206, 255];

function toHex(r, g, b) {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function chan(hex, i) { return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16); }

// Every colour the hardware can show.
const ALL = (function () {
  const out = [];
  for (const r of LEVELS) for (const g of LEVELS) for (const b of LEVELS) {
    out.push(toHex(r, g, b));
  }
  return out;
})();

// ---- TWO MEANINGS OF "NEAREST", and they are not the same ----------
// PER-CHANNEL is what a conversion tool does: round each channel to
// its nearest level independently. It is what the hardware's own
// colour registers imply and what an artist working in a Mega Drive
// editor would get.
//
// PERCEPTUAL asks which of the 512 actually LOOKS closest, in OKLab.
// Measured over the shipped library, the two disagree on 22% of
// colours — small differences (mean deltaE 0.006, worst 0.018) but a
// real choice, so the bench offers both rather than picking for you.
function nearestLevel(v) {
  let best = LEVELS[0], bd = Infinity;
  for (const m of LEVELS) {
    const d = Math.abs(m - v);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
function snapChannel(hex) {
  return toHex(nearestLevel(chan(hex, 0)),
    nearestLevel(chan(hex, 1)), nearestLevel(chan(hex, 2)));
}
// Searched over all 512 rather than solved, because the ramp is
// non-linear and OKLab is not separable — there is no shortcut that
// stays honest. Cached, since a sky asks the same question of the
// same tones every redraw.
const percCache = new Map();
function snapPerceptual(hex) {
  const hit = percCache.get(hex);
  if (hit !== undefined) return hit;
  const ok = G.FF.oklab;
  if (!ok) return snapChannel(hex);
  let best = ALL[0], bd = Infinity;
  for (let i = 0; i < ALL.length; i++) {
    const d = ok.deltaE(hex, ALL[i]);
    if (d < bd) { bd = d; best = ALL[i]; }
  }
  percCache.set(hex, best);
  return best;
}
function snap(hex, mode) {
  return mode === 'channel' ? snapChannel(hex) : snapPerceptual(hex);
}

// ---- WHAT THE SNAP COSTS, as a measurement -------------------------
// A picture beside a picture invites "it looks fine"; the collapse
// count is the thing that actually decides whether a palette survived.
function collapse(list, mode) {
  const out = [], seen = new Map();
  const merged = [];
  for (let i = 0; i < list.length; i++) {
    const s = snap(list[i], mode);
    out.push(s);
    if (seen.has(s)) merged.push([seen.get(s), i, s]);
    else seen.set(s, i);
  }
  return { snapped: out, distinct: seen.size, lost: list.length - seen.size, merged };
}
// Mean and worst perceptual shift, so "how far did it move" has a
// number rather than an impression.
function drift(list, mode) {
  const ok = G.FF.oklab;
  if (!ok || !list.length) return { mean: 0, worst: 0 };
  let sum = 0, worst = 0;
  for (const hex of list) {
    const d = ok.deltaE(hex, snap(hex, mode));
    sum += d;
    if (d > worst) worst = d;
  }
  return { mean: sum / list.length, worst };
}

const api = { LEVELS, ALL, snap, snapChannel, snapPerceptual, collapse, drift };
G.FF.megadrive = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
