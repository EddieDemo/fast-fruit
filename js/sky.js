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

// ---- BAND POLICY -----------------------------------------------------
// Two orthogonal knobs plus one switch, named as presets because
// authors think in looks, not in numbers:
//   band  — row height in pixels. 1 is a fine ladder; 3-4 gives the
//           thick plateaus the Hang-On stripe skies read as.
//   quant — the lightness rung, in hundredths of HSL L. Coarse rungs
//           collapse neighbours into plateaus.
//   quantH / quantS — hue and chroma rungs (degrees, hundredths).
//           Quantising LIGHTNESS ALONE is not enough to hold a tone
//           budget: measured, a burst with a moving hue emitted a
//           distinct tone per row at a single lightness rung, because
//           only one of the three axes was being stepped. The
//           reference hardware quantised COLOURS, not brightness, and
//           that is the difference between a small palette and a
//           small brightness ladder. 0 disables an axis (the shipped
//           fine ladder, which steps L only).
//   snap  — CUT: within a segment the colour does not move at all, so
//           the only transitions are AT stops. The America sky.
//   dither — rows of line alternation across a rung change (see
//           solveRow). 0 is off.
// A spec may name a policy and then override any single field; the
// policy is a starting point, never a cage.
const POLICIES = {
  FINE:   { band: 1, quant: 1, quantH: 0, quantS: 0, snap: false, dither: 0 },
  STRIPE: { band: 2, quant: 5, quantH: 8, quantS: 6, snap: false, dither: 0 },
  CUT:    { band: 1, quant: 1, quantH: 0, quantS: 0, snap: true,  dither: 0 },
  FLAT:   { band: 1, quant: 12, quantH: 0, quantS: 0, snap: true, dither: 0 },
};
const POLICY_KEYS = ['band', 'quant', 'quantH', 'quantS', 'snap', 'dither'];

function policyOf(spec) {
  const base = POLICIES[spec.policy] || POLICIES.FINE;
  const out = {};
  for (const k of POLICY_KEYS) out[k] = spec[k] === undefined ? base[k] : spec[k];
  return out;
}

// ---- LINE DITHER -----------------------------------------------------
// The reference crops show the transition zones ALTERNATING — pale,
// darker, pale — over several rows rather than stepping once. That is
// how the hardware faked intermediate tones out of a small palette:
// one-row alternation between two adjacent palette entries.
//
// Expressed here as ordered dithering on the RUNG's fractional part:
// a row whose exact lightness sits 30% of the way between two rungs
// takes the upper rung on 30% of rows, chosen by a fixed Bayer
// sequence so the pattern is stable frame to frame and identical on
// every device. Dither OFF is plain rounding, which is what makes
// byte-identity with the shipped ladder possible.
//
// DITHER IS A TRANSITION MECHANISM, NOT A TEXTURE. The first cut
// applied the threshold at every row, which alternated across FLAT
// FIELDS too — measured: a sky authored with a 66% plateau reported a
// 8% field, because a constant lightness that happens to sit between
// two rungs alternates forever. A plateau must be a plateau. The
// solve therefore looks at the LOCAL RATE: dither engages only where
// the exact rung is actually moving, and a flat run rounds as usual.
const BAYER8 = [0, 4, 2, 6, 1, 5, 3, 7];
const DITHER_MIN = 0.06;      // rungs per row below which a run is flat

// ---- THE FLOOR -------------------------------------------------------
// WHERE THE SKY ENDS, authored per spec (Eddie, 2026-08-19).
//
// The ramp completes at the FLOOR row and the horizon tone holds
// below it. That hold is not new — it is what the sky always did
// beneath its last band, so this is a parameter, not a mechanism.
// What IS new is that the number belongs to the SKY: how much of the
// frame a sky occupies is an art-direction decision, not a camera
// one. A ground-level sky bottoms out around mid-screen and leaves
// the lower half for the parallax land layers; an ABOVE-THE-CLOUDS
// sky declares floor 1 and fills the frame, which is the look the
// game shipped with and is kept as a variant rather than lost.
//
// The held region is not dead space: it is the backdrop the land
// layers will sit against, so the horizon tone is a composition
// decision once those arrive.
const FLOOR_DEFAULT = 0.5;
function floorOf(spec) {
  return spec.floor === undefined ? FLOOR_DEFAULT : spec.floor;
}
function floorRow(height, spec) {
  return Math.round(height * floorOf(spec));
}

