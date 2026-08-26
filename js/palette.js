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
const rampSets = new Map();   // name -> Set of the same hexes, for O(1) tests
const members = new Set();    // int 0xRRGGBB of every registered tone
// WHY A SET BESIDE THE ARRAY (2026-08-19, perf). register() tested
// membership with ramp.indexOf(), which is O(n) against a ramp that
// reached 572 entries once every sky had been touched — and it runs
// for every sky row of every frame. The ARRAY still owns the ramp's
// ORDER, which the registry's consumers read; the Set only answers
// "have I seen this tone", which is all indexOf was ever asked.

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
// ---- THE COLUMN MODEL (v2, Eddie 2026-08-18) ----
// v1 moved value and chroma TOGETHER — brighter meant more
// saturated, darker meant less. That is a brightness slider, not
// light, and it produced mud at the dark end (dropping value AND
// chroma is the recipe for it).
//
// The painter's convention, which is also the physics: STRONG LIGHT
// WASHES COLOUR OUT — lit surfaces climb toward the white point, so
// chroma falls as value rises. SHADOW GAINS CHROMA — unlit surfaces
// are lit by bounced ambient, and that ambient is coloured, which is
// why night reads as deep saturated blue rather than grey.
//
// Three moves per column, each doing a different job:
//   lift  — fraction of the REMAINING distance to white. A ceiling,
//           not a scale: scaling upward clips once a tone is already
//           pale, which is exactly where BRIGHT needs to behave.
//   mS    — chroma scale, moving OPPOSITE the value change.
//   tint / tintK — blend toward the column's ambient hue. Without
//           it a chroma scale leaves GREYS untouched, so terrain
//           would stay neutral while everything coloured deepened.
//           Real shadow tints neutrals toward the ambient; this is
//           what lifts the greys into the night with everything else.
const COLUMNS = {
  BRIGHT:   { lift: 0.30, mL: 1,    mS: 0.72, tint: '#fff6e2', tintK: 0.10 },
  STANDARD: { lift: 0,    mL: 1,    mS: 1,    tint: null,      tintK: 0 },
  DIM:      { lift: 0,    mL: 0.70, mS: 1.25, tint: '#2a3f7a', tintK: 0.20 },
  DARK:     { lift: 0,    mL: 0.44, mS: 1.55, tint: '#16265e', tintK: 0.38 },
};
const STATES = Object.keys(COLUMNS);

