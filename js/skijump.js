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
// SEEDED HILLS v2 (2026-08-26): PROFILE GRAMMAR. A hill is a
// sentence — apron, a descent of 2-4 segments with independent
// grades, then a RAMP drawn from one of three FAMILIES, then the
// cliff and the run-out. The families differ in LAUNCH MECHANISM,
// not just silhouette:
//   KICKER   — impulse launcher: one crease, speed bleed, the skill
//              is one perfectly timed pop.
//   QUARTER  — curvature launcher (mellow or steep): sustained
//              centripetal contact; where you leave the curve sets
//              your angle. Steep pipes go high and short.
//   SKIRAMP  — speed-preserving launcher: long, shallow, guiding —
//              the gradual slope-to-ramp transition; the skill
//              migrates up the hill into the tuck.
// Curves are arcs sampled fine enough that no crease can chatter the
// contact law (suite-held: per-crease turn and segment length).
// FOUR LAWS hold for EVERY seed (property-swept): the apron fits the
// grid, the lip is a true local maximum, the run-in net-descends,
// the drop is unsurvivable.
const APRON = 1600, RUNOUT = 40000;
const DEG = Math.PI / 180;
const B = {
  // THE TWO ANGLE LAWS (Eddie's ruling, 2026-08-26 — after three
  // derived-quantity fixes each stepped around the real complaint):
  //   LAW 1: the transition is ALWAYS graduated — no crease anywhere
  //     on the hill turns hard; every junction, descent joins
  //     included, is an arc. The straight-line kicker DIED here: an
  //     85-deg crease is a wall with a marketing name. The kicker is
  //     reborn as what a kicker is — a short TIGHT-RADIUS curve.
  //   LAW 2: the exit angle is capped low against the horizontal:
  //     -20 to -40 deg, every family. Distance comes from SPEED
  //     RETAINED through a smooth transition, not from angle.
  SEGS: [2, 4],             // descent segments
  RUN: [4200, 7000],        // total descent length
  GRADE: [0.18, 0.42],      // per-segment steepness
  JOIN_R: 600,              // descent-join arc radius (law 1)
  KICK_R: [280, 420],       // kicker: the tight curve (>= SLAB_T+20,
                            // the no-blades law)
  KICK_END: [-40, -30],     // the sharp pop, lawful
  Q_RADIUS: [400, 700],     // quarter-pipe family
  Q_MELLOW: [-28, -20],
  Q_STEEP: [-40, -32],
  SKI_RADIUS: [1200, 2400], // ski-ramp family
  SKI_END: [-18, -8],
  CLIMB: 330,               // ramp rise budget, px (melons walk ~27
                            // deg; height is paid in momentum)
  CLIFF: [2200, 3200],
};
function span(rng, b) { return b[0] + rng() * (b[1] - b[0]); }

// The arc verb, local until a second customer (Sumo bowls and the
// skate-park arenas will want it): append an arc of turning radius r
// from angle a0 to a1 (radians, y-down), sampled so each crease
// turns little enough to steer rather than strike.
function arcTo(cur, r, a0, a1) {
  const turn = Math.abs(a1 - a0);
  // Steps sized by TURN (<= 6 deg each) but never sub-pixel: the old
  // 8-step floor oversampled tiny join turns into ~1px steps whose
  // clamped dx distorted their angles into phantom micro-creases.
  const n = Math.max(1, Math.min(Math.ceil(turn / (6 * DEG)),
    Math.max(1, Math.floor((r * turn) / 4))));
  for (let i = 1; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const L = r * (turn / n);
    cur.slope(Math.max(1, Math.cos(a) * L), Math.sin(a) * L);
  }
}

