// SKI JUMP — the open-session chassis's first customer (2026-08-25).
//
// All melons spawn together at the top of a long downslope into a
// kicker over an unsurvivable drop. Splat as far right as possible;
// instant respawn (the conveyor); unlimited attempts inside the time
// limit; tags rank CURRENT BEST DISTANCE. The mark is the FIRST
// IMPACT point of a real flight (ruled) — recorded by physics at the
// touchdown site, fatal or not.
//
// SEPARATION: this module owns the HILL (a pure provider), the METRIC
// (a session adapter), and its own entry/results presentation. It
// never touches main's internals (the startSession door), never steps
// the sim, and the sim never reads it.
(function () {
'use strict';
if (typeof window === 'undefined') return;
window.FF = window.FF || {};

// ---- The hill (authored, deterministic, built once) --------------
// Shape (px; 100 px = 1 m):
//   apron 1600 flat        — the grid's start straight
//   downslope 5200, -1560  — the run-in (30%): tuck to carry speed
//   kicker 300, +130       — the lip: hop here for extra pop
//   cliff 240, -2600       — the drop; the run-out is 26 m below
//   run-out 40000 flat     — where marks land; far enough for heroes
const APRON = 1600, RUN = 5200, DROP = 1560, KICK = 300, KRISE = 130;
const CLIFF_DX = 240, CLIFF_DY = 2600, RUNOUT = 40000;

let hill = null;
function buildHill() {
  if (hill) return hill;
  const Laws = window.FF.terrainLaws;
  const cur = Laws.makeCursor(-APRON, 0);
  cur.chunkKind = 'runway';
  cur.flat(APRON);
  cur.chunkKind = 'slope';
  cur.slope(RUN, DROP);
  cur.slope(KICK, -KRISE);        // the kicker rises to the lip
  cur.slope(CLIFF_DX, CLIFF_DY);  // the drop
  cur.chunkKind = 'flat';
  cur.flat(RUNOUT);
  hill = { pts: cur.pts, lipX: RUN + KICK };
  return hill;
}

function provider() {
  const h = buildHill();
  return {
    period: null,
    get pts() { return h.pts; },
    polys() { return [h.pts]; },
    rev: 0,
    reset() {},
    update() {},
  };
}

// ---- The metric --------------------------------------------------
// Distance in metres from the LIP to the first-impact mark. Marks
// behind the lip (a tumble on the run-in) score nothing: the event
// measures flight off the kicker, not stumbles down the hill.
window.FF.session.registerMetric({
  id: 'skijump.dist',
  label: 'DISTANCE',
  better: (a, b) => a > b,
  sample(state, m) {
    if (!m.skiMarkSeq || m.skiMarkX === null) return null;
    const v = (m.skiMarkX - (state.session.lipX || 0)) / 100;
    return v > 0 ? Math.round(v * 10) / 10 : null;
  },
  format: (v) => v.toFixed(1) + 'm',
});

// ---- Entry -------------------------------------------------------
const DUR_TICKS = 3 * 60 * 120;      // solo default; the party cup
const CONVEYOR_TICKS = 45;           // passes its own 2-minute law.

function start(opts) {
  window.FF.startSession('Ski Jump', provider(), {
    metric: 'skijump.dist',
    durTicks: (opts && opts.durTicks) || DUR_TICKS,
    respawnDelayTicks: CONVEYOR_TICKS,
  }, { lipX: buildHill().lipX });
  if (window.FF.flow) window.FF.flow.go('race');
}

// (The entry pill, session watcher and results overlay — tonight's
// stated stand-ins — retired 2026-08-25: the party cup wrapper owns
// entry, leg sequencing and results now.)

window.FF.skijump = { start, _buildHill: buildHill, _provider: provider };
})();
