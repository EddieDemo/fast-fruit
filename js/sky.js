// ============================================================
// SKY — the skybox spec model (PIXEL 320, Phase 6.0).
//
// WHAT THIS REPLACES, AND WHY.
// Phase 4 shipped the sky as a ONE-SEGMENT MONOTONE SWEEP: one base
// tone plus lift / fade / turn, applied continuously from zenith to
// horizon. Held against the reference art (Out Run, Super Hang-On
// crops reviewed by Eddie 2026-08-19), that model cannot draw four of
// six references, for four separate reasons:
//
//   * FLAT SKIES. The Out Run title sky is ONE COLOUR. A model whose
//     every parameter is a rate cannot express "no gradient".
//   * FIELD + BURST. In the crops, 60-75% of the sky is a genuine
//     PLATEAU and the entire tonal journey happens in the bottom
//     quarter. Ours runs a ladder the whole height (166 rows, ~115
//     tones, mean plateau 1.4 px) and merely COMPRESSES it toward
//     the horizon. That shape difference, not colour choice, is the
//     single biggest reason ours does not read as period.
//   * CHROMA MAY RISE. Super Hang-On's Asia sky walks cyan ->
//     yellow-green at FULL saturation. `fade` only ever subtracts,
//     so the sign of the chroma move was hard-coded into a law we
//     called atmospheric perspective. Haze is real; a stylised Sega
//     sky is under no obligation to be hazy.
//   * NON-MONOTONE VALUE, HARD CUTS. The America sky cuts from a
//     violet field into a pale band and out again. A single eased
//     segment has no way to turn around.
//
// THE MODEL. A sky is an ORDERED LIST OF STOPS in sky space (t = 0
// at the top of the sky region, t = 1 at the horizon row), plus a
// BAND POLICY describing how the continuous solve is quantised into
// rows. Everything above is then expressible: a flat sky is two
// stops of one colour; field-plus-burst is a stop pair at the top and
// a cluster at the bottom; rising chroma is just two stop values; a
// cut is a segment the policy refuses to interpolate.
//
// HUE IS STORED UNWRAPPED, and this is load-bearing. Phase 5.0b's v2
// cast rotated hue along the SHORTER ARC and produced a seam
// wherever the two ends sat near 180 degrees apart — a bug that only
// appeared on sunsets, i.e. on the feature. Here the author writes
// the hue they mean: cyan (175) to yellow-green (78) descends
// through green; writing 438 instead would climb the other way
// through blue and purple. Both are expressible, neither is guessed,
// and there is no arc for an algorithm to choose ambiguously. Wrap
// happens once, at the final HSL->RGB.
//
// SEPARATION OF CONCERNS. This module EMITS ROWS; it never paints.
// `rows()` is pure — no canvas, no DOM, no state — and returns
// [{ y, h, hex }]. The renderer blits that list, the bench blits the
// same list, and the suite reads the same list instead of scraping
// fillRect calls. One authority, three consumers. That is the same
// correction the terrain fill needed, applied before it is needed:
// a bench that re-implements the painter is a proof that approximates
// the painter, which is exactly how Phase 2 regressed on device.
//
// Node-safe: the verify suite and the bench load this file directly.
// ============================================================
(function () {
'use strict';

const G = (typeof window !== 'undefined' ? window : global);
G.FF = G.FF || {};

// ---- colour plumbing -------------------------------------------------
// Deliberately routed through shading's own converters rather than
// re-derived here: byte-identity with the shipped ladder is asserted
// in the suite, and it can only hold if both sides do the same
// arithmetic in the same order.
function sh() { return G.FF.shading; }

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const [h, s, l] = sh().rgbToHsl(r, g, b);
  return { h, s, l };
}
function hslToHex(h, s, l) {
  const [r, g, b] = sh().hslToRgb(((h % 360) + 360) % 360, s, l);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ============================================================
// STAGE ONE — THE PALETTE
//
// A sky is N COLOURS, in order, zenith to horizon. That is the whole
// of stage one: it says nothing about pixels, height, or the screen.
//
// WHY THIS REPLACED A QUANTISED RAMP (Eddie's ruling, 2026-08-19).
// The old model authored two endpoints, interpolated continuously,
// and then stepped the result on three separate quantisation axes.
// The palette was therefore EMERGENT — you could not ask for
// fourteen colours, you could only ask for step sizes and count what
// came out. Eddie's question "why seventeen tones, and why can I not
// get two?" needed an answer about a hue rung interacting with a 300
// degree travel, which is not a thing anyone should reason about in
// order to pick colours.
//
// Now the answer is "because you said fourteen". Three whole axes of
// control disappear with it, and so does the class of surprise where
// two authored colours quietly landed on the same rung and became
// one fat band.
//
// It is also what the reference hardware actually did. A Sega artist
// allocated N palette entries to the sky — a list of colours, not a
// gradient with a step size.
//
// NODES: any entry may be PINNED with an explicit (L, C, h); the
// rest interpolate linearly by INDEX between their pinned
// neighbours. Two pinned nodes give a plain ramp; more give the
// non-monotone shapes the reference cut skies need. This is the
// shape Eddie's own ramp tool already proved works.
//
// Everything here is OKLCh — see js/oklab.js for why.

// A colourless node has no hue: C is 0 and the angle is arbitrary.
// Same rule as before, now on a chroma that means the same thing at
// every hue. An explicit hue still outranks inheritance.
const ACHROMATIC_C = 0.012;

function nodesOf(spec) {
  const n = entriesOf(spec);
  const raw = (spec.nodes || []).map((nd) => ({
    i: nd.i < 0 ? n + nd.i : nd.i,          // -1 addresses the last entry
    L: nd.L, C: nd.C, h: nd.h, hueAuthored: nd.hueAuthored,
  })).sort((a, b) => a.i - b.i);
  if (!raw.length) return [{ i: 0, L: 0.5, C: 0, h: 0 }, { i: n - 1, L: 0.5, C: 0, h: 0 }];
  if (raw[0].i !== 0) raw.unshift(Object.assign({}, raw[0], { i: 0 }));
  if (raw[raw.length - 1].i !== n - 1) {
    raw.push(Object.assign({}, raw[raw.length - 1], { i: n - 1 }));
  }
  // Hue inheritance for colourless nodes — a ramp into white holds
  // its hue and desaturates, rather than walking every colour between
  // its own hue and an arbitrary zero.
  const chromatic = (nd) => nd.C > ACHROMATIC_C || nd.hueAuthored;
  for (let i = 0; i < raw.length; i++) {
    if (chromatic(raw[i])) continue;
    for (let d = 1; d < raw.length; d++) {
      const a = raw[i - d], b = raw[i + d];
      if (a && chromatic(a)) { raw[i].h = a.h; break; }
      if (b && chromatic(b)) { raw[i].h = b.h; break; }
    }
  }
  return raw;
}

function entriesOf(spec) {
  return Math.max(1, spec.entries === undefined ? 12 : spec.entries | 0);
}

// The palette itself: N hex tones, zenith first.
function paletteOf(spec) {
  const n = entriesOf(spec);
  const nd = nodesOf(spec);
  const ok = G.FF.oklab;
  const out = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    while (seg < nd.length - 2 && i > nd[seg + 1].i) seg++;
    const a = nd[seg], b = nd[seg + 1] || nd[seg];
    const span = b.i - a.i;
    const u = span <= 0 ? 0 : (i - a.i) / span;
    const t = u < 0 ? 0 : u > 1 ? 1 : u;
    out.push(ok.oklchToHex(
      a.L + (b.L - a.L) * t,
      a.C + (b.C - a.C) * t,
      // Hue stays UNWRAPPED: a node's angle is the path the author
      // meant, so 300 -> 260 descends and 300 -> 620 climbs the long
      // way. No arc is ever chosen for them.
      a.h + (b.h - a.h) * t));
  }
  return out;
}

// ============================================================
// STAGE TWO — THE DISTRIBUTION
//
// N colours is not N bands. Measured on the reference crops and on
// our own authored skies, one entry holds 60-75% of the sky (the
// FIELD) and the rest share the bottom quarter in 1-3 px bands (the
// BURST). Equal-width entries would destroy exactly the shape that
// made the skies read as period.
//
// So stage two is its own axis and knows nothing about colour:
//   field  — the fraction of the sky the FIRST entry holds
//   spread — shapes how the remaining entries divide the burst.
//            1 is even; >1 puts the wider bands nearer the field;
//            <1 puts them nearer the horizon.
//
// The two stages compose but never consult each other, which is what
// lets them be seeded independently later.
function fieldOf(spec) { return spec.field === undefined ? 0.6 : spec.field; }
function spreadOf(spec) { return spec.spread === undefined ? 1 : spec.spread; }

// THE BURST IS AUTHORED IN PIXELS, THE FIELD ABSORBS THE REST.
//
// A distribution expressed only as fractions scales with the buffer,
// and our buffer runs 148 rows in landscape to 693 in portrait —
// measured, night-indigo's burst came out 4 px on a desktop and 14 px
// in portrait, the same sky three times coarser. The reference
// hardware was a fixed 320x224 and never had this problem.
//
// So a spec may declare `burstPx`: the burst occupies that many rows
// on every device, and the FIELD — a flat plateau by design — takes
// whatever is left. That is how the reference art is actually built:
// the burst is authored, the field is a fill.
//
// The `field` fraction remains for skies that are a LADDER rather
// than a field-plus-burst (the classic hours), where there is no
// plateau to absorb anything and scaling is the honest behaviour.
function burstPxOf(spec) { return spec.burstPx; }

// ---- PER-ENTRY WEIGHTS: THE RHYTHM ----------------------------------
// `spread` is a MONOTONE curve — widths either shrink toward the
// horizon or grow toward it, and nothing in between. Measured across
// its whole range on a 12-entry, 36 px burst, the only variation it
// produces is rounding noise.
//
// The reference is not a curve. Eddie's Super Hang-On crop reads
// thin, thin, THICK, thin, medium, thin, thin — a deliberate
// irregular rhythm, because the artist was choosing row counts, not
// evaluating a function.
//
// So an entry may carry a WEIGHT, and the burst's fixed pixel height
// is divided among the entries in proportion. One field, one
// mechanism: a short list TILES, which is precisely what a rhythm is,
// so RHYTHMS below are just short weight lists kept as data.
//
// PURELY ADDITIVE. With no weights the old curve runs unchanged and
// every existing sky renders byte-for-byte as before — asserted over
// every library and generated sky at four buffer heights.
//
// Device independence survives untouched: the burst is a fixed pixel
// count and weights only divide it up, so a rhythm reads identically
// at 148 rows and at 693.
//
// Largest-remainder apportionment, so the rows sum EXACTLY and the
// result is deterministic to the bit.
function weightsOf(spec, count) {
  const w = spec.weights;
  if (!w || !w.length || count <= 0) return null;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const v = w[i % w.length];
    out[i] = v > 0 ? v : 0;
  }
  let sum = 0;
  for (let i = 0; i < count; i++) sum += out[i];
  return sum > 0 ? out : null;
}
function apportion(weights, total) {
  const n = weights.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += weights[i];
  const exact = new Array(n), out = new Array(n);
  let used = 0;
  for (let i = 0; i < n; i++) {
    exact[i] = weights[i] * total / sum;
    out[i] = Math.floor(exact[i]);
    used += out[i];
  }
  // Remainders, largest first; index order breaks ties so two
  // identical weights never depend on sort stability.
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => {
    const ra = exact[a] - Math.floor(exact[a]), rb = exact[b] - Math.floor(exact[b]);
    return rb - ra || a - b;
  });
  for (let k = 0; used < total; k++, used++) out[order[k % n]] += 1;
  return out;
}

