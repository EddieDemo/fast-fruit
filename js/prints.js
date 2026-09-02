// prints.js — factory prints on cardboard (ruled 2026-09-02).
//
// NOT the decal system. Decals are what a PLAYER sticks on THEIR melon
// to mark it as owned (decals.js, and the joke it protects). Prints are
// what the factory put on the box: nobody chose them, nobody owns them.
// They reuse the decal architecture's IDEA — flat art painted into a
// face that rotates with the body — and none of its wearing or
// wrapping layers, because a box face is flat and unowned.
//
// THE POOL IS DATA. Five prints, signed off from the game-bake mockup
// (2026-09-02): arrow, bars, label, umbrella, stamp. Each is a list of
// flat shapes in WORLD px, authored for the 4x-then-majority pixel
// bake — every stroke >= 5 world px, no text (FRAGILE in a font was
// baked and died; FRAGILE as stencil blocks was baked and cut). A
// print is the same size on every box: a label is a label whether it
// sits on a 1x1 or a 1x2 carton, which is why bigger cartons simply
// have room for more.
//
// INK IS NOT A NEW COLOUR. Prints paint in the box's own kraft slots —
// the shadow-bevel tone for ink, the lit-bevel tone for label paper —
// so they are lit with the box, re-tint with the stage, and add
// nothing to the colour ledger (verify-arch A11).
//
// DETERMINISM. A box's prints come from `printSeed`, pure arithmetic
// at mint (state.js) off the track seed, the kind's salt and the prop
// index — NO rng() draw, the boulder-hull pattern, so no existing deal
// moves. Same track, same prints, forever.
(function () {
'use strict';

// Shapes: ['r', x, y, w, h] a rect; ['t', x, y, w, h] a triangle
// pointing up (base at the bottom edge); ['d', x, y, w, h] a dome (the
// upper half of an ellipse); ['o', x, y, r, t] a ring of thickness t.
// Coordinates are the print's own frame, origin at its centre.
// `ink`: 'ink' or 'paper'.
const POOL = [
  { id: 'arrow', w: 36, h: 44, shapes: [
    ['r', -4, -4, 8, 26, 'ink'], ['t', -16, -22, 32, 20, 'ink'] ] },
  // bars: every bar >= 5 world px (a 2 px bar is 40% of a screen pixel
  // at the racing camera and loses the majority vote — it vanishes).
  { id: 'bars', w: 42, h: 24, shapes: [
    ['r', -21, -12, 6, 24, 'ink'], ['r', -11, -12, 5, 24, 'ink'], ['r', -2, -12, 8, 24, 'ink'],
    ['r', 10, -12, 5, 24, 'ink'], ['r', 18, -12, 6, 24, 'ink'] ] },
  { id: 'label', w: 44, h: 30, shapes: [
    ['r', -22, -15, 44, 30, 'paper'], ['r', -17, -10, 20, 6, 'ink'], ['r', -17, 1, 32, 5, 'ink'] ] },
  { id: 'umbrella', w: 34, h: 40, shapes: [
    ['d', -17, -20, 34, 32, 'ink'], ['r', -3, -4, 6, 24, 'ink'] ] },
  { id: 'stamp', w: 32, h: 32, shapes: [
    ['o', 0, 0, 15, 5, 'ink'], ['r', -8, -3, 16, 6, 'ink'] ] },
];
const BARE_FRACTION = 1 / 3;   // a printed box should read as printed
const MAX_PRINTS = 3;
const MARGIN = 9;              // off the bevel (bevel strips are ~8 world px)
const GAP = 4;                 // between prints

function rnd(seed) { return window.FF.mulberry32(seed >>> 0); }

// The layout for a face of w x h world px, from a seed. Deterministic:
// same seed and face, same layout. Returns [] for a bare box.
function layoutFor(printSeed, faceW, faceH) {
  if (printSeed === undefined || printSeed === null) return [];
  const r = rnd(printSeed);
  if (r() < BARE_FRACTION) return [];
  const count = 1 + Math.floor(r() * MAX_PRINTS);
  // draw distinct prints from the pool
  const order = POOL.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const placed = [];
  const innerW = faceW - 2 * MARGIN, innerH = faceH - 2 * MARGIN;
  for (let k = 0; k < count && k < order.length; k++) {
    const P = POOL[order[k]];
    if (P.w > innerW || P.h > innerH) continue;   // does not fit this face at all
    // a few seeded tries at a spot that does not overlap what is placed
    let spot = null;
    for (let t = 0; t < 40 && !spot; t++) {   // 12 tries fitted three on a 1x1 only 0.6% of the time
      const x = -innerW / 2 + P.w / 2 + r() * (innerW - P.w);
      const y = -innerH / 2 + P.h / 2 + r() * (innerH - P.h);
      let clash = false;
      for (const q of placed) {
        if (Math.abs(x - q.x) < (P.w + q.w) / 2 + GAP && Math.abs(y - q.y) < (P.h + q.h) / 2 + GAP) { clash = true; break; }
      }
      if (!clash) spot = { x, y };
    }
    if (spot) placed.push({ id: P.id, x: spot.x, y: spot.y, w: P.w, h: P.h });
  }
  return placed;
}

// A stable signature for the sprite cache key.
function signature(layout) {
  if (!layout || !layout.length) return '';
  let s = 'p';
  for (const q of layout) s += q.id + '@' + Math.round(q.x) + ',' + Math.round(q.y) + ';';
  return s;
}

// Paint a layout into a face. The context is expected in WORLD space
// at the body's centre (translated, not rotated): the body's angle is
// applied here so prints ride the face. Colours are the box's own
// slots, handed in.
function paint(ctx, layout, angle, colors) {
  if (!layout || !layout.length) return;
  ctx.save();
  ctx.rotate(angle);
  for (const q of layout) {
    const P = POOL.find((p) => p.id === q.id);
    if (!P) continue;
    for (const sh of P.shapes) {
      ctx.fillStyle = sh[5] === 'paper' ? colors.paper : colors.ink;
      const x = q.x + sh[1], y = q.y + sh[2];
      if (sh[0] === 'r') {
        ctx.fillRect(x, y, sh[3], sh[4]);
      } else if (sh[0] === 't') {
        ctx.beginPath();
        ctx.moveTo(x, y + sh[4]); ctx.lineTo(x + sh[3], y + sh[4]); ctx.lineTo(x + sh[3] / 2, y);
        ctx.closePath(); ctx.fill();
      } else if (sh[0] === 'd') {
        ctx.beginPath();
        ctx.ellipse(x + sh[3] / 2, y + sh[4] / 2, sh[3] / 2, sh[4] / 2, 0, Math.PI, 2 * Math.PI);
        ctx.closePath(); ctx.fill();
      } else if (sh[0] === 'o') {
        ctx.beginPath();
        ctx.arc(q.x + sh[1], q.y + sh[2], sh[3], 0, 2 * Math.PI);
        ctx.arc(q.x + sh[1], q.y + sh[2], sh[3] - sh[4], 0, 2 * Math.PI, true);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

window.FF.prints = { POOL, BARE_FRACTION, MAX_PRINTS, MARGIN, GAP, layoutFor, signature, paint };
})();
