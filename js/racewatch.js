(function () {
'use strict';
// ============================================================
// RACEWATCH — the producer of RACE events (element three).
//
// Everything so far has commentated VIOLENCE (deaths, near-misses),
// which physics announces at the moment of impact. Racing itself has
// no such moment: places, gaps and streaks are continuous quantities,
// and turning them into events is a judgement call about what counts
// as news. That judgement lives here, in one module, so the ticker
// stays a dumb formatter and physics stays untouched.
//
// It reads state once per frame and emits on the bus:
//   'overtake'  { name, place, gained }   a pass that STUCK
//   'lead'      { name }                  the lead changed hands
//   'lap'       { lap, ticks, best }      a lap completed
//   'streak'    { metres }                distance since your last death
//
// THE NOISE PROBLEM IS THE WHOLE PROBLEM. Places swap constantly in a
// bouncing pack; a naive "place changed" emitter would fire dozens of
// times a lap and the ticker would become wallpaper (the lesson the
// coach line already taught). Three defences:
//   1. HYSTERESIS — a pass must hold for SETTLE_TICKS before it is
//      called. Bodies trading places mid-bounce are not overtakes.
//   2. PLAYER-CENTRIC — only passes involving the local player are
//      news. Two bots swapping 5th and 6th is not a story.
//   3. COOLDOWN + PRIORITY — at most one line per window, and taking
//      the lead outranks a routine pass.
//
// Presentation tier: reads state, writes only to the bus. The sim
// never reads any of it, so peers may legitimately see different
// commentary with no divergence risk.
// ============================================================

const SETTLE_TICKS = 36;      // 0.3s — a pass must stick to count
const OVERTAKE_GAP_TICKS = 150; // 1.25s between overtake lines
const STREAK_STEP_M = 250;    // milestone spacing for a clean run

let lastPlace = null;         // player's last CONFIRMED place
let pendingPlace = null;      // a place we're waiting to see stick
let pendingSince = 0;
let lastOvertakeTick = -1e9;
let lastLapIndex = 0;
let streakBaseX = null;       // x where the current clean run began
let streakNext = STREAK_STEP_M;
let wasAlive = true;

function emit(type, data, state) {
  const bus = window.FF.events;
  if (bus) bus.emit(type, data, state);
}

// The field, ranked by true race progress (absolute x, same rule the
// renderer's place labels use — a body a lap ahead really is ahead).
function rank(state) {
  const all = [];
  for (const pl of state.players) all.push(pl.melon);
  for (const b of state.bots) all.push(b.melon);
  all.sort((a, b) => b.x - a.x);
  return all;
}

function update(state) {
  if (!state || !state.melon) return;
  const me = state.melon;
  const field = rank(state);
  const place = field.indexOf(me) + 1;
  if (place <= 0) return;
  const tick = state.tick;

  // ---- Death resets the streak; respawn starts a new one ----
  if (wasAlive && !me.alive) {
    streakBaseX = null;
    streakNext = STREAK_STEP_M;
  } else if (!wasAlive && me.alive) {
    streakBaseX = me.x;
  }
  wasAlive = me.alive;
  if (streakBaseX === null && me.alive) streakBaseX = me.x;

  // ---- Overtakes: only when the new place has HELD ----
  if (lastPlace === null) {
    lastPlace = place;
  } else if (place !== lastPlace) {
    if (pendingPlace !== place) { pendingPlace = place; pendingSince = tick; }
    else if (tick - pendingSince >= SETTLE_TICKS) {
      const gained = lastPlace - place;   // +ve = moved up
      const rival = field[place - (gained > 0 ? 0 : 2)]; // whom we swapped with
      const takingLead = place === 1 && gained > 0;
      // PRIORITY: taking the lead is the biggest moment in a race and
      // must never be swallowed by the routine-pass cooldown — which
      // is exactly what happened when a lead change followed hard on
      // an ordinary overtake (caught in test). Routine passes that
      // land inside the cooldown are simply dropped: by the time the
      // window clears they are stale news, and a queue of late
      // overtake lines reads worse than silence.
      if (me.alive && (takingLead || tick - lastOvertakeTick >= OVERTAKE_GAP_TICKS)) {
        lastOvertakeTick = tick;
        if (takingLead) {
          emit('lead', { name: me.name || 'YOU' }, state);
        } else {
          emit('overtake', {
            name: (rival && rival.name) || '',
            place, gained: gained > 0,
          }, state);
        }
      }
      lastPlace = place;
      pendingPlace = null;
    }
  } else {
    pendingPlace = null;
  }

  // ---- Laps: read the race's own book, don't recount ----
  const race = state.race;
  if (race && race.mode === 'track' && race.lapIndex > lastLapIndex) {
    lastLapIndex = race.lapIndex;
    const n = race.splits.length;
    if (n > 0) {
      const ticks = race.splits[n - 1];
      emit('lap', {
        lap: race.lapIndex,
        ticks,
        best: race.bestLapTicks !== null && ticks <= race.bestLapTicks,
      }, state);
    }
  }

  // ---- Clean-run streaks ----
  if (me.alive && streakBaseX !== null) {
    const metres = (me.x - streakBaseX) / 100;
    if (metres >= streakNext) {
      emit('streak', { metres: streakNext }, state);
      streakNext += STREAK_STEP_M;
    }
  }
}

function reset() {
  lastPlace = null; pendingPlace = null; pendingSince = 0;
  lastOvertakeTick = -1e9; lastLapIndex = 0;
  streakBaseX = null; streakNext = STREAK_STEP_M; wasAlive = true;
}

window.FF.raceWatch = { update, reset };
})();