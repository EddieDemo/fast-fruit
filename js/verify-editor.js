// verify-editor.js
// Headless checks for the edit-melon screen's PURE parts. The DOM and
// gestures themselves are hand-tested; everything that is a LAW —
// ownership, clamps, z-order, gesture maths — is verified here.
//   A. Ownership: migrate grants the interim default; grant validates
//      against the catalogue, refuses duplicates, persists, and
//      round-trips through a reload.
//   B. clampCentre: interior points untouched; exterior points pulled
//      to the rim along the ellipse-normalised radial, strictly inside.
//   C. clampScale: [S_MIN, S_MAX] with the full-coverage ceiling at 2.
//   D. handlePose: pure rotation preserves scale, pure radial drag
//      preserves rotation, and the combined case composes.
//   E. bumpToTop: last touched to slot 0, order otherwise stable,
//      idempotent at 0, non-mutating.
//   F. Placement round-trip: any clamped centre unprojects and
//      re-projects to itself (the drag law can always store what it
//      shows).

global.window = { FF: {} };
// localStorage shim for melon.js
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
require('./js/dmath.js');
require('./js/terrain.js');   // for window.FF.mulberry32 (the real one, not a shim)
require('./js/decals.js');
require('./js/melon.js');
require('./js/editor.js');

const M = window.FF.melon;
const D = window.FF.decals;
const P = window.FF.editor._pure;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

// A: ownership ---------------------------------------------------------
{
  M._load();
  const owned = M.ownedDecals();
  const wantAll = ['eye-googly', 'mark-heart', 'mark-star',
    'flag-fr', 'flag-ie', 'flag-it', 'flag-de', 'flag-pl',
    'flag-jp', 'flag-vn', 'flag-bd', 'flag-cn'];
  const hasAll = wantAll.every(id => owned.indexOf(id) !== -1);
  check('A1 interim default grants the current catalogue', hasAll, owned.join(','));
  // top-up path: a save that predates a catalogue item gets it on load
  {
    const st = JSON.parse(localStorage.getItem('ff-stable'));
    st.decals = ['eye-googly', 'mark-heart', 'mark-star', 'flag-fr'];   // yesterday's save
    localStorage.setItem('ff-stable', JSON.stringify(st));
    M._load();
    check('A1b top-up reaches existing saves',
      M.hasDecal('flag-pl') && M.hasDecal('flag-de'), M.ownedDecals().join(','));
  }
  check('A2 grant refuses unknown ids', M.grantDecal('num-varsity-2') === false);
  check('A3 grant refuses duplicates', M.grantDecal('mark-star') === false);
  // copy, not the live array
  const copy = M.ownedDecals(); copy.push('intruder');
  check('A4 ownedDecals returns a copy', M.ownedDecals().indexOf('intruder') === -1);
  // round-trip through a reload
  M._load();
  check('A5 round-trips through reload', M.hasDecal('flag-fr') && !M.hasDecal('intruder'));
}

// B: clampCentre ---------------------------------------------------------
{
  const a = 164, b = 128;
  const inPt = P.clampCentre(40, -30, a, b);
  const okIn = inPt.x === 40 && inPt.y === -30;
  const out = P.clampCentre(a * 2, b * 1.5, a, b);
  const r = Math.hypot(out.x / a, out.y / b);
  const okOut = r < 1 && Math.abs(r - 0.985) < 1e-9;
  // direction preserved
  const okDir = Math.abs(Math.atan2(out.y / b, out.x / a) - Math.atan2(1.5, 2)) < 1e-9;
  check('B clampCentre: interior fixed, exterior to rim, direction kept',
    okIn && okOut && okDir, 'r=' + r.toFixed(4));
}

// C: clampScale ------------------------------------------------------------
{
  const ok = P.clampScale(0.001) === P.S_MIN
    && P.clampScale(99) === P.S_MAX
    && P.S_MAX === 2.6
    && Math.abs(P.clampScale(0.5) - 0.5) < 1e-12;
  check('C clampScale bounds, full-coverage ceiling = 2.6', ok);
}