// ---- TIME OF DAY (Phase 5.2) ----
// A SECOND, ORTHOGONAL axis. Strength (above) is local light: a
// tunnel, a shaded gallery, a flare. Time is the world's hour, and
// the two compose — a tunnel at dusk is not a tunnel at noon. Each
// hour carries its own SKY parameters too, because the sky is the
// star of a time change: a sunset is not a rotation of a blue sky,
// it is a different ramp (warm and low-contrast near the horizon).
//
// Selection is deliberately NOT wired here: whether the hour is
// drawn from the track seed or sequenced across a cup is Eddie's
// open ruling. timeForSeed() below implements the seeded option so
// that ruling is a one-line change either way.
// OVERHEAD, and the anchor everything else is measured from. 268 is
// the shipped value the game was tuned against on device — not a
// number reasoned out from trigonometry.
const SUN_OVERHEAD = 268;
// How far the transitions swing. NOT 90, and not 72 either.
//
// The shading law has a standing rule that every hour must light from
// ABOVE — melons lit from underneath was a shipped bug Eddie caught
// on device — and the check demands the vertical component clear
// -0.4. Measured against the real shading law: 72 degrees gives
// -0.195, 60 gives -0.332, and 50 is the first that clears it at
// -0.435 while still being strongly sidelit (horizontal -0.557).
//
// So the transitions are a LOW sun rather than a sun ON the horizon.
// That is the honest compromise between the astronomy Eddie asked for
// and a shading law that has already been burned once by taking the
// astronomy literally.
const SUN_LOW = 50;
const TIMES = {
  // NOON is the IDENTITY hour, exactly as STANDARD is the identity
  // strength: it must declare no moves, or the declaration lies
  // about what the fast path actually does.
  // Phase 5.3: each hour carries the SUN's bearing (degrees, the
  // shading law's own convention: 0 = from the right, 90 = overhead
  // in screen terms). The terminator on every melon swings with the
  // day — morning light from one side, evening from the other — and
  // because it is a per-hour constant the bake can key on it.
  //
  // BEARINGS, v4 — FOUR CARDINAL POINTS (Eddie's ruling, 2026-08-21).
  //
  // The five hours were MORNING, NOON, GOLDEN, DUSK, NIGHT, and two
  // things were wrong with them.
  //
  // THE SUN BARELY MOVED. The five bearings spanned 236 to 300 — a
  // total of SIXTY-FOUR DEGREES across an entire day, with overhead
  // at ~270. The sun wobbled about the zenith and never came near
  // either horizon; NIGHT sat at 262, eight degrees from noon, still
  // lighting every melon from overhead.
  //
  // AND THE TABLES DISAGREED WITH EACH OTHER. By bearing, MORNING
  // (-32 from noon) mirrored DUSK (+32). By sky lightness, MORNING
  // overlapped GOLDEN by 0.91 and DUSK by only 0.17. Two tables in
  // two files encoding opposite opinions about what MORNING is,
  // drifting apart unnoticed because nothing related them.
  //
  // FOUR CARDINAL POINTS at an equatorial site:
  //   MORNING   sun low, one side       overhead - 72
  //   NOON      overhead                overhead
  //   DUSK      sun low, other side     overhead + 72
  //   MIDNIGHT  no sun — SKYLIGHT       overhead
  //
  // TWO CORRECTIONS TO THE LITERAL ASTRONOMY, both caught by checks.
  //
  // MIDNIGHT IS NOT "THE SUN BELOW". Placed at overhead+180 the sun
  // sits straight down and every melon is lit FROM UNDERNEATH — the
  // exact fault Eddie caught on device at Phase 5.3. At midnight
  // there IS no sun: the light is moonlight and skylight, and both
  // come from ABOVE. `sunDeg` drives the shading law, so it must be
  // the direction light ARRIVES from, not where the sun physically
  // is. Midnight therefore keeps an overhead bearing and does its
  // work through mL and the tint instead.
  //
  // AND THE TRANSITIONS STOP SHORT OF THE HORIZON. At exactly +/-90
  // the vertical component is 0.03 — a grazing light with a
  // terminator straight down the middle of every melon, and
  // degenerate at the boundary. 72 degrees keeps the sun low and
  // strongly sidelit (horizontal 0.95) while still clearly above the
  // horizon (vertical 0.3).
  //
  // The MIRROR still holds, which is the property that matters:
  // morning is exactly as far from noon as dusk is, on the other
  // side, so shadows fall opposite ways.
  //
  // The structure is what earns it. NOON and MIDNIGHT are the two
  // EXTREMES — sun highest and lowest, flat uniform skies. MORNING
  // and DUSK are the two TRANSITIONS — sun on the horizon, big lift,
  // burning horizon, maximum contrast. Two kinds of hour, mirrored,
  // which makes SYMMETRY TESTABLE: morning must sit as far from noon
  // as dusk does, and their lifts must match. The old five had no
  // such structure, which is exactly why the two tables could
  // disagree for weeks.
  //
  // GOLDEN is gone. It was never a time of day — it is a QUALITY of
  // light that happens twice, and naming it as a slot is what hid the
  // duplication. MIDNIGHT replaces NIGHT for the matching reason:
  // four cardinal POINTS want point names, not span names.
  // THE BEARINGS ARE DERIVED, NOT TYPED. SUN_OVERHEAD is the anchor
  // (the shipped, device-tuned value); the four points are exactly
  // 90 degrees apart around it, so the symmetry cannot be broken by
  // editing one number. That is the whole reason the old tables
  // drifted.
  NOON: {
    lift: 0, mL: 1, mS: 1, tint: null, tintK: 0, sunDeg: SUN_OVERHEAD,
    sky: { base: '#2f6bd8', lift: 60, fade: 74, turn: 12 },
  },
  // SUNRISE. Warm, but the sun is on the horizon so the light is
  // weaker than noon — mL does the dimming and the tint carries hue,
  // because the cast must never carry luminance (a pale tint blended
  // into dark tones once lifted them ABOVE noon and the ordering
  // check caught it).
  // THE TINT MUST NOT CARRY LUMINANCE, and this reintroduced the
  // fault the old GOLDEN comment warned about: a pale warm tint
  // blended into a dark neutral lifted it ABOVE noon (value 0.243
  // against noon's 0.227) while mL said 0.88. The tint tone is now
  // chosen near the mid-range so mL alone does the dimming.
  MORNING: {
    lift: 0, mL: 0.88, mS: 1.14, tint: '#8a5f34', tintK: 0.24,
    sunDeg: (SUN_OVERHEAD - SUN_LOW + 360) % 360,
    sky: { base: '#2a5fc0', lift: 58, fade: 70, turn: 22 },
  },
  // SUNSET — morning's mirror. Same elevation, opposite side, so the
  // shadows fall the other way. Warmer and redder than sunrise
  // because the day's aerosol load has built up, which is a real
  // asymmetry rather than a decorative one.
  DUSK: {
    lift: 0, mL: 0.84, mS: 1.20, tint: '#7d3c28', tintK: 0.30,
    sunDeg: (SUN_OVERHEAD + SUN_LOW) % 360,
    sky: { base: '#2a2f86', lift: 56, fade: 58, turn: 72 },
  },
  MIDNIGHT: {
    lift: 0, mL: 0.5, mS: 1.45, tint: '#101c4e', tintK: 0.42,
    sunDeg: SUN_OVERHEAD,   // skylight, from above
    sky: { base: '#0d1442', lift: 34, fade: 44, turn: 10 },
  },
};
const TIME_NAMES = Object.keys(TIMES);
let currentTime = 'NOON';

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
// One tone through BOTH axes: the hour first (the world's light),
// then the local strength (what this place does to it).
// THE AMBIENT DIAL (engine-level, 2026-08-24). The cast-on-neutrals
// rule is right in kind and was untunable in degree: rolled night
// skies derive strong warm ambients, and at full strength every
// neutral in the world goes olive. ONE scale on the tint term — it
// moves melons, smoke, clouds and terrain in lockstep, because they
// all resolve through this door. Default 1 = shipped behaviour.
let ambientScale = 1;
function setAmbient(k2) {
  const v = Math.max(0, Math.min(1, +k2));
  if (v === ambientScale) return ambientScale;
  ambientScale = v; version++;
  return ambientScale;
}
function getAmbient() { return ambientScale; }