// ---- RHYTHMS: a vocabulary, held as DATA -----------------------------
// The distribution's answer to the colour FAMILIES. Random per-entry
// widths produce noise, not a Sega sky; what the reference has is a
// small set of irregular repeating patterns. Nothing in the pipeline
// reads this table — it seeds `weights` and gets out of the way,
// exactly as SHAPES seeds the distribution numbers.
const RHYTHMS = {
  EVEN: { reads: 'every band the same — the curve, unaccented', w: [1] },
  TICK: { reads: 'two thin, one thick — the commonest reference beat', w: [1, 1, 3] },
  PULSE: { reads: 'an irregular five, never quite repeating to the eye', w: [1, 2, 1, 1, 3] },
  // SWELL, not BREATH: the colour families gained a BREATH (a sky that
  // varies subtly rather than not at all) and two namespaces sharing
  // one word would have printed roll captions like "BREATH/BREATH".
  // Same meaning, no collision.
  SWELL: { reads: 'wide then narrowing, over and over', w: [3, 1, 1, 2] },
  ACCENT: { reads: 'a heavy beat every sixth band', w: [2, 1, 1, 4, 1, 1] },
  CLUSTER: { reads: 'two tight clusters with a plateau between them',
    w: [1, 1, 1, 6, 1, 1, 1] },
};
const RHYTHM_NAMES = Object.keys(RHYTHMS);
// PIN EVERY ENTRY: turn an interpolated ramp into a stated list.
//
// Measured on Africa_Stage1, the reference steps run 0.0013, 0.0024,
// 0.0037, 0.0056, then JUMP 0.0677, then six even steps — a 54x ratio
// between the smallest and largest. Pinning nodes at the jump catches
// the discontinuity, but the segments BETWEEN pins are still walked
// evenly, and four of eleven entries came out wrong.
//
// At eleven colours a palette is a LIST TO BE STATED, not a ramp to
// be interpolated. Interpolation is a convenience for authoring a
// 24-entry ladder; at this size it is in the way. Pinning every entry
// costs nothing — paletteOf already returns a pinned node's exact
// value — it simply needed to be one action rather than eleven.
function pinAll(spec) {
  const pal = paletteOf(spec);
  const ok = G.FF.oklab;
  const out = Object.assign({}, spec);
  out.nodes = pal.map((hex, i) => {
    const c = ok.hexToOklch(hex);
    return { i, L: c.L, C: c.C, h: c.h, hueAuthored: true };
  });
  return out;
}

// BUILD A SPEC FROM A RIP. The ripper's output — palette, sequence,
// widths — IS a spec in this model, which is the clearest evidence
// available that the ripper and the generator were designed against
// the same idea of what a sky is. No conversion, no lossy step: every
// entry pinned, every width stated.
function fromRip(rip, opts) {
  const o = opts || {};
  const ok = G.FF.oklab;
  const bands = rip.bands || [];
  if (!bands.length) return null;
  const total = bands.reduce((a, b) => a + b.px, 0);
  // The SEQUENCE is what makes a ripped sky expressible at all: a
  // reference reuses palette entries, so entry order and band order
  // are not the same list.
  const seq = rip.sequence.slice();
  const nodes = rip.palette.map((hex, i) => {
    const c = ok.hexToOklch(hex);
    return { i, L: c.L, C: c.C, h: c.h, hueAuthored: true };
  });
  return {
    id: o.id || 'ripped',
    name: o.name || 'from a rip',
    role: o.role || 'NOON',
    sun: o.sun === undefined ? 268 : o.sun,
    floor: 1,                       // a ripped crop IS the whole sky
    entries: rip.palette.length,
    nodes,
    sequence: seq,
    widths: bands.map((b) => b.px),
    ripped: true, total,
  };
}

// Pure: returns a NEW spec carrying that rhythm's weights.
function applyRhythm(spec, name) {
  const r = RHYTHMS[name];
  if (!r) return spec;
  const out = Object.assign({}, spec);
  if (name === 'EVEN') delete out.weights;      // EVEN is the curve itself
  else out.weights = r.w.slice();
  out.rhythm = name;
  return out;
}

// Row counts per entry, summing exactly to hz.
function distribute(spec, hz) {
  const n = entriesOf(spec);
  const out = new Array(n).fill(0);
  if (hz <= 0) return out;
  if (n === 1) { out[0] = hz; return out; }
  const bpx = burstPxOf(spec);
  const f = bpx === undefined
    ? Math.max(0, Math.min(0.98, fieldOf(spec)))
    // Never let the burst eat the whole sky on a very short buffer:
    // a field of at least one row keeps the shape recognisable.
    : Math.max(0, Math.min(0.98, (hz - Math.min(bpx, hz - 1)) / hz));
  const sp = Math.max(0.05, spreadOf(spec));
  const bounds = new Array(n + 1);
  bounds[0] = 0;
  bounds[1] = f;
  for (let j = 1; j < n; j++) {
    bounds[1 + j] = f + (1 - f) * Math.pow(j / (n - 1), sp);
  }
  bounds[n] = 1;
  // WEIGHTED PATH: the field keeps its size, and the burst's rows are
  // apportioned among the remaining entries by the rhythm.
  const wts = weightsOf(spec, n - 1);
  if (wts) {
    const fieldRows = Math.max(0, Math.min(hz, Math.round(f * hz)));
    const burstRows = hz - fieldRows;
    out[0] = fieldRows;
    const share = apportion(wts, burstRows);
    for (let i = 1; i < n; i++) out[i] = share[i - 1];
    return out;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.round(bounds[i] * hz), b = Math.round(bounds[i + 1] * hz);
    out[i] = Math.max(0, b - a);
  }
  // Rounding can lose or gain a row; the FIELD absorbs it, since it
  // is the one band whose exact height carries no information.
  let sum = 0;
  for (let i = 0; i < n; i++) sum += out[i];
  out[0] += hz - sum;
  if (out[0] < 0) out[0] = 0;
  return out;
}

// ---- SHAPES: STARTING POINTS, NOT MODES ------------------------------
// The old model had band POLICIES — FINE, STRIPE, CUT, FLAT — which
// were names for quantisation configurations. Quantisation is gone
// and so are they, and what each of them MEANT is now just a couple
// of numbers: FINE and STRIPE differed only in how many tones, which
// is literally `entries`; CUT's hard edges are the default, since
// every entry is already a solid band; FLAT is entries 1.
//
// But that cost DISCOVERABILITY. "Pick STRIPE" is a thing you can do
// without knowing the model; "set entries to 10 and burstPx to 32" is
// not. So the names come back as DATA — a table of known-good
// starting points that seeds the numbers and then gets out of the
// way.
//
// THE DISTINCTION IS THE POINT, and it is the same one that makes the
// bench export specs rather than code: a preset that SEEDS NUMBERS is
// an authoring affordance, and a preset that LIVES IN THE MODEL is a
// mode. Modes are what Phase 7 spent itself deleting. Nothing in the
// pipeline reads this table — rows(), paletteOf() and distribute()
// have never heard of it, and the suite asserts as much.
//
// A shape touches DISTRIBUTION ONLY. It never sets a node, a hue or a
// floor: colour is stage one's business and how much of the frame a
// sky occupies is a composition decision, both orthogonal to how the
// bands are cut.
const SHAPES = {
  FINE: { reads: 'a long ladder of near-neighbours — the classic hours',
    entries: 26, field: 0.16, spread: 1.15, dither: 2 },
  STRIPE: { reads: 'few tones, broad plateaus — the period stripe field',
    entries: 10, burstPx: 32, spread: 1, dither: 0 },
  HAZE: { reads: 'a wide soft burst, dithered — atmosphere over a horizon',
    entries: 18, burstPx: 44, spread: 1.3, dither: 2 },
  CUT: { reads: 'abrupt and few — pin nodes to make it turn around',
    entries: 12, burstPx: 36, spread: 0.85, dither: 0 },
  FLAT: { reads: 'one colour — the Out Run title sky',
    entries: 1, burstPx: 0, spread: 1, dither: 0 },
};
const SHAPE_NAMES = Object.keys(SHAPES);
// DOES THIS SPEC STILL MATCH THAT SHAPE? Derived, never stored.
//
// A remembered "selected" flag goes stale the moment a knob moves,
// and then the tool is telling you something that used to be true —
// the same failure the lit() fast path had when it asked whether the
// hour was called NOON instead of whether the column was the
// identity. A computed answer cannot go stale.
//
// Only the fields the shape OWNS are compared: colour, floor and
// weights are somebody else's business, so a shape stays matched
// while you change them.
function matchesShape(spec, name) {
  const sh = SHAPES[name];
  if (!sh) return false;
  if (entriesOf(spec) !== sh.entries) return false;
  if (spreadOf(spec) !== sh.spread) return false;
  if ((spec.dither | 0) !== (sh.dither | 0)) return false;
  if (sh.burstPx !== undefined) return spec.burstPx === sh.burstPx;
  return spec.burstPx === undefined && fieldOf(spec) === sh.field;
}
function matchesRhythm(spec, name) {
  const r = RHYTHMS[name];
  if (!r) return false;
  const w = spec.weights;
  // EVEN is the ABSENCE of weights — the curve, unaccented — so it
  // matches exactly when nothing is overriding the curve.
  if (name === 'EVEN') return !w || !w.length;
  if (!w || w.length !== r.w.length) return false;
  for (let i = 0; i < w.length; i++) if (w[i] !== r.w[i]) return false;
  return true;
}

// Pure: returns a NEW spec. Node POSITIONS rescale proportionally
// with the entry count — the same law the bench's entries slider
// obeys, because collapsing an author's nodes is destructive whoever
// does it.
function applyShape(spec, name) {
  const sh = SHAPES[name];
  if (!sh) return spec;
  const prev = entriesOf(spec);
  const n = sh.entries;
  const out = Object.assign({}, spec);
  delete out.field; delete out.burstPx;
  out.entries = n;
  // A SHAPE ALWAYS WRITES `spread`, even while a rhythm is overriding
  // it. A first cut skipped it — reasoning that writing a field which
  // currently does nothing is misleading — and that traded a strong
  // property for a cosmetic one: it made the result depend on whether
  // you pressed the shape or the rhythm first. Order-independence is
  // what "they compose" MEANS, and it is worth more.
  //
  // And the field is not dead, only dormant: spread is what takes
  // over the moment the rhythm is cleared, so writing it stores the
  // shape's intention rather than a value with no effect. The bench
  // already labels it "(weights override this)", which is the honest
  // way to say dormant.
  out.spread = sh.spread;
  out.dither = sh.dither;
  if (sh.burstPx !== undefined) out.burstPx = sh.burstPx;
  if (sh.field !== undefined) out.field = sh.field;
  out.nodes = (spec.nodes || []).map(function (nd) {
    const u = nd._u === undefined ? (prev > 1 ? nd.i / (prev - 1) : 0) : nd._u;
    return Object.assign({}, nd, { i: n > 1 ? Math.round(u * (n - 1)) : 0, _u: u });
  });
  return out;
}

// ---- LINE DITHER, unchanged in spirit --------------------------------
// The reference transitions alternate over a few rows rather than
// stepping once — one-row alternation between two adjacent PALETTE
// ENTRIES, which is how the hardware faked intermediate tones. It is
// a transition mechanism, never a texture: it only ever runs across a
// boundary, so a flat field stays flat.
const BAYER8 = [0, 4, 2, 6, 1, 5, 3, 7];

// ---- CROSSFADE: a duty cycle that RAMPS ------------------------------
// The shipped dither blends a FIXED number of rows at the end of each
// band, which is a flicker at a boundary. Measured against the
// reference it gave 64,1,1,1,1,16,1,1,1,1,16 where America_Stage1B
// runs 44,1,2,1,1,7,1,3,1,2,2 — the right SHAPE of sequence, the
// wrong widths. Theirs is a CROSSFADE: entry A holds long while B
// flickers one pixel, and as the band descends the duty cycle shifts
// until B holds and A flickers. Four colours then read as sixteen
// steps.
//
// `crossfade` is the fraction of each burst band spent fading into
// the NEXT entry. 0 is today's solid bands. 1 makes the entire burst
// one continuous crossfade, which is what the reference does.
//
// Ordered, never random: the same fixed Bayer sequence, so the
// pattern is stable frame to frame and identical on every device.
function crossfadeRow(k, n) {
  // Duty ramps 0 -> 1 across the band; the ordered threshold turns
  // that into a run pattern rather than a probability.
  const duty = n <= 1 ? 1 : (k + 0.5) / n;
  return duty > (BAYER8[k % 8] + 0.5) / 8;
}

