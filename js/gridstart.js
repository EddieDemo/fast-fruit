(function () {
'use strict';
// ============================================================
// GRID START — the moment before the race.
//
// THREE PHASES, and the player's touch means something different in
// each. That is the whole design: on a touch screen an input that
// does NOTHING reads as broken, so the finger is never ignored, only
// re-purposed.
//
//   PAN    the camera starts 25m up the track and travels back to
//          the grid, previewing the first hazards of terrain nobody
//          has seen before. It completes on its own; a touch during
//          it just skips ahead.
//   READY  the grid HOLDS, indefinitely, until the player plants a
//          thumb. This is the point of the whole sequence: with an
//          auto-start the player still has to choose where to put
//          their thumb AND start driving in the same instant, which
//          is exactly what the beat exists to separate. It also
//          means a race never begins without someone present — a
//          browser tab can be opened and left.
//          The press must be FRESH: a thumb still down from the last
//          race (or a rage-tap on the results screen) must not
//          launch the next one.
//          The FIELD IS SILENT until the player presses: bots hold
//          full throttle forever, so without this they would be
//          revving at a player who has not touched the screen yet.
//          The press starts everyone together.
//   COUNT  3 - 2 - 1 - GO, measured in TICKS. Bodies are pinned in x
//          AND y while on the grid: they hover half a metre up,
//          level with each other on uneven ground, and are released
//          together at GO. Rotation stays free, so a melon can still
//          rev and turn on the spot. (Pinning y is Eddie's call, to
//          try the composed-grid look against the raining-in one;
//          the free-y version made an ellipse hop on its own
//          geometry, which is worth remembering if we go back.)
//   GO     the pin releases for everyone on the same tick.
//
// WHY x IS PINNED rather than left free with a false-start rule: in
// a single-file 2D grid, a revving melon shoves the one in front of
// it over the line. A false start would punish whoever is at the
// front for someone else's revving — a per-individual injustice
// dressed up as a rule. With x pinned, revving is flavour: a noise,
// a hop, and a melon straining at the line. We are not pretending it
// is depth.
//
// TICKS, NOT WALL CLOCK. Every duration here is counted in simulated
// ticks so that peers, replays and the resume snapshot all agree on
// when GO happened — the same discipline as the rest of the sim.
//
// The SIM KEEPS RUNNING throughout: gravity settles the melons onto
// the grid and the world looks alive rather than frozen. Only x is
// held, and only until GO.
// ============================================================

const HZ = 120;
const PAN_TICKS = Math.round(1.6 * HZ);    // fixed SECONDS, not a lerp
const COUNT_TICKS = Math.round(1.0 * HZ);  // per number: 3, 2, 1
const GO_HOLD_TICKS = Math.round(0.6 * HZ);
const PAN_AHEAD_PX = 2500;                 // 25 m up the track

const state = {
  phase: 'off',      // off | pan | ready | count | go
  startedAt: 0,      // tick the current phase began
  bodies: null,      // the bodies held on the grid
  armed: false,
  // A press only arms the grid if the finger LANDED after the race
  // was built. Set false at begin(), true by the first pointerup /
  // keyup, so a held thumb has to lift and land again.
  freshPress: true,
};

function phase() { return state.phase; }

// Should the bots hold still? True through the pan and the waiting
// grid; false from the moment the countdown starts. Read by the pilot
// pass in physics.js, which is the one place bot input is written.
function silenceBots() {
  return state.phase === 'pan' || state.phase === 'ready';
}
function isHolding() {
  return state.phase === 'pan' || state.phase === 'ready' || state.phase === 'count';
}

// Begin the sequence. Called when a race is built and about to run.
function begin(gameState, opts) {
  if (!gameState) return;
  state.phase = 'pan';
  state.startedAt = gameState.tick;
  state.armed = false;
  // If a finger is already down when the race is built, it does not
  // count: it must lift and land again.
  state.freshPress = !(opts && opts.touching);
  state.bodies = [gameState.melon].concat(gameState.bots.map(b => b.melon));
  // Pin every body where it was placed on the grid.
  for (const m of state.bodies) {
    m.pinX = m.x;
    m.pinY = m.y;
  }
}

function cancel() {
  release();
  state.phase = 'off';
}

function release() {
  if (state.bodies) for (const m of state.bodies) { m.pinX = null; m.pinY = null; }
}

// A finger lifted: whatever was held before, the next press is fresh.
function noteRelease() { state.freshPress = true; }

// The player's press. During the PAN it skips ahead; on the READY
// grid it starts the countdown. Returns what it did, so a caller can
// tell a skip from a start.
function arm(gameState) {
  if (state.phase === 'pan') {
    state.phase = 'ready';
    state.startedAt = gameState.tick;
    // A single press both skips the pan AND starts the countdown, so
    // an impatient player taps once, not twice — but only if that
    // press was fresh.
    if (state.freshPress) return start(gameState) ? 'started' : 'skipped';
    return 'skipped';
  }
  if (state.phase === 'ready') return start(gameState) ? 'started' : false;
  return false;
}

function start(gameState) {
  if (state.phase !== 'ready' || !state.freshPress) return false;
  state.phase = 'count';
  state.startedAt = gameState.tick;
  state.armed = true;
  return true;
}

// Advance. Called once per simulated tick, before the step.
function update(gameState) {
  if (state.phase === 'off' || !gameState) return;
  const elapsed = gameState.tick - state.startedAt;
  if (state.phase === 'pan') {
    // The pan completes by itself and hands over to the waiting grid.
    if (elapsed >= PAN_TICKS) {
      state.phase = 'ready';
      state.startedAt = gameState.tick;
    }
    return;
  }
  if (state.phase === 'ready') return;   // waits for a thumb, forever
  if (state.phase === 'count') {
    if (elapsed >= COUNT_TICKS * 3) {
      state.phase = 'go';
      state.startedAt = gameState.tick;
      release();              // one tick, everyone
      // WHEN RACING ACTUALLY BEGAN. The pan, and a wait of any length
      // for the player's thumb, sit inside elapsed race time — so a
      // pace measured from the race's start tick is divided by dead
      // time nobody was moving through. The finish estimator needs
      // the moment the field was released, not the moment the world
      // was built.
      if (gameState.race) gameState.race.goTick = gameState.tick;
    }
    return;
  }
  if (state.phase === 'go' && elapsed >= GO_HOLD_TICKS) {
    state.phase = 'off';
  }
}

// ---- What the presentation layer needs -----------------------------
// The camera's offset up the track, easing to zero as the pan ends.
function cameraOffset(gameState) {
  if (state.phase !== 'pan' || !gameState) return 0;
  const t = Math.min(1, (gameState.tick - state.startedAt) / PAN_TICKS);
  // Ease-out: fast away from the preview, gentle into the grid.
  const e = 1 - Math.pow(1 - t, 3);
  return PAN_AHEAD_PX * (1 - e);
}

// The word on screen, or null.
function caption(gameState) {
  if (!gameState) return null;
  const elapsed = gameState.tick - state.startedAt;
  if (state.phase === 'pan') return { text: 'TOUCH TO START', kind: 'hint' };
  if (state.phase === 'ready') {
    return { text: state.freshPress ? 'TOUCH TO START' : 'LIFT, THEN TOUCH', kind: 'hint' };
  }
  if (state.phase === 'count') {
    const n = 3 - Math.floor(elapsed / COUNT_TICKS);
    return { text: String(Math.max(1, n)), kind: 'count' };
  }
  if (state.phase === 'go') return { text: 'GO', kind: 'go' };
  return null;
}

window.FF.gridStart = {
  begin, update, arm, start, noteRelease, cancel, release, phase, isHolding,
  silenceBots, cameraOffset, caption,
  PAN_TICKS, COUNT_TICKS, GO_HOLD_TICKS, PAN_AHEAD_PX,
};
})();