function applyColumn(k, col) {
  let [h, sat, l] = rgbToHslLocal((k >> 16) & 255, (k >> 8) & 255, k & 255);
  // CHROMA, NOT HSL-S, IS WHAT A LIGHT COLUMN SCALES (the two-whites
  // forensics, 2026-08-24). HSL saturation is ill-conditioned near
  // white: an 8-unit RGB spread at L 0.95 reads as S 0.31, invisible
  // there — and mS-then-mL made it a fully visible olive once L fell.
  // Measured: cream #f6f4ee through a night column came out khaki
  // #7c662d while its green-trace sibling came out leaf green; the
  // same frame showed both. The column now scales the tone's ABSOLUTE
  // chroma and re-derives S at the destination lightness, so a
  // near-white stays near-neutral at any depth of night, and the
  // ambient TINT term remains the one legitimate source of colour on
  // neutrals. Mid-chroma tones keep their night deepening: their
  // chroma is real, so scaling it is the same law it always was.
  const chroma = (1 - Math.abs(2 * l - 1)) * sat;
  const c2 = Math.max(0, Math.min(1, chroma * col.mS));
  l = Math.max(0, Math.min(1, l * col.mL));
  if (col.lift) l = l + (1 - l) * col.lift;
  const denom = 1 - Math.abs(2 * l - 1);
  sat = denom > 1e-6 ? Math.max(0, Math.min(1, c2 / denom)) : 0;
  let [r, g, b] = hslToRgbLocal(h, sat, l);
  if (col.tint && col.tintK) {
    // THE CAST: blend toward the ambient in RGB, then RESTORE the
    // pre-blend luminance.
    //
    // v1 blended in RGB and dragged VALUE with it (GOLDEN came out
    // brighter than NOON). v2 rotated HUE toward the ambient along
    // the shorter arc — which is AMBIGUOUS when the ambient is near
    // 180 degrees away, and a warm cast on a blue sky is exactly
    // that: as the source hue drifted past the antipode the rotation
    // flipped sign, and the sky jumped from cyan to indigo at one
    // row. That seam is the solid block Eddie spotted at the top of
    // MORNING.
    //
    // A luminance-preserving RGB blend has no wrap to be ambiguous
    // about, so it is continuous by construction, and value stays
    // mL's job alone — which is what the hour ordering rests on.
    const tk = toInt(col.tint);
    const tr = (tk >> 16) & 255, tg = (tk >> 8) & 255, tb = tk & 255;
    const w = col.tintK * ambientScale * (1 - sat * 0.55);
    const luma = (rr, gg, bb) => 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    const before = luma(r, g, b);
    r = r + (tr - r) * w;
    g = g + (tg - g) * w;
    b = b + (tb - b) * w;
    const after = luma(r, g, b);
    if (after > 0.5) {
      const f = before / after;
      r *= f; g *= f; b *= f;
    }
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
  }
  return (r << 16) | (g << 8) | b;
}

