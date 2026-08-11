(function () {
'use strict';
// ============================================================
// INPUT — translates raw device events into TWO numbers:
//   state.input.rawAxis   in [-1, +1]  (spin: left/right)
//   state.input.rawBounce in [-1, +1]  (flare: up = bouncy, down = dead)
//
// Contract: this module writes ONLY those two fields. Smoothing
// happens inside the physics step (so replays of raw input remain
// deterministic later). No physics, no rendering here.
//
// Mobile — a VIRTUAL THUMBSTICK (Eddie's Phase B, 2026-08-11): the
// touch-down point anchors a stick; deflection from the anchor is the
// input. Horizontal deflection spins (replacing the old which-side-
// of-the-screen scheme), vertical deflection sets the flare — full up
// is maximum bounciness, full down is dead rubber. Spring-return by
// construction: lift the thumb and both axes fall to neutral, which
// is what makes tempering bounce down across several landings a
// live skill rather than a settings dial. Small radius so a thumb
// roll reaches full deflection fast; per-axis deadzone with range
// rescale so neutral is easy to hold and the rim is reachable.
// Multi-touch: each pointer is its own stick; deflections sum and
// clamp (two thumbs can cancel, as before).
//
// Desktop: arrows/WASD — left/right spin, up/down flare (digital).
// ============================================================

const STICK_R = 64;   // px to full deflection
const DEADZONE = 0.16; // normalized; rescaled so the rim is reachable

function initInput(state, canvas) {
  // pointerId -> { x0, y0 } stick anchors
  const pointers = new Map();

  const hint = document.getElementById('touch-hint');
  let hintDismissed = false;
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    if (hint) hint.classList.add('hidden');
  };

  function shape(v) {
    const a = Math.abs(v);
    if (a < DEADZONE) return 0;
    const r = (a - DEADZONE) / (1 - DEADZONE);
    return Math.sign(v) * Math.min(1, r);
  }

  function recompute() {
    let ax = 0, ay = 0;
    for (const p of pointers.values()) {
      ax += shape((p.x - p.x0) / STICK_R);
      // Screen y grows DOWN; the stick's up is positive bounce.
      ay += shape(-(p.y - p.y0) / STICK_R);
    }
    const k = keyAxes();
    state.input.rawAxis = Math.max(-1, Math.min(1, ax + k.x));
    state.input.rawBounce = Math.max(-1, Math.min(1, ay + k.y));
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismissHint();
    pointers.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    recompute();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    recompute();
  });

  const release = (e) => {
    if (pointers.delete(e.pointerId)) recompute();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // Safety net: browser chrome (notifications, tab switch) can eat
  // pointerup events, leaving a stuck input. Clear on blur.
  window.addEventListener('blur', () => {
    pointers.clear();
    keys.clear();
    recompute();
  });

  // ---- Keyboard (desktop dev convenience) ----
  const keys = new Set();
  const LEFT = new Set(['ArrowLeft', 'KeyA']);
  const RIGHT = new Set(['ArrowRight', 'KeyD']);
  const UP = new Set(['ArrowUp', 'KeyW']);
  const DOWN = new Set(['ArrowDown', 'KeyS']);

  function keyAxes() {
    let x = 0, y = 0;
    for (const code of keys) {
      if (LEFT.has(code)) x -= 1;
      if (RIGHT.has(code)) x += 1;
      if (UP.has(code)) y += 1;
      if (DOWN.has(code)) y -= 1;
    }
    return {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  }

  window.addEventListener('keydown', (e) => {
    if (LEFT.has(e.code) || RIGHT.has(e.code) || UP.has(e.code) || DOWN.has(e.code)) {
      dismissHint();
      keys.add(e.code);
      recompute();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (keys.delete(e.code)) recompute();
  });
}

Object.assign(window.FF, { initInput });
})();