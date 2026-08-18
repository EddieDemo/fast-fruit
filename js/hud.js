(function () {
'use strict';
// ============================================================
// HUD — reads state.telemetry + melon velocities, writes DOM text.
// Throttled: DOM writes are expensive, telemetry doesn't need 60fps.
// ============================================================

const { CONFIG } = window.FF;

const UPDATE_INTERVAL = 1 / 10; // seconds

// ---- THE HUD PUBLISHES ITS OWN FOOTPRINT --------------------------
// The dev lane sits beneath the HUD and the ticker sits beside it, so
// both need to know how big it is. A hard-coded guess was wrong the
// moment the cockpit toggle revealed extra telemetry rows: the HUD
// grew and the dev stack was left underneath it.
//
// Measuring is the only honest answer — the HUD knows its own size,
// so it publishes it as CSS variables and every lane resolves against
// them. Any future HUD row is handled without touching a lane rule.
function publishHudBox(el) {
  if (!el || typeof document === 'undefined') return;
  const write = () => {
    const r = el.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--hud-h', Math.round(r.height + 10) + 'px');
    root.setProperty('--hud-w', Math.round(r.width) + 'px');
  };
  write();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(write).observe(el);
  window.addEventListener('resize', write);
}

function createHud(state) {
  const elTime = document.getElementById('hud-time');
  const elDist = document.getElementById('hud-dist');
  const elSpeed = document.getElementById('hud-speed');
  const elSpin = document.getElementById('hud-spin');
  const elImpact = document.getElementById('hud-impact');
  const elBot = document.getElementById('hud-bot');
  const elLap = document.getElementById('hud-lap');
  const elLast = document.getElementById('hud-last');
  const elBest = document.getElementById('hud-best');

  let acc = 0;

  function update(dtFrame) {
    acc += dtFrame;
    if (acc < UPDATE_INTERVAL) return;
    acc = 0;

    const m = state.melon;

    const race = state.race;
    const endTick = race.finishedTick !== null ? race.finishedTick : state.tick;
    elTime.textContent = fmtTicks(endTick - state.raceStartTick);

    const dist = Math.max(0, state.spine.progressOf(m) / 100); // metres
    elDist.textContent = dist < 1000
      ? `${dist.toFixed(1)} m`
      : `${(dist / 1000).toFixed(2)} km`;

    const speed = Math.hypot(m.vx, m.vy);
    elSpeed.textContent = `${(speed / 100).toFixed(1)} m/s`;
    elSpin.textContent = `${m.omega.toFixed(1)} rad/s`;

    const t = state.telemetry;
    elImpact.textContent = t.lastImpactVn === null
      ? '—'
      : `${(t.lastImpactVn / 100).toFixed(1)} m/s @ ${t.lastImpactAngleDeg.toFixed(0)}°`;

    if (race.mode === 'track') {
      elLap.textContent = race.finishedTick !== null
        ? `${race.laps}/${race.laps} \u2713`
        : `${Math.min(Math.max(race.lapIndex, 0) + 1, race.laps)}/${race.laps}`;
      elLast.textContent = race.splits.length ? fmtTicks(race.splits[race.splits.length - 1]) : '\u2014';
      elBest.textContent = race.bestLapTicks !== null ? fmtTicks(race.bestLapTicks) : '\u2014';
    } else {
      elLap.textContent = '\u2014';
      elLast.textContent = '\u2014';
      elBest.textContent = '\u2014';
    }

    if (state.bots.length > 0) {
      let leadX = -Infinity;
      for (const b of state.bots) leadX = Math.max(leadX, b.melon.x);
      const d = (m.x - leadX) / 100; // metres vs the LEADING bot; + = winning
      elBot.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(1)} m`;
    } else {
      elBot.textContent = '—';
    }
  }

  function fmtTicks(t) {
    const secs = Math.max(0, t / CONFIG.physicsHz);
    const mins = Math.floor(secs / 60);
    const rem = secs - mins * 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem.toFixed(1)}`;
  }

  publishHudBox(document.getElementById('hud'));
  return { update };
}

Object.assign(window.FF, { createHud });
})();
