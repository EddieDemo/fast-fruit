// ============================================================
// STUDIO — the Shader Studio (development tool).
//
// A live art-direction rig: tap the palette button to swap the race
// for a black stage with a 1m grid and a single melon pinned center,
// spun with the game controls. The control panel is GENERATED from
// FF.shading.SCHEMA — add a parameter to the rig and it appears here
// automatically. Every input writes straight into FF.shading.P, which
// the renderer reads live — so the pinned melon AND the race re-light
// in real time, because they query the same rig.
//
// "Copy settings" exports P as JSON for baking into shading.js.
// ============================================================

(function () {
'use strict';

const studio = { active: false };
let cv, ctx, panel, btn;
let angle = 0.6, omega = 0;
let zoomLevel = 1.4;             // studio inspection zoom
const ZOOM_MIN = 0.4, ZOOM_MAX = 8;
let pinchDist = 0;
let studioAxis = 0; // the studio's own touch spin (its canvas eats game input)

function clampZoom(z) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

function wireZoom(el) {
  // Desktop: wheel / trackpad pinch (ctrlKey-wheel is the pinch gesture).
  el.addEventListener('wheel', (e) => {
    if (!studio.active) return;
    e.preventDefault();
    const k = e.ctrlKey ? 0.01 : 0.0022; // trackpad pinch is finer-grained
    zoomLevel = clampZoom(zoomLevel * Math.exp(-e.deltaY * k));
  }, { passive: false });
  // Mobile: two-finger pinch.
  el.addEventListener('touchstart', (e) => {
    if (!studio.active || e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchDist = Math.sqrt(dx * dx + dy * dy);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!studio.active || e.touches.length !== 2 || !pinchDist) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const d = Math.sqrt(dx * dx + dy * dy);
    zoomLevel = clampZoom(zoomLevel * (d / pinchDist));
    pinchDist = d;
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    pinchDist = 0;
    if (e.touches.length === 0) studioAxis = 0;
  });
  // Single-finger spin: left half of the screen spins left, right right.
  const setAxis = (e) => {
    if (e.touches.length !== 1) return;
    studioAxis = e.touches[0].clientX < window.innerWidth / 2 ? -1 : 1;
  };
  el.addEventListener('touchstart', setAxis, { passive: true });
  el.addEventListener('touchmove', (e) => { if (e.touches.length === 1) setAxis(e); }, { passive: true });
}
let seedIdx = 0;
const SEEDS = ['StudioMelonA', 'StudioMelonB', 'StudioMelonC', 'm12345'];
let fruitIdx = 0;
let studioColor = null; // color-picker override for the pinned melon
const FRUITS_CYCLE = ['watermelon', 'cantaloupe', 'honeydew'];

function ensureDom() {
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'studio-btn';
  btn.textContent = '\ud83c\udfa8';
  btn.title = 'Shader Studio (dev)';
  btn.addEventListener('click', toggle);
  document.body.appendChild(btn);

  panel = document.createElement('div');
  panel.id = 'studio-panel';
  panel.style.display = 'none';
  buildPanel();
  document.body.appendChild(panel);
}

function buildPanel() {
  const P = window.FF.shading.P;
  const SCHEMA = window.FF.shading.SCHEMA;
  const groups = {};
  for (const s of SCHEMA) (groups[s.group] = groups[s.group] || []).push(s);

  const head = document.createElement('div');
  head.className = 'studio-head';
  head.innerHTML = '<span>SHADER STUDIO</span>';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'copy settings';
  copyBtn.addEventListener('click', () => {
    const json = JSON.stringify(P, null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
    copyBtn.textContent = 'copied!';
    setTimeout(() => { copyBtn.textContent = 'copy settings'; }, 900);
  });
  head.appendChild(copyBtn);
  const fruitBtn = document.createElement('button');
  fruitBtn.textContent = 'fruit: watermelon';
  fruitBtn.addEventListener('click', () => {
    fruitIdx = (fruitIdx + 1) % FRUITS_CYCLE.length;
    fruitBtn.textContent = 'fruit: ' + FRUITS_CYCLE[fruitIdx];
  });
  head.appendChild(fruitBtn);
  const seedBtn = document.createElement('button');
  seedBtn.textContent = 'reroll pattern';
  seedBtn.addEventListener('click', () => { seedIdx = (seedIdx + 1) % SEEDS.length; });
  head.appendChild(seedBtn);
  const colorIn = document.createElement('input');
  colorIn.type = 'color';
  colorIn.value = '#56c516';
  colorIn.title = 'melon color';
  colorIn.addEventListener('input', () => { studioColor = colorIn.value; });
  head.appendChild(colorIn);
  const colorReset = document.createElement('button');
  colorReset.textContent = 'palette';
  colorReset.title = 'back to the species palette';
  colorReset.addEventListener('click', () => { studioColor = null; });
  head.appendChild(colorReset);
  panel.appendChild(head);

  for (const [gname, params] of Object.entries(groups)) {
    const g = document.createElement('div');
    g.className = 'studio-group';
    const t = document.createElement('div');
    t.className = 'studio-group-title';
    t.textContent = gname;
    g.appendChild(t);
    for (const s of params) {
      const row = document.createElement('label');
      row.className = 'studio-row';
      const name = document.createElement('span');
      name.textContent = s.label;
      row.appendChild(name);
      if (s.type === 'bool') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!P[s.key];
        cb.addEventListener('input', () => { P[s.key] = cb.checked; });
        row.appendChild(cb);
      } else if (s.type === 'select') {
        const sel = document.createElement('select');
        for (const opt of s.options) {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          if (P[s.key] === opt) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('input', () => { P[s.key] = sel.value; });
        row.appendChild(sel);
      } else {
        const wrap = document.createElement('span');
        wrap.className = 'studio-slider';
        const sl = document.createElement('input');
        sl.type = 'range';
        sl.min = s.min; sl.max = s.max; sl.step = s.step;
        sl.value = P[s.key];
        const val = document.createElement('span');
        val.className = 'studio-val';
        val.textContent = P[s.key];
        sl.addEventListener('input', () => {
          P[s.key] = parseFloat(sl.value);
          val.textContent = sl.value;
        });
        wrap.appendChild(sl); wrap.appendChild(val);
        row.appendChild(wrap);
      }
      g.appendChild(row);
    }
    panel.appendChild(g);
  }
}

function toggle() {
  studio.active = !studio.active;
  ensureCanvas();
  panel.style.display = studio.active ? 'block' : 'none';
  cv.style.display = studio.active ? 'block' : 'none';
  btn.classList.toggle('active', studio.active);
}

function ensureCanvas() {
  if (cv) return;
  cv = document.createElement('canvas');
  cv.id = 'studio-canvas';
  cv.style.display = 'none';
  document.body.appendChild(cv);
  ctx = cv.getContext('2d');
  wireZoom(cv);
}

// The studio frame: called by main's loop instead of the race render.
function frame(dtFrame, inputAxis) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Spin with the game controls: torque toward axis, damped.
  omega += ((inputAxis || 0) || studioAxis) * 6 * dtFrame;
  omega *= Math.max(0, 1 - 1.2 * dtFrame);
  angle += omega * dtFrame;

  // Stage: black, 1m grid.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  const zoom = zoomLevel; // pinch / wheel adjustable
  const cellPx = 100 * zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  const cx = w / 2, cy = h / 2;
  for (let gx = cx % cellPx; gx < w; gx += cellPx) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  for (let gy = cy % cellPx; gy < h; gy += cellPx) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }

  // A floor line ~0.9m under the melon so contact/cast shadows read.
  const CONFIG = window.FF.CONFIG;
  const a = CONFIG.semiMajor, b = CONFIG.semiMinor;
  const floorY = cy + (b + 90) * zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(w, floorY); ctx.stroke();

  const RIG = window.FF.shading;
  const fruit = FRUITS_CYCLE[fruitIdx];
  const key = SEEDS[seedIdx] + '|' + fruit;
  const FR = window.FF.FRUITS[fruit];
  const baseColor = studioColor || FR.bots[3];

  // Cast + contact previews (mirrors the renderer's construction).
  const hM = 0.9;
  if (RIG.P.castShadow && hM < RIG.P.castMaxM) {
    // The rig's TRUE footprint against the flat studio floor (world
    // coords centered on the melon; floor sits (b+90) below).
    const fp = RIG.castFootprint(0, 0, angle, a, b, () => b + 90);
    if (fp) {
      const fade = 1 - hM / RIG.P.castMaxM;
      const rx = fp.half * RIG.P.castStretch * zoom;
      const ry = rx * RIG.P.castFlat;
      const sxS = cx + fp.x * zoom, syS = cy + fp.y * zoom;
      ctx.save();
      ctx.fillStyle = '#000';
      if (RIG.P.castSoft) {
        ctx.globalAlpha = RIG.P.castAlpha * fade * 0.45;
        ctx.beginPath();
        ctx.ellipse(sxS, syS, rx * 1.28, ry * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = RIG.P.castAlpha * fade;
      ctx.beginPath();
      ctx.ellipse(sxS, syS, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);
  window.FF.drawMelonStandalone(ctx, angle, a, b, baseColor, key, fruit);
  ctx.restore();

  if (RIG.P.contactShadow && hM < RIG.P.contactMaxM) {
    const fade = 1 - hM / RIG.P.contactMaxM;
    const az = a * zoom, bz = b * zoom;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, az, bz, angle, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = RIG.P.contactAlpha * fade;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, cy + bz * (1 - RIG.P.contactFrac), az * 1.1, bz * RIG.P.contactFrac * 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Caption
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '400 12px "Geist Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('hold left / right to spin \u2014 pinch or scroll to zoom \u2014 edits re-light the race live', cx, h - 18);
}

window.FF = window.FF || {};
window.FF.studio = studio;
studio.frame = frame;
studio.init = ensureDom;

})();