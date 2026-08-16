// verify-xp.js
// The pilot progression law, held to its own stated claims.
//   A. The table is what the design ruled: 5 / 10 / 1, curve
//      50 + 25*(L-1) capped at 200.
//   B. Curve shape: costs strictly rise to the cap, then hold exactly.
//   C. levelFor and progress agree with each other and with a naive
//      re-derivation, across the whole early curve and beyond the cap.
//   D. The design's spread claims hold in the cup's real arithmetic:
//      completed-cup xp is 34 for last-everywhere, 78 for a sweep
//      (2.3x), and a median cup (~26 pts) pays ~56.
//   E. First level lands inside a median player's first cup; even the
//      slowest player levels within three.
//   F. cupXp: abandoned cups pay per-race base only; points bank only
//      with completion; garbage inputs clamp sane.
//   G. Storage: addXp clamps, accumulates, persists, and reports
//      level gains exactly once each.

global.window = { FF: {} };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
require('./js/dmath.js');
require('./js/terrain.js');   // mulberry32 for melon.js
require('./js/decals.js');
require('./js/xp.js');
require('./js/melon.js');

const X = window.FF.xp;
const M = window.FF.melon;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

// A: the table -----------------------------------------------------------
check('A the ruled table', X.XP_RACE === 7 && X.XP_CUP === 10 && X.XP_PER_POINT === 1
  && X.XP_BASE === 50 && X.XP_RAMP === 25 && X.XP_CAP === 200);

// B: curve shape -----------------------------------------------------------
{
  let ok = X.costFrom(1) === 50;
  let capAt = null;
  for (let L = 1; L < 40; L++) {
    const c = X.costFrom(L), n = X.costFrom(L + 1);
    if (n < c) ok = false;                          // never falls
    if (c === X.XP_CAP && capAt === null) capAt = L;
    if (capAt !== null && c !== X.XP_CAP) ok = false; // holds forever after
  }
  check('B costs rise to the cap then hold', ok && capAt === 7, 'cap engages at L' + capAt);
}

// C: derivation invariants ---------------------------------------------------
{
  let ok = true;
  let spent = 0, lvl = 1;
  for (let xp = 0; xp <= 5000; xp++) {
    if (xp === spent + X.costFrom(lvl)) { spent += X.costFrom(lvl); lvl++; }
    const p = X.progress(xp);
    if (X.levelFor(xp) !== lvl) { ok = false; break; }
    if (p.level !== lvl || p.into !== xp - spent || p.need !== X.costFrom(lvl)) { ok = false; break; }
  }
  check('C levelFor/progress agree with naive walk to 5000xp', ok);
}

// D: the spread claims, in cup arithmetic -----------------------------------
{
  // 3 races, 12 racers, points = 13 - place per race
  const last = X.cupXp(3, true, 3 * 1);
  const sweep = X.cupXp(3, true, 3 * 12);
  const median = X.cupXp(3, true, 20);
  check('D spread: 34 floor, 67 ceiling, ~51 median',
    last === 34 && sweep === 67 && median === 51,
    last + ' / ' + median + ' / ' + sweep + '  ratio ' + (sweep / last).toFixed(2) + 'x');
}

// E: first-level pacing -------------------------------------------------------
{
  const median = X.cupXp(3, true, 20);
  const worst = X.cupXp(3, true, 3);
  check('E first level inside 1 median cup, 2 worst cups',
    median >= X.costFrom(1) && 2 * worst >= X.costFrom(1),
    'median ' + median + ' vs cost 50; worst 2x' + worst);
}

// F: cupXp edges ----------------------------------------------------------------
{
  const ok = X.cupXp(2, false, 19) === 14          // abandoned: 2 races, no cup, no points
    && X.cupXp(0, false, 0) === 0
    && X.cupXp(3, false, 36) === 21                // legs raced but cup not counted
    && X.cupXp(2.9, true, 7.9) === X.cupXp(2, true, 7);   // integer clamp
  check('F abandoned cups pay base only; points need completion', ok);
}

// G: storage round-trip ------------------------------------------------------------
{
  M._reload();
  const ok0 = M.pilotXp() === 0;
  const r1 = M.addXp(51);
  const ok1 = r1.added === 51 && r1.xp === 51 && r1.level === 2 && r1.levelsGained === 1;
  const r2 = M.addXp(56);                          // 107 total -> L2 spans 50..124
  const ok2 = r2.level === 2 && r2.levelsGained === 0;
  const r3 = M.addXp(-40);                         // clamps to 0
  const ok3 = r3.added === 0 && r3.xp === 107;
  M._reload();                                     // TRUE reload from storage
  const ok4 = M.pilotXp() === 107;
  const r5 = M.addXp(205);                         // 312 -> spent 50+75+100=225, L4
  const ok5 = r5.level === 4 && r5.levelsGained === 2;
  check('G addXp clamps, accumulates, persists, reports gains',
    ok0 && ok1 && ok2 && ok3 && ok4 && ok5,
    'xp=' + M.pilotXp() + ' level=' + window.FF.xp.levelFor(M.pilotXp()));
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);
