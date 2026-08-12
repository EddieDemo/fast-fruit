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
/* The panel is VIEWPORT-BOUNDED, not content-sized: it never exceeds
   the screen, and the scroll lives on the standings list inside it
   (a panel taller than the viewport was the landscape bug — the
   title and the buttons were clipped off the top and bottom, which
   is exactly the content you can't afford to lose). dvh over vh so
   mobile browser chrome retracting doesn't re-clip. */
.ff-panel { background: rgba(10, 14, 10, 0.96); border: 1px solid #1f3a24;
  border-radius: 10px; padding: 20px 24px; min-width: 280px; max-width: 86vw;
  max-height: 100%; display: flex; flex-direction: column; box-sizing: border-box;
  color: #cfe8cf; box-shadow: 0 12px 60px rgba(0,0,0,0.6); }
.ff-title { color: #39ff5f; font-size: 24px; font-weight: 700;
  letter-spacing: 2px; margin: 0 0 14px; text-align: center; }
.ff-sub { color: #7fa383; font-size: 12px; text-align: center; margin: 0 0 16px; }
.ff-melon-row { display: flex; align-items: center; justify-content: center;
  gap: 14px; margin: 6px 0 14px; }
.ff-melon-name { font-size: 15px; color: #e6ffe6; min-width: 120px; text-align: center; }
.ff-btn { display: block; width: 100%; margin: 8px 0 0; padding: 12px;
  background: #123018; color: #39ff5f; border: 1px solid #2a5a34;
  border-radius: 7px; font: inherit; font-size: 16px; letter-spacing: 1px;
  cursor: pointer; }
.ff-btn:active { background: #1a4522; }
.ff-btn.ff-secondary { color: #9fc7a5; border-color: #23402a; background: #0d1f12; }
.ff-arrow { background: none; border: 1px solid #2a5a34; color: #39ff5f;
  border-radius: 6px; font: inherit; font-size: 18px; padding: 6px 12px; cursor: pointer; }
.ff-rows { margin: 4px 0 10px; overflow-y: auto; flex: 1 1 auto; min-height: 0;
  -webkit-overflow-scrolling: touch; }
.ff-title, .ff-btn, .ff-melon-row, .ff-melon-name, .ff-sub { flex: none; }
.ff-row { display: flex; align-items: center; gap: 12px; padding: 6px 4px;
  border-bottom: 1px solid #14261a; }
.ff-row.ff-you { background: rgba(57, 255, 95, 0.07); border-radius: 6px; }
.ff-pos { width: 62px; color: #cfe8cf; font-size: 26px; font-weight: 700;
  text-align: right; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
.ff-pos .ff-ord { font-size: 15px; font-weight: 600; color: #7fa383; }
/* The podium reads at a glance: gold, silver, bronze. */
.ff-row:nth-child(1) .ff-pos { color: #ffd54a; }
.ff-row:nth-child(2) .ff-pos { color: #d8e2e6; }
.ff-row:nth-child(3) .ff-pos { color: #e0a06a; }
.ff-row.ff-you .ff-pos, .ff-row.ff-you .ff-pos .ff-ord { color: #39ff5f; }
.ff-rname { font-size: 14px; color: #dff3df; flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ff-you-tag { flex: none; }
.ff-you-tag { color: #39ff5f; font-size: 11px; letter-spacing: 1px; }
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
  font-family: var(--mono, ui-monospace, monospace); font-size: 12px;
  line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#ff-pause-btn:active { color: var(--panel-accent, #39ff5f); }
#ff-pause-btn[hidden] { display: none; }

/* LANDSCAPE PHONES: short viewports. Everything that costs vertical
   space shrinks — the standings list keeps the space it needs to
   still show several rows, and the buttons sit side by side instead
   of stacking, which alone recovers ~50px. */
@media (max-height: 500px) {
  .ff-panel { padding: 12px 18px; border-radius: 8px; }
  .ff-title { font-size: 18px; margin-bottom: 6px; }
  .ff-sub { margin-bottom: 8px; }
  .ff-row { padding: 3px 4px; gap: 9px; }
  canvas.ff-spin { width: 34px; height: 34px; }
  .ff-pos { width: 48px; font-size: 20px; }
  .ff-pos .ff-ord { font-size: 12px; }
  .ff-rname { font-size: 13px; }
  .ff-melon-row { margin: 2px 0 8px; }
  .ff-melon-row canvas.ff-spin { width: 64px; height: 64px; }
  .ff-btn { padding: 9px; font-size: 14px; margin-top: 6px; }
  /* Buttons in a row: RETRY and MAIN MENU side by side. */
  .ff-buttons { display: flex; gap: 8px; }
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
  const push = (m, isPlayer) => rows.push({
    name: m.name || (isPlayer ? 'YOU' : '???'),
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
  elMenu = el('div', 'ff-screen');
  const panel = el('div', 'ff-panel');
  panel.appendChild(el('h1', 'ff-title', 'FAST FRUIT'));
  panel.appendChild(el('p', 'ff-sub', 'pick your racer'));

  const row = el('div', 'ff-melon-row');
  const left = el('button', 'ff-arrow', '\u25C0');
  const spin = el('canvas', 'ff-spin');
  spin.width = 104; spin.height = 104;
  const right = el('button', 'ff-arrow', '\u25B6');
  row.appendChild(left); row.appendChild(spin); row.appendChild(right);
  panel.appendChild(row);
  const nameEl = el('div', 'ff-melon-name', '');
  panel.appendChild(nameEl);

  const race = el('button', 'ff-btn', 'RACE');
  panel.appendChild(race);
  elMenu.appendChild(panel);
  document.body.appendChild(elMenu);

  const M = window.FF.melon;
  const refresh = () => {
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
    if (respawnFn) respawnFn(); // re-dress the grid with the chosen melon
  };
  left.addEventListener('click', () => cycle(-1));
  right.addEventListener('click', () => cycle(1));
  race.addEventListener('click', () => flow.go('race'));
  elMenu._refresh = refresh;
  elMenu._spin = spin;
}

let elPause = null, elPauseBtn = null;
function buildPause() {
  elPause = el('div', 'ff-screen');
  const panel = el('div', 'ff-panel');
  panel.appendChild(el('h1', 'ff-title', 'PAUSED'));
  panel.appendChild(el('p', 'ff-sub', 'the world is frozen'));
  const resume = el('button', 'ff-btn', 'RESUME');
  const restart = el('button', 'ff-btn ff-secondary', 'RESTART RACE');
  const menu = el('button', 'ff-btn ff-secondary', 'MAIN MENU');
  panel.appendChild(resume);
  panel.appendChild(restart);
  panel.appendChild(menu);
  elPause.appendChild(panel);
  document.body.appendChild(elPause);
  resume.addEventListener('click', () => flow.go('race'));
  restart.addEventListener('click', () => { if (respawnFn) respawnFn(); flow.go('race'); });
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
  elFinish = el('div', 'ff-screen');
  const panel = el('div', 'ff-panel');
  panel.appendChild(el('h1', 'ff-title', 'FINISH'));
  const rows = el('div', 'ff-rows');
  panel.appendChild(rows);
  const retry = el('button', 'ff-btn', 'RETRY');
  const menu = el('button', 'ff-btn ff-secondary', 'MAIN MENU');
  const btns = el('div', 'ff-buttons');
  btns.appendChild(retry);
  btns.appendChild(menu);
  panel.appendChild(btns);
  elFinish.appendChild(panel);
  document.body.appendChild(elFinish);
  retry.addEventListener('click', () => { if (respawnFn) respawnFn(); flow.go('race'); });
  menu.addEventListener('click', () => { if (respawnFn) respawnFn(); flow.go('menu'); });
  elFinish._rows = rows;
}

// ---- The rotating racer previews ----
// One rAF loop serves every visible spinner; each row's canvas is
// redrawn via the renderer's own standalone body draw, so previews
// are the REAL species/pigment/pattern, not icons.
const spinners = []; // { canvas, a, b, color, patKey, fruit, angle }
function spinLoop(now) {
  spinRAF = 0;
  const draw = window.FF.drawMelonStandalone;
  if (!draw) return;
  let any = false;
  for (const s of spinners) {
    if (!s.canvas.isConnected) continue;
    any = true;
    s.angle += 0.016 * 0.9; // slow, stately
    const ctx = s.canvas.getContext('2d');
    ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    ctx.save();
    ctx.translate(s.canvas.width / 2, s.canvas.height / 2);
    const fit = (s.canvas.width / 2 - 4) / Math.max(s.a, s.b);
    ctx.scale(fit, fit);
    draw(ctx, s.angle, s.a, s.b, s.color, s.patKey, s.fruit);
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
    elMenu.style.display = 'flex';
    elMenu._refresh();
    spinners.length = 0;
    const M = window.FF.melon;
    const d = M.derive(M.active().seed);
    const design = window.FF.studio && window.FF.studio.design;
    const fruit = (design && design.fruit) || 'watermelon';
    const F = window.FF.FRUITS[fruit] || {};
    const a = 46 * d.scale * (F.sizeMult || 1);
    spinners.push({
      canvas: elMenu._spin, angle: 0,
      a, b: a * (F.aspect || 0.78),
      color: (design && design.color) || d.bodyColor,
      patKey: (design && design.patKey) || String(M.active().seed),
      fruit,
    });
    startSpinners();
  },
  exit() { elMenu.style.display = 'none'; },
});

flow.register('race', {
  enter() { if (elPauseBtn) elPauseBtn.hidden = false; },
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
      c.width = 104; c.height = 104;
      row.appendChild(c);
      const nm = el('div', 'ff-rname', r.name);
      if (r.isPlayer) nm.appendChild(el('span', 'ff-you-tag', '  \u2014 YOU'));
      row.appendChild(nm);
      rows.appendChild(row);
      spinners.push({ canvas: c, angle: r.pos * 0.7, a: r.a, b: r.b, color: r.color, patKey: r.patKey, fruit: r.fruit });
    }
    startSpinners();
  },
  exit() { elFinish.style.display = 'none'; },
});

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