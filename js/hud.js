(function () {
'use strict';
// ============================================================
// HUD — reads state.telemetry + melon velocities, writes DOM text.
// Throttled: DOM writes are expensive, telemetry doesn't need 60fps.
// ============================================================

const UPDATE_INTERVAL = 1 / 10; // seconds

function createHud(state) {
  const elSpeed = document.getElementById('hud-speed');
  const elSpin = document.getElementById('hud-spin');
  const elImpact = document.getElementById('hud-impact');

  let acc = 0;

  function update(dtFrame) {
    acc += dtFrame;
    if (acc < UPDATE_INTERVAL) return;
    acc = 0;

    const m = state.melon;
    const speed = Math.hypot(m.vx, m.vy);
    elSpeed.textContent = `${(speed / 100).toFixed(1)} m/s`;
    elSpin.textContent = `${m.omega.toFixed(1)} rad/s`;

    const t = state.telemetry;
    elImpact.textContent = t.lastImpactVn === null
      ? '—'
      : `${(t.lastImpactVn / 100).toFixed(1)} m/s`;
  }

  return { update };
}

Object.assign(window.FF, { createHud });
})();
