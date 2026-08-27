(function () {
'use strict';
// ============================================================
// SCREEN-FINISH — the results screen (split commit 2, 2026-08-26).
//
// Everything that WAS the finish inside flow.js, moved whole: the
// panel build with its exits (NEXT / RETRY / abandon / MAIN MENU and
// the prize handover), the racer card, the registration with the
// session branch and the fact-level relevance filter, showTab and
// the five fills. Bodies are the same bodies; the ONE rewrite is
// that the machine's own moving parts are read through
// flow._internals — the variables stay in flow.js, owned by the
// machine, so two modules can never hold divergent copies.
//
// Presentation tier. Loads AFTER flow.js (A4 pair): it registers
// INTO the machine, and builds its DOM when the machine runs the
// screens' build() hooks from flow.init.
// ============================================================
const flow = window.FF.flow;
const { el, fmtTime, ordinalSuffix, racerIdentity, computeStandings,
        spinners, clearCanvas, startSpinners, setSpinPaused, spinPaused,
        remeasureSpinners } = window.FF.flowLib;
const I = flow._internals;
const { confirmAsk, clearFade, runRewards } = I;
const sctx = I.sessionCtx;

let elFinish = null;
let elFinishNote = null, elFinishTitle = null;

function buildFinish() {
  elFinish = el('div', 'ff-screen ff-finish-screen');
  const panel = el('div', 'ff-panel');
  const head = el('div', 'ff-head');
  const finishTitle = el('h1', 'ff-title', 'FINISH');
  head.appendChild(finishTitle);
  // WHAT THIS RESULT COUNTED FOR. A practice race ends on the same
  // screen as a cup race and records nothing — a player who notices
  // their stats did not move will assume a bug, not a rule. Saying so
  // costs one line and removes the doubt entirely.
  const finishNote = el('p', 'ff-sub ff-finish-note', '');
  head.appendChild(finishNote);
  elFinishNote = finishNote;
  elFinishTitle = finishTitle;
  // Three tabs: the result, the race, and your run. PLACES leads
  // because it answers the question everyone has at the flag; the
  // other two are for the curious, and burying them behind a tap is
  // what keeps the result page from becoming a spreadsheet.
  const tabs = el('div', 'ff-tabs');
  // A tab strip is not a row of buttons, and now that it no longer
  // LOOKS like one it should not sound like one either: a screen
  // reader announcing "four buttons" gives the same wrong impression
  // the old styling gave the eye. role=tablist + aria-selected says
  // "one choice, currently on this", which is what showTab maintains.
  tabs.setAttribute('role', 'tablist');
  const panes = {};
  const tabBtns = {};
  const rows = el('div', 'ff-rows');
  const facts = el('div', 'ff-facts');
  const summary = el('div', 'ff-summary');
  const cupTable = el('div', 'ff-facts');
  const paneDefs = [
    ['cup', 'CUP', cupTable],
    ['places', 'PLACES', rows],
    ['race', 'RACE', facts],
    ['you', 'YOU', summary],
  ];
  for (const [key, label, content] of paneDefs) {
    const btn = el('button', 'ff-tab', label);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-controls', 'ff-pane-' + key);
    btn.id = 'ff-tabbtn-' + key;
    btn.addEventListener('click', () => showTab(key));
    tabs.appendChild(btn);
    tabBtns[key] = btn;
    const pane = el('div', 'ff-pane');
    pane.id = 'ff-pane-' + key;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', 'ff-tabbtn-' + key);
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
  elFinish._retry = retry;
  const btns = el('div', 'ff-buttons');
  btns.appendChild(retry);
  btns.appendChild(menu);
  // Mid-cup the action is NEXT RACE and nothing else is a peer:
  // leaving abandons the attempt entirely, so it must be deliberate
  // rather than one of two equal buttons.
  const next = el('button', 'ff-btn', 'NEXT RACE');
  const quit = el('button', 'ff-btn ff-quiet', 'abandon cup');
  elFinish._next = next;
  elFinish._quit = quit;
  const cupBtns = el('div');
  cupBtns.appendChild(next);
  cupBtns.appendChild(quit);
  const foot = el('div', 'ff-foot');
  foot.appendChild(btns);
  foot.appendChild(cupBtns);
  panel.appendChild(foot);
  elFinish._btns = btns;
  elFinish._cupBtns = cupBtns;
  next.addEventListener('click', () => {
    const sc = sctx();
    if (sc && sc.onNext) {
      const go2 = sc.onNext;
      I.setSessionCtx(null);
      I.setFromMenuOrRetry(true);
      go2();                       // the event module owns the transition
      return;
    }
    const c = window.FF.cup;
    const startLeg = I.startLeg();
    if (!c || !startLeg) return;
    startLeg(c.trackForLeg(c.current().leg));
    I.setFromMenuOrRetry(true);
    flow.go('race');
  });
  // ABANDONING IS DESTRUCTIVE AND SILENT: it throws away every leg
  // already raced, and nothing on screen would say so afterwards. A
  // quiet button made it hard to hit BY ACCIDENT; a confirm makes it
  // impossible — and, more usefully, it states the cost in the one
  // moment the player is deciding.
  quit.addEventListener('click', () => {
    // PARTY FIRST: between games the context carries onAbandon (the
    // event module's own teardown — records nothing, mirrors the
    // race law). Same confirm shape, the party's numbers.
    const scq = sctx();
    if (scq && scq.onAbandon) {
      const games = scq.gamesRun || 0;
      confirmAsk({
        title: 'ABANDON CUP?',
        body: games === 1
          ? 'One game already played. It will not be recorded.'
          : games > 1
            ? games + ' games already played. None of them will be recorded.'
            : 'Nothing will be recorded.',
        confirm: 'ABANDON',
        cancel: 'KEEP PLAYING',
        onConfirm: () => {
          const g = scq.onAbandon;
          I.setSessionCtx(null);
          g();                     // the event module tears down
        },
      });
      return;
    }
    const c = window.FF.cup;
    const legs = (c && c.current()) ? c.current().results.length : 0;
    confirmAsk({
      title: 'ABANDON CUP?',
      body: legs === 1
        ? 'One race already run. It will not be recorded.'
        : legs > 1
          ? legs + ' races already run. None of them will be recorded.'
          : 'Nothing will be recorded.',
      confirm: 'ABANDON',
      cancel: 'KEEP RACING',
      onConfirm: () => {
        // Records nothing — not even the legs already run.
        if (window.FF.resume) window.FF.resume.clear();
        if (window.FF.cup) window.FF.cup.abandon();
        const rf = I.respawn();
        if (rf) rf();
        flow.go('menu');
      },
    });
  });
  elFinish.appendChild(panel);
  document.body.appendChild(elFinish);
  // ---- COLLECT ON THE WAY OUT, WHICHEVER DOOR ----------------------
  // The prize is spent by EVERY exit from this screen, not just MAIN
  // MENU. Without this, pressing RETRY after winning left the award
  // pending: the melon was safe (it is persisted the moment it is
  // won) but the ceremony never ran, and the next completed cup
  // overwrote the pending award — a prize collected silently, with no
  // moment attached to it. Now the ceremony always happens, and only
  // the destination afterwards differs.
  // THE TELLING. Everything in the queue is already true; these
  // cards only present it, one per reward, in the order it queued —
  // xp first (the constant), decals next, melon last, because the
  // melon chains into acceptance and naming and nothing should come
  // back from a naming ceremony to '+56 XP, tap to continue'.
  const collectThen = (next) => runRewards(next);

  retry.addEventListener('click', () => {
    const sc = sctx();
    if (sc && sc.final && sc.onRetry) {
      const go3 = sc.onRetry;
      I.setSessionCtx(null);
      I.setFromMenuOrRetry(true);
      // COLLECT ON THE WAY OUT, WHICHEVER DOOR (2026-08-26s): the
      // party's completion queues the xp reveal now, and the race
      // screen's law applies unchanged — the ceremony runs before
      // the destination, on EVERY exit from a completed cup.
      collectThen(() => go3());    // RETRY at the final: a fresh party cup
      return;
    }
    collectThen(() => {
      // After a completed cup, RETRY means another ATTEMPT at the day —
      // unlimited by design, ranked on your best.
      const startLeg = I.startLeg();
      if (window.FF.cup && window.FF.cup.isComplete() && startLeg) {
        window.FF.cup.begin();
        startLeg(window.FF.cup.trackForLeg(0));
      } else {
        const rf = I.respawn();
        if (rf) rf();
      }
      I.setFromMenuOrRetry(true);
      flow.go('race');
    });
  });
  menu.addEventListener('click', () => {
    const sc = sctx();
    if (sc && sc.final && sc.onMenu) {
      const go4 = sc.onMenu;
      I.setSessionCtx(null);
      collectThen(() => go4());    // ceremony first, then the teardown
      return;
    }
    // Leaving for the menu ends the run: nothing left to resume, and
    // an orphaned snapshot would offer to restore a race the player
    // deliberately walked away from.
    if (window.FF.resume) window.FF.resume.clear();
    if (window.FF.cup && !window.FF.cup.isRunning()) window.FF.cup.abandon();
    const rf = I.respawn();
    if (rf) rf();
    I.setFromMenuOrRetry(true);
    // THE HANDOVER. The prize was announced on the cup tab and is
    // already in the stable; this is the ceremony. It happens between
    // the finish screen and the menu, so the input-requiring beat
    // lands once the player has decided they are done reading — and
    // never before the placing that earned it.
    collectThen(() => flow.go('menu'));
  });
  // THE DOOR HAS TO NAME WHAT IS BEHIND IT. 'YOU'VE WON A MELON'
  // followed by two buttons that say RETRY and MAIN MENU leaves the
  // player told about a prize with no visible way to reach it — and
  // nothing hints that the menu route hands it over on the way. So
  // when a prize is waiting the exit says so and becomes the PRIMARY
  // action, and RETRY steps down to secondary.
  //
  // THE LABEL IS 'MELON GET!' — the acquisition shout from the
  // Japanese Super Mario Sunshine ("SHINE GET!"), whose joke is the
  // word order, not the casing. Set in CAPS like every other button:
  // the buttons are one family and a lone sentence-case member reads
  // as an inconsistency before it reads as a quote. The plain
  // language directly above it ("YOU'VE WON A MELON" on the cup tab)
  // does the informing, so the button is free to celebrate.
  elFinish._paintPrizeButtons = () => {
    // ONE LABEL LAW (ruled 2026-08-16, replacing the MAIN MENU /
    // MELON GET! switch): the button says GET XP exactly when
    // pressing it gets you something — the reward queue is non-empty
    // after every completed cup (xp is the constant), and the same
    // press still runs decals and the melon ceremony after it. XP,
    // not EXP: every shipped surface already says XP (+76 XP, PILOT
    // LEVEL 2 · 26/75 XP), and two spellings of one number is noise.
    // Practice and reward-less exits keep MAIN MENU, because a button
    // that promises xp it cannot pay is a lie.
    const waiting = window.FF.melon.pendingRewards().length > 0;
    menu.textContent = waiting ? 'GET XP' : 'MAIN MENU';
    menu.classList.toggle('ff-secondary', !waiting);
    retry.classList.toggle('ff-secondary', waiting);
  };
  elFinish._rows = rows;
  elFinish._cupTable = cupTable;
  elFinish._facts = facts;
  elFinish._summary = summary;
  elFinish._panes = panes;
  elFinish._tabBtns = tabBtns;
}

// ---- THE RACER CARD ---------------------------------------------------
// Tap any standings row and the melon gets the start-screen treatment:
// name, pilot, spinning portrait, species, the body's own weight, the
// result you tapped it from, and what it's wearing. The moment the
// fixed cast becomes INSPECTABLE — "who exactly just bullied me into a
// ravine" gets an answer, and the day bot decals ship there is already
// a place to admire them. NEXT browses the field in table order;
// CLOSE (or the scrim) leaves.
let elRacer = null;
let racerSpin = null;    // this card's entry in the spinner list
let racerCtx = null;     // { rows, idx }

function closeRacerCard() {
  if (racerSpin) {
    const i = spinners.indexOf(racerSpin);
    if (i !== -1) spinners.splice(i, 1);
    racerSpin = null;
  }
  if (elRacer) elRacer.style.display = 'none';
  racerCtx = null;
}

function openRacerCard(rows, idx) {
  const r = rows[idx];
  if (!r) return;
  if (!elRacer) {
    elRacer = el('div', 'ff-screen ff-racer-screen');
    elRacer.addEventListener('pointerdown', (ev) => {
      if (ev.target === elRacer) closeRacerCard();   // the scrim closes
    });
    document.body.appendChild(elRacer);
  }
  if (racerSpin) {
    const i = spinners.indexOf(racerSpin);
    if (i !== -1) spinners.splice(i, 1);
    racerSpin = null;
  }
  racerCtx = { rows, idx };
  elRacer.textContent = '';
  const panel = el('div', 'ff-panel');
  elRacer.appendChild(panel);

  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', r.name || '?'));
  head.appendChild(el('p', 'ff-sub', r.isPlayer ? 'driven by you' : r.pilot));
  panel.appendChild(head);

  // The chevrons are the collection-browser language from the start
  // screen (ruled 2026-08-16, replacing a NEXT button): browsing the
  // field reads the same as browsing your stable, and the foot drops
  // to ONE full-width button — the house .ff-btn is a block, and two
  // in a row is how the first cut burst the panel.
  const prow = el('div', 'ff-rc-prow');
  const left = el('button', 'ff-arrow', '\u25C0');
  left.addEventListener('click', () => {
    if (racerCtx) openRacerCard(racerCtx.rows,
      (racerCtx.idx - 1 + racerCtx.rows.length) % racerCtx.rows.length);
  });
  const cv = el('canvas', 'ff-spin');
  cv.width = 256; cv.height = 256;
  const right = el('button', 'ff-arrow', '\u25B6');
  right.addEventListener('click', () => {
    if (racerCtx) openRacerCard(racerCtx.rows,
      (racerCtx.idx + 1) % racerCtx.rows.length);
  });
  prow.appendChild(left);
  prow.appendChild(cv);
  prow.appendChild(right);
  panel.appendChild(prow);
  clearCanvas(cv);
  racerSpin = { canvas: cv, angle: (r.pos || 1) * 0.7, a: r.a, b: r.b,
    color: r.color, patKey: r.patKey, species: r.species, decals: r.decals };
  spinners.push(racerSpin);

  const stats = el('div', 'ff-stats');
  const stat = (k, v) => {
    const rowEl = el('div', 'ff-stat-row');
    rowEl.appendChild(el('div', 'k', k));
    rowEl.appendChild(el('div', 'v', v));
    stats.appendChild(rowEl);
  };
  stat('SPECIES', (r.species || 'watermelon').toUpperCase());
  if (r.kg != null) stat('WEIGHT', r.kg.toFixed(1) + ' kg');
  const res = r.dnf ? 'DNF'
    : r.pos + ordinalSuffix(r.pos)
      + (r.timeSec != null ? ' \u00b7 ' + fmtTime(r.timeSec) : '')
      + (r.points != null ? ' \u00b7 ' + r.points + ' pts' : '');
  stat('RESULT', res);
  panel.appendChild(stats);

  // What it's wearing — the same painter as the tray, so a sticker
  // can never look different here. The zero-state is a fact, stated
  // in the dossier voice: most of this field wears nothing, which is
  // exactly what makes the one melon in a wrap funny.
  const D = window.FF.decals;
  const wornList = (r.decals || []).map(w => D.byId(w.id)).filter(Boolean);
  if (wornList.length) {
    const strip = el('div', 'ff-rc-decals');
    for (const item of wornList) {
      const chip = el('div', 'ff-rc-chip');
      const c2 = el('canvas');
      c2.width = 72; c2.height = 72;
      D.paintArt(c2, item);
      chip.appendChild(c2);
      chip.appendChild(el('div', '', item.label));
      strip.appendChild(chip);
    }
    panel.appendChild(strip);
  } else {
    const none = el('div', 'ff-stats');
    const rowEl = el('div', 'ff-stat-row');
    rowEl.appendChild(el('div', 'k', 'DECALS'));
    rowEl.appendChild(el('div', 'v', 'none'));
    none.appendChild(rowEl);
    panel.appendChild(none);
  }

  const foot = el('div', 'ff-reward-foot');
  const closeBtn = el('button', 'ff-btn', 'CLOSE');
  closeBtn.addEventListener('click', closeRacerCard);
  foot.appendChild(closeBtn);
  panel.appendChild(foot);

  elRacer.style.display = 'flex';
}

// ---- SESSION FINISH: the context lives in flow (the machine owns
// what NEXT means); flow.showSessionFinish hands it over and enters.

flow.register('finish', {
  build() {
    buildFinish();
    elFinish.style.display = 'none';
  },
  enter() {
    // THE ONE CAREER WRITE. This is the only moment a race is
    // genuinely complete, and entering this state happens exactly once
    // per finish (flow.onFrame fires on the crossing tick and latches),
    // so the record can't double-count. Everything written comes from
    // the standings captured at the flag and the race book — no new
    // measurement, no second source of truth.
    const M = window.FF.melon;
    const st = I.state();
    if (M && M.recordRace) {
      // The times were resolved during the settle beat (see
      // beginSettle): by here they are a fact, not a computation.
      const resolved = I.lastResolved();
      const rowsNow = computeStandings(st, resolved);
      const mine = rowsNow.find(r => r.isPlayer);
      const rw = window.FF.raceWatch;
      const sum = (rw && rw.summary) ? rw.summary(st) : {};
      if (mine) {
        // PRACTICE RECORDS NOTHING: it is how you learn the day's
        // terrain, not a result. Cup races record as races, exactly
        // as before the cup existed.
        // SESSIONS GUARD ON WHAT THEY ARE (ruling B, 2026-08-26).
        // Party games enter this screen too, and practiceMode was
        // quietly load-bearing for them: it kept the race career
        // write, the line xp and completeLeg off. The truthful guard
        // was always st.session — a session has no race to record.
        if (!st.session) {
          M.recordRace({
            place: mine.pos,
            fieldSize: rowsNow.length,
            splats: sum.deaths || 0,
            bestLapTicks: (st.race && st.race.bestLapTicks) || null,
            distanceM: mine.x / 100,
            biggestSurvived: sum.biggestSurvived || 0,
          });
        }
        // XP BANKS AT THE LINE (5 per cup race finished — the law is
        // xp.js's). A DNF banks nothing; practice banks nothing. The
        // fact is written now; any telling of it waits for cup end.
        if (!st.session && window.FF.cup && window.FF.cup.current()
            && !mine.dnf && M.addXp && window.FF.xp) {
          M.addXp(window.FF.xp.XP_RACE);
        }
        if (!st.session && window.FF.cup && window.FF.cup.current()) {
          window.FF.cup.completeLeg({
            place: mine.pos,
            fieldSize: rowsNow.length,
            timeSec: mine.timeSec,
            dnf: !!mine.dnf,
            splats: sum.deaths || 0,
            standings: rowsNow,   // the whole field, for the points table
          });
          // A finished cup banks the attempt and the career record.
          if (window.FF.cup.isComplete()) {
            const done = window.FF.cup.finish();
            if (done && M.recordCup) {
              // done.place is the player's rank in the cup's own
              // points table — a fact, computed from every racer's
              // finishes, not an estimate from the player's score.
              M.recordCup({ place: done.place, points: done.totals.points });
            }
            // ---- THE PRIZE ----------------------------------------
            // Rolled HERE, at the same latched moment as the career
            // write, so it happens exactly once per completed cup and
            // cannot be re-rolled by revisiting a screen. The melon is
            // minted and persisted immediately (melon.js) — a player
            // who closes the tab between this screen and the menu keeps
            // what they won. What follows is only the telling of it.
            // Completion xp banks with the career write: the cup
            // bonus plus the points-become-xp law. The reveal card
            // carries a snapshot (from/to) so the bar it animates is
            // the fact as it happened, not a re-derivation later.
            if (done && M.addXp && window.FF.xp) {
              const X = window.FF.xp;
              const cupState = window.FF.cup.current() || {};
              const from = (typeof cupState.xpStart === 'number')
                ? cupState.xpStart : M.pilotXp();
              M.addXp(X.XP_CUP + X.XP_PER_POINT * (done.totals.points | 0));
              const to = M.pilotXp();
              M.queueReward({ kind: 'xp', from, to, added: to - from,
                levelFrom: X.levelFor(from), levelTo: X.levelFor(to) });
              // Every level crossed fires its roll NOW — the sticker
              // is granted and persisted here; the card only tells it.
              M.settleLevelRolls();
            }
            if (done && M.awardForCup) {
              const award = M.awardForCup({
                day: (window.FF.cup.current() || {}).day,
                attempt: (done.record && done.record.attempts) || 1,
                place: done.place,
              });
              // Won melons join the queue like everything else —
              // last, per the ruling: the showstopper closes the
              // sequence because it chains into acceptance and naming.
              if (award && award.won) {
                M.queueReward({ kind: 'melon', award });
              }
            }
          }
        }
      }
    }
    // Hand the melon over: the field keeps racing behind the panel.
    // Solo only — in netplay peers exchange inputs, so substituting
    // local AI would desync the session (netplay bypasses these
    // screens anyway; the guard is belt and braces).
    if (window.FF.autopilot) {
      const np = I.netplay();
      window.FF.autopilot.engage(st, { netplay: !!(np && np()) });
    }
    if (elFinish._paintPrizeButtons) elFinish._paintPrizeButtons();
    elFinish.style.display = 'flex';
    const rows = elFinish._rows;
    rows.textContent = '';
    spinners.length = 0;
    closeRacerCard();                    // never carry a card between races
    // The handshake layer: fresh rows, and the response plan seeded by
    // THIS race's identity — a retry is a new race and rolls anew.
    if (window.FF.emote) {
      window.FF.emote.reset(((st.raceStartTick | 0) * 2654435761) >>> 0);
    }
    const standRows = computeStandings(st, I.lastResolved());
    elFinish._standRows = standRows;     // the RACE tab's facts look up here
    for (let ri = 0; ri < standRows.length; ri++) {
      const r = standRows[ri];
      const row = el('div', 'ff-row' + (r.isPlayer ? ' ff-you' : ''));
      // BARE ROWS ARE DOORS (ruled 2026-08-16): tap any melon row for
      // its card. No chevron — this is a bonus surface, found by the
      // curious, and the screen is dense enough already.
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openRacerCard(standRows, ri));
      // Ordinal, with the suffix styled small: the NUMBER is the
      // thing you read across the room.
      const pos = el('div', 'ff-pos', String(r.pos));
      pos.appendChild(el('span', 'ff-ord', ordinalSuffix(r.pos)));
      row.appendChild(pos);
      const c = el('canvas', 'ff-spin');
      c.width = 104; c.height = 104; // hint; syncCanvasSize owns it
      row.appendChild(c);
      if (window.FF.emote) {
        window.FF.emote.registerRow(r.key, row, c);
        if (r.isPlayer) {
          // YOUR portrait is the emote button (ruled 2026-08-16); the
          // rest of your row still opens your card. You can only
          // speak as yourself; you can only inspect others in full.
          c.style.cursor = 'pointer';
          c.addEventListener('click', (ev) => {
            ev.stopPropagation();
            window.FF.emote.playerEmote(r.key);
          });
        }
      }
      const nm = racerIdentity(r.name, r.pilot, r.isPlayer);
      nm.appendChild(el('div', 'ff-rtime',
        r.metricStr !== undefined ? r.metricStr : (r.dnf ? 'DNF' : fmtTime(r.timeSec))));
      row.appendChild(nm);
      rows.appendChild(row);
      clearCanvas(c);
      spinners.push({ canvas: c, angle: r.pos * 0.7, a: r.a, b: r.b,
        color: r.color, patKey: r.patKey, species: r.species, decals: r.decals });
    }
    fillFacts();
    fillSummary();
    const cupping = !st.session && window.FF.cup && window.FF.cup.current();
    // After the places rows: both tabs push into the same spinner
    // list, which is emptied once at the top of enter().
    fillCup();
    // Mid-cup the standings that matter are the CUP's, so that tab
    // leads; a single race still opens on its own result.
    setCupMode(!!cupping, cupping && window.FF.cup.isComplete());
    const sc = sctx();
    if (st.session && sc) {
      // THE RELEVANCE FILTER, first pass (design ruled: tabs declare
      // their data; absent data, absent tab). A session has PLACES —
      // ranks, portraits, bests. The RACE and YOU tabs read race
      // telemetry that does not exist here; the CUP tab reads the
      // daily cup. None of that data exists, so none of those tabs
      // render. The full declaration-driven filter arrives with the
      // metric-aware tab work.
      elFinishTitle.textContent = sc.title || 'RESULTS';
      if (elFinishNote) elFinishNote.textContent = sc.note || '';
      // FOUR TABS, SAME AS A RACE (re-ruled 2026-08-26): relevance
      // filters at the FACT level, not the tab level. raceWatch
      // observes the SIM, not the race rules, so the field's carnage
      // census and your run both exist in a party game; only the
      // lap-shaped facts drop out (each guarded by its own data
      // already — bestLapSec is null in a session).
      elFinish._tabBtns.race.style.display = '';
      elFinish._tabBtns.race.textContent = 'GAME';
      elFinish._tabBtns.you.style.display = '';
      fillSessionSummary();
      // THE CUP TAB DECLARES ITS DATA: party points (a running table
      // between games, the final table at the end). Present, it
      // renders and LEADS — the race cup's own mid-cup law. Absent
      // (a lone session outside a cup), no tab.
      if (sc.cupRows) {
        elFinish._tabBtns.cup.style.display = '';
        fillPartyCup(sc.cupRows);
        showTab('cup');
      } else {
        elFinish._tabBtns.cup.style.display = 'none';
        showTab('places');
      }
      const mid2 = !!sc.onNext;
      elFinish._cupBtns.style.display = mid2 ? '' : 'none';
      elFinish._btns.style.display = mid2 ? 'none' : '';
      elFinish._next.textContent = sc.nextLabel || 'NEXT GAME';
      // The final's foot MIRRORS the race cup's (re-ruled 2026-08-26,
      // replacing RUN IT BACK): the button says RETRY there, so it
      // says RETRY here — one label for one action. The handler still
      // walks sc.onRetry (a fresh party cup).
      // THE PARTY ABANDON ARRIVES (2026-08-26s): mid-cup the quiet
      // quit shows exactly as it does for the race cup; the final
      // has nothing left to abandon.
      elFinish._quit.style.display = mid2 ? '' : 'none';
      return;
    }
    // A race finish restores what a session may have hidden.
    elFinish._tabBtns.race.style.display = '';
    elFinish._tabBtns.race.textContent = 'RACE';
    elFinish._tabBtns.you.style.display = '';
    elFinish._next.textContent = 'NEXT RACE';
    elFinish._retry.textContent = 'RETRY';
    elFinish._quit.style.display = '';
    if (elFinishNote) {
      const c = window.FF.cup;
      if (c && c.isComplete()) {
        const rec = c.dayRecord();
        const t = c.totals();
        elFinishNote.textContent = 'cup complete \u00b7 ' + t.points + ' pts'
          + (rec && rec.attempts > 1
            ? '  \u00b7  best ' + rec.bestPoints + ' in ' + rec.attempts + ' tries'
            : '');
      } else if (c && c.current()) {
        elFinishNote.textContent = 'race ' + c.current().leg + ' of ' + c.LEGS;
      } else {
        elFinishNote.textContent = '';
      }
      elFinishNote.style.display = elFinishNote.textContent ? '' : 'none';
    }
    if (elFinishTitle) {
      elFinishTitle.textContent = (window.FF.cup && window.FF.cup.isComplete())
        ? 'CUP COMPLETE' : 'FINISH';
    }
    showTab(cupping ? 'cup' : 'places');
    startSpinners();
  },
  exit() {
    clearFade();
    if (window.FF.autopilot) window.FF.autopilot.disengage();
    // Release the tab-scoped pause: it is meaningless once this
    // screen is gone, and leaving it set froze the next screen's
    // spinners.
    setSpinPaused(false);
    elFinish.style.display = 'none';
  },
});

function showTab(key) {
  const panes = elFinish._panes, btns = elFinish._tabBtns;
  for (const k of Object.keys(panes)) {
    const on = (k === key);
    panes[k].classList.toggle('on', on);
    btns[k].classList.toggle('on', on);
    // The state the eye reads and the state the screen reader reads
    // are set in the same breath, so they cannot drift.
    btns[k].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  // Spinners live in the PLACES and CUP panes; a hidden canvas would
  // keep the rAF loop alive for nothing, and isConnected cannot see
  // display:none.
  // SCOPED TO THIS SCREEN: leaving the finish on the RACE or YOU tab
  // used to strand this flag as true, so the menu's portrait never
  // animated and simply showed whatever pixels the canvas still held
  // from before the race — a stale bitmap, stretched by CSS, which
  // reads exactly like "low fidelity and won't rotate".
  // A tab change reveals canvases that have never been measured, and
  // hides others; force a remeasure on the next frame.
  remeasureSpinners();
  setSpinPaused(!(key === 'places' || key === 'cup'));
  if (!spinPaused()) startSpinners();
}

// ---- The CUP tab: the points table, and what it is for ----------
function fillCup() {
  const box = elFinish._cupTable;
  box.textContent = '';
  const c = window.FF.cup;
  if (!c || !c.current()) return;
  const rows = c.table();
  const t = c.totals();
  const legs = c.current().leg;
  const head = el('div', 'ff-cup-head',
    c.isComplete() ? 'FINAL \u00b7 ' + t.points + ' pts'
      : 'AFTER ' + legs + ' OF ' + c.LEGS + '  \u00b7  ' + t.points + ' pts');
  box.appendChild(head);

  // THE PRIZE, ANNOUNCED WHERE THE DAY'S RESULT IS STATED. The award
  // is a consequence of the placing, so it is told in the moment of
  // triumph and HANDED OVER on the way out (see the MAIN MENU
  // handler): a beat of anticipation between learning and receiving,
  // which is the shape a prize wants. A blocked award says so rather
  // than showing nothing, because winning and receiving nothing looks
  // like a bug.
  // THE FINISH SCREEN ANNOUNCES NOTHING (ruled 2026-08-15). It is
  // performance feedback — positions, points, the truth of the race.
  // Rewards are already granted and queued; their telling begins when
  // the player chooses to leave, one card per reward. (The old
  // dailyCap notice died with the announcement: a blocked award is no
  // reward, and no reward gets no card.)

  // SAME SHAPE AS THE PLACES TAB. A cup standing is a standing: the
  // player reads it the same way, so it gets the same tiered ordinal,
  // the same rotating body, and the same quiet second line. Only the
  // CONTENT differs — points and cumulative time instead of one
  // race's finish. (The rows live in their own container so the
  // podium's :nth-child tiering counts rows, not the heading above
  // them.)
  const list = el('div', 'ff-rows ff-cup-rows');
  box.appendChild(list);
  const cardRows = [];                   // cup standing + race-row visuals

  // The cup's cast is fixed for all four legs, so a racer's
  // appearance can be looked up from this race's standings by name —
  // no second source of truth for what a melon looks like.
  const look = new Map();
  for (const s of computeStandings(I.state(), I.lastResolved())) {
    look.set(s.key, s);
  }

  for (const r of rows) {
    const key = r.key;
    const s = look.get(key);
    const row = el('div', 'ff-row' + (r.isPlayer ? ' ff-you' : ''));
    const pos = el('div', 'ff-pos', String(r.pos));
    pos.appendChild(el('span', 'ff-ord', ordinalSuffix(r.pos)));
    row.appendChild(pos);
    const cv = el('canvas', 'ff-spin');
    cv.width = 104; cv.height = 104;   // hint; syncCanvasSize owns it
    row.appendChild(cv);
    const nm = racerIdentity(r.isPlayer ? (s ? s.name : 'YOU') : r.name, r.pilot, r.isPlayer);
    nm.appendChild(el('div', 'ff-rtime',
      r.points + ' pts  \u00b7  ' + (r.dnfs ? fmtTime(r.timeSec) + '  \u00b7  ' + r.dnfs + ' DNF' : fmtTime(r.timeSec))));
    row.appendChild(nm);
    list.appendChild(row);
    clearCanvas(cv);
    if (s) {
      if (window.FF.emote) {
        window.FF.emote.registerRow(s.key, row, cv);
        if (s.isPlayer) {
          cv.style.cursor = 'pointer';
          cv.addEventListener('click', (ev) => {
            ev.stopPropagation();
            window.FF.emote.playerEmote(s.key);
          });
        }
      }
      spinners.push({ canvas: cv, angle: r.pos * 0.7, a: s.a, b: s.b,
        color: s.color, patKey: s.patKey, species: s.species, decals: s.decals });
      // The card for a cup row: the CUP's standing (pos, points,
      // cumulative time) wearing this race's body — same one-source
      // rule the row itself follows.
      const cardIdx = cardRows.length;
      cardRows.push({ name: s.name, pilot: s.pilot, isPlayer: s.isPlayer,
        species: s.species, kg: s.kg, a: s.a, b: s.b, color: s.color,
        patKey: s.patKey, decals: s.decals,
        pos: r.pos, timeSec: r.timeSec, dnf: false, points: r.points });
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openRacerCard(cardRows, cardIdx));
    }
  }
}

// Which face is the finish screen wearing?
function setCupMode(cupping, complete) {
  const showCupTab = !!cupping;
  elFinish._tabBtns.cup.style.display = showCupTab ? '' : 'none';
  // Mid-cup: NEXT RACE. Cup over, or a practice race: RETRY / MENU.
  const mid = cupping && !complete;
  elFinish._cupBtns.style.display = mid ? '' : 'none';
  elFinish._btns.style.display = mid ? 'none' : '';
}

// ---- The PARTY CUP tab (2026-08-26): points so far / final -------
// Same pane the race cup's table uses; the columns speak the party
// cup's language — per-game bests and points.
function fillPartyCup(cupRows) {
  // SAME SHAPE AS THE RACE CUP TAB (re-fixed 2026-08-26: the first
  // version used plain fact rows and read as a different screen). A
  // cup standing is a standing: tiered ordinal, rotating body,
  // identity line — only the CONTENT differs (per-game bests and
  // points instead of cumulative time).
  const box = elFinish._cupTable;
  box.textContent = '';
  const mine = cupRows.find((r) => r.isPlayer);
  box.appendChild(el('div', 'ff-cup-head',
    (sctx() && sctx().final ? 'FINAL' : 'AFTER '
      + (window.FF.partycup ? Math.min(cupRows.length && window.FF.partycup.LEGS, 99) : ''))
    .replace(/AFTER \d*/, sctx() && sctx().final ? 'FINAL'
      : 'STANDINGS') + ' \u00b7 ' + (mine ? mine.points + ' pts' : '')));
  const list = el('div', 'ff-rows ff-cup-rows');
  box.appendChild(list);
  const look = new Map();
  for (const s of computeStandings(I.state(), I.lastResolved())) look.set(s.name, s);
  for (const r of cupRows) {
    const row = el('div', 'ff-row' + (r.isPlayer ? ' ff-you' : ''));
    const pos = el('div', 'ff-pos', String(r.place));
    pos.appendChild(el('span', 'ff-ord', ordinalSuffix(r.place)));
    row.appendChild(pos);
    const cv = el('canvas', 'ff-spin');
    cv.width = 104; cv.height = 104;
    row.appendChild(cv);
    const nm = racerIdentity(r.name, r.pilot, r.isPlayer);
    nm.appendChild(el('div', 'ff-rtime',
      r.points + ' pts' + (r.bests && r.bests.length
        ? '  \u00b7  ' + r.bests.join('  ') : '')));
    row.appendChild(nm);
    list.appendChild(row);
    clearCanvas(cv);
    const s = look.get(r.name);
    if (s) {
      spinners.push({ canvas: cv, angle: r.place * 0.7, a: s.a, b: s.b,
        color: s.color, patKey: s.patKey, species: s.species, decals: s.decals });
    }
  }
}

// ---- The YOU tab, session form (2026-08-26) ----------------------
// Session-native facts over the SAME row markup fillSummary uses:
// your best in the game's own units, attempts (the mark counter),
// splats, biggest hit survived. Lap facts have no session existence.
function fillSessionSummary() {
  const box = elFinish._summary;
  box.textContent = '';
  const st = I.state();
  const S = window.FF.session;
  const m = st.players[0].melon;
  const stat = (v, k) => {
    const row = el('div', 'ff-fact');
    row.appendChild(el('div', 'ff-fact-l', k));
    const right = el('div', 'ff-fact-r');
    right.appendChild(el('div', 'ff-fact-n', String(v)));
    row.appendChild(right);
    box.appendChild(row);
  };
  stat(S.formatBest(st, m), 'BEST');
  stat(String(m.skiMarkSeq || 0), 'ATTEMPTS');
  const rw = window.FF.raceWatch;
  const s = (rw && rw.summary) ? rw.summary(st) : {};
  stat(String(s.deaths || 0), (s.deaths || 0) === 1 ? 'SPLAT' : 'SPLATS');
  if (s.biggestSurvived) stat(s.biggestSurvived.toFixed(1), 'BIGGEST SURVIVED');
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
    // The RACE tab has no melon rows, but its superlatives NAME
    // melons, and any representation of a melon is a door (same
    // ruling as the rows). Looked up by name in this race's
    // standings; a miss (a fact about no one) simply isn't a door.
    const sr = elFinish._standRows || [];
    const idx = sr.findIndex(x => x.name === f.name);
    if (idx !== -1) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openRacerCard(sr, idx));
    }
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
  const s = rw.summary(I.state());
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
})();
