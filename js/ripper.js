// ============================================================
// BAND RIPPER — recover a sky's SOURCE band structure from a
// screenshot.
//
// WHAT IT IS FOR. "Does our sky look like Super Hang-On" is a
// judgement; "does our band list match the measured one" is a number.
// The ripper turns a reference crop into a TARGET — a list of
// (colour, thickness) pairs at source resolution — so the question
// can be answered rather than argued.
//
// WHAT IT DOES NOT PROMISE. It cannot reproduce the screenshot
// pixel-for-pixel, and should not try: a scaled, compressed capture
// contains rows that are not sky colours at all but blends of two
// bands the hardware never drew. Measured on Eddie's Super Hang-On
// crop, three of 74 runs were ZERO source pixels tall — those are
// ringing, not bands. Reproducing them would mean reproducing the
// scaler. So the goal is to reconstruct THE SOURCE FRAME, and the
// honest score is the RESIDUAL: how much of the screenshot the
// reconstruction fails to explain.
//
// THE SEAM. This module never touches a canvas. The bench extracts
// pixels and hands over per-row samples; everything here is pure
// arithmetic on those samples, so the suite can feed it synthetic
// data and check the analysis without a browser.
//
// Node-safe.
// ============================================================
(function () {
'use strict';

const G = (typeof window !== 'undefined' ? window : global);
G.FF = G.FF || {};

function toHex(r, g, b) {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)];
}
const chanMax = (a, b) => Math.max(Math.abs(a[0] - b[0]),
  Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

// ---- 1. ROWS INTO BANDS ---------------------------------------------
// A row is described by its MODAL colour across the sampled width and
// how much of that width agreed. Sampling one column was the first
// approach and it is fragile: measured on the same crop, a single
// column found 74 bands where the modal-across-width found 48, the
// difference being mountains and HUD intruding on that one column.
// The AGREEMENT figure is kept because it is the signal for exactly
// that — a row where the mode wins only 40% of the width is a row
// with something in front of it.
// WHAT `agree` MUST MEAN. The caller supplies, per row, the modal
// colour across the sampled width and the fraction of that width
// which agreed WITHIN A TOLERANCE — not the fraction that matched
// exactly. In a JPEG no two pixels in a row are identical, so exact
// agreement is near zero everywhere and a threshold on it rejects the
// entire image. (It did: the first run of this against the real crop
// returned ZERO bands.) Tolerant agreement is the measurement that
// actually distinguishes "clear sky" from "something in front of it".
//
// A ROW MAY ALSO BE DITHERED, and that is NOT occlusion. The caller
// may supply `second` and `split` — the runner-up colour and the
// modal colour's share — and if it does, a two-colour row with a
// near-even split is recorded as a DITHER rather than thrown away.
// Without this the ripper silently destroyed real structure: taking
// the modal colour of a 50/50 checkerboard collapses it to whichever
// colour wins a coin toss, and two of eight reference captures were
// transcribed as flat bands and reported EXACT. The signature was in
// the tool's own output the whole time — those two files, and only
// those two, printed an agreement of exactly 0.50.
function bandsFrom(rows, opts) {
  const o = opts || {};
  const tol = o.rowTol === undefined ? 6 : o.rowTol;
  const minAgree = o.minAgree === undefined ? 0.5 : o.minAgree;
  const out = [];
  let prev = null;
  let occluded = 0;
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y];
    // AN OCCLUDED ROW IS ABSORBED, NOT DROPPED. A row where the mode
    // wins only a fraction of the width has something in front of it —
    // a HUD box, a mountain — but the SKY is still there behind it, so
    // the row still occupies vertical space. Dropping it silently
    // shrank the sky: measured on the real crop, 301 of 1400 rows sat
    // under the HUD and the rip reported a 154 px total where 1400
    // rows at scale 7 must be 200. Geometry is not optional; the row
    // extends the current band and is COUNTED so the caller knows how
    // much was inferred rather than seen.
    // A DITHERED ROW IS DATA, NOT DAMAGE. Two colours at a roughly
    // even split is a hardware dither; the row is kept, both colours
    // are recorded, and it is never mistaken for a HUD box.
    const dithered = r.second && r.split !== undefined
      && r.split >= 0.35 && r.split <= 0.65;
    if (!dithered && r.agree !== undefined && r.agree < minAgree) {
      occluded++;
      if (out.length) { out[out.length - 1].y1 = y; out[out.length - 1].occluded =
        (out[out.length - 1].occluded || 0) + 1; }
      continue;
    }
    const c = rgb(r.hex);
    // A dithered row is its own kind of band: it must not merge into
    // a solid neighbour that happens to share its modal colour.
    const key = dithered ? r.hex + '/' + r.second : r.hex;
    const startNew = prev === null || chanMax(c, prev) > tol
      || key !== (out.length ? out[out.length - 1].key : null);
    if (startNew) {
      out.push({ y0: y, y1: y, rows: [r.hex], key,
        dithered: !!dithered, second: dithered ? r.second : undefined,
        split: dithered ? r.split : undefined,
        agree: r.agree === undefined ? 1 : r.agree });
      prev = c;
    } else {
      const b = out[out.length - 1];
      b.y1 = y;
      b.rows.push(r.hex);
      if (r.agree !== undefined) b.agree = Math.min(b.agree, r.agree);
    }
  }
  // EACH BAND'S COLOUR IS THE MODAL COLOUR OF ITS INTERIOR ROWS. The
  // first and last rows are the ones contaminated by the boundary
  // blend, so on any band tall enough to spare them they are dropped
  // before the vote.
  //
  // HONEST NOTE ON HOW MUCH THIS EARNS: taking the MODE already
  // survives edge contamination in most cases, because the
  // contaminated rows are outvoted — a mutation removing this line
  // passed the suite, and rather than manufacture a contrived case to
  // justify it I am recording that it is a REFINEMENT, not a
  // load-bearing rule. It matters on short bands, where one
  // contaminated row of three can win the vote.
  out.occluded = occluded;
  for (const b of out) {
    const rs = b.rows.length > 2 ? b.rows.slice(1, -1) : b.rows;
    const tally = new Map();
    for (const h of rs) tally.set(h, (tally.get(h) || 0) + 1);
    let best = rs[0], n = -1;
    for (const [h, c] of tally) if (c > n) { n = c; best = h; }
    b.hex = best;
    b.px = b.y1 - b.y0 + 1;
  }
  return out;
}