let hill = null;
function buildHill(seed) {
  const s = (seed === undefined ? 1234 : seed) >>> 0;
  if (hill && hill.seed === s) return hill;
  const rng = window.FF.mulberry32(s);
  const Laws = window.FF.terrainLaws;
  const cur = Laws.makeCursor(-APRON, 0);
  cur.chunkKind = 'runway';
  cur.flat(APRON);
  cur.chunkKind = 'slope';
  // THE DESCENT: 2-4 segments, independent grades — steep-then-
  // shallow, shallow-then-brutal, rollers in between.
  const nSeg = Math.round(span(rng, B.SEGS));
  const RUN = span(rng, B.RUN);
  let drop = 0;
  let lastGrade = 0;
  let prevAng = 0;   // the apron is flat: the FIRST join is
                     // apron-to-descent, and it arcs like every other
                     // (the systematic 60-of-60 crease A9 convicted)
  // Segments ALTERNATE halves of the grade range (2026-08-26 proof
  // finding: independent rolls clustered mid-range and the rollers
  // never read). JOINS ARE ARCS (law 1): the grade change between
  // segments is carried by a curve, never a crease.
  const mid = (B.GRADE[0] + B.GRADE[1]) / 2;
  const firstLow = rng() < 0.5;
  for (let i = 0; i < nSeg; i++) {
    const low = (i % 2 === 0) === firstLow;
    const len = RUN / nSeg;
    lastGrade = low ? B.GRADE[0] + rng() * (mid - B.GRADE[0])
      : mid + rng() * (B.GRADE[1] - mid);
    const ang = Math.atan(lastGrade);
    arcTo(cur, B.JOIN_R, prevAng, ang);
    cur.slope(len, len * lastGrade);
    drop += len * lastGrade;
    prevAng = ang;
  }
  // THE RAMP FAMILY.
  const fam = ['KICKER', 'QUARTER', 'SKIRAMP'][(rng() * 3) | 0];
  const slopeAngle = Math.atan(lastGrade);
  let rise = 0;
  let lastEndAng = 0;
  if (fam === 'KICKER') {
    // Reborn as the TIGHT curve (law 1 killed the straight line):
    // the same sharp pop, entered through curvature, never a wall.
    const end = span(rng, B.KICK_END) * DEG;
    const climb = Math.sin(slopeAngle) + Math.sin(-end);
    const r = Math.min(span(rng, B.KICK_R), B.CLIMB / Math.max(0.05, climb));
    const y0 = cur.y;
    arcTo(cur, Math.max(280, r), slopeAngle, end);
    rise = y0 - cur.y;
    lastEndAng = end;
  } else if (fam === 'QUARTER') {
    const steep = rng() < 0.5;
    const end = span(rng, steep ? B.Q_STEEP : B.Q_MELLOW) * DEG;
    const climb = Math.sin(slopeAngle) + Math.sin(-end);
    const r = Math.min(span(rng, B.Q_RADIUS), B.CLIMB / Math.max(0.05, climb));
    const y0 = cur.y;
    arcTo(cur, r, slopeAngle, end);
    rise = y0 - cur.y;
    lastEndAng = end;
  } else {
    const end = span(rng, B.SKI_END) * DEG;
    const climb = Math.sin(slopeAngle) + Math.sin(-end);
    const r = Math.min(span(rng, B.SKI_RADIUS), B.CLIMB / Math.max(0.05, climb));
    const y0 = cur.y;
    arcTo(cur, r, slopeAngle, end);
    rise = y0 - cur.y;
    lastEndAng = end;
  }
  // THE NET-DESCENT LAW, by construction: if the ramp climbed back
  // too near the start, steepen the descent it came from (rebuild
  // with more drop) rather than shipping an unlawful hill. One
  // retry with a derived seed is deterministic and always lands:
  // the grade ceiling times the run floor clears every ramp ceiling.
  if (cur.y < 500) {
    hill = null;
    const rng2 = window.FF.mulberry32((s ^ 0x5bd1e995) >>> 0);
    return buildHillSteep(s, rng2, fam);
  }
  // THE COPING CAP (fix 2026-08-26, device: the lip was a NEEDLE —
  // ramp up at the launch angle folded straight into the cliff down
  // at ~85 deg, an included angle of ~20 deg, whose thin slab body
  // even silhouetted as a second blade). Every family now rounds the
  // lip: a tight arc from the launch angle over to the cliff angle.
  // The LIP is the cap's apex — the highest point of the arc — and
  // the metric measures from there.
  const launchAng = lastEndAng;
  const cdy = span(rng, B.CLIFF);
  const cliffAng = Math.atan2(cdy, Math.max(60, cdy / 11));
  const capStart = cur.pts.length;
  arcTo(cur, 300, launchAng, cliffAng);   // radius > SLAB_T(260): the
  // inward body offset of a tighter cap self-intersects and fills
  // as a BLADE (device: the residual spike on the cliff face)
  let lipX = cur.pts[capStart] ? cur.pts[capStart].x : cur.x;
  let lipYbest = Infinity;
  for (let i = capStart; i < cur.pts.length; i++) {
    if (cur.pts[i].y < lipYbest) { lipYbest = cur.pts[i].y; lipX = cur.pts[i].x; }
  }
  cur.chunkKind = 'slope';
  cur.slope(Math.max(60, cdy / 11), cdy);
  cur.chunkKind = 'flat';
  cur.flat(RUNOUT);
  hill = { seed: s, pts: cur.pts, lipX, family: fam };
  return hill;
}

