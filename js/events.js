(function () {
'use strict';
// ============================================================
// EVENTS — the race's nervous system, presentation tier only.
//
// One place where "something worth talking about just happened" is
// announced, and any number of listeners (the ticker, the death
// overlay, audio, future stat screens) can subscribe. The sim
// ANNOUNCES and never listens: an event can't change physics, which
// is precisely what keeps this outside determinism. Peers may see
// different events (different local players) with no divergence risk,
// the same license fx and telemetry already hold.
//
// WHY A BUS AND NOT DIRECT CALLS: the commentary elements land one at
// a time (deaths, near-misses, overtakes, records...). Each new
// producer emits; each new consumer subscribes; neither has to know
// the other exists. Without it, every element would mean another
// reach-through from physics into a UI module.
//
// The bus also keeps a short HISTORY ring. Commentary is comparative
// by nature — "biggest hit survived so far", "third death this lap",
// "back-to-back" — and that needs a memory the emitters don't have.
//
// EVENT TYPES (payloads are certificates from physics unless noted):
//   'death'     — a body was smashed          { ...cert, isPlayer }
//   'nearMiss'  — survived >= 85% of lethal   { ...cert, survived: true }
//   'propBreak' — cardboard broke (one-blow law) { name, species, tick, severity, threshold, brokenBy, x, y }
//   (later elements add: 'overtake', 'lap', 'record', 'airtime')
// ============================================================

const HISTORY = 64;

const listeners = new Map(); // type -> [fn]
const history = [];          // recent events, newest last
let seq = 0;

function on(type, fn) {
  let arr = listeners.get(type);
  if (!arr) listeners.set(type, arr = []);
  arr.push(fn);
  return () => off(type, fn);
}

function off(type, fn) {
  const arr = listeners.get(type);
  if (!arr) return;
  const i = arr.indexOf(fn);
  if (i >= 0) arr.splice(i, 1);
}

function emit(type, payload, state) {
  const ev = { type, seq: seq++, at: (state && state.tick) || 0, data: payload || {} };
  history.push(ev);
  if (history.length > HISTORY) history.shift();
  const arr = listeners.get(type);
  if (arr) {
    // Copy before iterating: a listener may unsubscribe itself.
    for (const fn of arr.slice()) {
      // A broken listener must never take the frame (or the sim tick
      // that announced it) down with it.
      // THE STATE IS DELIVERED (fix 2026-08-26r). emit() has always
      // TAKEN the state — and then dropped it, using only state.tick.
      // The signals commit's first citizen was written as
      // onSessionOver(payload, state): the subscriber and the bus
      // disagreed about the second argument, so the ski-jump
      // adapter's isOver() interrogated the EVENT RECORD, found no
      // .session, and quietly said no — a session end announced and
      // never acted on. Third argument, additive: two-arg listeners
      // are untouched.
      try { fn(ev.data, ev, state); } catch (err) { console.warn('FF.events listener failed:', err); }
    }
  }
  const any = listeners.get('*');
  if (any) for (const fn of any.slice()) {
    try { fn(ev.data, ev, state); } catch (err) { console.warn('FF.events listener failed:', err); }
  }
  return ev;
}

// Recent events, optionally filtered by type. Newest last.
function recent(type, n) {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < (n || HISTORY); i--) {
    if (!type || history[i].type === type) out.push(history[i]);
  }
  return out.reverse();
}

// Race-scoped memory for comparative commentary ("biggest yet"). The
// flow's race start clears it; nothing else should.
function reset() {
  history.length = 0;
  seq = 0;
}

window.FF.events = { on, off, emit, recent, reset };
})();
