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
  terrainGrid: 'rgba(255, 255, 255, 0.06)', // ground grid — 2m squares, subtler
  ground: '#3a3a3a',         // ground fill
  rind: '#00ff00',           // full-green melon, no detail
  marker: 'rgba(255,255,255,0.35)',
};

const GRID_SPACING = 100; // world px between grid lines
// Racing camera: the melon rides at 38% from the trailing edge, not
// center — backward vision is worthless, so the same window buys ~25%
// more forward reaction time. Purely presentational; the sim never
// sees the camera.
// Camera floors: small screens bind on these guarantees and zoom in;
// the min(1, ...) cap keeps desktop at native 1:1 (its original view,
// by explicit preference). Mobile floors tightened from the original
// 10m/16m to bring phones ~33% closer.
// Compact screens (phone landscape: h < 500 CSS px) bind on tighter
// floors (7.5m/14.5m -> ~33% closer); everything else uses the
// ORIGINAL floors (10m/16m) — a mid-size desktop window binds
// exactly as it always did (the tightened-floors-for-all version
// measurably zoomed windowed desktops too).
const COMPACT_H_PX = 500;
const MIN_H_M_COMPACT = 7.5, MIN_W_M_COMPACT = 14.5;
const MIN_H_M_FULL = 10, MIN_W_M_FULL = 16;
const MELON_SCREEN_FRAC = 0.38; // original anchor: ~10m lookahead on phones

// Bot palette: each melon its own bright shade (player stays pure green).
// Indexed by spawn order, so a bot keeps its color for the whole race.
const BOT_PALETTE = [
  // Eleven greens, L*-NORMALIZED into [54, 74]: every bot guarantees
  // >=20 L* of highlight headroom, so the constant-contrast solver in
  // litColor can hit its full delta on all of them (the old palette
  // had L*93 pale limes with nowhere brighter to go — measured as the
  // "subtle on some melons" complaint). Hues span the green family
  // 78-164deg; the player's pure #00ff00 stays sacred and out-brights
  // them all.
  '#90c710', '#6bb31a', '#56c516', '#37a01c', '#1bc01b', '#24a93f',
  '#17ce54', '#25965a', '#20b378', '#22a07e', '#608e24',
];

// Reused per-frame list of interpolated body poses (no per-frame GC).
const drawList = [];

// Canonical racer color by body index (players in slot order, then
// bots) — shared with the debris system so every melon's pulp wears
// its own green. Presentation-only; the sim never reads colors.
window.FF.racerColor = function (state, bodyIndex) {
  const np = state.players.length;
  if (bodyIndex < np) {
    const pb = state.players[bodyIndex] && state.players[bodyIndex].melon;
    return (pb && pb.bodyColor) || PLAYER_PALETTE[bodyIndex % PLAYER_PALETTE.length];
  }
  const body = state.bots[bodyIndex - np] && state.bots[bodyIndex - np].melon;
  const species = (window.FF.FRUITS && body && window.FF.FRUITS[body.fruit]) || null;
  const pal = species ? species.bots : BOT_PALETTE;
  return pal[(bodyIndex - np) % pal.length];
};