// The lawful fallback: maximum-drop descent under the same family.
function buildHillSteep(s, rng, fam) {
  const Laws = window.FF.terrainLaws;
  const cur = Laws.makeCursor(-APRON, 0);
  cur.chunkKind = 'runway';
  cur.flat(APRON);
  cur.chunkKind = 'slope';
  const RUN = B.RUN[1];
  cur.slope(RUN, RUN * B.GRADE[1]);
  const slopeAngle = Math.atan(B.GRADE[1]);
  let launchAng = 0;
  if (fam === 'KICKER') {
    arcTo(cur, 280, slopeAngle, B.KICK_END[1] * DEG);
    launchAng = B.KICK_END[1] * DEG;
  } else if (fam === 'QUARTER') {
    arcTo(cur, B.Q_RADIUS[0], slopeAngle, B.Q_MELLOW[1] * DEG);
    launchAng = B.Q_MELLOW[1] * DEG;
  } else {
    arcTo(cur, B.SKI_RADIUS[0], slopeAngle, B.SKI_END[1] * DEG);
    launchAng = B.SKI_END[1] * DEG;
  }
  const cdy = span(rng, B.CLIFF);
  const cliffAng = Math.atan2(cdy, Math.max(60, cdy / 11));
  const capStart = cur.pts.length;
  arcTo(cur, 300, launchAng, cliffAng);   // radius > SLAB_T(260): the
  // inward body offset of a tighter cap self-intersects and fills
  // as a BLADE (device: the residual spike on the cliff face)
  let lipX = cur.pts[capStart] ? cur.pts[capStart].x : cur.x;
  let best = Infinity;
  for (let i = capStart; i < cur.pts.length; i++) {
    if (cur.pts[i].y < best) { best = cur.pts[i].y; lipX = cur.pts[i].x; }
  }
  cur.slope(Math.max(60, cdy / 11), cdy);
  cur.chunkKind = 'flat';
  cur.flat(RUNOUT);
  hill = { seed: s, pts: cur.pts, lipX, family: fam };
  return hill;
}

function provider(h) {
  return {
    period: null,
    seed: h.seed,   // race.seed adopts this: hour, sky, moon all roll
    get pts() { return h.pts; },
    polys() { return [h.pts]; },
    rev: 0,
    reset() {},
    update() {},
  };
}

// ---- The sim observer (refactor step 5, 2026-08-26) --------------
// The mark breadcrumb, migrated OUT of physics.js: same fields, same
// site (touchdown, before severity), same flight filter — now
// registered rather than hand-edited. The first customer of the
// observer sites; Lava's altitude ledger arrives the same way.
if (window.FF.registerSimObserver) {
  window.FF.registerSimObserver({
    reset(m) {
      m.skiMarkX = null;      // first-impact x of the last REAL flight
      m.skiMarkSeq = 0;       // bumps once per recorded mark
    },
    touchdown(m) {
      // A real flight is >= 30 ticks (~0.25s): rolling bumps never
      // mark. Recorded before severity: a fatal landing still marks
      // (death IS the scoring event).
      if ((m.flightTicks || 0) >= 30) {
        m.skiMarkX = m.x;
        m.skiMarkSeq = (m.skiMarkSeq || 0) + 1;
      }
    },
  });
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
  const h = buildHill(opts && opts.seed);
  window.FF.world.buildSession('Ski Jump', provider(h), {
    metric: 'skijump.dist',
    durTicks: (opts && opts.durTicks) || DUR_TICKS,
    respawnDelayTicks: CONVEYOR_TICKS,
  }, { lipX: h.lipX });
  if (window.FF.flow) window.FF.flow.go('race');
}

// (The entry pill, session watcher and results overlay — tonight's
// stated stand-ins — retired 2026-08-25: the party cup wrapper owns
// entry, leg sequencing and results now.)

window.FF.skijump = { start, _buildHill: buildHill, _provider: provider };

// THE EVENT ADAPTER: the ski jump speaks the party cup's leg
// contract. A SESSION event: over when the chassis clock ends,
// standings from the chassis ranks and the metric's own format.
if (window.FF.partycup && window.FF.partycup.registerEvent) {
  window.FF.partycup.registerEvent({
    id: 'skijump',
    start,
    isOver: (st) => !!(st && st.session && st.session.over),
    standings(st) {
      const S = window.FF.session;
      const bodies = [st.players[0].melon].concat(st.bots.map((b) => b.melon));
      const rows = bodies.map((m, i) => ({
        key: window.FF.racerKey(m),
        name: m.name || '?',
        pilot: m.pilot || '',
        isPlayer: m === st.players[0].melon,
        place: st.session.rank[i] || bodies.length,
        bestStr: S.formatBest(st, m),
      }));
      rows.sort((a, b) => a.place - b.place);
      return rows;
    },
  });
}
})();