// ---- 2. THE SCALE ----------------------------------------------------
// THE MODE, NOT THE THINNEST. The thinnest run latches onto an
// anti-aliasing sliver — measured, three runs on the reference crop
// were zero source pixels tall. The mode is overwhelmingly robust
// instead: 56 of 74 runs on that crop were exactly one source pixel.
//
// A GCD of the confident runs is computed alongside as a cross-check,
// and BOTH are reported. When they disagree that is information about
// the capture, not something to resolve silently.
function inferScale(bands) {
  const tally = new Map();
  for (const b of bands) tally.set(b.px, (tally.get(b.px) || 0) + 1);
  let mode = 1, n = -1;
  for (const [px, c] of tally) if (c > n || (c === n && px < mode)) { n = c; mode = px; }
  const gcd2 = (a, b) => (b ? gcd2(b, a % b) : a);
  let g = 0;
  for (const b of bands) if (b.px >= mode) g = gcd2(g, b.px);
  g = g || 1;
  // A GCD OF 1 AGAINST A MODE ABOVE 1 MEANS A FRACTIONAL SCALE
  // UPSTREAM, and that is a fact about the capture rather than a
  // fault in the rip. Worked example: a 480x360 YouTube thumbnail of
  // arcade Super Hang-On is 320x224 at 1.5x, and a retina screengrab
  // of it is 3x. The runs then land on 2, 3 and 4 rows and no common
  // divisor exists — the mode is still right, but every width is a
  // rounding of something fractional and the caller deserves to know.
  //
  // The first version reported this quietly and coloured a 43% mode
  // share GREEN. A confidence figure that flatters weak evidence is
  // worse than none.
  const fractional = mode > 1 && g === 1;
  const share = n / bands.length;
  // A SCALE OF 1 CANNOT BE VERIFIED, and calling it confident was the
  // same miss as the gcd one, a notch further down. An integer
  // inference cannot represent 1.5, so a 480x360 capture of a 320x224
  // arcade frame reports 1 — and every width it then hands back is in
  // SCREENSHOT pixels rather than source pixels. Measured on the
  // Europe stage: a reported 182 px total is really ~121 arcade px,
  // and a 119 px field is really ~79. Everything 1.5x too large, shown
  // in green.
  //
  // A fractional scale BELOW 2 slipped past the gcd test entirely,
  // because that test only fires when the mode is above 1. Scale 1 is
  // therefore reported as unverifiable rather than confirmed: it may
  // genuinely be unscaled, or it may be any fraction under 2, and
  // nothing in the run lengths can tell the two apart.
  const unverifiable = mode === 1;
  // AND A MODE ABOVE 1 IS ITSELF AMBIGUOUS. A capture upscaled 2x
  // from 1-pixel bands and a NATIVE capture whose artist simply drew
  // 2-pixel bands produce IDENTICAL run lengths — nothing in the data
  // can tell them apart. Measured on Africa_Stage1, a 1:1 emulator
  // grab: every run is even (84,2,2,2,2,4,4,4,6,6,12), the mode reads
  // 2, and dividing by it halved a sky that was never scaled.
  //
  // So an unconfirmed scale is NOT APPLIED. The caller may set it
  // explicitly; absent that, dividing by a number we cannot verify
  // silently rewrites the artist's work.
  const ambiguous = mode > 1 && g === mode;
  return { mode, modeShare: share, gcd: g, fractional, unverifiable, ambiguous,
    confident: share >= 0.6 && !fractional && !unverifiable && !ambiguous,
    note: ambiguous
      ? 'mode ' + mode + 'x with gcd ' + g + ' — this is EITHER a ' + mode
        + 'x capture OR native art drawn in ' + mode + '-pixel bands, and '
        + 'nothing in the run lengths can tell them apart. Not applied; '
        + 'set the scale yourself if you know.'
      : (fractional
      ? 'fractional scale upstream — widths are approximate'
      : (unverifiable
        ? 'scale 1 cannot be verified — either unscaled, or a fraction '
          + 'under 2x that no run length can reveal. Widths are in '
          + 'SCREENSHOT pixels; divide by the true scale yourself.'
        : (share < 0.6 ? 'weak mode — the scale is a guess' : ''))) };
}

