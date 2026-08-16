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
const VERSION = 6;          // bump on ANY change to the stored shape
                            // v4 (2026-08-13): the cluster ledger
                            // v5 (2026-08-14): the pilot (melon vs driver)
                            // v6 (2026-08-14): cup table keyed by pilot
const HEARTBEAT_MS = 2000;
// The BACKSTOP, not the rule. The day guard above expires a daily
// run the moment the date turns over, which is the real policy; this
// only catches snapshots the day guard cannot judge (registry and
// harness tracks, which carry no day). Was 36 hours, chosen when age
// was the only expiry and had to be generous enough not to bin a
// run from late last night; with the day guard doing that job
// properly, a day is ample and nothing stale lingers longer.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
    nm: m.name || '', pl: m.pilot || '', bc: m.bodyColor || null,
    ft: m.finishTick === undefined ? null : m.finishTick,
    // airTicks is not just telemetry: the oracle brain reads it to
    // decide whether it is airborne, so dropping it would have every
    // bot briefly believe it had landed.
    at: m.airTicks || 0,
    // THE CLUSTER LEDGER IS INTEGRATED STATE (2026-08-13): a landing
    // is judged as one summed event, so a body saved mid-cluster (a
    // skip, a bounce inside the gap window) carries half a judged
    // landing. Dropping it would resume a race that forgives the
    // interrupted event — the same class of lie as resuming with the
    // controls mid-swing.
    cl: [m.clusterOpen ? 1 : 0, m.clusterE || 0, m.clusterN || 0,
         m.clusterGround || 0, m.clusterAir || 0, m.clusterPairE || 0],
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
  // The PILOT rides with the body: a resumed race showing the right
  // melon driven by the wrong name is a small lie about who is here.
  if (p.pl) m.pilot = p.pl;
  if (p.bc) m.bodyColor = p.bc;
  m.finishTick = p.ft === undefined ? null : p.ft;
  // Transient per-step fields must NOT be restored: they describe the
  // tick that was interrupted, and a stale severity would fire a
  // death overlay or a ticker line for a blow that already resolved.
  m.hitSeverity = 0; m.pairSeverity = 0; m.pairWorst = 0; m.squash = 0;
  m.grounded = false;
  m.airTicks = p.at || 0;
  // The cluster ledger, restored whole (defaults for pre-v4 shapes
  // can't occur — older versions are discarded at peek).
  const cl = p.cl || [0, 0, 0, 0, 0, 0];
  m.clusterOpen = cl[0] || 0;
  m.clusterE = cl[1] || 0;
  m.clusterN = cl[2] || 0;
  m.clusterGround = cl[3] || 0;
  m.clusterAir = cl[4] || 0;
  m.clusterPairE = cl[5] || 0;
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

// ---- A SNAPSHOT BELONGS TO A DAY (2026-08-13) --------------------
// The cup snapshot always checked its day; a PRACTICE snapshot did
// not, because the check lived on snap.cup and practice runs store
// cup: null. Dailies are self-describing, so restore() cheerfully
// rebuilt yesterday's terrain from the stored name: at 00:10 the menu
// still offered RESUME PRACTICE, and taking it dropped the player
// mid-race onto a track that is no longer today's, with yesterday's
// cast, with nothing on screen saying so. Practising terrain you will
// not race is worse than losing the run.
//
// The guard is now uniform and lives on the TRACK, which is the field
// both kinds of snapshot actually have. Scoped to daily names via
// isDailyTrackName, so registry tracks and harness races (Track 1)
// are never expired by date — only self-describing dailies are, and
// only they carry a day to be wrong about.
function expiredReason(snap) {
  if (!snap || snap.v !== VERSION) return 'version';
  if (Date.now() - (snap.at || 0) > MAX_AGE_MS) return 'age';
  const FF = window.FF;
  const today = FF.dailyTrackName ? FF.dailyTrackName() : null;
  // The cup names its own day; a practice run is placed by its track.
  if (snap.cup && today && snap.cup.day !== today) return 'day';
  if (today && FF.isDailyTrackName && FF.isDailyTrackName(snap.track)) {
    // Leg names ('Daily 2026-08-13 #3') share the day of their base
    // name, so compare on the prefix rather than the whole string.
    if (snap.track.indexOf(today) !== 0) return 'day';
  }
  return null;
}

