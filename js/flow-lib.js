(function () {
'use strict';
// ============================================================
// FLOW-LIB — the shared privates of the screen system.
//
// Split out of flow.js (refactor step 3, commit 1, 2026-08-26).
// IIFEs cannot share locals, so the flow split begins by making
// every shared thing an explicit export: the DOM helper, the
// formatters, the standings law, the portrait pushers and the whole
// spinner subsystem. Bodies are MOVED, not rewritten — behaviour is
// held by verify-flowlib (functional) and the full battery.
//
// Presentation tier. Loads BEFORE flow.js (A4 pair): flow and the
// screen modules destructure this surface at load.
//
// The one flow reference: the spinner loop parks itself during a
// race. It reads window.FF.flow AT CALL TIME through the sanctioned
// screens door — the loop only runs long after boot, and a lib that
// load-order-depended on the machine it serves would invert the
// split.
// ============================================================

// ---- DOM helper ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- Formatters and identity ----
function racerIdentity(melonName, pilotName, isPlayer) {
  const nm = el('div', 'ff-rname', melonName);
  if (isPlayer) nm.appendChild(el('span', 'ff-you-tag', '  \u2014 YOU'));
  if (pilotName) nm.appendChild(el('div', 'ff-rpilot', pilotName));
  return nm;
}

function computeStandings(state, resolved) {
  const rows = [];
  const hz = (window.FF.CONFIG && window.FF.CONFIG.physicsHz) || 120;
  const startTick = state.raceStartTick || 0;
  const push = (m, isPlayer) => rows.push({
    name: m.name || (isPlayer ? 'YOU' : '???'),
    // The PILOT: who drove this melon. The melon is the character;
    // the pilot is the competitor, and a results table has to say
    // both or it cannot tell you who actually beat you.
    pilot: m.pilot || '',
    // ...and the IDENTITY OF RECORD, which every downstream table
    // keys on (state.racerKey). Computed once, here, so the cup and
    // the resolver cannot disagree about who a row is.
    key: window.FF.racerKey(m),
    // Elapsed from the race start to THIS racer's own crossing. Null
    // for anyone still out on track when the standings were captured
    // — shown as a dash, because inventing a time for an unfinished
    // racer would be the one dishonest number on the screen.
    // A racer still on track when the flag fell has no stamp of its
    // own; finishline.js fast-forwards the rest of the race on a
    // clone and supplies the REAL time it would have set. Only a
    // body that could not finish at all stays null — and it is
    // marked DNF, which sorts LAST on time rather than first.
    timeSec: (isPlayer && state.race && state.race.retired) ? null
      : (m.finishTick !== undefined && m.finishTick !== null)
      ? (m.finishTick - startTick) / hz
      : (resolved && resolved.byKey[window.FF.racerKey(m)] && !resolved.byKey[window.FF.racerKey(m)].dnf
        ? resolved.byKey[window.FF.racerKey(m)].timeSec
        : null),
    dnf: !!(resolved && resolved.byKey[window.FF.racerKey(m)] && resolved.byKey[window.FF.racerKey(m)].dnf
      && (m.finishTick === undefined || m.finishTick === null))
      // RETIRED (retire & watch): the autopilot crossed the line in
      // the player's melon; the player did not. DNF, whatever the
      // stamp says — and the stamp is what opened the finish screen.
      || !!(isPlayer && state.race && state.race.retired),
    species: m.species || 'watermelon',
    color: m.bodyColor || '#37a01c',
    patKey: m.patKey || m.name || 'x',
    // THE OUTFIT IS PART OF WHAT A MELON LOOKS LIKE (ruled
    // 2026-08-16): any surface that draws a melon draws its decals.
    // Bots carry null today; the day bot decals ship, every table
    // shows them for free.
    decals: m.decals || null,
    // The body's OWN physics mass, in kg: BASE_KG is the scale-1
    // anchor and 1/(invM * CONFIG.mass) is the mass ratio the physics
    // actually integrates. One law for player and bots — the card
    // must never invent a number the collision didn't feel.
    kg: m.invM ? window.FF.melon.BASE_KG / (m.invM * window.FF.CONFIG.mass) : null,
    a: m.a, b: m.b,
    x: m.x,
    isPlayer,
  });
  for (const p of state.players) push(p.melon, p.melon === state.melon);
  for (const b of state.bots) push(b.melon, false);
  // AN OPEN SESSION RANKS BY ITS METRIC (party games, 2026-08-26):
  // the chassis owns the ranking and the formatted best; the rows are
  // the same rows — portraits, pilots, decals, taps — with the metric
  // where the time would be. Resolution machinery (settle, projected
  // times, DNF) is race-shaped and never runs here: a session's clock
  // ending IS the resolution.
  if (state.session && window.FF.session) {
    const S = window.FF.session;
    const bodies = [];
    for (const p of state.players) bodies.push(p.melon);
    for (const b of state.bots) bodies.push(b.melon);
    for (let i = 0; i < rows.length; i++) {
      rows[i].metricStr = S.formatBest(state, bodies[i]);
      rows[i]._rank = state.session.rank[i] || rows.length;
      rows[i].timeSec = null;
      rows[i].dnf = false;
    }
    rows.sort((r, q) => r._rank - q._rank);
    rows.forEach((r, i) => { r.pos = i + 1; });
    return rows;
  }
  // PLACE FOLLOWS TIME. Ordering by distance-at-the-flag was the old
  // rule, from before finish times existed for everyone: it put a
  // melon five metres further along ahead of one running a faster
  // pace, and then printed both their times underneath — a standing
  // that visibly contradicted its own numbers.
  //
  // Now the finishing order IS the order of finish times: measured
  // for anyone who crossed, projected for the rest (finishline.js).
  // A racer with no time at all (DNF) sorts last, and distance is the
  // final tiebreak so two identical times still order sensibly.
  rows.sort((r, q) => {
    const rt = (r.dnf || r.timeSec === null || r.timeSec === undefined) ? Infinity : r.timeSec;
    const qt = (q.dnf || q.timeSec === null || q.timeSec === undefined) ? Infinity : q.timeSec;
    if (rt !== qt) return rt - qt;
    return q.x - r.x;
  });
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

// A full ordinal ("3rd"). fillCup called this before it existed —
// a ReferenceError inside the finish screen's enter(), which killed
// the frame loop and left a black screen on NEXT RACE.
function ordinal(n) {
  return String(n) + ordinalSuffix(n);
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

// ---- The rotating racer previews ----
// One rAF loop serves every visible spinner; each row's canvas is
// redrawn via the renderer's own standalone body draw, so previews
// are the REAL species/pigment/pattern, not icons.
let spinRAF = 0;
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

// Any layout-changing event drops the cached boxes, so the rare
// remeasure never lags a rotation or a window resize.
if (typeof window !== 'undefined' && window.addEventListener) {
  for (const ev of ['resize', 'orientationchange']) {
    window.addEventListener(ev, () => {
      spinMeasureAt = 0;
      for (const s of spinners) s.box = null;
    });
  }
}

function syncCanvasSize(cv) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const rect = cv.getBoundingClientRect();
  const cssW = rect.width || cv.clientWidth || 104;
  const want = Math.max(64, Math.min(1600, Math.round(cssW * dpr)));
  if (cv.width !== want || cv.height !== want) { cv.width = want; cv.height = want; }
  return { dpr, cssW };
}

// ---- THE SPINNERS ARE THE FINISH SCREEN'S REAL COST ----------------
// The results panel registers a rotating body per racer on BOTH the
// PLACES and CUP tabs: two dozen canvases, each needing a
// portrait-resolution pattern raster (for a watermelon that is a
// per-pixel island field). Three costs came out of that, and all
// three landed on the frame the player crosses the line:
//
//   BUILD SPIKE   two dozen rasters built in one frame.
//   DOUBLE DRAW   the hidden tab's twelve kept redrawing, because
//                 isConnected cannot see display:none. Half the work
//                 was for pixels nobody could look at.
//   LAYOUT THRASH getBoundingClientRect per spinner per frame — two
//                 dozen forced reflows every frame.
//
// Fixed here by drawing only what is visible, measuring only when the
// size can actually have changed, and turning at a rate the motion
// does not miss.
const SPIN_FPS = 30;              // decorative rotation; 60 is waste
const SPIN_FRAME_MS = 1000 / SPIN_FPS;
let spinLast = 0;
let spinMeasureAt = 0;            // remeasure clock (see below)

// A canvas that is display:none still reports isConnected — so the
// hidden tab has to be excluded by geometry, not by connection.
function spinnerVisible(cv) {
  return cv.isConnected && cv.offsetParent !== null;
}

function spinLoop(now) {
  spinRAF = 0;
  const draw = window.FF.drawMelonStandalone;
  if (!draw || spinnersPaused) return;
  const t = now || (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Rate-limit: the bodies turn slowly and decoratively, so half the
  // frames are indistinguishable and cost half as much.
  if (t - spinLast < SPIN_FRAME_MS) {
    spinRAF = requestAnimationFrame(spinLoop);
    return;
  }
  const dt = spinLast ? Math.min(0.1, (t - spinLast) / 1000) : 1 / SPIN_FPS;
  spinLast = t;
  // MEASURE RARELY. A canvas box only changes on resize or rotation,
  // and getBoundingClientRect forces a synchronous layout — two dozen
  // of those per frame is the classic way to lose smoothness. Once a
  // second is plenty; resize handlers catch the rest.
  const remeasure = t >= spinMeasureAt;
  if (remeasure) spinMeasureAt = t + 1000;
  let any = false;
  for (const s of spinners) {
    if (!spinnerVisible(s.canvas)) continue;
    any = true;
    s.angle += dt * 55 * (s.rate === undefined ? 0.9 : s.rate) / 60; // slow, stately
    const box = (remeasure || !s.box) ? syncCanvasSize(s.canvas) : s.box;
    s.box = box;
    const ctx = s.canvas.getContext('2d');
    ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    ctx.save();
    ctx.translate(s.canvas.width / 2, s.canvas.height / 2);
    const fit = (s.canvas.width / 2 - 4 * box.dpr) / Math.max(s.a, s.b);
    ctx.scale(fit, fit);
    // The pattern raster is built for THIS destination: `fit` is
    // exactly device pixels per world pixel, which is the number the
    // renderer needs and the only place it can be known.
    draw(ctx, s.angle, s.a, s.b, s.color, s.patKey, s.species, fit, s.decals);
    ctx.restore();
  }
  // Keep the loop alive while ANY spinner exists, visible or not: the
  // player can switch tabs, and a loop that stopped because the
  // visible ones were hidden would never restart itself.
  const fl = window.FF.flow;
  if ((any || spinners.length) && (!fl || fl.state !== 'race')) {
    spinRAF = requestAnimationFrame(spinLoop);
  }
}
function startSpinners() {
  if (!spinRAF) spinRAF = requestAnimationFrame(spinLoop);
}

// The same portrait, for a spec that is NOT the active melon (a prize
// being offered). Shares the rate and geometry so a won melon is
// presented exactly as the start screen presents yours.
function pushSpecPortrait(canvas, spec) {
  const M = window.FF.melon;
  const d = M.deriveSpec(spec);
  const F = window.FF.OBJECTS.watermelon || {};
  const a = window.FF.CONFIG.semiMajor * d.scale * (F.sizeMult || 1);
  spinners.push({ rate: 0.55, canvas, angle: 0,
    a, b: a * (F.aspect || 0.78),
    color: d.bodyColor, patKey: d.patternKey, species: 'watermelon',
    decals: spec.decals || null });
}

function pushMelonPortrait(canvas) {
  const M = window.FF.melon;
  const d = M.deriveSpec(M.active());
  const design = window.FF.studio && window.FF.studio.design;
  const fruit = (design && design.species) || 'watermelon';
  const F = window.FF.OBJECTS[fruit] || {};
  // Semi-major from CONFIG, not a hard-coded 46: the portrait must
  // track the same reference the sim uses if the tune panel moves it.
  const a = window.FF.CONFIG.semiMajor * d.scale * (F.sizeMult || 1);
  spinners.push({
    // The hero portrait turns slower than the results rows: it is
    // being looked AT, not glanced at.
    rate: 0.55,
    canvas, angle: 0,
    a, b: a * (F.aspect || 0.78),
    color: (design && design.color) || d.bodyColor,
    decals: M.active().decals || null,
    // d.patternKey ('m'+seed), NOT String(seed): the race body is
    // dressed with d.patternKey (main.js) and the award screen uses
    // it too, so a bare seed here generated a DIFFERENT rind — the
    // melon on the menu was not the melon on the track.
    patKey: (design && design.patKey) || d.patternKey,
    species: fruit,
  });
}

// Inject a stylesheet. Screens carry their own CSS (the one-file
// deployment lesson); this is the socket they plug it into.
function addCSS(text) {
  const style = document.createElement('style');
  style.textContent = text;
  document.head.appendChild(style);
  return style;
}

window.FF.flowLib = {
  el, fmtTime, ordinal, ordinalSuffix, racerIdentity, computeStandings,
  spinners, clearCanvas, startSpinners,
  setSpinPaused: (v) => { spinnersPaused = !!v; },
  spinPaused: () => spinnersPaused,
  // A layout change the resize listeners cannot see (tab switch):
  // drop the cached boxes and force a remeasure on the next frame.
  remeasureSpinners: () => { spinMeasureAt = 0; for (const s of spinners) s.box = null; },
  pushSpecPortrait, pushMelonPortrait, addCSS,
  // The test hook's data: what the loop is actually drawing.
  spinnerDump: () => spinners.map(s => ({
    a: +s.a.toFixed(2), color: s.color, patKey: s.patKey, species: s.species,
    decals: (s.decals || []).length })),
};
})();
