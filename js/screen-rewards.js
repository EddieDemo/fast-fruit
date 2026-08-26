(function () {
'use strict';
// ============================================================
// SCREEN-REWARDS — the reward ceremony (split commit 4, 2026-08-26).
//
// The overlay, the xp and decal cards, and the queue runner, moved
// whole from flow.js. Not a registered screen: rewards are an
// overlay walked between screens (finish -> menu, menu re-offer),
// so the module exports ONE door — window.FF.rewards.run(next) —
// and the machine's _internals.runRewards trampolines to it.
//
// Melon entries still chain into the award ceremony (acceptance,
// possibly naming), which is naming-coupled and lives in flow until
// the naming commit; the runner reaches it through
// flow._internals.openAwardFlow, resolved at call time.
//
// Presentation tier. Loads AFTER flow.js.
// ============================================================
const flow = window.FF.flow;
const { el } = window.FF.flowLib;
const I = flow._internals;

// ---- THE REWARD CARDS ------------------------------------------------
// One overlay, reconfigured per entry. Sports-administration voice:
// the cards read like notices posted by an unseen governing body that
// takes melon racing entirely seriously. Tap anywhere: a tap during
// the bar animation completes it instantly; a tap after advances. The
// sequence must never cost a fast player more taps than it has cards.
let elReward = null;
let rewardAnim = null;      // { finish() } while the bar is animating

function buildRewardScreen() {
  elReward = el('div', 'ff-screen ff-reward-screen');
  const panel = el('div', 'ff-panel');
  elReward.appendChild(panel);
  elReward._panel = panel;
  document.body.appendChild(elReward);
}

function showRewardCard(entry, onAdvance) {
  if (!elReward) buildRewardScreen();
  const panel = elReward._panel;
  panel.textContent = '';
  elReward.style.display = 'flex';

  if (entry.kind === 'xp') paintXpCard(panel, entry);
  else paintDecalCard(panel, entry);

  // A REAL BUTTON. The quiet style is for the road not taken (QUIT
  // RACE beside CONTINUE RACE); this is the only road, so it gets the
  // standard button. The whole card still advances on tap — the
  // button is the visible affordance, not a smaller hit target.
  const foot = el('div', 'ff-reward-foot');
  foot.appendChild(el('button', 'ff-btn', 'CONTINUE'));
  panel.appendChild(foot);

  const advance = (ev) => {
    ev.preventDefault();
    if (rewardAnim) { rewardAnim.finish(); return; }   // first tap: skip anim
    elReward.removeEventListener('pointerdown', advance);
    window.removeEventListener('keydown', keyAdvance);
    elReward.style.display = 'none';
    onAdvance();
  };
  const keyAdvance = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') advance(ev);
  };
  elReward.addEventListener('pointerdown', advance);
  window.addEventListener('keydown', keyAdvance);
}

function paintXpCard(panel, e) {
  const X = window.FF.xp;
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'PILOT RECORD'));
  head.appendChild(el('p', 'ff-sub ff-reward-sub', 'official adjustment'));
  panel.appendChild(head);
  const big = el('div', 'ff-reward-big', '+0 XP');
  panel.appendChild(big);
  const stamp = el('div', 'ff-levelup-stamp', 'LEVEL UP');
  panel.appendChild(stamp);
  const track = el('div', 'ff-xp-track');
  const fill = el('div', 'ff-xp-fill');
  track.appendChild(fill);
  panel.appendChild(track);
  const line = el('div', 'ff-xp-line', '');
  panel.appendChild(line);

  // The bar animates the FACT (from -> to, wrapping at each level it
  // crossed); nothing here recomputes an award.
  const dur = Math.min(1200, 300 + 8 * (e.added || 0));
  const t0 = performance.now();
  let done = false;
  const setTo = (xpNow) => {
    const p = X.progress(Math.round(xpNow));
    fill.style.width = Math.round(100 * p.into / p.need) + '%';
    big.textContent = '+' + Math.round(xpNow - e.from) + ' XP';
    line.textContent = 'PILOT LEVEL ' + p.level + ' \u00b7 '
      + p.into + ' / ' + p.need + ' XP';
    if (p.level > e.levelFrom) stamp.classList.add('ff-stamped');
  };
  const finish = () => {
    if (done) return;
    done = true;
    rewardAnim = null;
    setTo(e.to);
  };
  rewardAnim = { finish };
  (function tick(now) {
    if (done) return;
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - (1 - t) * (1 - t);
    setTo(e.from + (e.to - e.from) * eased);
    if (t >= 1) { finish(); return; }
    requestAnimationFrame(tick);
  })(t0);
}

function paintDecalCard(panel, e) {
  const D = window.FF.decals;
  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'DECAL AWARDED'));
  head.appendChild(el('p', 'ff-sub ff-reward-sub',
    'issued at pilot level ' + e.level));
  panel.appendChild(head);
  const cv = el('canvas', 'ff-reward-art');
  cv.width = 176; cv.height = 176;
  const item = D.byId(e.id);
  if (item) D.paintArt(cv, item);
  panel.appendChild(cv);
  panel.appendChild(el('div', 'ff-reward-name', (e.label || e.id).toUpperCase()));
  panel.appendChild(el('div', 'ff-xp-line',
    '1 OF ' + e.setSize + ' \u00b7 ' + e.setLabel));
}

// Run the queue front-to-back. Melon entries hand off to the existing
// award ceremony (acceptance, possibly naming) and the runner resumes
// after it — but since melons queue last, 'resumes' is almost always
// 'finishes'.
function runRewards(next) {
  const M = window.FF.melon;
  const q = M.pendingRewards();
  if (!q.length) { next(); return; }
  const e = q[0];
  if (e.kind === 'melon') {
    M.shiftReward();
    I.openAwardFlow()(e.award, () => runRewards(next));
    return;
  }
  showRewardCard(e, () => {
    M.shiftReward();                 // popped only after the tap-past
    runRewards(next);
  });
}

window.FF.rewards = { run: runRewards };
})();