// ---- ROWS: the one output --------------------------------------------
// Pure: (height, spec) -> [{ y, h, hex }]. No canvas, no DOM, no
// state. The renderer blits this list, the bench blits the same list,
// and the suites read it rather than scraping fillRect calls.
const rowsCache = new WeakMap();
function rows(height, spec) {
  let per = rowsCache.get(spec);
  if (per !== undefined) {
    const hit = per.get(height);
    if (hit !== undefined) return hit;
  } else {
    per = new Map();
    rowsCache.set(spec, per);
  }
  const out = rowsUncached(height, spec);
  per.set(height, out);
  return out;
}
// Always fresh. The bench edits one spec object in place, which is
// the one case where the picture legitimately changes without the
// object changing.
function rowsUncached(height, spec) {
  const hz = floorRow(height, spec);
  const pal = paletteOf(spec);
  // AN EXPLICIT SEQUENCE OUTRANKS THE IMPLICIT ONE. Until now band k
  // used entry k, in palette order, each exactly once — the model
  // MARCHED. Every reference RETURNS to earlier entries after others
  // have intervened, which is not a dither between neighbours but a
  // genuine reuse. A spec may now state which entry goes in which
  // band, and the two lists stop being the same list.
  if (spec.sequence && spec.widths) return statedRows(height, spec, pal, hz);
  const widths = distribute(spec, hz);
  const dither = spec.dither | 0;
  const out = [];
  let y = 0;
  const xf = Math.max(0, Math.min(1, spec.crossfade || 0));
  for (let i = 0; i < widths.length; i++) {
    let w = widths[i];
    if (w <= 0) continue;
    // THE FIELD DOES NOT CROSSFADE. It is a PLATEAU by definition —
    // the flat expanse most of the sky is made of — and fading it
    // destroys the very thing it is. Measured before this exemption: a
    // 6-entry sky with a 119-row field came out as 21,1,7,1,3,1,3,...
    // with the plateau shredded, and the band gate correctly rejected
    // it. The reference does exactly this — America_Stage1B holds 44
    // solid rows and only then begins to fade.
    const isField = i === 0 && widths.length > 1;
    // CROSSFADE takes precedence over the boundary dither: it is the
    // same idea done properly, across the band instead of at its edge.
    if (xf > 0 && !isField && i + 1 < pal.length && w > 1) {
      const zone = Math.max(2, Math.round(w * xf));
      const solid = w - zone;
      if (solid > 0) { out.push({ y, h: solid, hex: pal[i] }); y += solid; }
      // CHECKERBOARD RETIRED (Eddie's ruling, 2026-08-25): the
      // per-pixel checker cells that two of the eight captures used
      // are gone from the whole engine — they read as transparency
      // wherever anything overlapped them (the cloud-shadow lesson),
      // and the ruling is that skies do not dither in x. Crossfade
      // rows are ALWAYS the solid row-interleave now: full-width
      // rows alternating by duty, the same fade done in one
      // dimension only.
      for (let k = 0; k < zone; k++) {
        out.push({ y, h: 1, hex: crossfadeRow(k, zone) ? pal[i + 1] : pal[i] });
        y += 1;
      }
      continue;
    }
    if (dither && i + 1 < pal.length && w > dither) {
      // Blend the last `dither` rows of this band into the next
      // entry, by an ordered threshold — the alternation the crops
      // show, and stable frame to frame because the pattern is fixed.
      const solid = w - dither;
      if (solid > 0) { out.push({ y, h: solid, hex: pal[i] }); y += solid; }
      for (let k = 0; k < dither; k++) {
        const next = (BAYER8[k % 8] + 0.5) / 8 < (k + 1) / (dither + 1);
        out.push({ y, h: 1, hex: next ? pal[i + 1] : pal[i] });
        y += 1;
      }
      w = 0;
    }
    if (w > 0) { out.push({ y, h: w, hex: pal[i] }); y += w; }
  }
  // Below the floor the horizon tone HOLDS, in one row reaching the
  // bottom of the buffer — the backdrop the parallax land layers will
  // sit against, and the reason a portrait window cannot show a seam.
  if (y < height) out.push({ y, h: height - y, hex: pal[pal.length - 1] });
  register(out);
  return out;
}

// A STATED SKY: explicit sequence, explicit widths, optional
// per-band horizontal dither. This is the shape a rip comes back in,
// and it bypasses distribute() entirely — there is nothing to
// apportion when every width is given.
function statedRows(height, spec, pal, hz) {
  const out = [];
  const seq = spec.sequence, w = spec.widths;
  // (The rip format's per-band checker channel retired with the
  // checkerboard ruling, 2026-08-25 — a stated band is its modal
  // entry, which is exactly what a checker-blind consumer always got.)
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let y = 0;
  for (let i = 0; i < seq.length && y < height; i++) {
    // Widths are authored against the rip's own height; scale them to
    // whatever buffer we are handed, and never let a band vanish.
    const px = Math.max(1, Math.round(w[i] * hz / total));
    const h = Math.min(px, height - y);
    if (h <= 0) break;
    const rec = { y, h, hex: pal[seq[i]] || pal[0] };
    out.push(rec);
    y += h;
  }
  if (y < height) out.push({ y, h: height - y, hex: pal[seq[seq.length - 1]] || pal[0] });
  register(out);
  return out;
}
function register(out) {
  // Register every emitted tone, as before — including the second
  // colour of a dithered band, which is on screen just as much.
  if (G.FF.palette && G.FF.palette.registerTone) {
    for (let i = 0; i < out.length; i++) {
      G.FF.palette.registerTone('sky', out[i].hex);
    }
  }
}

// ---- THE FLOOR -------------------------------------------------------
// Where the ramp bottoms out, authored per spec. A ground-level sky
// finishes around mid-screen and leaves the lower half for the
// parallax land layers; an ABOVE-THE-CLOUDS sky declares 1 and fills
// the frame. How much of the frame a sky occupies is art direction,
// not a camera constant.
const FLOOR_DEFAULT = 0.5;
function floorOf(spec) {
  return spec.floor === undefined ? FLOOR_DEFAULT : spec.floor;
}
function floorRow(height, spec) {
  return Math.round(height * floorOf(spec));
}

// ---- AUTHORING HELPERS ----------------------------------------------
function node(i, L, C, h, opts) {
  const o = opts || {};
  return { i, L, C, h, hueAuthored: o.hueAuthored || (C <= ACHROMATIC_C && h !== undefined && o.hueAuthored !== false) };
}
// A node from a hex, for authors who think in swatches.
function nodeHex(i, hex) {
  const c = G.FF.oklab.hexToOklch(hex);
  return { i, L: c.L, C: c.C, h: c.h };
}

// ---- AMBIENT: WHAT THIS SKY DOES TO THE WORLD ------------------------
// Outdoors the sky IS the light, so a sky and a light column are two
// tellings of one fact. With an explicit palette the derivation is
// cleaner than it was: the FIELD is no longer "the most repeated tone
// I could find" but simply the entry holding the most rows.
//   FIELD   — the plateau, most of the sky's area: the ambient fill,
//             the hue and chroma everything in shadow sits in.
//   HORIZON — the last entry, the bright band above the ground: the
//             bounce that comes back UP off the world.
// The tint mixes them field-dominant, IN OKLAB, so the mix is
// perceptual rather than an artefact of a colour model's arithmetic.
const SAMPLE_H = 180;