// Canonical player-slot colors: every peer agrees on who wears what.
const PLAYER_PALETTE = ['#00ff00', '#ff2d2d', '#2d8cff', '#ffd22d'];

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
    trackRespawns(state);
    const m = state.melon, p = state.prevMelon;

    // Interpolated body pose for this frame.
    const ix = p.x + (m.x - p.x) * alpha;
    const iy = p.y + (m.y - p.y) * alpha;
    const iangle = p.angle + (m.angle - p.angle) * alpha;

    // ---- Zoom: guarantee a minimum visible BOX of world ----
    // At least 10m vertically AND 16m horizontally on every device.
    // Windows short in either axis zoom OUT until the floor fits;
    // larger windows stay at native 1:1 and simply see more world.
    // The box floor (vs an exact letterboxed window) keeps native
    // feel; a fixed 16x10 "ranked view" stays in reserve for serious
    // leaderboards. World coordinates and physics are untouched —
    // this is purely the camera's lens.
    // Guarantee-style zoom: small screens bind on a floor and zoom in;
    // large screens cap at native 1:1. Typical phone (844x390): zoom
    // 0.52 -> 16.2m x 7.5m view, melons +33% vs the original mobile.
    // Desktop 1080p: zoom 1 -> 19.2m x 10.8m, exactly the original.
    const compact = height < COMPACT_H_PX;
    const mh = compact ? MIN_H_M_COMPACT : MIN_H_M_FULL;
    const mw = compact ? MIN_W_M_COMPACT : MIN_W_M_FULL;
    const zoom = Math.min(1, height / (mh * 100), width / (mw * 100));

    // ---- Camera: forward-biased on x, centered on y ----
    // Target puts the melon at MELON_SCREEN_FRAC of screen width;
    // cameraLerp (tuning panel, Feel group) is the catch-up knob —
    // low = long dreamy lag, high = locked. Vertical stays centered:
    // jump arcs need vision both ways.
    const cam = state.camera;
    const targetX = ix + (0.5 - MELON_SCREEN_FRAC) * width / zoom;
    if (!cam.initialized) {
      cam.x = targetX;
      cam.y = iy;
      cam.initialized = true;
    } else {
      const k = Math.min(1, CONFIG.cameraLerp * dtFrame);
      cam.x += (targetX - cam.x) * k;
      cam.y += (iy - cam.y) * k;
    }
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
    // Build the ground path once: fill it, then reuse it as a CLIP so
    // the terrain's own grid draws only inside the ground.
    ctx.beginPath();
    for (const poly of state.terrain) {
      ctx.moveTo(toScreenX(poly[0].x), toScreenY(poly[0].y));
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(toScreenX(poly[i].x), toScreenY(poly[i].y));
      }
      // Close down to the bottom of the screen to fill the ground.
      ctx.lineTo(toScreenX(poly[poly.length - 1].x), height);
      ctx.lineTo(toScreenX(poly[0].x), height);
      ctx.closePath();
    }
    ctx.fillStyle = COLORS.ground;
    ctx.fill();

    // Terrain grid: 2m squares (vs the background's 1m), world-anchored
    // to the same origin so every terrain line coincides with every
    // other background line — the two grids read as one system at two
    // densities, and the density change itself marks the surface.
    ctx.save();
    ctx.clip();
    drawTerrainGrid(ctx, cam, width, height, groundScreenY, zoom);
    ctx.restore();

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

    // ---- Trackside billboards (world furniture; flow-safe) ----
    window.FF.boards.draw(ctx, state, cam, width, toScreenX, toScreenY, zoom);
    window.FF.boards.updateSponsorLine(state);

    // ---- Stains: soaked into the ground, under everything ----
    drawStains(ctx, state, cam, width, toScreenX, toScreenY, zoom);

    // ---- Ghosts: translucent rivals behind the living ----
    window.FF.ghost.draw(ctx, state, cam, toScreenX, toScreenY, zoom);

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
        melon: gm,
        x: gp.x + (gm.x - gp.x) * alpha,
        y: gp.y + (gm.y - gp.y) * alpha,
        angle: gp.angle + (gm.angle - gp.angle) * alpha,
        color: window.FF.racerColor(state, state.players.length + i),
        fx: null,
        name: gm.name,
      });
    }
    // Remote players (canonical slot colors), then the local player
    // last so it draws on top of everyone.
    for (let i = 0; i < state.players.length; i++) {
      if (i === state.localSlot) continue;
      const pl = state.players[i];
      if (!pl.melon.alive) continue;
      const gm = pl.melon, gp = pl.prevMelon;
      drawList.push({
        melon: gm,
        x: gp.x + (gm.x - gp.x) * alpha,
        y: gp.y + (gm.y - gp.y) * alpha,
        angle: gp.angle + (gm.angle - gp.angle) * alpha,
        color: PLAYER_PALETTE[i % PLAYER_PALETTE.length],
        fx: null,
        name: gm.name,
      });
    }
    if (state.melon.alive) {
      drawList.push({
        melon: state.melon,
        x: ix, y: iy, angle: iangle,
        // The sacred #00ff00 retires from the BODY (it fought the
        // light marble bands); the player's body wears the palette
        // green their persistent melon's seed picked — Gerald's green
        // is Gerald's. Identity lives in the nameplate now.
        color: state.melon.bodyColor || PLAYER_PALETTE[state.localSlot % PLAYER_PALETTE.length],
        fx: state.fx, isPlayer: true,
        name: state.melon.name,
      });
    }

    // Race places: 1 = furthest along in ABSOLUTE space (true race
    // progress — a body one lap ahead ranks ahead even when its image
    // is drawn right beside you). Ranked over the FULL roster, dead
    // racers included: a smashed melon's x is frozen exactly where it
    // will respawn, so its competitive position is continuous. Ranking
    // only the living made everyone behind a corpse flicker up a place
    // for 0.5s (measured bug: "7th -> 6th -> 7th with no overtake").
    // Sim x (not interpolated) keeps ties stable within a frame.
    const roster = [];
    for (const pl of state.players) roster.push(pl.melon);
    for (const b of state.bots) roster.push(b.melon);
    roster.sort((a, b) => b.x - a.x);
    const placeOf = new Map();
    for (let rank = 0; rank < roster.length; rank++) placeOf.set(roster[rank], rank + 1);
    for (const d of drawList) d.place = placeOf.get(d.melon);

    for (const d of drawList) {
      // Periodic world: draw each body at its image nearest the camera,
      // so rivals laps apart still appear on the shared circuit.
      let dxw = d.x, dyw = d.y;
      if (state.period) {
        const k = Math.round((d.x - cam.x) / state.period.L);
        if (k !== 0) { dxw -= k * state.period.L; dyw -= k * state.period.D; }
      }
      const sx = toScreenX(dxw), sy = toScreenY(dyw);
      // Nameplate: x tracks the fruit, y anchors to the terrain
      // surface — a shadow-label that stays calmly in the floor while
      // its fruit tumbles through the air above it.
      if (d.name) {
        const wy = terrainYAt(state.terrain, dxw);
        if (wy !== null) {
          ctx.font = '700 14px "Geist Mono", ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          // Bots wear seeded BRIGHT name colors (the melons are all
          // green now, so the names carry the color identity instead);
          // the player's name keeps their sacred green.
          ctx.fillStyle = d.isPlayer ? '#00ff00' : nameColor(d.name); // sacred green lives HERE now
          ctx.fillText(d.name, sx, toScreenY(wy) + 34 + Math.round(150 * zoom));
        }
      }
      // ---- Cast shadow: the body's ellipse projected sunward onto
      // the terrain, stretching along the light, fading with height.
      if (RIG.P.castShadow) {
        const wyG = terrainYAt(state.terrain, dxw);
        if (wyG !== null) {
          const hM = Math.max(0, (wyG - (dyw + d.melon.b)) / 100);
          if (hM < RIG.P.castMaxM) {
            const s2 = RIG.sun();
            const fade = 1 - hM / RIG.P.castMaxM;
            const sxG = toScreenX(dxw + (wyG - dyw) * (s2.x / Math.max(0.25, -s2.y) || 0) * 0.35);
            const grow = 1 + hM * 0.25;
            ctx.save();
            ctx.globalAlpha = RIG.P.castAlpha * fade;
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.ellipse(sxG, toScreenY(wyG), d.melon.a * RIG.P.castStretch * grow * zoom,
              d.melon.b * 0.32 * grow * zoom, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
      // ---- Speed smear: stretch along velocity above the threshold ----
      let smeared = false;
      if (RIG.P.smear) {
        const vv = Math.sqrt(d.melon.vx * d.melon.vx + d.melon.vy * d.melon.vy);
        if (vv > RIG.P.smearThresh) {
          const k = Math.min(1, (vv - RIG.P.smearThresh) / RIG.P.smearThresh) * RIG.P.smearAmount;
          const va = Math.atan2(d.melon.vy, d.melon.vx);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(va);
          ctx.scale(1 + k, 1 - k * 0.6);
          ctx.rotate(-va);
          ctx.translate(-sx, -sy);
          smeared = true;
        }
      }
      drawMelon(ctx, sx, sy, d.angle, d.fx, d.color, zoom, d.melon.patKey || d.name || d.color, d.melon.a, d.melon.b, d.melon.fruit);
      // ---- Contact shadow: the body darkens near its ground touch ----
      if (RIG.P.contactShadow) {
        const wyG = terrainYAt(state.terrain, dxw);
        if (wyG !== null) {
          const hM = Math.max(0, (wyG - (dyw + d.melon.b)) / 100);
          if (hM < RIG.P.contactMaxM) {
            const fade = 1 - hM / RIG.P.contactMaxM;
            const az = d.melon.a * zoom, bz = d.melon.b * zoom;
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(sx, sy, az, bz, d.angle, 0, Math.PI * 2);
            ctx.clip();
            ctx.globalAlpha = RIG.P.contactAlpha * fade;
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.ellipse(sx, sy + bz * (1 - RIG.P.contactFrac), az * 1.1,
              bz * RIG.P.contactFrac * 2.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
      if (smeared) ctx.restore();
      // ---- Impact star: a drawn burst on the hit flash's leading edge ----
      if (RIG.P.impactStar && d.isPlayer && state.fx.flash > 0.55) {
        const R = d.melon.b * zoom * RIG.P.impactSize * (0.7 + state.fx.flash * 0.5);
        ctx.save();
        ctx.globalAlpha = Math.min(1, (state.fx.flash - 0.55) * 3);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const t = (i / 16) * Math.PI * 2;
          const rr = i % 2 === 0 ? R : R * 0.44;
          const px2 = sx + Math.cos(t) * rr, py2 = sy + Math.sin(t) * rr;
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // Near-miss flash: white overlay that decays fast. Flash, not
      // squash — the survival warning must read differently from
      // ordinary impact juice.
      if (d.isPlayer && state.fx.flash > 0.02) {
        ctx.globalAlpha = state.fx.flash;
        drawMelon(ctx, sx, sy, d.angle, d.fx, '#ffffff', zoom, d.melon.patKey || d.name || d.color, d.melon.a, d.melon.b, d.melon.fruit);
        ctx.globalAlpha = 1;
      }
      drawPlace(ctx, sx, sy, d.place, zoom);
    }

    // ---- Speed lines: streaks behind the player at terminal pace ----
    if (RIG.P.speedLines && state.melon.alive) {
      const vv = Math.sqrt(state.melon.vx * state.melon.vx + state.melon.vy * state.melon.vy);
      if (vv > RIG.P.speedThresh) {
        const k = Math.min(1, (vv - RIG.P.speedThresh) / RIG.P.speedThresh);
        const va = Math.atan2(state.melon.vy, state.melon.vx);
        const cx2 = toScreenX(state.melon.x), cy2 = toScreenY(state.melon.y);
        ctx.save();
        ctx.globalAlpha = 0.28 * k;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const off = (i - 2) * 16;
          const ox = -Math.sin(va) * off, oy = Math.cos(va) * off;
          const len = (40 + (i % 3) * 26) * k * zoom;
          ctx.beginPath();
          ctx.moveTo(cx2 + ox - Math.cos(va) * d0(i), cy2 + oy - Math.sin(va) * d0(i));
          ctx.lineTo(cx2 + ox - Math.cos(va) * (d0(i) + len), cy2 + oy - Math.sin(va) * (d0(i) + len));
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    function d0(i) { return 60 + (i * 13) % 30; }

    // Respawn smoke LAST in the body layer: the poof sits on top and
    // the reborn melon falls out beneath it.
    drawPuffs(ctx, state, cam, width, height, toScreenX, toScreenY, zoom);
  }

  // Fragment dress by kind: 0 fleck, 1 chunk, 2 rind, 3 slab.
  const FRAG_COLOR = ['#ff6b7d', '#ff4757', '#0f8f3a', '#0c7a31'];
  const STAIN_COLOR = 'rgba(24, 18, 20, 0.6)';

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
      ctx.fillStyle = f.col || FRAG_COLOR[f.kind] || FRAG_COLOR[0];
      if (f.verts) {
        // Irregular seeded shard: vertices in units of r.
        ctx.beginPath();
        ctx.moveTo(f.verts[0] * f.r, f.verts[1] * f.r);
        for (let i = 2; i < f.verts.length; i += 2) {
          ctx.lineTo(f.verts[i] * f.r, f.verts[i + 1] * f.r);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // No shard geometry (balloon confetti): rectangles — paper IS square.
        ctx.fillRect(-f.r, -f.r * 0.7, f.r * 2, f.r * 1.4);
      }
      ctx.restore();
    }
  }

  // Stains: the smash's liquid, soaked into the ground. Drawn under
  // debris and bodies, clipped visually by being flattened onto the
  // surface line. Persist per race like everything else.
  function drawStains(ctx, state, cam, w, toScreenX, toScreenY, zoom) {
    const stains = window.FF.debris.stains;
    if (!stains.length) return;
    const period = state.period;
    ctx.fillStyle = STAIN_COLOR;
    for (const s of stains) {
      let sx0 = s.x, sy0 = s.y;
      if (period) {
        const k = Math.round((s.x - cam.x) / period.L);
        if (k !== 0) { sx0 -= k * period.L; sy0 -= k * period.D; }
      }
      const sx = toScreenX(sx0);
      if (sx < -80 || sx > w + 80) continue;
      const sy = toScreenY(sy0);
      // Main splat + two seeded satellites: an irregular soak, not a disc.
      const r = s.r * zoom;
      ctx.beginPath();
      ctx.ellipse(sx, sy + 2 * zoom, r, r * 0.28, 0, 0, Math.PI * 2);
      const j1 = (s.seed % 17) / 17 - 0.5, j2 = ((s.seed >> 4) % 13) / 13 - 0.5;
      ctx.ellipse(sx + j1 * r * 1.6, sy + 2 * zoom, r * 0.45, r * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(sx + j2 * r * 2.2, sy + 2 * zoom, r * 0.3, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Race-place number at the melon's center, in SCREEN space — it never
  // rotates with the body. Geist Mono 400 per the design spec.
  // Place number floats ONE GRID CELL (1m) above the body, in the
  // racer's own color — a label over the fruit, not a tattoo on it.
  function drawPlace(ctx, sx, sy, n, zoom) {
    ctx.font = `400 ${Math.max(9, Math.round(CONFIG.semiMinor * 0.8 * zoom))}px "Geist Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillText(String(n), sx, sy - 100 * zoom);
  }

  function drawMelon(ctx, sx, sy, angle, fx, color, zoom, seedKey, bodyA, bodyB, fruit) {
    const a = bodyA || CONFIG.semiMajor;
    const b = bodyB || CONFIG.semiMinor;

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

    // Cel-shaded body: world-fixed sun, terminator the surface rolls
    // beneath. The rotation that was invisible by design is now
    // readable against the light.
    shadeEllipse(ctx, angle, a, b, color || COLORS.rind, seedKey, fruit);

    ctx.restore();
  }

// ---- Cel lighting: delegated to the RIG (js/shading.js) ----
  // The renderer owns no lighting constants: sun, bands, deltas, and
  // every effect parameter live in FF.shading.P, editable live by the
  // Shader Studio. This file only DRAWS what the rig solves.
  const RIG = window.FF.shading;
  const litColor = (hex) => RIG.bandColor(hex, RIG.P.litDL);
  const hslToRgb = RIG.hslToRgb;

  // ---- Respawn smoke: the cartoon poof ----
  // (Restored after the rig refactor accidentally swept it away with
  // its neighboring constants.) Presentation-tier FX; each ball is
  // cel-shaded by the RIG's sun: grey base, white core sunward.
  const puffs = [];
  let puffPrevAlive = [];

  function trackRespawns(state) {
    const bodies = [];
    for (const pl of state.players) bodies.push(pl.melon);
    for (const bt of state.bots) bodies.push(bt.melon);
    for (let i = 0; i < bodies.length; i++) {
      const m = bodies[i];
      if (m.alive && puffPrevAlive[i] === false && state.tick > 10) {
        spawnPuff(m.x, m.y, state.tick);
      }
      puffPrevAlive[i] = m.alive;
    }
    if (puffPrevAlive.length > bodies.length) puffPrevAlive.length = bodies.length;
  }

  function spawnPuff(x, y, tick) {
    const balls = [];
    const n = 11 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.7) * 46;
      balls.push({
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist * 0.8,
        r: 10 + Math.pow(Math.random(), 1.6) * 34,
        vx: Math.cos(ang) * (12 + Math.random() * 38),
        vy: Math.sin(ang) * (10 + Math.random() * 28) - 22, // smoke rises, gently
        life: 0.7 + Math.random() * 0.5,
      });
    }
    puffs.push({ x, y, born: tick, balls });
    if (puffs.length > 24) puffs.shift();
  }

  function drawPuffs(ctx, state, cam, w, h, toScreenX, toScreenY, zoom) {
    if (!puffs.length) return;
    const period = state.period;
    for (let p = puffs.length - 1; p >= 0; p--) {
      const puff = puffs[p];
      const age = (state.tick - puff.born) / 120;
      if (age > 1.25) { puffs.splice(p, 1); continue; }
      let px = puff.x, py = puff.y;
      if (period) {
        const k = Math.round((puff.x - cam.x) / period.L);
        if (k !== 0) { px -= k * period.L; py -= k * period.D; }
      }
      const sx0 = toScreenX(px), sy0 = toScreenY(py);
      if (sx0 < -140 || sx0 > w + 140) continue;
      for (const bl of puff.balls) {
        const t = age / bl.life;
        if (t >= 1) continue;
        const grow = Math.min(1, t / 0.18);
        const shrink = 1 - Math.max(0, (t - 0.5) / 0.5);
        const r = bl.r * grow * shrink * zoom;
        if (r < 0.6) continue;
        const bx = sx0 + (bl.dx + bl.vx * age) * zoom;
        const by = sy0 + (bl.dy + bl.vy * age) * zoom;
        ctx.save();
        ctx.globalAlpha = 0.95 * Math.min(1, (1 - t) * 4);
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = '#e2e2e2';
        ctx.fill();
        ctx.clip();
        const sn = RIG.sun();
        ctx.beginPath();
        ctx.arc(bx + sn.x * r * 0.38, by + sn.y * r * 0.38, r * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---- Full-spectrum nameplate colors with SOLVED contrast ----
  // (Also restored.) Golden-angle hue spread; lightness binary-searched
  // to WCAG AA 4.5:1 against the terrain grey.
  const nameColorCache = new Map();
  const TERRAIN_Y = 0.0423;
  const NAME_CONTRAST = 4.5;
  function nameColor(name) {
    let c = nameColorCache.get(name);
    if (c) return c;
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    const hue = ((h >>> 0) % 36) * 137.508 % 360;
    const Yt = (TERRAIN_Y + 0.05) * NAME_CONTRAST - 0.05;
    const lum = (rgb) => {
      const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    let lo = 0.35, hi = 0.97;
    let rgb;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      rgb = hslToRgb(hue, 0.95, mid);
      if (lum(rgb) < Yt) lo = mid; else hi = mid;
    }
    rgb = hslToRgb(hue, 0.95, hi);
    c = '#' + ((1 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).toString(16).slice(1);
    nameColorCache.set(name, c);
    return c;
  }

  function shadeEllipse(ctx, angle, a, b, baseColor, seedKey, fruit) {
    const TAU2 = Math.PI * 2;
    const B = RIG.bands();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, angle, 0, TAU2);
    // Darkest region first: core shadow (when on) else base.
    const hasShadowBand = B.length && B[0].baseDL !== undefined;
    ctx.fillStyle = hasShadowBand ? RIG.bandColor(baseColor, B[0].baseDL) : baseColor;
    ctx.fill();
    ctx.clip();

    // Bands darkest -> brightest: each fills its solved iso region.
    for (const band of B) {
      const fillCol = band.baseDL !== undefined
        ? baseColor // the shadow band's iso region IS the base region
        : RIG.bandColor(baseColor, band.dL);
      const iso = RIG.isoContour(angle, a, b, band.tau);
      if (!iso) continue;
      ctx.fillStyle = fillCol;
      ctx.beginPath();
      if (iso.full) {
        ctx.ellipse(0, 0, a, b, angle, 0, TAU2);
      } else {
        for (let i = 0; i < iso.pts.length; i++) {
          const p = iso.pts[i];
          if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
      }
      ctx.fill();
    }

    // ---- The rind raster: wrap-once, rotate-forever ----
    // The pattern layer (stripes / net / crackle) is rendered ONCE per
    // racer into an offscreen canvas in the BODY frame (2x supersampled
    // for crispness under devicePixelRatio), then every frame is just
    // this rotated drawImage. Possible because our melons rotate only
    // in the screen plane: the visible hemisphere never changes, so
    // the spheroid warp is baked at build time. The Lambert cap stays
    // vector and world-fixed above the base fill (sun doesn't rotate);
    // the pattern rides on top, translucent over base AND lit alike.
    // This is also the future texture pipe: a hand-painted rind map is
    // just another way to fill the offscreen.
    const raster = patternRaster(seedKey || baseColor, fruit, a, b);
    if (raster) {
      ctx.save();
      ctx.rotate(angle);
      ctx.drawImage(raster.canvas, -raster.w / 2, -raster.h / 2, raster.w, raster.h);
      ctx.restore();
    }

    // ---- Rim light: bright crescent hugging the anti-sun silhouette ----
    if (RIG.P.rim) {
      const { tPeak, halfSpan } = RIG.rimArc(angle, a, b);
      const w = RIG.P.rimWidth;
      const caA = Math.cos(angle), saA = Math.sin(angle);
      ctx.beginPath();
      const N = 26;
      for (let i = 0; i <= N; i++) {
        const t = tPeak - halfSpan + (i / N) * 2 * halfSpan;
        const x = a * Math.cos(t), y = b * Math.sin(t);
        const wx = x * caA - y * saA, wy = x * saA + y * caA;
        if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      for (let i = N; i >= 0; i--) {
        const t = tPeak - halfSpan + (i / N) * 2 * halfSpan;
        const x = (a - w) * Math.cos(t), y = (b - w) * Math.sin(t);
        ctx.lineTo(x * caA - y * saA, x * saA + y * caA);
      }
      ctx.closePath();
      ctx.fillStyle = RIG.bandColor(baseColor, RIG.P.rimDL);
      ctx.fill();
    }

    // ---- Specular ping: a glint only when the pose aligns ----
    if (RIG.P.specular) {
      const sp = RIG.specPoint(angle, a, b);
      if (sp.peak > RIG.P.specTau && sp.z > 0) {
        const r0 = b * RIG.P.specSize
          * Math.min(1, (sp.peak - RIG.P.specTau) / (1 - RIG.P.specTau) + 0.35);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r0, 0, TAU2);
        ctx.fillStyle = RIG.bandColor(baseColor, RIG.P.specDL);
        ctx.fill();
      }
    }

    ctx.restore(); // body clip ends here

    // ---- Ink: outline drawn over everything, outside the clip ----
    if (RIG.P.inkMode !== 'none') {
      ctx.strokeStyle = RIG.shadeHex(baseColor, RIG.P.inkDarkK);
      ctx.lineCap = 'round';
      if (RIG.P.inkMode === 'silhouette') {
        ctx.lineWidth = RIG.P.inkWidth;
        ctx.beginPath();
        ctx.ellipse(0, 0, a, b, angle, 0, TAU2);
        ctx.stroke();
      } else {
        // Weighted: thick on the shadow side, hairline on the lit —
        // the hand-drawn tell.
        const { tPeak, halfSpan } = RIG.rimArc(angle, a, b);
        const caA = Math.cos(angle), saA = Math.sin(angle);
        const seg = (t0, t1, w2) => {
          ctx.lineWidth = w2;
          ctx.beginPath();
          const N = 30;
          for (let i = 0; i <= N; i++) {
            const t = t0 + (i / N) * (t1 - t0);
            const x = a * Math.cos(t), y = b * Math.sin(t);
            const wx = x * caA - y * saA, wy = x * saA + y * caA;
            if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        };
        const span = Math.max(halfSpan, 0.6);
        seg(tPeak - span, tPeak + span, RIG.P.inkWidth);
        seg(tPeak + span, tPeak + 2 * Math.PI - span, RIG.P.inkWidth * 0.4);
      }
    }
  }

  // ---- Seeded 2D gradient (Perlin) noise + fBm ----
  // Bake-time only (the raster pipeline makes per-pixel noise free).
  // Seeded permutation per racer: every marble is unique, and the
  // same racer marbles identically on every peer and ghost.
  function makeNoise2(seed) {
    const rng = window.FF.mulberry32(seed >>> 0);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const grad = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
        case 4: return x; case 5: return -x; case 6: return y; default: return -y;
      }
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const noise = (x, y) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
      const l1 = grad(aa, x, y) + u * (grad(ba, x - 1, y) - grad(aa, x, y));
      const l2 = grad(ab, x, y - 1) + u * (grad(bb, x - 1, y - 1) - grad(ab, x, y - 1));
      return l1 + v * (l2 - l1); // ~[-1, 1]
    };
    const fbm = (x, y, oct) => {
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let o = 0; o < oct; o++) { s += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
      return s / norm;
    };
    return { noise, fbm };
  }

  // Build (and cache) a racer's pattern layer as an offscreen raster.
  const RSCALE = 2; // supersample factor
  const rasterCache = new Map();
  function patternRaster(key, fruit, a, b) {
    const species = fruit || 'watermelon';
    const ck = key + '|' + species + '|' + (a | 0);
    let rst = rasterCache.get(ck);
    if (rst !== undefined) return rst;
    if (typeof document === 'undefined') { rasterCache.set(ck, null); return null; }
    const pad = 4; // stroke overhang room (body clip trims at draw time)
    const w = Math.ceil(a * 2) + pad * 2, h = Math.ceil(b * 2) + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = w * RSCALE; cv.height = h * RSCALE;
    const octx = cv.getContext('2d');
    octx.scale(RSCALE, RSCALE);
    octx.translate(w / 2, h / 2);
    if (species === 'cantaloupe') drawNet(octx, a, b, key);
    else if (species === 'honeydew') drawCrackle(octx, a, b, key);
    else buildMarbleStripes(octx, cv, a, b, key, w, h);
    rst = { canvas: cv, w, h };
    rasterCache.set(ck, rst);
    return rst;
  }

  // ---- Watermelon marble stripes: domain-warped noise banding ----
  // The hydromelon look, honestly constructed. The botanical stripe
  // SCAFFOLD survives (meridian centers converging at the poles; the
  // per-pixel inverse projection u=acos(x/a), k=y/(b sin u) IS the
  // exact foreshortening), but the band boundaries are warped by
  // fractal Brownian motion: a large octave makes stripes wander and
  // swell; a high-frequency octave TEARS the edges and calves off
  // marbled islands — the camouflage speckle. Bands render LIGHT over
  // the base (pale warm cream, riding over lit and shadow alike).
  function buildMarbleStripes(octx, cv, a, b, key, w, h) {
    let hsh = 2166136261;
    for (let i = 0; i < key.length; i++) { hsh ^= key.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    const rng = window.FF.mulberry32(hsh >>> 0);
    const nz = makeNoise2((hsh ^ 0x51CE) >>> 0);
    const nStripes = 5 + (rng() * 2 | 0);
    const centers = [];
    for (let i = 0; i < nStripes; i++) {
      centers.push((i + 0.5) / nStripes * Math.PI + (rng() - 0.5) * 0.22);
    }
    // Proof-tuned (three-round PIL bracket, 2026-08-08): band duty
    // ~45% — fat hydromelon bands with legible dark gaps between.
    const halfW = (0.58 + rng() * 0.14) * (Math.PI / nStripes) / 2; // band half-width in longitude
    const warpA = 0.4 + rng() * 0.18;   // large-scale wander amplitude
    const tearA = 1.0 + rng() * 0.3;    // STRONG tears: bands pinch clean apart
    const fU = 0.55 + rng() * 0.3, fP = 0.5 + rng() * 0.25; // warp frequencies
    const off1 = rng() * 40, off2 = rng() * 40, off3 = rng() * 40, off4 = rng() * 40;
    const alpha = Math.round(255 * 0.30);

    const img = octx.createImageData(cv.width, cv.height);
    const data = img.data;
    for (let py = 0; py < cv.height; py++) {
      for (let px = 0; px < cv.width; px++) {
        const x = px / RSCALE - w / 2, y = py / RSCALE - h / 2;
        const ex = x / a, ey = y / b;
        if (ex * ex + ey * ey > 1) continue; // outside the body
        // Inverse spheroid projection (exact foreshortening):
        const u = Math.acos(Math.max(-1, Math.min(1, ex)));
        const su = Math.sin(u);
        const k = su < 0.04 ? 0 : Math.max(-1, Math.min(1, ey / su));
        const phi = Math.acos(k); // longitude in [0, PI]
        // Domain warp: boundaries wander organically.
        const wPhi = phi + warpA * nz.fbm(u * fU * 2 + off1, phi * fP * 2, 3);
        // Distance to nearest stripe center, torn by high-freq noise.
        let d = 1e9;
        for (const c of centers) { const dd = Math.abs(wPhi - c); if (dd < d) d = dd; }
        const tear = 1 + tearA * nz.fbm(u * 1.6 + off2, phi * 1.45, 2); // chunky tears, rounded
        // Three-layer detail (the hydromelon grammar): bands that
        // BREAK (tear can pinch width to nothing), interior HOLES
        // (bare patches inside bands), and detached ISLANDS hugging
        // the band edges.
        let paint = false;
        if (d < halfW * tear) {
          paint = nz.fbm(u * 3.0 + off3, phi * 2.7, 2) <= 0.24; // holes (rounded)
        } else if (d < halfW * (tear + 1.2)) {
          paint = nz.fbm(u * 3.4 + off4, phi * 3.0, 2) > 0.30;  // islands (rounded)
        }
        if (paint) {
          const idx = (py * cv.width + px) * 4;
          data[idx] = 255; data[idx + 1] = 252; data[idx + 2] = 235; // pale warm cream
          data[idx + 3] = alpha;
        }
      }
    }
    octx.save();
    octx.setTransform(1, 0, 0, 1, 0, 0); // putImageData ignores transforms; be explicit
    octx.putImageData(img, 0, 0);
    octx.restore();
  }

  // The melon generator: a seeded stripe-pattern spec per racer.
  // The melon generator: a seeded stripe-pattern spec per racer.
  // Two line families on the spheroid, both body-fixed so the net
  // tumbles with the fruit and foreshortens truthfully:
  //  * light MERIDIANS: the stripe geometry inverted — thin, pale,
  //    numerous (raised net is LIGHTER than skin, watermelon's
  //    inverse), wavy-edged;
  //  * LATITUDE RINGS: circles of constant polar angle project to
  //    straight chords perpendicular to the major axis — the
  //    crosshatch's other direction, for free from the geometry;
  //  * faint darker MOTTLE blotches, seeded.
  // Cached per racer as baked Path2D geometry (body frame): the whole
  // organic web costs THREE fills per melon per frame.
  const netCache = new Map();
  function netPaths(key, a, b) {
    const ck = key + '|' + (a | 0);
    let p = netCache.get(ck);
    if (p) return p;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rng = window.FF.mulberry32(h >>> 0);
    const surf = (u, phi) => [a * Math.cos(u), b * Math.sin(u) * Math.cos(phi)];

    // Mottle: blobby darker patches, varied sizes.
    const mottle = new Path2D();
    const nB = 11 + (rng() * 5 | 0);
    for (let i = 0; i < nB; i++) {
      const mt = rng() * 6.28, mk = rng() * 0.9;
      const mx = a * mk * Math.cos(mt), my = b * mk * Math.sin(mt);
      const mr = 4 + rng() * 10, ph = rng() * 6.28, sq = 0.6 + rng() * 0.4;
      // Smooth blob: quadratic curves through vertex midpoints.
      const bp = [];
      for (let j = 0; j < 9; j++) {
        const t = (j / 9) * 6.28;
        const rr = mr * (1 + 0.3 * Math.sin(3 * t + ph));
        bp.push([mx + rr * Math.cos(t), my + rr * sq * Math.sin(t)]);
      }
      mottle.moveTo((bp[0][0] + bp[8][0]) / 2, (bp[0][1] + bp[8][1]) / 2);
      for (let j = 0; j < 9; j++) {
        const nx2 = bp[(j + 1) % 9];
        mottle.quadraticCurveTo(bp[j][0], bp[j][1], (bp[j][0] + nx2[0]) / 2, (bp[j][1] + nx2[1]) / 2);
      }
      mottle.closePath();
    }

    // Sutures: a few wavering full-meridian grooves, faintly darker.
    const sutures = new Path2D();
    const nS = 3 + (rng() * 2 | 0);
    for (let j = 0; j < nS; j++) {
      const phi0 = -1.0 + (j / Math.max(1, nS - 1)) * 2.0 + (rng() - 0.5) * 0.3;
      const ph = rng() * 6.28;
      for (let pass = 0; pass < 2; pass++) {
        const off = (pass === 0 ? -1 : 1) * 0.014;
        for (let q = 0; q <= 16; q++) {
          const qq = pass === 0 ? q : 16 - q;
          const u = (qq / 16) * Math.PI;
          const wav = 0.06 * Math.sin(3 * u + ph);
          const pt = surf(u, phi0 + wav + off);
          if (pass === 0 && q === 0) sutures.moveTo(pt[0], pt[1]);
          else sutures.lineTo(pt[0], pt[1]);
        }
      }
      sutures.closePath();
    }

    // THE NET: jittered mesh on the surface — nodes displaced hard,
    // edges as wandering midpoint-displaced polylines with per-edge
    // and per-segment thickness variation, ~13% dropout so the web
    // breaks, occasional diagonals to kill the quad rhythm. Nothing
    // straight anywhere; foreshortening free from the surface param.
    // Ridges as STROKED polylines in three width buckets — round caps
    // and joins give the web its soft, corky edge (the filled-quad
    // version had hard corners at every segment joint).
    const ridges = { fine: new Path2D(), mid: new Path2D(), bold: new Path2D() };
    const NU = 8, NF = 6, MARG = 0.28, PHIMAX = 1.2;
    const nodes = [];
    for (let iu = 0; iu < NU; iu++) {
      nodes.push([]);
      for (let jf = 0; jf < NF; jf++) {
        const u = Math.max(0.08, Math.min(Math.PI - 0.08,
          MARG + (iu + (rng() - 0.5) * 0.64) / (NU - 1) * (Math.PI - 2 * MARG)));
        const phi = -PHIMAX + (jf + (rng() - 0.5) * 0.64) / (NF - 1) * 2 * PHIMAX;
        nodes[iu].push([u, phi]);
      }
    }
    const edge = (p0, p1) => {
      if (rng() < 0.13) return; // broken web
      const [u0, f0] = p0, [u1, f1] = p1;
      const wbase = 1.1 + rng() * 1.5;
      const path = wbase < 1.6 ? ridges.fine : wbase < 2.1 ? ridges.mid : ridges.bold;
      // Smooth wandering polyline: jittered control points joined by
      // quadratic curves through midpoints — no corners anywhere.
      const pts = [];
      for (let s = 0; s <= 4; s++) {
        let u = u0 + (u1 - u0) * (s / 4);
        let f = f0 + (f1 - f0) * (s / 4);
        if (s > 0 && s < 4) { u += (rng() - 0.5) * 0.1; f += (rng() - 0.5) * 0.18; }
        pts.push(surf(u, f));
      }
      path.moveTo(pts[0][0], pts[0][1]);
      for (let s = 1; s < 4; s++) {
        const mx = (pts[s][0] + pts[s + 1][0]) / 2, my = (pts[s][1] + pts[s + 1][1]) / 2;
        path.quadraticCurveTo(pts[s][0], pts[s][1], mx, my);
      }
      path.lineTo(pts[4][0], pts[4][1]);
    };
    for (let iu = 0; iu < NU; iu++) {
      for (let jf = 0; jf < NF; jf++) {
        if (iu + 1 < NU) edge(nodes[iu][jf], nodes[iu + 1][jf]);
        if (jf + 1 < NF) edge(nodes[iu][jf], nodes[iu][jf + 1]);
        if (iu + 1 < NU && jf + 1 < NF && rng() < 0.22) edge(nodes[iu][jf], nodes[iu + 1][jf + 1]);
      }
    }
    p = { mottle, sutures, ridges };
    netCache.set(ck, p);
    return p;
  }

  // ---- Honeydew crackle: the hairline vein web ----
  // From the reference photo: honeydew skin carries sparse superficial
  // russeting — thin WANDERING, BRANCHING hairline veins (random walks
  // in surface space, clustered around a seeded region with strays),
  // tiny pore specks, and 2-4 whisper-faint near-meridian streaks.
  // All body-fixed, surface-parameterized (foreshortening free),
  // baked to Path2D per racer: two fills per melon per frame.
  const crackleCache = new Map();
  function cracklePaths(key, a, b) {
    const ck = key + '|' + (a | 0);
    let p = crackleCache.get(ck);
    if (p) return p;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rng = window.FF.mulberry32(h >>> 0);
    const surf = (u, phi) => [a * Math.cos(u), b * Math.sin(u) * Math.cos(phi)];

    const faint = new Path2D(); // streaks live fainter than veins
    const nS = 2 + (rng() * 3 | 0);
    for (let j = 0; j < nS; j++) {
      const phi0 = -1.0 + rng() * 2.0, ph = rng() * 6.28;
      for (let pass = 0; pass < 2; pass++) {
        const off = (pass === 0 ? -1 : 1) * 0.05;
        for (let q = 0; q <= 14; q++) {
          const qq = pass === 0 ? q : 14 - q;
          const u = (qq / 14) * Math.PI;
          const pt = surf(u, phi0 + 0.1 * Math.sin(2 * u + ph) + off);
          if (pass === 0 && q === 0) faint.moveTo(pt[0], pt[1]);
          else faint.lineTo(pt[0], pt[1]);
        }
      }
      faint.closePath();
    }

    // Veins as stroked polylines (two width classes, round caps):
    // smooth quadratic wandering, soft branch tips — no hard corners.
    const veins = { fine: new Path2D(), main: new Path2D() };
    const pores = new Path2D();
    const clU = 0.8 + rng() * 1.5, clF = -0.7 + rng() * 1.4; // crackle cluster
    const walk = (u, fphi, heading, steps, w, depth) => {
      const path = w < 1.1 ? veins.fine : veins.main;
      const pts = [surf(u, fphi)];
      for (let s = 0; s < steps; s++) {
        heading += (rng() - 0.5) * 1.8;
        u = Math.max(0.15, Math.min(Math.PI - 0.15, u + Math.cos(heading) * (0.06 + rng() * 0.08)));
        fphi += Math.sin(heading) * (0.1 + rng() * 0.12);
        pts.push(surf(u, fphi));
        if (depth < 2 && rng() < 0.28 && steps - s > 1) {
          walk(u, fphi, heading + (rng() < 0.5 ? -1.2 : 1.2), steps - s - 1, w * 0.8, depth + 1);
        }
      }
      path.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2) path.lineTo(pts[1][0], pts[1][1]);
      else {
        for (let s = 1; s < pts.length - 1; s++) {
          const mx = (pts[s][0] + pts[s + 1][0]) / 2, my = (pts[s][1] + pts[s + 1][1]) / 2;
          path.quadraticCurveTo(pts[s][0], pts[s][1], mx, my);
        }
        path.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
    };
    const nV = 16 + (rng() * 10 | 0);
    for (let i = 0; i < nV; i++) {
      let u0, f0;
      if (rng() < 0.7) { u0 = clU + (rng() - 0.5) * 1.0; f0 = clF + (rng() - 0.5) * 0.9; }
      else { u0 = 0.3 + rng() * (Math.PI - 0.6); f0 = -1.1 + rng() * 2.2; }
      walk(Math.max(0.15, Math.min(Math.PI - 0.15, u0)), f0, rng() * 6.28,
        2 + (rng() * 4 | 0), 0.8 + rng() * 0.8, 0);
    }
    // pore specks: their own fill layer (already round by nature)
    const nP = 12 + (rng() * 8 | 0);
    for (let i = 0; i < nP; i++) {
      const u0 = 0.2 + rng() * (Math.PI - 0.4), f0 = -1.15 + rng() * 2.3;
      const pt = surf(u0, f0), r0 = 0.7 + rng() * 1.3;
      pores.moveTo(pt[0] + r0, pt[1]);
      pores.arc(pt[0], pt[1], r0, 0, 6.2832);
      pores.closePath();
    }
    p = { faint, veins, pores };
    crackleCache.set(ck, p);
    return p;
  }

  function drawCrackle(ctx, a, b, key) {
    const paths = cracklePaths(key, a, b);
    ctx.save();
    ctx.fillStyle = 'rgba(140, 100, 30, 0.05)';
    ctx.fill(paths.faint);
    ctx.strokeStyle = 'rgba(150, 92, 48, 0.18)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.8; ctx.stroke(paths.veins.fine);
    ctx.lineWidth = 1.4; ctx.stroke(paths.veins.main);
    ctx.fillStyle = 'rgba(150, 92, 48, 0.16)';
    ctx.fill(paths.pores);
    ctx.restore();
  }

  function drawNet(ctx, a, b, key) {
    const paths = netPaths(key, a, b);
    ctx.save();
    ctx.fillStyle = 'rgba(60, 40, 10, 0.09)';
    ctx.fill(paths.mottle);
    ctx.fillStyle = 'rgba(50, 32, 6, 0.10)';
    ctx.fill(paths.sutures);
    // Toward white, not cream: the ridges must survive the lit cap
    // (white contrasts with lit cream via saturation, not lightness).
    ctx.strokeStyle = 'rgba(255, 253, 245, 0.32)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2; ctx.stroke(paths.ridges.fine);
    ctx.lineWidth = 1.9; ctx.stroke(paths.ridges.mid);
    ctx.lineWidth = 2.6; ctx.stroke(paths.ridges.bold);
    ctx.restore();
  }

    window.FF.shadeEllipse = shadeEllipse; // ghosts borrow the same sun
  // The studio's pinned melon: full stack, no state required.
  window.FF.drawMelonStandalone = function (ctx2, angle, a, b, color, seedKey, fruit) {
    shadeEllipse(ctx2, angle, a, b, color, seedKey, fruit);
  };

  const TERRAIN_GRID_SPACING = 200; // world px = 2m squares in the ground

  function drawTerrainGrid(ctx, cam, w, h, groundY, zoom) {
    ctx.strokeStyle = COLORS.terrainGrid;
    ctx.lineWidth = 1; // hairline at every zoom, like the background grid
    ctx.beginPath();
    const spacing = TERRAIN_GRID_SPACING * zoom;
    // Vertical lines: world-anchored, so they scroll with the terrain.
    const span = (w / 2) / zoom;
    const firstX = Math.floor((cam.x - span) / TERRAIN_GRID_SPACING) * TERRAIN_GRID_SPACING;
    for (let wx = firstX; wx < cam.x + span + TERRAIN_GRID_SPACING; wx += TERRAIN_GRID_SPACING) {
      const sx = Math.round((wx - cam.x) * zoom + w / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    // Horizontal lines: anchored to world y (same origin as background).
    const firstY = ((groundY % spacing) + spacing) % spacing;
    for (let sy = firstY; sy < h + spacing; sy += spacing) {
      const y = Math.round(sy) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
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
      // Number only, just under the surface inside the fill (the tick
      // pips were removed by request — the label alone marks distance).
      ctx.fillText(`${wx / 100 | 0}`, sx, sy + 16);
    }
  }

  return { render, resize };
}

Object.assign(window.FF, { createRenderer });
})();
