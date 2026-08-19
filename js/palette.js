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
  // BEARINGS, v3 — AND THE ZERO WAS WRONG (Eddie, on device).
  // The world is Y-DOWN, so in this law's convention OVERHEAD is
  // ~270 degrees and the shipped default is 260 ("upper-left in a
  // y-down world"). I built the first hour set around 90, which is
  // straight DOWN: every melon has been lit from underneath since
  // 5.3 landed, and tightening the spread only made the up-lighting
  // more uniform. The day is now centred on the shipped default:
  // NOON just left of vertical, MORNING further left, GOLDEN and
  // DUSK swinging right, none of them within 40 degrees of the
  // horizon on either side.
  //
  // Reference: sunBearingDeg 260 is the value the game shipped and
  // was tuned against, so it — not a number I reason out from the
  // trigonometry — is the anchor.
  NOON: {
    lift: 0, mL: 1, mS: 1, tint: null, tintK: 0, sunDeg: 268,
    sky: { base: '#2f6bd8', lift: 60, fade: 74, turn: 12 },
  },
  MORNING: {
    lift: 0.02, mL: 0.97, mS: 1.02, tint: '#c9b48c', tintK: 0.12,
    sunDeg: 236,
    sky: { base: '#2a5fc0', lift: 58, fade: 70, turn: 22 },
  },
  // Golden hour is WARM but not brighter than noon — the sun is low
  // and the light is weaker. A pale tint (#ffc177) blended into dark
  // tones lifted them ABOVE noon, which the ordering check caught:
  // the cast must carry hue, not luminance, so the tint tones are
  // chosen near the mid-range and mL does the dimming.
  GOLDEN: {
    lift: 0, mL: 0.88, mS: 1.14, tint: '#b8763a', tintK: 0.26,
    sunDeg: 292,
    sky: { base: '#1f4f9e', lift: 62, fade: 66, turn: 58 },
  },
  DUSK: {
    lift: 0, mL: 0.70, mS: 1.30, tint: '#5b3466', tintK: 0.34,
    sunDeg: 300,
    sky: { base: '#2a2f86', lift: 56, fade: 58, turn: 72 },
  },
  NIGHT: {
    lift: 0, mL: 0.5, mS: 1.45, tint: '#101c4e', tintK: 0.42,
    sunDeg: 262,
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
function applyColumn(k, col) {
  let [h, sat, l] = rgbToHslLocal((k >> 16) & 255, (k >> 8) & 255, k & 255);
  sat = Math.max(0, Math.min(1, sat * col.mS));
  l = Math.max(0, Math.min(1, l * col.mL));
  if (col.lift) l = l + (1 - l) * col.lift;
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
    const w = col.tintK * (1 - sat * 0.55);
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
  const ck = currentSkyId + '|' + current + '|' + hex;
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
function setSky(id) {
  const lib = skyLib();
  if (!lib || !lib.SPECS[id] || id === currentSkyId) return currentSkyId;
  currentSkyId = id;
  version++;
  return currentSkyId;
}
function getSky() { return currentSkyId; }
function skySpec() {
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
const SUN_OVERHEAD = 270;   // y-down world: 270 is straight up
function sunDeg() {
  // The bearing belongs to the SKY: a sky and the light falling under
  // it are one authored fact. The hour table remains the fallback for
  // any caller running before the library loads.
  const spec = skySpec();
  const t = TIMES[currentTime] || TIMES.NOON;
  let base = spec && spec.sun !== undefined ? spec.sun : t.sunDeg;
  if (base === undefined) base = SUN_OVERHEAD;
  if (currentTime !== 'NIGHT') return base;
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
  lightVersion, TIMES, TIME_NAMES, setTime, getTime, skyParams,
  timeForSeed, litIn, sunDeg, setSunSeed,
  setSky, getSky, skySpec, skyColumn, isIdentityColumn };

if (typeof window !== 'undefined') {
  window.FF = window.FF || {};
  window.FF.palette = api;
}
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