function ambient(spec) {
  const hz = floorRow(SAMPLE_H, spec);
  const widths = distribute(spec, hz);
  const pal = paletteOf(spec);
  let best = -1, fi = 0, sum = 0, lSum = 0;
  const ok = G.FF.oklab;
  for (let i = 0; i < pal.length; i++) {
    const w = widths[i] || 0;
    if (w > best) { best = w; fi = i; }
    sum += w;
    lSum += ok.hexToOklch(pal[i]).L * w;
  }
  const field = pal[fi], horizon = pal[pal.length - 1];
  const cf = ok.hexToOklch(field), ch = ok.hexToOklch(horizon);
  const K = 0.35;                       // the field dominates ambient
  const tint = ok.oklchToHex(
    cf.L + (ch.L - cf.L) * K,
    cf.C + (ch.C - cf.C) * K,
    cf.h + shortArc(cf.h, ch.h) * K);
  const ct = ok.hexToOklch(tint);
  return { field, horizon, tint,
    meanL: sum ? lSum / sum : 0, tintH: ct.h, tintC: ct.C };
}
// Signed angular difference in (-180, 180]. Used ONLY to mix two
// MEASURED tones — never to decide an authored path.
function shortArc(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// ---- THE LIGHT COLUMN, DERIVED --------------------------------------
// EVERYTHING IS RELATIVE TO A REFERENCE SKY, which is what makes the
// identity EXACT rather than tuned: the reference derives to lift 0 /
// mL 1 / mS 1 / tintK 0 by construction.
//
// Two rules carried forward, each of which cost a shipped bug:
// VALUE IS mL's JOB ALONE (the cast carries hue and chroma only), and
// CHROMA MOVES OPPOSITE VALUE (so mS is derived FROM mL).
const COLUMN_TUNING = {
  mLCurve: 0.75, mLFloor: 0.34, mLCeil: 1.12, mSGain: 0.95,
  tintFromHue: 0.26, tintFromChroma: 1.10, tintMax: 0.42,
};
let refAmbientCache = null;
function referenceAmbient() {
  if (refAmbientCache === null) refAmbientCache = ambient(SPECS.noon);
  return refAmbientCache;
}
function columnFor(spec, refAmbient) {
  if (spec.column) return spec.column;
  const T = COLUMN_TUNING;
  const a = ambient(spec);
  const ref = refAmbient || referenceAmbient();
  const ratio = ref.meanL > 0 ? a.meanL / ref.meanL : 1;
  let mL = Math.pow(ratio, T.mLCurve);
  let lift = 0;
  if (mL > 1) { lift = Math.min(0.3, (mL - 1) * 0.8); mL = 1; }
  mL = Math.max(T.mLFloor, Math.min(T.mLCeil, mL));
  const mS = 1 + (1 - mL) * T.mSGain;
  const dH = Math.abs(shortArc(ref.tintH, a.tintH)) / 180;
  const dC = Math.abs(a.tintC - ref.tintC);
  const tintK = Math.min(T.tintMax, T.tintFromHue * dH + T.tintFromChroma * dC);
  return { lift, mL, mS,
    tint: tintK > 0.001 ? a.tint : null,
    tintK: tintK > 0.001 ? tintK : 0, derived: true };
}

// ---- MEASUREMENT -----------------------------------------------------
// The tone budget is retired as a MEASUREMENT: the palette size is
// now an input, so `entries` IS the budget and it is satisfied by
// construction. toneCount survives only to prove that — a sky that
// emits more tones than it declares entries would mean the pipeline
// invented a colour.
function toneCount(spec, height) {
  const set = new Set();
  for (const r of rowsUncached(height || SAMPLE_H, spec)) set.add(r.hex);
  return set.size;
}
function bandStats(spec, height) {
  const H2 = height || SAMPLE_H;
  const rs = rowsUncached(H2, spec);
  const hz = floorRow(H2, spec);
  // A CHECKERED ROW IS ITS OWN BAND. It carries the base colour in
  // `hex` and its partner as metadata, so a row-based walk sees nine
  // consecutive checkered rows as ONE thirteen-pixel slab and rejects
  // the sky for being coarse BECAUSE it is dithered. Measured on a
  // rolled WEAVE sky: median 13px against a 5px budget, verdict
  // RE-ROLLED, where the screen shows a one-pixel dither.
  //
  // THIS IS THE BLIND SPOT ALREADY DOCUMENTED IN THE RIPPER, which
  // says in as many words that a row-based measure "measures vertical
  // structure exactly and cannot see horizontal structure at all" and
  // refuses to merge a dithered band into a solid one sharing its
  // modal colour. Checkerboards were then added to the GENERATOR and
  // this measure was never revisited, so the tool told the truth in
  // one half and not the other. The two now agree.
  const key = (r) => r.hex;   // checkerboard retired 2026-08-25
  const runs = [];
  let total = 0, run = 0, prev = null;
  for (const r of rs) {
    if (r.y >= hz) break;
    total += r.h;
    const k = key(r);
    if (k === prev) run += r.h;
    else { if (prev !== null) runs.push(run); run = r.h; prev = k; }
  }
  if (prev !== null) runs.push(run);
  if (!runs.length) return { bands: 0, field: 0, fieldShare: 0, burstMax: 0, burstMean: 0 };
  const field = Math.max.apply(null, runs);
  const idx = runs.indexOf(field);
  const burst = runs.slice(0, idx).concat(runs.slice(idx + 1));
  const sum = burst.reduce((a, b) => a + b, 0);
  // THE MEDIAN IS THE HONEST BAND MEASURE once rhythms exist. The max
  // was written for an unaccented burst, where every band was
  // supposed to be thin; a rhythm deliberately includes thick beats,
  // and the reference is full of them — TICK's every-third band, a
  // plateau between two clusters. The law was never "no band is
  // thick", it was "the TYPICAL band is thin", and a median says that
  // where a max cannot. The max is kept as a separate, looser bound,
  // so an accent cannot quietly grow into a second field.
  const sorted = burst.slice().sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;
  return { bands: runs.length, field, fieldShare: total ? field / total : 0,
    burstMax: burst.length ? Math.max.apply(null, burst) : 0,
    burstMedian: median,
    burstMean: burst.length ? sum / burst.length : 0 };
}
function fieldShare(spec, height) { return bandStats(spec, height).fieldShare; }

// ============================================================
// THE GENERATOR — never roll a colour, roll inside a recipe.
//
// Rolling six independent numbers gives incoherent skies, because a
// sky is not two colours: it is a RELATIONSHIP between them. Three
// layers, each doing a different job.
//
// 1. THE HOUR sets the REGION. Morning, noon, golden, dusk and night
//    are not a separate system — they are neighbourhoods of the same
//    colour space. Night is low L, higher C, cool hues; noon is a
//    cool zenith and a very light horizon.
// 2. THE FAMILY sets the RELATIONSHIP. Every reference sky obeys one:
//    a wash to white, a hue shift at held chroma, a cut, a flat. The
//    family is rolled first, and the values must satisfy it — which
//    is what makes "zenith bright yellow, horizon dark purple" not a
//    possible outcome rather than an unlikely one.
// 3. THE GATES reject the rest. Legibility against the melon cast,
//    band thickness, and horizon-versus-ground contrast. A roll that
//    fails is re-rolled from a derived seed, so it stays reproducible.
// ============================================================
// CHROMA IS ROLLED AS A FRACTION OF WHAT IS ACHIEVABLE, not as an
// absolute — and this corrects something I overstated when OKLCh went
// in. A bounded chroma range IS bounded everywhere in the sense that
// matters for MEANING: 0.12 looks equally colourful at every hue.
// What is NOT uniform is what sRGB can REACH. Measured, max chroma at
// L 0.5 runs 0.085 at cyan and 0.281 at blue; at L 0.8 it runs 0.100
// at blue and 0.252 at green. So a flat range like [0.10, 0.17] is a
// fully saturated blue and a 61%-clipped yellow, and the roll comes
// out punchy at some hues and muddy at others for no visible reason.
// Measured across today's own ranges, they represented anywhere from
// 29% to 247% of the achievable maximum — NIGHT was routinely asking
// for more than twice what the screen can show.
//
// `frac` is therefore the share of the maximum at THAT lightness and
// hue, and `cap` is an absolute band so a hue that can take enormous
// chroma does not come out garish. Consistent punch, bounded taste.
//
// THE FLOOR HAS LEFT THIS TABLE (Eddie's ruling, 2026-08-20). Where
// the sky meets the ground is a COMPOSITION decision about the frame,
// not a fact about the time of day — a night sky and a noon sky sit
// above the same terrain, and the five ranges were near-identical,
// which was the giveaway. It defaults to 0.5 and stays there unless
// the author moves it.
// THE CEILINGS WERE MINE, AND THEY WERE WRONG (Eddie, 2026-08-20).
// Measured: THREE OF THE SIX skies authored from the reference crops
// sat ABOVE what the generator could roll — flat-cobalt at 0.89 of
// the achievable maximum, night-indigo at 0.85, america-violet at
// 1.05 (already clipping). The generator could not produce the skies
// we built from Out Run and Super Hang-On, which is a far better
// acceptance test than any number chosen by eye.
//
// And widening cost nothing: 500 rolls at 0.55-1.00 gave the same
// 500 generated, the same 1.01 mean attempts and the same 16.7%
// worst collision. The gates simply do not object. The only real
// effect is that the cast strengthens a little (mean tintK 0.067 ->
// 0.083), which is the sky-is-the-light coupling working as designed
// — and still gentler than DUSK's own authored column at 0.42.
//
// The ABSOLUTE cap was the tighter constraint, not the fraction:
// flat-cobalt needs 0.245 and NOON was capped at 0.19. Both raised.
// TWO CHANGES HERE, and they do different jobs (Eddie, 2026-08-21).
//
// THE ABSOLUTE CAPS decide whether a colour is REACHABLE. The Out Run
// title sky measures #4245ef — L 0.511, C 0.246, h 273, which is 89%
// of everything sRGB can show at that lightness and hue. Only NOON
// could roll it: the others were blocked by an absolute cap or by a
// hue arc that stopped short. Caps raised so it is reachable at more
// than one hour. (Written when there were five hours including a
// GOLDEN; the day is four cardinal points now.)
//
// THE CHROMA SHARE FLOOR decides how OFTEN. It sat at 0.42, so half
// of every hour's rolls came out below 68% of the gamut — muted by
// construction. Measured before: a median share of 0.66-0.71 and only
// 16% of rolls at 85%+. Raising the floor shifts the whole
// distribution rather than extending its tail, which is the
// difference between "possible" and "the game feels like this".
//
// This is the second widening, and like the first it is against a
// MEASURED TARGET rather than a preference — the reference art sits
// where our ranges did not reach.
// FOUR CARDINAL POINTS, and the structure is the point (Eddie's
// ruling, 2026-08-21). NOON and MIDNIGHT are the two EXTREMES — sun
// highest and lowest, so a flat uniform sky and a SMALL lift.
// MORNING and DUSK are the two TRANSITIONS — sun on the horizon, so
// a LARGE lift and a burning horizon.
//
// THE LIFT WAS BACKWARDS BEFORE. Noon and morning climbed 0.30-0.44
// while golden and dusk climbed 0.24-0.40 — the wrong way round. You
// barely see a gradient looking up at midday; a sunset is enormous
// contrast top to bottom. Now noon and midnight are the flat ones and
// the transitions carry the climb, which is a signature that survives
// any hue rotation — and that matters, because opening the hue arcs
// is the next thing on the list.
//
// MORNING AND DUSK ARE MIRRORS and share a sky region deliberately:
// same lightness, same lift, same chroma. What separates them is the
// SUN BEARING (opposite sides, so shadows fall the other way), a
// modest warmth skew (the day's aerosol load builds, so sunset runs
// redder than sunrise), and later the atmospheric haze on the distant
// layers. None of that lives in the sky's own colours.
// ---- HUE IS A CENTRE AND A REACH, NOT A WINDOW ----------------------
//
// Every zenith the generator could roll lay between 235 and 320 —
// blue through violet to magenta, and NOTHING else. Measured over
// 2000 rolls: ZERO warm zeniths. That was not a law, it was a sample
// bias: the arcs were generalised from a reference set of blue title
// screens, and I then defended it with a physical argument about
// atmosphere, which is reasoning backwards.
//
// The references disagree, and Eddie found them. Super Hang-On's
// America Stage 8 has a RED zenith at hue 33 fading to gold at 89;
// Stage G is redder still at 28; the ending art runs lilac 316 to
// yellow 105; Asia Stage 6 is cyan at 176. Five of six sat outside
// our arcs. So did TWO OF OUR OWN reference skies — asia-lime's
// zenith at 175 and africa-pale's at 190 — which AA1 had been
// passing by approaching from somewhere else entirely.
//
// `c` is the centre, `reach` how far a roll may travel from it, and
// `k` how strongly it clusters: hue = c +/- reach * u^k for uniform
// u, so k above 1 keeps most rolls near the centre while the tail
// still reaches the whole circle. What distinguishes an hour is now
// which hues are LIKELY, not which exist — and that only works
// because the hours were first separated on lift and structure.
//
// This is a game with exaggerated palettes (Eddie): unreal skies are
// meant to be possible.
const HOURS = {
  // Sunrise: rose and gold, cooler than sunset because the day's
  // aerosol load has not built up yet.
  MORNING: { zenith: { L: [0.44, 0.62], frac: [0.58, 0.97],
      h: { c: 350, reach: 180, k: 2.1 } },
    cap: [0.10, 0.30], lift: [0.34, 0.52] },
  // The lower bound is 0.46, not 0.50, because flat-cobalt — the Out
  // Run title sky, and the reason the FLAT family exists — measures
  // 0.47. A reference sitting just outside its own hour is the fault
  // AA1 exists to catch.
  NOON: { zenith: { L: [0.46, 0.84], frac: [0.58, 0.97],
      h: { c: 264, reach: 180, k: 2.4 } },
    cap: [0.10, 0.30], lift: [0.14, 0.28] },
  // The arc starts at 270, not 275: the Out Run title blue sits at
  // hue 273 and DUSK was reaching it in SAMPLING while its declared
  // range excluded it — the sampled check and the analytic one
  // disagreeing, which is the whole reason both exist.
  // Sunset: red and orange. America Stage 8 measures a zenith of 33.
  DUSK: { zenith: { L: [0.40, 0.58], frac: [0.58, 0.97],
      h: { c: 28, reach: 180, k: 2.1 } },
    cap: [0.12, 0.32], lift: [0.34, 0.52] },
  MIDNIGHT: { zenith: { L: [0.14, 0.26], frac: [0.56, 0.97],
      h: { c: 274, reach: 180, k: 2.6 } },
    cap: [0.06, 0.20], lift: [0.08, 0.20] },
};
// Roll a hue from a centre: clustered near it, able to reach anywhere.
// ORDERED, not rejection-sampled, so it stays one draw and stays
// deterministic.
function rollHue(R, spec) {
  if (Array.isArray(spec)) return R.span(spec);   // legacy window
  const u = R.r();
  const sign = R.r() < 0.5 ? -1 : 1;
  const d = spec.reach * Math.pow(u, spec.k || 2);
  return ((spec.c + sign * d) % 360 + 360) % 360;
}
// dL is applied on top of the hour's own lift; dC and dh are the
// family's signature move.
// A family's chroma move is a MULTIPLIER on the zenith's share, for
// the same reason: "lose about half the colour" means the same thing
// at every hue, where "lose 0.08" does not.
// `zenithMax` is the one chroma ceiling with a REASON behind it, and
// it belongs to the family rather than the hour: a zenith at the very
// top of the gamut leaves the horizon nowhere to GAIN chroma, and
// gaining chroma is SHIFT's entire signature — it is what makes the
// Asia sky walk cyan to lime without washing out. A WASH or a CUT is
// heading downward anyway and needs no headroom; a FLAT has no
// horizon at all and can sit at the gamut edge, which is exactly
// where the Out Run title sky sits.
const FAMILIES = {
  WASH:  { zenithMax: 0.95, mC: [0.30, 0.60], dh: [-14, 14],
    burstPx: [26, 40], spread: [0.8, 1.3], dither: [0, 2] },
  // A hue-shifting sky TRAVELS SIDEWAYS; washing to white is WASH's
  // job. Measured, the reference Asia sky lifts just 0.05 — and our
  // SHIFT rolls were taking the hour's 0.30-0.44, climbing almost to
  // white where no gamut is left, so only 14% of them managed the
  // chroma hold that is the family's whole signature. The LIFT is a
  // property of the RELATIONSHIP between the two stops, so a family
  // may own it; the zenith's own lightness stays the hour's business.
  SHIFT: { zenithMax: 0.80, lift: [0.03, 0.16], mC: [0.85, 1.20],
    dh: [-105, -58],
    burstPx: [28, 42], spread: [0.9, 1.4], dither: [0, 2] },
  WARM:  { zenithMax: 0.92, mC: [0.60, 1.00], dh: [30, 78],
    burstPx: [30, 46], spread: [0.8, 1.2], dither: [0, 2] },
  CUT:   { zenithMax: 0.95, lift: [0.26, 0.54], mC: [0.40, 0.75],
    dh: [-20, 20],
    burstPx: [26, 38], spread: [0.7, 1.0], dither: [0, 0] },
  FLAT:  { zenithMax: 1.00, mC: [1, 1], dh: [0, 0], fixedEntries: 1,
    burstPx: [0, 0], spread: [1, 1], dither: [0, 0] },
  // BREATH — the space between FLAT and WASH, which was empty. FLAT is
  // genuinely one colour; WASH climbs 0.30 or more in lightness. There
  // was nothing in between, so a sky that varies SUBTLY rather than
  // not at all could not be rolled: the closest zenith/horizon pair in
  // 2000 rolls measured deltaE 0.084, twelve times the collision
  // radius.
  //
  // Nothing was enforcing a MINIMUM difference — the separation came
  // from every hour's LIFT floor (0.10 at the lowest, 0.30 for most).
  // Loosening those floors would have made every family capable of
  // near-flatness and stopped them reading as themselves; a family
  // with its own tiny lift puts the behaviour where a reader looks
  // for it.
  BREATH: { zenithMax: 0.95, lift: [0.005, 0.09], mC: [0.80, 1.05],
    dh: [-10, 10],
    burstPx: [30, 70], spread: [0.9, 1.3], dither: [0, 2] },
};
// ============================================================
// THE PALETTE BUDGET — how a sky spends what it has.
//
// ENTRY COUNT AND DITHER ARE ONE DECISION, not two. The reference set
// shows two solutions to the same problem: Asia_Stage10 spends
// TWENTY-FOUR colours and dithers not at all, while America_Stage14
// spends FOUR and dithers everything, and both read as a gradient.
// Rolling them independently would produce the two incoherent
// corners — a 24-entry sky crossfading (pointless, it already has the
// steps) and a 4-entry sky not (four visible bands, not a sky).
//
// So a budget is rolled ONCE and sets both. Measured before this
// existed: ZERO of 500 generated skies had any crossfade or any
// checker, so the most distinctive quality of the references never
// appeared in a roll at all.
//
// The entry count lives here and NOWHERE ELSE. It used to sit on the
// family as well, and two authorities for one number is exactly what
// this project keeps deleting.
// (WEAVE — 'few colours, checkerboarded across the row' — retired
// with the checkerboard ruling, 2026-08-25. Its entry range folds
// into FADE's neighbourhood; the x-dimension it existed for is gone.)
const BUDGETS = {
  LADDER: { reads: 'many colours, no dither — spend the palette',
    entries: [17, 26], crossfade: [0, 0] },
  STEPPED: { reads: 'a middle course — some steps, a light fade',
    entries: [11, 17], crossfade: [0.15, 0.45] },
  FADE: { reads: 'few colours, crossfaded — spend the row-interleave',
    entries: [4, 9], crossfade: [0.7, 1] },
};
const BUDGET_NAMES = Object.keys(BUDGETS);

// ============================================================
// THE PATH — what the palette does BETWEEN its two ends.
//
// A family describes the relationship between the two ENDPOINTS. It
// says nothing about the journey, and until now there was no journey
// to describe: measured, 473 of 500 rolled skies had exactly TWO
// nodes, so every palette was a straight line in OKLCh.
//
// The references are not straight. america-violet turns around
// mid-palette (bend 0.282 away from the line, against 0.064 for the
// worst of 500 rolls) and Africa_Stage1 takes four near-invisible
// steps then jumps twelve times as far — a 53.9x step-size ratio
// where the worst roll manages 9.4x.
//
// A pin needs a REASON, or rolling one is just noise. The references
// show exactly two, and the vocabulary below names them:
//   DIRECT  the straight line — today's behaviour, unchanged
//   EASE    one interior pin off the line, so the ramp accelerates
//   JUMP    a pin PAIR straddling a discontinuity (Africa_Stage1)
//   CUT     several pins, allowed to reverse (america-violet)
//
// PURELY ADDITIVE: DIRECT is weighted heavily and produces a
// bit-identical sky to the one rolled before paths existed — the path
// rolls from its OWN stream, so the colour sequence is untouched.
const PATHS = {
  DIRECT: { reads: 'a straight line between the two ends',
    interior: [0, 0], bend: [0, 0], reverse: false, minEntries: 0 },
  // EASE and JUMP now move CHROMA AND HUE as well as lightness, and
  // that is the point rather than a garnish. Eddie, having looked at
  // five rolls he disliked: "the lightness between the entries is in
  // order (even if not linearly stepped) AND it's more the chroma and
  // hue that subtly shift."
  //
  // He is right, and the references agree. Africa_Stage1 is strictly
  // MONOTONE in lightness — its famous 54x step ratio is uneven
  // SPACING, not reversal — and asia-lime climbs L 0.82 to 0.87 while
  // its HUE travels 175 degrees to 108. The interest lives in chroma
  // and hue; lightness keeps its word.
  //
  // Until now a path could only move L, so the only tool it had was
  // the one that produces a dark bar.
  EASE: { reads: 'one pin off the line — the ramp accelerates',
    interior: [1, 1], bend: [0.03, 0.11], dC: [0.01, 0.05], dh: [3, 14],
    reverse: false, minEntries: 6 },
  JUMP: { reads: 'a pin pair straddling a hard step',
    interior: [2, 2], bend: [0.10, 0.26], dC: [0.02, 0.07], dh: [5, 20],
    reverse: false, minEntries: 8, pair: true },
  CUT: { reads: 'several pins, allowed to turn back',
    interior: [2, 3], bend: [0.12, 0.30], reverse: true, minEntries: 9 },
  // SAW — REVERSALS IN ADJACENT PAIRS, which is the shape a cut sky
  // actually has and the one CUT could not make. america-violet reads
  // i0 L.46, i3 L.84, i4 L.52, i7 L.80, i8 L.60, i11 L.96: it rises,
  // DROPS BACK in a single step, rises again, drops again. The
  // reversal is a PAIR of neighbouring entries, not a spaced pin, and
  // spacing single pins produced a lumpy ramp rather than a saw
  // (measured: the whole-palette gap to america-violet went 0.218 ->
  // 0.223, i.e. slightly worse).
  // TWO TEETH AT MOST. Three gives EIGHT nodes, which reads as
  // clutter rather than structure — and america-violet, the reference
  // cut sky, uses SIX nodes and two teeth. Measured before the cap:
  // 131 of 1000 rolls carried 6 or 8 nodes.
  //
  // `bend` is now THE STEP BETWEEN THE PINS, not the deviation of each
  // from the line. It was applied as +bend and -bend, so the actual
  // tooth was DOUBLE the number written here: a bend of 0.34 produced
  // a 0.68 drop where the reference's biggest single step is 0.38.
  // `reverse: true` IS THE DECLARATION, and SAW was missing it — it
  // carried only `saw: true`, so a check asking the table whether a
  // path reverses got the wrong answer from the path that reverses
  // most. The data has to describe itself before a rule can be
  // written against it.
  SAW: { reads: 'rises and drops back, once or twice — the cut sky',
    teeth: [1, 2], bend: [0.16, 0.40], reverse: true, minEntries: 10, saw: true },
};
const PATH_NAMES = Object.keys(PATHS);

// WHICH PATHS A FAMILY MAY DRAW, the same shape of rule as
// HOUR_FAMILIES. Measured, 25 of 131 saws landed on a BREATH sky —
// and those two contradict each other by definition: one says "vary
// as little as possible", the other says "reverse hard, twice". Even
// with a correct amplitude that pairing is incoherent, and a WASH
// should not cut either.
const FAMILY_PATHS = {
  WASH: ['DIRECT', 'DIRECT', 'EASE'],
  SHIFT: ['DIRECT', 'DIRECT', 'EASE', 'JUMP'],
  WARM: ['DIRECT', 'DIRECT', 'EASE', 'JUMP'],
  CUT: ['DIRECT', 'EASE', 'JUMP', 'CUT', 'SAW', 'SAW'],
  FLAT: ['DIRECT'],
  BREATH: ['DIRECT', 'DIRECT', 'EASE'],
};

// Which families each hour may draw. NIGHT never washes to white.
// The transitions get the dramatic families; the extremes get the
// quiet ones. FLAT belongs to noon and midnight because a flat sky is
// what an overhead or absent sun looks like.
// The transitions get the dramatic families; the extremes get the
// quiet ones. FLAT and BREATH belong to noon and midnight because a
// flat or near-flat sky is what an overhead or absent sun looks like.
//
// AND SHIFT BELONGS TO THE EXTREMES TOO, which the measurement made
// obvious. SHIFT's whole purpose is to travel SIDEWAYS in hue while
// HOLDING chroma — the Asia move, cyan to lime. Measured with SHIFT
// in every pool it held its chroma 52% of the time at NOON and 40% at
// MIDNIGHT, but 2% at MORNING and ZERO at DUSK: at a transition hour
// it cannot do the one thing it exists to do. A family that fails its
// own definition four times in five is in the wrong pool.
const HOUR_FAMILIES = {
  MORNING: ['WARM', 'WASH', 'CUT'],
  NOON: ['WASH', 'SHIFT', 'FLAT', 'BREATH'],
  DUSK: ['WARM', 'CUT', 'WASH'],
  MIDNIGHT: ['SHIFT', 'CUT', 'FLAT', 'BREATH'],
};

function fnv(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function roller(seed) {
  const rng = G.FF.mulberry32(fnv(seed));
  return {
    r: rng,
    span: (a) => a[0] + rng() * (a[1] - a[0]),
    pick: (a) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))],
  };
}

