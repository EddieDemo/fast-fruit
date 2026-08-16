// verify-roll.js
// The decal roll, held to its stated laws.
//   A. Determinism: same salt, same level, same owned set -> same
//      sticker, every time. Nothing to re-roll by reloading.
//   B. Different levels vary the draw (not a constant function).
//   C. Owned exclusion: a granted item is never drawn again.
//   D. Drain: roll -> grant repeatedly completes the whole catalogue,
//      each item exactly once, then rolls null forever.
//   E. Empty sets are never drawn (NUMBERS today).
//   F. Last-item collapse: everything owned but one -> that one.
//   G. THE ARITHMETIC: over many installs, a set is drawn uniformly
//      among eligible sets and an item uniformly within it, so with
//      eyes(1)/markings(2)/flags(9) eligible, P(googly eye) ~ 1/3 and
//      P(a specific flag) ~ 1/27 — the eye is nine times likelier, as
//      the tray's rarity lines claim.

global.window = { FF: {} };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
require('./js/dmath.js');
require('./js/terrain.js');
require('./js/decals.js');
require('./js/xp.js');
require('./js/melon.js');

const M = window.FF.melon;
const D = window.FF.decals;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

// helper: reset the stable with a fixed salt and owned set
function fresh(salt, owned) {
  // melons must be non-empty or load() treats the save as first-boot
  // and re-deals it (with a random salt) — the exact trap that made
  // this suite's first run pass three checks by coincidence.
  const st = { v: 1, salt, active: 0, player: { name: 'T', xp: 0 },
    melons: [{ v: 1, seed: 42, name: 'T', born: '2026-08-15', record: {} }],
    decals: owned.slice(), eraRoll: true };
  localStorage.setItem('ff-stable', JSON.stringify(st));
  M._reload();
}
const ALL_IDS = D.ALL.map(i => i.id);

// A: determinism ---------------------------------------------------------
{
  fresh(12345, []);
  const a = M.rollDecal(2), b = M.rollDecal(2), c = M.rollDecal(2);
  fresh(12345, []);
  const d = M.rollDecal(2);
  check('A same salt/level/owned -> same sticker',
    a && b && c && d && a.id === b.id && a.id === c.id && a.id === d.id, a && a.id);
}

// B: levels vary the draw ---------------------------------------------------
{
  fresh(12345, []);
  const ids = new Set();
  for (let lv = 2; lv <= 9; lv++) ids.add(M.rollDecal(lv).id);
  check('B levels vary the draw', ids.size >= 3, ids.size + ' distinct over 8 levels');
}

// C + D: exclusion and drain ---------------------------------------------------
{
  fresh(777, []);
  const seen = [];
  let lv = 2, guard = 0;
  for (;;) {
    const r = M.rollDecal(lv);
    if (!r) break;
    if (seen.indexOf(r.id) !== -1) { seen.push('DUPE:' + r.id); break; }
    seen.push(r.id);
    M.grantDecal(r.id);
    lv++;
    if (++guard > 200) { seen.push('RUNAWAY'); break; }
  }
  const okAll = seen.length === ALL_IDS.length
    && ALL_IDS.every(id => seen.indexOf(id) !== -1);
  const after = M.rollDecal(lv);
  check('C+D drain grants each item exactly once then null',
    okAll && after === null, seen.length + ' rolls: ' + seen.join(','));
}

// E: empty sets never drawn -----------------------------------------------------
{
  fresh(31337, []);
  let ok = true;
  for (let lv = 2; lv < 60; lv++) {
    const r = M.rollDecal(lv);
    if (r && r.id.indexOf('num-') === 0) ok = false;
  }
  check('E empty NUMBERS set never drawn', ok);
}

// F: last-item collapse ------------------------------------------------------------
{
  fresh(9, ALL_IDS.filter(id => id !== 'flag-bd'));
  const r1 = M.rollDecal(3), r2 = M.rollDecal(17);
  check('F everything owned but one -> that one',
    r1 && r2 && r1.id === 'flag-bd' && r2.id === 'flag-bd');
}

// G: the arithmetic ------------------------------------------------------------------
{
  const counts = {};
  const N = 30000;
  for (let s = 0; s < N; s++) {
    fresh(1000003 * s + 17, []);
    const r = M.rollDecal(2);
    counts[r.id] = (counts[r.id] || 0) + 1;
  }
  // Four eligible sets; flag/wrap lists DERIVED from the catalogue so
  // this check survives catalogue growth (learned when Wave A landed).
  const nF = D.SETS.flags.items.length, nW = D.SETS.wraps.items.length;
  const pEye = (counts['eye-googly'] || 0) / N;
  const pHeart = (counts['mark-heart'] || 0) / N;
  const pFlagAvg = D.SETS.flags.items
    .reduce((a, it) => a + (counts[it.id] || 0), 0) / nF / N;
  const pWrapAvg = D.SETS.wraps.items
    .reduce((a, it) => a + (counts[it.id] || 0), 0) / nW / N;
  const okEye = Math.abs(pEye - 1 / 4) < 0.015;
  const okHeart = Math.abs(pHeart - 1 / 8) < 0.012;
  const okFlag = Math.abs(pFlagAvg - 1 / (4 * nF)) < 0.003;
  const okWrap = Math.abs(pWrapAvg - 1 / (4 * nW)) < 0.003;
  const ratio = pEye / pFlagAvg;
  check('G set-uniform, item-uniform: eye ~1/4, heart ~1/8, a flag ~1/' + (4 * nF),
    okEye && okHeart && okFlag && okWrap && Math.abs(ratio - nF) < 0.12 * nF,
    'eye ' + pEye.toFixed(3) + ' heart ' + pHeart.toFixed(3)
    + ' flag ' + pFlagAvg.toFixed(4) + ' wrap ' + pWrapAvg.toFixed(4)
    + ' eye/flag ' + ratio.toFixed(1) + 'x (want ~' + nF + ')');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);