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
  if (bodyIndex < np) return PLAYER_PALETTE[bodyIndex % PLAYER_PALETTE.length];
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
        color: PLAYER_PALETTE[state.localSlot % PLAYER_PALETTE.length],
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
          ctx.fillStyle = d.isPlayer ? d.color : nameColor(d.name);
          ctx.fillText(d.name, sx, toScreenY(wy) + 34 + Math.round(150 * zoom));
        }
      }
      drawMelon(ctx, sx, sy, d.angle, d.fx, d.color, zoom, d.melon.patKey || d.name || d.color, d.melon.a, d.melon.b, d.melon.fruit);
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

  // ---- Cel lighting: one sun, twelve lit bodies, a flat world ----
  // World-fixed light from the upper-left, hard two-tone terminator
  // plus a thin shadow rim. The lit half-plane is oriented to the
  // GLOBAL light while the clip is the body's ROTATED ellipse — so as
  // the melon rolls, its surface visibly turns beneath a terminator
  // that stays put. Cel-shading as a rotation indicator: orientation
  // is the core mechanic, and the silhouette alone is 180-degree
  // ambiguous. Shading = alive: pulp, debris, and the world stay flat.
  const LIGHT_ANGLE = Math.atan2(-0.8, -0.6); // to the light, upper-left (y-down)
  const LIGHT_X = Math.cos(LIGHT_ANGLE), LIGHT_Y = Math.sin(LIGHT_ANGLE);

  // ---- Lit-color craft: sunlight, not whitewash ----
  // Lighten-toward-white desaturates — that's why naive highlights read
  // chalky. Sunlight on green shifts HUE toward yellow with lightness
  // gained by available headroom and saturation held, so every base in
  // the palette gets a tailored warm highlight: pure green goes juicy
  // yellow-green, deep sea-green gets a fresh bright cap, pale mints
  // brighten gently. Cached per base color.
  const litCache = new Map();
  const LIT_DELTA = 11; // constant perceptual contrast: L*lit = L*base + 11 (softened by request from 16)

  function srgbLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lstarOf(rr, gg, bb) {
    const Y = 0.2126 * srgbLin(rr) + 0.7152 * srgbLin(gg) + 0.0722 * srgbLin(bb);
    return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  }
  function hslToRgb(h, s, l) {
    const C = (1 - Math.abs(2 * l - 1)) * s;
    const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - C / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) { r1 = C; g1 = X; } else if (h < 120) { r1 = X; g1 = C; }
    else if (h < 180) { g1 = C; b1 = X; } else if (h < 240) { g1 = X; b1 = C; }
    else if (h < 300) { r1 = X; b1 = C; } else { r1 = C; b1 = X; }
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
  }

  // CONSTANT-CONTRAST HIGHLIGHT SOLVER. Every melon's lit tone sits
  // exactly LIT_DELTA above its base in CIE L* (perceptual lightness),
  // solved per color by binary search over HSL lightness with the hue
  // pulled toward sunlight yellow. When a base is too bright to grant
  // the full delta (the player's sacred #00ff00), the shortfall is
  // repaid in extra hue shift — hue contrast substitutes for the
  // lightness the headroom can't supply. Cached per base.
  function litColor(hex) {
    let cached = litCache.get(hex);
    if (cached) return cached;
    const n = parseInt(hex.slice(1), 16);
    const rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
    const Lb = lstarOf(rr, gg, bb);
    // Ceiling at L*92, not 98: above ~92 every hue collapses toward
    // white (measured: the player's highlight rendered as paper).
    // Saturation must survive the lift; the hue shift below repays
    // whatever lightness the ceiling withholds.
    const Lt = Math.min(92, Lb + LIT_DELTA);
    const deficit = (Lb + LIT_DELTA) - Lt;

    // base HSL
    const r1 = rr / 255, g1 = gg / 255, b1 = bb / 255;
    const mx = Math.max(r1, g1, b1), mn = Math.min(r1, g1, b1), dd = mx - mn;
    let h = 0;
    const l0 = (mx + mn) / 2;
    const s = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l0 - 1));
    if (dd > 0) {
      if (mx === r1) h = ((g1 - b1) / dd) % 6;
      else if (mx === g1) h = (b1 - r1) / dd + 2;
      else h = (r1 - g1) / dd + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const hueShift = 0.22 + Math.min(0.3, (deficit / LIT_DELTA) * 0.3);
    h = h + (60 - h) * hueShift;

    let lo = l0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const c = hslToRgb(h, s, mid);
      if (lstarOf(c[0], c[1], c[2]) < Lt) lo = mid; else hi = mid;
    }
    const c = hslToRgb(h, s, (lo + hi) / 2);
    cached = '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
    litCache.set(hex, cached);
    return cached;
  }

  // ---- The cap: EXACT ellipsoid Lambert iso-contour ----
  // All-out mode. Each melon is treated as the prolate spheroid it
  // depicts (semi-axes a, b, b). The highlight is the true cel-
  // quantized diffuse region: the set of surface points whose normal
  // satisfies N.L > TAU, solved per frame — brightest point in closed
  // form (u* = normalize(M L): where the ellipsoid's normal aligns
  // with the light), then the iso-contour traced by bisection along
  // 32 spokes on the parameter sphere and projected orthographically.
  // Everything the eye expects EMERGES instead of being tuned: broad
  // flank to the sun -> wide gentle cap; tip into the sun -> the
  // highlight tightens and migrates onto the point, because normals
  // swing faster over high curvature. Cost: ~10k flops per melon per
  // frame — pocket change.
  const LIGHT_LZ = 0.42; // light elevation toward the viewer (cap size)
  const CEL_TAU = 0.52;  // lit where diffuse exceeds this (cap tightness)
  const SHADE_ECC = 1.0; // shading-normal eccentricity boost: 1.0 = honest
  // silhouette keeps its true a/b, but the LIGHTING believes a far
  // pointier spheroid — honest physics at this melon's 1.28 roundness
  // caps the side-vs-tip drama at ~1.7x (measured), so the curvature
  // anisotropy that DRIVES the effect is exaggerated in the shading
  // matrix only. The classic cartoon decoupling: shading normals are
  // not geometric normals. Continuity and light-truth fully retained.
  const SPOKES = 32;

  // ---- Respawn smoke: the cartoon poof ----
  // Presentation-tier FX (never read by the sim; Math.random licensed).
  // On any body's death->alive edge, a cluster of various-sized white
  // balls bursts at the respawn point — which sits 2m above the
  // surface, so the melon literally FALLS OUT beneath the smoke as it
  // drops. Each ball is cel-shaded by the same sun as the melons: a
  // grey base circle with a white core offset toward the light —
  // the offset-circle crescent construction, one more time, in
  // miniature. Balls pop to size fast, drift outward with a rising
  // bias, and shrink away inside a second.
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
        r: 10 + Math.pow(Math.random(), 1.6) * 34, // bigger, wider spread: many mid, few huge
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
        // Pop to full size fast, hold, shrink away.
        const grow = Math.min(1, t / 0.18);
        const shrink = 1 - Math.max(0, (t - 0.5) / 0.5);
        const r = bl.r * grow * shrink * zoom;
        if (r < 0.6) continue;
        const bx = sx0 + (bl.dx + bl.vx * age) * zoom;
        const by = sy0 + (bl.dy + bl.vy * age) * zoom;
        ctx.save();
        ctx.globalAlpha = 0.95 * Math.min(1, (1 - t) * 4);
        // Cel ball: grey base, white core toward the sun.
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = '#e2e2e2';
        ctx.fill();
        ctx.clip();
        ctx.beginPath();
        ctx.arc(bx + LIGHT_X * r * 0.38, by + LIGHT_Y * r * 0.38, r * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Deterministic bright nameplate color, hashed from the name itself:
  // full-saturation hues at readable lightness, stable per character
  // across races, peers, and ghosts.
  const nameColorCache = new Map();
  // Full-spectrum nameplate colors with SOLVED contrast. Two crafts:
  //  * HUE: hash -> golden-angle spread (h % 36 slots * 137.508deg), so
  //    any subset of the cast spans the whole wheel — blues, purples,
  //    pinks, reds — instead of clustering where raw hashes land.
  //  * CONTRAST: lightness is binary-searched per hue so every color
  //    hits WCAG AA 4.5:1 against the terrain grey (#3a3a3a, Y=0.042).
  //    Saturated blues and reds can't reach that dark-ground contrast
  //    at full depth, so they resolve to bright sky-blues and corals —
  //    still unmistakably their hue, always legible.
  const TERRAIN_Y = 0.0423; // relative luminance of #3a3a3a
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
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, angle, 0, TAU2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.clip();

    // Light in the body frame (world xy rotated by -angle; z is the
    // viewer axis and is rotation-invariant).
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let Lx = LIGHT_X * ca + LIGHT_Y * sa;
    let Ly = -LIGHT_X * sa + LIGHT_Y * ca;
    let Lz = LIGHT_LZ;
    const Ln = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
    Lx /= Ln; Ly /= Ln; Lz /= Ln;

    // Diffuse at parameter-sphere point u: normal dir is M^-1 u.
    const aS = a * SHADE_ECC; // the pointier spheroid the light believes in
    const diffuse = (ux, uy, uz) => {
      const nx = ux / aS, ny = uy / b, nz = uz / b;
      return (nx * Lx + ny * Ly + nz * Lz) / Math.sqrt(nx * nx + ny * ny + nz * nz);
    };

    // Brightest point u* = normalize(M_shade L).
    let ux = aS * Lx, uy = b * Ly, uz = b * Lz;
    const un = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= un; uy /= un; uz /= un;
    if (diffuse(ux, uy, uz) > CEL_TAU) {
      // Tangent basis at u*.
      let rx = 0, ry = 0, rz = 1;
      if (Math.abs(uz) > 0.9) { rx = 1; rz = 0; }
      let e1x = uy * rz - uz * ry, e1y = uz * rx - ux * rz, e1z = ux * ry - uy * rx;
      const e1n = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
      e1x /= e1n; e1y /= e1n; e1z /= e1n;
      const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x;

      ctx.beginPath();
      for (let i = 0; i <= SPOKES; i++) {
        const phi = ((i % SPOKES) / SPOKES) * TAU2;
        const dx = Math.cos(phi), dy = Math.sin(phi);
        const tx = dx * e1x + dy * e2x, ty = dx * e1y + dy * e2y, tz = dx * e1z + dy * e2z;
        let lo = 0, hi = Math.PI;
        for (let k = 0; k < 18; k++) {
          const mid = (lo + hi) / 2;
          const c = Math.cos(mid), s = Math.sin(mid);
          if (diffuse(c * ux + s * tx, c * uy + s * ty, c * uz + s * tz) > CEL_TAU) lo = mid;
          else hi = mid;
        }
        const psi = (lo + hi) / 2;
        const c = Math.cos(psi), s = Math.sin(psi);
        let px = a * (c * ux + s * tx), py = b * (c * uy + s * ty);
        const pz = b * (c * uz + s * tz);
        if (pz < 0) {
          // Wrapped past the rim: clamp to the silhouette.
          const rr = Math.sqrt((px / a) * (px / a) + (py / b) * (py / b));
          if (rr > 1e-9) { px /= rr; py /= rr; }
        }
        const wx = px * ca - py * sa, wy = px * sa + py * ca;
        if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.fillStyle = litColor(baseColor);
      ctx.fill();
    }

    // ---- Watermelon stripes: the melon generator ----
    // Each racer owns a SEEDED PATTERN SPEC, generated once and cached
    // (seeded by name, so a cast character's rind is theirs forever;
    // color is the fallback key). Beyond meridian geometry and true
    // foreshortening, the generator varies: stripe COUNT (4-6),
    // longitude JITTER off even spacing, JAGGED multi-harmonic edges
    // (lightning-bolt fingers, each edge its own), swell-and-pinch
    // width modulation, centerline MEANDER, per-stripe darkness, and
    // faint SECONDARY stripes between the mains.
    const caB = Math.cos(angle), saB = Math.sin(angle);
    if (fruit === 'cantaloupe') {
      drawNet(ctx, angle, a, b, seedKey || baseColor);
      ctx.restore();
      return;
    }
    const pat = melonPattern(seedKey || baseColor);
    for (const st of pat.stripes) {
      ctx.fillStyle = `rgba(0, 0, 0, ${st.alpha})`;
      ctx.beginPath();
      for (let pass = 0; pass < 2; pass++) {
        const sgn = pass === 0 ? -1 : 1;
        const harm = pass === 0 ? st.edgeA : st.edgeB;
        for (let j = 0; j <= 26; j++) {
          const jj = pass === 0 ? j : 26 - j;
          const th = (jj / 26) * Math.PI;
          // centerline meander + jagged edge, both in longitude space
          const kc = st.k + st.meandA * Math.sin(st.meandF * th + st.meandP);
          let edge = 1;
          for (const hm of harm) edge += hm.a * Math.sin(hm.f * th + hm.p);
          const swell = 1 + st.swellA * Math.sin(2 * th + st.swellP);
          const kk = kc + sgn * st.dphi * swell * Math.max(0.25, edge)
            * Math.sqrt(Math.max(0.05, 1 - kc * kc));
          const x = a * Math.cos(th);
          const y = b * kk * Math.sin(th);
          const wx = x * caB - y * saB, wy = x * saB + y * caB;
          if (pass === 0 && j === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
        }
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  // The melon generator: a seeded stripe-pattern spec per racer.
  const patternCache = new Map();
  function melonPattern(key) {
    let p = patternCache.get(key);
    if (p) return p;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rng = window.FF.mulberry32(h >>> 0);
    const count = 4 + (rng() * 3 | 0); // 4-6 main stripes
    const MARGIN = 0.34;
    const stripes = [];
    const mkHarm = () => [
      { f: 4 + rng() * 3, a: 0.16 + rng() * 0.1, p: rng() * 6.28 },
      { f: 9 + rng() * 5, a: 0.1 + rng() * 0.08, p: rng() * 6.28 },
      { f: 17 + rng() * 8, a: 0.05 + rng() * 0.05, p: rng() * 6.28 },
    ];
    for (let i = 0; i < count; i++) {
      const even = MARGIN + ((i + 0.5) / count) * (Math.PI - 2 * MARGIN);
      const phi = even + (rng() - 0.5) * 0.16; // spacing jitter
      const main = {
        k: Math.cos(phi),
        dphi: 0.09 + rng() * 0.06,
        alpha: 0.12 + rng() * 0.06,
        edgeA: mkHarm(), edgeB: mkHarm(),
        meandA: 0.02 + rng() * 0.035, meandF: 1 + rng() * 2, meandP: rng() * 6.28,
        swellA: 0.15 + rng() * 0.25, swellP: rng() * 6.28,
      };
      stripes.push(main);
      // A faint secondary between this main and the next, sometimes.
      if (i < count - 1 && rng() < 0.6) {
        const phi2 = even + (Math.PI - 2 * MARGIN) / count * 0.5 + (rng() - 0.5) * 0.1;
        stripes.push({
          k: Math.cos(phi2),
          dphi: 0.04 + rng() * 0.03,
          alpha: 0.05 + rng() * 0.03,
          edgeA: mkHarm(), edgeB: mkHarm(),
          meandA: 0.02 + rng() * 0.03, meandF: 1 + rng() * 2, meandP: rng() * 6.28,
          swellA: 0.2 + rng() * 0.2, swellP: rng() * 6.28,
        });
      }
    }
    p = { stripes };
    patternCache.set(key, p);
    return p;
  }
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
      for (let j = 0; j <= 9; j++) {
        const t = (j / 9) * 6.28;
        const rr = mr * (1 + 0.3 * Math.sin(3 * t + ph));
        const x = mx + rr * Math.cos(t), y = my + rr * sq * Math.sin(t);
        if (j === 0) mottle.moveTo(x, y); else mottle.lineTo(x, y);
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
    const ridges = new Path2D();
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
      const pts = [];
      for (let s = 0; s <= 4; s++) {
        let u = u0 + (u1 - u0) * (s / 4);
        let f = f0 + (f1 - f0) * (s / 4);
        if (s > 0 && s < 4) { u += (rng() - 0.5) * 0.1; f += (rng() - 0.5) * 0.18; }
        pts.push(surf(u, f));
      }
      const wbase = 1.1 + rng() * 1.5;
      for (let s = 0; s < 4; s++) {
        const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
        const dx = x1 - x0, dy = y1 - y0;
        const L = Math.sqrt(dx * dx + dy * dy) || 1;
        const w = wbase * (0.7 + rng() * 0.6) / 2;
        const nx = -dy / L * w, ny = dx / L * w;
        ridges.moveTo(x0 + nx, y0 + ny);
        ridges.lineTo(x1 + nx, y1 + ny);
        ridges.lineTo(x1 - nx, y1 - ny);
        ridges.lineTo(x0 - nx, y0 - ny);
        ridges.closePath();
      }
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

  function drawNet(ctx, angle, a, b, key) {
    const paths = netPaths(key, a, b);
    ctx.save();
    ctx.rotate(angle); // net is surface pattern: it tumbles with the fruit
    ctx.fillStyle = 'rgba(60, 40, 10, 0.09)';
    ctx.fill(paths.mottle);
    ctx.fillStyle = 'rgba(50, 32, 6, 0.10)';
    ctx.fill(paths.sutures);
    // Toward white, not cream: the ridges must survive the lit cap
    // (white contrasts with lit cream via saturation, not lightness).
    ctx.fillStyle = 'rgba(255, 253, 245, 0.32)';
    ctx.fill(paths.ridges);
    ctx.restore();
  }

    window.FF.shadeEllipse = shadeEllipse; // ghosts borrow the same sun

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