(function () {
'use strict';
// ============================================================
// CUP — the daily event: four races on today's four tracks, scored
// together. THE CUP IS THE DAILY. A single race is practice: same
// track (leg 1), no record, freely retried.
//
// SCORING (Eddie's ruling): straight 12 down to 1 by finishing
// position. Every place-swap is worth exactly one point, which is the
// honest reading of a game where positions are hard-won all the way
// down the grid — and it means your points ARE your inverse position,
// so a player can add up their cup in their head. Cumulative race
// time breaks ties; it is already measured and it is the natural
// shareable number.
//
// UNLIMITED ATTEMPTS. A track does not spend its secret the way a
// word puzzle does — learning it and racing it better IS the game, so
// locking the daily to one attempt would prevent mastery from being
// expressed rather than protect anything. Every completed attempt is
// recorded; the day is ranked on your BEST, with the attempt count
// kept visible so "3rd on the first try" and "3rd on the eleventh"
// stay legible as different achievements.
//
// AN ATTEMPT COUNTS ONLY WHEN ALL FOUR RACES FINISH. Abandoning
// records nothing — not even the legs already run — for the same
// reason abandoning a race records nothing: the record should measure
// racing, not button presses.
//
// This module owns the STATE of a cup in progress and the day's
// record. It draws nothing and steps nothing: flow.js runs the
// screens, main.js runs the races.
// ============================================================

const KEY = 'ff.cup.v1';
const LEGS = 4;

// 12 -> 1. One point per place, the whole way down.
function pointsFor(place, fieldSize) {
  const n = fieldSize || 12;
  if (!place || place < 1) return 0;
  return Math.max(0, n - place + 1);
}

// ---- The cup in progress -----------------------------------------
let active = null;   // { day, tracks, leg, results: [], startedAt }

function begin(day) {
  const tracks = window.FF.dailyCupTracks(day);
  active = {
    day: window.FF.dailyTrackName(day),
    tracks,
    leg: 0,                 // index of the race about to be run
    results: [],            // one per completed leg (the player's)
    table: {},              // every racer's running total, by name
    // ONE CAST FOR THE WHOLE CUP. Names are normally dealt from the
    // race seed, which would field four different sets of rivals and
    // make a points table meaningless. The cup deals its cast once,
    // from the DAY, and every leg reuses it.
    nameSeed: window.FF.trackDefByName(tracks[0]).seed,
  };
  return active;
}

function current() { return active; }
function isRunning() { return !!active && active.leg < LEGS; }
function trackForLeg(i) { return active ? active.tracks[i] : null; }

// Record a finished leg. `standings` is the whole field in order —
// every racer, not just the player — because a points table is only
// meaningful if it ranks the SAME cast across four races. The cup
// fixes its cast for exactly this reason (see nameSeed below).
function completeLeg(result) {
  if (!active) return null;
  const fieldSize = result.fieldSize || 12;
  active.results.push({
    leg: active.leg,
    track: active.tracks[active.leg],
    place: result.place,
    points: pointsFor(result.place, fieldSize),
    timeSec: result.timeSec === undefined ? null : result.timeSec,
    splats: result.splats || 0,
    fieldSize,
  });
  // Everyone's running total, keyed by name. Ranking the cup is then
  // a fact rather than an estimate.
  for (const row of (result.standings || [])) {
    const key = row.isPlayer ? '\u0000you' : (row.name || '?');
    const e = active.table[key] || (active.table[key] = {
      name: row.name || '?', isPlayer: !!row.isPlayer, points: 0, timeSec: 0, legs: 0,
    });
    e.points += pointsFor(row.pos, fieldSize);
    if (row.timeSec !== null && row.timeSec !== undefined) e.timeSec += row.timeSec;
    e.legs++;
  }
  active.leg++;
  return active;
}

// The cup standings so far: most points, cumulative time breaking
// ties — exactly the rule stated to the player.
function table() {
  if (!active) return [];
  const rows = Object.values(active.table).slice();
  rows.sort((a, b) => (b.points - a.points) || (a.timeSec - b.timeSec));
  rows.forEach((r, i) => { r.pos = i + 1; });
  return rows;
}

function playerPlace() {
  const t = table();
  const me = t.find(r => r.isPlayer);
  return me ? me.pos : null;
}

function totals() {
  if (!active) return { points: 0, timeSec: 0, legs: 0 };
  let points = 0, timeSec = 0, timed = 0;
  for (const r of active.results) {
    points += r.points;
    if (r.timeSec !== null) { timeSec += r.timeSec; timed++; }
  }
  return { points, timeSec, timed, legs: active.results.length };
}

function isComplete() { return !!active && active.results.length >= LEGS; }

function abandon() { active = null; }

// ---- The day's record --------------------------------------------
// Kept per DAY, so yesterday's attempts never dilute today's. Only
// completed attempts land here.
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.v === 1) return data;
  } catch (_) {}
  return { v: 1, days: {} };
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
}

function dayRecord(day) {
  const store = load();
  return store.days[day || (active && active.day) || window.FF.dailyTrackName()] || null;
}

// Finish the cup: bank the attempt, rank the day on the BEST one.
function finish() {
  if (!isComplete()) return null;
  const t = totals();
  const place = playerPlace();
  const store = load();
  const day = active.day;
  const rec = store.days[day] || { attempts: 0, bestPoints: null, bestTimeSec: null, bestAt: null, lastPoints: null };
  rec.attempts++;
  rec.lastPoints = t.points;
  rec.lastTimeSec = t.timeSec;
  // BEST = most points; cumulative time breaks a tie, exactly as the
  // live standings do.
  const better = rec.bestPoints === null
    || t.points > rec.bestPoints
    || (t.points === rec.bestPoints && t.timeSec < rec.bestTimeSec);
  if (better) {
    rec.bestPoints = t.points;
    rec.bestTimeSec = t.timeSec;
    rec.bestAt = rec.attempts;
  }
  store.days[day] = rec;
  // Keep the store small: a fortnight of days is plenty of history.
  const days = Object.keys(store.days).sort();
  while (days.length > 14) delete store.days[days.shift()];
  save(store);
  return { totals: t, place, record: rec, results: active.results.slice(), table: table() };
}

window.FF.cup = {
  LEGS, pointsFor, begin, current, isRunning, isComplete, trackForLeg,
  completeLeg, totals, table, playerPlace, finish, abandon, dayRecord,
  nameSeed: () => (active ? active.nameSeed : null),
  _load: load,
};
})();