// D: handlePose -------------------------------------------------------------
{
  // pure rotation: same radius, quarter turn
  const r1 = P.handlePose(0.3, 0.8, { x: 10, y: 0 }, { x: 0, y: 10 });
  const okRot = Math.abs(r1.rot - (0.3 + Math.PI / 2)) < 1e-9 && Math.abs(r1.s - 0.8) < 1e-9;
  // pure scale: same heading, double radius
  const r2 = P.handlePose(0.3, 0.8, { x: 10, y: 0 }, { x: 20, y: 0 });
  const okS = Math.abs(r2.rot - 0.3) < 1e-9 && Math.abs(r2.s - 1.6) < 1e-9;
  // combined, and the ceiling engages
  const r3 = P.handlePose(0, 1.5, { x: 10, y: 0 }, { x: 0, y: 30 });
  const okC = Math.abs(r3.rot - Math.PI / 2) < 1e-9 && r3.s === P.S_MAX;
  check('D handlePose: rotation, scale, composition, ceiling', okRot && okS && okC);
}

// E: bumpToTop ---------------------------------------------------------------
{
  const w = ['a', 'b', 'c', 'd'];
  const b1 = P.bumpToTop(w, 2);
  const okMove = b1.join('') === 'cabd';
  const okStable = P.bumpToTop(w, 0) === w;          // idempotent, same ref fine
  const okNoMut = w.join('') === 'abcd';             // input untouched
  check('E bumpToTop: to front, stable rest, non-mutating', okMove && okStable && okNoMut);
}

// F: placement round-trip ------------------------------------------------------
{
  const a = 164, b = 128;
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    // deliberately include far-outside points that clamp to the rim
    const x = (i % 20 - 10) * a / 4, y = (Math.floor(i / 20) - 5) * b / 3;
    const c = P.clampCentre(x, y, a, b);
    const surf = D.unproject(c.x, c.y, a, b);
    if (!surf) { worst = 999; break; }
    const p = D.pointAt(surf.u, surf.v, a, b);
    const e = Math.hypot(p.x - c.x, p.y - c.y);
    if (e > worst) worst = e;
  }
  check('F clamped centre unprojects and re-projects to itself',
    worst < 1e-6, 'worst=' + worst.toExponential(2) + 'px');
}

// G: angle snapping ---------------------------------------------------
{
  const P2 = window.FF.editor._pure;
  const d2r = x => x * Math.PI / 180;
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  // inside the window: clicks to the detent
  const s1 = P2.snapAngle(d2r(43));
  const okIn = s1.snapped && near(s1.rot, d2r(45));
  // outside: untouched, unsnapped
  const s2 = P2.snapAngle(d2r(40));
  const okOut = !s2.snapped && near(s2.rot, d2r(40));
  // zero detent, negative side, and wrap-scale multiples
  const s3 = P2.snapAngle(d2r(-2));
  const s4 = P2.snapAngle(d2r(-92));
  const s5 = P2.snapAngle(d2r(178));
  const okEdges = s3.snapped && near(s3.rot, 0)
    && s4.snapped && near(s4.rot, d2r(-90))
    && s5.snapped && near(s5.rot, d2r(180));
  // distinct detents get distinct ids (the haptic fires per detent)
  const okIds = P2.snapAngle(d2r(45)).detent !== P2.snapAngle(d2r(90)).detent;
  check('G snapAngle: window, escape, edges, detent ids', okIn && okOut && okEdges && okIds);
}

// H: double-tap straighten ---------------------------------------------
{
  const P2 = window.FF.editor._pure;
  const d2r = x => x * Math.PI / 180;
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  const ok = near(P2.nearestCardinal(d2r(37)), 0)
    && near(P2.nearestCardinal(d2r(50)), d2r(90))
    && near(P2.nearestCardinal(d2r(-100)), d2r(-90))
    && near(P2.nearestCardinal(d2r(140)), d2r(180));
  check('H nearestCardinal straightens to quarter turns', ok);
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);