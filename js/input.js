(function () {
'use strict';
// ============================================================
// INPUT — translates raw device events into one number:
// state.input.rawAxis ∈ {-1, 0, +1}.
//
// Contract: this module writes ONLY state.input.rawAxis. Smoothing
// happens inside the physics step (so replays of raw input remain
// deterministic later). No physics, no rendering here.
//
// Mobile: hold left half of the screen to spin left, right half to
// spin right. Multi-touch is supported — if both halves are held,
// the axes cancel (a usable "steady" input, and it never fights).
// Desktop: ←/→ or A/D.
// ============================================================

function initInput(state, canvas) {
  // Track every active pointer so multi-touch resolves correctly.
  const pointers = new Map(); // pointerId -> -1 | +1

  const hint = document.getElementById('touch-hint');
  let hintDismissed = false;
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    hint.classList.add('hidden');
  };

  function recompute() {
    let axis = 0;
    for (const side of pointers.values()) axis += side;
    // Combine touch with keyboard; clamp to [-1, 1].
    axis += keyAxis();
    state.input.rawAxis = Math.max(-1, Math.min(1, axis));
  }

  function sideFor(clientX) {
    return clientX < window.innerWidth / 2 ? -1 : 1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismissHint();
    pointers.set(e.pointerId, sideFor(e.clientX));
    recompute();
  });

  canvas.addEventListener('pointermove', (e) => {
    // Allow a held thumb to slide across the midline and change sides.
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, sideFor(e.clientX));
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

  function keyAxis() {
    let axis = 0;
    for (const code of keys) {
      if (LEFT.has(code)) axis -= 1;
      if (RIGHT.has(code)) axis += 1;
    }
    return Math.max(-1, Math.min(1, axis));
  }

  window.addEventListener('keydown', (e) => {
    if (LEFT.has(e.code) || RIGHT.has(e.code)) {
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
