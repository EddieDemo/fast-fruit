// EDITOR — the edit-melon screen.
//
// One screen, reached by tapping the menu portrait: rename the active
// melon, and dress it in the decals you own. Direct manipulation on
// the portrait itself — drag to move, one corner handle for
// rotate-and-scale, two fingers if you have them — because a sticker
// is a thing you put somewhere with your hands, not a form you fill
// in.
//
// LAWS (all ruled 2026-08-15):
//   * Placement is anywhere the CENTRE is on the visible face. Edges
//     wrap and clip at the silhouette, because that is what a real
//     sticker does and the mesh renders it truthfully.
//   * Scale runs to full coverage (S_MAX = 2.6): you may wrap your
//     melon in a country flag. The mesh resolution law (decals.js)
//     holds accuracy at that size.
//   * Z-order is LAST TOUCHED ON TOP, persisted as array order —
//     slot 0 draws on top (the raster's first hit wins). Poking a
//     sticker raises it, which covers eye-on-flag layering with no
//     reorder UI.
//   * Gestures preview through the renderer's PREVIEW tier (reduced
//     raster scale, coarse mesh, uncached) and the crisp bake lands on
//     release. Geometry never lies; only resolution dips in hand.
//   * Live save on gesture end. No confirm dialogs; the melon is
//     yours.
//
// The preview IS the race pipeline — same drawMelonStandalone, same
// bands, same rasters, at a fixed pose. It is structurally incapable
// of showing you something the race won't.
(function () {
'use strict';

// PIXEL 320 STICKER LAW (Eddie, 2026-08-18): stickers no longer
// resize. At 320 a sticker gets ~5-8 px across, so a scale gesture
// runs between "a few pixels" and "noise". Stickers are therefore
// BORN at one authored size (decals.js STICKER_S, applied in
// place()) and the pinch gesture only rotates.
// clampScale keeps its BOUNDS job untouched: routing it through the
// fixed size shrank WRAPS from full coverage to sticker size —
// caught by verify-wraps, which is exactly what it is for.
const S_MIN = 0.06;   // below this a sticker can't be grabbed back
const S_MAX = 2.6;    // full coverage: sized so the LETTERBOXED flag
                      // art (2:3, half-height 0.62) still wraps the
                      // quarter-meridian — the whole-flag ruling
const POSE = 0;       // fixed editing pose, long axis level

// ---- pure gesture/placement maths (verified headless) ---------------
// Centre must stay strictly inside the silhouette so unproject stays
// well-conditioned; 0.985 keeps the centre a hair off the rim while
// the sticker's body wraps as far as it likes.
function clampCentre(x, y, a, b) {
  const r = Math.hypot(x / a, y / b);
  const lim = 0.985;
  if (r <= lim) return { x, y };
  const f = lim / r;
  return { x: x * f, y: y * f };
}

function clampScale(s) {
  return Math.max(S_MIN, Math.min(S_MAX, s));
}

// MAGNETIC DETENTS with escape velocity: within SNAP_EPS of a detent
// the angle clicks to it; pull past and it breaks free. Detents every
// 45 degrees — the shared-transform-UX convention, and pure player
// intent, so no honesty concern: the stored rot receives the snapped
// value the player chose to accept.
const DETENT = Math.PI / 4;
const SNAP_EPS = 4 * Math.PI / 180;
function snapAngle(rot) {
  const k = Math.round(rot / DETENT);
  const d = k * DETENT;
  if (Math.abs(rot - d) <= SNAP_EPS) return { rot: d, snapped: true, detent: k };
  return { rot, snapped: false, detent: null };
}

// Double-tap straightens: nearest quarter turn.
function nearestCardinal(rot) {
  return Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
}

// Rotate/scale from the handle gesture: base pose plus the screen-
// space delta between the grab vector and the current vector, both
// taken from the sticker centre.
function handlePose(baseRot, baseS, grabVec, nowVec) {
  const a0 = Math.atan2(grabVec.y, grabVec.x);
  const a1 = Math.atan2(nowVec.y, nowVec.x);
  const d0 = Math.hypot(grabVec.x, grabVec.y) || 1e-6;
  const d1 = Math.hypot(nowVec.x, nowVec.y);
  // Rotation only: the pinch's distance ratio is ignored (sticker law).
  return { rot: baseRot + (a1 - a0), s: clampScale(baseS) };
}

// Last touched on top: return the array with index i moved to front.
// Slot 0 is the top of the pile — the raster draws first hit.
function bumpToTop(worn, i) {
  if (i <= 0) return worn;
  const w = worn.slice();
  const [d] = w.splice(i, 1);
  w.unshift(d);
  return w;
}

// ---- module state ----------------------------------------------------
let elScreen = null;
let cvs = null, ctx = null;
let trayEl = null, slotsEl = null, nameEl = null;
// The remove affordances' white — the X badge on a selection and the
// REMOVE ALL glyph in the tray share it (one literal, one meaning).
const BADGE_WHITE = 'rgba(255,255,255,0.95)';
let onDone = null;

// body + drawing
let body = null;      // { a, b, color, patKey, fruit, spec }
let fit = 1;          // device px per body px
let selected = -1;    // index into worn (0 = top)
let hitMeshes = [];   // full meshes for hit tests + selection outline
let gesture = null;   // { kind: 'drag'|'handle'|'pinch', ... }
let rafPending = false;
let crispTimer = 0;
let zoneEl = null, chipEl = null;
let lastTap = { t: 0, i: -1 };
function buzz(ms) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
}

function worn() {
  const spec = body && body.spec;
  if (!spec.decals) spec.decals = [];
  return spec.decals;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- styles (start-screen grammar; only editor-specifics added) ------
const CSS = `
.ff-editor-screen .ff-panel { max-width: min(94vw, 560px); }
.ff-edit-canvas { display: block; width: min(78vw, 400px); height: min(78vw, 400px);
  margin: 0 auto; touch-action: none; }
.ff-edit-slots { text-align: center; font-size: var(--fs-label);
  letter-spacing: var(--tr-label); opacity: 0.75; margin: 2px 0 6px; }
.ff-tray { display: grid; gap: 10px; padding: 6px 2px;
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); }
.ff-tray-chip { display: flex; flex-direction: column;
  align-items: center; gap: 3px; background: none; border: 1px solid
  rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 8px;
  cursor: pointer; min-width: 0;
  color: inherit; font: inherit; }   /* buttons do NOT inherit these */
.ff-tray-chip .ff-chip-label { max-width: 100%; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; font-weight: var(--fw-bold); }
.ff-tray-chip canvas { width: 44px; height: 44px; display: block; }
.ff-tray-chip .ff-chip-label { font-size: var(--fs-body); }
.ff-tray-chip .ff-chip-rarity { font-size: var(--fs-micro);
  letter-spacing: var(--tr-micro); color: var(--c-faint); }
.ff-tray-clear { border-style: dashed; }
.ff-editor-screen .ff-foot { flex-wrap: wrap; gap: 8px; }
.ff-edit-zone { position: relative; }
.ff-edit-readout { position: absolute; pointer-events: none; display: none;
  font-family: ui-monospace, monospace; font-size: var(--fs-label);
  letter-spacing: var(--tr-label);
  background: rgba(16,16,12,0.85); color: rgba(255,255,255,0.95);
  border: 1px solid rgba(255,255,255,0.25); border-radius: 999px;
  padding: 3px 10px; transform: translate(-50%, -130%); white-space: nowrap; }
@keyframes ff-shake { 0%,100% { transform: translateX(0); }
  25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.ff-shake { animation: ff-shake 0.18s linear 2; }
`;
let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---- coordinate mapping ----------------------------------------------
function toBody(ev) {
  const r = cvs.getBoundingClientRect();
  const dpr = cvs.width / r.width;
  const x = (ev.clientX - r.left) * dpr, y = (ev.clientY - r.top) * dpr;
  return { x: (x - cvs.width / 2) / fit, y: (y - cvs.height / 2) / fit };
}

function centreOf(wd) {
  const D = window.FF.decals;
  const p = D.pointAt(wd.u, wd.v, body.a, body.b);
  return { x: p.x, y: p.y };
}

// ---- drawing -----------------------------------------------------------
function rebuildHitMeshes() {
  const D = window.FF.decals;
  hitMeshes = worn().map(wd =>
    D.byId(wd.id) ? D.buildStickerMesh(wd.u, wd.v, wd.rot, wd.s * body.b, body.a, body.b) : null);
}

function draw(preview) {
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const r = cvs.getBoundingClientRect();
  const want = Math.max(64, Math.min(1600, Math.round((r.width || 300) * dpr)));
  if (cvs.width !== want || cvs.height !== want) { cvs.width = want; cvs.height = want; }
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.save();
  ctx.translate(cvs.width / 2, cvs.height / 2);
  fit = (cvs.width / 2 - 6 * dpr) / Math.max(body.a, body.b);
  ctx.scale(fit, fit);
  window.FF.drawMelonStandalone(ctx, POSE, body.a, body.b, body.color,
    body.patKey, body.species, fit, worn(), !!preview);
  drawSelection(preview);
  ctx.restore();
}

// The selection ring is the mesh's own boundary, projected — so it
// bows around the body exactly as the sticker does, and only the
// visible part draws. The handle sits on the nearest visible boundary
// vertex to the bottom-right corner.
function drawSelection(preview) {
  if (selected < 0 || selected >= worn().length) return;
  const wd = worn()[selected];
  const D = window.FF.decals;
  const mesh = (!preview && hitMeshes[selected])
    ? hitMeshes[selected]
    : D.buildStickerMesh(wd.u, wd.v, wd.rot, wd.s * body.b, body.a, body.b, true);
  if (!mesh) return;
  const N = mesh.N;
  const ring = [];
  for (let i = 0; i < N; i++) ring.push(i);                       // top row ->
  for (let j = 1; j < N; j++) ring.push(j * N + (N - 1));         // right col v
  for (let i = N - 2; i >= 0; i--) ring.push((N - 1) * N + i);    // bottom <-
  for (let j = N - 2; j >= 1; j--) ring.push(j * N);              // left ^
  ctx.save();
  ctx.lineWidth = 1.6 / fit;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.setLineDash([4 / fit, 3 / fit]);
  ctx.beginPath();
  let pen = false;
  for (const k of ring.concat(ring[0])) {
    if (mesh.Z[k] < 0) { pen = false; continue; }
    if (!pen) { ctx.moveTo(mesh.X[k], mesh.Y[k]); pen = true; }
    else ctx.lineTo(mesh.X[k], mesh.Y[k]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const dpr = window.devicePixelRatio || 1;
  // GESTURE CONTINUITY: once grabbed, the knob stays under the finger.
  // Re-deriving it from the mesh every preview frame made it pop to a
  // different boundary vertex when a corner wrapped past the
  // silhouette mid-gesture; it re-homes on release.
  const selItem = window.FF.decals.byId(wd.id);
  const selIsWrap = !!(selItem && selItem.wrap);
  const grabbed = gesture && gesture.kind === 'handle';
  const h = selIsWrap ? null                 // a wrap has no knob
    : (grabbed && gesture.pNow ? gesture.pNow : handlePos(mesh));
  if (h) {
    const kr = (grabbed ? 9 : 7) / fit * dpr;      // pressed swell
    ctx.beginPath();
    ctx.arc(h.x, h.y, kr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(h.x, h.y, kr * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,20,16,0.9)';
    ctx.fill();
  }
  // The remove affordance lives ON the selection (the mobile sticker
  // convention): an X badge at the corner opposite the knob.
  const xb = xBadgePos(mesh);
  if (xb && !gesture) {
    const br = 8 / fit * dpr;
    ctx.beginPath();
    ctx.arc(xb.x, xb.y, br, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,20,16,0.9)';
    ctx.fill();
    ctx.lineWidth = 1.6 / fit * dpr;
    ctx.strokeStyle = BADGE_WHITE;
    ctx.stroke();
    ctx.beginPath();
    const s = br * 0.42;
    ctx.moveTo(xb.x - s, xb.y - s); ctx.lineTo(xb.x + s, xb.y + s);
    ctx.moveTo(xb.x + s, xb.y - s); ctx.lineTo(xb.x - s, xb.y + s);
    ctx.stroke();
  }
  ctx.restore();
}

function xBadgePos(mesh) {
  // top-left corner vertex, or the nearest visible boundary vertex
  // walking along the top row then down the left column.
  const N = mesh.N;
  const cand = [0];
  for (let i = 1; i < N; i++) cand.push(i);
  for (let j = 1; j < N; j++) cand.push(j * N);
  for (const k of cand) {
    if (mesh.Z[k] >= 0) return { x: mesh.X[k], y: mesh.Y[k] };
  }
  return null;
}

function handlePos(mesh) {
  // bottom-right corner vertex, or the nearest visible boundary vertex
  // walking back along the bottom row then up the right column.
  const N = mesh.N;
  const cand = [];
  cand.push((N - 1) * N + (N - 1));
  for (let i = N - 2; i >= 0; i--) cand.push((N - 1) * N + i);
  for (let j = N - 2; j >= 0; j--) cand.push(j * N + (N - 1));
  for (const k of cand) {
    if (mesh.Z[k] >= 0) return { x: mesh.X[k], y: mesh.Y[k] };
  }
  return null;
}

function updateReadout(show) {
  if (!chipEl) return;
  if (!show || selected < 0) { chipEl.style.display = 'none'; return; }
  const wd = worn()[selected];
  let deg = Math.round(wd.rot * 180 / Math.PI) % 360;
  if (deg > 180) deg -= 360;
  if (deg < -180) deg += 360;
  chipEl.textContent = deg + '\u00B0 \u00B7 \u00D7' + wd.s.toFixed(2);
  // sticker centre -> css px within the zone
  const c = centreOf(wd);
  const r = cvs.getBoundingClientRect(), z = zoneEl.getBoundingClientRect();
  const xCss = (c.x * fit + cvs.width / 2) * (r.width / cvs.width) + (r.left - z.left);
  const yCss = (c.y * fit + cvs.height / 2) * (r.height / cvs.height) + (r.top - z.top);
  chipEl.style.left = xCss + 'px';
  chipEl.style.top = yCss + 'px';
  chipEl.style.display = 'block';
}

function scheduleDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw(true);
  });
}

// ---- gestures ----------------------------------------------------------
function hitDecal(p) {
  const D = window.FF.decals;
  const w = worn();
  for (let i = 0; i < w.length; i++) {         // array order = z order
    const mesh = hitMeshes[i];
    if (!mesh) continue;
    const q = D.meshSample(mesh, p.x, p.y);
    if (!q) continue;
    const half = w[i].s * body.b;
    if (Math.abs(q.x) <= half && Math.abs(q.y) <= half) return i;
  }
  return -1;
}

const pointers = new Map();

function onPointerDown(ev) {
  ev.preventDefault();
  cvs.setPointerCapture(ev.pointerId);
  const p = toBody(ev);
  pointers.set(ev.pointerId, p);

  // second finger while a decal is held -> pinch (never reachable for
  // wraps: a wrap never enters a drag gesture in the first place)
  if (gesture && (gesture.kind === 'drag' || gesture.kind === 'handle')
      && pointers.size === 2 && selected >= 0) {
    const pts = [...pointers.values()];
    const wd = worn()[selected];
    gesture = { kind: 'pinch', baseRot: wd.rot, baseS: wd.s,
      baseVec: { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y } };
    return;
  }

  // Affordances first: they may sit on top of another sticker.
  // Touch targets behave like ~44 css px regardless of drawn size.
  const HIT_R = 22 / fit * (window.devicePixelRatio || 1);
  if (selected >= 0 && hitMeshes[selected]) {
    const xb = xBadgePos(hitMeshes[selected]);
    if (xb && Math.hypot(p.x - xb.x, p.y - xb.y) < HIT_R) {
      removeSelected();
      return;
    }
    const h = handlePos(hitMeshes[selected]);
    if (h && Math.hypot(p.x - h.x, p.y - h.y) < HIT_R) {
      const wd = worn()[selected];
      const c = centreOf(wd);
      gesture = { kind: 'handle', baseRot: wd.rot, baseS: wd.s,
        centre: c, grabVec: { x: p.x - c.x, y: p.y - c.y }, pNow: p,
        lastDetent: null };
      scheduleDraw();
      return;
    }
  }

  const i = hitDecal(p);
  if (i >= 0) {
    const isWrap = (() => {
      const it = window.FF.decals.byId(worn()[i].id);
      return !!(it && it.wrap);
    })();
    // Double-tap straightens: nearest quarter turn (mirror is out —
    // flags must not mirror). A wrap's rot is fixed at 0: no-op.
    const now = Date.now();
    if (now - lastTap.t < 350 && lastTap.i === i) {
      lastTap = { t: 0, i: -1 };
      const spec0 = body.spec;
      const prevArr = worn();
      spec0.decals = bumpForTouch(prevArr, i);
      rebuildHitMeshes();
      selected = (spec0.decals === prevArr) ? i : 0;
      if (!isWrap) worn()[selected].rot = nearestCardinal(worn()[selected].rot);
      buzz(8);
      gesture = null;
      updateFoot();
      rebuildHitMeshes();
      draw(false);
      window.FF.melon._save();
      return;
    }
    lastTap = { t: now, i };
    if (isWrap) {
      // A wrap SELECTS but never raises, never drags: fixed pose,
      // binary existence — the X is its only affordance.
      selected = i;
      gesture = null;
      updateFoot();
      draw(false);
      return;
    }
    // LAST TOUCHED ON TOP, at the moment of touching.
    const spec = body.spec;
    spec.decals = bumpToTop(worn(), i);
    rebuildHitMeshes();
    selected = 0;
    const wd = worn()[0];
    const c = centreOf(wd);
    gesture = { kind: 'drag', delta: { x: p.x - c.x, y: p.y - c.y } };
    updateFoot();
    draw(false);
    return;
  }

  // outside every sticker: deselect (outside the body is the only
  // guaranteed dead zone once a flag wraps the melon, and it works
  // everywhere).
  selected = -1;
  gesture = null;
  updateFoot();
  draw(false);
}

function onPointerMove(ev) {
  if (!gesture || selected < 0) return;
  const p = toBody(ev);
  pointers.set(ev.pointerId, p);
  const D = window.FF.decals;
  const wd = worn()[selected];
  if (gesture.kind === 'drag') {
    const c = clampCentre(p.x - gesture.delta.x, p.y - gesture.delta.y, body.a, body.b);
    const surf = D.unproject(c.x, c.y, body.a, body.b);
    if (surf) { wd.u = surf.u; wd.v = surf.v; }
  } else if (gesture.kind === 'handle') {
    gesture.pNow = p;
    const pose = handlePose(gesture.baseRot, gesture.baseS, gesture.grabVec,
      { x: p.x - gesture.centre.x, y: p.y - gesture.centre.y });
    applyPose(wd, pose, ev.shiftKey ? gesture.baseS : null);
  } else if (gesture.kind === 'pinch' && pointers.size >= 2) {
    const pts = [...pointers.values()];
    const pose = handlePose(gesture.baseRot, gesture.baseS, gesture.baseVec,
      { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y });
    applyPose(wd, pose, null);
  }
  updateReadout(gesture.kind === 'handle' || gesture.kind === 'pinch');
  scheduleDraw();
}

// Snap, tick, lock. shiftLockS non-null = rotate-only (the one
// Photoshop modifier worth importing). Scale clamps to the ITEM'S
// ceiling (decals.js maxScaleFor): flag stickers stop at 1.2, since
// full coverage is the wrap's job.
function applyPose(wd, pose, shiftLockS) {
  const D = window.FF.decals;
  const sn = snapAngle(pose.rot);
  wd.rot = sn.rot;
  const cap = D.maxScaleFor(D.byId(wd.id));
  wd.s = Math.min(cap, shiftLockS !== null ? shiftLockS : pose.s);
  if (sn.snapped && gesture.lastDetent !== sn.detent) buzz(8);
  gesture.lastDetent = sn.snapped ? sn.detent : null;
}

// ---- the wrap grammar (ruled 2026-08-16), pure ------------------------
// A wrap is BINARY and sits at the BOTTOM of the pile: stickers ride
// on wraps, never under. One wrap at a time — applying one replaces
// any other. Stickers still arrive on top.
function wornWithApplied(worn, wd, isWrap) {
  if (isWrap) {
    const byIdF = window.FF.decals.byId;
    return worn.filter(w => { const it = byIdF(w.id); return !(it && it.wrap); })
      .concat([wd]);
  }
  return [wd].concat(worn);
}
// Last-touched-on-top, EXCEPT wraps: touching a wrap selects it but
// never raises it — the pile has a floor.
function bumpForTouch(worn, i) {
  const it = window.FF.decals.byId(worn[i] && worn[i].id);
  if (it && it.wrap) return worn;
  return bumpToTop(worn, i);
}

function onPointerUp(ev) {
  pointers.delete(ev.pointerId);
  if (!gesture) return;
  if (gesture.kind === 'pinch' && pointers.size === 1) {
    // fall back to dragging with the remaining finger
    const p = [...pointers.values()][0];
    const c = centreOf(worn()[selected]);
    gesture = { kind: 'drag', delta: { x: p.x - c.x, y: p.y - c.y } };
    return;
  }
  if (pointers.size > 0) return;
  gesture = null;
  // Gesture end: the outfit SAVES now; the crisp bake lands a beat
  // later. At the scale ceiling a full-wrap mesh takes ~100ms to shoot
  // (measured, desktop) — run synchronously in this handler it would
  // freeze the finger-lift, but deferred it freezes a STATIC screen,
  // which freezes nothing anyone can see. The preview raster holds the
  // screen for the beat.
  updateReadout(false);
  window.FF.melon._save();
  clearTimeout(crispTimer);
  crispTimer = setTimeout(() => {
    rebuildHitMeshes();
    draw(false);
  }, 30);
}

// ---- keyboard courtesy (desktop) ------------------------------------
function onKeyDown(ev) {
  if (selected < 0) {
    if (ev.key === 'Escape') { /* nothing selected: nothing to release */ }
    return;
  }
  const wd = worn()[selected];
  const D = window.FF.decals;
  if (ev.key === 'Escape') {
    selected = -1;
    updateFoot();
    draw(false);
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    removeSelected();
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[ev.key]) {
    ev.preventDefault();
    const step = (ev.shiftKey ? 6 : 1.5);
    const c = centreOf(wd);
    const nc = clampCentre(c.x + arrows[ev.key][0] * step,
      c.y + arrows[ev.key][1] * step, body.a, body.b);
    const surf = D.unproject(nc.x, nc.y, body.a, body.b);
    if (surf) { wd.u = surf.u; wd.v = surf.v; }
    rebuildHitMeshes();
    draw(false);
    window.FF.melon._save();
  }
}

// ---- tray ---------------------------------------------------------------
function chipCanvasPaint(cv, item) {
  window.FF.decals.paintArt(cv, item);   // one painter (see decals.js)
}

function buildTray() {
  const D = window.FF.decals;
  const M = window.FF.melon;
  trayEl.textContent = '';
  const owned = M.ownedDecals();
  for (const setKey of Object.keys(D.SETS)) {
    const set = D.SETS[setKey];
    for (const item of set.items) {
      if (owned.indexOf(item.id) === -1) continue;
      const chip = el('button', 'ff-tray-chip');
      const cv2 = el('canvas');
      cv2.width = 88; cv2.height = 88;
      chipCanvasPaint(cv2, item);
      chip.appendChild(cv2);
      chip.appendChild(el('div', 'ff-chip-label', item.label));
      // Rarity is arithmetic: the set size IS the number.
      chip.appendChild(el('div', 'ff-chip-rarity',
        '1 of ' + set.items.length + ' ' + set.label));
      chip.addEventListener('click', () => applyItem(item.id, chip));
      trayEl.appendChild(chip);
    }
  }
  // REMOVE ALL (Eddie, 2026-09-04): a wrap's X badge sits on a mesh
  // corner that full coverage pushes off the silhouette, so a worn
  // wrap had no visible way off. One extra slot at the end of the
  // tray takes everything off in one tap — wraps and stickers alike.
  // Same door as the X badge (spec.decals = null, save), so the two
  // cannot disagree about what "bare" means.
  const clear = el('button', 'ff-tray-chip ff-tray-clear');
  const cv3 = el('canvas'); cv3.width = 88; cv3.height = 88;
  paintClearGlyph(cv3);
  clear.appendChild(cv3);
  clear.appendChild(el('div', 'ff-chip-label', 'REMOVE ALL'));
  clear.appendChild(el('div', 'ff-chip-rarity', 'bare melon'));
  clear.addEventListener('click', () => removeAll());
  trayEl.appendChild(clear);
}

// The clear chip's art: a bare ring with a cross, in the tray's own
// tones — no sticker, so no painter; drawn here.
function paintClearGlyph(cv) {
  const c = cv.getContext('2d'); if (!c) return;
  const w = cv.width, h = cv.height, r = w * 0.34;
  c.clearRect(0, 0, w, h);
  c.lineWidth = 5; c.strokeStyle = BADGE_WHITE; c.lineCap = 'round';   // the X badge's own white
  c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.stroke();
  const s = r * 0.42;
  c.beginPath();
  c.moveTo(w / 2 - s, h / 2 - s); c.lineTo(w / 2 + s, h / 2 + s);
  c.moveTo(w / 2 + s, h / 2 - s); c.lineTo(w / 2 - s, h / 2 + s);
  c.stroke();
}

// Take every decal off — wraps included. The X badge removes one;
// this is the same write for all of them.
function removeAll() {
  const spec = body.spec;
  if (!worn().length) return;
  spec.decals = null;
  selected = -1;
  rebuildHitMeshes();
  updateFoot();
  draw(false);
  window.FF.melon._save();
}

function applyItem(id, chipBtn) {
  const D = window.FF.decals;
  const spec = body.spec;
  const w = worn();
  if (w.length >= D.MAX_DECALS) {
    slotsEl.textContent = 'all ' + D.MAX_DECALS + ' slots worn — remove one first';
    if (chipBtn) {
      chipBtn.classList.remove('ff-shake');
      void chipBtn.offsetWidth;                    // restart the animation
      chipBtn.classList.add('ff-shake');
    }
    return;
  }
  // Seeded landing keeps the gift-moment charm; then it's in your
  // hands. Index by count so re-applying the same item lands fresh.
  // Wraps arrive at the BOTTOM of the pile and replace any other wrap
  // (one at a time — a hidden underlayer is a wasted slot pretending
  // to be a choice); stickers arrive on top, as ever.
  const item = D.byId(id);
  const wd = D.place(spec, id, w.length);
  spec.decals = wornWithApplied(w, wd, !!(item && item.wrap));
  selected = (item && item.wrap) ? spec.decals.length - 1 : 0;
  rebuildHitMeshes();
  updateFoot();
  draw(false);
  window.FF.melon._save();
}

function removeSelected() {
  if (selected < 0) return;
  const spec = body.spec;
  const w = worn().slice();
  w.splice(selected, 1);
  spec.decals = w.length ? w : null;
  selected = -1;
  rebuildHitMeshes();
  updateFoot();
  draw(false);
  window.FF.melon._save();
}

function updateFoot() {
  const D = window.FF.decals;
  slotsEl.textContent = worn().length + '/' + D.MAX_DECALS + ' slots';
  // DEV READOUT (v377, 2026-09-04): the bake's own account of itself,
  // for the mobile-only colour bug that no headless rig reproduces —
  // variants held, frames baked, the scratch canvas, and the last
  // error the bake caught (iOS fails canvases silently past its memory
  // budget). Reads FF._bakeStats; nothing else changes.
  const BS = window.FF._bakeStats;
  if (BS) slotsEl.textContent += '  \u00b7  bake ' + BS.variants + ' var / ' + BS.frames + ' fr / '
    + (BS.scratchPx / 1e6).toFixed(1) + ' Mpx' + (BS.lastError ? '  \u00b7  ERR ' + BS.lastError : '');
  const M = window.FF.melon;
  nameEl.textContent = M.active().name || 'unnamed melon';
}

// ---- screen -------------------------------------------------------------
function build() {
  injectCSS();
  elScreen = el('div', 'ff-screen ff-editor-screen');
  const panel = el('div', 'ff-panel');

  const head = el('div', 'ff-head');
  head.appendChild(el('h1', 'ff-title', 'EDIT MELON'));
  const sub = el('p', 'ff-sub', 'drag to move \u00B7 knob turns and sizes \u00B7 double-tap straightens');
  head.appendChild(sub);
  panel.appendChild(head);

  const bodyZone = el('div', 'ff-body');
  zoneEl = el('div', 'ff-edit-zone');
  cvs = el('canvas', 'ff-edit-canvas');
  cvs.width = 800; cvs.height = 800;
  ctx = cvs.getContext('2d');
  zoneEl.appendChild(cvs);
  chipEl = el('div', 'ff-edit-readout');
  zoneEl.appendChild(chipEl);
  bodyZone.appendChild(zoneEl);
  slotsEl = el('div', 'ff-edit-slots', '');
  bodyZone.appendChild(slotsEl);
  trayEl = el('div', 'ff-tray');
  bodyZone.appendChild(trayEl);
  panel.appendChild(bodyZone);

  const foot = el('div', 'ff-foot');
  nameEl = el('button', 'ff-btn ff-quiet', '');
  nameEl.title = 'rename';
  nameEl.addEventListener('click', () => {
    // The plain rename door — the ceremony stays reserved for first
    // naming. The card opens over this screen and we repaint the label
    // when it closes.
    window.FF.flow.openNaming('rename', () => updateFoot());
  });
  // The foot REMOVE button retired 2026-08-15: the X badge on the
  // selection is the one surface for that action.
  const done = el('button', 'ff-btn', 'DONE');
  done.addEventListener('click', close);
  foot.appendChild(nameEl);
  foot.appendChild(done);
  panel.appendChild(foot);

  elScreen.appendChild(panel);

  cvs.addEventListener('pointerdown', onPointerDown);
  cvs.addEventListener('pointermove', onPointerMove);
  cvs.addEventListener('pointerup', onPointerUp);
  cvs.addEventListener('pointercancel', onPointerUp);
}

function open(done) {
  const M = window.FF.melon;
  const D = window.FF.decals;
  if (!M || !D || !window.FF.drawMelonStandalone) return;
  onDone = done || null;
  if (!elScreen) build();

  // Body facts: exactly pushMelonPortrait's derivation, so the melon
  // you edit is the melon on the menu is the melon on the track.
  const spec = M.active();
  const d = M.deriveSpec(spec);
  const design = window.FF.studio && window.FF.studio.design;
  const fruit = (design && design.species) || 'watermelon';
  const F = window.FF.OBJECTS[fruit] || {};
  const a = window.FF.CONFIG.semiMajor * d.scale * (F.sizeMult || 1);
  body = {
    a, b: a * (F.aspect || 0.78),
    color: (design && design.color) || d.bodyColor,
    patKey: (design && design.patKey) || d.patternKey,
    species: fruit, spec,
  };

  selected = -1;
  gesture = null;
  pointers.clear();
  rebuildHitMeshes();
  document.body.appendChild(elScreen);
  window.addEventListener('keydown', onKeyDown);
  buildTray();
  updateFoot();
  draw(false);
}

function close() {
  clearTimeout(crispTimer);
  window.removeEventListener('keydown', onKeyDown);
  updateReadout(false);
  if (elScreen && elScreen.parentNode) elScreen.parentNode.removeChild(elScreen);
  hitMeshes = [];
  gesture = null;
  pointers.clear();
  if (onDone) { const f = onDone; onDone = null; f(); }
}

window.FF = window.FF || {};
// Rebuild the tray in place if the editor is on screen — for grants
// that arrive while it is open (today only the console dev door; in
// production ownership changes at cup end, never mid-edit).
function refreshTray() {
  if (elScreen && elScreen.parentNode && trayEl) {
    buildTray();
    updateFoot();
  }
}

window.FF.editor = { open, close, refreshTray };
// Pure laws, exposed for the headless harness only.
window.FF.editor._pure = { clampCentre, clampScale, handlePose, bumpToTop,
  wornWithApplied, bumpForTouch,
  snapAngle, nearestCardinal, S_MIN, S_MAX, SNAP_EPS, DETENT };

})();
