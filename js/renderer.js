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

const { CONFIG } = window.FF;

const COLORS = {
  sky: '#000000',            // pure black background
  grid: 'rgba(255, 255, 255, 0.08)', // background grid — visible but discreet
  ground: '#3a3a3a',         // ground fill
  rind: '#ffffff',           // pure white melon, no detail
  marker: 'rgba(255,255,255,0.35)',
};

const GRID_SPACING = 100; // world px between grid lines

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

    // ---- Camera: smooth-follow x, fixed framing on the ground ----
    const cam = state.camera;
    const targetX = ix + width * 0.12; // look slightly ahead of the melon
    if (!cam.initialized) {
      cam.x = targetX;
      cam.initialized = true;
    } else {
      const k = Math.min(1, CONFIG.cameraLerp * dtFrame);
      cam.x += (targetX - cam.x) * k;
    }
    // Ground (world y=0) sits at 72% of the screen height.
    const groundScreenY = height * 0.72;
    const toScreenX = (wx) => wx - cam.x + width / 2;
    const toScreenY = (wy) => wy + groundScreenY;

    // ---- FX decay (presentation state owned by renderer) ----
    state.fx.squash = Math.max(0, state.fx.squash - CONFIG.squashDecay * state.fx.squash * dtFrame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ---- Background ----
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, width, height);

    // Grid: world-anchored so it scrolls with the camera. Drawn before
    // terrain, so the ground fill covers the below-surface portion.
    drawGrid(ctx, cam.x, width, height, groundScreenY);

    // ---- Terrain ----
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, groundScreenY, width, height - groundScreenY);
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
    drawMarkers(ctx, cam.x, width, groundScreenY);

    // ---- Melon ----
    drawMelon(ctx, toScreenX(ix), toScreenY(iy), iangle, state.fx);
  }

  function drawMelon(ctx, sx, sy, angle, fx) {
    const a = CONFIG.semiMajor;
    const b = CONFIG.semiMinor;

    ctx.save();
    ctx.translate(sx, sy);

    // Squash: compress along the impact normal, stretch along tangent.
    // Applied in the impact frame, then we rotate into body frame.
    if (fx.squash > 0.003) {
      ctx.rotate(fx.squashAngle + Math.PI / 2);
      ctx.scale(1 + fx.squash, 1 - fx.squash);
      ctx.rotate(-(fx.squashAngle + Math.PI / 2));
    }

    ctx.rotate(angle);

    // Body: pure white, no detail. (Rotation is invisible by design;
    // the HUD spin readout is the remaining rotation reference.)
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.rind;
    ctx.fill();

    ctx.restore();
  }

  function drawGrid(ctx, camX, w, h, groundY) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical lines: anchored to world x, scroll with the camera.
    // 0.5 offset keeps 1px lines crisp on integer pixel boundaries.
    const firstX = Math.floor((camX - w / 2) / GRID_SPACING) * GRID_SPACING;
    for (let wx = firstX; wx < camX + w / 2 + GRID_SPACING; wx += GRID_SPACING) {
      const sx = Math.round(wx - camX + w / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    // Horizontal lines: anchored to world y (multiples above the ground).
    for (let sy = groundY; sy > -GRID_SPACING; sy -= GRID_SPACING) {
      const y = Math.round(sy) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  function drawMarkers(ctx, camX, w, groundY) {
    const SPACING = 200;
    const first = Math.floor((camX - w / 2) / SPACING) * SPACING;
    ctx.fillStyle = COLORS.marker;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let wx = first; wx < camX + w / 2 + SPACING; wx += SPACING) {
      const sx = wx - camX + w / 2;
      ctx.fillRect(sx - 1.5, groundY - 14, 3, 14);
      ctx.fillText(`${wx / 100 | 0}`, sx, groundY + 16);
    }
  }

  return { render, resize };
}

Object.assign(window.FF, { createRenderer });
})();