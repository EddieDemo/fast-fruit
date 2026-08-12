(function () {
'use strict';
// ============================================================
// EXHIBITION — the race that plays behind the main menu.
//
// A full grid of bot watermelons lapping today's daily track, forever,
// as moving scenery. Nothing about it is a special case in the sim:
// it is an ordinary race whose lap count is unreachable, driven by
// ordinary bot inputs, with the local body handed to the autopilot.
// Everything downstream then behaves correctly BY CONSEQUENCE —
// checkLapCrossings never sets finishedTick, so there is no finish
// screen, no career write, no ghost save, and no rule anywhere needs
// to know the word "exhibition".
//
// WHY A MODULE AND NOT A FLAG IN flow.js: this owns a real lifecycle
// (configure a race, engage autopilot, suspend on hidden tab, resume
// on interaction, tear down cleanly), and lifecycles that live inside
// UI callbacks are where leaks and double-starts breed. One start(),
// one stop(), one authority on whether it should be stepping.
//
// BATTERY. The sim runs whenever the menu is open, which on a phone
// is a real cost. Two suspensions, both automatic:
//   * HIDDEN TAB — visibilitychange. Free and obviously correct.
//   * IDLE — after IDLE_MS with no interaction the race quietly
//     stops stepping; any touch or key resumes it. A menu left face
//     up on a table should not cook the battery for an hour.
// Suspension only pauses STEPPING; the world is untouched, so
// resuming continues exactly where it left off.
// ============================================================

const IDLE_MS = 45000;      // stop stepping after this long untouched
const FIELD_SIZE = 12;      // a full grid of watermelons

const state = {
  running: false,
  suspended: false,
  lastActivity: 0,
  hooks: null,              // { configureRace, gameState }
};

function shouldStep() {
  if (!state.running || state.suspended) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  return (now() - state.lastActivity) < IDLE_MS;
}

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function touch() {
  state.lastActivity = now();
}

// Start the exhibition. `configureRace` is supplied by main.js — the
// module that owns track providers and race setup — so this file
// never reaches into the sim's plumbing itself.
function start(hooks) {
  if (state.running) return false;
  state.hooks = hooks;
  state.running = true;
  state.suspended = false;
  touch();
  hooks.configureRace({
    track: window.FF.dailyTrackName ? window.FF.dailyTrackName() : null,
    // A full grid of the reference fruit: the background is scenery,
    // not a showcase of the roster, and a uniform field reads calmer
    // behind a panel of text.
    roster: new Array(FIELD_SIZE).fill('watermelon'),
    endless: true,
  });
  // The local body is one of the field and must not answer the stick.
  if (window.FF.autopilot) window.FF.autopilot.engage(hooks.gameState(), { netplay: false });
  return true;
}

function stop() {
  if (!state.running) return false;
  state.running = false;
  state.suspended = false;
  if (window.FF.autopilot) window.FF.autopilot.disengage();
  return true;
}

function init() {
  if (typeof document === 'undefined') return;
  // Any sign of life resets the idle clock.
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, touch, { passive: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) touch(); });
}

window.FF.exhibition = {
  init, start, stop, shouldStep, touch,
  get running() { return state.running; },
  IDLE_MS,
};
})();