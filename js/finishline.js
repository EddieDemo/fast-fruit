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

// ---- AMORTISED, NOT BLOCKING --------------------------------------
// Running the whole fast-forward in one frame is up to three minutes
// of simulated race time on a phone: a synchronous block, during
// which NOTHING renders. A fade started just before it would paint
// once and then freeze mid-fade, which reads as broken rather than
// busy — worse than the plain stall it was meant to hide.
//
// So the work is a JOB: begin() clones the world, pump() advances it
// by a tick budget each frame, and report() reads off the times when
// it is done. The world carries on rendering (and the autopilot keeps
// the field racing) while the clone runs ahead of it, so the
// resolution is invisible.
//
// A worker would be truly parallel, but the sim is a pile of
// window.FF modules and would need a build step to run in one; the
// budget approach is contained and costs nothing structural.
const TICKS_PER_FRAME = 400;   // ~1-2ms of stepping on a phone

let job = null;

function begin(state, opts) {
  const FF = window.FF;
  const race = state.race;
  if (!race || race.mode !== 'track' || !race.lapLengthPx || !race.laps) { job = null; return null; }
  const clone = cloneWorld(state);
  const bodies = [clone.melon].concat(clone.bots.map(b => b.melon));
  const done = new Map();
  let outstanding = 0;
  // Anyone already stamped keeps their real time; the rest are chased.
  for (const m of bodies) {
    if (m.finishTick !== undefined && m.finishTick !== null) done.set(m, m.finishTick);
    else outstanding++;
  }
  job = {
    clone, bodies, done, outstanding, steps: 0,
    target: race.lapLengthPx * race.laps,
    provider: (opts && opts.provider) || null,
    hz: (FF.CONFIG && FF.CONFIG.physicsHz) || 120,
  };
  return job;
}

// Advance the job. Returns true when there is nothing left to do.
function pump(budget) {
  if (!job) return true;
  const FF = window.FF;
  const { clone, bodies, done, provider, hz, target } = job;
  const limit = budget || TICKS_PER_FRAME;
  let n = 0;
  while (job.outstanding > 0 && job.steps < MAX_TICKS && n < limit) {
    if (provider) {
      let lo = bodies[0].x, hi = bodies[0].x;
      for (const m of bodies) { if (m.x < lo) lo = m.x; if (m.x > hi) hi = m.x; }
      provider.update(lo - 2600, hi + 3600);
      clone.terrain = [provider.pts];
    }
    FF.step(clone, 1 / hz);
    job.steps++; n++;
    for (const m of bodies) {
      if (done.has(m)) continue;
      if ((m.x - clone.raceStartX) >= target) {
        done.set(m, clone.tick);
        job.outstanding--;
      }
    }
  }
  return job.outstanding === 0 || job.steps >= MAX_TICKS;
}

function isDone() { return !job || job.outstanding === 0 || job.steps >= MAX_TICKS; }

// Read off the result. By NAME: the caller matches these onto its
// standings rows, and the clone's bodies are not the live ones.
function report() {
  if (!job) return null;
  const { bodies, done, clone, hz } = job;
  // Keyed by RACER IDENTITY (state.racerKey: the pilot, falling back
  // to the melon name), because the caller matches these onto its
  // standings rows and two racers must never collide into one entry.
  const out = { byKey: {}, player: null, steps: job.steps, dnf: 0 };
  bodies.forEach((m, i) => {
    const tick = done.has(m) ? done.get(m) : null;
    const rec = tick === null
      ? { timeSec: DNF_TIME, dnf: true }
      : { timeSec: (tick - clone.raceStartTick) / hz, dnf: false };
    if (rec.dnf) out.dnf++;
    if (i === 0) out.player = rec;
    const k = FF.racerKey ? FF.racerKey(m) : m.name;
    if (k) out.byKey[k] = rec;
  });
  return out;
}

function clear() { job = null; }

// The blocking form, kept for the harnesses and for any caller that
// genuinely wants the answer now.
function resolve(state, opts) {
  if (!begin(state, opts)) return null;
  while (!pump(MAX_TICKS)) { /* run to completion */ }
  const out = report();
  clear();
  return out;
}

