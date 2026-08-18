// tools/proof-decals-mesh.js
// Renders proof frames for the bug-7 fix, headless: the body disc in a
// flat rind tone, one decal, through (a) the old unproject+sampleAt
// path and (b) the shipped mesh path. Writes PPMs for the PIL contact
// sheet. Not part of the game.

global.window = { FF: {} };
require('../js/decals.js');
const D = window.FF.decals;
const fs = require('fs');

const RS = 3;
const RIND = [116, 168, 92], BG = [244, 241, 232];

function render(mode, wd, a, b, out) {
  const w = Math.ceil(a * 2) + 2, h = Math.ceil(b * 2) + 2;
  const pw = Math.round(w * RS), ph = Math.round(h * RS);
  const buf = Buffer.alloc(pw * ph * 3);
  const item = D.byId(wd.id);
  const half = wd.s * b;
  const mesh = mode === 'mesh' ? D.buildStickerMesh(wd.u, wd.v, wd.rot, half, a, b) : null;
  for (let py = 0; py < ph; py++) {
    for (let pxi = 0; pxi < pw; pxi++) {
      const x = (pxi + 0.5) / RS - w / 2, y = (py + 0.5) / RS - h / 2;
      const o = (py * pw + pxi) * 3;
      let c = BG;
      if ((x / a) ** 2 + (y / b) ** 2 <= 1) {
        c = RIND;
        let q = null;
        if (mode === 'mesh') {
          q = D.meshSample(mesh, x, y);
        } else {
          const surf = D.unproject(x, y, a, b);
          if (surf) q = D.sampleAt(surf.u, surf.v, wd.u, wd.v, wd.rot, a, b);
        }
        if (q) {
          const nx = q.x / half, ny = q.y / half;
          if (Math.abs(nx) <= 1 && Math.abs(ny) <= 1) {
            const ink = D.sampleArt(item, nx, ny);
            if (ink) c = ink;
          }
        }
      }
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
    }
  }
  fs.writeFileSync(out, 'P6\n' + pw + ' ' + ph + '\n255\n');
  fs.appendFileSync(out, buf);
  console.log('wrote', out, pw + 'x' + ph);
}

const a = 128 * 1.28, b = 128;
const cases = [
  ['flag',   { id: 'flag-fr',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['wrap',   { id: 'flag-fr',  u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.6 }],
  ['ie',     { id: 'flag-ie',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['it',     { id: 'flag-it',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['de',     { id: 'flag-de',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['pl',     { id: 'flag-pl',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['jp',     { id: 'flag-jp',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['vn',     { id: 'flag-vn',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['bd',     { id: 'flag-bd',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['cn',     { id: 'flag-cn',  u: 0.9,  v: Math.PI / 2, rot: 0,    s: 0.60 }],
  ['wrapjp', { id: 'wrap-jp',  u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.0 }],
  ['wrapcn', { id: 'wrap-cn',  u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.0 }],
  ['wrapgh', { id: 'wrap-gh',  u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.0 }],
  ['wrapes', { id: 'wrap-es',  u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.0 }],
  ['wrapus', { id: 'wrap-us',  u: Math.PI / 2, v: Math.PI / 2, rot: 0, s: 2.0 }],
  ['star',  { id: 'mark-star', u: 1.05, v: Math.PI / 2, rot: 0, s: 0.40 }],
  ['eye',    { id: 'eye-googly', u: 1.0, v: 1.0,        rot: 0.3,  s: 0.13 }],
];
for (const [name, wd] of cases) {
  if (!D.byId(wd.id)) { console.log('SKIP unknown id', wd.id); continue; }
  render('old', wd, a, b, '/tmp/proof-' + name + '-old.ppm');
  render('mesh', wd, a, b, '/tmp/proof-' + name + '-mesh.ppm');
}
