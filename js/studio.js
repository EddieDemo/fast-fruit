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
// The design the player races with — published by the studio frame and
// seeded here so the game wears it from boot, not just after a visit.
studio.design = { color: null, patKey: 'StudioMelonA|watermelon', fruit: 'watermelon' };
let cv, ctx, panel, panelL, panelR, btn, tabBar;
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
const FRUITS_CYCLE = ['watermelon', 'cantaloupe', 'honeydew', 'dragonBall', 'yoshiEgg'];
let studioColor = null; // color-picker override for the pinned melon
const paletteStrips = [];
const slotSelects = [];
// Every built control, so state changes made OUTSIDE the widgets (the
// reset button, or anything else that writes P) can be pushed back
// into the DOM. Without this the sliders keep their old handles and
// silently disagree with the values actually in use.
const controls = [];
function syncControls() {
  const P = window.FF.shading.P;
  for (const c of controls) {
    if (c.type === 'dual') { c.place(); continue; }
    const v = P[c.key];
    if (c.type === 'bool') { if (c.el.checked !== !!v) c.el.checked = !!v; }
    else if (c.el.value !== String(v)) c.el.value = v;
    if (c.val) c.val.textContent = v;
  }
}
const assignSelects = [];
const ASSIGN_TARGETS = ['baseFill', 'basePat', 'shadowFill', 'shadowPat',
  'highlightFill', 'highlightPat', 'rimFill', 'rimPat'];

// Repaint the palette grid and refill the slot dropdowns whenever the
// ramp changes. The grid is TWO ROWS (A and B) by n COLUMNS, one per
// slot: endpoints are editable (numeric L/H/S with drag-scrub), the
// interpolated middles are read-only and greyed, so the interpolation
// is visible rather than implied.
function numField(key, label, readOnly, value) {
  const wrap = document.createElement('span');
  wrap.className = 'pal-field' + (readOnly ? ' ro' : '');
  const lab = document.createElement('i');
  lab.textContent = label;
  wrap.appendChild(lab);
  if (readOnly) {
    const v = document.createElement('b');
    v.textContent = Math.round(value);
    wrap.appendChild(v);
    return wrap;
  }
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = Math.round(window.FF.shading.P[key]);
  inp.addEventListener('input', () => {
    const n = parseFloat(inp.value);
    if (!isNaN(n)) window.FF.shading.P[key] = n;
  });
  // Drag-scrub: click and drag vertically to change the number, the
  // standard design-tool gesture — sliders don't fit a 70px column.
  let dragY = null, dragV = 0;
  const down = (e) => {
    dragY = (e.touches ? e.touches[0].clientY : e.clientY);
    dragV = window.FF.shading.P[key];
    e.preventDefault();
  };
  const move = (e) => {
    if (dragY === null) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const nv = Math.round(dragV + (dragY - y) * 0.5);
    window.FF.shading.P[key] = nv;
    inp.value = nv;
    e.preventDefault();
  };
  const up = () => { dragY = null; };
  inp.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  inp.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);
  wrap.appendChild(inp);
  return wrap;
}

// Which region a swatch click assigns to (click-to-assign).
let assignTarget = 'baseFill';

