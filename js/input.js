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
// CIRCULAR GAMUT (Eddie's ratification, 2026-08-11): the stick's
// output vector is capped at magnitude 1 — the ring IS the boundary.
// Deadzone and shaping apply to the RADIAL magnitude, direction is
// preserved. Consequence, by design: full flare and full spin cannot
// be held simultaneously; the diagonal buys ~70% of each. The stick
// is a BUDGET — mid-air you spend it on orientation, on armour, or
// split — which is the anti-degeneracy mechanism that keeps
// corner-parking from beating actual play. Keyboard diagonals
// normalize the same way.
//
// Desktop: arrows/WASD — left/right spin, up/down flare (digital).
// ============================================================

const STICK_R = 64;   // px to full deflection
const DEADZONE = 0.16; // normalized; rescaled so the rim is reachable

function initInput(state, canvas) {
  // pointerId -> { x0, y0, x, y, t0 } stick anchors
  const pointers = new Map();
  let enabled = true;
  // Recently released sticks, kept briefly so the renderer can fade
  // them out (pruned in getInputSticks). Presentation data only.
  const fading = [];

  const hint = document.getElementById('touch-hint');
  let hintDismissed = false;
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    if (hint) hint.classList.add('hidden');
  };

  // Radial shaping: deadzone + rescale on the vector MAGNITUDE,
  // clamped at the ring; direction untouched. Returns [ax, ay] with
  // |(ax, ay)| <= 1 (screen y down -> stick up is positive bounce).
  function shapeVec(dx, dy) {
    const d = Math.hypot(dx, dy) / STICK_R;
    if (d < DEADZONE) return [0, 0];
    const mag = Math.min(1, (d - DEADZONE) / (1 - DEADZONE));
    const inv = mag / (d * STICK_R);
    return [dx * inv, -dy * inv];
  }

  function recompute() {
    if (!enabled) return;
    let ax = 0, ay = 0;
    for (const p of pointers.values()) {
      const v = shapeVec(p.x - p.x0, p.y - p.y0);
      ax += v[0]; ay += v[1];
    }
    const k = keyAxes();
    ax += k.x; ay += k.y;
    // Sum of sticks + keys can exceed the gamut: clamp RADIALLY, so
    // the circular contract |(axis, bounce)| <= 1 holds whatever the
    // input combination.
    const mag = Math.hypot(ax, ay);
    if (mag > 1) { ax /= mag; ay /= mag; }
    state.input.rawAxis = ax;
    state.input.rawBounce = ay;
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismissHint();
    pointers.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() });
    recompute();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    recompute();
  });

  const release = (e) => {
    const p = pointers.get(e.pointerId);
    if (p) {
      pointers.delete(e.pointerId);
      p.tUp = performance.now();
      fading.push(p);
      recompute();
    }
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
    // Normalize keyboard diagonals into the circular gamut too.
    const mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; }
    return { x, y };
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

  // ---- Presentation window into the stick (renderer-facing) ----
  // The VISIBLE thumbstick draws whatever the input code is actually
  // doing: same anchors, same deadzone shaping, nothing simulated.
  // Returns every live stick plus recently released ones (for the
  // fade-out), each with its raw thumb offset and SHAPED axes.
  // Strictly presentation-tier: the sim never reads this.
  // The autopilot takes the wheel by turning this off: pointers are
  // dropped (so a tap on a results button can't steer), the axes fall
  // to neutral, and getInputSticks reports nothing so the visible
  // stick disappears with it. One switch, three consequences.
  window.FF.setInputEnabled = function (on) {
    enabled = !!on;
    if (!enabled) {
      pointers.clear();
      keys.clear();
      fading.length = 0;
      state.input.rawAxis = 0;
      state.input.rawBounce = 0;
    }
  };

  window.FF.getInputSticks = function (now) {
    if (!enabled) return [];
    for (let i = fading.length - 1; i >= 0; i--) {
      if (now - fading[i].tUp > 300) fading.splice(i, 1);
    }
    const out = [];
    const emit = (p) => {
      out.push({
        x0: p.x0, y0: p.y0,
        dx: p.x - p.x0, dy: p.y - p.y0,
        ax: shapeVec(p.x - p.x0, p.y - p.y0)[0],
        ay: shapeVec(p.x - p.x0, p.y - p.y0)[1],
        ageDown: now - p.t0,
        ageUp: p.tUp === undefined ? null : now - p.tUp,
      });
    };
    for (const p of pointers.values()) emit(p);
    for (const p of fading) emit(p);
    return out;
  };
}

Object.assign(window.FF, { initInput });
})();
