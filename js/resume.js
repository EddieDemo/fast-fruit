(function () {
'use strict';
// ============================================================
// RESUME — a race in progress survives a closed tab.
//
// A four-race cup is a real commitment on a phone. Pause makes it
// interruptible within a session; this makes it interruptible ACROSS
// sessions: close the tab mid-cup, come back, land on the pause
// screen exactly where you left off.
//
// WHY A SNAPSHOT, NOT A REPLAY. Determinism means the whole race is
// reconstructible from the seed plus the input stream, which is
// elegant and validates our invariant — but our own harnesses run
// about a thousand ticks a second with a full field, so resuming a
// late cup leg could mean tens of seconds of frozen screen. A
// snapshot is a few kilobytes and instant. Terrain is NOT stored: it
// regenerates from the track seed. Debris is dropped; it is cosmetic
// and stale wreckage is worse than none.
//
// WHAT IS STORED: only the fields the sim actually integrates. Shape,
// mass and inertia are DERIVED at load from the species and scale via
// createBody — storing them would let a saved body drift out of step
// with a later physics change while looking valid.
//
// SCHEMA VERSION. A snapshot from an older build must be DISCARDED,
// not resurrected wrong: a stale save that half-loads is worse than
// no save, because the player cannot tell which parts are lies.
//
// WHEN IT WRITES: a heartbeat while racing, plus on pause and on
// visibility loss — phones do not get a graceful exit event, so the
// last write before backgrounding is the one that matters.
//
// SOLO ONLY. A lockstep race's state lives across peers; restoring
// one side of it would desync the session instantly.
// ============================================================

const KEY = 'ff.resume.v1';
const VERSION = 3;          // bump on ANY change to the stored shape
const HEARTBEAT_MS = 2000;
const MAX_AGE_MS = 36 * 60 * 60 * 1000;   // a day and a half

let lastWrite = 0;

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// The integrated fields, and only those.
function packBody(m) {
  return {
    f: m.fruit, s: +(m.a / window.FF.CONFIG.semiMajor).toFixed(6),
    x: m.x, y: m.y, an: m.angle, vx: m.vx, vy: m.vy, w: m.omega,
    al: m.alive ? 1 : 0, rs: m.respawnAtTick, pt: m.protectTick,
    nm: m.name || '', bc: m.bodyColor || null,
    ft: m.finishTick === undefined ? null : m.finishTick,
    // airTicks is not just telemetry: the oracle brain reads it to
    // decide whether it is airborne, so dropping it would have every
    // bot briefly believe it had landed.
    at: m.airTicks || 0,
  };
}

// INPUT IS INTEGRATED STATE. rawAxis is what the stick says now;
// torqueAxis and bounceAxis are what the body is actually being
// driven by, eased toward it over time. Restoring only the raw values
// resumes a race whose controls are mid-swing — measured at 12 metres
// of drift inside five seconds.
function packInput(inp) {
  return {
    ra: inp.rawAxis || 0, ta: inp.torqueAxis || 0,
    rb: inp.rawBounce || 0, ba: inp.bounceAxis || 0,
  };
}
function applyInput(inp, p) {
  if (!p) return;
  inp.rawAxis = p.ra; inp.torqueAxis = p.ta;
  inp.rawBounce = p.rb; inp.bounceAxis = p.ba;
}

function applyBody(FF, m, p) {
  m.x = p.x; m.y = p.y; m.angle = p.an;
  m.vx = p.vx; m.vy = p.vy; m.omega = p.w;
  m.alive = !!p.al; m.respawnAtTick = p.rs; m.protectTick = p.pt;
  if (p.nm) m.name = p.nm;
  if (p.bc) m.bodyColor = p.bc;
  m.finishTick = p.ft === undefined ? null : p.ft;
  // Transient per-step fields must NOT be restored: they describe the
  // tick that was interrupted, and a stale severity would fire a
  // death overlay or a ticker line for a blow that already resolved.
  m.hitSeverity = 0; m.pairSeverity = 0; m.squash = 0;
  m.grounded = false;
  m.airTicks = p.at || 0;
}

function save(state, opts) {
  if (!state || (opts && opts.netplay)) return false;
  try {
    const cup = window.FF.cup && window.FF.cup.current();
    const snap = {
      v: VERSION,
      at: Date.now(),
      track: window.FF.currentModeName ? window.FF.currentModeName() : null,
      tick: state.tick,
      race: {
        mode: state.race.mode, laps: state.race.laps,
        lapIndex: state.race.lapIndex, lapLengthPx: state.race.lapLengthPx,
        lapStartTick: state.race.lapStartTick, bestLapTicks: state.race.bestLapTicks,
        splits: (state.race.splits || []).slice(-8),
        finishedTick: state.race.finishedTick,
      },
      startX: state.raceStartX, startTick: state.raceStartTick,
      player: packBody(state.melon),
      playerInput: packInput(state.input),
      bots: state.bots.map(b => packBody(b.melon)),
      botInputs: state.bots.map(b => packInput(b.input)),
      // Each brain's own memory (the oracle's held prescription).
      botBrains: state.bots.map(b => (b.brain && b.brain.save ? b.brain.save() : null)),
      // The cup's own progress: without it a resumed leg would be
      // race one of nothing.
      cup: cup ? {
        day: cup.day, leg: cup.leg, results: cup.results,
        table: cup.table, nameSeed: cup.nameSeed,
      } : null,
      practice: !cup,
    };
    localStorage.setItem(KEY, JSON.stringify(snap));
    lastWrite = now();
    return true;
  } catch (_) { return false; }
}

// Heartbeat: called every frame, writes at most every HEARTBEAT_MS.
function tick(state, opts) {
  if (now() - lastWrite < HEARTBEAT_MS) return false;
  return save(state, opts);
}

function peek() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // A snapshot from an older build is DISCARDED. Half-loading a
    // stale shape is worse than losing the run: the player cannot
    // tell which half is lying.
    if (!snap || snap.v !== VERSION) { clear(); return null; }
    if (Date.now() - (snap.at || 0) > MAX_AGE_MS) { clear(); return null; }
    // A cup snapshot from a previous DAY is finished business.
    if (snap.cup && window.FF.dailyTrackName && snap.cup.day !== window.FF.dailyTrackName()) {
      clear(); return null;
    }
    return snap;
  } catch (_) { clear(); return null; }
}

function clear() {
  try { localStorage.removeItem(KEY); } catch (_) {}
}

// Restore into a live state. `rebuild` is supplied by main.js: it
// puts the game on the right track with the right field, exactly as
// starting that race would, and only then are the bodies overwritten.
function restore(state, rebuild) {
  const snap = peek();
  if (!snap) return null;
  const FF = window.FF;
  if (snap.cup && FF.cup && FF.cup.resume) FF.cup.resume(snap.cup);
  if (rebuild) rebuild(snap.track, snap.bots.length);
  if (state.bots.length !== snap.bots.length) { clear(); return null; }

  applyBody(FF, state.melon, snap.player);
  applyInput(state.input, snap.playerInput);
  state.bots.forEach((b, i) => {
    applyBody(FF, b.melon, snap.bots[i]);
    applyInput(b.input, (snap.botInputs || [])[i]);
    if (b.brain && b.brain.load) b.brain.load((snap.botBrains || [])[i]);
  });
  state.tick = snap.tick;
  state.raceStartX = snap.startX;
  state.raceStartTick = snap.startTick;
  Object.assign(state.race, snap.race);
  if (FF.debris && FF.debris.reset) FF.debris.reset();
  return snap;
}

window.FF.resume = { save, tick, peek, restore, clear, VERSION, KEY };
})();