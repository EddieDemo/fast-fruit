// ============================================================
// NET — deterministic lockstep core. Transport-agnostic: it neither
// knows nor cares whether messages travel over WebRTC, WebSocket, or
// a test harness array.
//
// Model: delay-based lockstep. Each peer samples its local input for
// tick T+DELAY and broadcasts it; tick T is simulated only when every
// player's input for T has arrived. Since the sim is bit-deterministic
// (dmath + seeded everything), peers exchange ONLY inputs — one small
// message per tick per player — and stay perfectly synchronized.
// DELAY ticks of input latency (default 6 = 50ms at 120Hz) buys the
// network time; below typical friend-to-friend RTTs this is barely
// perceptible on a torque-based racer.
//
// Upgrade path (not built): rollback. The sim is cheap enough
// (~0.3ms/step) and state is plain objects, so GGPO-style rollback is
// feasible later; delay-based is chosen first for its simplicity and
// provable correctness.
// ============================================================

(function () {
'use strict';

function createLockstep(playerCount, localSlot, delay) {
  const buffers = [];
  for (let i = 0; i < playerCount; i++) buffers.push(new Map());

  const ls = {
    delay,
    localSlot,
    playerCount,
    queuedThrough: 0, // highest tick our local input has been queued for

    // Queue the local input for a future tick; returns the wire message.
    queueLocal(tick, axis) {
      buffers[localSlot].set(tick, axis);
      ls.queuedThrough = Math.max(ls.queuedThrough, tick);
      return { t: 'i', s: localSlot, k: tick, a: axis };
    },

    // Feed a remote (or relayed) input message.
    addRemote(slot, tick, axis) {
      if (slot === localSlot) return; // our own echo
      if (slot < 0 || slot >= playerCount) return;
      buffers[slot].set(tick, axis);
    },

    // Can tick T be simulated? The first DELAY ticks need no network
    // input (everyone is defined to be neutral while pipes fill).
    ready(tick) {
      if (tick <= delay) return true;
      for (let s = 0; s < playerCount; s++) {
        if (!buffers[s].has(tick)) return false;
      }
      return true;
    },

    // Inputs for tick T in canonical slot order.
    inputs(tick) {
      const out = new Array(playerCount);
      for (let s = 0; s < playerCount; s++) {
        out[s] = tick <= delay ? 0 : (buffers[s].get(tick) || 0);
      }
      return out;
    },

    // Drop history no longer needed.
    prune(tick) {
      for (const buf of buffers) {
        for (const k of buf.keys()) if (k < tick - 2) buf.delete(k);
      }
    },
  };

  return ls;
}

window.FF = window.FF || {};
window.FF.createLockstep = createLockstep;

})();
