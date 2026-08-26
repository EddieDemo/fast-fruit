// PARTY CUP — the wrapper (2026-08-25).
//
// Three party events drawn from the pool, scored on the race cup's
// own points law, rewarded through the race cup's own endpoints.
// TONIGHT'S POOL IS ONE EVENT (Ski Jump ×3, ruled: no differentiation
// yet) — the draw machinery is real, its pool is small.
//
// SEPARATION: this module owns cup STATE and leg sequencing. Events
// own their worlds (skijump.js); the chassis owns scoring mechanics
// (session.js); rewards go through melon.js/xp.js — the SAME doors
// the race cup walks through ("do whatever the race cup does",
// ruled): XP_RACE banks per completed leg, XP_CUP + recordCup at
// completion, via cup.pointsFor for the leg points.
//
// STATED STAND-IN: the final screen mirrors the race finish at the
// places-rows level (place, name, pilot, per-leg bests, points);
// the full tabbed finish with relevance filtering is next session's
// work, designed (tabs declare their data; absent data, absent tab).
(function () {
'use strict';
if (typeof window === 'undefined') return;
window.FF = window.FF || {};

const LEGS = 3;
const DUR_TICKS = 2 * 60 * 120;   // two minutes (Eddie's ruling)

// THE LEG CONTRACT (2026-08-26): the cup sequences EVENT ADAPTERS and
// never knows whether a leg was a session or a race — the same move
// the chassis made with metric adapters, one level up. An adapter:
//   id           unique string
//   start(opts)  build the world and go ({ seed, durTicks })
//   isOver(st)   true when this leg has ended
//   standings(st) -> rows [{ key, name, pilot, isPlayer, place,
//                bestStr }] sorted by place
// A SESSION event answers from the chassis (skijump's adapter is the
// pattern). A RACE event (Wrong Way, when it lands) answers from
// race.finishedTick and flow.computeStandings — same contract, other
// resolution, which is the whole point.
const EVENTS = {};
function registerEvent(a) {
  if (!a || !a.id || typeof a.start !== 'function'
    || typeof a.isOver !== 'function' || typeof a.standings !== 'function') {
    throw new Error('partycup: malformed event adapter');
  }
  EVENTS[a.id] = a;
  return a.id;
}

// The draw: curated by slot when the pool grows; today every slot
// draws the one event we have.
const POOL = ['skijump'];
function drawEvent() { return POOL[0]; }

let cup = null;   // { leg, legRows: [][], points: {key: n}, handledOver }

function begin() {
  // ONE CUP SEED, per-leg derivation: three games, three hills, three
  // skies — different from each other, deterministic per cup.
  cup = { leg: 0, legRows: [], points: {},
    eventIds: [], seed: (Math.random() * 0x7fffffff) | 0 };
  startLeg();
}

function legSeed() {
  return (window.FF.mulberry32((cup.seed ^ ((cup.leg + 1) * 0x9e3779b9)) >>> 0)()
    * 0x7fffffff) | 0;
}

function startLeg() {
  const ev = drawEvent();
  cup.eventIds[cup.leg] = ev;
  EVENTS[ev].start({ durTicks: DUR_TICKS, seed: legSeed() });
}

// Pure: fold one leg's rows into the running points table.
// Exported for the suite; the race cup's own pointsFor is the law.
function foldLeg(points, rows, fieldSize) {
  for (const r of rows) {
    points[r.key] = (points[r.key] || 0)
      + window.FF.cup.pointsFor(r.place, fieldSize);
  }
  return points;
}

// Pure: final table from the points map, ties by best single-leg
// place (then name, for total order).
function finalTable(points, legRows) {
  const bestPlace = {};
  for (const rows of legRows) {
    for (const r of rows) {
      if (bestPlace[r.key] === undefined || r.place < bestPlace[r.key]) {
        bestPlace[r.key] = r.place;
      }
    }
  }
  const keys = Object.keys(points);
  keys.sort((a, b) => (points[b] - points[a])
    || (bestPlace[a] - bestPlace[b]) || (a < b ? -1 : 1));
  return keys.map((k, i) => ({ key: k, place: i + 1, points: points[k] }));
}

// The party points table, in the shared screen's language: running
// order between games, the final order at the end (same tie law).
function cupRows() {
  const table = finalTable(cup.points, cup.legRows);
  return table.map((t) => {
    const who = nameOf(t.key);
    return {
      place: t.place, name: who.name, pilot: who.pilot,
      isPlayer: who.isPlayer, points: t.points, bests: bestsOf(t.key),
    };
  });
}

function onLegOver(st) {
  const rows = EVENTS[cup.eventIds[cup.leg]].standings(st);
  cup.legRows.push(rows);
  foldLeg(cup.points, rows, rows.length);
  // XP BANKS AT THE LEG, the race cup's own rule: a completed session
  // is a finished leg (sessions cannot DNF — the clock always ends).
  const M = window.FF.melon;
  if (M && M.addXp && window.FF.xp) M.addXp(window.FF.xp.XP_RACE);
  cup.leg++;
  if (cup.leg < LEGS) {
    // PLAYER-PACED (ruled 2026-08-26): the race cup's own law. The
    // shared finish screen shows this game's standings; NEXT GAME
    // advances. The standings get a moment to be read.
    window.FF.flow.showSessionFinish({
      title: 'GAME ' + cup.leg + ' \u00b7 RESULTS',
      note: 'party cup \u00b7 game ' + cup.leg + ' of ' + LEGS,
      nextLabel: 'NEXT GAME',
      cupRows: cupRows(),
      onNext: () => startLeg(),
    });
    return;
  }
  complete(st);
}

function complete(st) {
  const table = finalTable(cup.points, cup.legRows);
  const meKey = window.FF.racerKey(st.players[0].melon);
  const mine = table.find((r) => r.key === meKey);
  const M = window.FF.melon;
  // THE SAME COMPLETION DOORS AS THE RACE CUP: recordCup with the
  // player's place in the cup's own table, and XP_CUP on top of the
  // per-leg banks. Nothing party-specific is invented here.
  if (M && M.recordCup && mine) M.recordCup({ place: mine.place, points: mine.points });
  if (M && M.addXp && window.FF.xp) M.addXp(window.FF.xp.XP_CUP);
  // THE FINAL IS THE SHARED SCREEN TOO (2026-08-26; the bespoke
  // overlay retired): CUP tab leads with the final table, PLACES
  // holds game 3, RUN IT BACK / MAIN MENU in the standard foot.
  window.FF.flow.showSessionFinish({
    title: 'PARTY CUP \u00b7 FINAL',
    note: (mine ? ordWord(mine.place) + ' \u00b7 ' + mine.points + ' pts \u00b7 ' : '')
      + LEGS + ' games',
    final: true,
    cupRows: cupRows(),
    onRetry: () => begin(),
    onMenu: () => {
      cup = null;
      window.FF.world.toDaily();
      window.FF.flow.go('menu');
    },
  });
}

function ordWord(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- Presentation ------------------------------------------------
// SIGNALS, not polling (refactor step 4, 2026-08-26): the frame
// boundary announces 'session:over' exactly once per session; the
// cup subscribes. The rAF watcher, the FF._state reach-in and the
// handledOver latch died here — the bus's once-per-end guarantee IS
// the latch. isOver stays on the leg contract for race-legs, whose
// announcement ('race:over', when Wrong Way lands) arrives the same
// way.
function onSessionOver(payload, state) {
  if (!cup) return;
  const ev = EVENTS[cup.eventIds[cup.leg]];
  if (ev && ev.isOver(state)) onLegOver(state);
}

function nameOf(key) {
  for (const rows of cup.legRows) {
    for (const r of rows) if (r.key === key) return r;
  }
  return { name: '?', pilot: '', isPlayer: false };
}

function bestsOf(key) {
  return cup.legRows.map((rows) => {
    const r = rows.find((q) => q.key === key);
    return r ? r.bestStr : '\u2014';
  });
}

// (showFinal — the final-podium overlay — retired 2026-08-26: the
// final walks the shared finish screen like every other result.)

if (window.FF.events) window.FF.events.on('session:over', onSessionOver);

window.FF.partycup = {
  begin, registerEvent, LEGS, DUR_TICKS,
  _foldLeg: foldLeg, _finalTable: finalTable,
  // The functional-harness door (the if(false) lesson: text pins
  // cannot catch behavioural disabling; the suite drives these).
  _test: {
    onLegOver, complete,
    events: EVENTS,
    getCup: () => cup,
    setCup: (c) => { cup = c; },
    pool: POOL,
  },
};
})();
