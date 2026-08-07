// ============================================================
// DEATHS — the named-death screen + clean mode.
//
// The conversion layer: physics already computes WHY you died
// (severity source, contact curvature, impact speed), the cast gives
// the death a protagonist, and the squelch gives it a sound. This
// module turns that into the artifact people screenshot:
//
//     CATASTROPHIC NOSE LANDING
//     LIL SQUISH — 19.2 m/s
//
// Passive overlay: pointer-events none, auto-fades, never blocks the
// respawn or the racing. Presentation-only — reads state.lastDeath,
// writes DOM, the sim never looks back.
//
// CLEAN MODE: the tuning cockpit (debug panel + telemetry HUD rows)
// hides behind a "..." toggle, ON by default. Viral traffic is 95%
// people who will never open a menu; their first ten seconds should
// be melon, not instrumentation. Preference persists.
// ============================================================

(function () {
'use strict';

// ---- Death classification ----------------------------------------
// Inputs: the certificate physics writes at the kill. The curvature
// penalty (rFlat/curvR) says HOW you landed: ~1 = flat side, ~2.1 =
// square on the tip. Speed brackets pick the adjective.
const LINES = {
  noseFast: ['CATASTROPHIC NOSE LANDING', 'FULL SPEED, TIP FIRST', 'LAWN DART'],
  nose: ['NOSED IN', 'TIP-FIRST ARRIVAL', 'POINT OF FAILURE'],
  angleFast: ['ARRIVED ALL WRONG', 'BAD ANGLE, WORSE OUTCOME', 'UNSCHEDULED DISASSEMBLY'],
  angle: ['AWKWARD TOUCHDOWN', 'GEOMETRY DISAGREED'],
  flat: ['SHEER VELOCITY', 'PHYSICS-DEFYING IMPACT', 'TOO FAST FOR THIS WORLD'],
  pair: ['PULPED IN THE PACK', 'RIVAL COLLISION', 'TRAFFIC INCIDENT', 'SQUEEZED OUT'],
};

function classify(d) {
  const pool = d.byPair ? LINES.pair
    : (() => {
        const penalty = d.rFlat / Math.max(d.curvR, 0.001); // 1..~2.1
        const fast = d.vn > 1500; // > 15 m/s approach
        if (penalty > 1.75) return fast ? LINES.noseFast : LINES.nose;
        if (penalty > 1.25) return fast ? LINES.angleFast : LINES.angle;
        return LINES.flat;
      })();
  // Stable pick: same death, same line (tick-keyed, presentation-only).
  return pool[d.tick % pool.length];
}

// ---- Overlay ------------------------------------------------------
let overlay = null, titleEl = null, subEl = null;
let shownTick = -1, hideAt = 0;

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'death-overlay';
  titleEl = document.createElement('div');
  titleEl.className = 'death-title';
  subEl = document.createElement('div');
  subEl.className = 'death-sub';
  overlay.appendChild(titleEl);
  overlay.appendChild(subEl);
  document.body.appendChild(overlay);
}

function update(state) {
  const d = state.lastDeath;
  if (d && d.tick !== shownTick) {
    shownTick = d.tick;
    ensureOverlay();
    titleEl.textContent = classify(d);
    const who = d.name ? d.name.toUpperCase() : 'YOU';
    // Pair deaths: approach speed isn't the story; skip the number.
    subEl.textContent = d.byPair ? who : `${who} — ${(d.vn / 100).toFixed(1)} m/s`;
    overlay.classList.add('show');
    hideAt = performance.now() + 2200;
  }
  if (overlay && overlay.classList.contains('show') && performance.now() > hideAt) {
    overlay.classList.remove('show');
  }
}

// ---- Clean mode ---------------------------------------------------
let clean = true;
try { clean = localStorage.getItem('pf-clean') !== '0'; } catch (_) {}

function applyClean() {
  document.body.classList.toggle('clean', clean);
}

function buildToggle() {
  const btn = document.createElement('button');
  btn.id = 'cockpit-toggle';
  btn.textContent = '\u2026';
  btn.title = 'toggle cockpit';
  btn.addEventListener('click', () => {
    clean = !clean;
    try { localStorage.setItem('pf-clean', clean ? '1' : '0'); } catch (_) {}
    applyClean();
  });
  document.body.appendChild(btn);
  applyClean();
}
if (typeof document !== 'undefined' && document.body) buildToggle();

window.FF = window.FF || {};
window.FF.deaths = { update, classify };

})();