// APPLY A COLUMN TO A TONE, without touching global state. The sky
// generator's gates need to know what the terrain will look like
// under a candidate sky before that sky is ever selected, and
// installing it just to ask would be a side effect for a question.
function applyColumnTo(hex, col) {
  const k = toInt(hex);
  if (k === null || !col) return hex;
  const out = applyColumn(k, col);
  members.add(out);
  return '#' + ((1 << 24) | out).toString(16).slice(1);
}

// Phase 5.2: the same door with an EXPLICIT strength, so different
// REGIONS of one frame can resolve differently. lit() is this with
// the global strength — regional light does not replace the global
// state, it overrides it per region.
function litIn(hex, strength) {
  const save = current;
  current = COLUMNS[strength] ? strength : current;
  const out = lit(hex);
  current = save;
  return out;
}

function lit(hex) {
  // THE CACHE IS CONSULTED FIRST. It used to sit BEHIND skyColumn(),
  // so a cache HIT still paid the full derivation — a memo placed
  // after the work it memoises is not a memo. The key already carries
  // the sky, so a hit is a complete answer on its own.
  // THE KEY CARRIES `version`, and it must. Without it the key was
  // (sky id, strength, tone) — sufficient only while a sky ID maps to
  // ONE column forever, which is true of the game and false of the
  // bench: the bench installs a scratch spec under a stable id and
  // changes its column on every edit, so the FIRST answer was cached
  // and served for every later one. Measured: a sky edited from lime
  // to white-and-purple kept painting the ground lime green.
  //
  // `version` is bumped by every mutator — setSky, setTime, setLight,
  // setSunSeed — so it is exactly "has anything that could change the
  // answer changed". skyColumn's memo already keys this way; lit()
  // was the one door that did not, and the two now share a
  // discipline rather than differing by accident.
  //
  // Cost: none during a race, where version is constant.
  const ck = currentSkyId + '|' + version + '|' + current + '|' + hex;
  const hit = litCache.get(ck);
  if (hit !== undefined) return hit;
  // THE FAST PATH IS COMPUTED, NOT NAMED. It used to test
  // `currentTime === 'NOON'`, which was true because NOON's column is
  // the identity — an accident of the table, not a fact about the
  // light. With skies choosing their own columns, a NOON-role sky can
  // legitimately cast; asking whether THIS column is the identity is
  // the question that was always meant.
  const tcol = skyColumn();
  const ident = isIdentityColumn(tcol);
  if (current === 'STANDARD' && ident) return hex;
  const col = COLUMNS[current] || COLUMNS.STANDARD;
  let k = toInt(hex);
  if (k === null) return hex;
  if (tcol && !ident) k = applyColumn(k, tcol);
  if (current === 'STANDARD') {
    const out0 = '#' + ((1 << 24) | k).toString(16).slice(1);
    litCache.set(ck, out0);
    members.add(k);
    return out0;
  }
  const k2 = applyColumn(k, col);
  const out = '#' + ((1 << 24) | k2).toString(16).slice(1);
  litCache.set(ck, out);
  members.add(k2);              // the lit tone is legitimate too
  return out;
}