// ---- THE ESTIMATOR ------------------------------------------------
// Fast-forwarding is exact but costs a simulation; on a phone, with a
// field of predicting bots, that is a spike the player pays for a
// number they can barely perceive. So the field's finish times are
// PROJECTED instead — the same choice newer Mario Kart makes, and for
// the same reason: nobody is waiting for the race to end, so an
// estimate contradicts nothing.
//
// PACE, NOT SPEED. Instantaneous speed is noise: a melon might be
// mid-air, mid-bounce or upside down at the instant the flag falls.
// What it has actually DEMONSTRATED — distance covered over elapsed
// race time — already contains its deaths, its terrain luck and its
// brain. That is a statistic, not a guess.
//
// Blended with RECENT pace so a bot that just crashed is not credited
// with its early speed, and corrected by the one remaining cost we
// know exactly: a body waiting to respawn is not rolling, so its
// respawn delay is added rather than ignored.
//
// PLACE FOLLOWS TIME (Eddie's ruling). A bot five metres back but
// running a faster pace really would cross before one ten metres
// ahead that is limping, so ordering by projected time is not merely
// consistent with the times shown — it is the more correct result.
// Position therefore comes from this, and points come from position:
// the estimator's ordering is load-bearing, which is why it is
// validated against the simulator rather than trusted.
const RECENT_WEIGHT = 0.35;     // long-run pace dominates; recent pace corrects
const MIN_PACE_PX = 40;         // px/s floor: a stalled melon cannot project absurdly
const DEATH_LOST_SEC = 1.2;     // ground lost to a splat, beyond the respawn wait

function estimate(state, opts) {
  const FF = window.FF;
  const race = state.race;
  if (!race || race.mode !== 'track' || !race.lapLengthPx || !race.laps) return null;
  const hz = (FF.CONFIG && FF.CONFIG.physicsHz) || 120;
  const nowTick = state.tick;
  const startTick = state.raceStartTick || 0;
  // Pace is measured from GO, not from the race's construction: the
  // grid ceremony (and a wait of any length for the player's thumb)
  // is dead time that would otherwise be divided into every bot's
  // pace, understating all of them. Falls back to the start tick for
  // races built without a grid sequence (netplay, harnesses).
  const goTick = (race.goTick !== undefined && race.goTick !== null) ? race.goTick : startTick;
  const elapsed = Math.max(1 / hz, (nowTick - goTick) / hz);
  const target = race.lapLengthPx * race.laps;
  const bodies = [state.melon].concat(state.bots.map(b => b.melon));

  const out = { byKey: {}, player: null, estimated: 0, measured: 0 };
  for (let i = 0; i < bodies.length; i++) {
    const m = bodies[i];
    let rec;
    if (m.finishTick !== undefined && m.finishTick !== null) {
      // MEASURED. Always sorts ahead of any estimate, because an
      // estimate is the flag time plus a positive remainder.
      rec = { timeSec: (m.finishTick - startTick) / hz, dnf: false, estimated: false };
      out.measured++;
    } else {
      const covered = Math.max(0, m.x - state.raceStartX);
      const remaining = Math.max(0, target - covered);
      const longRun = covered / elapsed;                       // px/s over the race
      const recent = m.recentPacePx !== undefined && m.recentPacePx !== null
        ? m.recentPacePx : longRun;
      let pace = longRun * (1 - RECENT_WEIGHT) + recent * RECENT_WEIGHT;
      if (!(pace > MIN_PACE_PX)) pace = MIN_PACE_PX;
      // EXPECTED CRASHES IN THE REMAINDER. What the remaining time
      // actually turns on is whether a melon splats again — each one
      // costs a respawn plus the ground it loses. A bot that has died
      // three times in two laps will probably die again, and that is
      // a rate we have measured rather than a guess about the future.
      // Included because leaving it out systematically flatters the
      // fragile racers.
      const deaths = m.deathCount || 0;
      const perPx = covered > 0 ? deaths / covered : 0;
      const expected = perPx * remaining;
      const crashCost = ((FF.CONFIG.respawnDelayTicks || 0) / hz) + DEATH_LOST_SEC;
      // The one remaining cost we know exactly.
      const respawnWait = (!m.alive && m.respawnAtTick > nowTick)
        ? (m.respawnAtTick - nowTick) / hz : 0;
      rec = {
        timeSec: (nowTick - startTick) / hz + remaining / pace + respawnWait
          + expected * crashCost,
        dnf: false,
        estimated: true,
      };
      out.estimated++;
    }
    if (i === 0) out.player = rec;
    const k = FF.racerKey ? FF.racerKey(m) : m.name;
    if (k) out.byKey[k] = rec;
  }
  return out;
}

window.FF.finishLine = {
  resolve, begin, pump, isDone, report, clear, cloneWorld, estimate,
  MAX_TICKS, DNF_TIME, TICKS_PER_FRAME, RECENT_WEIGHT, MIN_PACE_PX,
};
})();