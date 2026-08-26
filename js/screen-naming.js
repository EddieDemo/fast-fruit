(function () {
'use strict';
// ============================================================
// SCREEN-NAMING — the naming gate, the ceremony, and the award flow
// (split commit 5, 2026-08-26).
//
// Moved whole from flow.js: the gate registration (the exhibition
// runs behind it; nothing else is touchable), flow.openNaming (the
// public door — assigned onto the machine from here, since the modes
// it dispatches are this module's), buildNaming, and the two-step
// award ceremony (openAwardFlow / openRelease) that chains into it.
// namingAward, once a cross-concern shared local, is module-local
// again. The machine reaches the ceremony through the registry:
// SCREENS.naming.openAward, via _internals.openAwardFlow.
//
// Presentation tier. Loads AFTER flow.js; builds via the machine's
// build() hooks.
// ============================================================
const flow = window.FF.flow;
const { el, fmtTime, ordinalSuffix, spinners, clearCanvas, startSpinners,
        setSpinPaused, pushSpecPortrait, pushMelonPortrait } = window.FF.flowLib;
const I = flow._internals;
const { confirmAsk, clearFade } = I;

// ---- THE AWARD FLOW ------------------------------------------------
// TWO STEPS, because they are two different questions and answering
// them on one screen would put seven melons and a decision on a 390px
// phone.
//
//   1. THE CEREMONY — the same screen a first melon arrives on,
//      showing the new melon and its stats, with a quiet LEAVE IT
//      beside KEEP. Answerable from the new melon alone: you do not
//      need to think about your other six to know whether a 6.1 kg
//      runt interests you.
//   2. THE RELEASE — only if they keep it AND the stable is full.
//      Which of the six goes, with a confirm, because the released
//      melon's career record dies with it and that is the part that
//      is genuinely irreversible.
//
// The melon is already in the stable (or held aside, if full) before
// any of this runs: the flow decides what to KEEP, never whether the
// prize existed.
function openAwardFlow(award, then) {
  const go = then || (() => flow.go('menu'));
  // Not full: it is already in the stable. Name it and go.
  if (!award.full) {
    namingAward = award.spec;
    flow.openNaming('award', () => { namingAward = null; go(); });
    return;
  }
  // Full: the ceremony first, then the release grid if they keep it.
  namingAward = award.spec;
  flow.openNaming('award', (kept) => {
    namingAward = null;
    if (kept === null) { go(); return; }   // left it
    openRelease(award.spec, go);
  }, { allowLeave: true });
}

// Step two: which of the six goes. Built fresh each time — it is a
// rare screen and the stable it lists changes.
let elRelease = null;
function openRelease(spec, then) {
  const go = then || (() => flow.go('menu'));
  const M = window.FF.melon;
  if (!elRelease) {
    elRelease = el('div', 'ff-screen ff-release-screen');
    const panel = el('div', 'ff-panel');
    const head = el('div', 'ff-head');
    head.appendChild(el('h1', 'ff-title', 'STABLE FULL'));
    head.appendChild(el('p', 'ff-sub', 'choose one to release'));
    panel.appendChild(head);
    const body = el('div', 'ff-body');
    const grid = el('div', 'ff-release-grid');
    body.appendChild(grid);
    panel.appendChild(body);
    const foot = el('div', 'ff-foot');
    const cancel = el('button', 'ff-btn ff-quiet', 'keep my six, discard the new one');
    foot.appendChild(cancel);
    panel.appendChild(foot);
    elRelease.appendChild(panel);
    document.body.appendChild(elRelease);
    elRelease._grid = grid;
    elRelease._cancel = cancel;
  }
  const grid = elRelease._grid;
  grid.textContent = '';
  spinners.length = 0;
  M.stableList().forEach((m, i) => {
    const d = M.deriveSpec(m);
    const cell = el('button', 'ff-release-cell');
    const cv = el('canvas', 'ff-spin');
    cv.width = 160; cv.height = 160;
    cell.appendChild(cv);
    cell.appendChild(el('div', 'ff-rel-name', m.name || M.UNNAMED_NAME));
    cell.appendChild(el('div', 'ff-rel-stat', d.kg.toFixed(1) + ' kg'));
    const r = m.record || {};
    cell.appendChild(el('div', 'ff-rel-rec',
      (r.races || 0) + ' races  \u00b7  ' + (r.wins || 0) + ' wins'));
    cell.addEventListener('click', () => {
      // THE CONFIRM SAYS WHAT IS LOST. Not "are you sure" — what for.
      confirmAsk({
        title: 'RELEASE ' + (m.name || 'THIS MELON').toUpperCase() + '?',
        body: 'Its career \u2014 ' + (r.races || 0) + ' races, ' + (r.wins || 0)
          + ' wins \u2014 goes with it. This cannot be undone.',
        cancel: 'KEEP IT',
        confirm: 'RELEASE',
        onConfirm: () => {
          M.acceptAward(spec, i);
          elRelease.style.display = 'none';
          namingAward = spec;
          flow.openNaming('award', () => { namingAward = null; go(); });
        },
      });
    });
    grid.appendChild(cell);
    clearCanvas(cv);
    const F = window.FF.FRUITS.watermelon || {};
    const a = window.FF.CONFIG.semiMajor * d.scale;
    spinners.push({ canvas: cv, angle: i * 0.7, a, b: a * 0.78,
      color: d.bodyColor, patKey: d.patternKey, fruit: 'watermelon', rate: 0.4 });
  });
  elRelease._cancel.onclick = () => {
    elRelease.style.display = 'none';
    go();
  };
  elRelease.style.display = 'flex';
  setSpinPaused(false);
  startSpinners();
}

// Dev/test hook: the release screen is otherwise only reachable by
// winning a seventh melon, which is days of play away.
window.FF._openRelease = (spec) => openRelease(spec);

// ---- THE NAMING GATE (2026-08-14) --------------------------------
// A first-time player is given a melon before anything else happens.
// This is a real FLOW STATE rather than a floating overlay, because
// an overlay that lives outside the screen system is exactly how the
// ceremony ended up racing the menu for the same pixels: it fired at
// boot, rendered behind the menu (z-20 vs z-40), and only surfaced
// once the race screen stepped aside — so it appeared to arrive
// mid-race, and the tap that dismissed it fell through to the armed
// grid and started the countdown.
//
// THE EXHIBITION RUNS BEHIND IT. A blank field behind the card is a
// loading screen; melons already tumbling down today's track is the
// game introducing itself while you name your racer. The exhibition's
// local body is deliberately NOT dressed in the player's melon
// (main.js skips that for the exhibition), which is right here too:
// the melon being named is the one on the card, not one of the twelve
// in the background.
//
// NOTHING ELSE IS TOUCHABLE and nothing can leak: no race has been
// built at this point, so there is no grid to arm — the structural
// version of the fix rather than a guard bolted on.
flow.register('naming', {
  build() {
    buildNaming();
    elNaming.style.display = 'none';
  },
  // The machine's award door (the rewards runner's melon entries):
  // _internals.openAwardFlow resolves here through the registry.
  openAward: openAwardFlow,
  enter() {
    // start() is a no-op while running, so this only fires on the boot
    // ceremony, where the menu has never been entered and nothing is
    // running behind us yet.
    const ex = I.exhibition();
    if (window.FF.exhibition && ex) window.FF.exhibition.start(ex);
    clearFade();
    const M = window.FF.melon;
    const cur = M.active();
    const isPilot = namingMode === 'pilot';
    const isAward = namingMode === 'award';
    elNaming._title.textContent = isPilot ? 'YOUR NAME'
      : namingMode === 'rename' ? 'RENAME'
      : (M.pickHeadline ? M.pickHeadline() : "You've got Melon!");
    elNaming._sub.textContent = isPilot ? 'who is racing?'
      : namingMode === 'rename' ? 'what should it be called?'
      : isAward ? 'your prize for the cup'
      : 'name your racer';
    elNaming._input.placeholder = isPilot ? 'your name' : 'name your melon';
    elNaming._input.value = isPilot ? (M.playerName ? M.playerName() : '')
      : namingMode === 'rename' ? (cur.name || '') : '';
    // LEAVE IT: only offered when accepting the prize would cost one
    // of the six. A player must be able to say no to a runt without
    // first being made to choose a victim.
    elNaming._leave.style.display = namingAllowLeave ? '' : 'none';
    // THE BUTTON STATES THE ACTION THAT EXISTS. 'KEEP' implies an
    // alternative, and outside the full-stable case there isn't one:
    // the melon is already yours and the screen is a gift being
    // handed over, not a decision. So the label follows the mode —
    //   choice to decline  -> KEEP   (paired with 'leave it')
    //   a gift, no choice  -> THANKS (the headlines are all giving
    //                        moments; 'Take this!' wants 'Thanks')
    //   an edit            -> SAVE
    elNaming._keep.textContent = namingAllowLeave ? 'KEEP'
      : (isPilot || namingMode === 'rename') ? 'SAVE'
      : 'THANKS';
    elNaming._refresh(namingAward);
    elNaming.style.display = 'flex';
    spinners.length = 0;
    clearCanvas(elNaming._spin);
    if (namingAward) pushSpecPortrait(elNaming._spin, namingAward);
    else pushMelonPortrait(elNaming._spin);
    setSpinPaused(false);
    startSpinners();
    // Focus AFTER the screen is up, or the keyboard opens against a
    // hidden field on iOS.
    setTimeout(() => { try { elNaming._input.focus(); } catch (_) {} }, 60);
  },
  exit() {
    elNaming.style.display = 'none';
    spinners.length = 0;
  },
});

// Open the naming screen. Modes:
//   'ceremony' — first boot, names the MELON
//   'rename'   — rename the melon
//   'pilot'    — rename YOU, the racer driving it
// Returns to the screen it was opened from, so the door can sit on
// more than one screen without each caller having to say where back
// is. NOTE it deliberately cannot be opened from 'finish': entering
// that screen performs the one career write, so returning to it would
// count the race twice.
flow.openNaming = function (mode, onDone, opts) {
  namingMode = mode || 'ceremony';
  namingAllowLeave = !!(opts && opts.allowLeave);
  const from = (flow.state && flow.state !== 'naming') ? flow.state : 'menu';
  namingDone = onDone || (() => flow.go(from === 'finish' ? 'menu' : from));
  flow.go('naming');
};

// THE HERO PORTRAIT, in one place. The menu and the naming ceremony
// both show the player's melon at portrait size, and they must show
// the SAME melon — same seed-derived scale, colour, rind and species,
// same slow rate. Two copies of this drifted the moment one of them
// learned about the Shader Studio's design override.
// ---- THE NAMING SCREEN -------------------------------------------
// Built from the START SCREEN'S OWN COMPONENTS (Eddie, 2026-08-14):
// same .ff-screen scrim, same .ff-panel, same head/body/foot
// contract, same .ff-title, the same portrait canvas classes, the
// same .ff-stat-row grammar and the same .ff-btn. The card it
// replaces predated type.js entirely — #111 panels, #fff titles,
// #9a9a9a labels and a PINK keep button, the only pink control in the
// game — so it read as a different product at the exact moment a new
// player forms their first impression.
//
// Two modes, one screen: the CEREMONY (first boot, headline varies)
// and RENAME (from the menu). They differ by a string and a starting
// value, which is not enough to justify two surfaces.
//
// STATS: species and weight only. The full card belongs to the start
// screen, where a player is choosing; here they are being handed one
// melon, and length is a number nobody needs before they have a name.
const NAMING_ROWS = ['species', 'weight'];
let elNaming = null;
let namingMode = 'ceremony';
// The prize rolled at cup completion, waiting to be told and (if the
// stable is full) resolved. Cleared once the player has seen it out.
// The spec being named by the 'award' mode: a prize is not the active
// melon, so the screen must be told which melon it is naming.
let namingAward = null;
let namingAllowLeave = false;
let namingDone = null;

function buildNaming() {
  const M = window.FF.melon;
  elNaming = el('div', 'ff-screen ff-naming-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  const title = el('h1', 'ff-title', '');
  const sub = el('p', 'ff-sub', '');
  head.appendChild(title); head.appendChild(sub);
  panel.appendChild(head);

  const bodyZone = el('div', 'ff-body');
  const row = el('div', 'ff-melon-row');
  const spin = el('canvas', 'ff-spin ff-portrait');
  spin.width = 560; spin.height = 560;
  row.appendChild(spin);
  bodyZone.appendChild(row);
  const statsEl = el('div', 'ff-stats');
  bodyZone.appendChild(statsEl);
  panel.appendChild(bodyZone);

  const foot = el('div', 'ff-foot');
  const input = el('input', 'ff-name-input');
  input.id = 'melon-name-input';
  input.maxLength = 24;
  input.placeholder = 'name your melon';
  input.autocomplete = 'off';
  const keep = el('button', 'ff-btn', 'KEEP');
  keep.id = 'melon-name-ok';
  const leave = el('button', 'ff-btn ff-quiet', 'leave it');
  leave.style.display = 'none';
  foot.appendChild(input);
  foot.appendChild(keep);
  foot.appendChild(leave);
  panel.appendChild(foot);
  elNaming.appendChild(panel);
  document.body.appendChild(elNaming);

  const finish = () => {
    const typed = input.value.trim();
    // WHICH IDENTITY is being named: the melon (a body) or the pilot
    // (you). One screen, one field, two destinations — the mode says
    // which, so neither can be written by accident.
    let out;
    if (namingMode === 'award' && namingAward) {
      // Name the PRIZE, which is its own spec — never the melon the
      // player is currently racing.
      namingAward.name = String(typed || M.UNNAMED_NAME).slice(0, 24);
      M._save && M._save();
      out = namingAward.name;
    } else if (namingMode === 'pilot') {
      out = M.renamePlayer(typed || M.playerName());
    } else {
      const cur = M.active();
      // Empty is not a wall and not a random identity: see melon.js.
      out = M.rename(typed || cur.name || M.UNNAMED_NAME);
    }
    const cb = namingDone; namingDone = null;
    if (cb) cb(out);
  };
  keep.addEventListener('click', finish);
  // Declining a prize: the callback is told with null, so the caller
  // can tell "left it" from "kept it" without inspecting the stable.
  leave.addEventListener('click', () => {
    const cb = namingDone; namingDone = null;
    if (cb) cb(null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
  });

  elNaming._title = title;
  elNaming._sub = sub;
  elNaming._spin = spin;
  elNaming._stats = statsEl;
  elNaming._input = input;
  elNaming._leave = leave;
  elNaming._keep = keep;
  elNaming._refresh = () => {
    const design = window.FF.studio && window.FF.studio.design;
    const fruit = (design && design.fruit) || 'watermelon';
    const byKey = new Map();
    for (const r of (M.stats ? M.stats(M.active().seed, fruit, M.active().wide) : [])) byKey.set(r.key, r);
    const rows = [];
    for (const k of NAMING_ROWS) { const r = byKey.get(k); if (r) rows.push(r); }
    statsEl.textContent = '';
    for (const r of rows) {
      const line = el('div', 'ff-stat-row');
      line.appendChild(el('span', 'k', r.label));
      const v = el('span', 'v', r.value);
      if (r.note) v.appendChild(el('small', null, r.note));
      line.appendChild(v);
      statsEl.appendChild(line);
    }
  };
}
})();
