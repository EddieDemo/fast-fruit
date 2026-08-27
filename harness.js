// ============================================================
// HARNESS — the headless race runner (Architecture A stage 1, spec §5).
//
// Stage 1 cannot ship on geometry checks; it needs RACED OUTCOMES.
// This is a node module (no renderer, no DOM) that loads the sim tier
// only — dmath / config / fruits / state / terrain / strand / tracks /
// debris / damage / pilot / physics / finishline — builds a full
// twelve-body race on a real track template, and runs it to the flag.
//
//   runRace(seed, roster, laps) -> per-racer
//     { key, finished, timeSec, deaths, maxImpact, pathHash, stuck }
//
// LAWS THIS FILE HOLDS ITSELF TO:
//  * The sim is the game's own: FF.step on the game's own modules,
//    the game's own track provider, the game's own grid placement.
//    Nothing here re-implements a law; the harness only OBSERVES.
//  * PATH HASH: FNV-1a over the exact f64 bits of every body's
//    (x, y, angle, vx, vy, omega) every tick. Bit identity or
//    nothing — a toFixed hash would bless drift below the rounding.
//  * CANONICAL NAMES: racers are named R00..R11 in canonical body
//    order (player first, bots in spawn order), so racerKey
//    lexicographic order EQUALS canonical order. Under the stage 1
//    contact-order law (melon pairs sorted by racerKey) this makes
//    the harness field's pair sequence identical to the pre-law
//    spawn-order sequence — which is what lets the pre/post sweep
//    demand BIT identity rather than a statistical tolerance.
//    (verify-contact-order permutes keys separately to prove the
//    law itself.)
//  * STALL DETECTION (spec §5): a living racer whose spine progress
//    advances < STALL_EPS px for > STALL_SEC seconds is STUCK — a
//    soft-locked race is a failure even if eleven others finish.
//    Dead-and-waiting bodies are not stuck; their clock refreshes.
//  * OBSERVERS RUN INSIDE THE STEPPING LOOP (the 2026-08 lesson:
//    per-frame observers that run after capture miss events) —
//    finish stamping, death counting, stall tracking and the path
//    hash all run every tick, immediately after FF.step.
// ============================================================
'use strict';

// ---- module loading (idempotent: require caches) --------------------
global.window = global.window || { FF: {} };
require('./js/dmath.js');
require('./js/config.js');
require('./js/objects.js');
require('./js/state.js');
require('./js/terrain.js');
require('./js/strand.js');
require('./js/slab.js');
require('./js/tracks.js');
require('./js/debris.js');
require('./js/damage.js');
require('./js/pilot.js');
require('./js/physics.js');
require('./js/finishline.js');

const FF = window.FF;
// In a browser, window properties ARE globals — modules may lawfully
// say bare `FF` (finishline.js does). Mirror that semantics headless.
global.FF = FF;
const CONFIG = FF.CONFIG;

// Headless suites legitimately run without shading.js; silence the
// stale-deployment warning that is aimed at browsers.
FF.resetBots._warned = true;

// ---- constants ------------------------------------------------------
const HZ = CONFIG.physicsHz;                 // 120
const DT = 1 / HZ;
const KEEP_BEHIND = 2600, GEN_AHEAD = 3600;  // main.js's streaming window
const MAX_RACE_SEC = 240;                    // generous: 3-lap dailies run ~60-90s
const STALL_EPS = 1;                         // px of progress that counts as moving
const STALL_SEC = 10;                        // spec §5: >10s without progress = STUCK
const SPAWN_X = 0;                           // the start line (main.js SPAWN)

// The default sweep field: eleven rivals mirroring the shipped cast's
// composition (mixed species, one oracle — The Rindfather's brain),
// plus the harness player on cruise. Explicit, so a sweep is a fixed
// experiment rather than whatever the roster module currently fields.
const DEFAULT_ROSTER = [
  'watermelon', 'honeydew', 'cantaloupe', 'watermelon',
  { species: 'watermelon', brain: 'oracle' },
  'honeydew', 'watermelon', 'cantaloupe', 'watermelon',
  'honeydew', 'watermelon',
];

