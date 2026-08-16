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
//   PAN    THE GRID WALK (reworked 2026-08-15, was a terrain
//          preview). The camera sweeps the field close-up, tail to
//          pole — every racer and their decals pass through frame,
//          the pre-race athlete close-ups of sports coverage, played
//          straight at melons. It ends in a HARD CUT to normal race
//          framing on the player: cuts are broadcast grammar, and a
//          decelerating camera settling into place reads as mush. A
//          touch at any point is the same cut, earlier. The old
//          terrain preview is not missed: the READY hold is
//          indefinite at race framing, so the road ahead can be
//          studied for free until a thumb says go.
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
const COUNT_TICKS = Math.round(1.0 * HZ);  // per number: 3, 2, 1
const GO_HOLD_TICKS = Math.round(0.6 * HZ);
// The grid walk: constant speed derived from the REAL grid extent,
// clamped so a strange field can neither flash past nor drag. Zoom is
// a multiplier on the device zoom, close enough that an eye-sized
// sticker reads, not so close a melon overflows a phone.
const PAN_SPEED = 250;                     // px per second along the grid
                                           // (900 -> 450 -> 250 on feel.
                                           // Note the easing concentrates
                                           // speed mid-walk at 1.5x the
                                           // average — right where the
                                           // racers are — so equal FELT
                                           // speed needs a lower average
                                           // than the linear cut did.)
const PAN_MIN_TICKS = Math.round(1.0 * HZ);
const PAN_MAX_TICKS = Math.round(10.0 * HZ);
const PAN_ZOOM = 2.5;

const state = {
  phase: 'off',      // off | pan | ready | count | go
  startedAt: 0,      // tick the current phase began
  bodies: null,      // the bodies held on the grid
  walk: null,        // { xs, ys, from, to, ticks } — the grid walk path
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
  // The walk's path: bodies sorted along the track, swept tail ->
  // pole (builds toward the front-runners, ends on the presumptive
  // favourite, then cuts to you). Duration from the real extent —
  // never an assumption about field size. One body: the walk is a
  // brief held close-up.
  const sorted = state.bodies.slice().sort((a, b) => a.x - b.x);
  const xs = sorted.map(m => m.x), ys = sorted.map(m => m.y);
  const extent = xs[xs.length - 1] - xs[0];
  state.walk = {
    xs, ys,
    from: xs[0], to: xs[xs.length - 1],
    ticks: Math.max(PAN_MIN_TICKS,
      Math.min(PAN_MAX_TICKS, Math.round(extent / PAN_SPEED * HZ))),
  };
}

// THE CUT. One camera grammar for both exits (timeout and touch):
// dropping initialized makes the renderer snap to the follow target
// on its next frame — instant, tuning-proof, nothing decelerates.
function cutToPlayer(gameState) {
  if (gameState && gameState.camera) gameState.camera.initialized = false;
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
    cutToPlayer(gameState);
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
    // The walk completes by itself and hands over to the waiting grid.
    if (elapsed >= ((state.walk && state.walk.ticks) || PAN_MIN_TICKS)) {
      state.phase = 'ready';
      state.startedAt = gameState.tick;
      cutToPlayer(gameState);
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
// The grid-walk shot, or null when the camera belongs to the normal
// follow. An absolute pose: the shot OWNS the frame while it exists,
// so no follow lerp can fight it, and its absence IS the cut. Travel
// is EASY-EASED (ruled on feel, 2026-08-16, over the linear first
// cut): smoothstep both ends, so the walk gathers itself off the tail
// and settles onto the pole racer for a beat before the cut. Same
// ticks, same distance — easing only redistributes the speed. The
// suite verifies the VELOCITY PROFILE, not just positions: an earlier
// "easing" change silently failed to apply and every position check
// passed anyway.
function cameraShot(gameState) {
  if (state.phase !== 'pan' || !gameState || !state.walk) return null;
  const w = state.walk;
  const t = Math.min(1, (gameState.tick - state.startedAt) / w.ticks);
  const e = t * t * (3 - 2 * t);   // smoothstep: ease in, ease out
  const x = w.from + (w.to - w.from) * e;
  // y rides the bodies being passed: lerp between the two racers
  // bracketing the camera, so the shot follows the field over the
  // terrain they settled on rather than a fixed height.
  let y = w.ys[0];
  for (let i = 1; i < w.xs.length; i++) {
    if (x <= w.xs[i]) {
      const span = w.xs[i] - w.xs[i - 1];
      const f = span > 1e-9 ? (x - w.xs[i - 1]) / span : 1;
      y = w.ys[i - 1] + (w.ys[i] - w.ys[i - 1]) * f;
      break;
    }
    y = w.ys[i];
  }
  return { x, y, zoomMul: PAN_ZOOM };
}

// The word on screen, or null.
function caption(gameState) {
  if (!gameState) return null;
  const elapsed = gameState.tick - state.startedAt;
  // THE WALK IS UNCAPTIONED (ruled 2026-08-16): the prompt was sitting
  // on top of the racers the shot exists to show. A touch still skips
  // — the finger is never ignored — the invitation just waits for the
  // cut, where the READY grid says it over race framing instead.
  if (state.phase === 'pan') return null;
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
  silenceBots, cameraShot, caption,
  COUNT_TICKS, GO_HOLD_TICKS, PAN_SPEED, PAN_MIN_TICKS, PAN_MAX_TICKS, PAN_ZOOM,
};
})();