// ---- 3. CLUSTERING ---------------------------------------------------
// Straight off a jpg a sky yields dozens of near-identical variants of
// each true colour. Clustering collapses them — but the tolerance is
// THE judgement call in the whole process: too tight and noise
// survives, too loose and real bands merge. It is exposed, and the
// entry count moves with it so the choice is visible rather than
// blind.
function cluster(bands, tol) {
  const ok = G.FF.oklab;
  const reps = [];
  const assign = [];
  for (const b of bands) {
    let hit = -1;
    for (let i = 0; i < reps.length; i++) {
      const d = ok ? ok.deltaE(b.hex, reps[i].hex)
        : chanMax(rgb(b.hex), rgb(reps[i].hex)) / 255;
      if (d <= tol) { hit = i; break; }
    }
    if (hit < 0) { reps.push({ hex: b.hex, weight: b.px }); hit = reps.length - 1; }
    else reps[hit].weight += b.px;
    assign.push(hit);
  }
  return { palette: reps.map((r) => r.hex), index: assign };
}

// ---- 4. THE DEPTH FIT — evidence, not an assumption ------------------
// Cross-referencing a hardware palette is only honest if the capture
// still CARRIES that quantisation. Measured on Eddie's crop it does
// not: at every candidate depth the distance to the nearest level
// matched what arbitrary 8-bit colour would give (3-bit 9.27 against
// 9.11 expected, 5-bit 2.07 against 2.06), so scaling and JPEG had
// destroyed the signature entirely. Snapping anyway would not correct
// compression — it would invent a provenance the pixels do not
// support, and then we would be chasing a target we had fabricated.
//
// Note also that the ARCADE Super Hang-On ran at 5 bits per channel,
// not the Mega Drive's 3, so snapping an arcade sky to the Genesis
// palette is a category error before compression even enters into it.
//
// So: fit every depth, report, and let the evidence decide.
function rampFor(bits) {
  const n = 1 << bits, out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(i * 255 / (n - 1)));
  return out;
}
const MD_DAC = [0, 52, 87, 116, 144, 172, 206, 255];
function depthFit(colours) {
  const meanDist = (levels) => {
    let tot = 0;
    for (const hex of colours) {
      const c = rgb(hex);
      let d = 0;
      for (const v of c) {
        let best = Infinity;
        for (const l of levels) { const e = Math.abs(v - l); if (e < best) best = e; }
        d += best;
      }
      tot += d / 3;
    }
    return colours.length ? tot / colours.length : 0;
  };
  const out = [];
  for (const bits of [3, 4, 5, 6]) {
    const step = 255 / ((1 << bits) - 1);
    const got = meanDist(rampFor(bits));
    const expected = step / 4;          // mean |error| for uniform noise
    out.push({ label: bits + '-bit', bits, measured: got, expected,
      // A real signature sits WELL below the unquantised expectation.
      signal: got < expected * 0.6 });
  }
  const mdGot = meanDist(MD_DAC);
  out.push({ label: 'Mega Drive DAC', bits: 3, measured: mdGot,
    expected: 255 / 7 / 4, signal: mdGot < (255 / 7 / 4) * 0.6 });
  return out;
}

