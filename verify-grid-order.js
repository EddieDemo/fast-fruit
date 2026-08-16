// verify-grid-order.js
// The grid-order law, headless.
//   A. No order: player slots LAST, everyone else keeps relative
//      order in the front slots — leg 1, practice, any fresh race.
//   B. With an order: slot = finishing position for every matched
//      key, player included, no special case; pole = the winner.
//   C. Keys the order does not know append behind the matched field,
//      relative order kept (cast drift safety).
//   D. cup.gridOrder: null before any leg; after a leg it is that
//      leg's finishing order (pos-sorted keys); after another leg it
//      is the NEWER order; null again for a fresh cup.
//   E. applyGridSlots places real bodies: x strictly decreases with
//      slot (slot 0 nearest the line) and prev snapshots match, so
//      the first frame cannot interpolate across the grid.

global.window = { FF: {} };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
require('./js/dmath.js');
require('./js/config.js');
require('./js/fruits.js');
require('./js/state.js');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

const F = window.FF;

// A: default — player last ------------------------------------------------
{
  const keys = ['You', 'A', 'B', 'C'];
  const slots = F.computeGridSlots(keys, null, 0);
  check('A no order: player last, rest keep order',
    slots.join(',') === '3,0,1,2', slots.join(','));
}

// B: finish order, no special case ------------------------------------------
{
  const keys = ['You', 'A', 'B', 'C'];               // players[0]=You, bots A,B,C
  const order = ['B', 'You', 'C', 'A'];              // B won the last leg
  const slots = F.computeGridSlots(keys, order, 0);
  // B->0 (pole), You->1, C->2, A->3
  check('B order slots by finish, winner on pole, player mid-grid',
    slots.join(',') === '1,3,0,2', slots.join(','));
}

// C: unmatched appends -----------------------------------------------------
{
  const keys = ['You', 'A', 'Newcomer', 'B', 'Stranger'];
  const order = ['B', 'You', 'A'];
  const slots = F.computeGridSlots(keys, order, 0);
  // matched: B->0, You->1, A->2; unmatched Newcomer, Stranger -> 3, 4
  check('C unmatched keys append behind, relative order kept',
    slots.join(',') === '1,2,3,0,4', slots.join(','));
}

// D: cup order round-trip -----------------------------------------------------
{
  require('./js/terrain.js');
  // cup.js needs the track registry at begin(); shim the minimum.
  window.FF.dailyCupTracks = window.FF.dailyCupTracks || (() => ['T', 'T #2', 'T #3']);
  window.FF.dailyTrackName = window.FF.dailyTrackName || (() => 'T');
  window.FF.trackDefByName = window.FF.trackDefByName || (() => ({ seed: 42 }));
  require('./js/cup.js');
  const C = window.FF.cup;
  C.begin(new Date());
  const ok0 = C.gridOrder() === null;
  const rows = (o) => o.map((k, i) => ({ key: k, pilot: k, name: k + 'melon',
    pos: i + 1, timeSec: 100 + i, isPlayer: k === 'You' }));
  C.completeLeg({ place: 2, fieldSize: 4, timeSec: 101, standings: rows(['B', 'You', 'C', 'A']) });
  const o1 = C.gridOrder();
  C.completeLeg({ place: 1, fieldSize: 4, timeSec: 99, standings: rows(['You', 'B', 'A', 'C']) });
  const o2 = C.gridOrder();
  check('D gridOrder: null, then leg 1 order, then leg 2 order',
    ok0 && o1.join(',') === 'B,You,C,A' && o2.join(',') === 'You,B,A,C',
    (o1 || []).join(',') + ' -> ' + (o2 || []).join(','));
}

// E: real bodies, real placement ------------------------------------------------
{
  const state = F.createState();
  state.terrain = [[]];                              // no terrain: fallback y
  F.resetPlayers(state, 1, 0, 0, -300, true);
  F.resetBots(state, 3, 0, -300, 12345, 1, null);
  // name the field so keys exist
  state.melon.pilot = 'You';
  state.bots[0].melon.pilot = 'A';
  state.bots[1].melon.pilot = 'B';
  state.bots[2].melon.pilot = 'C';
  const keys = [state.melon, state.bots[0].melon, state.bots[1].melon, state.bots[2].melon]
    .map(m => F.racerKey(m));
  const slots = F.computeGridSlots(keys, ['C', 'B', 'You', 'A'], 0);
  F.applyGridSlots(state, slots, 0, -300);
  const bodies = [state.melon, state.bots[0].melon, state.bots[1].melon, state.bots[2].melon];
  // slot order C(0) B(1) You(2) A(3): x must strictly decrease with slot
  const bySlot = slots.map((s, i) => ({ s, x: bodies[i].x })).sort((a, b) => a.s - b.s);
  let mono = true;
  for (let i = 1; i < bySlot.length; i++) if (bySlot[i].x >= bySlot[i - 1].x) mono = false;
  const prevOk = state.players[0].prevMelon.x === state.melon.x
    && state.bots.every(b => b.prevMelon.x === b.melon.x);
  check('E applyGridSlots: x decreases with slot, prev snapshots synced',
    mono && prevOk, bySlot.map(r => r.x.toFixed(0)).join(' > '));
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);