// ---- STOP ANCHORING: FRACTION OR PIXELS ------------------------------
// A stop positioned as a FRACTION of the sky region moves with the
// buffer, and our buffer height is not fixed: 320x148 in landscape,
// 320x180 on a desktop, 320x693 in portrait. Measured, asia-lime's
// burst bands came out 6 px on a desktop and 24 PX IN PORTRAIT — the
// same authored sky, four times coarser, because every position was a
// fraction of a variable height. The reference hardware never had
// this problem: it was a fixed 320x224, so a 2 px stripe was a 2 px
// stripe, always.
//
// So a stop may instead declare `px`: ROWS ABOVE THE FLOOR. The burst
// is then authored in pixels and identical on every device, and the
// FIELD — a flat plateau by design — absorbs all the buffer variation
// by simply being taller. That is how the reference art is actually
// built: the burst is authored, the field is a fill.
//
// The classic five keep fractional stops, because they are a
// full-height eased sweep and the byte-identity guarantee rests on
// it. Which anchoring a stop uses is DECLARED, never inferred.
const stopCache = new WeakMap();
function resolvedStops(spec, hz) {
  let per = stopCache.get(spec);
  if (per === undefined) { per = new Map(); stopCache.set(spec, per); }
  const hit = per.get(hz);
  if (hit !== undefined) return hit;
  const out = [];
  for (const st of spec.stops) {
    const t = st.px === undefined ? st.t
      : (hz <= 0 ? 1 : 1 - st.px / hz);
    out.push({ t: t < 0 ? 0 : t > 1 ? 1 : t,
      h: st.h, s: st.s, l: st.l, curve: st.curve });
  }
  // A short buffer can drive pixel stops past each other, or past the
  // field stop above them. Clamping to monotone keeps the segment
  // walk valid; a collapsed segment simply contributes no rows, which
  // is the honest outcome of asking for more bands than there are
  // pixels.
  for (let i = 1; i < out.length; i++) {
    if (out[i].t < out[i - 1].t) out[i].t = out[i - 1].t;
  }
  per.set(hz, out);
  return out;
}

// ---- THE SOLVE -------------------------------------------------------
// t -> HSL, by segment. `curve` belongs to the segment ENDING at a
// stop (so a two-stop spec's curve is the whole sky's easing, which
// is what the legacy sweep's SKY_SQUEEZE was).
function hslAt(spec, t, snap, stops) {
  const st = stops || spec.stops;
  const n = st.length;
  if (n === 0) return { h: 0, s: 0, l: 0 };
  if (n === 1) return { h: st[0].h, s: st[0].s, l: st[0].l };
  let i = 0;
  while (i < n - 2 && t > st[i + 1].t) i++;
  const a = st[i], b = st[i + 1];
  if (snap) return { h: a.h, s: a.s, l: a.l };
  const span = b.t - a.t;
  let u = span <= 0 ? 1 : (t - a.t) / span;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const curve = b.curve === undefined ? 1 : b.curve;
  if (curve !== 1) u = Math.pow(u, curve);
  return {
    h: a.h + (b.h - a.h) * u,
    s: a.s + (b.s - a.s) * u,
    l: a.l + (b.l - a.l) * u,
  };
}

