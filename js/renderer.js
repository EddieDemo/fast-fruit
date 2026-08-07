(function () {
'use strict';
// ============================================================
// RENDERER — draws the world from state. Reads everything, writes
// only presentation state (camera, fx decay). Never touches the sim.
//
// Interpolation: physics runs at a fixed rate; the renderer blends
// prevMelon -> melon by `alpha` so motion is smooth at any refresh
// rate. All juice (squash, stripes, shadow) lives here — the physics
// never knows the melon looks like anything at all.
// ============================================================

const { CONFIG, terrainYAt } = window.FF;

const COLORS = {
  sky: '#000000',            // pure black background
  grid: 'rgba(255, 255, 255, 0.08)', // background grid — visible but discreet
  ground: '#3a3a3a',         // ground fill
  rind: '#00ff00',           // full-green melon, no detail
  marker: 'rgba(255,255,255,0.35)',
};

const GRID_SPACING = 100; // world px between grid lines
const MIN_VISIBLE_M = 10;  // vertical view never shows less than this

// Bot palette: each melon its own bright shade (player stays pure green).
// Indexed by spawn order, so a bot keeps its color for the whole race.
const BOT_PALETTE = [
  '#b4ff39', // lime
  '#39ffb4', // spring
  '#ffe839', // yellow
  '#39d5ff', // cyan
  '#ff9e39', // orange
  '#e839ff', // magenta
  '#ff3987', // pink
  '#8dff39', // chartreuse
  '#39ffe8', // aqua
  '#ffc039', // amber
  '#a439ff', // violet
];

// Reused per-frame list of interpolated body poses (no per-frame GC).
const drawList = [];

function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  function render(state, alpha, dtFrame) {
    const m = state.melon, p = state.prevMelon;

    // Interpolated body pose for this frame.
    const ix = p.x + (m.x - p.x) * alpha;
    const iy = p.y + (m.y - p.y) * alpha;
    const iangle = p.angle + (m.angle - p.angle) * alpha;

    // ---- Camera: melon-centered, both axes, with catch-up lag ----
    // The melon is the camera's target; cameraLerp (tuning panel, Feel
    // group) is the catch-up knob — low = long dreamy lag, high = locked.
    const cam = state.camera;
    if (!cam.initialized) {
      cam.x = ix;
      cam.y = iy;
      cam.initialized = true;
    } else {
      const k = Math.min(1, CONFIG.cameraLerp * dtFrame);
      cam.x += (ix - cam.x) * k;
      cam.y += (iy - cam.y) * k;
    }
    // ---- Zoom: guarantee at least MIN_VISIBLE_M metres vertically ----
    // Short windows zoom OUT so exactly 10m fits; taller windows stay
    // at native 1:1 and simply see more world. World coordinates and
    // physics are untouched — this is purely the camera's lens.
    const zoom = Math.min(1, height / (MIN_VISIBLE_M * 100));
    const toScreenX = (wx) => (wx - cam.x) * zoom + width / 2;
    const toScreenY = (wy) => (wy - cam.y) * zoom + height / 2;
    // Screen y where world y=0 sits this frame (grid anchor).
    const groundScreenY = toScreenY(0);

    // ---- FX decay (presentation state owned by renderer) ----
    state.fx.squash = Math.max(0, state.fx.squash - CONFIG.squashDecay * state.fx.squash * dtFrame);
    state.fx.flash = Math.max(0, state.fx.flash - 10 * state.fx.flash * dtFrame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ---- Background ----
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, width, height);

    // Grid: world-anchored so it scrolls with the camera. Drawn before
    // terrain, so the ground fill covers the below-surface portion.
    drawGrid(ctx, cam.x, width, height, groundScreenY, zoom);

    // ---- Terrain ----
    // The polygon fill below IS the ground — no screen-wide pre-fill.
    // (A leftover flat-ground fillRect here was painting a phantom
    // surface at world y=0, burying the melon in dips below it.)
    for (const poly of state.terrain) {
      ctx.beginPath();
      ctx.moveTo(toScreenX(poly[0].x), toScreenY(poly[0].y));
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(toScreenX(poly[i].x), toScreenY(poly[i].y));
      }
      // Close down to the bottom of the screen to fill the ground.
      ctx.lineTo(toScreenX(poly[poly.length - 1].x), height);
      ctx.lineTo(toScreenX(poly[0].x), height);
      ctx.closePath();
      ctx.fillStyle = COLORS.ground;
      ctx.fill();
    }

    // Distance markers every 200 world px — motion & speed reference.
    drawMarkers(ctx, state, cam.x, width, toScreenX, toScreenY, zoom);

    // Start/finish line each lap (track mode): a post on the surface.
    if (state.period && state.race.mode === 'track') {
      const L = state.period.L;
      const lo = Math.floor((cam.x - (width / 2) / zoom - state.raceStartX) / L);
      const hi = Math.ceil((cam.x + (width / 2) / zoom - state.raceStartX) / L);
      ctx.fillStyle = '#ffffff';
      for (let k = lo; k <= hi; k++) {
        const wx = state.raceStartX + k * L;
        const wy = terrainYAt(state.terrain, wx);
        if (wy === null) continue;
        const sx = toScreenX(wx), sy = toScreenY(wy);
        // Post and flag are world objects: they scale with the lens.
        ctx.fillRect(sx - 2 * zoom, sy - 150 * zoom, 4 * zoom, 150 * zoom);
        ctx.fillRect(sx - 2 * zoom, sy - 150 * zoom, 26 * zoom, 14 * zoom);
      }
    }

    // ---- Debris: wreckage under the racers, minimum-image aware ----
    drawDebris(ctx, state, cam, width, height, toScreenX, toScreenY, zoom);

    // ---- Bodies: gather interpolated poses, rank, draw ----
    // Bots are OPAQUE — they're physical rivals. Transparency is
    // reserved for future non-colliding ghosts.
    drawList.length = 0;
    for (let i = 0; i < state.bots.length; i++) {
      if (!state.bots[i].melon.alive) continue; // smashed: absent until respawn
      const gm = state.bots[i].melon, gp = state.bots[i].prevMelon;
      drawList.push({
        x: gp.x + (gm.x - gp.x) * alpha,
        y: gp.y + (gm.y - gp.y) * alpha,
        angle: gp.angle + (gm.angle - gp.angle) * alpha,
        color: BOT_PALETTE[i % BOT_PALETTE.length],
        fx: null,
      });
    }
    // Player last, so it draws on top of the pack.
    if (state.melon.alive) {
      drawList.push({ x: ix, y: iy, angle: iangle, color: COLORS.rind, fx: state.fx, isPlayer: true });
    }

    // Race places: 1 = furthest along in ABSOLUTE space (true race
    // progress — a body one lap ahead ranks ahead even when its image
    // is drawn right beside you).
    const order = drawList.map((_, i) => i).sort((a, b) => drawList[b].x - drawList[a].x);
    for (let rank = 0; rank < order.length; rank++) drawList[order[rank]].place = rank + 1;

    for (const d of drawList) {
      // Periodic world: draw each body at its image nearest the camera,
      // so rivals laps apart still appear on the shared circuit.
      let dxw = d.x, dyw = d.y;
      if (state.period) {
        const k = Math.round((d.x - cam.x) / state.period.L);
        if (k !== 0) { dxw -= k * state.period.L; dyw -= k * state.period.D; }
      }
      const sx = toScreenX(dxw), sy = toScreenY(dyw);
      drawMelon(ctx, sx, sy, d.angle, d.fx, d.color, zoom);
      // Near-miss flash: white overlay that decays fast. Flash, not
      // squash — the survival warning must read differently from
      // ordinary impact juice.
      if (d.isPlayer && state.fx.flash > 0.02) {
        ctx.globalAlpha = state.fx.flash;
        drawMelon(ctx, sx, sy, d.angle, d.fx, '#ffffff', zoom);
        ctx.globalAlpha = 1;
      }
      drawPlace(ctx, sx, sy, d.place, zoom);
    }
  }

  const DEBRIS_RIND = '#0f8f3a';
  const DEBRIS_FLESH = '#ff4757';

  function drawDebris(ctx, state, cam, w, h, toScreenX, toScreenY, zoom) {
    const frags = window.FF.debris.fragments;
    const period = state.period;
    for (const f of frags) {
      if (!f.active) continue;
      let fx = f.x, fy = f.y;
      if (period) {
        const k = Math.round((f.x - cam.x) / period.L);
        if (k !== 0) { fx -= k * period.L; fy -= k * period.D; }
      }
      const sx = toScreenX(fx), sy = toScreenY(fy);
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(zoom, zoom);
      ctx.rotate(f.angle);
      ctx.fillStyle = f.rind ? DEBRIS_RIND : DEBRIS_FLESH;
      ctx.fillRect(-f.r, -f.r * 0.7, f.r * 2, f.r * 1.4);
      ctx.restore();
    }
  }

  // Race-place number at the melon's center, in SCREEN space — it never
  // rotates with the body. Geist Mono 400 per the design spec.
  function drawPlace(ctx, sx, sy, n, zoom) {
    ctx.font = `400 ${Math.max(9, Math.round(CONFIG.semiMinor * 0.8 * zoom))}px "Geist Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(String(n), sx, sy);
  }

  function drawMelon(ctx, sx, sy, angle, fx, color, zoom) {
    const a = CONFIG.semiMajor;
    const b = CONFIG.semiMinor;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(zoom, zoom); // world-sized body under the camera lens

    // Squash: compress along the impact normal, stretch along tangent.
    // Applied in the impact frame, then we rotate into body frame.
    // (fx is null for ghost bodies — they carry no impact FX.)
    if (fx && fx.squash > 0.003) {
      ctx.rotate(fx.squashAngle + Math.PI / 2);
      ctx.scale(1 + fx.squash, 1 - fx.squash);
      ctx.rotate(-(fx.squashAngle + Math.PI / 2));
    }

    ctx.rotate(angle);

    // Body: pure white, no detail. (Rotation is invisible by design;
    // the HUD spin readout is the remaining rotation reference.)
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    ctx.fillStyle = color || COLORS.rind;
    ctx.fill();

    ctx.restore();
  }

  function drawGrid(ctx, camX, w, h, groundY, zoom) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1; // grid stays hairline at every zoom
    ctx.beginPath();
    const spacing = GRID_SPACING * zoom; // world-anchored, screen-spaced
    // Vertical lines: anchored to world x, scroll with the camera.
    // 0.5 offset keeps 1px lines crisp on integer pixel boundaries.
    const span = (w / 2) / zoom;
    const firstX = Math.floor((camX - span) / GRID_SPACING) * GRID_SPACING;
    for (let wx = firstX; wx < camX + span + GRID_SPACING; wx += GRID_SPACING) {
      const sx = Math.round((wx - camX) * zoom + w / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    // Horizontal lines: anchored to world y, full screen height — the
    // terrain fill covers whatever falls below the surface, so lines
    // stay consistent inside dips below world y=0.
    const firstY = ((groundY % spacing) + spacing) % spacing;
    for (let sy = firstY; sy < h + spacing; sy += spacing) {
      const y = Math.round(sy) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  function drawMarkers(ctx, state, camX, w, toScreenX, toScreenY, zoom) {
    const SPACING = 200;
    const span = (w / 2) / zoom;
    const first = Math.floor((camX - span) / SPACING) * SPACING;
    ctx.fillStyle = COLORS.marker;
    // Labels stay screen-sized: they're UI, not world objects.
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let wx = first; wx < camX + span + SPACING; wx += SPACING) {
      const wy = terrainYAt(state.terrain, wx);
      if (wy === null) continue;
      const sx = toScreenX(wx);
      const sy = toScreenY(wy);
      // Tick sits ON the surface; label sits just under it, inside the fill.
      ctx.fillRect(sx - 1.5, sy - 14, 3, 14);
      ctx.fillText(`${wx / 100 | 0}`, sx, sy + 16);
    }
  }

  return { render, resize };
}

Object.assign(window.FF, { createRenderer });
})();