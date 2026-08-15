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
  const wantAll = ['eye-googly', 'mark-heart', 'mark-star', 'flag-fr'];
  const hasAll = wantAll.every(id => owned.indexOf(id) !== -1);
  check('A1 interim default grants the current catalogue', hasAll, owned.join(','));
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

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);