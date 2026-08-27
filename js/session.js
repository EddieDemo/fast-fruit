// SESSION — the open-session chassis (2026-08-25).
//
// The shared spine of the score-chase and survival party events:
// a timed event with NO finish line, free respawns (the CONVEYOR),
// a per-racer personal-best LEDGER, and position tags ranked by the
// event's METRIC instead of track position.
//
// SEPARATION OF CONCERNS, stated:
//   - This module owns session STATE and its deterministic per-tick
//     update. It draws nothing and builds no screens (flow's job),
//     starts no races (main's job), and knows NO event: events
//     register a METRIC ADAPTER and the chassis treats every metric
//     identically. cup.js is the pattern; session.js is its sim-tier
//     sibling (cup never steps; a session must).
//   - DETERMINISM: update() runs once per fixed sim tick, reads only
//     sim state, stores plain indexed arrays (no Maps, no wall time).
//     Ranks are a stable sort with roster index as the final tie —
//     bit-reproducible across runs and machines.
//   - NO SESSION, NO CHANGE: every hook this module adds to the
//     engine is inert when state.session is null. Races are
//     bit-identical with the chassis installed.
//
// THE METRIC ADAPTER CONTRACT (an event registers one):
//   id      string, unique.
//   label   short human name for screens ('DISTANCE', 'ALTITUDE').
//   better(a, b)  true if a is a strictly better score than b.
//   sample(state, m, i)  number|null — this racer's score THIS tick
//           (null = no score right now). The chassis folds it into
//           the ledger via better(); sampling is the adapter's whole
//           knowledge of the event.
//   format(v)  string for screens/tags ('412m', '0:34.4').
// Adapters must be pure over (state, m): the chassis calls them in
// roster order inside the sim tick.
(function () {
'use strict';
const G = typeof window !== 'undefined' ? window : globalThis;
G.FF = G.FF || {};

const METRICS = {};

function registerMetric(a) {
  if (!a || !a.id || typeof a.better !== 'function'
    || typeof a.sample !== 'function' || typeof a.format !== 'function') {
    throw new Error('session: malformed metric adapter');
  }
  METRICS[a.id] = a;
  return a.id;
}

function roster(state) {
  const out = [];
  for (const pl of state.players) out.push(pl.melon);
  for (const b of state.bots) out.push(b.melon);
  return out;
}

// ---- lifecycle ----------------------------------------------------
function begin(state, opts) {
  const metric = METRICS[opts.metric];
  if (!metric) throw new Error('session: unknown metric ' + opts.metric);
  const n = roster(state).length;
  state.session = {
    metric: opts.metric,
    tick0: state.tick,
    durTicks: opts.durTicks | 0,          // 0 = untimed (event decides)
    over: false,
    // The ledger: personal bests, null until a first score exists.
    best: new Array(n).fill(null),
    // rank[i] = 1-based rank of roster index i (unscored racers rank
    // after every scored one, in roster order — stable by law).
    rank: new Array(n).fill(0),
    // CONVEYOR policy: how fast a dead body returns. Read by
    // reviveIfDue as an override; the walk-back placement law is
    // unchanged — the conveyor changes WHEN, not WHERE.
    // Infinity = DEATHS ARE PERMANENT (derby's elimination law,
    // 2026-08-26): tick + Infinity never comes due, so reviveIfDue
    // never fires. The law rides the conveyor's own dial — physics
    // is untouched (the | 0 coercion used to flatten Infinity to 0,
    // which would have been an INSTANT conveyor: the exact opposite).
    respawnDelayTicks: opts.respawnDelayTicks === undefined
      ? 60 : (opts.respawnDelayTicks === Infinity
        ? Infinity : (opts.respawnDelayTicks | 0)),
    // THE CUSTOMER TICK (derby stage 3): an event may register its
    // own deterministic per-tick law — run by update() below, inside
    // the fixed step, after ranks, BEFORE the clock, so a law that
    // ends the session still sees its final tick.
    onTick: typeof opts.onTick === 'function' ? opts.onTick : null,
    // THE NAMED MOMENT: an event may name its own end announcement
    // ('derby:over'); main's frame boundary emits it right after
    // session:over, same latch, with announceData as the payload.
    announce: opts.announce || null,
    announceData: null,
  };
  return state.session;
}

function end(state) {
  if (state.session) state.session.over = true;
}

function active(state) {
  return !!(state && state.session && !state.session.over);
}

// ---- the deterministic tick -------------------------------------
function update(state) {
  const s = state.session;
  if (!s || s.over) return;
  const metric = METRICS[s.metric];
  const bodies = roster(state);
  // 1) sample + fold the ledger.
  for (let i = 0; i < bodies.length; i++) {
    const v = metric.sample(state, bodies[i], i);
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (s.best[i] === null || metric.better(v, s.best[i])) s.best[i] = v;
  }
  // 2) rank: scored before unscored; among scored, better() first;
  //    ties and the unscored fall back to roster index. The
  //    comparator is total and deterministic by construction.
  const idx = bodies.map((_, i) => i);
  idx.sort((a, b) => {
    const av = s.best[a], bv = s.best[b];
    if (av === null && bv === null) return a - b;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (metric.better(av, bv)) return -1;
    if (metric.better(bv, av)) return 1;
    return a - b;
  });
  for (let r = 0; r < idx.length; r++) s.rank[idx[r]] = r + 1;
  // 2.5) the customer's own law (see begin): may end the session.
  if (s.onTick) s.onTick(state, s);
  // 3) the clock.
  if (s.durTicks > 0 && state.tick - s.tick0 >= s.durTicks) s.over = true;
}

// ---- queries (renderer / flow) -----------------------------------
function rankOf(state, melon) {
  const s = state.session;
  if (!s) return null;
  const bodies = roster(state);
  const i = bodies.indexOf(melon);
  return i < 0 ? null : (s.rank[i] || bodies.length);
}

function bestOf(state, melon) {
  const s = state.session;
  if (!s) return null;
  const i = roster(state).indexOf(melon);
  return i < 0 ? null : s.best[i];
}

function formatBest(state, melon) {
  const s = state.session;
  if (!s) return '';
  const v = bestOf(state, melon);
  return v === null ? '\u2014' : METRICS[s.metric].format(v);
}

function ticksLeft(state) {
  const s = state.session;
  if (!s || !s.durTicks) return null;
  return Math.max(0, s.durTicks - (state.tick - s.tick0));
}

G.FF.session = {
  registerMetric, begin, end, active, update,
  rankOf, bestOf, formatBest, ticksLeft,
  _metrics: METRICS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = G.FF.session;
})();
