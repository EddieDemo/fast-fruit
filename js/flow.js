(function () {
'use strict';
// ============================================================
// FLOW — the game-state machine and its screens.
//
// One authority over "what mode is the game in": 'menu', 'race',
// 'finish' (and any state registered later — 'pause' is a one-liner
// away). main.js asks flow.state to decide whether the solo sim
// steps; everything else (panels, buttons, standings capture) lives
// here. Netplay bypasses the screens entirely: lockstep sessions own
// their own start, and a local menu over a shared sim is a desync
// dressed as UI.
//
// Screens are DOM overlays built (and styled) by this module, so the
// feature deploys as ONE file plus a script tag — no styles.css or
// index.html surgery to forget on a device (the stale-copy lesson).
//
//   MENU:   your melon, slowly rotating; stable selector if you own
//           more than one; RACE.
//   FINISH: the standings AS THE PLAYER CROSSED THE LINE — position,
//           a slowly rotating render of each racer's actual body
//           (species, pigment, pattern), name; RETRY / MAIN MENU.
//
// Presentation tier throughout: reads sim state, never writes it.
// ============================================================

const flow = { state: 'boot' };
let stateRef = null;
let respawnFn = null;
let netplayFn = null;   // () => true while a lockstep session is live
let exhibitionHooks = null;
let finishHandledTick = null;
let spinRAF = 0;

// ---- Styles (scoped, injected) ----
const CSS = `
.ff-screen { position: fixed; inset: 0; display: flex; align-items: center;
  justify-content: center; z-index: 40; background: rgba(5, 8, 5, 0.72);
  font-family: ui-monospace, Menlo, monospace;
  /* Safe areas: landscape phones put the notch on a SIDE, and the
     home indicator eats the bottom in both orientations. */
  padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
           max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  box-sizing: border-box; }
/* ============ THE PANEL CONTRACT ============
   Every screen is HEAD / BODY / FOOT:
     .ff-head  fixed  — title, subtitle, tabs. Never scrolls away.
     .ff-body  fluid  — the only thing that scrolls, and the only
                        thing allowed to run out of room.
     .ff-foot  fixed  — the buttons. Pinned by construction, so they
                        cannot be pushed off a short screen.
   The panel is VIEWPORT-BOUNDED, never content-sized.

   min-height: 0 on the body is the load-bearing line: a flex child
   defaults to min-height:auto and REFUSES to shrink below its
   content, so without it the body pushes the foot off the screen
   instead of scrolling. That single omission produced all three
   landscape bugs (menu RACE button unreachable, finish MAIN MENU
   outside the box, panel resizing between tabs).

   dvh over vh so retracting mobile browser chrome doesn't re-clip. */
.ff-panel { background: rgba(10, 14, 10, 0.96); border: 1px solid #1f3a24;
  border-radius: 10px; padding: 20px 24px; min-width: 280px; max-width: 86vw;
  max-height: 100%; display: flex; flex-direction: column; box-sizing: border-box;
  color: #cfe8cf; box-shadow: 0 12px 60px rgba(0,0,0,0.6); }
.ff-head, .ff-foot { flex: none; }
.ff-body { flex: 1 1 auto; min-height: 0; overflow-y: auto;
  -webkit-overflow-scrolling: touch; }
/* A row of buttons: the stacked width:100% must NOT survive into a
   row, or two buttons demand 200% of the container and the second
   one leaves the panel. Stated on the container so every future
   button row inherits the fix instead of rediscovering the bug. */
.ff-buttons { display: flex; gap: 8px; }
.ff-buttons .ff-btn { flex: 1 1 0; width: auto; min-width: 0; }
.ff-title { color: var(--c-accent); font-size: var(--fs-title); font-weight: 700;
  letter-spacing: 2px; margin: 0 0 14px; text-align: center; }
.ff-sub { color: var(--c-dim); font-size: var(--fs-body); text-align: center; margin: 0 0 16px; }
.ff-melon-row { display: flex; align-items: center; justify-content: center;
  gap: 14px; margin: 6px 0 10px; }
.ff-melon-name { font-size: var(--fs-lead); color: var(--c-text); min-width: 120px; text-align: center; }
/* The menu panel is wider than the others: it carries a portrait of
   the melon AND its papers. */
.ff-screen.ff-menu-screen .ff-panel { min-width: 320px; max-width: min(92vw, 620px); }
/* THE PORTRAIT. Sized from the viewport in BOTH axes — vw alone
   overflows a short landscape window, vh alone leaves a postage stamp
   on a tall narrow one — with a hard cap so a desktop monitor doesn't
   get an absurd melon. */
canvas.ff-spin.ff-portrait { width: min(52vw, 34vh, 260px); height: min(52vw, 34vh, 260px); }
.ff-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px;
  margin: 2px 0 10px; }
.ff-section { font-size: var(--fs-micro); letter-spacing: 0.16em; color: var(--c-accent);
  border-top: 1px solid #1f3a24; padding-top: 8px; margin-top: 2px; }
.ff-stat-row { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 5px 0 6px; border-bottom: 1px solid #14261a; min-width: 0; }
.ff-stat-row .k { font-size: var(--fs-micro); letter-spacing: 0.09em; color: var(--c-dim); flex: none; }
.ff-stat-row .v { font-size: var(--fs-body); color: var(--c-text); text-align: right;
  font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.ff-stat-row .v small { display: block; font-size: var(--fs-micro); color: var(--c-faint);
  letter-spacing: 0.04em; margin-top: 1px; line-height: 1.2; }
/* The menu sizes to content while it FITS, and stops at the viewport:
   height:auto with a max-height gives a tight panel on a tall screen
   and a bounded, scrolling one on a short screen — no dead gap, no
   escaped button. (height:auto ALONE was the landscape bug: nothing
   bounded it, so RACE fell off the bottom.) */
.ff-screen.ff-menu-screen .ff-panel { height: auto; max-height: 100%; }
/* SHORT VIEWPORTS: portrait beside the papers, not above them — the
   same fix the finish screen needed, for the same reason. */
@media (max-height: 560px) {
  .ff-menu-body { display: flex; align-items: center; gap: 16px; }
  .ff-menu-left { flex: none; display: flex; flex-direction: column; align-items: center; }
  .ff-menu-right { flex: 1 1 auto; min-width: 0; }
  .ff-stats { grid-template-columns: 1fr; margin: 0; }
  canvas.ff-spin.ff-portrait { width: min(34vw, 46vh, 200px); height: min(34vw, 46vh, 200px); }
}
.ff-btn { display: block; width: 100%; margin: 8px 0 0; padding: 12px;
  background: #123018; color: var(--c-accent); border: 1px solid #2a5a34;
  border-radius: 7px; font: inherit; font-size: var(--fs-lead); letter-spacing: 1px;
  cursor: pointer; }
.ff-btn:active { background: #1a4522; }
.ff-btn.ff-secondary { color: #9fc7a5; border-color: #23402a; background: #0d1f12; }
.ff-arrow { background: none; border: 1px solid #2a5a34; color: var(--c-accent);
  border-radius: 6px; font: inherit; font-size: var(--fs-lead); padding: 6px 12px; cursor: pointer; }
/* A STATED height, not an inferred one: PLACES, RACE and YOU have
   different content heights, and a content-sized panel visibly
   breathed as you tapped between them. Bounded by the viewport, so
   this is a target rather than a demand. */
.ff-screen.ff-finish-screen .ff-panel { height: min(88dvh, 620px); }
.ff-tabs { flex: none; display: flex; gap: 4px; margin: 0 0 10px; }
.ff-tab { flex: 1; padding: 7px 4px; border-radius: 7px; cursor: pointer;
  background: #0d1f12; border: 1px solid #1b3823; color: var(--c-dim);
  font: inherit; font-size: var(--fs-label); letter-spacing: 0.1em; }
.ff-tab.on { background: #123018; color: var(--c-accent); border-color: #2a5a34; }
.ff-pane { display: none; }
.ff-pane.on { display: block; }
/* Superlatives: label above, winner and value below. */
.ff-facts { }
.ff-fact { display: flex; align-items: baseline; justify-content: space-between;
  gap: 10px; padding: 7px 2px; border-bottom: 1px solid #14261a; }
.ff-fact-l { font-size: var(--fs-micro); letter-spacing: 0.09em; color: var(--c-dim); flex: none; }
.ff-fact-r { text-align: right; min-width: 0; }
.ff-fact-n { display: block; font-size: var(--fs-body); color: var(--c-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ff-fact-v { display: block; font-size: var(--fs-label); color: var(--c-accent);
  font-variant-numeric: tabular-nums; }
.ff-empty { padding: 18px 4px; text-align: center; font-size: var(--fs-body); color: var(--c-faint); }
/* The YOU tab uses the RACE tab's rows verbatim — one list shape for
   both, so the tabs read as one screen with different contents. */
.ff-summary { margin: 2px 0 10px; }
.ff-fact-n.hi { color: var(--c-accent); }
/* The panes no longer scroll themselves — .ff-body owns the scroll,
   so a pane is just content and the tab bar can never be pushed off
   by a long standings list. */
.ff-rows { margin: 4px 0 10px; }
.ff-title, .ff-btn, .ff-melon-row, .ff-melon-name, .ff-sub { flex: none; }
.ff-row { display: flex; align-items: center; gap: 12px; padding: 6px 4px;
  border-bottom: 1px solid #14261a; }
.ff-row.ff-you { background: rgba(57, 255, 95, 0.07); border-radius: 6px; }
/* NON-PODIUM places recede. Silver (2nd) is a pale grey by nature, so
   a bone-white 4th sitting next to it read as a second silver — the
   podium stopped looking like a podium. The rest of the field is now
   dimmer, lighter in weight and slightly smaller, so the top three
   are the only bright, heavy numbers on the screen. */
.ff-pos { width: 62px; color: rgba(207, 232, 207, 0.42); font-size: var(--fs-title); font-weight: 400;
  text-align: right; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
.ff-pos .ff-ord { font-size: var(--fs-body); font-weight: 400; color: rgba(127, 163, 131, 0.5);
  /* On the numeral's SHOULDER — the same ordinal convention the
     in-race labels use. One idea, one styling. */
  vertical-align: super; }
/* The podium: bright, bold and a size larger than the field. */
.ff-row:nth-child(-n+3) .ff-pos { font-size: var(--fs-hero); font-weight: 700; }
.ff-row:nth-child(-n+3) .ff-pos .ff-ord { font-size: var(--fs-lead); font-weight: 600; color: var(--c-dim); }
/* The podium reads at a glance: gold, silver, bronze. */
.ff-row:nth-child(1) .ff-pos { color: var(--c-gold); }
.ff-row:nth-child(2) .ff-pos { color: var(--c-silver); }
.ff-row:nth-child(3) .ff-pos { color: var(--c-bronze); }
/* YOUR row is never dimmed: finishing 9th should still be legible at
   a glance, and it is the one row you look for. */
.ff-row.ff-you .ff-pos { color: var(--c-accent); font-weight: 700; }
.ff-row.ff-you .ff-pos .ff-ord { color: rgba(57, 255, 95, 0.75); }
.ff-rname { font-size: var(--fs-body); color: var(--c-text); flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ff-rtime { font-size: var(--fs-micro); color: var(--c-dim); letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums; margin-top: 1px; }
.ff-row.ff-you .ff-rtime { color: var(--c-accent); }
.ff-you-tag { flex: none; }
.ff-you-tag { color: var(--c-accent); font-size: var(--fs-label); letter-spacing: 1px; }
canvas.ff-spin { width: 52px; height: 52px; flex: none; }

/* The pause button joins the top-centre cluster: it sits immediately
   LEFT of respawn (which is centred) and daily (at 50%+34), mirroring
   daily's offset on the other side. Styling matches the cluster by
   using the same custom properties, so a theme change carries. */
#ff-pause-btn { position: fixed; z-index: 10;
  top: max(10px, env(safe-area-inset-top));
  right: calc(50% + 34px);
  background: var(--panel-bg, #161616); color: var(--panel-fg, #ddd);
  border: none; border-radius: 10px; padding: 8px 12px;
  font-family: var(--mono, ui-monospace, monospace); font-size: var(--fs-body);
  line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#ff-pause-btn:active { color: var(--panel-accent, #39ff5f); }
#ff-pause-btn[hidden] { display: none; }

/* LANDSCAPE PHONES: short viewports. Everything that costs vertical
   space shrinks — the standings list keeps the space it needs to
   still show several rows, and the buttons sit side by side instead
   of stacking, which alone recovers ~50px. */
@media (max-height: 500px) {
  .ff-panel { padding: 12px 18px; border-radius: 8px; }
  .ff-title { font-size: var(--fs-lead); margin-bottom: 6px; }
  .ff-sub { margin-bottom: 8px; }
  .ff-row { padding: 3px 4px; gap: 9px; }
  canvas.ff-spin { width: 34px; height: 34px; }
  .ff-pos { width: 48px; font-size: var(--fs-lead); }
  .ff-pos .ff-ord { font-size: var(--fs-micro); }
  .ff-row:nth-child(-n+3) .ff-pos { font-size: var(--fs-title); }
  .ff-row:nth-child(-n+3) .ff-pos .ff-ord { font-size: var(--fs-body); }
  .ff-rname { font-size: var(--fs-body); }
  .ff-tabs { margin-bottom: 6px; }
  .ff-tab { padding: 5px 3px; font-size: var(--fs-micro); }
  .ff-fact { padding: 4px 2px; }
  .ff-fact-n { font-size: var(--fs-body); }
  .ff-summary { margin-bottom: 6px; }
  .ff-melon-row { margin: 2px 0 8px; }
  .ff-melon-row canvas.ff-spin { width: 64px; height: 64px; }
  .ff-btn { padding: 9px; font-size: var(--fs-body); margin-top: 6px; }
  /* (the .ff-buttons row contract lives with the panel contract) */
  .ff-buttons .ff-btn { margin-top: 6px; }
}
/* Wide-and-short: let the panel use the horizontal room it has. */
@media (max-height: 500px) and (min-width: 700px) {
  .ff-panel { max-width: 70vw; }
}
`;

// ---- Standings: captured at the instant the player finishes ----
// Pure function so the harness can test the ranking without a DOM.
function computeStandings(state) {
  const rows = [];
  const hz = (window.FF.CONFIG && window.FF.CONFIG.physicsHz) || 120;
  const startTick = state.raceStartTick || 0;
  const push = (m, isPlayer) => rows.push({
    name: m.name || (isPlayer ? 'YOU' : '???'),
    // Elapsed from the race start to THIS racer's own crossing. Null
    // for anyone still out on track when the standings were captured
    // — shown as a dash, because inventing a time for an unfinished
    // racer would be the one dishonest number on the screen.
    timeSec: (m.finishTick === undefined || m.finishTick === null)
      ? null : (m.finishTick - startTick) / hz,
    fruit: m.fruit || 'watermelon',
    color: m.bodyColor || '#37a01c',
    patKey: m.patKey || m.name || 'x',
    a: m.a, b: m.b,
    x: m.x,
    isPlayer,
  });
  for (const p of state.players) push(p.melon, p.melon === state.melon);
  for (const b of state.bots) push(b.melon, false);
  rows.sort((r, q) => q.x - r.x);
  rows.forEach((r, i) => { r.pos = i + 1; });
  return rows;
}

// mm:ss.s from the start line to this racer's own crossing.
function fmtTime(sec) {
  if (sec === null || sec === undefined) return '\u2014';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

// English ordinal suffix. 11/12/13 are the classic trap (eleventh,
// not eleven-first), so the teens are special-cased before the
// last-digit rule — a 12-racer field would have hit it.
function ordinalSuffix(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  const d = n % 10;
  return d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
}

// ---- DOM scaffolding ----
let elMenu = null, elFinish = null;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildMenu() {
  elMenu = el('div', 'ff-screen ff-menu-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'FAST FRUIT'));
  head.appendChild(el('p', 'ff-sub', 'pick your racer'));
  panel.appendChild(head);

  // Two blocks so one media query can flip portrait-above-papers into
  // portrait-beside-papers without touching the DOM.
  const body = el('div', 'ff-menu-body');
  const leftCol = el('div', 'ff-menu-left');
  const rightCol = el('div', 'ff-menu-right');
  const row = el('div', 'ff-melon-row');
  const left = el('button', 'ff-arrow', '\u25C0');
  const spin = el('canvas', 'ff-spin ff-portrait');
  // Initial hint only: syncCanvasSize measures the real box every
  // frame and resizes the backing store to match device pixels.
  spin.width = 560; spin.height = 560;
  const right = el('button', 'ff-arrow', '\u25B6');
  row.appendChild(left); row.appendChild(spin); row.appendChild(right);
  leftCol.appendChild(row);
  const nameEl = el('div', 'ff-melon-name', '');
  leftCol.appendChild(nameEl);
  const statsEl = el('div', 'ff-stats');
  rightCol.appendChild(statsEl);
  // (Single table now — the CAREER sub-heading retired with the split.
  // melon.career() is untouched and still feeds it.)
  body.appendChild(leftCol);
  body.appendChild(rightCol);
  const bodyZone = el('div', 'ff-body');
  bodyZone.appendChild(body);
  panel.appendChild(bodyZone);

  const race = el('button', 'ff-btn', 'RACE');
  const foot = el('div', 'ff-foot');
  foot.appendChild(race);
  panel.appendChild(foot);
  elMenu.appendChild(panel);
  document.body.appendChild(elMenu);

  const M = window.FF.melon;
  // WHAT THE MENU SHOWS, and in what order. melon.js still computes
  // the full card — every physical stat and the whole career record —
  // and this is purely the menu's editorial choice about which of it
  // earns space on the first screen (Eddie, 2026-08-12). A later
  // "detailed info" view is then a different selection over the same
  // data, not new plumbing: change this list, change the card.
  //
  // The NAME is deliberately absent: it sits under the portrait as a
  // heading, not as a row in a table of statistics.
  const MENU_ROWS = ['species', 'weight', 'races', 'wins', 'podiums', 'best'];

  // One renderer for both halves: stats() and career() return the
  // same row shape, so the card grows by adding rows in melon.js and
  // never by editing the menu.
  const renderRows = (box, rows) => {
    box.textContent = '';
    for (const r of rows) {
      const line = el('div', 'ff-stat-row');
      line.appendChild(el('span', 'k', r.label));
      const v = el('span', 'v', r.value);
      if (r.note) v.appendChild(el('small', null, r.note));
      line.appendChild(v);
      box.appendChild(line);
    }
  };
  const fillStats = () => {
    const design = window.FF.studio && window.FF.studio.design;
    const fruit = (design && design.fruit) || 'watermelon';
    // Both sources, indexed by key, then selected in the declared
    // order. Unknown keys are skipped rather than rendered blank, so
    // this list can name a row that a future species doesn't have.
    const byKey = new Map();
    for (const r of (M.stats ? M.stats(M.active().seed, fruit) : [])) byKey.set(r.key, r);
    for (const r of (M.career ? M.career() : [])) byKey.set(r.key, r);
    const rows = [];
    for (const k of MENU_ROWS) { const r = byKey.get(k); if (r) rows.push(r); }
    renderRows(statsEl, rows);
  };
  const refresh = () => {
    fillStats();
    const st = M._load();
    const cur = M.active();
    nameEl.textContent = (cur.name || 'unnamed melon')
      + (st.melons.length > 1 ? '  (' + (st.active + 1) + '/' + st.melons.length + ')' : '');
    const many = st.melons.length > 1;
    left.style.visibility = many ? 'visible' : 'hidden';
    right.style.visibility = many ? 'visible' : 'hidden';
  };
  const cycle = (d) => {
    const st = M._load();
    M.setActive((st.active + d + st.melons.length) % st.melons.length);
    refresh();
    // No respawn here any more: during the exhibition a respawn would
    // restart the background race on every arrow press, and the real
    // grid is rebuilt on RACE anyway.
    if (!(window.FF.exhibition && window.FF.exhibition.running) && respawnFn) respawnFn();
  };
  left.addEventListener('click', () => cycle(-1));
  right.addEventListener('click', () => cycle(1));
  race.addEventListener('click', () => {
    fromMenuOrRetry = true;
    if (window.FF.exhibition) window.FF.exhibition.stop();
    if (respawnFn) respawnFn();   // clean grid, real roster, real laps
    flow.go('race');
  });
  elMenu._refresh = refresh;
  elMenu._spin = spin;
  elMenu._stats = statsEl;
}

let elPause = null, elPauseBtn = null;
let fromMenuOrRetry = true; // set by the paths that BEGIN a race
function buildPause() {
  elPause = el('div', 'ff-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'PAUSED'));
  head.appendChild(el('p', 'ff-sub', 'the world is frozen'));
  panel.appendChild(head);
  const resume = el('button', 'ff-btn', 'RESUME');
  const restart = el('button', 'ff-btn ff-secondary', 'RESTART RACE');
  const menu = el('button', 'ff-btn ff-secondary', 'MAIN MENU');
  const foot = el('div', 'ff-foot');
  foot.appendChild(resume);
  foot.appendChild(restart);
  foot.appendChild(menu);
  panel.appendChild(foot);
  elPause.appendChild(panel);
  document.body.appendChild(elPause);
  resume.addEventListener('click', () => flow.go('race'));
  restart.addEventListener('click', () => { if (respawnFn) respawnFn(); fromMenuOrRetry = true; flow.go('race'); });
  menu.addEventListener('click', () => { if (respawnFn) respawnFn(); flow.go('menu'); });

  // The button itself: visible only while racing (a pause control on
  // the pause screen would be a trap).
  elPauseBtn = el('button', null, 'II');
  elPauseBtn.id = 'ff-pause-btn';
  elPauseBtn.setAttribute('aria-label', 'Pause');
  elPauseBtn.hidden = true;
  document.body.appendChild(elPauseBtn);
  elPauseBtn.addEventListener('click', () => {
    if (flow.state === 'race') flow.go('pause');
    else if (flow.state === 'pause') flow.go('race');
  });
  // Escape/P toggle for desktop; ignored while the studio has focus.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    if (flow.state === 'race') flow.go('pause');
    else if (flow.state === 'pause') flow.go('race');
  });
}

function buildFinish() {
  elFinish = el('div', 'ff-screen ff-finish-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'FINISH'));
  // Three tabs: the result, the race, and your run. PLACES leads
  // because it answers the question everyone has at the flag; the
  // other two are for the curious, and burying them behind a tap is
  // what keeps the result page from becoming a spreadsheet.
  const tabs = el('div', 'ff-tabs');
  const panes = {};
  const tabBtns = {};
  const rows = el('div', 'ff-rows');
  const facts = el('div', 'ff-facts');
  const summary = el('div', 'ff-summary');
  const paneDefs = [
    ['places', 'PLACES', rows],
    ['race', 'RACE', facts],
    ['you', 'YOU', summary],
  ];
  for (const [key, label, content] of paneDefs) {
    const btn = el('button', 'ff-tab', label);
    btn.addEventListener('click', () => showTab(key));
    tabs.appendChild(btn);
    tabBtns[key] = btn;
    const pane = el('div', 'ff-pane');
    pane.appendChild(content);
    panes[key] = pane;
  }
  head.appendChild(tabs);
  panel.appendChild(head);
  const bodyZone = el('div', 'ff-body');
  for (const [key] of paneDefs) bodyZone.appendChild(panes[key]);
  panel.appendChild(bodyZone);
  const retry = el('button', 'ff-btn', 'RETRY');
  const menu = el('button', 'ff-btn ff-secondary', 'MAIN MENU');
  const btns = el('div', 'ff-buttons');
  btns.appendChild(retry);
  btns.appendChild(menu);
  const foot = el('div', 'ff-foot');
  foot.appendChild(btns);
  panel.appendChild(foot);
  elFinish.appendChild(panel);
  document.body.appendChild(elFinish);
  retry.addEventListener('click', () => { if (respawnFn) respawnFn(); fromMenuOrRetry = true; flow.go('race'); });
  menu.addEventListener('click', () => { if (respawnFn) respawnFn(); flow.go('menu'); });
  elFinish._rows = rows;
  elFinish._facts = facts;
  elFinish._summary = summary;
  elFinish._panes = panes;
  elFinish._tabBtns = tabBtns;
}

// ---- The rotating racer previews ----
// One rAF loop serves every visible spinner; each row's canvas is
// redrawn via the renderer's own standalone body draw, so previews
// are the REAL species/pigment/pattern, not icons.
const spinners = []; // { canvas, a, b, color, patKey, fruit, angle }
let spinnersPaused = false;
// A canvas has TWO sizes: its CSS box and its backing store. A fixed
// backing store is under-resolved the moment CSS scales the box up on
// a high-DPR screen — and no amount of pattern fidelity survives being
// resampled by a soft canvas. So each spinner sizes its store from the
// box it actually occupies times devicePixelRatio, and re-sizes when
// that changes (rotation, window resize, moving to another monitor).
// Wipe a canvas that is about to be reused. Without this, a spinner
// whose loop hasn't run yet still displays the last thing drawn into
// it — which is how a fresh menu could show a race-old portrait.
function clearCanvas(cv) {
  const ctx = cv.getContext && cv.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
}

function syncCanvasSize(cv) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const rect = cv.getBoundingClientRect();
  const cssW = rect.width || cv.clientWidth || 104;
  const want = Math.max(64, Math.min(1600, Math.round(cssW * dpr)));
  if (cv.width !== want || cv.height !== want) { cv.width = want; cv.height = want; }
  return { dpr, cssW };
}

function spinLoop(now) {
  spinRAF = 0;
  const draw = window.FF.drawMelonStandalone;
  if (!draw || spinnersPaused) return;
  let any = false;
  for (const s of spinners) {
    if (!s.canvas.isConnected) continue;
    any = true;
    s.angle += 0.016 * (s.rate === undefined ? 0.9 : s.rate); // slow, stately
    const { dpr, cssW } = syncCanvasSize(s.canvas);
    const ctx = s.canvas.getContext('2d');
    ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    ctx.save();
    ctx.translate(s.canvas.width / 2, s.canvas.height / 2);
    const fit = (s.canvas.width / 2 - 4 * dpr) / Math.max(s.a, s.b);
    ctx.scale(fit, fit);
    // The pattern raster is built for THIS destination: `fit` is
    // exactly device pixels per world pixel, which is the number the
    // renderer needs and the only place it can be known.
    draw(ctx, s.angle, s.a, s.b, s.color, s.patKey, s.fruit, fit);
    ctx.restore();
  }
  if (any && flow.state !== 'race') spinRAF = requestAnimationFrame(spinLoop);
}
function startSpinners() {
  if (!spinRAF) spinRAF = requestAnimationFrame(spinLoop);
}

// ---- The machine ----
const SCREENS = {};
flow.register = function (name, screen) { SCREENS[name] = screen; };
flow.go = function (name) {
  const prev = SCREENS[flow.state];
  if (prev && prev.exit) prev.exit();
  flow.state = name;
  const next = SCREENS[name];
  if (next && next.enter) next.enter();
};

flow.register('menu', {
  enter() {
    // Scenery: a full grid of bots lapping today's daily behind the
    // panel. Started here and stopped on exit, so it can never
    // outlive the screen that owns it.
    if (window.FF.exhibition && exhibitionHooks) window.FF.exhibition.start(exhibitionHooks);
    elMenu.style.display = 'flex';
    elMenu._refresh();
    spinners.length = 0;
    clearCanvas(elMenu._spin);
    const M = window.FF.melon;
    const d = M.derive(M.active().seed);
    const design = window.FF.studio && window.FF.studio.design;
    const fruit = (design && design.fruit) || 'watermelon';
    const F = window.FF.FRUITS[fruit] || {};
    // Semi-major from CONFIG, not a hard-coded 46: the portrait must
    // track the same reference the sim uses if the tune panel moves it.
    const a = window.FF.CONFIG.semiMajor * d.scale * (F.sizeMult || 1);
    spinners.push({
      // The hero portrait turns slower than the results rows: it is
      // being looked AT, not glanced at.
      rate: 0.55,
      canvas: elMenu._spin, angle: 0,
      a, b: a * (F.aspect || 0.78),
      color: (design && design.color) || d.bodyColor,
      patKey: (design && design.patKey) || String(M.active().seed),
      fruit,
    });
    spinnersPaused = false; // this screen's portrait always turns
    startSpinners();
  },
  exit() {
    // Pressing RACE resets to a clean grid: you cannot be handed a
    // lap-two position you did not earn, so the exhibition is torn
    // down and a real race is built fresh (respawnFn below).
    if (window.FF.exhibition) window.FF.exhibition.stop();
    elMenu.style.display = 'none';
  },
});

flow.register('race', {
  enter() {
    if (elPauseBtn) elPauseBtn.hidden = false;
    // Commentary records are RACE-scoped: "biggest hit survived"
    // means this race, not this session. Only a fresh start clears
    // them — resuming from pause must not (you'd re-earn records you
    // already set).
    if (fromMenuOrRetry) {
      if (window.FF.ticker) window.FF.ticker.reset();
      if (window.FF.raceWatch) window.FF.raceWatch.reset();
      if (window.FF.events) window.FF.events.reset();
      fromMenuOrRetry = false;
    }
  },
  exit() { if (elPauseBtn) elPauseBtn.hidden = true; },
});

// PAUSE: a frozen world, nothing captured, nothing reset. main.js
// already gates the solo sim on flow.state === 'race', so the machine
// does the pausing — this screen is only the face of it. (Netplay is
// never gated: pausing a lockstep race would desync the session.)
flow.register('pause', {
  enter() { elPause.style.display = 'flex'; },
  exit() { elPause.style.display = 'none'; },
});

flow.register('finish', {
  enter() {
    // THE ONE CAREER WRITE. This is the only moment a race is
    // genuinely complete, and entering this state happens exactly once
    // per finish (flow.onFrame fires on the crossing tick and latches),
    // so the record can't double-count. Everything written comes from
    // the standings captured at the flag and the race book — no new
    // measurement, no second source of truth.
    const M = window.FF.melon;
    if (M && M.recordRace) {
      const rowsNow = computeStandings(stateRef);
      const mine = rowsNow.find(r => r.isPlayer);
      const rw = window.FF.raceWatch;
      const sum = (rw && rw.summary) ? rw.summary(stateRef) : {};
      if (mine) {
        M.recordRace({
          place: mine.pos,
          fieldSize: rowsNow.length,
          splats: sum.deaths || 0,
          bestLapTicks: (stateRef.race && stateRef.race.bestLapTicks) || null,
          distanceM: mine.x / 100,
          biggestSurvived: sum.biggestSurvived || 0,
        });
      }
    }
    // Hand the melon over: the field keeps racing behind the panel.
    // Solo only — in netplay peers exchange inputs, so substituting
    // local AI would desync the session (netplay bypasses these
    // screens anyway; the guard is belt and braces).
    if (window.FF.autopilot) window.FF.autopilot.engage(stateRef, { netplay: !!netplayFn && netplayFn() });
    elFinish.style.display = 'flex';
    const rows = elFinish._rows;
    rows.textContent = '';
    spinners.length = 0;
    for (const r of computeStandings(stateRef)) {
      const row = el('div', 'ff-row' + (r.isPlayer ? ' ff-you' : ''));
      // Ordinal, with the suffix styled small: the NUMBER is the
      // thing you read across the room.
      const pos = el('div', 'ff-pos', String(r.pos));
      pos.appendChild(el('span', 'ff-ord', ordinalSuffix(r.pos)));
      row.appendChild(pos);
      const c = el('canvas', 'ff-spin');
      c.width = 104; c.height = 104; // hint; syncCanvasSize owns it
      row.appendChild(c);
      const nm = el('div', 'ff-rname', r.name);
      if (r.isPlayer) nm.appendChild(el('span', 'ff-you-tag', '  \u2014 YOU'));
      nm.appendChild(el('div', 'ff-rtime', fmtTime(r.timeSec)));
      row.appendChild(nm);
      rows.appendChild(row);
      clearCanvas(c);
      spinners.push({ canvas: c, angle: r.pos * 0.7, a: r.a, b: r.b, color: r.color, patKey: r.patKey, fruit: r.fruit });
    }
    fillFacts();
    fillSummary();
    showTab('places');   // the result first; curiosity is one tap away
    startSpinners();
  },
  exit() {
    if (window.FF.autopilot) window.FF.autopilot.disengage();
    // Release the tab-scoped pause: it is meaningless once this
    // screen is gone, and leaving it set froze the next screen's
    // spinners.
    spinnersPaused = false;
    elFinish.style.display = 'none';
  },
});

function showTab(key) {
  const panes = elFinish._panes, btns = elFinish._tabBtns;
  for (const k of Object.keys(panes)) {
    panes[k].classList.toggle('on', k === key);
    btns[k].classList.toggle('on', k === key);
  }
  // Spinners live in the PLACES pane; a hidden canvas would keep the
  // rAF loop alive for nothing, and isConnected can't see display:none.
  // SCOPED TO THIS SCREEN: leaving the finish on the RACE or YOU tab
  // used to strand this flag as true, so the menu's portrait never
  // animated and simply showed whatever pixels the canvas still held
  // from before the race — a stale bitmap, stretched by CSS, which
  // reads exactly like "low fidelity and won't rotate".
  spinnersPaused = key !== 'places';
  if (!spinnersPaused) startSpinners();
}

// ---- The RACE tab: superlatives over the whole field -------------
function fillFacts() {
  const box = elFinish._facts;
  box.textContent = '';
  const rw = window.FF.raceWatch;
  const facts = (rw && rw.fieldSummary) ? rw.fieldSummary() : [];
  if (!facts.length) {
    box.appendChild(el('div', 'ff-empty', 'a quiet race — nothing to report'));
    return;
  }
  for (const f of facts) {
    const row = el('div', 'ff-fact');
    row.appendChild(el('div', 'ff-fact-l', f.label));
    const right = el('div', 'ff-fact-r');
    right.appendChild(el('div', 'ff-fact-n', f.name));
    right.appendChild(el('div', 'ff-fact-v', f.value));
    row.appendChild(right);
    box.appendChild(row);
  }
}

// ---- The race summary -------------------------------------------
// The finish screen is the one place stats can be DENSE: nothing is
// competing for attention and the race is over. racewatch keeps the
// book during the race (it is the module that already knows race
// context); this only lays it out. Stats that didn't happen are
// omitted rather than shown as zeroes — a wall of 0s reads as
// failure, and an empty slot reads as "not this time".
function fillSummary() {
  const box = elFinish._summary;
  box.textContent = '';
  const rw = window.FF.raceWatch;
  if (!rw || !rw.summary) return;
  const s = rw.summary(stateRef);
  // SAME SHAPE AS THE RACE TAB: label left, value right, one row each
  // (the three-across stat grid put the label under the number, so
  // the two tabs read as different screens). Sharing the row markup
  // means a change to one is a change to both.
  const stat = (v, k, note, hi) => {
    const row = el('div', 'ff-fact');
    row.appendChild(el('div', 'ff-fact-l', k));
    const right = el('div', 'ff-fact-r');
    const n = el('div', 'ff-fact-n' + (hi ? ' hi' : ''), String(v));
    right.appendChild(n);
    if (note) right.appendChild(el('div', 'ff-fact-v', note));
    row.appendChild(right);
    box.appendChild(row);
  };
  // Order kept: the result first, then the flare story, then the rest.
  if (s.bestLapSec !== null) stat(s.bestLapSec.toFixed(1) + 's', 'BEST LAP');
  stat(String(s.deaths), s.deaths === 1 ? 'SPLAT' : 'SPLATS',
    s.deaths === 0 ? 'not a scratch' : null, s.deaths === 0);
  if (s.overtakes) stat(String(s.overtakes), 'OVERTAKES',
    s.passedBy ? s.passedBy + ' passed you' : null);
  if (s.flareSaves) stat(String(s.flareSaves), s.flareSaves === 1 ? 'FLARE SAVE' : 'FLARE SAVES',
    'lives the flare bought', true);
  if (s.biggestSurvived) stat(String(s.biggestSurvived), 'BIGGEST HIT SURVIVED');
  if (s.bestAirSec >= 1) stat(s.bestAirSec.toFixed(1) + 's', 'BEST AIR');
  if (s.longestStreakM >= 100) stat(s.longestStreakM + 'm', 'LONGEST CLEAN RUN');
  if (s.flarePct) stat(s.flarePct + '%', 'TIME FLARED',
    s.deadPct ? s.deadPct + '% dead-sticked' : null);
}

// ---- Hooks for main.js ----
// Called every frame after lap logic: fires the finish screen ONCE
// per race, at the tick the player crossed the line.
flow.onFrame = function (state) {
  if (flow.state !== 'race') return;
  const ft = state.race && state.race.finishedTick;
  if (ft !== null && ft !== undefined && ft !== finishHandledTick) {
    finishHandledTick = ft;
    flow.go('finish');
  }
};

flow.init = function (state, opts) {
  stateRef = state;
  respawnFn = (opts && opts.respawn) || null;
  netplayFn = (opts && opts.isNetplay) || null;
  exhibitionHooks = (opts && opts.exhibition) || null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  buildMenu();
  buildFinish();
  buildPause();
  elMenu.style.display = 'none';
  elFinish.style.display = 'none';
  elPause.style.display = 'none';
  flow.go('menu');
};

flow.computeStandings = computeStandings;
window.FF.flow = flow;
})();