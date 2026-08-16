// verify-rewards.js
// The grant-at-finish plumbing, headless. Screens are stage 4; every
// FACT they will present is verified here.
//   A. Queue: push/peek/shift round-trip through a TRUE reload;
//      shift on empty is null and saves nothing.
//   B. takeReward pulls the first entry of a kind from anywhere in
//      the queue and leaves the rest in order.
//   C. settleLevelRolls: xp crossing N levels fires exactly N rolls,
//      each granted and queued, rolledLevel catches up — including
//      across a simulated abandon (xp banked, settle deferred).
//   D. Full collection: settle still consumes the level, queues
//      nothing, and never stalls.
//   E. The xp card snapshot: from/to/levels agree with xp.js when
//      built the way flow.js builds it.
//   F. No level ever skips its roll: interleaved addXp/settle in
//      ragged chunks still rolls every level exactly once.

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
const X = window.FF.xp;
const D = window.FF.decals;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

function fresh(salt) {
  const st = { v: 1, salt, active: 0,
    player: { name: 'T', xp: 0, rolledLevel: 1 },
    melons: [{ v: 1, seed: 42, name: 'T', born: '2026-08-15', record: {} }],
    decals: [], rewards: [], eraRoll: true };
  localStorage.setItem('ff-stable', JSON.stringify(st));
  M._reload();
}

// A: queue round-trip -----------------------------------------------------
{
  fresh(101);
  M.queueReward({ kind: 'xp', from: 0, to: 56 });
  M.queueReward({ kind: 'decal', id: 'flag-fr' });
  M._reload();
  const q = M.pendingRewards();
  const ok1 = q.length === 2 && q[0].kind === 'xp' && q[1].id === 'flag-fr';
  const e1 = M.shiftReward();
  M._reload();
  const ok2 = e1.kind === 'xp' && M.pendingRewards().length === 1;
  M.shiftReward();
  const ok3 = M.shiftReward() === null && M.pendingRewards().length === 0;
  check('A queue push/shift persists through true reloads', ok1 && ok2 && ok3);
}

// B: takeReward ---------------------------------------------------------------
{
  fresh(102);
  M.queueReward({ kind: 'xp', n: 1 });
  M.queueReward({ kind: 'decal', n: 2 });
  M.queueReward({ kind: 'melon', n: 3 });
  M.queueReward({ kind: 'decal', n: 4 });
  const got = M.takeReward('melon');
  M._reload();
  const rest = M.pendingRewards().map(e => e.n).join(',');
  check('B takeReward pulls mid-queue, order preserved',
    got && got.n === 3 && rest === '1,2,4' && M.takeReward('melon') === null, rest);
}

// C: settle catch-up across an abandon -------------------------------------------
{
  fresh(103);
  // cup 1: races bank 14 (two legs), player abandons — no settle
  M.addXp(14);
  // cup 2 completes: legs + completion + points
  M.addXp(21 + 10 + 25);                           // total 70 -> level 2 (50)
  const before = M.pendingRewards().length;
  const q1 = M.settleLevelRolls();
  M._reload();
  const st1 = JSON.parse(localStorage.getItem('ff-stable'));
  const ok1 = q1.length === 1 && st1.player.rolledLevel === 2
    && M.hasDecal(q1[0].id) && M.pendingRewards().length === before + 1;
  // big jump: +255 -> total 325 -> L4 (50+75+100=225), two more rolls
  M.addXp(255);
  const q2 = M.settleLevelRolls();
  const ids = q2.map(e => e.id);
  const ok2 = q2.length === 2 && ids[0] !== ids[1]
    && q2[0].level === 3 && q2[1].level === 4
    && ids.every(id => M.hasDecal(id));
  check('C settle fires one granted roll per level, catches up after abandon',
    ok1 && ok2, q1.concat(q2).map(e => 'L' + e.level + ':' + e.id).join(' '));
}

// D: full collection settles without stalling --------------------------------------
{
  fresh(104);
  for (const it of D.ALL) M.grantDecal(it.id);
  M.addXp(500);                                    // several levels
  const q = M.settleLevelRolls();
  const st = JSON.parse(localStorage.getItem('ff-stable'));
  check('D full collection: levels consumed, nothing queued',
    q.length === 0 && st.player.rolledLevel === X.levelFor(500)
    && M.pendingRewards().length === 0,
    'rolledLevel=' + st.player.rolledLevel);
}

// E: the xp card snapshot, built the flow.js way ---------------------------------------
{
  fresh(105);
  const from = M.pilotXp();                        // xpStart at the gun
  M.addXp(X.XP_RACE * 3);                          // three legs
  M.addXp(X.XP_CUP + X.XP_PER_POINT * 20);         // completion, median points
  const to = M.pilotXp();
  M.queueReward({ kind: 'xp', from, to, added: to - from,
    levelFrom: X.levelFor(from), levelTo: X.levelFor(to) });
  const e = M.pendingRewards()[0];
  check('E xp card snapshot: 51 added, level 1 -> 2',
    e.added === 51 && e.from === 0 && e.to === 51
    && e.levelFrom === 1 && e.levelTo === 2);
}

// F: ragged interleaving never skips or doubles a roll ---------------------------------
{
  fresh(106);
  const seen = new Map();                          // level -> count
  const chunks = [13, 7, 60, 200, 5, 199, 88, 111, 40, 320];
  for (const c of chunks) {
    M.addXp(c);
    if (c % 2) {                                   // settle only sometimes
      for (const e of M.settleLevelRolls()) seen.set(e.level, (seen.get(e.level) || 0) + 1);
    }
  }
  for (const e of M.settleLevelRolls()) seen.set(e.level, (seen.get(e.level) || 0) + 1);
  const finalLevel = X.levelFor(M.pilotXp());
  // every level 2..min(final, drainable) rolled at most once; count of
  // rolls equals granted decals; no level counted twice
  const doubles = [...seen.values()].some(v => v !== 1);
  const st = JSON.parse(localStorage.getItem('ff-stable'));
  check('F ragged settle: every level rolls exactly once',
    !doubles && st.player.rolledLevel === finalLevel
    && M.ownedDecals().length === seen.size,
    [...seen.keys()].sort((a, b) => a - b).join(',') + ' of L' + finalLevel);
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);