// THE ROLL IS GROUND-AWARE, which is not a repair but a constraint.
// Measured on 500 blind rolls: NIGHT failed 19% and a SNOW stage
// failed 36%, both for the same reason — the horizon and the ground
// sat at the same lightness, so the horizon stopped reading as an
// edge and the world lost its floor. Rolling blind and rejecting
// afterwards wastes the roll and, worse, biases which skies survive.
// The horizon's lightness is therefore chosen to CLEAR the ground by
// a margin, pushed toward whichever side has room. The gate stays as
// the backstop, because a constraint that is also checked is a
// constraint you can trust.
const GROUND_CLEARANCE = 0.17;    // in OKLab L
function clearGround(hL, groundL) {
  if (groundL === null) return hL;
  if (Math.abs(hL - groundL) >= GROUND_CLEARANCE) return hL;
  const up = groundL + GROUND_CLEARANCE, down = groundL - GROUND_CLEARANCE;
  const upOk = up <= 0.99, downOk = down >= 0.06;
  if (upOk && downOk) return hL >= groundL ? up : down;
  return upOk ? up : Math.max(0.06, down);
}

// One roll. Returns a spec; gates are applied by generate().
// EACH STEP ROLLS FROM ITS OWN DERIVED SEED.
//
// One shared stream would mean that changing anything changes
// everything: re-roll the colour and the distribution shifts too,
// because the numbers after it in the sequence have moved. Deriving a
// stream per step — seed|colour, seed|dist — means a step can be
// rolled alone without disturbing its neighbours, "roll everything"
// is just calling each with the same base seed, and ANY combination
// stays reproducible from one string.
//
// It is the same seam that lets colour and rhythm vary independently
// in the generator: what belongs to a decision travels with that
// decision.
function rollSky(role, seed, attempt, groundHexIn) {
  const R = roller(role + '|' + seed + '|colour|' + (attempt || 0));
  const D = roller(role + '|' + seed + '|dist');
  const H = HOURS[role] || HOURS.NOON;
  const famName = R.pick(HOUR_FAMILIES[role] || HOUR_FAMILIES.NOON);
  const F = FAMILIES[famName];
  const zL = R.span(H.zenith.L), zh = rollHue(R, H.zenith.h);
  const ok = G.FF.oklab;
  // The share of the achievable maximum, then clamped to the hour's
  // absolute band. `clippedC` with an impossible ask returns the
  // ceiling at that lightness and hue.
  const chromaAt = (L, h, frac) => {
    const max = ok ? ok.clippedC(L, 0.5, h) : 0.15;
    // THE ACHIEVABLE MAXIMUM OUTRANKS THE TASTE BAND. The lower cap
    // exists to stop a roll coming out washed out, but a very light
    // horizon near blue can only hold about 0.02 chroma — so the
    // floor of 0.08 was asking for four times what the screen could
    // show, and at the extreme 16 times. A minimum that cannot be
    // met is not a minimum; it is a request for clipping.
    const want = Math.max(H.cap[0], Math.min(H.cap[1], max * frac));
    return Math.min(max, want);
  };
  // The family is rolled BEFORE the zenith, so its headroom can shape
  // the range rather than clamp the result — clamping would pile
  // rolls up against the ceiling instead of spreading them below it.
  const fMax = F.zenithMax === undefined ? 0.95 : F.zenithMax;
  const zFrac = R.span([H.zenith.frac[0],
    Math.min(H.zenith.frac[1], fMax)]);
  const zC = chromaAt(zL, zh, zFrac);
  const hL0 = Math.min(0.99, zL + R.span(F.lift || H.lift));
  const hh = zh + R.span(F.dh);
  // THE HORIZON'S CHROMA IS EVALUATED AT THE LIGHTNESS ACTUALLY USED.
  // A first cut computed it against the PROVISIONAL lightness and
  // then let the ground-clearance pass move that lightness — and the
  // achievable maximum moves with it, so 131 of 500 rolls ended up
  // asking for chroma the screen could not show. Evaluating at the
  // final value is the only way the fraction means what it says.
  const mC = R.span(F.mC);
  const hFrac = zFrac * mC;
  // AND IT IS CLAMPED IN ABSOLUTE TERMS, not only as a fraction.
  //
  // `mC` is a share of the ACHIEVABLE MAXIMUM, and the achievable
  // maximum varies enormously with hue — about 0.108 at a cyan and
  // 0.139 a few degrees away. While every zenith was blue that never
  // mattered; with the arcs opened full-circle the two ends can sit
  // in very differently sized gamuts, so a family declaring mC 0.30
  // to 0.60 — "a WASH LOSES chroma" — could hand back a horizon
  // MORE saturated than its zenith. Measured: a NOON WASH at cyan
  // gained 0.0006, which U5a caught.
  //
  // A family that says it loses chroma must lose it in the colour,
  // not merely in the bookkeeping.
  const absCap = mC < 1 ? mC : null;
  // The budget owns the entry count and the dither together; FLAT is
  // the one family that overrides it, because one colour is what FLAT
  // MEANS rather than a way of spending a budget.
  const B = roller(role + '|' + seed + '|budget');
  const budgetName = B.pick(BUDGET_NAMES);
  const BG = BUDGETS[budgetName];
  const n = F.fixedEntries || Math.round(B.span(BG.entries));
  const xfade = F.fixedEntries ? 0 : Math.round(B.span(BG.crossfade) * 100) / 100;
  // THE RHYTHM ROLLS INDEPENDENTLY OF THE COLOUR, which is the whole
  // reason the two stages were kept from consulting each other: a
  // track can draw a hue-shifting palette and a clustered rhythm
  // without either constraining the other. EVEN is weighted in
  // deliberately — an unaccented burst is a legitimate look, not a
  // failure to choose one.
  const rhythmName = n <= 3 ? 'EVEN'
    : D.pick(['EVEN', 'EVEN', 'TICK', 'TICK', 'PULSE', 'SWELL', 'ACCENT', 'CLUSTER']);
  const rhythmW = rhythmName === 'EVEN' ? null : RHYTHMS[rhythmName].w.slice();
  // THE PATH ROLLS AFTER THE BUDGET, because it needs the entry count:
  // with four entries there is no room for three interior pins, and a
  // pin per entry is authoring the whole list rather than rolling a
  // shape. A path that will not fit falls back to DIRECT.
  const P = roller(role + '|' + seed + '|path');
  // DIRECT is weighted so the straight line stays the commonest
  // outcome — the new shapes widen the space rather than replacing it.
  const pathName = (function () {
    const pool = FAMILY_PATHS[famName] || ['DIRECT'];
    const want = P.pick(pool);
    return (PATHS[want].minEntries > n) ? 'DIRECT' : want;
  })();
  const PA = PATHS[pathName];
  // Insert the interior pins into a two-node spec. Each pin sits at
  // the value the straight line would have given, DISPLACED — so a
  // path is a deviation from the ramp rather than a fresh colour, and
  // the two ends still mean what the family said they mean.
  // THE ACHIEVABLE MAXIMUM OUTRANKS THE LINE, for a pin exactly as it
  // does for an endpoint. Moving a pin's LIGHTNESS changes how much
  // chroma is reachable at that point, and carrying the line's chroma
  // across unchanged asked for what the screen cannot show — measured,
  // 143 of 935 pinned nodes over-asked, the worst by 12.7x. This is
  // the same law as Phase 7.4's; the new code had simply walked
  // around it.
  function fitPin(nd) {
    if (!ok) return nd;
    const max = ok.clippedC(nd.L, 0.5, nd.h);
    if (nd.C > max) nd.C = max;
    return nd;
  }
  function withPath(sp) {
    if (sp.nodes.length < 2 || n < 4) return sp;
    const a = sp.nodes[0], b = sp.nodes[sp.nodes.length - 1];
    if (PA.saw) return sawPath(sp, a, b);
    const count = PA.interior[1] ? Math.round(P.span(PA.interior)) : 0;
    if (!count) return sp;
    const pins = [];
    // Spaced with jitter: uniformly random indices clump, and two
    // adjacent pins do nothing while two near one end leave most of
    // the palette straight.
    for (let k = 0; k < count; k++) {
      const slot = (k + 1) / (count + 1);
      const jitter = (P.r() - 0.5) * 0.5 / (count + 1);
      let i = Math.round((slot + jitter) * (n - 1));
      i = Math.max(1, Math.min(n - 2, i));
      pins.push(i);
    }
    pins.sort((x, y) => x - y);
    const bend = P.span(PA.bend);
    const sign = PA.reverse ? (P.r() < 0.5 ? -1 : 1) : (P.r() < 0.35 ? -1 : 1);
    const out = [a];
    for (let k = 0; k < pins.length; k++) {
      const i = pins[k];
      if (out[out.length - 1].i >= i) continue;   // never stack two pins
      const t = i / (n - 1);
      const base = { i, L: a.L + (b.L - a.L) * t, C: a.C + (b.C - a.C) * t,
        h: a.h + (b.h - a.h) * t, hueAuthored: true };
      // A JUMP is a PAIR: the first pin sits low, its neighbour high,
      // so the step between them is the discontinuity.
      const dir = PA.pair ? (k === 0 ? -1 : 1) : (k % 2 ? -sign : sign);
      base.L = Math.max(0.04, Math.min(0.98, base.L + dir * bend));
      // CHROMA AND HUE CARRY THE DEVIATION TOO. A band slightly more
      // saturated or a degree or two off-hue reads as depth; a darker
      // band reads as an interruption.
      if (PA.dC) base.C = Math.max(0, base.C + dir * P.span(PA.dC));
      if (PA.dh) base.h = base.h + dir * P.span(PA.dh);
      fitPin(base);
      out.push(base);
    }
    out.push(b);
    return Object.assign({}, sp, { nodes: out, path: pathName },
      { nodes: limitDips(out) });
  }
  // A DIP IS ALLOWED, BUT ONLY A SMALL ONE — and the same rule applies
  // to every path, with no exemptions.
  //
  // THE NUMBERS CAME FROM EDDIE'S OWN HAND. Shown rolls he disliked he
  // dragged the offending pin upward until he would pass it, and the
  // edits landed at dips of 0.031 and 0.023 against originals of 0.186
  // and 0.244 — an order of magnitude, with nothing in between. 0.04
  // is that measurement rounded up, not a number chosen by eye.
  //
  // WHY THE EXEMPTION WENT. CUT and SAW were exempt because
  // america-violet genuinely reverses, and the exemption produced
  // every single output he rejected — seven of seven. An exemption
  // whose only fruit is the thing it was meant to permit, disliked, is
  // not earning its place. They keep their identity through pin
  // PLACEMENT — adjacent pairs, several pins — rather than through
  // amplitude, and a 0.04 tooth is still a tooth.
  //
  // AND CLAMPING FLAT WAS TOO MUCH. The previous rule pressed a
  // dipping pin level with its neighbour, which he rated "between
  // inoffensive and good" — safe but dull. Allowing the dip and
  // LIMITING it keeps the interest and loses the dark bar.
  const DIP_MAX = 0.04;
  // The FINAL node is the horizon, and a darker band at the very
  // bottom reads as a bright band above a settled horizon rather than
  // as an interruption in a gradient — he accepted 0.128 there.
  // Held loosely at twice the interior tolerance, by his ruling.
  const DIP_END = DIP_MAX * 2;
  // BOTH DIRECTIONS ARE GUARDED, and this is a RETRACTION.
  //
  // I removed the descending branch as dead code, having measured 0 of
  // 1917 rolls descending — but that sample used ONE ground kit.
  // Every lift range is indeed positive, so the LIFT never descends;
  // the GROUND CLEARANCE can, because it pushes the horizon away from
  // the lit ground, and over a bright kit like snow that push is
  // DOWNWARD. Sampled across all six kits, 19 of 1680 rolls descend
  // on clean code.
  //
  // The branch was reachable; my evidence was narrow. What a dip
  // means is "against the sky's OWN direction", and a descending sky
  // rising unexpectedly is the same interruption as an ascending one
  // dropping.
  function limitDips(list) {
    if (list.length < 3) return list;
    const out = list.map((nd) => Object.assign({}, nd));
    const down = out[out.length - 1].L < out[0].L;
    for (let i = 1; i < out.length; i++) {
      const allow = (i === out.length - 1) ? DIP_END : DIP_MAX;
      const prev = out[i - 1].L;
      if (down) {
        if (out[i].L > prev + allow) { out[i].L = prev + allow; fitPin(out[i]); }
      } else if (out[i].L < prev - allow) {
        out[i].L = prev - allow;
        fitPin(out[i]);
      }
    }
    return out;
  }
  // A TOOTH is a pin ABOVE the line immediately followed by one BELOW
  // it — the rise and the drop-back, in two neighbouring entries.
  function sawPath(sp, a, b) {
    const teeth = Math.round(P.span(PA.teeth));
    // THE TOOTH IS SCALED TO THE PALETTE'S OWN RANGE. This is the fault
    // that made a rolled sky unusable rather than merely strong: the
    // bend was ABSOLUTE, so a sky whose two ends span L 0.032 — a
    // BREATH sky, near-flat by design — was given teeth dropping 0.66,
    // TWENTY TIMES its entire range. A saw on a sky that climbs 0.5 is
    // a feature; the same saw on one that climbs 0.03 is vandalism.
    //
    // A floor keeps the tooth visible on a genuinely flat sky rather
    // than vanishing, and the half is because `bend` is the step
    // BETWEEN the two pins while each is displaced from the line.
    const span = Math.abs(b.L - a.L);
    const bend = P.span(PA.bend) * Math.max(0.25, Math.min(1, span / 0.45)) / 2;
    const out = [a];
    for (let k = 0; k < teeth; k++) {
      const at = Math.round(((k + 1) / (teeth + 1)) * (n - 1));
      const hi = Math.max(1, Math.min(n - 3, at));
      const lo = hi + 1;
      if (lo > n - 2 || out[out.length - 1].i >= hi) continue;
      const line = (i) => ({ i, L: a.L + (b.L - a.L) * (i / (n - 1)),
        C: a.C + (b.C - a.C) * (i / (n - 1)),
        h: a.h + (b.h - a.h) * (i / (n - 1)), hueAuthored: true });
      // (pins are gamut-clamped below, by fitPin)
      const A2 = line(hi), B2 = line(lo);
      A2.L = Math.max(0.04, Math.min(0.98, A2.L + bend));
      B2.L = Math.max(0.04, Math.min(0.98, B2.L - bend));
      fitPin(A2); fitPin(B2);
      // A REVERTED HYPOTHESIS, recorded because the observation is
      // real even though the mechanism was not. america-violet's
      // chroma also saws, and OPPOSITE its lightness — light pins at
      // C 0.045 and 0.055, dark pins at 0.15 and 0.12 — which looked
      // like the light column's own law (chroma moves opposite value)
      // appearing inside a palette.
      //
      // Swinging chroma that way made the fit WORSE at every sample
      // size tested (0.1160 against 0.1129 at 4000 and 10000 seeds).
      // The observation stands; the mechanism does not, so it is not
      // shipped. A bend in lightness alone is what the measurement
      // supports.
      out.push(A2, B2);
    }
    out.push(b);
    return Object.assign({}, sp, { nodes: limitDips(out), path: pathName });
  }
  const mk = (hLv) => ({
    id: 'gen-' + role.toLowerCase() + '-' + fnv(seed).toString(36).slice(0, 6),
    name: role + ' / ' + famName,
    role, family: famName, generated: true,
    sun: sunFor(role),
    entries: n,
    budget: budgetName,
    crossfade: xfade,
    // THE FLOOR IS ROLLED AGAIN (Eddie, 2026-08-20), between 40% and
    // 90%. It left the HOUR table because where the sky meets the
    // ground is composition rather than time of day — that ruling
    // stands and this does not reopen it: the floor is rolled from the
    // GEOMETRY stream, alongside the burst and the rhythm, which is
    // where a composition decision belongs.
    floor: Math.round(D.span([0.40, 0.90]) * 100) / 100,
    burstPx: n === 1 ? 0 : Math.round(D.span(F.burstPx)),
    rhythm: rhythmName,
    weights: rhythmW || undefined,
    spread: Math.round(D.span(F.spread) * 100) / 100,
    dither: Math.round(D.span(F.dither)),
    bandPx: 5,
    nodes: n === 1
      ? [{ i: 0, L: zL, C: zC, h: zh }]
      : [{ i: 0, L: zL, C: zC, h: zh },
        { i: n - 1, L: hLv, h: hh,
          C: (function () {
            const want = chromaAt(hLv, hh, hFrac);
            const zC = chromaAt(zL, zh, zFrac);
            return absCap === null ? want : Math.min(want, zC * absCap);
          })() }],
  });
  // TWO PASSES, and the second is the one that matters. The clearance
  // has to be measured against the ground AS IT WILL APPEAR — the
  // terrain's own tone recoloured by THIS sky's light column — not
  // against its raw base. A first cut compared against the raw tone
  // and barely helped at night, because a night column darkens the
  // ground far below where the comparison thought it sat.
  //
  // So: roll, derive the column, look at the lit ground, and clear
  // the horizon against that. Adjusting the horizon does shift the
  // column a little in turn, but only in the second order, and the
  // gate is there to catch anything the single correction misses.
  const provisional = withPath(mk(hL0));
  // A NEAR-FLAT SKY IS EXEMPT FROM THE GROUND CLEARANCE. The clearance
  // exists so the HORIZON reads as an edge against the terrain — but
  // a BREATH sky solves that differently: it is one tone throughout,
  // and the edge comes from the contrast between that tone and the
  // ground rather than from the sky's own bottom stop. Shoving its
  // horizon 0.17 in lightness would destroy the very thing the family
  // exists to make.
  if (n === 1 || !groundHexIn || !G.FF.oklab || famName === 'BREATH') {
    return provisional;
  }
  const litG = litGround(provisional, groundHexIn);
  const gL = G.FF.oklab.hexToOklch(litG).L;
  const hL = clearGround(hL0, gL);
  return hL === hL0 ? provisional : withPath(mk(hL));
}
// DERIVED FROM ONE ANCHOR, exactly as palette.js does it — the two
// tables used to disagree (by bearing morning mirrored dusk, by sky
// lightness it mirrored golden) because nothing related them.
// ONE TABLE, ASKED FOR — not a second copy. palette.js owns the hour
// bearings; this module reads them. Two parallel tables is exactly
// how the old five drifted into disagreeing about what MORNING was,
// and writing the same derivation twice would have rebuilt the fault
// while fixing it.
function sunFor(role) {
  const T = G.FF.palette && G.FF.palette.TIMES && G.FF.palette.TIMES[role];
  return T ? ((T.sunDeg % 360) + 360) % 360 : 268;
}