// Why the last peek() cleared a snapshot, or null. Presentation reads
// this to TELL the player their run expired rather than silently
// removing the button they came back for. Sticky until the next peek
// that finds something, so a menu built moments later still sees it.
let lastExpiry = null;

function peek() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // A snapshot from an older build is DISCARDED. Half-loading a
    // stale shape is worse than losing the run: the player cannot
    // tell which half is lying.
    const why = expiredReason(snap);
    if (why) {
      // A version mismatch is OUR change, not the player's day
      // ending — saying "yesterday's run expired" for it would be a
      // lie, so only real expiries are announced.
      lastExpiry = (why === 'version') ? null : why;
      clear();
      return null;
    }
    lastExpiry = null;
    return snap;
  } catch (_) { clear(); return null; }
}

// Read and consume the expiry note: the menu shows it once.
function takeExpiry() {
  const w = lastExpiry;
  lastExpiry = null;
  return w;
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
  // ---- THE REBUILD ARMS A GRID START; A RESUMED RACE MUST NOT HAVE
  // ONE. rebuild() builds a fresh race, and a fresh race now lines up
  // on the grid: gridstart.begin() pins every body AT THE START LINE.
  // The bodies are then overwritten with their saved positions — but
  // the PINS still held the grid coordinates, so the first stepped
  // tick snapped the whole field back to the line. From the player's
  // side: resume, unpause, and the race has restarted.
  //
  // A resumed race is already under way, so it gets no ceremony: the
  // sequence is cancelled outright, which also releases the pins.
  if (FF.gridStart && FF.gridStart.cancel) FF.gridStart.cancel();
  if (state.bots.length !== snap.bots.length) { clear(); return null; }

  applyBody(FF, state.melon, snap.player);
  applyInput(state.input, snap.playerInput);
  state.bots.forEach((b, i) => {
    applyBody(FF, b.melon, snap.bots[i]);
    applyInput(b.input, (snap.botInputs || [])[i]);
    if (b.brain && b.brain.load) b.brain.load((snap.botBrains || [])[i]);
  });

  // ---- PRESENTATION MUST BE TOLD TOO ----
  // rebuild() puts a fresh grid on the start line before the bodies
  // are overwritten, which leaves two stale views of the world:
  //
  //   THE CAMERA has already been initialised at the start line, so
  //   it lerps from there to wherever the race actually is — a snap
  //   to the finish line and back, every resume.
  //
  //   THE INTERPOLATION BUFFER (prevMelon) still holds the grid pose,
  //   so the first rendered frame blends between the start line and
  //   the restored position.
  //
  // Neither is sim state, which is exactly why neither was restored;
  // both have to be re-pointed at the world that now exists.
  if (state.camera) state.camera.initialized = false;   // re-centre, don't chase
  const sync = (holder) => {
    if (holder && holder.prevMelon && holder.melon) Object.assign(holder.prevMelon, holder.melon);
  };
  for (const pl of state.players) sync(pl);
  for (const b of state.bots) sync(b);
  if (state.prevMelon && state.melon) Object.assign(state.prevMelon, state.melon);
  state.tick = snap.tick;
  state.raceStartX = snap.startX;
  state.raceStartTick = snap.startTick;
  Object.assign(state.race, snap.race);
  if (FF.debris && FF.debris.reset) FF.debris.reset();
  return snap;
}

window.FF.resume = { save, tick, peek, restore, clear, takeExpiry, VERSION, KEY, MAX_AGE_MS };
})();