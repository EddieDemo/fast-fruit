(function () {
'use strict';
// ============================================================
// FINISH LINE — real times for everyone, without the wait.
//
// THE BUG THIS EXISTS TO FIX: standings are captured the instant the
// PLAYER crosses, so every racer still on track stamps no time at
// all. A missing time counted as zero in the cup's cumulative-time
// tiebreak, which meant the melons who did WORST scored best on it —
// the exact inversion of what the tiebreak is for.
//
// THE FIX: when the player finishes, fast-forward the rest of the
// race on a CLONE of the world — the same laws, the same seeded
// terrain, the same brains, just no rendering — and read off each
// body's real finish tick. The numbers are identical to what waiting
// would produce, because it IS the same simulation; the player simply
// does not have to sit through it.
//
// WHY NOT ESTIMATE from remaining distance and current pace: it would
// invent numbers that disagree with the race still visibly running
// behind the results panel. Measured or nothing.
//
// THE CLONE IS NON-NEGOTIABLE. This runs mid-frame, in the middle of
// a live race that continues behind the panel (the autopilot keeps
// the field going). Stepping the real state here would double-step
// the world. Same discipline as the splat predictor.
//
// DNF: a body that cannot finish inside a generous budget is marked
// did-not-finish and given the WORST time rather than none — the
// zero-instead-of-worst inversion is the whole bug. Its POSITION is
// still honest, because position comes from distance, which is always
// defined.
//
// The player is never DNF'd: this only runs once they have crossed.
// ============================================================

const MAX_TICKS = 120 * 180;   // three minutes of race time, generous
const DNF_TIME = 1e6;          // sorts last in any time comparison

// Copy just enough of the world to keep stepping it. Bodies are
// plain scalar objects; brains are re-created rather than shared, so
// the clone's decisions cannot leak into the live race.
function cloneWorld(state) {
  const FF = window.FF;
  const clone = {
    tick: state.tick,
    terrain: state.terrain,          // read-only during a step
    period: state.period,
    raceStartX: state.raceStartX,
    raceStartTick: state.raceStartTick,
    localSlot: state.localSlot,
    race: Object.assign({}, state.race),
    fx: { flash: 0, shake: 0 },
    telemetry: {},
    input: Object.assign({}, state.input),
    players: [],
    bots: [],
  };
  for (const pl of state.players) {
    const melon = Object.assign({}, pl.melon);
    clone.players.push({
      melon,
      prevMelon: Object.assign({}, melon),
      input: Object.assign({}, pl.input),
    });
  }
  clone.melon = clone.players[clone.localSlot] ? clone.players[clone.localSlot].melon : clone.players[0].melon;
  clone.prevMelon = clone.players[0].prevMelon;
  for (const b of state.bots) {
    const melon = Object.assign({}, b.melon);
    clone.bots.push({
      melon,
      prevMelon: Object.assign({}, melon),
      input: Object.assign({}, b.input),
      brainName: b.brainName,
      // A FRESH brain instance, loaded with the live one's state: the
      // clone must think exactly what the real bot thinks right now,
      // without sharing the object it thinks with.
      brain: (FF.pilot && FF.pilot.create) ? (() => {
        const br = FF.pilot.create(b.brainName || 'cruise');
        if (br.load && b.brain && b.brain.save) br.load(b.brain.save());
        return br;
      })() : null,
    });
  }
  return clone;
}

// Fast-forward until everyone has finished or the budget runs out.
// Returns a map of name -> { timeSec, dnf }, plus the player's own.
function resolve(state, opts) {
  const FF = window.FF;
  const race = state.race;
  if (!race || race.mode !== 'track' || !race.lapLengthPx || !race.laps) return null;
  const hz = (FF.CONFIG && FF.CONFIG.physicsHz) || 120;
  const provider = opts && opts.provider;

  const clone = cloneWorld(state);
  const bodies = [clone.melon].concat(clone.bots.map(b => b.melon));
  const target = race.lapLengthPx * race.laps;

  // Anyone already stamped keeps their real time; the rest are chased.
  const done = new Map();
  let outstanding = 0;
  for (const m of bodies) {
    if (m.finishTick !== undefined && m.finishTick !== null) {
      done.set(m, m.finishTick);
    } else {
      outstanding++;
    }
  }

  let steps = 0;
  while (outstanding > 0 && steps < MAX_TICKS) {
    if (provider) {
      let lo = bodies[0].x, hi = bodies[0].x;
      for (const m of bodies) { if (m.x < lo) lo = m.x; if (m.x > hi) hi = m.x; }
      provider.update(lo - 2600, hi + 3600);
      clone.terrain = [provider.pts];
    }
    FF.step(clone, 1 / hz);
    steps++;
    for (const m of bodies) {
      if (done.has(m)) continue;
      if ((m.x - clone.raceStartX) >= target) {
        done.set(m, clone.tick);
        outstanding--;
      }
    }
  }

  // Report by NAME: the caller matches these onto its standings rows,
  // and the clone's bodies are not the live ones.
  const out = { byName: {}, player: null, steps, dnf: 0 };
  bodies.forEach((m, i) => {
    const tick = done.has(m) ? done.get(m) : null;
    const rec = tick === null
      ? { timeSec: DNF_TIME, dnf: true }
      : { timeSec: (tick - clone.raceStartTick) / hz, dnf: false };
    if (rec.dnf) out.dnf++;
    if (i === 0) out.player = rec;
    if (m.name) out.byName[m.name] = rec;
  });
  return out;
}

window.FF.finishLine = { resolve, cloneWorld, MAX_TICKS, DNF_TIME };
})();