// One row: solve, clamp, quantise (with optional dither), register.
// `row` is the row index, used only by the dither sequence.
function solveRow(spec, t, row, pol, tNext, stops) {
  const p = pol || policyOf(spec);
  const c = hslAt(spec, t, p.snap, stops);
  // Hue and chroma step first; lightness is stepped last because it
  // is the axis the dither interpolates between.
  const h = p.quantH ? Math.round(c.h / p.quantH) * p.quantH : c.h;
  const s = p.quantS
    ? clamp01(Math.round(clamp01(c.s) * 100 / p.quantS) * p.quantS / 100)
    : clamp01(c.s);
  let l = clamp01(c.l);
  const q = p.quant || 1;
  const exact = l * 100 / q;
  let rung;
  let moving = false;
  if (p.dither && tNext !== undefined) {
    const cn = hslAt(spec, tNext, p.snap, stops);
    moving = Math.abs(clamp01(cn.l) * 100 / q - exact) >= DITHER_MIN;
  }
  if (moving) {
    const f = exact - Math.floor(exact);
    const thr = (BAYER8[((row / p.dither) | 0) % 8] + 0.5) / 8;
    rung = Math.floor(exact) + (f > thr ? 1 : 0);
  } else {
    rung = Math.round(exact);
  }
  l = clamp01(rung * q / 100);
  const hex = hslToHex(h, s, l);
  if (G.FF.palette && G.FF.palette.registerTone) G.FF.palette.registerTone('sky', hex);
  return hex;
}

// ---- ROWS ------------------------------------------------------------
// THE ONE OUTPUT. Pure: (height, horizonY, spec) -> [{ y, h, hex }].
// Row geometry is deliberately identical to the shipped painter's —
// bands of `band` px from the top of the buffer down to the horizon
// row, then ONE row carrying the horizon tone to the bottom of the
// buffer. A portrait window can show 35 m of vertical drop, so the
// below-horizon fill is not an edge case; it is why a seam cannot
// appear.
// THE ROW LIST IS CACHED, because the sky is PINNED by ruling: it
// does not move, so frame N's rows are provably identical to frame
// N-1's. Re-solving 167 rows every frame also allocated 167 objects
// every frame, which is GC pressure on a phone for a picture that
// cannot have changed.
//
// Keyed by IDENTITY, not by a serialisation of the spec: the bench
// mutates a working copy in place, so a value key would serve it a
// stale sky the moment a slider moved. A WeakMap on the spec object
// keeps the entry alive exactly as long as the spec is, and the
// bench's live edits bypass it via rowsUncached().
const rowsCache = new WeakMap();
function rows(height, spec) {
  const key = height;
  let per = rowsCache.get(spec);
  if (per !== undefined) {
    const hit = per.get(key);
    if (hit !== undefined) return hit;
  } else {
    per = new Map();
    rowsCache.set(spec, per);
  }
  const out = rowsUncached(height, spec);
  per.set(key, out);
  return out;
}
// The solve itself, always fresh. The bench calls this directly,
// because a spec being edited in place is the one case where the
// picture legitimately changes without the object changing.
function rowsUncached(height, spec) {
  const pol = policyOf(spec);
  const hz = floorRow(height, spec);
  const stops = resolvedStops(spec, hz);
  const out = [];
  const step = Math.max(1, pol.band | 0);
  for (let y = 0; y < hz; y += step) {
    if (y >= height) break;
    const t = hz <= 0 ? 1 : Math.min(1, y / hz);
    const tN = hz <= 0 ? 1 : Math.min(1, (y + step) / hz);
    const h = Math.min(step, height - y, hz - y);
    if (h <= 0) continue;
    out.push({ y, h, hex: solveRow(spec, t, y, pol, tN, stops) });
  }
  const base = Math.max(0, hz);
  if (base < height) {
    out.push({ y: base, h: height - base,
      hex: solveRow(spec, 1, base, pol, undefined, stops) });
  }
  return out;
}

