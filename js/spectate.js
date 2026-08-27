// SPECTATE — the death camera for ELIMINATION play (derby stage 5,
// ruled 2026-08-26: linger -> grudge -> manual).
//
// THE LAW GATES ON PERMADEATH, NOT ON DERBY: active exactly when an
// open session's conveyor dial sits at Infinity and the player is
// dead. Any future elimination event (Lava Rises) inherits the whole
// chain for free; every conveyor mode (ski jump) and every race is
// untouched — their dead respawn, nothing to spectate.
//
// THE CHAIN:
//   LINGER  — ~1.5 s on your own wreckage (the debris makes this
//             watchable). Implemented as "no override": the follow
//             camera already points at your melon, dead or not.
//   GRUDGE  — snap to your killer, resolved by the SAME attribution
//             law the scoring uses (pair-fatal, else the breadcrumb
//             inside the assist window). An environment death has no
//             killer: fall through to the nearest living melon, so
//             the screen always lands where something still moves.
//   MANUAL  — the stick. A fresh deflection past PRESS cycles the
//             living (right = next, left = previous, canonical
//             order, wrapping); re-arm below RELEASE so a held stick
//             cycles ONCE. A fresh upward flare press snaps back to
//             the grudge anchor. The dead player's driving inputs
//             are otherwise unused — same stick on touch and keys,
//             nothing new to learn.
//
// TARGET CHANGES CUT, NEVER PAN: dropping camera.initialized is the
// renderer's own hard-cut grammar (the grid walk's exit), reused
// verbatim — a 120 m pan across the arena would be soup.
//
// Presentation tier: reads sim state and the input it mirrors,
// writes only presentation state (the camera). The sim never reads
// any of this; peers may watch different melons with no divergence
// risk (the racewatch precedent).
(function () {
'use strict';
const G = typeof window !== 'undefined' ? window : globalThis;
G.FF = G.FF || {};
const FF = G.FF;

const LINGER_TICKS = 180;   // ~1.5 s on the wreck
const PRESS = 0.5;          // a deflection this far is a press...
const RELEASE = 0.25;       // ...and must fall below this to re-arm

// Per-life machine, re-derived from state every frame — a world
// rebuild or a revive resets it by construction, nothing to unhook.
let live = null;   // { deathTick, grudgeIdx, targetIdx, manual,
                   //   axisArmed, bounceArmed, sessionRef }

function bodiesOf(state) {
  const out = [state.players[0].melon];
  for (const b of state.bots) out.push(b.melon);
  return out;
}
function prevOf(state, idx) {
  return idx === 0 ? state.players[0].prevMelon : state.bots[idx - 1].prevMelon;
}

// The grudge, by the scoring's own law (mirrored, not shared state:
// this is a camera, and it recomputes from the same breadcrumbs the
// mode read — pairSeverity is gone by the frame boundary, so the
// window alone decides here; a pair-fatal death is inside it by
// definition, its breadcrumb bearing the death tick itself).
function grudgeOf(m, deathTick, assistTicks) {
  if (m.lastContactIdx >= 0 && (deathTick - m.lastContactTick) <= assistTicks) {
    return m.lastContactIdx;
  }
  return -1;
}

function nearestAliveIdx(state, fromX) {
  const bodies = bodiesOf(state);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    if (!bodies[i].alive) continue;
    const d = Math.abs(bodies[i].x - fromX);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function cycle(state, fromIdx, dir) {
  const bodies = bodiesOf(state);
  const n = bodies.length;
  for (let step = 1; step <= n; step++) {
    const i = (fromIdx + dir * step + n * step) % n;
    if (bodies[i].alive) return i;
  }
  return fromIdx;
}

// Called by the renderer every frame, in the follow branch. Returns
// { m, p } to spectate, or null for the normal player follow.
function pose(state) {
  const s = state && state.session;
  const active = !!(s && s.respawnDelayTicks === Infinity
    && state.players && state.players[0] && !state.players[0].melon.alive);
  if (!active) { live = null; return null; }

  const me = state.players[0].melon;
  if (!live || live.sessionRef !== s) {
    live = {
      sessionRef: s,
      deathTick: state.tick,      // frame-boundary capture: a few
                                  // ticks late at worst, invisible
                                  // at camera timescales
      grudgeIdx: -1, targetIdx: -1, manual: false,
      axisArmed: false, bounceArmed: false,
    };
    const assist = (FF.derby && FF.derby.ASSIST_TICKS) || 360;
    live.grudgeIdx = grudgeOf(me, live.deathTick, assist);
    // A TRUE killer earns the wreck-watching exemption below; the
    // nearest-alive fallback does not — it was only ever "something
    // still moving", and must hop on when its subject dies (the
    // suite's B4 caught the first cut conflating the two).
    live.grudgeIsKiller = live.grudgeIdx >= 0 && !!bodiesOf(state)[live.grudgeIdx];
    if (!live.grudgeIsKiller) {
      live.grudgeIdx = nearestAliveIdx(state, me.x);
    }
  }

  // ---- MANUAL input, edge-triggered with hysteresis --------------
  const ax = (state.input && state.input.rawAxis) || 0;
  const bn = (state.input && state.input.rawBounce) || 0;
  if (Math.abs(ax) < RELEASE) live.axisArmed = true;
  if (bn < RELEASE) live.bounceArmed = true;
  let switched = false;
  if (live.axisArmed && Math.abs(ax) >= PRESS) {
    live.axisArmed = false;
    const from = live.targetIdx >= 0 ? live.targetIdx
      : (live.grudgeIdx >= 0 ? live.grudgeIdx : 0);
    live.targetIdx = cycle(state, from, ax > 0 ? 1 : -1);
    live.manual = true;
    switched = true;
  }
  if (live.bounceArmed && bn >= PRESS && live.grudgeIdx >= 0) {
    live.bounceArmed = false;
    if (live.targetIdx !== live.grudgeIdx || !live.manual) switched = true;
    live.targetIdx = live.grudgeIdx;
    live.manual = true;
  }

  // ---- The chain -------------------------------------------------
  let idx = -1;
  if (live.manual) {
    idx = live.targetIdx;
  } else if (state.tick - live.deathTick >= LINGER_TICKS) {
    if (live.targetIdx < 0 && live.grudgeIdx >= 0) {
      live.targetIdx = live.grudgeIdx;
      switched = true;
    }
    idx = live.targetIdx;
  }
  if (idx < 0) return null;                 // LINGER: the wreck
  const bodies = bodiesOf(state);
  const m = bodies[idx];
  if (!m) return null;
  // A spectated melon that dies under you: the GRUDGE target is
  // exempt — your killer's wreck IS the story (mutual head-ons make
  // this the common case). A manual choice persists too: you chose
  // it, and cycling skips the dead when you want out. Only the
  // automatic nearest-alive fallback hops onward when its subject
  // dies — that target was only ever "something still moving".
  if (!m.alive && !live.manual && !(live.grudgeIsKiller && idx === live.grudgeIdx)) {
    live.targetIdx = nearestAliveIdx(state, m.x);
    if (live.targetIdx < 0) return null;
    switched = true;
    return finish(state, live.targetIdx, switched);
  }
  return finish(state, idx, switched);
}

function finish(state, idx, switched) {
  if (switched && state.camera) state.camera.initialized = false; // HARD CUT
  return { m: bodiesOf(state)[idx], p: prevOf(state, idx), idx };
}

FF.spectate = {
  pose,
  LINGER_TICKS, PRESS, RELEASE,
  _live: () => live,
  _reset: () => { live = null; },
};
})();
