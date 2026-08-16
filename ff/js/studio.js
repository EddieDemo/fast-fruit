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

// The stage's default pigment: YOUR persistent seed pushed through
// the staged species' anchor band — the studio shows the individual
// you actually race as, not a fixed list entry.
function stageAnchor(fruit) {
  const seed = (window.FF.melon && window.FF.melon.active().seed) || 0xB07;
  return window.FF.shading.anchorColor(fruit, seed >>> 0);
}

const studio = { active: false };
// The design the player races with. Derived from the SAME selections
// the stage uses, and published eagerly at load — not only from the
// studio's frame loop, or the melon wears a different colour until the
// studio has been opened once.
function currentDesign() {
  const fruit = FRUITS_CYCLE[fruitIdx];
  const F = window.FF.FRUITS && window.FF.FRUITS[fruit];
  return {
    color: studioColor || stageAnchor(fruit),
    patKey: SEEDS[seedIdx] + '|' + fruit,
    fruit,
  };
}
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
// `key` is either a P key (string) or a {get, set} accessor — the
// latter lets the B cell edit a SPECIES' patternOffset (fruits.js
// data) with the identical widget, so the grid always edits whatever
// the stage actually renders with.
function numField(key, label, readOnly, value) {
  const getV = () => (typeof key === 'string' ? window.FF.shading.P[key] : key.get());
  const setV = (v) => { if (typeof key === 'string') window.FF.shading.P[key] = v; else key.set(v); };
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
  inp.value = Math.round(getV());
  inp.addEventListener('input', () => {
    const n = parseFloat(inp.value);
    if (!isNaN(n)) setV(n);
  });
  // Drag-scrub: click and drag vertically to change the number, the
  // standard design-tool gesture — sliders don't fit a 70px column.
  let dragY = null, dragV = 0;
  const down = (e) => {
    dragY = (e.touches ? e.touches[0].clientY : e.clientY);
    dragV = getV();
    e.preventDefault();
  };
  const move = (e) => {
    if (dragY === null) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const nv = Math.round(dragV + (dragY - y) * 0.5);
    setV(nv);
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

function refreshPalette(baseColor, fruit) {
  const RIG = window.FF.shading;
  const P = RIG.P;
  // The grid shows the RESOLVED palette of the fruit on stage —
  // species pattern offset included — so what the swatches say and
  // what the stage renders can never disagree again.
  const F = window.FF.FRUITS && window.FF.FRUITS[fruit];
  const spOff = (F && F.patternOffset) || null;
  const off = spOff || { dL: P.rampBDL, dH: P.rampBDH, dS: P.rampBDS };
  const pal = RIG.palette(baseColor, spOff);
  const n = pal.n; // always 3: shadow / base / highlight
  for (const grid of paletteStrips) {
    const sig = [baseColor, fruit, P.rampLoDL, P.rampLoDH, P.rampLoDS, P.rampHiDL,
      P.rampHiDH, P.rampHiDS, off.dL, off.dH, off.dS, assignTarget].join(',');
    if (grid.dataset.sig === sig) continue; // nothing changed
    grid.dataset.sig = sig;
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${n}, minmax(62px, 1fr))`;
    for (const row of ['A', 'B']) {
      for (let i = 1; i <= n; i++) {
        const slot = row + i;
        const t = n === 1 ? 0 : (i - 1) / (n - 1);
        // One law, both rows: the deltas are the SAME curve — B differs
        // only by which anchor it shades (base + the offset below).
        const dL = P.rampLoDL + (P.rampHiDL - P.rampLoDL) * t;
        const dH = P.rampLoDH + (P.rampHiDH - P.rampLoDH) * t;
        const dS = P.rampLoDS + (P.rampHiDS - P.rampLoDS) * t;
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
          // B's editable cell edits the PATTERN-ANCHOR OFFSET — and it
          // targets whatever the stage renders with: the species' own
          // patternOffset when it has one (live-mutating the FRUITS
          // entry; 'copy settings' exports it for committing), else the
          // shared default in P.
          const acc = (k) => spOff
            ? { get: () => spOff[k], set: (v) => { spOff[k] = v; } }
            : ({ dL: 'rampBDL', dH: 'rampBDH', dS: 'rampBDS' })[k];
          fields.appendChild(numField(acc('dL'), '+L', false));
          fields.appendChild(numField(acc('dH'), '+H', false));
          fields.appendChild(numField(acc('dS'), '+S', false));
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

// The studio is DEV-ONLY furniture: it registers with the gate rather
// than appearing for everyone. Its button is created either way (so
// nothing has to be built lazily at the moment of unlock) but stays
// hidden until the gate opens.
function ensureDom() {
  if (btn) return;
  btn = document.createElement('button');
  btn.id = 'studio-btn';
  btn.textContent = '\ud83c\udfa8';
  btn.title = 'Shader Studio (dev)';
  btn.addEventListener('click', toggle);
  document.body.appendChild(btn);
  if (window.FF.devtools) {
    window.FF.devtools.register({
      show: () => { btn.style.display = ''; },
      hide: () => {
        btn.style.display = 'none';
        // studio.active, not a bare `active` — the latter is not
        // defined here and threw a ReferenceError every time the dev
        // gate closed. devtools catches consumer failures, so this
        // only ever showed up as a console warning; the real cost was
        // that the studio was NOT closed behind the gate, which is
        // the one thing this handler exists to guarantee.
        if (studio.active) toggle();
        studio.design = null;   // belt and braces: never dress a player
      },
    });
  }

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
    // Two labeled blocks, matching where each bakes back in: the
    // global rig state (shading.js P) and every species' pattern-
    // anchor offset (fruits.js entries) — including any live edits
    // made through the grid's B cell.
    const patternOffsets = {};
    const FR = window.FF.FRUITS || {};
    for (const k of Object.keys(FR)) {
      if (FR[k].patternOffset) patternOffsets[k] = FR[k].patternOffset;
    }
    const json = JSON.stringify({ 'shading.js P': P, 'fruits.js patternOffset': patternOffsets }, null, 2);
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
    studio.design = currentDesign();
  });
  head.appendChild(fruitBtn);
  const seedBtn = document.createElement('button');
  seedBtn.textContent = 'reroll pattern';
  seedBtn.addEventListener('click', () => { seedIdx = (seedIdx + 1) % SEEDS.length; studio.design = currentDesign(); });
  head.appendChild(seedBtn);
  const colorIn = document.createElement('input');
  colorIn.type = 'color';
  colorIn.value = '#56c516';
  colorIn.title = 'melon color';
  colorIn.addEventListener('input', () => { studioColor = colorIn.value; studio.design = currentDesign(); });
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
  colorReset.addEventListener('click', () => { studioColor = null; studio.design = currentDesign(); });
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
  // THE DESIGN IS ONLY WORN WHILE THE STUDIO IS OPEN. Closing it
  // hands the player back their own melon rather than leaving them
  // dressed as the stage.
  studio.design = studio.active ? currentDesign() : null;
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
  const baseColor = studioColor || stageAnchor(fruit);
  refreshPalette(baseColor, fruit);
  studio.design = currentDesign(); // the stage IS the player's melon

  // Cast + contact previews (mirrors the renderer's construction).
  const hM = 0.9;
  if (RIG.P.castShadow && hM < RIG.P.castMaxM) {
    // The rig's TRUE footprint against the flat studio floor (world
    // coords centered on the melon; floor sits (b+90) below).
    const shC = (FR.taper || 0) * a / 4;
    const fp = RIG.castFootprint(shC * Math.cos(angle), shC * Math.sin(angle), angle, a, b, () => b + 90, (FR.taper || 0));
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
studio.currentDesign = currentDesign;
// NO DESIGN UNTIL THE STUDIO IS OPENED (2026-08-14). This line used
// to be `studio.design = currentDesign()` — set at module load, for
// everyone, whether or not the dev gate had ever been opened. Every
// consumer reads `(design && design.color) || melon.bodyColor`, so
// the stage melon won: the menu portrait AND the player's race body
// (main.js re-applies it every frame) wore StudioMelonA's colour and
// rind rather than the ones their own seed describes.
//
// The visible symptom was that cycling melons on the start screen
// changed the stats and the SIZE but never the colour or pattern —
// every melon looked like the same melon, which is exactly what the
// seed-owns-the-pigment law exists to prevent.
//
// A dev tool must be inert until it is used. The design is now
// created when the studio is opened, and dropped when the gate
// closes, so a player who never opens it always races their own melon.
studio.design = null;
studio.init = ensureDom;

})();