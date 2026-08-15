#!/usr/bin/env node
// ============================================================
// VERIFY-DECALS — the geometry suite for decals.js.
//
// These checks existed as throwaway `node -e` one-liners and were lost
// when a container died mid-session. They are a FILE now, because two
// of the six bugs they catch had already shipped once while looking
// like they worked.
//
// Run:  node tools/verify-decals.js
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const w = { localStorage: { setItem(){}, getItem(){ return null; }, removeItem(){} } };
const L = (f) => new Function('window', 'localStorage',
  fs.readFileSync(path.join(ROOT, f), 'utf8'))(w, w.localStorage);
['dmath.js','config.js','fruits.js','terrain.js','tracks.js','state.js','damage.js',
 'shading.js','names.js','roster.js','melon.js','decals.js'].forEach(L);
const D = w.FF.decals;

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

// ---------------------------------------------------------------
console.log('\n1. SIGNATURE — the arc-length version takes (u,v,u0,v0,rot,a,b)');
// A five-argument sampleAt is the pre-arc-length build (bug 6 present).
check('sampleAt arity is 7', D.sampleAt.length === 7, 'got ' + D.sampleAt.length);

// ---------------------------------------------------------------
console.log('\n2. PROJECTION SIGN — must agree with the renderer');
// renderer.js buildMarbleStripes: u = acos(x/a). That implies x = +a*cos(u).
// Bug 3 was a minus sign here; every decal rendered mirrored.
{
  const a = 46, b = 46 * 0.78;
  let worst = 0;
  for (const px of [-30, -10, 0, 10, 30]) {
    const s = D.unproject(px, 0, a, b);
    const p = D.project(s.u, s.v, a, b);
    worst = Math.max(worst, Math.abs(p.x - px));
  }
  check('project inverts unproject', worst < 0.01, 'worst ' + worst.toFixed(4) + 'px');
}

// ---------------------------------------------------------------
console.log('\n3. EXPONENTIAL MAP — sampleAt must BE normal coordinates');
// The strongest test. On a sphere the exponential map is closed form:
//   P(sx,sy) = p0*cos(t) + dir*sin(t),  t = |s|/R
{
  const R = 40, a = R, b = R;
  const u0 = 0.80, v0 = 1.10;
  const P = (u, v) => ({ x: Math.cos(u)*R, y: Math.cos(v)*Math.sin(u)*R, z: Math.sin(v)*Math.sin(u)*R });
  const p0 = P(u0, v0);
  const { tu, tv } = D.tangentsAt(u0, v0, a, b);
  const expMap = (sx, sy) => {
    const s = Math.hypot(sx, sy);
    if (s < 1e-9) return p0;
    const d = { x:(tu.x*sx+tv.x*sy)/s, y:(tu.y*sx+tv.y*sy)/s, z:(tu.z*sx+tv.z*sy)/s };
    const t = s / R, ct = Math.cos(t), st = Math.sin(t);
    return { x: p0.x*ct + d.x*st*R, y: p0.y*ct + d.y*st*R, z: p0.z*ct + d.z*st*R };
  };
  let worst = 0;
  for (const [sx, sy] of [[10,0],[-10,0],[0,10],[0,-10],[10,10],[-10,-10],[14,6]]) {
    const e = expMap(sx, sy);
    let best = null, bd = 1e9;
    for (let u = 0.05; u < Math.PI-0.05; u += 0.0015)
      for (let v = 0.05; v < Math.PI-0.05; v += 0.008) {
        const q = D.sampleAt(u, v, u0, v0, 0, a, b);
        const d = Math.hypot(q.x-sx, q.y-sy);
        if (d < bd) { bd = d; best = { u, v }; }
      }
    const m = P(best.u, best.v);
    worst = Math.max(worst, Math.hypot(e.x-m.x, e.y-m.y));
  }
  check('matches the exact exponential map', worst < 0.6, 'worst ' + worst.toFixed(2) + 'px');
}

// ---------------------------------------------------------------
console.log('\n4. ARC LENGTH, NOT ANGLE — a square decal must be square');
// Bug 5: measuring on the unit sphere stretched every decal by a/b.
// A reading near 1.28 means that bug is back.
{
  const a = 46, b = 46 * 0.78;
  const P = (u,v) => ({ x: Math.cos(u)*a, y: Math.cos(v)*Math.sin(u)*b, z: Math.sin(v)*Math.sin(u)*b });
  const arm = (u0, v0, dx, dy, step) => {
    let best = null, bd = 1e9;
    for (let u = 0.05; u < Math.PI-0.05; u += 0.002)
      for (let v = 0.05; v < Math.PI-0.05; v += 0.01) {
        const q = D.sampleAt(u, v, u0, v0, 0, a, b);
        const d = Math.hypot(q.x-dx*step, q.y-dy*step);
        if (d < bd) { bd = d; best = { u, v }; }
      }
    const A = P(u0, v0), B = P(best.u, best.v);
    return Math.hypot(A.x-B.x, A.y-B.y, A.z-B.z);
  };
  for (const [lab, u0, v0] of [['centre',Math.PI/2,Math.PI/2],['toward the end',0.9,Math.PI/2],['upper area',1.3,0.9]]) {
    const h = arm(u0, v0, 1, 0, 9), v2 = arm(u0, v0, 0, 1, 9);
    const r = h / v2;
    check('square at ' + lab, Math.abs(r-1) < 0.06,
      'ratio ' + r.toFixed(3) + (Math.abs(r-1.28) < 0.06 ? '  <- unit-sphere bug is BACK' : ''));
  }
}