// ---- AUTHORING HELPERS ----------------------------------------------
// Stops are canonically {t, h, s, l}; authors write hex. `stop()` is
// the door. An explicit `h` override lets an author declare an
// unwrapped hue path that the hex alone could not carry.
function stop(t, hex, opts) {
  const c = hexToHsl(hex);
  const o = opts || {};
  return {
    t,
    h: o.h === undefined ? c.h : o.h,
    s: o.s === undefined ? c.s : o.s,
    l: o.l === undefined ? c.l : o.l,
    curve: o.curve,
  };
}
// A stop anchored in PIXEL ROWS ABOVE THE FLOOR. px 0 is the floor
// itself; px 30 is thirty rows above it. Band thickness authored this
// way is identical on every device, because it never consults the
// buffer height.
function stopPx(px, hex, opts) {
  const st = stop(0, hex, opts);
  delete st.t;
  st.px = px;
  return st;
}

// THE LEGACY BRIDGE. Phase 4's sweep re-expressed as a two-stop spec.
// The endpoint is computed in HSL and stored UNQUANTISED — round-
// tripping it through a hex would lose the precision the byte-identity
// check depends on, and would silently re-introduce the clamping the
// original applied AFTER interpolation rather than at the endpoint.
function legacySpec(id, sky, extra) {
  const c = hexToHsl(sky.base);
  return Object.assign({
    id,
    // The shipped floor, kept EXACTLY: the classic hours are a
    // full-height eased sweep and the byte-identity guarantee rests
    // on their geometry not moving. They are also, now, the
    // above-the-clouds variants.
    floor: 0.92,
    bandPx: 20,
    stops: [
      { t: 0, h: c.h, s: c.s, l: c.l },
      { t: 1, h: c.h + sky.turn, s: c.s - sky.fade / 100,
        l: c.l + sky.lift / 100, curve: 2.1 },
    ],
    policy: 'FINE',
  }, extra || {});
}

// ---- AMBIENT: WHAT THIS SKY DOES TO THE WORLD ------------------------
// The crops make this derivation simpler than an integral over a ramp
// would be. A period sky has two constituents, and they do different
// jobs in the lighting:
//   FIELD   — the plateau, most of the sky's area. This is the
//             ambient fill: the hue and chroma everything in shadow
//             sits in.
//   HORIZON — the burst end, the bright band above the ground. This
//             is the bounce: the warm (or lime, or violet) cast that
//             comes back UP off the world.
// The tint mixes them field-dominant. Value is deliberately NOT taken
// from this mix — see columnFor().
// The sampling window the derivation measures in. Fixed, so a sky's
// ambient is a property of the SKY and not of whatever buffer height
// happened to be on screen — two devices must light the world the
// same way.
// The sampling window is a fixed HEIGHT so that a sky lights the world
// the same way on every device — but the floor within it is the
// SPEC's own, or an above-the-clouds sky and a half-height sky with
// identical stops would light the world differently for no reason.
const SAMPLE_H = 180;