// ---- THE SKY IS THE SOURCE (Phase 6) ----
// A sky SPEC (js/sky.js) now carries the ramp, the sun's bearing and
// — for skies that do not author one — the light column itself.
// Selecting an hour selects that hour's CLASSIC sky, so every
// existing call site keeps its exact shipped appearance; a caller who
// wants one of the new skies says so explicitly afterwards.
let currentSkyId = 'noon';
function skyLib() { return (typeof window !== 'undefined' && window.FF && window.FF.sky) || null; }
// A GENERATED SKY IS A VALUE, NOT A NAME.
//
// main.js used to call sky.define() on every race so it could pass an
// id here, and nothing ever removed them: measured, the registry went
// from 11 specs to 61 over fifty races and would keep going for as
// long as the session lasted. Each entry holds a node list and a
// rows() cache line, so it is slow rather than fatal — but an
// unbounded structure in a game meant to run for hours is a leak, and
// giving a one-race value a permanent name is what created it.
//
// setSky now accepts the SPEC ITSELF. A library sky is still chosen
// by id, because a library sky genuinely has a name.
let currentSkySpec = null;
function setSky(idOrSpec) {
  const lib = skyLib();
  if (!lib) return currentSkyId;
  if (idOrSpec && typeof idOrSpec === 'object') {
    if (currentSkySpec === idOrSpec) return currentSkyId;
    currentSkySpec = idOrSpec;
    currentSkyId = idOrSpec.id || 'generated';
    version++;
    return currentSkyId;
  }
  if (!lib.SPECS[idOrSpec] || (idOrSpec === currentSkyId && !currentSkySpec)) {
    return currentSkyId;
  }
  currentSkySpec = null;
  currentSkyId = idOrSpec;
  version++;
  return currentSkyId;
}
function getSky() { return currentSkyId; }
function skySpec() {
  if (currentSkySpec) return currentSkySpec;
  const lib = skyLib();
  return lib ? lib.get(currentSkyId) : null;
}
// The hour's own light column, sourced through the sky. Classic skies
// return their authored column verbatim (so nothing that exists today
// moves); authored-new skies have theirs DERIVED from their own tones.
// THE COLUMN IS SOLVED ONCE PER SKY, NOT ONCE PER TONE.
//
// A column is a pure function of a spec, and a spec does not change
// during a race — but columnFor() on a DERIVED sky solves two entire
// skies (its own ambient, and the reference's), and this sits on the
// hottest path in the renderer. Measured before the memo: 0.23ms per
// lit() call against 0.85us under a classic sky, ~1157 lit() calls a
// frame, 268ms/frame — about 4fps, and only on the new skies, so a
// race crawled or did not depending on its seed.
//
// The lesson worth keeping: A PURE FUNCTION IS NOT A FREE FUNCTION.
// Every check in F and R asks whether the output is CORRECT; a
// function tested for purity and determinism passes identically at
// 1us and at 1ms. Phase 6's whole design is "solve it properly,
// once" — the "once" was simply never wired.
//
// Keyed on `version`, the counter every setSky/setTime/setLight
// already bumps, so the memo cannot outlive the state it describes.
let colCacheKey = null, colCacheVal = null;
function skyColumn() {
  const key = currentSkyId + '|' + version;
  if (key === colCacheKey) return colCacheVal;
  const lib = skyLib();
  const spec = skySpec();
  colCacheVal = (lib && spec) ? lib.columnFor(spec)
    : (TIMES[currentTime] || TIMES.NOON);
  colCacheKey = key;
  return colCacheVal;
}
// ---- THE GROUND KEEPS ITS OWN COLOURS (Eddie's ruling) ----
// Terrain is RECOLOURED by the light exactly as a melon is, but its
// base tones are its own rather than derived from the sky. TARMAC is
// the shipped grey, byte-for-byte, so nothing changes appearance
// until a stage selects otherwise.
let currentGround = 'tarmac';
function setGround(kitId) {
  const lib = skyLib();
  if (!lib || !lib.GROUND_KITS[kitId] || kitId === currentGround) return currentGround;
  currentGround = kitId;
  version++;
  return currentGround;
}
function getGround() { return currentGround; }
function groundTone() {
  const lib = skyLib();
  return lib ? lib.groundHex(currentGround) : '#3a3a3a';
}