function refreshPalette(baseColor) {
  const RIG = window.FF.shading;
  const P = RIG.P;
  const pal = RIG.palette(baseColor);
  const n = pal.n; // always 3: shadow / base / highlight
  for (const grid of paletteStrips) {
    const sig = [baseColor, P.rampLoDL, P.rampLoDH, P.rampLoDS, P.rampHiDL,
      P.rampHiDH, P.rampHiDS, P.rampBDL, P.rampBDH, P.rampBDS, assignTarget].join(',');
    if (grid.dataset.sig === sig) continue; // nothing changed
    grid.dataset.sig = sig;
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${n}, minmax(62px, 1fr))`;
    for (const row of ['A', 'B']) {
      for (let i = 1; i <= n; i++) {
        const slot = row + i;
        const t = n === 1 ? 0 : (i - 1) / (n - 1);
        const dL = P.rampLoDL + (P.rampHiDL - P.rampLoDL) * t + (row === 'B' ? P.rampBDL : 0);
        const dH = P.rampLoDH + (P.rampHiDH - P.rampLoDH) * t + (row === 'B' ? P.rampBDH : 0);
        const dS = P.rampLoDS + (P.rampHiDS - P.rampLoDS) * t + (row === 'B' ? P.rampBDS : 0);
        const cell = document.createElement('div');
        cell.className = 'pal-cell';
        const sw = document.createElement('div');
        sw.className = 'pal-swatch';
        sw.style.background = pal[slot];
        sw.textContent = slot;
        sw.title = 'click to assign ' + slot + ' to ' + assignTarget;
        sw.addEventListener('click', () => { P[assignTarget + 'Slot'] = slot; });
        cell.appendChild(sw);
        const isStart = (i === 1), isEnd = (i === n);
        const editable = (row === 'A') && (isStart || isEnd);
        const bEdit = (row === 'B') && (isStart || isEnd);
        const fields = document.createElement('div');
        fields.className = 'pal-fields';
        if (editable) {
          fields.appendChild(numField(isStart ? 'rampLoDL' : 'rampHiDL', 'L', false));
          fields.appendChild(numField(isStart ? 'rampLoDH' : 'rampHiDH', 'H', false));
          fields.appendChild(numField(isStart ? 'rampLoDS' : 'rampHiDS', 'S', false));
        } else if (bEdit && isStart) {
          // B's editable cell edits the OFFSET FROM A, labelled as such.
          fields.appendChild(numField('rampBDL', '+L', false));
          fields.appendChild(numField('rampBDH', '+H', false));
          fields.appendChild(numField('rampBDS', '+S', false));
        } else {
          fields.appendChild(numField(null, 'L', true, dL));
          fields.appendChild(numField(null, 'H', true, dH));
          fields.appendChild(numField(null, 'S', true, dS));
        }
        cell.appendChild(fields);
        grid.appendChild(cell);
      }
    }
  }
  for (const { el, key } of slotSelects) {
    const want = pal.slots.join(',');
    if (el.dataset.opts !== want) {
      el.innerHTML = '';
      for (const k of pal.slots) {
        const o = document.createElement('option');
        o.value = k; o.textContent = k;
        el.appendChild(o);
      }
      el.dataset.opts = want;
    }
    if (el.value !== P[key]) el.value = P[key];
  }
  for (const sel of assignSelects) if (sel.value !== assignTarget) sel.value = assignTarget;
}

function ensureDom() {
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'studio-btn';
  btn.textContent = '\ud83c\udfa8';
  btn.title = 'Shader Studio (dev)';
  btn.addEventListener('click', toggle);
  document.body.appendChild(btn);

  // Two panels: colour generation on the LEFT, assignment and lighting
  // on the RIGHT. In portrait they collapse into one panel with a tab
  // switch, so the melon under judgement never loses the stage.
  panelL = document.createElement('div');
  panelL.id = 'studio-panel-left';
  panelL.className = 'studio-panel';
  panelR = document.createElement('div');
  panelR.id = 'studio-panel-right';
  panelR.className = 'studio-panel';
  panel = document.createElement('div');
  panel.id = 'studio-panels';
  panel.style.display = 'none';
  tabBar = document.createElement('div');
  tabBar.id = 'studio-tabs';
  for (const [id, label] of [['left', 'Palette'], ['right', 'Assign']]) {
    const t = document.createElement('button');
    t.textContent = label;
    t.dataset.tab = id;
    t.addEventListener('click', () => {
      panel.dataset.tab = id;
      for (const b of tabBar.children) b.classList.toggle('on', b.dataset.tab === id);
    });
    tabBar.appendChild(t);
  }
  tabBar.children[0].classList.add('on');
  panel.dataset.tab = 'left';
  panel.appendChild(tabBar);
  panel.appendChild(panelL);
  panel.appendChild(panelR);
  buildPanel();
  document.body.appendChild(panel);
}

function buildPanel() {
  const P = window.FF.shading.P;
  const SCHEMA = window.FF.shading.SCHEMA;
  const groups = {};
  for (const s of SCHEMA) {
    const gk = (s.panel || 'right') + '|' + s.group;
    (groups[gk] = groups[gk] || []).push(s);
  }

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
  const resetPal = document.createElement('button');
  resetPal.textContent = 'reset palette';
  resetPal.title = 'back to the shipped colour defaults';
  resetPal.addEventListener('click', () => {
    window.FF.shading.resetPalette();
    // Push the new values back into the widgets: sliders, their number
    // readouts, and the palette grid's editable fields.
    syncControls();
    for (const g of paletteStrips) g.dataset.sig = '';
  });
  head.appendChild(resetPal);
  const colorReset = document.createElement('button');
  colorReset.textContent = 'palette';
  colorReset.title = 'back to the species palette';
  colorReset.addEventListener('click', () => { studioColor = null; });
  head.appendChild(colorReset);
  panelL.appendChild(head);

  for (const [gk, params] of Object.entries(groups)) {
    const side = gk.split('|')[0], gname = gk.split('|')[1];
    const host = side === 'left' ? panelL : panelR;
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
        controls.push({ el: cb, key: s.key, type: 'bool' });
        row.appendChild(cb);
      } else if (s.type === 'assign') {
        const sel = document.createElement('select');
        sel.className = 'studio-slot';
        for (const t of ASSIGN_TARGETS) {
          const o = document.createElement('option');
          o.value = t; o.textContent = t;
          sel.appendChild(o);
        }
        sel.value = assignTarget;
        sel.addEventListener('input', () => { assignTarget = sel.value; });
        assignSelects.push(sel);
        row.appendChild(sel);
      } else if (s.type === 'dual') {
        // Two handles on one scale. They may CROSS: the coloured span
        // is drawn between whichever is lower and whichever is higher,
        // so an inverted ramp reads correctly instead of vanishing.
        const wrap = document.createElement('span');
        wrap.className = 'dual-wrap';
        const track = document.createElement('div');
        track.className = 'dual-track';
        const span = document.createElement('div');
        span.className = 'dual-span';
        const hLo = document.createElement('div');
        hLo.className = 'dual-h';
        const hHi = document.createElement('div');
        hHi.className = 'dual-h hi';
        track.appendChild(span); track.appendChild(hLo); track.appendChild(hHi);
        const mkNum = (key) => {
          const n = document.createElement('input');
          n.type = 'number';
          n.className = 'dual-num';
          n.min = s.min; n.max = s.max; n.step = s.step;
          n.value = P[key];
          n.addEventListener('input', () => {
            const v = parseFloat(n.value);
            if (isNaN(v)) return;
            P[key] = Math.max(s.min, Math.min(s.max, v));
            place();
          });
          return n;
        };
        const loNum = mkNum(s.lo), hiNum = mkNum(s.hi);
        const pct = (v) => ((v - s.min) / (s.max - s.min)) * 100;
        function place() {
          const a = pct(P[s.lo]), b = pct(P[s.hi]);
          hLo.style.left = a + '%';
          hHi.style.left = b + '%';
          span.style.left = Math.min(a, b) + '%';
          span.style.width = Math.abs(b - a) + '%';
          if (document.activeElement !== loNum) loNum.value = P[s.lo];
          if (document.activeElement !== hiNum) hiNum.value = P[s.hi];
        }
        let dragKey = null;
        const valueAt = (clientX) => {
          const r = track.getBoundingClientRect();
          const t = r.width ? (clientX - r.left) / r.width : 0;
          const raw = s.min + Math.max(0, Math.min(1, t)) * (s.max - s.min);
          return Math.round(raw / s.step) * s.step;
        };
        const down = (e) => {
          const x = e.touches ? e.touches[0].clientX : e.clientX;
          const v = valueAt(x);
          // Grab whichever handle is nearer in value.
          dragKey = Math.abs(v - P[s.lo]) <= Math.abs(v - P[s.hi]) ? s.lo : s.hi;
          P[dragKey] = v; place();
          e.preventDefault();
        };
        const move = (e) => {
          if (!dragKey) return;
          const x = e.touches ? e.touches[0].clientX : e.clientX;
          P[dragKey] = valueAt(x); place();
          e.preventDefault();
        };
        const up = () => { dragKey = null; };
        track.addEventListener('mousedown', down);
        track.addEventListener('touchstart', down, { passive: false });
        window.addEventListener('mousemove', move);
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        wrap.appendChild(loNum); wrap.appendChild(track); wrap.appendChild(hiNum);
        row.appendChild(wrap);
        controls.push({ type: 'dual', place });
        place();
      } else if (s.type === 'palette') {
        // Live swatch strip: the actual generated colours, rendered
        // against the melon currently on the stage — dropdowns of
        // invisible colours would be useless.
        row.classList.add('studio-row-wide');
        const grid = document.createElement('div');
        grid.className = 'pal-grid';
        row.appendChild(grid);
        paletteStrips.push(grid);
      } else if (s.type === 'slot') {
        const sel = document.createElement('select');
        sel.className = 'studio-slot';
        slotSelects.push({ el: sel, key: s.key });
        sel.addEventListener('input', () => { P[s.key] = sel.value; });
        row.appendChild(sel);
      } else if (s.type === 'color') {
        // '' means DERIVE from the melon's own seeded colour; the swatch
        // sets an explicit override, and 'auto' clears it again.
        const wrap = document.createElement('span');
        wrap.className = 'studio-slider';
        const ci = document.createElement('input');
        ci.type = 'color';
        ci.value = P[s.key] || '#888888';
        ci.addEventListener('input', () => { P[s.key] = ci.value; });
        const clr = document.createElement('button');
        clr.textContent = 'auto';
        clr.addEventListener('click', () => { P[s.key] = ''; });
        wrap.appendChild(ci); wrap.appendChild(clr);
        row.appendChild(wrap);
      } else if (s.type === 'select') {
        const sel = document.createElement('select');
        for (const opt of s.options) {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          if (P[s.key] === opt) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('input', () => { P[s.key] = sel.value; });
        controls.push({ el: sel, key: s.key, type: 'select' });
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
        controls.push({ el: sl, key: s.key, type: 'range', val });
        wrap.appendChild(sl); wrap.appendChild(val);
        row.appendChild(wrap);
      }
      g.appendChild(row);
    }
    host.appendChild(g);
  }
}

function toggle() {
  studio.active = !studio.active;
  ensureCanvas();
  panel.style.display = studio.active ? 'flex' : 'none';
  if (studio.active) syncControls(); // widgets match reality on open
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
  refreshPalette(baseColor);
  // Publish the design so the RACE player wears exactly what's on the
  // stage: same species, same base colour, same rind pattern.
  studio.design = { color: baseColor, patKey: key, fruit };

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