// ---- 5. THE RIP ------------------------------------------------------
function rip(rows, opts) {
  const o = opts || {};
  const raw = bandsFrom(rows, o);
  const scale = inferScale(raw);
  // AN UNCONFIRMED SCALE IS NOT APPLIED. Dividing by a number the
  // data cannot justify rewrites the source; 1 leaves it alone.
  const sc = o.scale || (scale.confident ? scale.mode : 1);
  const cl = cluster(raw, o.clusterTol === undefined ? 0.02 : o.clusterTol);
  // SOURCE-RESOLUTION BANDS. A run shorter than half a source pixel is
  // scaler ringing, not a band, and is folded into its neighbour
  // rather than rounded up to one — rounding it up would invent a
  // band the hardware never drew.
  const bands = [];
  for (let i = 0; i < raw.length; i++) {
    const px = Math.round(raw[i].px / sc);
    const hex = cl.palette[cl.index[i]];
    if (px < 1) {
      if (bands.length) bands[bands.length - 1].dropped =
        (bands[bands.length - 1].dropped || 0) + raw[i].px;
      continue;
    }
    const dith = raw[i].dithered
      ? { second: cl.palette[cl.index[i]] === hex ? raw[i].second : raw[i].second,
        split: raw[i].split }
      : null;
    const last = bands[bands.length - 1];
    if (last && last.hex === hex && !last.dither === !dith
      && (!dith || last.dither.second === dith.second)) {
      last.px += px;
    } else bands.push({ hex, px, dither: dith });
  }
  const palette = [];
  const sequence = [];
  const add = (hex) => {
    let k = palette.indexOf(hex);
    if (k < 0) { palette.push(hex); k = palette.length - 1; }
    return k;
  };
  for (const b of bands) {
    const k = add(b.hex);
    sequence.push(k);
    // A dithered band's SECOND colour is a palette entry too — it is
    // on screen just as much as the first.
    if (b.dither) b.dither.index = add(b.dither.second);
  }
  const dithered = bands.filter((b) => b.dither);
  // THE COMPRESSION RATIO, because the residual rewards doing nothing.
  // A rip that keeps nearly every run as its own colour will always
  // rebuild well — it is echoing its input. Measured on the Europe
  // stage: 31 colours for 38 bands scored 0.0034, and the same source
  // clustered properly (20 colours) scored 0.0143 with the INTERIOR
  // residual exceeding the edge residual, which is the "rip is wrong"
  // signature. The low number was the weaker evidence, and the tool
  // showed it in green.
  // AGAINST THE RAW RUNS, not the merged bands. Measuring
  // palette/bands was self-defeating: when clustering merges ADJACENT
  // bands, both the numerator and the denominator shrink together and
  // the ratio sits at 1.00 however hard the rip worked. Caught by its
  // own check — a probe that clustered twenty bands into one still
  // reported "too little compression". Against the raw run count it
  // measures the work actually done on the input.
  const compression = raw.length ? palette.length / raw.length : 1;
  return {
    scale, usedScale: sc, bands, palette, sequence,
    widths: bands.map((b) => b.px),
    rawBands: raw.length,
    compression,
    // Below this, the residual is not evidence of a good rip.
    compressed: compression <= 0.7,
    ditherBands: dithered.length,
    ditherPx: dithered.reduce((a, b) => a + b.px, 0),
    occludedRows: raw.occluded || 0,
    depth: depthFit(palette),
    shape: shapeOf(bands),
  };
}