// ---- THE GATES -------------------------------------------------------
// A rolled sky is judged by the same laws an authored one is. The
// melon marks are built once and cached — they are a property of the
// cast, not of the sky.
let MARKS = null;
function melonMarks() {
  if (MARKS) return MARKS;
  const sh = G.FF.shading, F = G.FF.OBJECTS;
  const out = [];
  if (sh && F) {
    for (const n of Object.keys(F)) {
      for (const sd of [1, 7, 99, 4242, 88888]) {
        const a = sh.anchorColor(n, sd);
        out.push(a);
        out.push(sh.bandColor(a, 18));
      }
    }
  }
  out.push('#00ff00');            // the sacred nameplate green
  MARKS = out;
  return out;
}
// Perceptual now: in OKLab "how different do these look" is the
// straight line between them, so the redmean approximation the old
// legibility law needed is retired.
// CALIBRATED, NOT CHOSEN. The radius has to be small: OKLab deltaE
// 0.0067 is roughly one L* step and 0.34 separates grey from mid
// green, so 0.10 is an enormous neighbourhood — at that radius the
// whole melon set covers colour space and africa-pale measured 100%
// collision, which says nothing. Swept against the authored library:
// 0.02 -> worst 5%, 0.04 -> 18%, 0.06 -> 24%, 0.10 -> 100%.
//
// 0.04 is the value: it puts the shipped worst (asia-lime, 17.8%)
// meaningfully under the ceiling while still separating the skies
// that genuinely crowd the cast from those that do not. A metric
// whose worst case is 100% is not a metric.
const COLLIDE = 0.04;
function collisionShare(spec) {
  const ok = G.FF.oklab;
  const hz = floorRow(SAMPLE_H, spec);
  const marks = melonMarks();
  let tot = 0, coll = 0;
  for (const r of rowsUncached(SAMPLE_H, spec)) {
    if (r.y >= hz) break;
    tot += r.h;
    let m = Infinity;
    for (let i = 0; i < marks.length; i++) {
      const d = ok.deltaE(r.hex, marks[i]);
      if (d < m) m = d;
    }
    if (m < COLLIDE) coll += r.h;
  }
  return tot ? coll / tot : 0;
}
const GATES = {
  // Each ceiling is the SHIPPED WORST with a little air, stated as
  // such — a gate the authored library would itself fail is a gate
  // whose tolerance gets quietly widened until it means nothing.
  collisionMax: 0.25,       // authored worst: asia-lime at 17.8%
  bandTypical: 5,           // the MEDIAN burst band — a stripe field
  bandAccent: 14,           // the thickest single beat a rhythm may
                            // strike before it reads as a second field
  groundMin: 0.10,          // authored worst: night-indigo at 0.256
};
function gateReport(spec, groundHex) {
  const b = bandStats(spec, SAMPLE_H);
  // A SPEC MAY DECLARE ITS OWN TYPICAL BAND, and the classic hours do
  // (20): they are a full-height LADDER, not a stripe field, and
  // holding them to a law written for stripe fields would be holding
  // them to something they never claimed. Exempt BY DECLARATION —
  // the same pattern the tone budget used — rather than by a hole in
  // the rule.
  const typical = spec.bandPx === undefined ? GATES.bandTypical : spec.bandPx;
  const coll = collisionShare(spec);
  const pal = paletteOf(spec);
  const horizon = pal[pal.length - 1];
  const ok = G.FF.oklab;
  const ground = groundHex || '#3a3a3a';
  const gd = ok.deltaE(horizon, litGround(spec, ground));
  return {
    collision: coll, burstMax: b.burstMax, burstMedian: b.burstMedian,
    fieldShare: b.fieldShare, groundDelta: gd,
    typical,
    pass: coll <= GATES.collisionMax
      && b.burstMedian <= typical
      && b.burstMax <= Math.max(GATES.bandAccent, typical)
      && gd >= GATES.groundMin,
  };
}
// The ground as it will actually appear under this sky — its own base
// tone, recoloured by this sky's light column.
function litGround(spec, groundHex) {
  const pal = G.FF.palette;
  if (!pal || !pal.applyColumnTo) return groundHex;
  return pal.applyColumnTo(groundHex, columnFor(spec, referenceAmbient()));
}