// ---- FNV-1a over raw f64 bits ---------------------------------------
const HASH_BUF = new DataView(new ArrayBuffer(8));
function fnvF64(h, v) {
  HASH_BUF.setFloat64(0, v);
  for (let i = 0; i < 8; i++) {
    h ^= HASH_BUF.getUint8(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- the race -------------------------------------------------------
// opts: { maxSec, trace } — trace collects per-second leader progress.
function runRace(seed, roster, laps, opts) {
  const def = { seed: seed >>> 0, lapLengthM: 400, dropPerLapM: 70, laps: laps || 3 };
  const provider = FF.createTrackProvider(def);
  provider.reset();
  provider.update(SPAWN_X - KEEP_BEHIND - 800, SPAWN_X + GEN_AHEAD);

  const state = FF.createState();
  state.terrain = provider.polys ? provider.polys() : [provider.pts];
  state.period = provider.period;
  // Spine before the grid (stage 2); METRIC since stage 3 — the lap
  // unit is arc.
  state.spine = FF.trackSpace.metricSpine(SPAWN_X, provider.lapArc, state.terrain);
  state.race.mode = 'track';
  state.race.lapLengthPx = provider.lapArc; // a lap of ARC (stage 3)
  state.race.laps = def.laps;

  // Grid: player in metre 1, bots behind — the game's own placement.
  FF.resetPlayers(state, 1, 0, SPAWN_X, -CONFIG.semiMinor - 200, true);
  const field = roster || DEFAULT_ROSTER;
  const savedRoster = CONFIG.botRoster;
  CONFIG.botRoster = field;
  FF.resetBots(state, field.length, SPAWN_X, -CONFIG.semiMinor - 200,
    (def.seed ^ 0x51ED) >>> 0, 1);
  CONFIG.botRoster = savedRoster;

  // Canonical names: lexicographic == canonical order (see header).
  const bodies = [state.melon].concat(state.bots.map((b) => b.melon));
  bodies.forEach((m, i) => { m.pilot = 'R' + String(i).padStart(2, '0'); });

  // The player seat drives 'cruise': full throttle, flare centred —
  // the same two numbers the policy of that name returns forever.
  // RAW-INPUT ERA: the player seat emulates a competent human — hold
  // the stick toward the local travel direction. Under semantic
  // input a constant 1 meant exactly this; under raw it must be
  // looked up (the same projection the old physics flip used, so
  // trajectories are bit-preserved).
  state.input.rawAxis = 1;
  state.input.rawBounce = 0;

  state.raceStartTick = state.tick;
  state.raceStartX = SPAWN_X;

  const target = provider.period.L * def.laps;
  const maxTicks = Math.round((opts && opts.maxSec || MAX_RACE_SEC) * HZ);
  const stallTicks = STALL_SEC * HZ;

  const rec = bodies.map((m) => ({
    key: m.pilot,
    finished: false,
    finishTick: null,
    timeSec: null,
    deaths: 0,
    maxImpact: 0,
    pathHash: 2166136261 >>> 0,
    stuck: false,
    stuckX: null,      // progress at the stall latch (null = never stuck)
    stuckKind: null,   // chunk kind under that spot (the accusation)
    bestProgress: -Infinity,
    lastAdvanceTick: state.tick,
    wasAlive: true,
  }));

  const trace = (opts && opts.trace) ? [] : null;
  const deathsByKind = {};
  let outstanding = bodies.length;
  let maxStepPx = 0; // worst |v|·dt any body ever posted (verify-slab reads it)
  const t0 = state.tick;

  while (outstanding > 0 && state.tick - t0 < maxTicks) {
    // Stream/tile the world to cover every body (main.js's window).
    let lo = bodies[0].x, hi = bodies[0].x;
    for (const m of bodies) { if (m.x < lo) lo = m.x; if (m.x > hi) hi = m.x; }
    provider.update(lo - KEEP_BEHIND, hi + GEN_AHEAD);

    // the player seat steers raw: stick toward travel
    {
      const w = FF.slab.worldFor(state.terrain);
      const prj = w.project ? w.project(state.melon.x, state.melon.y) : null;
      state.input.rawAxis = prj ? prj.dirX : 1;
    }
    FF.step(state, DT);

    // An external probe (opts.observer) rides the same slot the
    // built-in observers do: inside the loop, after the step. Reads
    // only — a probe that writes is a probe that lies.
    if (opts && opts.observer) opts.observer(state, state.tick - t0);

    // ---- OBSERVERS: inside the stepping loop, after the step ----
    for (let i = 0; i < bodies.length; i++) {
      const m = bodies[i], r = rec[i];
      // Path hash: exact f64 bits, every tick, every body.
      let h = r.pathHash;
      h = fnvF64(h, m.x); h = fnvF64(h, m.y); h = fnvF64(h, m.angle);
      h = fnvF64(h, m.vx); h = fnvF64(h, m.vy); h = fnvF64(h, m.omega);
      r.pathHash = h;
      const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy) * DT;
      if (sp > maxStepPx) maxStepPx = sp;
      // Deaths: alive edge, true -> false — tallied by the chunk kind
      // under the body, so the sweep can say WHAT kills (the death-
      // economy attribution the check-mark ruling is judged by).
      if (r.wasAlive && !m.alive) {
        r.deaths++;
        let kind = 'unknown';
        for (const poly of state.terrain) {
          for (let i = 1; i < poly.length; i++) {
            if (m.x >= poly[i - 1].x && m.x <= poly[i].x) {
              kind = poly[i].k || 'runway';
              break;
            }
          }
        }
        deathsByKind[kind] = (deathsByKind[kind] || 0) + 1;
      }
      r.wasAlive = m.alive;
      // Max impact: the worst running cluster total ever observed
      // (monotone within a cluster, so per-tick sampling catches it).
      if (m.clusterOpen && m.clusterE > r.maxImpact) r.maxImpact = m.clusterE;
      if (r.finished) continue;
      // Finish stamping (racewatch's law, run tick-accurate).
      const prog = state.spine.progressOf(m);
      if (prog >= target) {
        r.finished = true;
        r.finishTick = state.tick;
        r.timeSec = (state.tick - t0) / HZ;
        outstanding--;
        continue;
      }
      // Stall: living body, no progress for STALL_SEC.
      if (prog > r.bestProgress + STALL_EPS) {
        r.bestProgress = prog;
        r.lastAdvanceTick = state.tick;
      }
      if (!m.alive) r.lastAdvanceTick = state.tick; // dead ≠ stuck
      if (state.tick - r.lastAdvanceTick > stallTicks && !r.stuck) {
        r.stuck = true;
        // WHERE and on WHAT: the loaded window still covers the body
        // at latch time, so read the chunk kind straight off it.
        r.stuckX = Math.round(r.bestProgress);
        r.stuckKind = 'unknown';
        for (const poly of state.terrain) {
          for (let i = 1; i < poly.length; i++) {
            if (m.x >= poly[i - 1].x && m.x <= poly[i].x) {
              r.stuckKind = poly[i].k || 'runway';
              break;
            }
          }
        }
      }
    }

    if (trace && (state.tick - t0) % HZ === 0) {
      let best = -Infinity;
      for (const m of bodies) { const p = state.spine.progressOf(m); if (p > best) best = p; }
      trace.push(Math.round(best));
    }
  }

  return {
    seed: def.seed,
    laps: def.laps,
    lapLengthPx: provider.lapArc,
    ticks: state.tick - t0,
    maxStepPx: Math.round(maxStepPx * 100) / 100,
    deathsByKind,
    racers: rec.map((r) => ({
      key: r.key,
      finished: r.finished,
      timeSec: r.timeSec,
      deaths: r.deaths,
      maxImpact: Math.round(r.maxImpact * 1000) / 1000,
      pathHash: r.pathHash,
      stuck: r.stuck,
      stuckX: r.stuckX,
      stuckKind: r.stuckKind,
    })),
    trace,
  };
}

// ---- the sweep ------------------------------------------------------
// N seeds x current dialects: every seed speaks its own recipe, so a
// seed sweep IS a dialect sweep. Returns the full per-race tables plus
// the aggregate the pre/post comparison judges.
function sweep(seeds, roster, laps) {
  const races = seeds.map((s) => runRace(s, roster, laps));
  const agg = { races: races.length, finished: 0, dnf: 0, stuck: 0, deaths: 0, times: [] };
  for (const race of races) {
    for (const r of race.racers) {
      if (r.finished) { agg.finished++; agg.times.push(r.timeSec); }
      else agg.dnf++;
      if (r.stuck) agg.stuck++;
      agg.deaths += r.deaths;
    }
  }
  agg.times.sort((a, b) => a - b);
  const n = agg.times.length;
  agg.meanTime = n ? agg.times.reduce((a, b) => a + b, 0) / n : null;
  agg.medianTime = n ? agg.times[n >> 1] : null;
  agg.minTime = n ? agg.times[0] : null;
  agg.maxTime = n ? agg.times[n - 1] : null;
  return { seeds, laps: laps || 3, races, agg };
}

// Default sweep seeds: 12 fixed, spread across the dialect space by
// the golden-ratio hash — pinned here so baseline and post-build runs
// are the same experiment by construction.
const SWEEP_SEEDS = [];
for (let i = 0; i < 12; i++) SWEEP_SEEDS.push((0x51AB1 + Math.imul(i + 1, 2654435761)) >>> 0);

module.exports = { runRace, sweep, SWEEP_SEEDS, DEFAULT_ROSTER, HZ, FF };