// ---------------------------------------------------------------
console.log('\n5. ORIENTATION — art must not be mirrored or upside down');
// Bug 3 mirrors (2 reads as S), bug 4 flips (6 reads as 9, grin/frown swap).
// Tested through the ART REGISTRY, not the catalogue, so retiring an
// item from release does not silently drop its orientation check.
{
  const a = 46, b = 46 * 0.78;
  const item = D.byId('num-varsity-2');
  const u0 = Math.PI/2, v0 = Math.PI/2, half = 0.30 * b;
  const rows = [];
  for (let py = -13; py <= 13; py += 2.6) {
    let line = '';
    for (let px = -19; px <= 19; px += 1.35) {
      const s = D.unproject(px, py, a, b);
      if (!s) { line += ' '; continue; }
      const q = D.sampleAt(s.u, s.v, u0, v0, 0, a, b);
      const nx = q.x/half, ny = q.y/half;
      const c = (Math.abs(nx) <= 1 && Math.abs(ny) <= 1) ? D.sampleArt(item, nx, ny) : null;
      line += c ? (c[0] > 200 ? '#' : '+') : '.';
    }
    rows.push(line);
  }
  // A correct varsity 2: heavy bar along the BOTTOM, open at the
  // bottom-left of the diagonal. Mirrored or flipped both break this.
  const inkCount = (r) => (r.match(/[#+]/g) || []).length;
  const topRow = inkCount(rows[1] || ''), botRow = inkCount(rows[rows.length-2] || '');
  check('bottom bar heavier than top', botRow > topRow,
    'bottom ' + botRow + ' vs top ' + topRow);
  console.log('        rendered varsity "2":');
  rows.forEach(r => console.log('        ' + r));

  // grin/frown live in the art registry even when unreleased.
  const lean = (artName) => {
    let cy=0, cn=0, ey=0, en=0;
    const fn = D.ART[artName];
    for (let ny=-1; ny<=1; ny+=0.02) for (let nx=-1; nx<=1; nx+=0.02) {
      if (!fn(nx, ny)) continue;
      if (Math.abs(nx) < 0.2) { cy += ny; cn++; } else if (Math.abs(nx) > 0.6) { ey += ny; en++; }
    }
    return (cy/Math.max(1,cn)) - (ey/Math.max(1,en));
  };
  check('grin is a smile', lean('grin') > 0.2, 'centre-minus-ends ' + lean('grin').toFixed(2));
  check('frown is a frown', lean('frown') < -0.2, 'centre-minus-ends ' + lean('frown').toFixed(2));
}

console.log('\n6. CATALOGUE — every item has working art');
{
  const missing = D.ALL.filter(i => !D.ART[i.art]).map(i => i.id);
  check('all items have an art routine', missing.length === 0, missing.join(', '));
  let blank = [];
  for (const it of D.ALL) {
    let hit = 0, tot = 0;
    for (let y=-1; y<=1; y+=0.08) for (let x=-1; x<=1; x+=0.08) { tot++; if (D.sampleArt(it,x,y)) hit++; }
    const cov = hit/tot;
    if (cov < 0.02 || cov > 0.97) blank.push(it.id + ' ' + (cov*100).toFixed(0) + '%');
  }
  check('coverage sane for every item', blank.length === 0, blank.join(', '));
}

// ---------------------------------------------------------------
console.log('\n7. PLACEMENT — seeded, stable, per melon');
{
  const p1 = D.place({ seed: 12345 }, 'eye-googly', 0);
  const p2 = D.place({ seed: 12345 }, 'eye-googly', 0);
  const p3 = D.place({ seed: 999 },   'eye-googly', 0);
  check('same melon gives the same spot', p1.u === p2.u && p1.v === p2.v);
  check('different melon gives a different spot', p1.u !== p3.u);
  check('signature empty when bare', D.signature({ seed: 1 }) === '');
  check('signature set when dressed', D.signature({ seed: 1, decals: [p1] }).length > 0);
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all decal geometry checks passed') + '\n');
process.exit(failures ? 1 : 0);