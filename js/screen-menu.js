(function () {
'use strict';
// ============================================================
// SCREEN-MENU — the start screen (split commit 3, 2026-08-26).
//
// buildMenu and the menu registration, moved whole from flow.js.
// The one rewrite is the machine's moving parts read through
// flow._internals; the one addition is that the machine's pokes
// into this screen (auto-pause's refresh, the _dress dev helper's
// portrait repaint) arrive through refresh()/paintPortrait() on the
// registered screen object — the registry is the surface, the
// element is private again.
//
// Presentation tier. Loads AFTER flow.js; builds via the machine's
// build() hook.
// ============================================================
const flow = window.FF.flow;
const { el, fmtTime, ordinalSuffix, spinners, clearCanvas, startSpinners,
        setSpinPaused, pushMelonPortrait } = window.FF.flowLib;
const I = flow._internals;
const { confirmAsk, clearFade, runRewards } = I;

// ---- DOM scaffolding ----
let elMenu = null;

function buildMenu() {
  elMenu = el('div', 'ff-screen ff-menu-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  const title = el('h1', 'ff-title', 'FAST FRUIT');
  head.appendChild(title);
  head.appendChild(el('p', 'ff-sub', 'pick your racer'));
  panel.appendChild(head);
  // THE HANDLE for developer tools: five taps here. Outside the play
  // area, on a screen you choose to visit, mirroring the build-number
  // convention every phone owner has already met.
  if (window.FF.devtools) window.FF.devtools.arm(title);

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
  // THE PORTRAIT IS THE DOOR (Eddie, 2026-08-15): tapping the melon
  // opens the edit screen — rename and decals in one place. A big
  // melon that opens the editor is a big target; the chip underneath
  // is the discoverability, not the button.
  const openEditor = () => {
    if (window.FF.editor) window.FF.editor.open(() => flow.go('menu'));
  };
  spin.style.cursor = 'pointer';
  spin.setAttribute('role', 'button');
  spin.setAttribute('tabindex', '0');
  spin.title = 'edit melon';
  spin.addEventListener('click', openEditor);
  spin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); }
  });
  const editChip = el('button', 'ff-edit-chip', '\u270E edit');
  editChip.addEventListener('click', openEditor);
  leftCol.appendChild(editChip);
  const nameEl = el('div', 'ff-melon-name', '');
  // THE SECOND DOOR — now into the EDITOR, where renaming lives with
  // the rest of changing-your-melon (ruled 2026-08-15). The rename
  // card itself is unchanged, one tap deeper; the pause-screen door
  // and the pilot door below still open it directly.
  nameEl.classList.add('ff-renamable');
  nameEl.setAttribute('role', 'button');
  nameEl.setAttribute('tabindex', '0');
  nameEl.title = 'edit melon';
  const openRename = openEditor;
  nameEl.addEventListener('click', openRename);
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRename(); }
  });
  leftCol.appendChild(nameEl);
  // WHO IS DRIVING IT. The same melon-over-pilot relationship the
  // standings use, on the screen where you pick the melon — and the
  // second rename door, because a player who wants to be called
  // something looks here first.
  const releaseBtn = el('button', 'ff-release-link', 'release this melon');
  releaseBtn.style.display = 'none';
  const pilotEl = el('div', 'ff-melon-pilot ff-renamable', '');
  pilotEl.setAttribute('role', 'button');
  pilotEl.setAttribute('tabindex', '0');
  pilotEl.title = 'rename yourself';
  const openPilotRename = () => flow.openNaming('pilot');
  pilotEl.addEventListener('click', openPilotRename);
  pilotEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPilotRename(); }
  });
  leftCol.appendChild(pilotEl);
  leftCol.appendChild(releaseBtn);
  const statsEl = el('div', 'ff-stats');
  rightCol.appendChild(statsEl);
  // (Single table now — the CAREER sub-heading retired with the split.
  // melon.career() is untouched and still feeds it.)
  body.appendChild(leftCol);
  body.appendChild(rightCol);
  const bodyZone = el('div', 'ff-body');
  bodyZone.appendChild(body);
  panel.appendChild(bodyZone);

  // THE HIERARCHY IS THE EXPLANATION. The cup is the day's event and
  // the single race is how you learn it, so they are not peers: one
  // primary button, one quiet secondary. The cup's label carries the
  // SCALE of the commitment — four races is a real ask, and a player
  // who discovers that in race three feels tricked.
  // A half-finished run is the most urgent thing on this screen, so
  // it takes the primary slot and pushes the cup down to secondary.
  const resumeBtn = el('button', 'ff-btn', 'RESUME');
  const cupBtn = el('button', 'ff-btn',
    'DAILY CUP \u00b7 ' + ((window.FF.cup && window.FF.cup.LEGS) || 3) + ' RACES');
  // PARTY CUP replaces practice (doorway swap, ruled 2026-08-25:
  // practice-mode machinery stays dormant behind it; full removal is
  // its own future commit with the flow suite bracketing it).
  const race = el('button', 'ff-btn ff-secondary', 'PARTY CUP \u00b7 3 GAMES');
  const foot = el('div', 'ff-foot');
  foot.appendChild(resumeBtn);
  foot.appendChild(cupBtn);
  foot.appendChild(race);
  const dayLine = el('div', 'ff-dayline', '');
  foot.appendChild(dayLine);
  // A run that expired while the player was away gets SAID, not
  // silently removed: they left a race waiting and came back for it,
  // and a button that simply isn't there reads as a fault in their
  // memory or in the game. One dim line, shown once.
  const expiredLine = el('div', 'ff-expired', '');
  expiredLine.style.display = 'none';
  foot.appendChild(expiredLine);
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
    const fruit = (design && design.species) || 'watermelon';
    // Both sources, indexed by key, then selected in the declared
    // order. Unknown keys are skipped rather than rendered blank, so
    // this list can name a row that a future species doesn't have.
    const byKey = new Map();
    for (const r of (M.stats ? M.stats(M.active().seed, fruit, M.active().wide) : [])) byKey.set(r.key, r);
    for (const r of (M.career ? M.career() : [])) byKey.set(r.key, r);
    const rows = [];
    for (const k of MENU_ROWS) { const r = byKey.get(k); if (r) rows.push(r); }
    renderRows(statsEl, rows);
  };
  const refresh = () => {
    fillStats();
    // The day's identity, and how you have done at it. This is what
    // makes returning tomorrow feel like a fixture rather than a
    // relaunch.
    // A waiting run rewrites the menu's hierarchy.
    const snap = window.FF.resume ? window.FF.resume.peek() : null;
    // peek() clears an expired snapshot as a side effect and leaves a
    // note behind; ask AFTER peeking, and only when nothing is
    // waiting (a fresh run supersedes news about an old one).
    if (elMenu._expiredLine) {
      const why = (!snap && window.FF.resume && window.FF.resume.takeExpiry)
        ? window.FF.resume.takeExpiry() : null;
      // 'day' is the interesting case and the common one: a new daily
      // landed while they were away. 'age' means the run simply sat
      // too long. Neither is an error, so neither shouts.
      elMenu._expiredLine.textContent = why === 'day'
        ? "yesterday's run expired \u00b7 today's track is new"
        : why === 'age' ? 'your unfinished run expired' : '';
      elMenu._expiredLine.style.display = elMenu._expiredLine.textContent ? '' : 'none';
    }
    if (elMenu._resumeBtn) {
      elMenu._resumeBtn.style.display = snap ? '' : 'none';
      elMenu._cupBtn.classList.toggle('ff-secondary', !!snap);
      if (snap) {
        // Only cup runs survive peek() now — resume.js discards
        // practice snapshots outright (no avenue to practice, Eddie
        // 2026-08-26), so the label has one form.
        elMenu._resumeBtn.textContent =
          'RESUME CUP \u00b7 RACE ' + Math.min(window.FF.cup.LEGS, ((snap.cup && snap.cup.leg) || 0) + 1)
            + ' OF ' + window.FF.cup.LEGS;
      }
    }
    if (window.FF.cup && window.FF.dailyTrackName) {
      const day = window.FF.dailyTrackName().replace('Daily ', '');
      const rec = window.FF.cup.dayRecord();
      // The build stamp rides along: a screenshot of the menu now
      // says which build produced everything else in the screenshot.
      const build = window.FF.BUILD ? '  \u00b7  ' + window.FF.BUILD : '';
      dayLine.textContent = (rec && rec.bestPoints !== null
        ? day + '  \u00b7  best ' + rec.bestPoints + ' pts in ' + rec.attempts
          + (rec.attempts === 1 ? ' try' : ' tries')
        : day + '  \u00b7  not raced yet') + build;
    }
    const st = M._load();
    const cur = M.active();
    nameEl.textContent = (cur.name || M.UNNAMED_NAME || 'Unnamed Melon')
      + (st.melons.length > 1 ? '  (' + (st.active + 1) + '/' + st.melons.length + ')' : '');
    pilotEl.textContent = M.playerName ? M.playerName() : 'Player';
    const many = st.melons.length > 1;
    releaseBtn.style.display = many ? '' : 'none';
    left.style.visibility = many ? 'visible' : 'hidden';
    right.style.visibility = many ? 'visible' : 'hidden';
  };
  // THE PORTRAIT IS PART OF THE STATE, NOT PART OF THE ENTRANCE.
  // It was pushed once in menu.enter() and never rebuilt, so cycling
  // melons repainted the stats and the name while the picture kept
  // showing the first melon — the one screen whose entire job is
  // "look at your melon" was showing the wrong one. Rebuilding here
  // means any future thing that changes the active melon repaints for
  // free. The rotation angle carries over so the swap reads as a
  // change of melon rather than a stutter.
  const paintPortrait = () => {
    const prev = spinners.length ? spinners[0].angle : 0;
    spinners.length = 0;
    clearCanvas(elMenu._spin);
    pushMelonPortrait(elMenu._spin);
    if (spinners.length) spinners[0].angle = prev;
    setSpinPaused(false);
    startSpinners();
  };
  elMenu._paintPortrait = paintPortrait;

  const cycle = (d) => {
    const st = M._load();
    M.setActive((st.active + d + st.melons.length) % st.melons.length);
    refresh();
    paintPortrait();
    // No respawn here any more: during the exhibition a respawn would
    // restart the background race on every arrow press, and the real
    // grid is rebuilt on RACE anyway.
    if (!(window.FF.exhibition && window.FF.exhibition.running) ) { const rf = I.respawn(); if (rf) rf(); }
  };
  left.addEventListener('click', () => cycle(-1));
  right.addEventListener('click', () => cycle(1));
  // RELEASE, from the start screen. Only offered when there is more
  // than one melon — you must always have something to race — and it
  // always confirms, because the career record is what is actually
  // lost and that cannot be undone.
  releaseBtn.addEventListener('click', () => {
    const st = M._load();
    const cur = M.active();
    const r = cur.record || {};
    confirmAsk({
      title: 'RELEASE ' + (cur.name || 'THIS MELON').toUpperCase() + '?',
      body: 'Its career \u2014 ' + (r.races || 0) + ' races, ' + (r.wins || 0)
        + ' wins \u2014 goes with it. This cannot be undone.',
      cancel: 'KEEP IT',
      confirm: 'RELEASE',
      onConfirm: () => {
        if (M.deleteMelon(st.active)) refresh();
      },
    });
  });
  // THE PARTY CUP DOOR (practice removed, ruling B 2026-08-26; the
  // dormant daily fallback died with the flag — every path from this
  // button is the party now, and partycup owns its own transition).
  race.addEventListener('click', () => {
    if (!window.FF.partycup) return;
    I.setFromMenuOrRetry(true);
    if (window.FF.cup) window.FF.cup.abandon();
    if (window.FF.exhibition) window.FF.exhibition.stop();
    window.FF.partycup.begin();
  });
  // THE CUP: four legs, scored together.
  cupBtn.addEventListener('click', () => {
    const startLeg = I.startLeg();
    if (!window.FF.cup || !startLeg) return;
    I.setFromMenuOrRetry(true);
    if (window.FF.exhibition) window.FF.exhibition.stop();
    window.FF.cup.begin();
    startLeg(window.FF.cup.trackForLeg(0));
    flow.go('race');
  });
  elMenu._dayLine = dayLine;
  elMenu._expiredLine = expiredLine;
  elMenu._resumeBtn = resumeBtn;
  elMenu._cupBtn = cupBtn;
  resumeBtn.addEventListener('click', () => {
    const R = window.FF.resume;
    const rebuild = I.rebuild();
    if (!R || !rebuild) return;
    const snap = R.restore(I.state(), rebuild);
    // Vanished or stale between the menu being drawn and this tap
    // (the midnight case, if it turns over in that gap): refresh
    // re-reads the store, hides the button and shows the note that
    // restore's own peek() just left behind.
    if (!snap) { refresh(); return; }
    I.setFromMenuOrRetry(false);                  // mid-run: keep the records
    if (window.FF.exhibition) window.FF.exhibition.stop();
    // Never drop a returning player into a moving world.
    flow.go('race');
    flow.go('pause');
  });
  elMenu._refresh = refresh;
  elMenu._spin = spin;
  elMenu._stats = statsEl;
}

