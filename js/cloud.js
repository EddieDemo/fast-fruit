// CLOUD — the generative cloud layer (Rig S2, one go, 2026-08-24).
//
// THREE DECISIONS THIS FILE IS BUILT ON (all ruled by Eddie):
//
// 1. PAINTER, NOT FIELD. Clouds are explicit circles — the same
//    deterministic bubbles the silhouette experiments converged on —
//    painted back-to-front (top first, so lower puffs sit in front),
//    each split lit/shadow by the ONE rig. Every silhouette edge is a
//    bubble arc; every shading edge is a terminator arc (the stated
//    amendment to the arc law).
//
// 2. THE RIG IS SHARED, THE QUANTIZATION IS NOT. Smoke asks the
//    solver for a contour polygon because it redraws every frame;
//    clouds build ONCE per sky into a strip, so they evaluate the
//    same Lambert diffuse (N.L against shading.sun()) per pixel —
//    exact, headless, no canvas needed. verify-cloud-rig C-checks
//    prove the two quantizations agree on the same sphere.
//
// 3. SHADOW COLOUR IS A PALETTE MAP, NOT A SAMPLE. Every STATED sky
//    entry S gets one law-derived partner D = lit white pulled toward
//    S by P.mix, registered as a 'cloud' tone. A shadow pixel looks
//    up D from the sky entry behind it — including the checkerboard:
//    where the sky dithers S1/S2, the shadow dithers D1/D2 in the
//    same cell grid. No averaged in-between colours exist.
//
// The sky's own rulings carry over: clouds are PINNED vertically,
// scroll in world-x at a parallax rate (quantized to EVEN pixels so
// the shadow checkerboard never anti-aligns with the sky's), are
// generated WHOLE and clipped by the sky floor at draw time, and do
// NOT pass through the light column — the hour reaches them through
// the sky palette they are mapped from, and through the sun bearing
// (palette.sunDeg), exactly once each.
//
// Deterministic throughout: FNV-1a + mulberry32 on lattice integers,
// no Math.random, no Date. file:// compatible, zero dependencies.
(function () {
'use strict';
const G = typeof window !== 'undefined' ? window : globalThis;
G.FF = G.FF || {};

// ---- Tuning (the cloud bench edits these live) ----
const P = {
  tau: 0.55,      // material split, same ruled number as smoke
  mix: 0.35,      // shadow partner: effective lit pulled toward the sky entry
  litMix: 0.12,   // lit face: white pulled toward the sky's band-centre entry
  parallax: 0.15, // world-x scroll rate (quantized to even px at draw)
  band: 0.78,     // cloud band height as a share of the SCALE ANCHOR
  anchor: 90,     // register sky height (px in the 320-wide register)
                  // that the tuning was authored against. Bubble and
                  // band sizes derive from THIS, never from the
                  // buffer: an object with identity must not scale
                  // with the window it is seen through. Portrait
                  // shows the SAME clouds with more sky, not bigger
                  // ones. (The constant-encodes-its-container lesson,
                  // caught on device 2026-08-24.)
  below: 0.45,    // how far the mass centre-of-base sits below the floor
  cellK: 0.60,    // large-bubble cell size vs band height
  ax: 1.15, ay: 0.80,          // large lattice anisotropy (wind at mass level)
  r1min: 0.46, r1max: 0.62,    // large radii vs cell
  smallK: 0.30, r2min: 0.55, r2max: 0.90, // crenellation octave
  win: 0.55,      // crenellation window vs cell
  crownLo: 0.0, crownHi: 0.5,  // crenellation crown bias
  dilBase: 0.34, dilSlope: 0.50, fuse: 0.6, // base fusion / crown starvation
  covAmp: 0.58,   // coverage amplitude (composition)
  lean: 0.16,     // wind shear
  warpLam: 2.4, warpAmp: 0.42, // ONE low-frequency warp octave
  litHex: '#f6f4ed',
  stripW: 640,    // periodic strip width in cloud-x
};
const SCHEMA = [
  { key: 'tau', label: 'terminator tau', min: 0.05, max: 0.95, step: 0.01 },
  { key: 'mix', label: 'shadow mix', min: 0, max: 1, step: 0.05 },
  { key: 'litMix', label: 'lit mix', min: 0, max: 1, step: 0.02 },
  { key: 'parallax', label: 'parallax', min: 0, max: 1, step: 0.05 },
  { key: 'band', label: 'band height', min: 0.3, max: 1.2, step: 0.02 },
  { key: 'anchor', label: 'scale anchor', min: 40, max: 200, step: 2 },
  { key: 'below', label: 'base below floor', min: 0, max: 1, step: 0.05 },
  { key: 'cellK', label: 'bubble cell', min: 0.3, max: 1.2, step: 0.02 },
  { key: 'ax', label: 'cell stretch x', min: 0.6, max: 2.2, step: 0.05 },
  { key: 'ay', label: 'cell stretch y', min: 0.4, max: 1.6, step: 0.05 },
  { key: 'r1min', label: 'lobe r min', min: 0.2, max: 0.8, step: 0.02 },
  { key: 'r1max', label: 'lobe r max', min: 0.3, max: 1.0, step: 0.02 },
  { key: 'smallK', label: 'cren cell', min: 0.1, max: 0.7, step: 0.02 },
  { key: 'r2min', label: 'cren r min', min: 0.2, max: 1.0, step: 0.02 },
  { key: 'r2max', label: 'cren r max', min: 0.3, max: 1.4, step: 0.02 },
  { key: 'win', label: 'cren window', min: 0.1, max: 1.2, step: 0.05 },
  { key: 'crownLo', label: 'crown lo', min: -0.5, max: 1, step: 0.05 },
  { key: 'crownHi', label: 'crown hi', min: 0, max: 1.5, step: 0.05 },
  { key: 'dilBase', label: 'base fusion', min: 0, max: 0.8, step: 0.02 },
  { key: 'dilSlope', label: 'crown starve', min: 0, max: 1.2, step: 0.02 },
  { key: 'fuse', label: 'painter fuse', min: 0, max: 1.2, step: 0.05 },
  { key: 'covAmp', label: 'coverage amp', min: 0, max: 1.2, step: 0.02 },
  { key: 'lean', label: 'wind lean', min: -0.5, max: 0.5, step: 0.02 },
  { key: 'warpLam', label: 'warp wavelength', min: 1, max: 6, step: 0.1 },
  { key: 'warpAmp', label: 'warp amount', min: 0, max: 1.2, step: 0.02 },
];

// ---- Determinism kit (self-contained; the sky owns its own copy) ----
function fnvStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function fnvW(h, w) { return Math.imul((h ^ (w >>> 0)) >>> 0, 16777619) >>> 0; }
function mulberry(h) {
  let t = (h + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function cellRand(seed, ix, iy, salt) {
  let h = 2166136261;
  h = fnvW(h, ix | 0); h = fnvW(h, iy | 0); h = fnvW(h, seed); h = fnvW(h, salt);
  return mulberry(h);
}
function smoother(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * t * (t * (t * 6 - 15) + 10);
}
// ONE-octave gradient noise on the seeded lattice. Its only jobs are
// the low-frequency warp and the coverage term — it never touches
// edge detail (the fBm-at-the-boundary lesson).
function gnoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const dot = (ox, oy) => {
    const a = cellRand(seed, x0 + ox, y0 + oy, 7) * Math.PI * 2;
    return Math.cos(a) * (fx - ox) + Math.sin(a) * (fy - oy);
  };
  const sx = smoother(fx), sy = smoother(fy);
  const nx0 = dot(0, 0) + sx * (dot(1, 0) - dot(0, 0));
  const nx1 = dot(0, 1) + sx * (dot(1, 1) - dot(0, 1));
  return nx0 + sy * (nx1 - nx0);
}

// ---- Work counters (the S-section rule: count work, not ms) ----
const stats = { builds: 0, circles: 0, pxWrites: 0, diffuse: 0 };
function _stats() { return { builds: stats.builds, circles: stats.circles,
  pxWrites: stats.pxWrites, diffuse: stats.diffuse }; }

// ---- Circle enumeration (the approved painter, periodic in x) ----
// All positions are CLOUD-X in [0, stripW): candidates are generated
// over the strip plus a margin and wrap-duplicated so the strip tiles
// seamlessly. Identity comes from the lattice, so a circle is the
// same circle on every lap — spawned, infinite, stateless.
function circlesFor(seedStr, skyH, floorY) {
  const seed = fnvStr(seedStr);
  // SCALE from the anchor (orientation-invariant); PLACEMENT from the
  // floor. The first floor-sizing attempt made portrait clouds giant —
  // every dimension inflated with the taller buffer. The floor still
  // decides where clouds sit and where the horizon clips them; the
  // anchor decides how big a bubble is, everywhere, always.
  const bandH = P.band * P.anchor;
  const C = Math.max(16, P.cellK * bandH);
  const baseY = floorY + P.below * bandH;
  // BAND-LOCAL COORDINATES. Everything below works in `by` = height
  // relative to the BASE LINE (negative above it), and only the final
  // push translates to the buffer. The first anchoring fix left the
  // lattice pinned to buffer y=0, so a different floor sampled
  // DIFFERENT cells — new clouds, not the same clouds moved. A
  // cloud's identity now lives entirely in the band: same seed, same
  // clouds, any floor, any buffer.
  const covLam = 140 + 70 * mulberry(fnvW(fnvW(2166136261, seed), 0x99));
  const covSeed = (seed ^ 0x77) >>> 0;
  const covn = (x) => gnoise(x / covLam, 0.5, covSeed);
  const envr = (px, by) => {
    const hp = -by / bandH;
    const gate = Math.min(1, Math.max(0, (covn(px) + 0.10) / 0.30));
    const ceil = 0.30 + 0.95 * gate;
    const top = Math.min(1, Math.max(0, 1 - (hp - ceil) / 0.30));
    // BAND-TOP FADE: only the HORIZON may clip a cloud (standing
    // ruling); a crown running past the band's reach reads as a cut,
    // so radii die approaching it instead. Anchored to the band, so
    // tall buffers get more EMPTY sky above the same clouds.
    const tf = Math.min(1, Math.max(0, (1.5 - hp) / 0.25));
    return top * tf * (0.35 + 0.65 * gate);
  };
  const dil = (by) => {
    let h = -by / bandH;
    h = h < -0.4 ? -0.4 : h > 1.2 ? 1.2 : h;
    return C * (P.dilBase - P.dilSlope * h);
  };
  const octave = (cw, ch, oseed, rmin, rmax) => {
    const out = [];
    const y0 = -1.30 * bandH, y1 = 0.60 * bandH;
    const x0 = -2 * C, x1 = P.stripW + 2 * C;
    for (let iy = Math.floor(y0 / ch); iy <= Math.floor(y1 / ch); iy++) {
      for (let ix = Math.floor(x0 / cw); ix <= Math.floor(x1 / cw); ix++) {
        const jx = cellRand(oseed, ix, iy, 11);
        const jy = cellRand(oseed, ix, iy, 22);
        const rr = rmin + (rmax - rmin) * cellRand(oseed, ix, iy, 33);
        const px = (ix + jx) * cw, by = (iy + jy) * ch;
        const r = rr * envr(px, by);
        if (r >= 0.6) out.push([px, by, r]);
      }
    }
    return out;
  };
  const large = octave(P.ax * C, P.ay * C, seed, P.r1min * C, P.r1max * C);
  // Crenellation gates against SURVIVING lobes (post-fusion radii):
  // a small circle whose host lobe starved away must starve with it,
  // or it floats off as popcorn.
  const covOf = (px) => P.covAmp * C * covn(px);
  const largeAlive = [];
  for (const [px, py, r] of large) {
    const rd = r + P.fuse * dil(py) + covOf(px);
    if (rd >= 1) largeAlive.push([px, py, rd]);
  }
  const Cs = P.smallK * C;
  const smallRaw = octave(1.3 * Cs, Cs, (seed ^ 0xA5) >>> 0, P.r2min * Cs, P.r2max * Cs);
  const small = [];
  for (const [px, py, r] of smallRaw) {
    let dmin = Infinity;
    for (const [qx, qy, qr] of largeAlive) {
      const d = Math.abs(Math.hypot(px - qx, py - qy) - qr);
      if (d < dmin) dmin = d;
    }
    if (dmin > P.win * C) continue;
    const h = -py / bandH;   // band-local: py here is `by`
    const crown = smoother((h - P.crownLo) / Math.max(1e-6, P.crownHi - P.crownLo));
    const r2 = r * crown;
    if (r2 >= 0.6) small.push([px, py, r2]);
  }
  const circles = [];
  const push = (px, by, rd) => {
    // shear (wind at MASS level) + warp applied to whole centres —
    // all in band space, so warp and shear are floor-independent too.
    const lamw = P.warpLam * C, A = P.warpAmp * C;
    const sx = px + P.lean * by;
    const wx = A * gnoise(px / lamw, by / lamw, (seed ^ 0x51) >>> 0);
    const wy = A * gnoise(px / lamw + 7.31, by / lamw + 3.17, (seed ^ 0x52) >>> 0);
    let cx = sx - wx;
    const cy = baseY + by - wy;   // the ONLY translation to the buffer
    cx = ((cx % P.stripW) + P.stripW) % P.stripW;   // periodic strip
    circles.push([cx, cy, rd]);
    // wrap duplicates so circles crossing the seam tile cleanly
    if (cx < rd) circles.push([cx + P.stripW, cy, rd]);
    if (cx > P.stripW - rd) circles.push([cx - P.stripW, cy, rd]);
  };
  for (const [px, py, rd] of largeAlive) push(px, py, rd);
  for (const [px, py, r] of small) {
    if (r >= 1) push(px, py, r);   // crenellation keeps its raw radius
  }
  circles.sort((a, b) => a[1] - b[1]);  // top first: lower puffs in front
  stats.circles += circles.length;
  return circles;
}

// ---- The build: codes, then colours ----
// buildCodes is PURE and canvas-free: 0 = sky, 1 = lit, 2 = shadow.
// Per pixel inside its front-most circle, the split is the rig's own
// diffuse: n = (dx, dy, +z)/r against shading.sun() — the exact
// function whose tau-level-set sphereContour polygonizes for smoke.
// The per-pixel classifier IS the rig's diffuse law: normal of the
// front hemisphere against shading.sun(), split at P.tau. Exported as
// _litAt so verify-cloud-rig can prove it agrees with sphereContour
// (the polygon quantization smoke uses) on the same sphere.
function litAt(dx, dy, r, s) {
  const nz = Math.sqrt(Math.max(0, r * r - dx * dx - dy * dy)) / r;
  stats.diffuse++;
  const diff = (dx / r) * s.x + (dy / r) * s.y + nz * s.lz;
  return diff > P.tau ? 1 : 2;
}

function buildCodes(seedStr, skyH, floorY) {
  const SH = G.FF.shading;
  const s = SH ? SH.sun() : { x: -0.6, y: -0.6, lz: 0.5 };
  const W = P.stripW, H = skyH;
  const codes = new Uint8Array(W * H);
  const circles = circlesFor(seedStr, skyH, floorY);
  for (const [cx, cy, r] of circles) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy);
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx);
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        codes[y * W + x] = litAt(dx, dy, r, s);
        stats.pxWrites++;
      }
    }
  }
  // Pixel-art cleanup: removal-only 3x3 majority (rounds jaggies
  // without inventing pixels), then despeck of components < 14 px —
  // the same two passes the approved demo used.
  const maj = new Uint8Array(codes);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!codes[y * W + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = (x + dx + W) % W;   // periodic in x
          if (codes[yy * W + xx]) n++;
        }
      }
      if (n < 5) maj[y * W + x] = 0;
    }
  }
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!maj[i] || seen[i]) continue;
    stack.length = 0; stack.push(i); seen[i] = 1;
    const comp = [];
    while (stack.length) {
      const j = stack.pop(); comp.push(j);
      const jy = (j / W) | 0, jx = j % W;
      const nb = [jy * W + ((jx + 1) % W), jy * W + ((jx - 1 + W) % W)];
      if (jy > 0) nb.push(j - W);
      if (jy < H - 1) nb.push(j + W);
      for (const k of nb) if (maj[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    if (comp.length < 14) for (const j of comp) maj[j] = 0;
  }
  stats.builds++;
  return { w: W, h: H, codes: maj };
}

// hex mixing (build-time only)
function hexMix(fromHex, toHex, k) {
  const m = parseInt(fromHex.slice(1), 16);
  const n = parseInt(toHex.slice(1), 16);
  const c = (a, b) => Math.round(a + (b - a) * k);
  const r = c((m >> 16) & 255, (n >> 16) & 255);
  const g = c((m >> 8) & 255, (n >> 8) & 255);
  const b = c(m & 255, n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
// The EFFECTIVE lit tone for a sky: white pulled toward the stated
// entry at the cloud band's centre by P.litMix — one flat lit tone
// per sky, so MIDNIGHT clouds go dusky instead of glaring, and the
// hour still reaches the clouds only through the sky itself.
// Shadow partner of a stated sky entry: the EFFECTIVE lit pulled
// toward it by P.mix. Both are registered 'cloud' tones.
const partnerCache = new Map();
function partnerOf(hex, litEff) {
  const lit = litEff || P.litHex;
  const key = hex + '|' + P.mix + '|' + lit;
  let c = partnerCache.get(key);
  if (c) return c;
  c = hexMix(lit, hex, P.mix);
  if (partnerCache.size > 512) partnerCache.clear();
  partnerCache.set(key, c);
  if (G.FF.palette && G.FF.palette.registerTone) G.FF.palette.registerTone('cloud', c);
  return c;
}

// strip(): codes -> RGBA, coloured against the REAL sky rows so the
// shadow map (including the dither cells) is decided at build time.
function strip(spec, seedStr, skyH) {
  const sky = G.FF.sky;
  const rowsOut = sky.rows(skyH, spec);
  const floorY = sky.floorRow(skyH, spec);
  const pal = G.FF.palette;
  const SH = G.FF.shading;
  // Build under the hour's bearing — the smoke pattern.
  let save = null;
  if (SH && pal && pal.sunDeg) { save = SH.P.sunBearingDeg; SH.P.sunBearingDeg = pal.sunDeg(); }
  const { w, h, codes } = buildCodes(seedStr, skyH, floorY);
  if (save !== null) SH.P.sunBearingDeg = save;
  // Per-row sky entries (modal + checker second) for the shadow map.
  const rowHex = new Array(skyH).fill(null);
  const rowSecond = new Array(skyH).fill(null);
  const rowCell = new Array(skyH).fill(1);
  for (const rw of rowsOut) {
    for (let y = rw.y; y < rw.y + rw.h && y < skyH; y++) {
      rowHex[y] = rw.hex;
      if (rw.checker) { rowSecond[y] = rw.checker.second; rowCell[y] = rw.checker.cell || 1; }
    }
  }
  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const bandMidY = Math.max(0, Math.min(skyH - 1,
    Math.round(floorY - 0.5 * P.band * P.anchor)));
  const litEffHex = hexMix(P.litHex, rowHex[bandMidY] || P.litHex, P.litMix);
  if (pal && pal.registerTone) pal.registerTone('cloud', litEffHex);
  const lit = hexToRgb(litEffHex);
  const rgba = new Uint8ClampedArray(w * skyH * 4);
  for (let y = 0; y < Math.min(h, floorY); y++) {
    for (let x = 0; x < w; x++) {
      const code = codes[y * w + x];
      if (!code) continue;
      const i4 = (y * w + x) * 4;
      let col = lit;
      if (code === 2) {
        let hexS = rowHex[y] || P.litHex;
        if (rowSecond[y]) {
          const cell = rowCell[y];
          const sec = ((Math.floor(x / cell) & 1) === (Math.floor(y / cell) & 1));
          if (sec) hexS = rowSecond[y];
        }
        col = hexToRgb(partnerOf(hexS, litEffHex));
      }
      rgba[i4] = col[0]; rgba[i4 + 1] = col[1]; rgba[i4 + 2] = col[2]; rgba[i4 + 3] = 255;
    }
  }
  return { w, h: skyH, rgba, floorY };
}

// ---- Draw (renderer-facing; caches the built strip as a canvas) ----
let cacheKey = null, cacheCanvas = null, version = 0;
function invalidate() { version++; cacheKey = null; }
function draw(ctx, camX, width, height, spec) {
  if (!G.FF.sky || !spec || typeof document === 'undefined') return;
  const seedStr = String(spec.id || spec.role || 'sky') + '|clouds';
  const pal = G.FF.palette;
  const bearing = (pal && pal.sunDeg) ? pal.sunDeg() : -1;
  const key = seedStr + '|' + height + '|' + bearing + '|' + version;
  if (key !== cacheKey) {
    const st = strip(spec, seedStr, height);
    const cv = document.createElement('canvas');
    cv.width = st.w; cv.height = st.h;
    cv.getContext('2d').putImageData(new ImageData(st.rgba, st.w, st.h), 0, 0);
    cacheCanvas = cv; cacheKey = key;
  }
  // Parallax offset quantized to EVEN pixels: the shadow checkerboard
  // was decided against the sky's cells at build time, and the sky is
  // pinned — an odd offset would anti-align them.
  const off = ((Math.round(camX * P.parallax / 2) * 2) % P.stripW + P.stripW) % P.stripW;
  ctx.drawImage(cacheCanvas, -off, 0);
  if (off + width > P.stripW) ctx.drawImage(cacheCanvas, P.stripW - off, 0);
}

G.FF.cloud = { P, SCHEMA, circlesFor, buildCodes, strip, partnerOf, draw, _litAt: litAt,
  invalidate, _stats, _fnvStr: fnvStr, _gnoise: gnoise };
if (typeof module !== 'undefined' && module.exports) module.exports = G.FF.cloud;
})();