const ROLE_NAMES = ['MORNING', 'NOON', 'DUSK', 'MIDNIGHT'];
// 'ANY' is what the game actually does — the cup's day-walk chooses
// the hour, nobody picks it — so auditioning a roll without choosing
// the hour is the honest mirror of a race.
function roleForSeed(seed) {
  return ROLE_NAMES[fnv('role|' + seed) % ROLE_NAMES.length];
}

// RANDOMISE THE COLOUR ONLY, keeping the author's distribution.
//
// The bench's randomise button rolls a sky through THE SHIPPED ROLL —
// the same hour regions and colour families the game uses — so what
// you audition is something the generator could actually produce. A
// button with its own ranges and its own derivation rule would be a
// second authority for the same decision, and it would drift.
//
// It replaces the whole node list with the rolled pair, which is what
// "randomise the sky" means; the seed is the way back, so any roll is
// reproducible and shareable rather than merely lost.
function randomiseColour(spec, role, seed, groundHexIn) {
  const r = role === 'ANY' || !role ? roleForSeed(seed) : role;
  const rolled = generate(r, seed, groundHexIn);
  const out = Object.assign({}, spec);
  out.role = rolled.role;
  out.sun = rolled.sun;
  out.family = rolled.family;
  out.seed = seed;
  // The palette's SIZE belongs to the roll (a family chooses how many
  // entries it wants), but the burst, spread, dither, floor and
  // rhythm are the author's — a randomise of the COLOUR must not
  // silently redistribute the bands.
  out.entries = rolled.entries;
  out.nodes = rolled.nodes.map((nd) => Object.assign({}, nd));
  const n = out.entries;
  if (out.nodes.length >= 2) out.nodes[out.nodes.length - 1].i = n - 1;
  return out;
}

// RANDOMISE THE DISTRIBUTION ONLY, keeping the author's colours.
// The mirror of randomiseColour, and the reason the two stages were
// kept from consulting each other: until now every rolled sky had the
// same proportions and only its colours changed, which is why a
// contact sheet read as one sky in many colours.
function randomiseDistribution(spec, role, seed) {
  const r = role === 'ANY' || !role ? roleForSeed(seed) : role;
  const rolled = rollSky(r, seed, 0, null);
  const out = Object.assign({}, spec);
  out.burstPx = rolled.burstPx;
  out.spread = rolled.spread;
  out.dither = rolled.dither;
  out.rhythm = rolled.rhythm;
  out.floor = rolled.floor;
  if (rolled.weights) out.weights = rolled.weights.slice();
  else delete out.weights;
  delete out.field;
  // A STATED sky has explicit widths, and a rolled distribution is a
  // different way of saying the same thing — keeping both would leave
  // the explicit list silently winning.
  delete out.widths;
  out.distSeed = seed;
  return out;
}

