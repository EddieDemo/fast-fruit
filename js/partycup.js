// PARTY CUP — the wrapper (2026-08-25).
//
// Three party events drawn from the pool, scored on the race cup's
// own points law, rewarded through the race cup's own endpoints.
// TONIGHT'S POOL IS ONE EVENT (Ski Jump ×3, ruled: no differentiation
// yet) — the draw machinery is real, its pool is small.
//
// SEPARATION: this module owns cup STATE and leg sequencing. Events
// own their worlds (skijump.js); the chassis owns scoring mechanics
// (session.js); rewards go through melon.js/xp.js — the SAME doors
// the race cup walks through ("do whatever the race cup does",
// ruled): XP_RACE banks per completed leg, XP_CUP + recordCup at
// completion, via cup.pointsFor for the leg points.
//
// STATED STAND-IN: the final screen mirrors the race finish at the
// places-rows level (place, name, pilot, per-leg bests, points);
// the full tabbed finish with relevance filtering is next session's
// work, designed (tabs declare their data; absent data, absent tab).
(function () {
'use strict';
if (typeof window === 'undefined') return;
window.FF = window.FF || {};

const LEGS = 3;
const DUR_TICKS = 2 * 60 * 120;   // two minutes (Eddie's ruling)

// The draw: curated by slot when the pool grows; today every slot
// draws the one event we have.
const POOL = ['skijump'];
function drawEvent() { return POOL[0]; }

let cup = null;   // { leg, legRows: [][], points: {key: n}, handledOver }

function begin() {
  cup = { leg: 0, legRows: [], points: {}, handledOver: false };
  startLeg();
}

function startLeg() {
  cup.handledOver = false;
  const ev = drawEvent();
  if (ev === 'skijump') window.FF.skijump.start({ durTicks: DUR_TICKS });
}

// Pure: fold one leg's rows into the running points table.
// Exported for the suite; the race cup's own pointsFor is the law.
function foldLeg(points, rows, fieldSize) {
  for (const r of rows) {
    points[r.key] = (points[r.key] || 0)
      + window.FF.cup.pointsFor(r.place, fieldSize);
  }
  return points;
}

// Pure: final table from the points map, ties by best single-leg
// place (then name, for total order).
function finalTable(points, legRows) {
  const bestPlace = {};
  for (const rows of legRows) {
    for (const r of rows) {
      if (bestPlace[r.key] === undefined || r.place < bestPlace[r.key]) {
        bestPlace[r.key] = r.place;
      }
    }
  }
  const keys = Object.keys(points);
  keys.sort((a, b) => (points[b] - points[a])
    || (bestPlace[a] - bestPlace[b]) || (a < b ? -1 : 1));
  return keys.map((k, i) => ({ key: k, place: i + 1, points: points[k] }));
}

function legStandings(st) {
  const S = window.FF.session;
  const bodies = [st.players[0].melon].concat(st.bots.map((b) => b.melon));
  const rows = bodies.map((m, i) => ({
    key: window.FF.racerKey(m),
    name: m.name || '?',
    pilot: m.pilot || '',
    isPlayer: m === st.players[0].melon,
    place: st.session.rank[i] || bodies.length,
    bestStr: S.formatBest(st, m),
  }));
  rows.sort((a, b) => a.place - b.place);
  return rows;
}

function onLegOver(st) {
  const rows = legStandings(st);
  cup.legRows.push(rows);
  foldLeg(cup.points, rows, rows.length);
  // XP BANKS AT THE LEG, the race cup's own rule: a completed session
  // is a finished leg (sessions cannot DNF — the clock always ends).
  const M = window.FF.melon;
  if (M && M.addXp && window.FF.xp) M.addXp(window.FF.xp.XP_RACE);
  cup.leg++;
  if (cup.leg < LEGS) { startLeg(); return; }
  complete(st);
}

function complete(st) {
  const table = finalTable(cup.points, cup.legRows);
  const meKey = window.FF.racerKey(st.players[0].melon);
  const mine = table.find((r) => r.key === meKey);
  const M = window.FF.melon;
  // THE SAME COMPLETION DOORS AS THE RACE CUP: recordCup with the
  // player's place in the cup's own table, and XP_CUP on top of the
  // per-leg banks. Nothing party-specific is invented here.
  if (M && M.recordCup && mine) M.recordCup({ place: mine.place, points: mine.points });
  if (M && M.addXp && window.FF.xp) M.addXp(window.FF.xp.XP_CUP);
  showFinal(st, table);
}

// ---- Presentation ------------------------------------------------
function watch() {
  const st = window.FF._state;
  if (cup && st && st.session && st.session.over && !cup.handledOver) {
    cup.handledOver = true;
    onLegOver(st);
  }
  requestAnimationFrame(watch);
}

function nameOf(key) {
  for (const rows of cup.legRows) {
    for (const r of rows) if (r.key === key) return r;
  }
  return { name: '?', pilot: '', isPlayer: false };
}

function bestsOf(key) {
  return cup.legRows.map((rows) => {
    const r = rows.find((q) => q.key === key);
    return r ? r.bestStr : '\u2014';
  });
}

function showFinal(st, table) {
  const wrap = document.createElement('div');
  wrap.className = 'ff-screen';
  const rows = table.map((t) => {
    const who = nameOf(t.key);
    return '<div style="display:flex;gap:8px;align-items:baseline;'
      + 'padding:4px 2px;border-bottom:1px solid #1c2a1c;'
      + (who.isPlayer ? 'color:#39ff5f;' : 'color:#cfe0cf;') + '">'
      + '<span style="width:24px;">' + t.place + '.</span>'
      + '<span style="flex:1;">' + who.name + '</span>'
      + bestsOf(t.key).map((b) => '<span style="width:56px;text-align:right;'
        + 'color:#8fa892;font-size:11px;">' + b + '</span>').join('')
      + '<span style="width:44px;text-align:right;">' + t.points + 'pt</span>'
      + '</div>';
  }).join('');
  wrap.innerHTML = '<div style="background:#0a0e0a;border:1px solid #2a5a34;'
    + 'border-radius:12px;padding:18px 22px;min-width:320px;max-width:94vw;'
    + 'max-height:86vh;overflow:auto;font-family:ui-monospace,Menlo,monospace;">'
    + '<div style="color:#39ff5f;font-size:15px;letter-spacing:1px;'
    + 'margin-bottom:2px;">PARTY CUP \u00b7 FINAL</div>'
    + '<div style="color:#5d7060;font-size:11px;margin-bottom:10px;">'
    + 'ski jump \u00d7 3 \u00b7 bests per event \u00b7 points</div>'
    + rows
    + '<div style="display:flex;gap:10px;margin-top:14px;">'
    + '<button id="ffpc-again" style="flex:1;padding:10px;border-radius:8px;'
    + 'background:#12331c;border:1px solid #39ff5f;color:#39ff5f;'
    + 'font:13px ui-monospace,monospace;cursor:pointer;">RUN IT BACK</button>'
    + '<button id="ffpc-menu" style="flex:1;padding:10px;border-radius:8px;'
    + 'background:#101410;border:1px solid #2a5a34;color:#9fbfa5;'
    + 'font:13px ui-monospace,monospace;cursor:pointer;">MAIN MENU</button>'
    + '</div></div>';
  document.body.appendChild(wrap);
  document.getElementById('ffpc-again').onclick = () => { wrap.remove(); begin(); };
  document.getElementById('ffpc-menu').onclick = () => {
    wrap.remove();
    cup = null;
    window.FF.endSessionToDaily();
    if (window.FF.flow) window.FF.flow.go('menu');
  };
}

if (document.body) watch();
else document.addEventListener('DOMContentLoaded', watch);

window.FF.partycup = {
  begin, LEGS, DUR_TICKS,
  _foldLeg: foldLeg, _finalTable: finalTable,
};
})();
