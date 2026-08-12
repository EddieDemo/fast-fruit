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
const AIR_MIN_TICKS = 150;    // 1.25s aloft before a flight is news
const AIR_GAP_TICKS = 240;    // 2s between airtime lines
const RIVAL_GAP_TICKS = 300;  // 2.5s between rivals' stories

let lastPlace = null;         // player's last CONFIRMED place
let pendingPlace = null;      // a place we're waiting to see stick
let pendingSince = 0;
let lastOvertakeTick = -1e9;
let lastLapIndex = 0;
let streakBaseX = null;       // x where the current clean run began
let streakNext = STREAK_STEP_M;
let wasAlive = true;
let wasAirborne = false;
let lastAirTick = -1e9;
let lastRivalTick = -1e9;
let placeByName = new Map();  // last known place, for rivals' stories
// ---- THE RACE BOOK ----
// Race-scoped totals for the finish screen. A summary is the one
// place stats can be dense without competing for attention, so this
// collects continuously and cheaply: counters, one max, and a
// running sample of the flare axis (the only way to know whether the
// player actually USED the stick, which no single event can tell).
const book = {
  deaths: 0, nearMisses: 0, flareSaves: 0, coachable: 0,
  biggestSurvived: 0, biggestSurvivedName: '',
  overtakes: 0, passedBy: 0, bestAirTicks: 0, longestStreakM: 0,
  flareTicks: 0, deadTicks: 0, aliveTicks: 0,
};
// ---- THE FIELD LEDGER ----
// The book above is about YOU; this is about everyone. Superlatives
// ("most splatted", "biggest crash", "most air") need per-body
// totals, and no single event carries them — deaths and near-misses
// arrive per body, but top speed and airtime have to be SAMPLED.
// Keyed by the body object, not the name: names can repeat and can be
// empty, and the object identity is stable for the whole race.
const fieldStats = new Map();
function statsFor(body) {
  let s = fieldStats.get(body);
  if (!s) fieldStats.set(body, s = {
    name: body.name || '', fruit: body.fruit || '',
    deaths: 0, biggestHit: 0, biggestSurvived: 0,
    bestAirTicks: 0, topSpeed: 0, distance: 0,
  });
  if (!s.name && body.name) s.name = body.name; // names arrive late
  return s;
}
function statsByName(name) {
  for (const [body, s] of fieldStats) if ((body.name || '') === name) return s;
  return null;
}

let bookSubscribed = false;
function subscribeBook() {
  if (bookSubscribed || !window.FF.events) return;
  bookSubscribed = true;
  window.FF.events.on('death', (c) => {
    if (c.isPlayer) book.deaths++;
    const s = statsByName(c.name);
    if (s) { s.deaths++; if (c.severity > s.biggestHit) s.biggestHit = c.severity; }
  });
  window.FF.events.on('nearMiss', (c) => {
    if (!c.isPlayer) return;
    book.nearMisses++;
    if (c.flareSaved) book.flareSaves++;
    if (c.severity > book.biggestSurvived) book.biggestSurvived = c.severity;
  });
  window.FF.events.on('nearMiss', (c) => {
    const s = statsByName(c.name);
    if (s && c.severity > s.biggestSurvived) s.biggestSurvived = c.severity;
  });
}

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
  subscribeBook();
  subscribeRivals();
  curTick = state.tick;
  const me = state.melon;
  const field = rank(state);
  const place = field.indexOf(me) + 1;
  if (place <= 0) return;
  myPlace = place;
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

  // ---- Airtime: report the flight the moment it ENDS ----
  // The ledger physics keeps (lastFlightTicks, lastFallPx) is written
  // at touchdown, so landing is the only correct moment to read it —
  // and it's also the dramatically right one: hang time is a story
  // you tell after sticking it, not while still in the air.
  const airborne = me.alive && (me.airTicks || 0) > 0;
  if (wasAirborne && !airborne && me.alive) {
    const ticks = me.lastFlightTicks || 0;
    if (ticks > book.bestAirTicks) book.bestAirTicks = ticks;
    if (ticks >= AIR_MIN_TICKS && tick - lastAirTick >= AIR_GAP_TICKS) {
      lastAirTick = tick;
      emit('airtime', {
        seconds: ticks / (window.FF.CONFIG.physicsHz || 120),
        fallM: (me.lastFallPx || 0) / 100,
      }, state);
    }
  }
  wasAirborne = airborne;

  // ---- Places, remembered for rivals' stories ----
  placeByName.clear();
  for (let i = 0; i < field.length; i++) placeByName.set(field[i], i + 1);

  // ---- Field sampling: the quantities no event can carry ----
  for (const body of field) {
    const s = statsFor(body);
    if (!body.alive) continue;
    const sp = Math.sqrt(body.vx * body.vx + body.vy * body.vy);
    if (sp > s.topSpeed) s.topSpeed = sp;
    const air = body.airTicks || 0;
    if (air > s.bestAirTicks) s.bestAirTicks = air;
    s.distance = body.x;
  }

  // ---- The book: flare usage can only be sampled, never evented ----
  if (me.alive) {
    book.aliveTicks++;
    const ax = (state.input && state.input.bounceAxis) || 0;
    if (ax > 0.15) book.flareTicks++;
    else if (ax < -0.15) book.deadTicks++;
  }

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
          if (gained > 0) book.overtakes++; else book.passedBy++;
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
    if (metres > book.longestStreakM) book.longestStreakM = metres;
    if (metres >= streakNext) {
      emit('streak', { metres: streakNext }, state);
      streakNext += STREAK_STEP_M;
    }
  }
}