// RANDOMISE THE BUDGET: how many colours, and how much dither. One
// decision, from its own stream, leaving the hues and the geometry
// exactly where they were.
function randomiseBudget(spec, role, seed) {
  const r = role === 'ANY' || !role ? roleForSeed(seed) : role;
  const rolled = rollSky(r, seed, 0, null);
  const out = Object.assign({}, spec);
  const prev = entriesOf(spec);
  out.entries = rolled.entries;
  out.crossfade = rolled.crossfade;
  out.budget = rolled.budget;
  // Changing the entry count must not collapse the author's nodes —
  // the same law the entries slider obeys, for the same reason.
  out.nodes = (spec.nodes || []).map(function (nd) {
    const u = nd._u === undefined ? (prev > 1 ? nd.i / (prev - 1) : 0) : nd._u;
    return Object.assign({}, nd, {
      i: out.entries > 1 ? Math.round(u * (out.entries - 1)) : 0, _u: u });
  });
  delete out.sequence;
  delete out.widths;
  return out;
}

// Roll until the gates pass. Deterministic: every attempt derives its
// own seed, and a run that never passes falls back to the hour's
// authored classic rather than shipping something that failed a law.
const MAX_ATTEMPTS = 12;
function generate(role, seed, groundHex) {
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    const spec = rollSky(role, seed, a, groundHex);
    const rep = gateReport(spec, groundHex);
    if (rep.pass) { spec.attempts = a + 1; spec.gates = rep; return spec; }
  }
  const fallback = SPECS[role.toLowerCase()] || SPECS.noon;
  return fallback;
}

// ============================================================
// GROUND KITS — the terrain keeps its OWN colours.
//
// Eddie's ruling: terrain is RECOLOURED by the light, exactly as a
// melon is, but it has its own base tones rather than deriving them
// from the sky. That is already how the pipeline works — a melon
// rolls a base from its species band, derives a shading ramp, and
// passes every tone through lit(). Terrain used the same door; it
// simply had ONE base, and that base was a pure neutral, which is the
// most cast-susceptible thing there is (measured under a lime sky:
// neutral grey dyes to 20% chroma, a saturated red only shifts from
// 63% to 54%). Give terrain chroma of its own and it stops being a
// sponge and starts being itself, tinted.
//
// TARMAC IS THE SHIPPED GREY, EXACTLY. Nothing changes appearance
// until a stage selects otherwise.
const GROUND_KITS = {
  tarmac: { id: 'tarmac', name: 'Tarmac', base: '#3a3a3a' },
  grass: { id: 'grass', name: 'Grass', L: 0.44, C: 0.070, h: 145 },
  ochre: { id: 'ochre', name: 'Ochre', L: 0.50, C: 0.075, h: 72 },
  clay: { id: 'clay', name: 'Clay', L: 0.45, C: 0.070, h: 40 },
  slate: { id: 'slate', name: 'Slate', L: 0.42, C: 0.030, h: 250 },
  snow: { id: 'snow', name: 'Snow', L: 0.74, C: 0.014, h: 240 },
};
function groundHex(kitId) {
  const k = GROUND_KITS[kitId] || GROUND_KITS.tarmac;
  if (k.base) return k.base;
  return G.FF.oklab.oklchToHex(k.L, k.C, k.h);
}

// ---- STAGE IDENTITY: sky and ground are ONE decision -----------------
// If the sky and the ground rolled independently a seed could hand
// you a lime sky over an ochre desert. The reference never does that:
// Asia is a cyan sky AND green fields; America is a violet sky AND
// ochre plains. They are one decision about a place. So a track rolls
// a STAGE, and the stage names both.
const STAGES = [
  { id: 'meadow', ground: 'grass', families: ['WASH', 'SHIFT'] },
  { id: 'plains', ground: 'ochre', families: ['WARM', 'WASH'] },
  { id: 'canyon', ground: 'clay', families: ['WARM', 'CUT'] },
  { id: 'circuit', ground: 'tarmac', families: ['WASH', 'CUT', 'FLAT'] },
  { id: 'highland', ground: 'slate', families: ['SHIFT', 'CUT'] },
  { id: 'tundra', ground: 'snow', families: ['WASH', 'SHIFT'] },
];
function stageForSeed(seed) {
  return STAGES[fnv('stage|' + seed) % STAGES.length];
}

// ---- THE LIBRARY -----------------------------------------------------
// Re-authored in the two-stage model (Eddie's ruling, 2026-08-19:
// byte-identity with the Phase 4 ladder is RETIRED, deliberately,
// rather than carrying two solvers).
const SPECS = {};
function define(spec) { SPECS[spec.id] = spec; return spec; }

// The five hours, as palettes. They keep their full-height floor and
// their authored light columns, so the world still lights exactly as
// it did; only the sky's own tones are re-derived.
define({ id: 'noon', name: 'Noon (classic)', role: 'NOON', sun: 268,
  floor: 0.92, entries: 24, field: 0.16, spread: 1.15, dither: 2, bandPx: 20,
  column: { lift: 0, mL: 1, mS: 1, tint: null, tintK: 0 },
  nodes: [{ i: 0, L: 0.55, C: 0.145, h: 258 }, { i: 23, L: 0.98, C: 0.012, h: 246 }] });
define({ id: 'blue-noon', name: 'Blue noon', role: 'NOON', sun: 268,
  floor: 0.92, entries: 24, field: 0.16, spread: 1.15, dither: 2, bandPx: 20,
  column: { lift: 0, mL: 1, mS: 1, tint: null, tintK: 0 },
  nodes: [{ i: 0, L: 0.50, C: 0.150, h: 262 }, { i: 23, L: 0.97, C: 0.014, h: 252 }] });
// The warm low-sun classic. It WAS 'golden', which was never a time
// of day; the low warm light it describes is what MORNING now is.
define({ id: 'morning', name: 'Morning (classic)', role: 'MORNING', sun: 218,
  floor: 0.92, entries: 24, field: 0.16, spread: 1.15, dither: 2, bandPx: 20,
  // MATCHES TIMES.MORNING exactly. A classic sky's authored column
  // OVERRIDES the hour table, so a pale warm tint here reintroduced
  // the very fault the hour table had just been corrected for — a
  // neutral lifted ABOVE noon while mL said 0.88.
  column: { lift: 0, mL: 0.88, mS: 1.14, tint: '#8a5f34', tintK: 0.24 },
  nodes: [{ i: 0, L: 0.44, C: 0.140, h: 264 }, { i: 23, L: 0.96, C: 0.030, h: 318 }] });
define({ id: 'dusk', name: 'Dusk (classic)', role: 'DUSK', sun: 318,
  floor: 0.92, entries: 24, field: 0.16, spread: 1.15, dither: 2, bandPx: 20,
  column: { lift: 0, mL: 0.84, mS: 1.20, tint: '#7d3c28', tintK: 0.30 },
  nodes: [{ i: 0, L: 0.38, C: 0.155, h: 288 }, { i: 23, L: 0.94, C: 0.026, h: 348 }] });
define({ id: 'midnight', name: 'Midnight (classic)', role: 'MIDNIGHT', sun: 268,
  floor: 0.92, entries: 22, field: 0.18, spread: 1.15, dither: 2, bandPx: 20,
  column: { lift: 0, mL: 0.5, mS: 1.45, tint: '#101c4e', tintK: 0.42 },
  nodes: [{ i: 0, L: 0.17, C: 0.095, h: 275 }, { i: 21, L: 0.62, C: 0.075, h: 268 }] });

// The six authored against the reference crops.
define({ id: 'flat-cobalt', name: 'Flat cobalt (Out Run title)', role: 'NOON',
  sun: 268, floor: 1, entries: 1, field: 1, spread: 1, bandPx: 4,
  nodes: [{ i: 0, L: 0.47, C: 0.245, h: 285 }] });
define({ id: 'asia-lime', name: 'Asia lime (Super Hang-On)', role: 'NOON',
  sun: 268, floor: 0.5, entries: 16, burstPx: 34, spread: 1.1, dither: 2, bandPx: 5,
  // The signature move: hue descends through green while chroma HOLDS.
  nodes: [{ i: 0, L: 0.82, C: 0.095, h: 175 }, { i: 15, L: 0.87, C: 0.155, h: 108 }] });
define({ id: 'america-violet', name: 'America violet (Super Hang-On)',
  role: 'DUSK', sun: 318, floor: 0.5, entries: 12, burstPx: 36, spread: 0.85,
  bandPx: 5,
  // Non-monotone by construction: pinned nodes make it cut and dip.
  // 0.235, not 0.250: the gamut at this lightness and hue tops out at
  // 0.239, so the old value was an OVER-ASK that clipped silently —
  // the library declaring something the generator is forbidden to
  // roll. Caught by the ceiling check, which is what a check that
  // looks at the data as well as the code is for.
  nodes: [{ i: 0, L: 0.46, C: 0.235, h: 305 }, { i: 3, L: 0.84, C: 0.045, h: 262 },
    { i: 4, L: 0.52, C: 0.150, h: 275 }, { i: 7, L: 0.80, C: 0.055, h: 258 },
    { i: 8, L: 0.60, C: 0.120, h: 268 }, { i: 11, L: 0.96, C: 0.014, h: 255 }] });
define({ id: 'hangon-violet', name: 'Violet to cream (Hang-On title)',
  role: 'DUSK', sun: 318, floor: 0.5, entries: 18, burstPx: 40, spread: 1.2,
  dither: 2, bandPx: 5,
  nodes: [{ i: 0, L: 0.52, C: 0.150, h: 292 }, { i: 17, L: 0.92, C: 0.030, h: 350 }] });
// FILED BY ITS OWN NUMBERS: zenith L 0.86 with a lift of 0.12 —
// bright and almost flat, which is NOON in the cardinal-point day.
// It sat under MORNING when morning meant "bright and blue"; morning
// now means a low sun and a big climb.
define({ id: 'africa-pale', name: 'Pale aqua (Africa)', role: 'NOON',
  sun: 218, floor: 0.5, entries: 8, burstPx: 26, spread: 1.0, bandPx: 5,
  nodes: [{ i: 0, L: 0.86, C: 0.062, h: 190 }, { i: 7, L: 0.98, C: 0.010, h: 190 }] });
define({ id: 'night-indigo', name: 'Indigo night', role: 'MIDNIGHT',
  sun: 268, floor: 0.5, entries: 12, burstPx: 32, spread: 1.1, dither: 2, bandPx: 5,
  nodes: [{ i: 0, L: 0.20, C: 0.105, h: 278 }, { i: 11, L: 0.46, C: 0.085, h: 265 }] });

const SPEC_IDS = Object.keys(SPECS);
function get(id) { return SPECS[id] || SPECS.noon; }
function byRole(role) {
  const out = [];
  for (const id of SPEC_IDS) if (SPECS[id].role === role) out.push(id);
  return out;
}
// SELECTION, orthogonal to Phase 5.1 as before: that ruling's
// guarantee is a property of the ROLE sequence and is not reopened —
// this only chooses WITHIN a role.
function skyForSeed(role, seed) {
  const pool = byRole(role);
  if (!pool.length) return SPECS.noon.id;
  return pool[fnv(String(seed) + '|' + role) % pool.length];
}

const api = {
  SPECS, SPEC_IDS, COLUMN_TUNING, HOURS, FAMILIES, HOUR_FAMILIES,
  GROUND_KITS, STAGES, GATES, ACHROMATIC_C, FLOOR_DEFAULT, SAMPLE_H,
  SHAPES, SHAPE_NAMES, applyShape, matchesShape, matchesRhythm,
  PATHS, PATH_NAMES, FAMILY_PATHS,
  RHYTHMS, RHYTHM_NAMES, applyRhythm, weightsOf, apportion,
  get, byRole, define, node, nodeHex, entriesOf, nodesOf, pinAll, fromRip,
  paletteOf, distribute, fieldOf, spreadOf,
  rows, rowsUncached, floorOf, floorRow,
  ambient, columnFor, referenceAmbient, skyForSeed,
  toneCount, fieldShare, bandStats,
  rollSky, generate, gateReport, collisionShare, melonMarks, sunFor, rollHue,
  randomiseColour, randomiseDistribution, randomiseBudget,
  BUDGETS, BUDGET_NAMES, roleForSeed, ROLE_NAMES,
  groundHex, stageForSeed, shortArc, fnv,
};
G.FF.sky = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