function ambient(spec, sampleRows) {
  // BELOW-HORIZON ROWS ARE EXCLUDED, and this is not a detail: that
  // fill is ONE row carrying the horizon tone down the rest of the
  // buffer, so by area it outweighs any real band. Including it made
  // every legacy hour report a WHITE field — the ladder's near-white
  // endpoint, stretched — and the whole cast collapsed to nothing.
  // It is a continuation of the horizon, not a constituent of the sky.
  // rowsUncached, not rows: ambient runs once per sky per palette
  // version (columnFor is memoised above it), so the cache buys
  // nothing here — and a spec being EDITED IN PLACE, which is exactly
  // what the bench does, would otherwise be measured from a stale
  // row list. Correctness over a micro-optimisation that was not
  // being paid for anyway.
  const sampleHz = floorRow(SAMPLE_H, spec);
  const rs = (sampleRows || rowsUncached(SAMPLE_H, spec))
    .filter((r) => r.y < sampleHz);
  // FIELD = the tone occupying the most rows. On a field-plus-burst
  // sky that is the plateau by a wide margin; on a continuous ladder
  // it degrades gracefully to the most-repeated rung.
  const area = new Map();
  let wSum = 0, lSum = 0;
  for (const r of rs) {
    area.set(r.hex, (area.get(r.hex) || 0) + r.h);
    const c = hexToHsl(r.hex);
    lSum += c.l * r.h; wSum += r.h;
  }
  let field = rs.length ? rs[0].hex : '#000000', best = -1;
  for (const [hex, a] of area) if (a > best) { best = a; field = hex; }
  const horizon = rs.length ? rs[rs.length - 1].hex : field;
  const cf = hexToHsl(field), ch = hexToHsl(horizon);
  const K = 0.35;                       // the field dominates ambient
  const tint = hslToHex(
    cf.h + shortArc(cf.h, ch.h) * K,
    clamp01(cf.s + (ch.s - cf.s) * K),
    clamp01(cf.l + (ch.l - cf.l) * K));
  const ct = hexToHsl(tint);
  return {
    field, horizon, tint,
    meanL: wSum ? lSum / wSum : 0,
    tintH: ct.h, tintS: ct.s,
  };
}
// Angular difference, signed, in (-180, 180]. Used ONLY to mix two
// measured tones — never to decide an authored path.
function shortArc(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// ---- THE LIGHT COLUMN, DERIVED --------------------------------------
// Outdoors the sky IS the light, so a sky and a light column are two
// tellings of one fact. Phase 5 authored them side by side and kept
// them in sync by hand, which is the same "moving target" problem the
// sky's lit() exemption removed.
//
// EVERYTHING HERE IS RELATIVE TO A REFERENCE SKY. That is not a
// convenience: it is what makes the identity EXACT rather than tuned.
// The reference sky derives to lift 0 / mL 1 / mS 1 / tintK 0 — the
// literal identity column — by construction, so the declaration
// cannot drift from what the fast path does. (Phase 5.0b's first
// NOON declared moves the identity short-circuit never applied; this
// shape makes that class of lie impossible.)
//
// TWO RULES CARRIED FORWARD FROM THE COLUMN MODEL, both of which cost
// a shipped bug to learn:
//   * VALUE IS mL's JOB ALONE. The ambient supplies hue and chroma;
//     it must never drag luminance, or a warm sky comes out brighter
//     than noon (caught by the ordering check, twice).
//   * CHROMA MOVES OPPOSITE VALUE. Strong light washes colour out;
//     shadow gains chroma. So mS is derived FROM mL, not measured.
const COLUMN_TUNING = {
  mLCurve: 0.75,     // how sharply a darker sky darkens the world
  mLFloor: 0.34,
  mLCeil: 1.12,
  mSGain: 0.95,      // chroma gained per unit of value lost
  tintFromHue: 0.26, // cast strength per half-turn of hue difference
  tintFromSat: 0.40, // cast strength per unit of chroma difference
  tintMax: 0.42,
};

// The reference ambient is a CONSTANT — the same eleven-tone solve
// over the same spec, every time. Recomputing it inside the function
// that needs it was measured at half of columnFor's cost (497ms vs
// 256ms per 2000 calls) for no information gained.
let refAmbientCache = null;
function referenceAmbient() {
  if (refAmbientCache === null) refAmbientCache = ambient(SPECS.noon);
  return refAmbientCache;
}

function columnFor(spec, refAmbient) {
  // An explicitly authored column always wins: the five shipped hours
  // carry theirs, so nothing that exists today changes appearance
  // when this lands. Migrating them to the derivation is Eddie's
  // ruling to make against a side-by-side, not mine to assume.
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
  const dS = Math.abs(a.tintS - ref.tintS);
  const tintK = Math.min(T.tintMax, T.tintFromHue * dH + T.tintFromSat * dS);
  return {
    lift, mL, mS,
    tint: tintK > 0.001 ? a.tint : null,
    tintK: tintK > 0.001 ? tintK : 0,
    derived: true,
  };
}

// ---- THE LIBRARY -----------------------------------------------------
// Authored specs, not a generator. The reference look comes from
// somebody CHOOSING those stops; a free generator's median output is
// mud. Variety comes from a wide library plus bounded seeded jitter
// (see skyForSeed), which is art direction with a random seat, not
// randomness with an art budget.
//
// `role` is the hour a sky belongs to. Phase 5.1's selection walks
// ROLES (so a cup still walks through the day, with its proven
// no-repeat guarantee intact) and the seed then picks a sky WITHIN
// the role. The two axes are orthogonal and neither knows about the
// other.
const SPECS = {};
function define(spec) { SPECS[spec.id] = spec; return spec; }

// --- the five shipped hours, byte-identical to Phase 4 ---
// Their columns are the hand-tuned ones, carried verbatim.
define(legacySpec('noon', { base: '#2f6bd8', lift: 60, fade: 74, turn: 12 },
  { name: 'Noon (classic)', role: 'NOON', budget: 130, sun: 268,
    column: { lift: 0, mL: 1, mS: 1, tint: null, tintK: 0 } }));
define(legacySpec('morning', { base: '#2a5fc0', lift: 58, fade: 70, turn: 22 },
  { name: 'Morning (classic)', role: 'MORNING', budget: 130, sun: 236,
    column: { lift: 0.02, mL: 0.97, mS: 1.02, tint: '#c9b48c', tintK: 0.12 } }));
define(legacySpec('golden', { base: '#1f4f9e', lift: 62, fade: 66, turn: 58 },
  { name: 'Golden (classic)', role: 'GOLDEN', budget: 130, sun: 292,
    column: { lift: 0, mL: 0.88, mS: 1.14, tint: '#b8763a', tintK: 0.26 } }));
define(legacySpec('dusk', { base: '#2a2f86', lift: 56, fade: 58, turn: 72 },
  { name: 'Dusk (classic)', role: 'DUSK', budget: 130, sun: 300,
    column: { lift: 0, mL: 0.70, mS: 1.30, tint: '#5b3466', tintK: 0.34 } }));
define(legacySpec('night', { base: '#0d1442', lift: 34, fade: 44, turn: 10 },
  { name: 'Night (classic)', role: 'NIGHT', budget: 130, sun: 262,
    column: { lift: 0, mL: 0.5, mS: 1.45, tint: '#101c4e', tintK: 0.42 } }));

// --- authored against the reference crops ---
// Every one of these is FIELD + BURST: a long plateau, then the whole
// journey in the bottom third. That shape is the period read.

// 1. The Out Run title sky: one colour, clouds on top (clouds are
//    Phase 4.1's parallax layer, deliberately not conflated here).
define({
  id: 'flat-cobalt', name: 'Flat cobalt (Out Run title)', role: 'NOON',
  // FLOOR 1: the reference fills the frame, and a flat sky has no
  // burst to bottom out anyway. This is the ABOVE-THE-CLOUDS case —
  // the look the game shipped with, kept as a variant.
  policy: 'FLAT', sun: 268, budget: 2, floor: 1, bandPx: 4,
  stops: [stop(0, '#4438e0'), stop(1, '#4438e0')],
});

// 2. Super Hang-On, Asia: cyan field walking to yellow-green at FULL
//    saturation. The hue descends through green (175 -> 78); writing
//    438 would have climbed the other way through purple, which is
//    the ambiguity the unwrapped-hue rule retires.
define({
  id: 'asia-lime', name: 'Asia lime (Super Hang-On)', role: 'NOON',
  policy: 'STRIPE', band: 1, quant: 4, dither: 2, sun: 272, budget: 22,
  bandPx: 4,
  stops: [
    // The field's two stops are the SAME tone — that is what makes a
    // plateau a plateau. Two near-neighbours here would draw a slow
    // ladder across the top and lose the shape entirely.
    //
    // The field stop is FRACTIONAL (it just has to reach the top);
    // every burst stop is PIXEL-anchored, so the burst is the same
    // thickness on a desktop and on a portrait phone.
    stop(0, '#6fdcc0'),
    stopPx(30, '#6fdcc0'),
    stopPx(18, '#a8dc84', { h: 96, curve: 1.3 }),
    stopPx(8, '#c6df66', { h: 80 }),
    stopPx(0, '#d2e34a', { h: 66 }),
  ],
});

// 3. Super Hang-On, America: a violet field CUT into pale blue and
//    white. Non-monotone in value and abrupt at the boundaries —
//    two things a single eased segment cannot do.
define({
  id: 'america-violet', name: 'America violet (Super Hang-On)',
  role: 'DUSK', policy: 'CUT', quant: 3, sun: 296, budget: 14,
  bandPx: 4,
  stops: [
    // Under CUT a segment does not interpolate, so BAND THICKNESS IS
    // STOP SPACING. Three-pixel spacing therefore gives three-pixel
    // bands, on every device — which is the whole reason these are
    // pixel-anchored. The first cut spaced them by fraction and drew
    // 10 px bands on a desktop and far worse in portrait.
    stop(0, '#7a1ce8'),
    stopPx(33, '#7a1ce8'),
    stopPx(30, '#c3d6f2'),   // the pale band CUTS IN, bright, at once
    stopPx(27, '#4a52c8'),   // and back DOWN — the crop's dark interleave
    stopPx(24, '#9fb6ea'),
    stopPx(21, '#5f74d6'),   // a second dip: the banding is the subject
    stopPx(18, '#a8bdec'),
    stopPx(15, '#6b7edb'),
    stopPx(12, '#c3d6f2'),
    stopPx(9, '#8a9ce4'),
    stopPx(6, '#d7e4f5'),
    stopPx(3, '#dfeaf6'),
    stopPx(0, '#eef4f8'),
  ],
});

// 4. The Super Hang-On title sky: violet -> pink -> cream, the
//    smoothest of the set, and the one that most resembles what we
//    already ship — kept as the bridge between the two families.
define({
  id: 'hangon-violet', name: 'Violet to cream (Hang-On title)',
  role: 'GOLDEN', policy: 'STRIPE', band: 1, quant: 4, dither: 2,
  sun: 288, budget: 24, bandPx: 4,
  stops: [
    stop(0, '#6f62d6'),
    stopPx(32, '#6f62d6'),
    stopPx(27, '#7d6dd7'),
    stopPx(22, '#8d7cd8'),
    stopPx(16, '#a58cd8', { curve: 1.2 }),
    stopPx(12, '#b79ed9'),
    stopPx(9, '#d4bcdd'),
    stopPx(4, '#e6d2e0'),
    stopPx(0, '#efe0e4', { h: 348 }),
  ],
});

// 5. Africa: a pale aqua field with white stripes near the ground —
//    four to six tones for the whole sky. The tone budget is the
//    discipline that produces this look; a fine ladder cannot.
define({
  id: 'africa-pale', name: 'Pale aqua (Africa)', role: 'MORNING',
  policy: 'STRIPE', band: 1, quant: 3, sun: 244, budget: 14, bandPx: 4,
  stops: [
    stop(0, '#95e5e2'),
    stopPx(22, '#95e5e2'),
    stopPx(17, '#a4e8e5'),
    stopPx(13, '#b5ebe8'),
    stopPx(9, '#c6f0ec'),
    stopPx(6, '#d6f4f0'),
    stopPx(3, '#e4f8f4'),
    stopPx(0, '#f0fbf8'),
  ],
});

// 6. A night sky in the same grammar: deep indigo field, a thin cool
//    lift at the horizon rather than a bright burst.
define({
  id: 'night-indigo', name: 'Indigo night', role: 'NIGHT',
  policy: 'STRIPE', band: 1, quant: 4, dither: 2, sun: 262, budget: 18,
  bandPx: 4,
  stops: [
    stop(0, '#101a4a'),
    stopPx(28, '#101a4a'),
    stopPx(18, '#1a2a5e'),
    stopPx(10, '#243a72'),
    stopPx(4, '#324a83'),
    stopPx(0, '#3f5c94'),
  ],
});

const SPEC_IDS = Object.keys(SPECS);
function get(id) { return SPECS[id] || SPECS.noon; }
function byRole(role) {
  const out = [];
  for (const id of SPEC_IDS) if (SPECS[id].role === role) out.push(id);
  return out;
}

// ---- SELECTION -------------------------------------------------------
// Orthogonal to Phase 5.1, deliberately. That ruling's guarantee — a
// cup walks through the day and consecutive legs never repeat an hour
// — is a property of the ROLE sequence, and it survives untouched
// because this only chooses WITHIN a role. A one-line call site
// change, and the proven half of the mechanism is not reopened.
function skyForSeed(role, seed) {
  const pool = byRole(role);
  if (!pool.length) return SPECS.noon.id;
  let h = 2166136261 >>> 0;
  const str = String(seed) + '|' + role;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return pool[h % pool.length];
}

// ---- MEASUREMENT (for the bench and the suites) ----------------------
// The tone count is the period discipline made countable. The crops
// run 4-20 tones for a whole sky; Phase 4 spent ~115, justified by
// "the reference hardware spent much of its palette on sky" — true,
// but that was much of SIXTY-FOUR. The budget is a law with a check,
// not a preference.
function toneCount(spec, height) {
  const rs = rowsUncached(height || SAMPLE_H, spec);
  const set = new Set();
  for (const r of rs) set.add(r.hex);
  return set.size;
}
// The largest run of identical rows, as a fraction of the sky: the
// field-plus-burst shape made measurable.
function fieldShare(spec, height) {
  return bandStats(spec, height).fieldShare;
}

// ---- BAND THICKNESS: THE OTHER PERIOD DISCIPLINE ---------------------
// The reference burst runs 1-3 px. Measured against it, the first
// authored library ran 3-5x too coarse — america-violet at a 9 px
// mean, africa-pale at 9.3 — and nothing in the suite noticed,
// because thickness had no name, no measure and no gate: it was an
// implicit product of stop spacing, floor and buffer height. This
// gives it all three, exactly as the tone budget did.
//
// The FIELD plateau is excluded from the burst figures by
// construction (it is the single longest run), the same exemption
// F3f already grants the zenith: a plateau is supposed to be broad.
function bandStats(spec, height) {
  const rs = rowsUncached(height || SAMPLE_H, spec);
  const hz = floorRow(height || SAMPLE_H, spec);
  const runs = [];
  let total = 0, run = 0, prev = null;
  for (const r of rs) {
    if (r.y >= hz) break;            // the held fill is not a band
    total += r.h;
    if (r.hex === prev) run += r.h;
    else { if (prev !== null) runs.push(run); run = r.h; prev = r.hex; }
  }
  if (prev !== null) runs.push(run);
  if (!runs.length) return { bands: 0, field: 0, fieldShare: 0, burstMax: 0, burstMean: 0 };
  const field = Math.max.apply(null, runs);
  const idx = runs.indexOf(field);
  const burst = runs.slice(0, idx).concat(runs.slice(idx + 1));
  const sum = burst.reduce((a, b) => a + b, 0);
  return {
    bands: runs.length,
    field,
    fieldShare: total ? field / total : 0,
    burstMax: burst.length ? Math.max.apply(null, burst) : 0,
    burstMean: burst.length ? sum / burst.length : 0,
  };
}

const api = {
  SPECS, SPEC_IDS, POLICIES, COLUMN_TUNING,
  get, byRole, define, stop, stopPx, legacySpec, policyOf,
  rows, rowsUncached, solveRow, hslAt, ambient, columnFor, skyForSeed,
  toneCount, fieldShare, bandStats, floorOf, floorRow, resolvedStops,
  FLOOR_DEFAULT, SAMPLE_H, hexToHsl, hslToHex, shortArc,
};

G.FF.sky = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