function isIdentityColumn(c) {
  return !!c && !c.lift && c.mL === 1 && c.mS === 1 && !c.tintK;
}

function setTime(name) {
  if (!TIMES[name] || name === currentTime) return currentTime;
  currentTime = name;
  // The hour's classic sky is the default, always: an hour change
  // that left a previous race's sky in place would make the hour a
  // half-truth.
  currentSkyId = name.toLowerCase();
  version++;
  return currentTime;
}
function getTime() { return currentTime; }
// The sky's parameters for the current hour: base, lift, fade, turn.
// RETAINED for the classic hours and the suites that read them; the
// renderer no longer paints from these — it blits FF.sky.rows().
function skyParams() { return (TIMES[currentTime] || TIMES.NOON).sky; }
// The sun's bearing for the current hour, in the shading law's units.
// NIGHT takes a seeded offset so the moon is not in the same socket
// on every track; the offset is small and deterministic, so it never
// approaches the grazing angles the tightening removed.
let sunSeed = 0;
function setSunSeed(seed) {
  let h = 2166136261 >>> 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  sunSeed = h;
  version++;
  return sunSeed;
}
// (SUN_OVERHEAD is declared once, above the hour table — it WAS
// declared twice, 268 there and 270 here, which is the same fault as
// the one that made the hours drift: two constants for one idea.)
function sunDeg() {
  // The bearing belongs to the SKY: a sky and the light falling under
  // it are one authored fact. The hour table remains the fallback for
  // any caller running before the library loads.
  const spec = skySpec();
  const t = TIMES[currentTime] || TIMES.NOON;
  let base = spec && spec.sun !== undefined ? spec.sun : t.sunDeg;
  if (base === undefined) base = SUN_OVERHEAD;
  if (currentTime !== 'MIDNIGHT') return base;
  return base + ((sunSeed % 3) - 1) * 15;      // -15, 0 or +15
}
// SELECTION (Phase 5.1, ruled 2026-08-18): the hour is drawn from the
// TRACK SEED and OFFSET BY THE CUP LEG. The hybrid settles the open
// question in both directions at once:
//   * seeded — a given track at a given leg always looks the same,
//     which is the project's seed law, and no state has to be stored;
//   * sequenced — the leg offset guarantees a three-race cup shows
//     three DIFFERENT hours. Pure seeding could legitimately deal
//     noon three times, which is the weakest possible version of a
//     feature whose whole point is that the day moves.
// The sequencing half only works if every leg hashes the SAME base
// and separates by the leg offset. Hashing each leg's own TRACK seed
// and adding the leg does nothing — measured: 157 of 300 cups still
// repeated an hour. So a cup passes its DAY as the base (one base,
// legs 0..4 land on consecutive, distinct hours by construction) and
// a one-off race passes its own track seed.
// Practice runs pass leg 0, so a practised track matches its cup-leg
// appearance only on leg 1 — deliberate: practice is a rehearsal of
// leg 1, not of the whole cup.
function timeForSeed(seed, leg) {
  let h = 2166136261 >>> 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const n = TIME_NAMES.length;
  return TIME_NAMES[(h + (leg | 0)) % n];
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
  let ramp = ramps.get(name);
  if (ramp === undefined) {
    ramp = []; ramps.set(name, ramp); rampSets.set(name, new Set());
  }
  const seen = rampSets.get(name);
  for (const t of (Array.isArray(tones) ? tones : [tones])) {
    const k = toInt(t);
    if (k === null) continue;
    if (!seen.has(t)) { seen.add(t); ramp.push(t); }
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
  setAmbient, getAmbient,
  lightVersion, TIMES, TIME_NAMES, setTime, getTime, skyParams,
  timeForSeed, litIn, sunDeg, setSunSeed,
  setSky, getSky, skySpec, skyColumn, isIdentityColumn, applyColumnTo,
  setGround, getGround, groundTone };

if (typeof window !== 'undefined') {
  window.FF = window.FF || {};
  // ---- THE RACER COLOR LAW (moved from renderer.js, step 6b,
  // 2026-08-26u). fx (debris) and presentation both read it; a color
  // law over canonical body order carries no game RULES, so core is
  // its home and every reference points downward. The slot palette
  // is exported for the netplay slot colors renderer still draws.
// Bot palette: each melon its own bright shade (player stays pure green).
// Indexed by spawn order, so a bot keeps its color for the whole race.
const BOT_PALETTE = [
  // Eleven greens, L*-NORMALIZED into [54, 74]: every bot guarantees
  // >=20 L* of highlight headroom, so the constant-contrast solver in
  // litColor can hit its full delta on all of them (the old palette
  // had L*93 pale limes with nowhere brighter to go — measured as the
  // "subtle on some melons" complaint). Hues span the green family
  // 78-164deg; the player's pure #00ff00 stays sacred and out-brights
  // them all.
  '#90c710', '#6bb31a', '#56c516', '#37a01c', '#1bc01b', '#24a93f',
  '#17ce54', '#25965a', '#20b378', '#22a07e', '#608e24',
];
api.register('bots', BOT_PALETTE);   // moved home (step 6b): the
                                     // palette registers its own


// Canonical racer color by body index (players in slot order, then
// bots) — shared with the debris system so every melon's pulp wears
// its own green. Presentation-only; the sim never reads colors.
window.FF.racerColor = function (state, bodyIndex) {
  const np = state.players.length;
  if (bodyIndex < np) {
    const pb = state.players[bodyIndex] && state.players[bodyIndex].melon;
    return (pb && pb.bodyColor) || PLAYER_PALETTE[bodyIndex % PLAYER_PALETTE.length];
  }
  const body = state.bots[bodyIndex - np] && state.bots[bodyIndex - np].melon;
  // Bots carry their seeded pigment (state.js, via the anchor band);
  // the legacy palette survives only as a headless/boot fallback.
  if (body && body.bodyColor) return body.bodyColor;
  return BOT_PALETTE[(bodyIndex - np) % BOT_PALETTE.length];
};

// Canonical player-slot colors: every peer agrees on who wears what.
const PLAYER_PALETTE = ['#00ff00', '#ff2d2d', '#2d8cff', '#ffd22d'];
  api.PLAYER_SLOTS = PLAYER_PALETTE;

  window.FF.palette = api;
}
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
