(function () {
'use strict';
// ============================================================
// AUTOPILOT — the post-flag handover.
//
// When the player crosses the finish line the race does NOT stop: the
// field keeps racing behind the results panel, and the player's own
// body is taken over so it keeps running too. The result is already
// safe — flow captures the standings at the crossing tick — so
// everything after the flag is decoration.
//
// ONE FLAG, ONE AUTHORITY. Every system that needs to behave
// differently after the flag asks this module rather than each
// re-deriving "has the race finished for me?" from race.finishedTick
// and flow.state. That is the difference between a feature and a
// scattering of special cases: when the attract-mode demo lands
// later, it engages the same switch and every suppression below
// applies for free.
//
// WHAT IT DOES:
//   * drives the player's body with a fixed NEUTRAL policy (full
//     throttle, flare centred) — deliberately the bots' own policy,
//     not the measured-superior contextual one, so the autopilot
//     never outdrives the human who just handed it the melon.
//   * declares the player "not driving", which the presentation tier
//     reads to fall silent: no death overlay, no ticker lines, no
//     smash audio, no thumbstick, no splat ring.
//
// WHAT IT MUST NOT DO:
//   * run in netplay. Peers exchange inputs; substituting local AI
//     for a player's stick desyncs the session instantly. Solo only.
//   * keep recording the ghost. A ghost that includes autopilot
//     driving would have you racing a lap you did not drive.
//
// The sim is untouched: this writes the same input fields the stick
// writes, so physics cannot tell the difference and determinism is
// unaffected.
// ============================================================

const state = { engaged: false, sinceTick: 0, driven: null };

// The neutral policy comes from the BRAIN REGISTRY now: 'cruise' is
// the one definition of "drives like a bot", so the post-flag
// autopilot, the exhibition field and every cruise bot cannot drift
// apart. Falls back to the literal values when pilot.js isn't loaded
// (headless suites that don't need it).
let cruise = null;
function policy() {
  if (!cruise && window.FF.pilot && window.FF.pilot.create) cruise = window.FF.pilot.create('cruise');
  if (cruise) {
    const cmd = cruise.drive({}, {});
    return { rawAxis: cmd.axis, rawBounce: cmd.bounce };
  }
  return { rawAxis: 1, rawBounce: 0 };
}

function engage(gameState, opts) {
  if (state.engaged) return false;
  // Netplay is non-negotiable: never substitute AI for a networked
  // player's input.
  if (opts && opts.netplay) return false;
  state.engaged = true;
  state.sinceTick = (gameState && gameState.tick) || 0;
  // Remember whose wheel we took, so it can be handed back centred.
  state.driven = gameState || null;
  // Stop the hands from reaching the wheel: pointers are cleared so a
  // tap on RETRY can't also steer, and the visible stick vanishes
  // because there is nothing to draw.
  if (window.FF.setInputEnabled) window.FF.setInputEnabled(false);
  // Freeze the ghost at the flag.
  if (window.FF.ghost && window.FF.ghost.stopRecording) window.FF.ghost.stopRecording();
  return true;
}

function disengage() {
  if (!state.engaged) return false;
  state.engaged = false;
  // HAND THE WHEEL BACK CENTRED. The autopilot drives by writing the
  // same input fields the stick writes, so releasing without clearing
  // them leaves full throttle held: the menu's exhibition would end
  // and the player's very next race would begin already accelerating
  // — indistinguishable from "a bot is driving my melon" until the
  // player touched the stick and overwrote it. Both the raw values
  // and the SMOOTHED ones, or the eased axis keeps driving for a
  // fraction of a second after the handover.
  const gs = state.driven;
  if (gs && gs.input) {
    gs.input.rawAxis = 0;
    gs.input.rawBounce = 0;
    gs.input.torqueAxis = 0;
    gs.input.bounceAxis = 0;
  }
  state.driven = null;
  if (window.FF.setInputEnabled) window.FF.setInputEnabled(true);
  return true;
}

// Called once per simulated frame, before stepping: overwrite the
// local input with the policy. Writing the same fields the stick
// writes means physics needs no knowledge of any of this.
function drive(gameState) {
  if (!state.engaged || !gameState || !gameState.input) return;
  const p = policy();
  gameState.input.rawAxis = p.rawAxis;
  gameState.input.rawBounce = p.rawBounce;
}

// The question every presentation module asks: is a human driving?
// (Phrased positively so the reading is obvious at each call site.)
function playerIsDriving() {
  return !state.engaged;
}

window.FF.autopilot = {
  engage, disengage, drive, playerIsDriving,
  get engaged() { return state.engaged; },
};
})();
