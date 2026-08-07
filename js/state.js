(function () {
'use strict';
// ============================================================
// STATE — the single source of truth for everything that changes.
//
// Ownership contract (who may WRITE each slice):
//   state.input   -> input.js only
//   state.melon   -> physics.js only
//   state.terrain -> level setup only (main.js for now)
//   state.bots    -> physics.js writes bot melons; main.js owns
//                    bot inputs (constant hold-right) and bot count
//   state.camera  -> renderer.js only (presentation state)
//   state.fx      -> physics writes impact events, renderer decays them
//   state.telemetry -> physics.js only; hud.js reads
//
// Renderer reads everything, writes only camera + fx decay.
// This is what keeps the sim deterministic later: replaying inputs
// against physics state alone must reproduce a run, so nothing
// presentational may feed back into the melon slice.
// ============================================================

const { CONFIG } = window.FF;

function createState() {
  const state = {
    // Simulation tick counter — becomes the replay clock in later stages.
    tick: 0,
    // Tick at which the current race began (set on respawn). The
    // stopwatch shows (tick - raceStartTick) / physicsHz: sim time,
    // not wall time, so it's deterministic and pauses with the sim.
    raceStartTick: 0,
    // World x where the current race began (set on respawn) — the
    // distance tracker measures from here, in sim space like the clock.
    raceStartX: 0,

    input: {
      rawAxis: 0,     // instantaneous intent: -1 (left), 0, +1 (right)
      torqueAxis: 0,  // smoothed axis actually applied by physics
    },

    melon: null,      // set by resetMelon
    prevMelon: null,  // previous-step snapshot for render interpolation

    // Hold-right bots: same body shape, same physics path, inputs
    // pinned to full right. Unlike the old single ghost, bots DO
    // collide — with the player and with each other.
    bots: [], // filled by resetBots: { melon, prevMelon, input }

    // Terrain is a list of polylines (arrays of {x, y} points).
    terrain: [],

    // Periodicity of the world: null in endless mode; { L, D } in
    // track mode (terrain repeats every L px across, D px down).
    // Physics uses this for minimum-image collisions; the renderer
    // uses it to draw each body at its image nearest the camera.
    period: null,

    // Race accounting (main.js writes, hud.js reads). Ticks, not
    // seconds — sim time, deterministic like everything else.
    race: {
      mode: 'endless',   // 'endless' | 'track'
      lapLengthPx: 0,
      laps: 0,
      lapIndex: 0,       // floor(distance / lapLength)
      lapStartTick: 0,
      splits: [],        // completed lap durations, in ticks
      bestLapTicks: null,
      finishedTick: null,
    },

    camera: {
      x: 0,
      y: 0,
      initialized: false,
    },

    fx: {
      squash: 0,        // 0..~0.3, visual squash amount
      squashAngle: 0,   // world angle of last impact normal
      flash: 0,         // 0..1 near-miss flash (renderer decays it)
    },

    telemetry: {
      grounded: false,
      lastImpactVn: null,       // normal speed of last landing (px/s)
      lastImpactAngleDeg: null, // major-axis vs surface misalignment (0..90°)
      lastImpactTick: -1,
    },
  };

  resetMelon(state, 0, -CONFIG.semiMinor - 200);
  return state;
}

function createBody(x, y) {
  return {
    x, y,           // center, world px (y is down)
    angle: 0,       // radians; positive = clockwise on screen
    vx: 0,
    vy: 0,
    omega: 0,       // angular velocity, rad/s
    grounded: false,// contact status from the LAST step; motor reads it

    // Smash life-cycle (physics.js owns these after creation):
    alive: true,
    respawnAtTick: 0,  // tick at which a dead body revives
    protectTick: 0,    // smash-immune until tick exceeds this
    hitSeverity: 0,    // worst terrain-contact severity this step
    pairSeverity: 0,   // worst melon-contact severity this step
  };
}

function resetMelon(state, x, y) {
  state.melon = createBody(x, y);
  state.melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
  state.prevMelon = { ...state.melon };
  state.fx.squash = 0;
  state.fx.flash = 0;
  state.telemetry.lastImpactVn = null;
  state.telemetry.lastImpactAngleDeg = null;
}

// Spawn `count` bots in a diagonal cascade up-and-behind the player
// spawn: spaced so no pair overlaps at rest, clear of the back wall,
// and they tumble down onto the runway as the race starts.
function resetBots(state, count, x, y) {
  state.bots.length = 0;
  // Horizontal spacing adapts to the pack size: the endless-mode wall
  // face sits ~420px behind spawn, and every bot must land in front of
  // it. Diagonal spacing stays >= ~95px so no pair overlaps at rest.
  const dx = Math.min(60, 370 / Math.max(count, 1));
  for (let i = 0; i < count; i++) {
    const melon = createBody(x - dx * (i + 1), y - 90 * (i + 1));
    melon.protectTick = state.tick + CONFIG.spawnProtectTicks;
    state.bots.push({
      melon,
      prevMelon: { ...melon },
      input: { rawAxis: 1, torqueAxis: 0 }, // hold right, forever
    });
  }
}

// Called at the top of every physics step so the renderer can
// interpolate between the previous and current state.
function snapshotPrev(state) {
  const m = state.melon, p = state.prevMelon;
  p.x = m.x; p.y = m.y; p.angle = m.angle;
  for (const b of state.bots) {
    const gm = b.melon, gp = b.prevMelon;
    gp.x = gm.x; gp.y = gm.y; gp.angle = gm.angle;
  }
}

Object.assign(window.FF, { createState, resetMelon, resetBots, snapshotPrev });
})();