flow.register('menu', {
  build() {
    buildMenu();
    elMenu.style.display = 'none';
  },
  enter() {
    // Scenery: a full grid of bots lapping today's daily behind the
    // panel. Started here and stopped on exit, so it can never
    // outlive the screen that owns it.
    const ex = I.exhibition();
    if (window.FF.exhibition && ex) window.FF.exhibition.start(ex);
    clearFade();
    elMenu.style.display = 'flex';
    elMenu._refresh();
    spinners.length = 0;
    elMenu._paintPortrait();   // one definition of "paint the portrait"
    // Unrevealed rewards re-offer here: they are persisted facts, and
    // a crash or closed tab between earning and telling loses nothing
    // but the wait.
    if (window.FF.melon.pendingRewards().length) {
      runRewards(() => {});
    }
  },
  // Machine pokes (auto-pause refresh; the _dress dev helper's
  // portrait repaint) come through here rather than the element.
  refresh() { if (elMenu && elMenu._refresh) elMenu._refresh(); },
  paintPortrait() { if (elMenu && elMenu._paintPortrait) elMenu._paintPortrait(); },
  exit(to) {
    // Pressing RACE resets to a clean grid: you cannot be handed a
    // lap-two position you did not earn, so the exhibition is torn
    // down and a real race is built fresh (respawnFn below).
    //
    // ...BUT NOT WHEN THE NAMING SCREEN IS WHAT COVERS US. That screen
    // shows the very same exhibition through its scrim, so tearing it
    // down here and letting naming.enter() start it again REBUILT the
    // race — the field visibly jumped back to the grid every time a
    // player tapped to rename themselves. Leave it running and the
    // backdrop is continuous, which is the whole point of it.
    if (window.FF.exhibition && to !== 'naming') window.FF.exhibition.stop();
    elMenu.style.display = 'none';
  },
});
})();