// ---- RIVALS' STORIES -----------------------------------------
// Certificates are built for every body, but a bare "BOT4 died" is
// not a story — the story is the POSITION it cost them, which only
// this module knows. So racewatch listens for rival deaths and
// re-emits them with race context; the ticker stays a formatter.
// Gated hard: a 7-body pack dies ~5 times a race and most of it is
// noise. Only the sharp end counts (podium places), and only one
// every few seconds.
let rivalSubscribed = false;
function subscribeRivals() {
  if (rivalSubscribed || !window.FF.events) return;
  rivalSubscribed = true;
  window.FF.events.on('death', (c) => {
    if (c.isPlayer) return;
    const place = lastKnownPlace(c.name);
    // NEWS = the sharp end, or anyone AHEAD OF YOU. A podium-only
    // gate measured out at one line per fifteen rival deaths, which
    // left the field feeling empty — and it ignored the deaths that
    // matter most to the player: a rival ahead of you dying is a
    // place you just gained.
    if (!place) return;
    if (place > 3 && place >= myPlace) return;
    if (lastRivalTick > -1e8 && curTick - lastRivalTick < RIVAL_GAP_TICKS) return;
    lastRivalTick = curTick;
    window.FF.events.emit('rivalDown', {
      name: c.name || '', place, byPair: c.byPair, wasLeader: place === 1,
    }, { tick: curTick });
  });
}
let curTick = 0;
let myPlace = 99;   // the player's live place, for the rival gate
function lastKnownPlace(name) {
  for (const [body, p] of placeByName) if (body.name === name) return p;
  return null;
}

function reset() {
  lastPlace = null; pendingPlace = null; pendingSince = 0;
  lastOvertakeTick = -1e9; lastLapIndex = 0;
  streakBaseX = null; streakNext = STREAK_STEP_M; wasAlive = true;
  wasAirborne = false; lastAirTick = -1e9; lastRivalTick = -1e9; myPlace = 99;
  placeByName.clear();
  fieldStats.clear();
  for (const k of Object.keys(book)) book[k] = typeof book[k] === 'string' ? '' : 0;
}

// The RACE tab: superlatives over the whole field. Each is only
// reported when it's meaningful — a "most splatted" award with zero
// splats, or a tie across the whole field, is noise dressed as a
// stat, so those are dropped rather than shown.
function fieldSummary() {
  const hz = (window.FF.CONFIG && window.FF.CONFIG.physicsHz) || 120;
  const all = [...fieldStats.values()].filter(s => s.name || s.fruit);
  if (!all.length) return [];
  const best = (key, min) => {
    let top = null;
    for (const s of all) if (s[key] > (min || 0) && (!top || s[key] > top[key])) top = s;
    return top;
  };
  const out = [];
  const push = (label, s, value) => { if (s) out.push({ label, name: s.name || '—', value }); };

  const splat = best('deaths');
  // A "most splatted" award is only a story if someone actually stands
  // out — everyone on one death is just attrition.
  if (splat && splat.deaths > 0 && all.filter(s => s.deaths === splat.deaths).length === 1) {
    push('MOST SPLATTED', splat, splat.deaths + (splat.deaths === 1 ? ' splat' : ' splats'));
  }
  const fast = best('topSpeed');
  if (fast) push('FASTEST SPRINT', fast, (fast.topSpeed / 100).toFixed(1) + ' m/s');
  const air = best('bestAirTicks', hz * 0.6);
  if (air) push('MOST AIR', air, (air.bestAirTicks / hz).toFixed(1) + 's');
  const crash = best('biggestHit');
  if (crash) push('BIGGEST CRASH', crash, String(Math.round(crash.biggestHit)));
  const tough = best('biggestSurvived');
  if (tough) push('TOUGHEST HIT SURVIVED', tough, String(Math.round(tough.biggestSurvived)));
  // Flawless: only worth saying if it distinguishes someone.
  const clean = all.filter(s => s.deaths === 0);
  if (clean.length && clean.length < all.length) {
    const furthest = clean.reduce((a, b) => (b.distance > a.distance ? b : a));
    push('NEVER SPLATTED', furthest, (furthest.distance / 100).toFixed(0) + 'm clean');
  }
  return out;
}

// The finish screen's data. Derived numbers are computed here so the
// screen stays presentation-only.
function summary(state) {
  const hz = (window.FF.CONFIG && window.FF.CONFIG.physicsHz) || 120;
  const race = state && state.race;
  return {
    deaths: book.deaths,
    nearMisses: book.nearMisses,
    flareSaves: book.flareSaves,
    biggestSurvived: Math.round(book.biggestSurvived),
    overtakes: book.overtakes,
    passedBy: book.passedBy,
    bestAirSec: book.bestAirTicks / hz,
    longestStreakM: Math.round(book.longestStreakM),
    bestLapSec: race && race.bestLapTicks ? race.bestLapTicks / hz : null,
    // Flare usage: the share of living time the stick was actually
    // deflected. The one stat that says whether the mechanic is being
    // played at all.
    flarePct: book.aliveTicks ? Math.round(100 * book.flareTicks / book.aliveTicks) : 0,
    deadPct: book.aliveTicks ? Math.round(100 * book.deadTicks / book.aliveTicks) : 0,
  };
}

window.FF.raceWatch = { update, reset, summary, fieldSummary, _book: book };
})();