// The measurements that answer the questions we have been arguing
// about by eye: where the field ends, how the burst is built, and
// whether the sequence MARCHES or OSCILLATES.
function shapeOf(bands) {
  if (!bands.length) return null;
  const total = bands.reduce((a, b) => a + b.px, 0);
  let fi = 0;
  for (let i = 1; i < bands.length; i++) if (bands[i].px > bands[fi].px) fi = i;
  const field = bands[fi].px;
  const ok = G.FF.oklab;
  const L = (hex) => (ok ? ok.hexToOklch(hex).L : 0);
  let up = 0, down = 0;
  const burst = bands.slice(fi + 1);
  for (let i = 1; i < burst.length; i++) {
    const d = L(burst[i].hex) - L(burst[i - 1].hex);
    if (d > 0.008) up++;
    else if (d < -0.008) down++;
  }
  const w = burst.map((b) => b.px).sort((a, b) => a - b);
  // OSCILLATION SPLIT ABOVE AND BELOW THE FIELD. One average hides the
  // difference between a sky that saws throughout and a sky that
  // marches down to the burst and only then saws — and those are
  // different skies. Measured, the Europe stage's first 23 entries are
  // strictly increasing and only the tail oscillates, where the violet
  // stage oscillates all the way.
  const above = bands.slice(0, fi);
  let aUp = 0, aDown = 0;
  for (let i = 1; i < above.length; i++) {
    const d = L(above[i].hex) - L(above[i - 1].hex);
    if (d > 0.008) aUp++;
    else if (d < -0.008) aDown++;
  }
  // REPEATS: an entry used again after other colours have intervened.
  // Not a dither alternation between neighbours — an actual return to
  // an earlier palette entry, which a monotone model cannot express at
  // all. The Europe rip does it (…4,3,5,6,7,8,4,3…).
  const seen = new Map();
  let repeats = 0, farRepeats = 0;
  bands.forEach((b, i) => {
    if (seen.has(b.hex)) {
      repeats++;
      // ONE INTERVENING COLOUR IS ENOUGH. A gap of 2 means a colour
      // sat between the two uses, which is already a return to an
      // earlier palette entry rather than an alternation with a
      // neighbour. The threshold was 2 and missed exactly that case.
      if (i - seen.get(b.hex) > 1) farRepeats++;
    }
    seen.set(b.hex, i);
  });
  return {
    total, field, fieldShare: total ? field / total : 0,
    fieldIndex: fi, burstBands: burst.length,
    burstPx: total - field,
    burstTypical: w.length ? w[(w.length - 1) >> 1] : 0,
    burstMax: w.length ? w[w.length - 1] : 0,
    up, down,
    aboveUp: aUp, aboveDown: aDown,
    // NULL, NOT ZERO. When the field is the first band there is
    // nothing above it, and reporting 0% reads as "it marches" when
    // the honest answer is "there was nothing to measure".
    aboveSamples: Math.max(0, above.length - 1),
    aboveOscillation: aUp + aDown ? aDown / (aUp + aDown) : null,
    repeats, farRepeats,
    // A MONOTONE ramp scores 0 here. The reference crop scored 24
    // downs against 43 ups — it saws rather than marches, which is
    // the single biggest thing our model could not express.
    oscillation: up + down ? down / (up + down) : 0,
  };
}

