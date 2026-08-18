(function () {
'use strict';
// ============================================================
// CUP — the daily event: one race per leg on today's tracks, scored
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
// THREE LEGS (ruled 2026-08-15, was four): this is a mobile game, and
// a cup you can always finish inside a short session beats a grander
// one you sometimes abandon. The trade is a smaller comeback window —
// one bad race is now a third of the cup, not a quarter — accepted
// with eyes open; the points law still rewards consistency across
// what legs there are.
const LEGS = 3;
// What a leg costs a racer who could not finish it. Large enough that
// no finished lap can outweigh it, finite so the totals stay
// readable. Applies to the PLAYER too: a cup where you failed to
// finish a leg should not tie-break ahead of one where you did.
const DNF_PENALTY_SEC = 3600;

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
  // Pilot xp at the gun: the cup-end reveal card animates the bar
  // from here. Tolerated missing on old resumed cups (falls back to
  // the current total, a bar that simply doesn't move).
  const xpStart = (window.FF.melon && window.FF.melon.pilotXp) ? window.FF.melon.pilotXp() : 0;
  active = {
    // The day key derives from the tracks already drawn — a second
    // dailyTrackName() call would mint a DIFFERENT name under the dev
    // random-track flag and split the cup from its own record key.
    day: tracks[0],
    xpStart,
    tracks,
    leg: 0,                 // index of the race about to be run
    results: [],            // one per completed leg (the player's)
    table: {},              // every racer's running total, by name
    // ONE CAST FOR THE WHOLE CUP. Names are normally dealt from the
    // race seed, which would field a different set of rivals per leg and
    // make a points table meaningless. The cup deals its cast once,
    // from the DAY, and every leg reuses it.
    nameSeed: window.FF.trackDefByName(tracks[0]).seed,
  };
  return active;
}

function current() { return active; }

// Rehydrate a cup from a snapshot. Only the fields the cup actually
// owns — the tracks are re-derived from the day, so a change to the
// leg-seed rule can never resurrect a cup pointing at stale terrain.
function resume(saved) {
  if (!saved || !saved.day) return null;
  const tracks = window.FF.dailyCupTracks();
  if (saved.day !== window.FF.dailyTrackName()) return null;  // yesterday's cup
  active = {
    day: saved.day,
    tracks,
    leg: Math.max(0, Math.min(LEGS, saved.leg || 0)),
    results: (saved.results || []).slice(),
    table: saved.table || {},
    nameSeed: saved.nameSeed !== undefined && saved.nameSeed !== null
      ? saved.nameSeed
      : window.FF.trackDefByName(tracks[0]).seed,
  };
  return active;
}
function isRunning() { return !!active && active.leg < LEGS; }
function trackForLeg(i) { return active ? active.tracks[i] : null; }

// Record a finished leg. `standings` is the whole field in order —
// every racer, not just the player — because a points table is only
// meaningful if it ranks the SAME cast across every race. The cup
// fixes its cast for exactly this reason (see nameSeed below).
function completeLeg(result) {
  if (!active) return null;
  const fieldSize = result.fieldSize || 12;
  active.results.push({
    leg: active.leg,
    track: active.tracks[active.leg],
    place: result.place,
    points: pointsFor(result.place, fieldSize),
    timeSec: (result.timeSec === undefined || result.timeSec === null || result.dnf)
      ? null : result.timeSec,
    dnf: !!result.dnf,
    splats: result.splats || 0,
    fieldSize,
    // THE NEXT GRID (ruled 2026-08-16): the whole field starts leg
    // N+1 where it finished leg N — everyone, player included, no
    // special case. Stored as identity keys in finishing order (pos 1
    // first = pole), so the grid IS the last result made physical.
    // Rides the results array into the resume snapshot for free. A
    // DNF's pos already classifies last (the time penalty), so a dead
    // melon gridding at the back next leg is a consequence, not a
    // rule.
    order: (result.standings || []).slice()
      .sort((a, b) => (a.pos || 99) - (b.pos || 99))
      .map(r => r.key || r.pilot || r.name || '?'),
  });
  // Everyone's running total, keyed by name. Ranking the cup is then
  // a fact rather than an estimate.
  for (const row of (result.standings || [])) {
    // KEYED BY RACER IDENTITY, not by melon name (2026-08-14). A cup
    // ranks COMPETITORS across four races; the melon is the body they
    // entered. Keying on the melon name also meant the player needed a
    // reserved sentinel to avoid colliding with a rival who happened
    // to share a name — the pilot key is unique by construction, so
    // the sentinel is gone.
    const key = row.key || row.pilot || row.name || '?';
    const e = active.table[key] || (active.table[key] = {
      key,
      name: row.name || '?',
      // The PILOT rides with the entry: a cup table ranks competitors
      // over four races, so it has to be able to say who they are and
      // not only which melon they entered.
      pilot: row.pilot || '',
      isPlayer: !!row.isPlayer, points: 0, timeSec: 0, legs: 0,
    });
    e.points += pointsFor(row.pos, fieldSize);
    // TIME IS A TIEBREAK, so a missing time must count as the WORST
    // outcome, never as zero. Treating "did not finish" as no time at
    // all is what let the slowest melons win the tiebreak: they
    // contributed nothing to their own total. A DNF leg is charged a
    // full penalty instead.
    if (row.timeSec !== null && row.timeSec !== undefined && !row.dnf) {
      e.timeSec += row.timeSec;
    } else {
      e.timeSec += DNF_PENALTY_SEC;
      e.dnfs = (e.dnfs || 0) + 1;
    }
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

// The grid for the leg about to run: the previous leg's finishing
// order, or null when there is no previous leg (leg 1) — the caller's
// default then applies (player at the back, the unknown entrant).
function gridOrder() {
  if (!active || !active.results.length) return null;
  const last = active.results[active.results.length - 1];
  return (last.order && last.order.length) ? last.order.slice() : null;
}

function playerPlace() {
  const t = table();
  const me = t.find(r => r.isPlayer);
  return me ? me.pos : null;
}

function totals() {
  if (!active) return { points: 0, timeSec: 0, legs: 0 };
  let points = 0, timeSec = 0, timed = 0, dnfs = 0;
  for (const r of active.results) {
    points += r.points;
    if (r.timeSec !== null && !r.dnf) { timeSec += r.timeSec; timed++; }
    else { timeSec += DNF_PENALTY_SEC; dnfs++; }
  }
  return { points, timeSec, timed, dnfs, legs: active.results.length };
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
  LEGS, pointsFor, DNF_PENALTY_SEC, begin, current, isRunning, isComplete, trackForLeg, gridOrder,
  completeLeg, totals, table, playerPlace, finish, abandon, dayRecord, resume,
  nameSeed: () => (active ? active.nameSeed : null),
  _load: load,
};
})();