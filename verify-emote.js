// verify-emote.js
// The handshake's pure core, headless (bubbles are DOM, hand-tested;
// every decision they present is verified here).
//   A. Determinism: same race seed, same field -> the identical plan,
//      run twice. "Bot Otis didn't GG me" is a fact about the race.
//   B. Chance statistics: over many races, each pilot answers ~30%.
//   C. Stagger bounds: every delay inside [delayMin, delayMax], and
//      the delays SPREAD (the illusion is the scatter) — across many
//      races the window is actually used, both ends.
//   D. Independence: pilots' rolls don't correlate — the same race
//      gets a mixed field of answers, not all-or-nothing.
//   E. The personality socket: a chance-0 pilot never answers, a
//      chance-1 pilot always does, and a custom delay window binds.

global.window = { FF: {} };
require('./js/terrain.js');   // mulberry32
require('./js/emote.js');

const E = window.FF.emote;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

const FIELD = ['Bot Gary', 'Bot Otis', 'Bot Winnie', 'Bot Priya', 'Bot Klaus',
  'Bot Hollie', 'Bot Trevor', 'Bot Mabel', 'Bot Sunny', 'Bot Iggy', 'Bot Pearl'];

// A: determinism ---------------------------------------------------------
{
  const a = JSON.stringify(E.plan(123456789, FIELD));
  const b = JSON.stringify(E.plan(123456789, FIELD));
  const c = JSON.stringify(E.plan(123456790, FIELD));
  check('A same race -> same plan; next race -> a different one',
    a === b && a !== c);
}

// B: chance statistics --------------------------------------------------------
{
  const N = 5000;
  let yes = 0;
  for (let s = 0; s < N; s++) {
    const p = E.plan(s * 7919 + 3, FIELD);
    for (const k of FIELD) if (p[k].responds) yes++;
  }
  const rate = yes / (N * FIELD.length);
  check('B response rate ~ DEFAULT.chance', Math.abs(rate - E.DEFAULT.chance) < 0.01,
    rate.toFixed(3) + ' (want ' + E.DEFAULT.chance + ')');
}

// C: stagger bounds and spread ---------------------------------------------------
{
  let lo = Infinity, hi = -Infinity, ok = true;
  for (let s = 0; s < 2000; s++) {
    const p = E.plan(s * 104729 + 11, FIELD);
    for (const k of FIELD) {
      const d = p[k].delayMs;
      if (d < E.DEFAULT.delayMin || d > E.DEFAULT.delayMax) ok = false;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  const spread = (hi - lo) / (E.DEFAULT.delayMax - E.DEFAULT.delayMin);
  check('C every delay in window; window actually used',
    ok && spread > 0.95, lo + '..' + hi + 'ms, spread ' + (spread * 100).toFixed(0) + '%');
}

// D: independence -------------------------------------------------------------------
{
  // In no race should the field be all-yes or all-no more often than
  // the binomial extremes allow; over 3000 races with 11 pilots at
  // 0.3, all-yes is ~0 and all-no ~2%. Mostly: mixed fields.
  let allYes = 0, allNo = 0, mixed = 0;
  const N = 3000;
  for (let s = 0; s < N; s++) {
    const p = E.plan(s * 31337 + 7, FIELD);
    const n = FIELD.filter(k => p[k].responds).length;
    if (n === FIELD.length) allYes++;
    else if (n === 0) allNo++;
    else mixed++;
  }
  check('D independent rolls: mixed fields dominate',
    allYes === 0 && allNo / N < 0.05 && mixed / N > 0.9,
    'mixed ' + (100 * mixed / N).toFixed(1) + '%, silent ' + (100 * allNo / N).toFixed(1) + '%');
}

// E: the personality socket -----------------------------------------------------------
{
  E.PILOTS['Never'] = { chance: 0, delayMin: 100, delayMax: 200 };
  E.PILOTS['Always'] = { chance: 1, delayMin: 100, delayMax: 200 };
  let ok = true;
  for (let s = 0; s < 500; s++) {
    const p = E.plan(s * 977 + 1, ['Never', 'Always']);
    if (p['Never'].responds) ok = false;
    if (!p['Always'].responds) ok = false;
    if (p['Always'].delayMs < 100 || p['Always'].delayMs > 200) ok = false;
  }
  delete E.PILOTS['Never'];
  delete E.PILOTS['Always'];
  check('E overrides bind: chance 0/1 and a custom delay window', ok);
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);