// ---- 6. REBUILD, and the RESIDUAL ------------------------------------
// Re-expand the source bands to the screenshot's scale and measure how
// much of the capture the reconstruction fails to explain. If the
// residual is concentrated on band EDGES it is scaler ringing and the
// rip is sound; if it is spread through band interiors, the rip is
// wrong. Reporting both is the difference between a score and an
// alibi.
// THE DITHER HERE IS HORIZONTAL, so the rebuild emits the row's own
// modal colour and carries the second colour as metadata. A first cut
// alternated by ROW parity and introduced error where there was none:
// a 1-pixel checkerboard band varies ACROSS the row, not down it, so
// there is nothing vertical to reproduce.
//
// This also marks the limit of the residual honestly. It is a
// ROW-BASED score: it measures the vertical structure exactly and
// cannot see horizontal structure at all. `ditherBands` and
// `ditherPx` report that separately rather than letting a perfect
// residual imply the rip captured everything.
function rebuildRows(bands, scale, height) {
  const out = [];
  for (const b of bands) {
    for (let i = 0; i < b.px * scale && out.length < height; i++) out.push(b.hex);
  }
  while (out.length < height) out.push(bands.length ? bands[bands.length - 1].hex : '#000000');
  return out;
}
// OCCLUDED ROWS ARE EXCLUDED FROM THE SCORE. Scoring a row we could
// not see would be scoring the HUD, and would make the residual a
// measure of how much furniture is in the screenshot rather than of
// how good the rip is.
function residual(rows, rebuilt, minAgree) {
  const ok = G.FF.oklab;
  const ma = minAgree === undefined ? 0.5 : minAgree;
  const n = Math.min(rows.length, rebuilt.length);
  let sum = 0, worst = 0, edge = 0, interior = 0, edgeN = 0, intN = 0;
  let scored = 0;
  let ditherSkipped = 0;
  for (let i = 0; i < n; i++) {
    // DITHERED ROWS ARE EXCLUDED EXPLICITLY, not incidentally. They
    // were already being skipped — but only because their agreement
    // happens to fall below the threshold, which meant the exclusion
    // was an accident of one number rather than a stated rule, and a
    // check asserting the residual stayed exact could not fail when
    // the rebuild was broken.
    const r2 = rows[i];
    if (r2.second && r2.split !== undefined && r2.split >= 0.35 && r2.split <= 0.65) {
      ditherSkipped++;
      continue;
    }
    if (r2.agree !== undefined && r2.agree < ma) continue;
    scored++;
    const d = ok ? ok.deltaE(rows[i].hex, rebuilt[i])
      : chanMax(rgb(rows[i].hex), rgb(rebuilt[i])) / 255;
    sum += d;
    if (d > worst) worst = d;
    const isEdge = i > 0 && i < n - 1
      && (rebuilt[i] !== rebuilt[i - 1] || rebuilt[i] !== rebuilt[i + 1]);
    if (isEdge) { edge += d; edgeN++; } else { interior += d; intN++; }
  }
  return { mean: scored ? sum / scored : 0, worst,
    edgeMean: edgeN ? edge / edgeN : 0,
    interiorMean: intN ? interior / intN : 0,
    rows: n, scored, skipped: n - scored, ditherSkipped };
}

const api = { bandsFrom, inferScale, cluster, depthFit, rip, shapeOf,
  rebuildRows, residual, rampFor, MD_DAC };
G.FF.ripper = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
