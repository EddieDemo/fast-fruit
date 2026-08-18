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
// Surface questions go to the SPINE (stage 2): surfY(state, wx) is
// the renderer's one conversion point from world x to a spine query —
// the shape every call site had with terrainYAt, so the rewiring is
// mechanical, and when folds retire "y under x" as a concept there is
// exactly one place to revisit.
// Since stage 3 the question carries a REFERENCE Y: "the ground
// under x" is multivalued beneath a fold, and the projection foot
// nearest (wx, refY) picks the deck the asker means.
function surfY(state, wx, refY) {
  const sp = (state.spine && state.spine.projectPoint)
    ? state.spine.projectPoint(wx, refY === undefined ? 0 : refY) : null;
  return sp === null ? null : sp.y;
}

const COLORS = {
  sky: '#000000',            // pure black background
  grid: 'rgba(255, 255, 255, 0.08)', // background grid — visible but discreet
  terrainGrid: 'rgba(255, 255, 255, 0.06)', // ground grid — 2m squares, subtler
  ground: '#3a3a3a',         // ground fill
  rind: '#00ff00',           // full-green melon, no detail
  marker: 'rgba(255,255,255,0.35)',
};

// PIXEL 320 Phase 0.1: the world's static tones register into the
// semantic palette at load, so grid-honesty telemetry and the suite
// know every colour the renderer legitimately emits. Values are the
// SAME literals — zero visual change; this is plumbing.
if (window.FF && window.FF.palette) {
  window.FF.palette.register('world', [COLORS.sky, COLORS.grid,
    COLORS.terrainGrid, COLORS.ground, COLORS.rind, COLORS.marker]);
}

// PIXEL 320 Phase 1.1: in pixel mode, alpha-composited hairlines are
// replaced by SOLID pre-composited tones (the same visual colour the
// alpha produced over its background, computed once) — alpha blending
// mints new colours per overlap, the exact stray class the honesty
// budget exists to eliminate. The +0.5 hairline convention also
// drops in pixel mode: it is a native-res crispness trick that is
// ANTI-crisp on the integer pixel grid.
const PX_GRID = {
  base: '#0f0f0f',                       // 0.06 white over black sky
  tier: ['#4a4a4a', '#333333', '#242424'], // majors brighter: tone IS
                                          // the hierarchy now
  tBase: '#464646',                      // terrain grid over ground
  tTier: ['#6b6b6b', '#5c5c5c', '#4f4f4f'],
  marker: '#595959',                     // 0.35 white over black
  // tierW RETIRED: every pixel-mode line is 1 px and the hierarchy is
  // carried by TONE alone, so the tier tones above are spread wider
  // than their alpha-composited originals to keep majors reading.
};
if (window.FF && window.FF.palette) {
  window.FF.palette.register('gridpx', [PX_GRID.base, ...PX_GRID.tier,
    PX_GRID.tBase, ...PX_GRID.tTier, PX_GRID.marker]);
}

const GRID_SPACING = 100; // world px between grid lines
// ---- Grid hierarchy: 1 / 50 / 100 / 200 m ----
// (the 25m tier retired per Eddie, 2026-08-10 — one fewer band of
// visual noise). DISTANCE ONLY (elevation stays a uniform ruler). The
// 100m tier is a QUARTER LAP and 200m is HALF, so the heavy lines
// double as lap-structure markers. Lines stay deliberately subtle
// (weight + alpha only, no tint); the NUMBERS carry the readable
// hierarchy through size alone.
const TIER_M = [200, 100, 50];                 // metres, descending
const TIER_ALPHA = [0.20, 0.16, 0.12];         // line alpha per tier
const TIER_WIDTH = [2, 2, 1.5];                // line width per tier
const TIER_FONT = [22, 18, 15];                // label px per tier
const BASE_ALPHA = 0.06, BASE_FONT = 11;
// Tier index for a world-metre value: 0..3, or -1 for a plain line.
function tierOf(m) {
  const a = Math.abs(Math.round(m));
  if (a === 0) return 0;
  for (let i = 0; i < TIER_M.length; i++) if (a % TIER_M[i] === 0) return i;
  return -1;
}
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
// RETIRED 2026-08-18 by the width-parity ruling: the compact/full box
// floors and the native-1:1 cap. They made visible width drift from
// 14.5 m to 19.2 m across devices, and the compact SWITCH — testing a
// height that the pixel buffer shadows — silently gave desktop the
// phone floors in pixel mode. Superseded by VIEW_W_M + VIEW_H_MIN_M
// above. Kept commented, not deleted: the exact numbers are the
// history of how the lens was tuned.
//   const COMPACT_H_PX = 500;
//   const MIN_H_M_COMPACT = 7.5, MIN_W_M_COMPACT = 14.5;
//   const MIN_H_M_FULL = 10, MIN_W_M_FULL = 16;
// The ONE visible-width figure, in metres — mobile landscape's, now
// standard on every device and in both render modes (Eddie ruling,
// 2026-08-18). Changing this changes the game's whole sense of pace,
// so it is a ruling, not a tuning knob.
const VIEW_W_M = 16.2;
const VIEW_H_MIN_M = 7.5;   // escape hatch only: see the zoom law
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
if (window.FF && window.FF.palette) window.FF.palette.register('bots', BOT_PALETTE); // Phase 0.1


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
  // Bots carry their seeded pigment (state.js, via the anchor band);
  // the legacy palette survives only as a headless/boot fallback.
  if (body && body.bodyColor) return body.bodyColor;
  return BOT_PALETTE[(bodyIndex - np) % BOT_PALETTE.length];
};

// Canonical player-slot colors: every peer agrees on who wears what.
const PLAYER_PALETTE = ['#00ff00', '#ff2d2d', '#2d8cff', '#ffd22d'];

function createRenderer(canvas) {
  const baseCtx = canvas.getContext('2d');
  let ctx = baseCtx;   // render() rebinds to the pixelation offscreen
                       // when FF.PIXELATE is on; every helper receives
                       // ctx as a parameter, so the swap is total
  let pxCanvas = null; // lazy: the low-res world layer
  const pxAltCache = new Map();  // fill tone -> its checker partner

  // ---- THE AA-KILLER (pixelation mode) ----
  // Canvas 2D anti-aliases every shape INTO the low-res buffer and
  // the spec offers no off switch — so blend pixels are removed
  // after the fact. Palette-free dominant-snap: any colour covering
  // real area this frame is GENUINE; every stray pixel (AA blends
  // live on edges, so they are always rare) snaps to its nearest
  // genuine colour. Self-calibrating — no palette imposed, so the
  // full palette-discipline lever stays a separate, later decision.
  // Cost: one histogram + one cached nearest-lookup per DISTINCT
  // stray colour (a few hundred), trivial at 380-wide.
  function crispSnap(c2d, w, h) {
    let img;
    try { img = c2d.getImageData(0, 0, w, h); } catch (e) { return; }
    const d = img.data, n = w * h;
    const hist = new Map();
    for (let i = 0; i < n; i++) {
      const k = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      hist.set(k, (hist.get(k) || 0) + 1);
    }
    // Lenient on purpose: AA blends are DISPERSED (each distinct
    // blend colour counts 1-5 px), so a low cut still catches them
    // all — while small legitimate features (place tags, name text,
    // decal details) keep their colours instead of being eaten.
    const cut = Math.max(12, (n / 2400) | 0);
    const commons = [];
    // Registered palette members are GENUINE regardless of area —
    // this is what the Phase 0 registry is FOR. Without it the
    // resolver ate every small legitimate feature: the 2 px glint
    // vanished in race view and reappeared only when the pan zoomed
    // the lit cap past the area cut (measured on device). Blends are
    // never members, so anti-aliasing still dies.
    const pal2 = window.FF.palette;
    for (const [k, c] of hist) {
      if (c >= cut || (pal2 && pal2.isMemberInt(k))) commons.push(k);
    }
    // Phase 0.2 telemetry: how many pixels this frame were NOT a
    // dominant colour — the grid-honesty number the roadmap ratchets
    // toward zero as painters convert. Published BEFORE the all-common
    // early return: a perfectly honest frame reports strays 0, not
    // silence. Read as FF.PX_STRAYS.
    if (typeof window !== 'undefined') {
      let covered = 0;
      for (const k of commons) covered += hist.get(k) || 0;
      window.FF.PX_STRAYS = { frame: n, distinct: hist.size,
        commons: commons.length, strays: n - covered };
    }
    if (!commons.length || commons.length === hist.size) return;
    // LOCAL RESOLVE (v2): an AA blend is a mixture of its own
    // neighbours, so each stray snaps to the nearest genuine colour
    // among its 5x5 neighbourhood — never to a genuine colour from
    // across the screen. v1 snapped globally, and a white-on-dark
    // blend (grey) would land on the grid's genuine grey, stranding
    // grey blocks on melon rims and highlight borders. Local resolve
    // reconstructs the edge an aliased rasterizer would have drawn.
    const commonSet = new Set(commons);
    const keys = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      keys[i] = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    }
    const globalCache = new Map();
    const globalNearest = (k) => {
      const hit = globalCache.get(k);
      if (hit !== undefined) return hit;
      const r = k >> 16, g = (k >> 8) & 255, b = k & 255;
      let best = commons[0], bd = Infinity;
      for (const c of commons) {
        const dr = r - (c >> 16), dg = g - ((c >> 8) & 255), db = b - (c & 255);
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bd) { bd = dist; best = c; }
      }
      globalCache.set(k, best);
      return best;
    };
    for (let i = 0; i < n; i++) {
      const k = keys[i];
      if (commonSet.has(k)) continue;
      const x = i % w, y = (i / w) | 0;
      const r = k >> 16, g = (k >> 8) & 255, b = k & 255;
      let best = -1, bd = Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const nk = keys[yy * w + xx];           // pre-pass values:
          if (!commonSet.has(nk)) continue;       // strays never vote
          const dr = r - (nk >> 16), dg = g - ((nk >> 8) & 255), db = b - (nk & 255);
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bd) { bd = dist; best = nk; }
        }
      }
      const t = best >= 0 ? best : globalNearest(k);
      d[i * 4] = t >> 16; d[i * 4 + 1] = (t >> 8) & 255; d[i * 4 + 2] = t & 255;
    }
    c2d.putImageData(img, 0, 0);
  }
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

    // ---- PIXELATION (FF.PIXELATE, toggled from the HUD) ----
    // The whole world pass renders into a 380-wide offscreen, then
    // blits to screen nearest-neighbour. The swap happens BEFORE the
    // zoom computation on purpose: zoom derives from width/height, so
    // shadowing them makes ALL camera math self-scale — the min-box
    // law is resolution-independent and the visible world box stays
    // identical either way. dpr shadows to 1 (the offscreen is raw
    // pixels); the tail restores everything before the blit and the
    // UI-glass sticks. Menus and HUD are DOM — untouched by design.
    const px = !!window.FF.PIXELATE && typeof document !== 'undefined';
    pxMode = px;                       // sprite melons follow the mode
    // Time-slice: at most BAKE_PER_FRAME new sprite frames per
    // rendered frame. Anything else paints vector this tick and
    // bakes on a later one, so a wrap change can never freeze the
    // game the way the eager 64-frame bake did.
    bakeBudget = BAKE_PER_FRAME;
    const realW = width, realH = height, realDpr = dpr;
    if (px) {
      if (!pxCanvas) pxCanvas = document.createElement('canvas');
      // Internal width is a dev tunable (console: FF.PIXELATE_W=380)
      // so chunk tiers can be judged side by side mid-race. Default
      // 640 — the VGA tier, the truer Out Run / Super Hang-On read;
      // 380 is the Game-Boy-adjacent chunk. Sprites key on screen
      // radius, so switching width just triggers fresh bakes.
      const pw = (window.FF.PIXELATE_W | 0) || 320;  // LOCKED (Eddie): the
                                    // OutRun-board width
      const ph = Math.max(1, Math.round(pw * height / Math.max(1, width)));
      if (pxCanvas.width !== pw) pxCanvas.width = pw;
      if (pxCanvas.height !== ph) pxCanvas.height = ph;
      ctx = pxCanvas.getContext('2d');
      width = pw; height = ph; dpr = 1;
    }

    // ---- Zoom: guarantee a minimum visible BOX of world ----
    // At least 10m vertically AND 16m horizontally on every device.
    // Windows short in either axis zoom OUT until the floor fits;
    // larger windows stay at native 1:1 and simply see more world.
    // The box floor (vs an exact letterboxed window) keeps native
    // feel; a fixed 16x10 "ranked view" stays in reserve for serious
    // leaderboards. World coordinates and physics are untouched —
    // this is purely the camera's lens.
    // WIDTH PARITY (Eddie, 2026-08-18). The old law was a BOX floor
    // plus a native-1:1 cap, so visible width drifted between 16.0 m
    // (width binding) and 19.2 m (cap binding) depending on the
    // window — and mobile landscape sat at 16.2 m. One figure now
    // holds everywhere: VIEW_W_M, adopted from mobile landscape
    // because that is the feel the game has actually been raced at.
    //
    // Two REGRESSIONS are fixed with it, both mine, both from the
    // pixelation swap shadowing width/height with the 320 buffer:
    //  * the compact switch tested the SHADOWED height (~180 px), so
    //    it fired on every device in pixel mode — desktop silently
    //    ran the 14.5 m phone floors. That is the "less than 16 m in
    //    pixel mode" measured on device.
    //  * the 1:1 cap is a RESOLUTION-DEPENDENT statement ("never
    //    magnify past native"), meaningless once we deliberately
    //    render at 320, where zoom is ~0.22 and the cap can never
    //    bind. It retires: pinning the width supersedes it.
    // Both decisions now read the REAL viewport, never the buffer.
    // realH/realW are the PRE-SWAP viewport dimensions, captured
    // above before the pixel buffer shadows them — exactly the "real
    // viewport" this decision needs, in both modes.
    // The vertical ESCAPE HATCH — one value, deliberately NOT the old
    // compact/full split. A 10 m floor still binds at 16:9 (16.2 m
    // wide gives 9.1 m tall there), which would re-break parity on
    // exactly the desktops this ruling is about. VIEW_H_MIN_M is set
    // to mobile landscape's own vertical, so it engages only ABOVE
    // ~2.16:1 — a shape no ordinary window has — and every normal
    // window, phone or desktop, is framed by width alone.
    let zoom = width / (VIEW_W_M * 100);
    const vHatch = height / (VIEW_H_MIN_M * 100);
    if (vHatch < zoom) zoom = vHatch;

    // ---- Camera: forward-biased on x, centered on y ----
    // Target puts the melon at MELON_SCREEN_FRAC of screen width;
    // cameraLerp (tuning panel, Feel group) is the catch-up knob —
    // low = long dreamy lag, high = locked. Vertical stays centered:
    // jump arcs need vision both ways.
    const cam = state.camera;
    // THE GRID WALK: while gridstart holds a shot, the shot owns the
    // frame absolutely — pose and zoom both — so no follow lerp can
    // fight it. Its end (timeout or touch) drops camera.initialized,
    // and the branch below snaps to the follow target: that IS the
    // hard cut, one grammar for both exits, immune to camera tuning.
    const shot = (window.FF.gridStart && window.FF.gridStart.cameraShot)
      ? window.FF.gridStart.cameraShot(state) : null;
    if (shot) zoom *= shot.zoomMul;
    const fwdBias = cam.fwd === undefined ? 1 : cam.fwd;
    const targetX = ix + fwdBias * (0.5 - MELON_SCREEN_FRAC) * width / zoom;
    if (shot) {
      cam.x = shot.x;
      cam.y = shot.y;
      // initialized stays false through the walk, so the first frame
      // after the shot snaps rather than travels.
    } else if (!cam.initialized) {
      cam.x = targetX;
      cam.y = iy;
      cam.initialized = true;
    } else {
      const k = Math.min(1, CONFIG.cameraLerp * dtFrame);
      cam.x += (targetX - cam.x) * k;
      cam.y += (iy - cam.y) * k;
    }
    // THE SNAP (pixelation only): the camera lerp stays smooth in
    // world space, but the MAPPING quantises cam to whole low-res
    // pixels — otherwise every world edge re-rasterises each frame
    // and the whole screen shimmers (pixel crawl). Snapping the
    // mapping, not cam itself, keeps the lerp state untouched.
    const camX = px ? Math.round(cam.x * zoom) / zoom : cam.x;
    const camY = px ? Math.round(cam.y * zoom) / zoom : cam.y;
    const cxs = px ? Math.round(width / 2) : width / 2;
    const cys = px ? Math.round(height / 2) : height / 2;
    const toScreenX = (wx) => (wx - camX) * zoom + cxs;
    const toScreenY = (wy) => (wy - camY) * zoom + cys;

    // ---- CAMERA DIRECTION v1 (stage 3 amendment) ----
    // FORWARD-BIAS FOLLOWS TRAVEL: on a reversed deck the player
    // drives -x, so the look-ahead margin flips to the left — the
    // camera keeps showing where they are GOING. The sign comes from
    // the same projection oracle progress and semantic input use,
    // smoothed so the flip is a pan, not a cut.
    //
    // GROUNDED-GATED (fix, 2026-08-17): travel direction is a
    // property of the deck you are ON, not of whichever face happens
    // to be nearest mid-flight. A big drop falls past a STACK of
    // faces with alternating point-order signs (lip deck +1, drop
    // faces and return deck -1, landing deck +1), and reading the
    // oracle airborne made the camera slosh through every one of
    // them. Airborne, the bias HOLDS the last grounded direction —
    // you fly the way you left — and flips only on landing, as a
    // smoothed pan.
    //
    // PREDICTIVE BIAS (Eddie, 2026-08-18). Reading the direction UNDER
    // the melon made the camera lag through serpentine reversals: the
    // bias only began swinging once the reversal had already happened,
    // it passes through ZERO on the way (lookahead vanishing exactly
    // when it is needed most), and a second reversal arriving before
    // the first settled left the camera permanently behind. It was
    // also late by construction near turnarounds, because the read
    // only happened while grounded and a turnaround is where you are
    // briefly airborne.
    //
    // The cure is what a good chase camera does: LOOK WHERE THE TRACK
    // GOES, not where the melon is. s increases with travel on every
    // strand — including reversed decks, whose points are s-ordered
    // leftward — so the tangent's x-sign at (s + lead) IS the travel
    // direction there. Sampling ahead means the camera starts turning
    // BEFORE the melon does, and it works airborne, because arc
    // progress does not care whether you are touching the ground.
    {
      let fwdT = cam.fwd === undefined ? 1 : (cam.fwd < 0 ? -1 : 1);
      const sp = state.spine;
      let read = false;
      if (state.melon && sp && sp.progressOf && sp.surfaceAt) {
        const s0 = sp.progressOf(state.melon);
        if (s0 !== null && s0 !== undefined && isFinite(s0)) {
          // Lead scales with speed: dawdling needs no anticipation,
          // full flight needs about a second of it. Clamped so the
          // camera never reads so far ahead that it turns for a
          // reversal the melon may never reach.
          const spd = Math.hypot(state.melon.vx || 0, state.melon.vy || 0);
          const lead = Math.max(260, Math.min(1100, spd * 0.85));
          const ahead = sp.surfaceAt(s0 + lead);
          if (ahead) { fwdT = ahead.tx < 0 ? -1 : 1; read = true; }
        }
      }
      // Fallbacks, in order: the ground under the melon (the old law,
      // still right when the lookahead runs off the end of a strand),
      // then hold the last direction.
      if (!read && state.melon && state.melon.grounded
          && sp && sp.projectPoint) {
        const pr = sp.projectPoint(ix, iy);
        if (pr) fwdT = pr.dirX;
      }
      if (cam.fwd === undefined || !cam.initialized) cam.fwd = fwdT;
      else {
        // Crossing the dead zone fast, settling slow: |fwd| below the
        // floor means lookahead has collapsed, so the swing is pushed
        // through at triple rate. Ordinary settling keeps the dreamy
        // feel cameraLerp was tuned for.
        const swinging = (fwdT > 0) !== (cam.fwd > 0) || Math.abs(cam.fwd) < 0.45;
        const fk = Math.min(1, CONFIG.cameraLerp * (swinging ? 3 : 1) * dtFrame);
        cam.fwd += (fwdT - cam.fwd) * fk;
      }
    }
    // Screen y where world y=0 sits this frame (grid anchor).
    const groundScreenY = toScreenY(0);

    // ---- FX decay (presentation state owned by renderer) ----
    // Decay every body's deformation (presentation-tier, frame-rate
    // based — the sim never reads it back).
    const decayK = CONFIG.squashDecay * dtFrame;
    for (const pl of state.players) {
      if (pl.melon.squash) pl.melon.squash = Math.max(0, pl.melon.squash - decayK * pl.melon.squash);
    }
    for (const bt of state.bots) {
      if (bt.melon.squash) bt.melon.squash = Math.max(0, bt.melon.squash - decayK * bt.melon.squash);
    }
    state.fx.flash = Math.max(0, state.fx.flash - 10 * state.fx.flash * dtFrame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ---- Background ----
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, width, height);

    // THE CAMERA NEVER ROTATES (ruled by Eddie, 2026-08-17):
    // gravity-down is a permanent invariant of the presentation.
    // Every skill read in this game — landings, flare timing, the
    // express drop, the precision stop — hangs off the vertical
    // axis, and direction changes are a HORIZONTAL framing question,
    // answered by the forward-bias flip above. The stage-2 tangent-
    // rotation idea disproved itself the moment a reversed deck
    // existed (its tangent rolls the world upside down); the
    // machinery is deleted, not dormant — a mechanism that exists is
    // a mechanism that gets called.

    // Grid: world-anchored so it scrolls with the camera. Drawn before
    // terrain, so the ground fill covers the below-surface portion.
    drawGrid(ctx, cam.x, width, height, groundScreenY, zoom);

    // ---- Terrain ----
    // RIBBONS, not fills (stage 1): each strand draws as its SLAB
    // polygon — top polyline out, bottom (the SLAB_T offset) back,
    // closed. Fill-to-screen-bottom died with the heightfield: the
    // ground is now a solid with an underside, which is what gives
    // terraces headroom when they arrive. Geometry comes from the
    // SAME slab world physics collides (slab.worldFor) — silhouette
    // equals collider, by construction rather than by discipline.
    // The wall strand is physics-only and never draws.
    const slabWorld = window.FF.slab.worldFor(state.terrain);
    // PIXEL 320 Phase 1.2: vertex snap — in pixel mode every terrain
    // vertex lands on the integer grid, so the rasterizer (and the
    // vote) never adjudicates a half-pixel edge. World geometry is
    // untouched; this is the screen mapping only.
    const tsx = pxMode ? ((v) => Math.round(toScreenX(v))) : toScreenX;
    const tsy = pxMode ? ((v) => Math.round(toScreenY(v))) : toScreenY;
    const traceSlabPath = () => {
      ctx.beginPath();
      for (const sl of slabWorld.slabs) {
        if (sl.isWall) continue;
        const t = sl.top, bo = sl.bottom;
        ctx.moveTo(tsx(t[0].x), tsy(t[0].y));
        for (let i = 1; i < t.length; i++) {
          ctx.lineTo(tsx(t[i].x), tsy(t[i].y));
        }
        for (let i = bo.length - 1; i >= 0; i--) {
          ctx.lineTo(tsx(bo[i].x), tsy(bo[i].y));
        }
        ctx.closePath();
      }
    };
    // PIXEL 320 COLUMN FILL (Eddie, 2026-08-18). Vertex snapping was
    // not enough: canvas still rasterizes the DIAGONAL between two
    // snapped vertices, minting a blend per column. Those blends
    // share one value along a constant-slope edge, so thousands of
    // them appear — clearing the resolver's area cut, being promoted
    // to "genuine", and surviving as visible anti-aliasing on every
    // angled edge (measured on device). Frequency was always a proxy
    // for legitimacy; a long diagonal is where the proxy breaks.
    //
    // The cure is to not make the mess: walk the slab's top edge one
    // SCREEN COLUMN at a time, and fill each column as a rect from
    // its integer surface row to the slab bottom. The stair steps
    // become AUTHORED — exactly one pixel wide, no intermediate tone
    // anywhere, stable frame to frame — which is how sprite-era games
    // drew ground, and it retires the corrective pass for the largest
    // surface in the game.
    // THE SHARED COLUMN TABLE (Eddie, 2026-08-18). One authority for
    // "where is the ground in this column", written by the fill and
    // read by the terrain grid. Two passes that each decide it
    // separately WILL disagree: the grid was clipped by ctx.clip()
    // against the path traceSlabPath builds, and the pixel branch
    // never calls it — so the clip ran against a STALE path and grid
    // lines escaped above the surface (measured on device). Sharing
    // the table makes the escape impossible by construction, the same
    // way the column fill makes blends impossible.
    // Sentinel: height + 2 means "no ground in this column".
    // v2 (Eddie, 2026-08-18): the terrain grid is drawn INSIDE the
    // column pass, within each span's [yTop, yBot]. v1 kept a
    // top-only table and ran the grid as its own pass, so verticals
    // fell to the bottom of the screen — the old clip bounded BOTH
    // edges and the table only replaced one. A second (bottom) table
    // would not fix it either: under a fold a column has two spans,
    // and min-top with max-bottom paints the void between the decks.
    // Drawing per span is the only form that is right for folds, and
    // it makes the grid literally part of the ground it belongs to.
    let pxGridDone = false;
    if (pxMode) {
      // THE GROUND CHECKER (Eddie, 2026-08-18) replaces the terrain
      // grid: 1 m cells, WORLD-ANCHORED so the pattern scrolls with
      // the ground instead of sliding over it, alternating between
      // each segment's fill and a derived partner tone. The partner
      // is bandColor(fill, +6 L*) — the same law that shades
      // everything else, so it registers into the palette
      // automatically and will follow Phase 5's light columns for
      // free, and every tinted section gets its own pair without a
      // table of hand-picked colours.
      // Lines are gone entirely, which is the deeper win: a 1 px
      // feature must survive the pixel grid, and a filled cell has
      // nothing to survive.
      const gStep = TERRAIN_GRID_SPACING;      // 100 world px = 1 m
      const altOf = (hex) => {
        let a2 = pxAltCache.get(hex);
        if (a2 === undefined) {
          a2 = (window.FF.shading ? window.FF.shading.bandColor(hex, 6) : hex);
          pxAltCache.set(hex, a2);
        }
        return a2;
      };
      pxGridDone = true;
      var pxGStep = gStep, pxAltOf = altOf;   // used by the fill loop
    }
    if (pxMode) {
      ctx.fillStyle = COLORS.ground;
      // The dev vocabulary tint is the segment's FILL COLOUR here,
      // not a second coat: the shipped tint pass repaints slab
      // columns AFTER the fill, which now covers the inline grid
      // (measured — the grid vanished on coloured sections). One
      // colour decision per span, then the grid on top of it.
      const TINT_PX = window.FF.DEV_TERRAIN_COLORS ? {
        slope: '#3a3a3a', roller: '#37413a', flat: '#454545',
        kicker: '#463c34', gap: '#46343c', sw: '#343c46',
      } : null;
      for (const sl of slabWorld.slabs) {
        if (sl.isWall) continue;
        const t = sl.top, bo = sl.bottom;
        for (let i = 1; i < t.length; i++) {
          const segFill = (TINT_PX && TINT_PX[t[i].k]) || COLORS.ground;
          const ax = toScreenX(t[i - 1].x), ay = toScreenY(t[i - 1].y);
          const bx = toScreenX(t[i].x), by = toScreenY(t[i].y);
          let x0 = Math.round(Math.min(ax, bx)), x1 = Math.round(Math.max(ax, bx));
          if (x1 < -2 || x0 > width + 2) continue;      // off-screen span
          x0 = Math.max(x0, -1); x1 = Math.min(x1, width + 1);
          const span = bx - ax;
          for (let x = x0; x <= x1; x++) {
            // Surface row for THIS column, sampled at its centre.
            const u = span === 0 ? 0 : Math.max(0, Math.min(1, (x + 0.5 - ax) / span));
            const yTop = Math.round(ay + (by - ay) * u);
            // Slab bottom under the same column: the underside is
            // parallel per segment, so its own interpolation keeps
            // thin slabs honest instead of assuming a fixed depth.
            const j = Math.min(bo.length - 1, i);
            const cy0 = toScreenY(bo[j - 1] ? bo[j - 1].y : bo[j].y);
            const cy1 = toScreenY(bo[j].y);
            const yBot = Math.round(cy0 + (cy1 - cy0) * u);
            const hgt = Math.max(1, yBot - yTop);
            // CHECKER FILL: walk this span in world-cell bands. One
            // fillRect per band, not per pixel — a column crosses
            // only a few cells — and the cell indices come from WORLD
            // coordinates, so the pattern belongs to the ground.
            const wxCell = Math.floor((((x + 0.5) - cxs) / zoom + camX) / pxGStep);
            let y = yTop;
            const yEndAll = yTop + hgt;
            while (y < yEndAll) {
              const wy = (y - cys) / zoom + camY;
              const cyCell = Math.floor(wy / pxGStep);
              const nextW = (cyCell + 1) * pxGStep;
              let yNext = Math.ceil((nextW - camY) * zoom + cys);
              if (yNext <= y) yNext = y + 1;   // never stall
              const yEnd = Math.min(yEndAll, yNext);
              const light = ((wxCell + cyCell) & 1) === 0;
              ctx.fillStyle = light ? segFill : pxAltOf(segFill);
              ctx.fillRect(x, y, 1, yEnd - y);
              y = yEnd;
            }
          }
        }
      }
    } else {
      traceSlabPath();
      ctx.fillStyle = COLORS.ground;
      ctx.fill();
    }

    // Phase 1.3 banding REVERTED (Eddie, 2026-08-18): at +/-8 L* the
    // bands were the visual signature of anti-aliasing along every
    // terrain silhouette — a 1-2 px intermediate tone is edge
    // smoothing, whatever the intent. If banding returns it must be
    // contrasty enough to read as paint, and that is Eddie's eye's
    // call against real device captures.

    // DEBUG VOCABULARY COLOURING (FF.DEV_TERRAIN_COLORS = true):
    // repaint each segment's slab column in its chunk-kind tint —
    // the standard grey nudged, never shouted, so the track still
    // reads as itself while the vocabulary becomes legible. A
    // segment's kind is its END point's tag (points are laid left to
    // right, so a chunk's first point belongs to its predecessor).
    // The column's bottom edge is the SLAB bottom now, not the
    // screen (spec §4).
    if (window.FF.DEV_TERRAIN_COLORS && !pxMode) {
      const TINT = {
        slope: '#3a3a3a',        // the base grey: the default word
        roller: '#37413a',       // toward green: the rhythm section
        flat: '#454545',         // lighter: the rest note
        kicker: '#463c34',       // warm: air incoming
        gap: '#46343c',          // toward red: the void
        sw: '#343c46',           // toward blue: the fold
        tunnel: '#3c3446',       // toward violet: the roof
        trap: '#41412f',         // toward olive: the choice
        runway: '#3a3a3a',
      };
      for (const sl of slabWorld.slabs) {
        if (sl.isWall) continue;
        const t = sl.top, bo = sl.bottom;
        for (let i = 1; i < t.length; i++) {
          const k = t[i].k;
          if (!k || k === 'slope' || k === 'runway') continue;   // base stays base
          const x0 = toScreenX(t[i - 1].x), x1 = toScreenX(t[i].x);
          if (x1 < 0 || x0 > width) continue;
          ctx.beginPath();
          ctx.moveTo(x0, toScreenY(t[i - 1].y));
          ctx.lineTo(x1, toScreenY(t[i].y));
          ctx.lineTo(toScreenX(bo[i].x), toScreenY(bo[i].y));
          ctx.lineTo(toScreenX(bo[i - 1].x), toScreenY(bo[i - 1].y));
          ctx.closePath();
          ctx.fillStyle = TINT[k] || COLORS.ground;
          ctx.fill();
        }
      }
      // The tint pass consumed the slab path; the grid clip below
      // needs it back.
      traceSlabPath();
    }

    // Terrain grid: 2m squares (vs the background's 1m), world-anchored
    // to the same origin so every terrain line coincides with every
    // other background line — the two grids read as one system at two
    // densities, and the density change itself marks the surface.
    if (pxMode) {
      // Nothing here: the terrain grid was drawn inside the column
      // pass, span by span, so it cannot escape the ground in either
      // direction and folds are handled by construction.
      void pxGridDone;
    } else {
      ctx.save();
      ctx.clip();
      drawTerrainGrid(ctx, cam, width, height, groundScreenY, zoom);
      ctx.restore();
    }

    // Distance markers every 200 world px — motion & speed reference.
    drawMarkers(ctx, state, cam.x, width, toScreenX, toScreenY, zoom);

    // Start/finish line each lap (track mode): a post on the surface.
    if (state.period && state.race.mode === 'track') {
      // Metric (stage 3): lap boundaries live at ARC multiples — the
      // spine hands back each post's world point directly. The
      // visible k-range brackets the player's lap; ±2 covers the
      // screen at any zoom the lens allows.
      const lapA = state.race.lapLengthPx || state.period.L;
      const kMid = Math.round(state.spine.progressOf(state.melon) / lapA);
      ctx.fillStyle = '#ffffff';
      for (let k = kMid - 2; k <= kMid + 2; k++) {
        const spk = state.spine.surfaceAt(k * lapA);
        if (!spk) continue;
        const wx = spk.x, wy = spk.y;
        const sx = tsx(wx), sy = tsy(wy);
        // Post and flag are world objects: they scale with the lens.
        // Pixel mode: integer geometry, 1px-minimum post.
        if (pxMode) {
          const pw2 = Math.max(1, Math.round(4 * zoom)), phh = Math.round(150 * zoom);
          ctx.fillRect(sx - Math.round(2 * zoom), sy - phh, pw2, phh);
          ctx.fillRect(sx - Math.round(2 * zoom), sy - phh,
            Math.max(2, Math.round(26 * zoom)), Math.max(1, Math.round(14 * zoom)));
        } else {
          ctx.fillRect(sx - 2 * zoom, sy - 150 * zoom, 4 * zoom, 150 * zoom);
          ctx.fillRect(sx - 2 * zoom, sy - 150 * zoom, 26 * zoom, 14 * zoom);
        }
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
        squash: gm, // bots deform too: strain is per-body now
        name: gm.name,
        pilot: gm.pilot,
        decals: gm.decals,
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
        squash: gm, // remote players are simulated locally: real strain
        name: gm.name,
        pilot: gm.pilot,
        decals: gm.decals,
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
        squash: state.melon, isPlayer: true,
        name: state.melon.name,
        pilot: state.melon.pilot,
        decals: state.melon.decals,
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

    // Nameplate crowding: the screen-space x of every OTHER label this
    // frame, so a plate can ask whether it has elbow room before it
    // spends a second line. Recomputed per frame (twelve numbers) and
    // never stored on the body: this is a fact about the CAMERA, not
    // about the racer.
    const plateXs = [];
    for (const d of drawList) {
      if (!d.name) continue;
      let px = d.x;
      if (state.period) {
        const k = Math.round((d.x - cam.x) / state.period.L);
        if (k !== 0) px -= k * state.period.L;
      }
      plateXs.push(toScreenX(px));
    }
    // Room enough for a pilot line? The melon names are the wide part,
    // so the test is generous: a neighbour closer than this and the
    // two plates were already fighting.
    const PLATE_ROOM = 130;
    const nameplateHasRoom = (d, sx) => {
      for (const px of plateXs) {
        if (px === sx) continue;
        if (Math.abs(px - sx) < PLATE_ROOM) return false;
      }
      return true;
    };

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
      //
      // TWO LINES: the MELON is the character and reads first; the
      // PILOT sits beneath it in the micro/faint role, because the
      // melon is a body and someone is driving it.
      //
      // ...BUT ONLY WHEN THERE IS ROOM. A PIL proof of the bunched
      // pack (melons a metre apart on the grid) showed the single
      // line ALREADY overlapping into a mush at that density, and a
      // second line doubles the ink at exactly the moment the screen
      // can least afford it. So the pilot line is spent like any other
      // budget: it appears when the nearest neighbouring nameplate is
      // far enough away to leave it legible, and quietly withholds
      // itself in traffic — where the melon name is what you need
      // anyway. Screen-space and presentation-only: nothing the sim
      // can see, and free to differ between peers.
      if (d.name) {
        const wy = surfY(state, dxw, dyw);
        if (wy !== null) {
          const baseY = toScreenY(wy) + 34 + Math.round(150 * zoom);
          const nmCol = d.isPlayer ? '#00ff00' : nameColor(d.name); // sacred green lives HERE now
          if (pxMode && window.FF.pxfont) {
            // Phase 3.1: canvas text is mush at 320 — the bitmap
            // font is the ONLY in-world text. Names register as
            // legitimate tones so the honesty budget stays truthful.
            const PF = window.FF.pxfont;
            if (window.FF.palette) window.FF.palette.registerTone('names', nmCol);
            PF.draw(ctx, d.name, sx - PF.measure(d.name, 1) / 2,
              baseY - 5, 1, nmCol);
            if (d.pilot && nameplateHasRoom(d, sx)) {
              const sub = d.isPlayer ? '#6dac75' : '#5d7060'; // pre-composited
              PF.draw(ctx, d.pilot, sx - PF.measure(d.pilot, 1) / 2,
                baseY + 3, 1, sub);
            }
          } else {
          ctx.font = '700 14px "Geist Mono", ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          // Bots wear seeded BRIGHT name colors (the melons are all
          // green now, so the names carry the color identity instead);
          // the player's name keeps their sacred green.
          ctx.fillStyle = nmCol;
          ctx.fillText(d.name, sx, baseY);
          if (d.pilot && nameplateHasRoom(d, sx)) {
            ctx.font = '400 10px "Geist Mono", ui-monospace, monospace';
            ctx.fillStyle = d.isPlayer ? 'rgba(140,220,150,0.78)' : 'rgba(150,180,155,0.62)';
            ctx.fillText(d.pilot, sx, baseY + 13);
          }
          }
        }
      }
      // ---- Cast shadow: TRUE projection. The rotated silhouette's
      // extremes are ray-marched along the sun onto the terrain (the
      // rig solves it), so the footprint stretches on away-slopes,
      // narrows with pose, hugs the local tangent, and is CLIPPED to
      // the terrain fill — it can never bleed past a cliff edge.
      if (RIG.P.castShadow && !pxMode) {
        // px mode (Eddie ruling, 2026-08-18): NO body shadows. Both
        // passes are alpha multiplication — the forbidden move — and
        // the contact pass painted translucent black OVER the baked
        // sprite's underside, minting the stray black/olive pixels
        // measured on device. Vector mode keeps its shadows.
        const wyG0 = surfY(state, dxw, dyw);
        if (wyG0 !== null) {
          const hM = Math.max(0, (wyG0 - (dyw + d.melon.b)) / 100);
          if (hM < RIG.P.castMaxM) {
            const spT = (window.FF.FRUITS[d.melon.fruit] && window.FF.FRUITS[d.melon.fruit].taper) || 0;
            const shC = spT * d.melon.a / 4; // geometric center offset from the COM
            const fp = RIG.castFootprint(dxw + shC * Math.cos(d.angle), dyw + shC * Math.sin(d.angle),
              d.angle, d.melon.a, d.melon.b,
              (gx) => surfY(state, gx, dyw), spT);
            if (fp) {
              const fade = 1 - hM / RIG.P.castMaxM;
              const rx = fp.half * RIG.P.castStretch * zoom;
              const ry = rx * RIG.P.castFlat;
              const sxS = toScreenX(fp.x), syS = toScreenY(fp.y);
              ctx.save();
              // Clip to the terrain fill: a local polygon under the line.
              ctx.beginPath();
              const spanW = rx * 2.6 / zoom;
              const steps = 8;
              for (let i = 0; i <= steps; i++) {
                const gx = fp.x - spanW / 2 + (i / steps) * spanW;
                const gy = surfY(state, gx, dyw);
                const px2 = toScreenX(gx), py2 = gy === null ? syS : toScreenY(gy);
                if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
              }
              ctx.lineTo(toScreenX(fp.x + spanW / 2), syS + 400);
              ctx.lineTo(toScreenX(fp.x - spanW / 2), syS + 400);
              ctx.closePath();
              ctx.clip();
              ctx.fillStyle = '#000000';
              if (RIG.P.castSoft) {
                ctx.globalAlpha = RIG.P.castAlpha * fade * 0.45;
                ctx.beginPath();
                ctx.ellipse(sxS, syS, rx * 1.28, ry * 1.5, fp.slope, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.globalAlpha = RIG.P.castAlpha * fade;
              ctx.beginPath();
              ctx.ellipse(sxS, syS, rx, ry, fp.slope, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
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
      drawMelon(ctx, sx, sy, d.angle, d.squash, d.color, zoom, d.melon.patKey || d.name || d.color, d.melon.a, d.melon.b, d.melon.fruit, d.decals);
      // ---- Contact shadow: the body darkens near its ground touch ----
      if (RIG.P.contactShadow && !pxMode) {
        const wyG = surfY(state, dxw, dyw);
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
        drawMelon(ctx, sx, sy, d.angle, d.squash, '#ffffff', zoom, d.melon.patKey || d.name || d.color, d.melon.a, d.melon.b, d.melon.fruit);
        ctx.globalAlpha = 1;
      }
      drawPlace(ctx, sx, sy, d.place, zoom, d.isPlayer);
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

    // The danger rim: the shipped landing-fate signal, worn by the body.
    drawDangerRim(ctx, state, ix, iy, iangle, toScreenX, toScreenY, zoom);
    // Dev only (CONFIG.practiceSplat): the binary verdict ring.
    drawSplatVerdict(ctx, state, ix, iy, iangle, toScreenX, toScreenY, zoom);
    ringLogFrame(state);

    // ---- Pixelation blit: world layer up to the screen ----
    // Restore the real surface, then nearest-neighbour the offscreen
    // over the full canvas (opaque sky = full cover, no clear
    // needed). The sticks below then draw native — UI glass never
    // pixelates.
    if (px) {
      width = realW; height = realH; dpr = realDpr;
      ctx = baseCtx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Nearest-neighbour, insisted on three ways: the standard flag,
      // the WebKit-prefixed one (Safari honoured only the prefix for
      // years and some builds still do), and the CSS hint on the
      // element itself — compositor-side scaling of the canvas
      // ignores ctx flags entirely, and THAT was the visible blur.
      crispSnap(pxCanvas.getContext('2d'), pxCanvas.width, pxCanvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      if (canvas.style && canvas.style.imageRendering !== 'pixelated') {
        canvas.style.imageRendering = 'pixelated';
      }
      ctx.drawImage(pxCanvas, 0, 0, pxCanvas.width, pxCanvas.height,
        0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.webkitImageSmoothingEnabled = true;
    } else if (canvas.style && canvas.style.imageRendering) {
      canvas.style.imageRendering = '';   // native mode: no CSS hint
    }

    // The visible thumbstick sits on top of everything: it's UI glass.
    drawInputSticks(ctx);
  }

  // The splat predictor now lives in js/pilot.js — sim-tier and
  // deterministic, because the bots' oracle brain uses the SAME code
  // the ring draws. The practice ring is therefore a debug view of
  // the AI: any improvement to the predictor upgrades both at once,
  // and neither can drift from the other.
  const predictSplat = (state, m, trace) => window.FF.pilot.predictSplat(state, m, trace);

  // ---- RING DEBUG LOGGER (CONFIG.ringLog) ----
  // One compact line per event into the console AND window.RINGLOG.
  // Race full-right with practiceSplat on, then in the console run:
  //   copy(RINGLOG.join('\n'))
  // and paste the result back. Episode grammar:
  //   EP n LAUNCH t=.. pos=.. v=.. w=.. e=.. pred=worst/T RED|GRN
  //   EP n FLIP t=.. pred=..        (verdict changed mid-air)
  //   EP n PRE t=.. pred=..  pc=[+ticks:vn:sev ...]  (last frame
  //        before contact, with the predictor's IMAGINED contacts)
  //   EP n HIT t=.. sev=.. T=.. died=0|1   (each REAL contact)
  //   EP n END SETTLED|DIED launch=.. pre=.. actualMax=.. [MISMATCH]
  const RL = { ep: 0, air: false, lastPred: null, launch: null, hits: 0, maxSev: 0, maxPair: 0, t0: 0 };
  function rlog(s) {
    if (!window.RINGLOG) window.RINGLOG = [];
    window.RINGLOG.push(s);
    console.log('[ring] ' + s);
  }
  function ringLogFrame(state) {
    if (!CONFIG.ringLog) return;
    const m = state.melon;
    if (m.alive && (m.pairSeverity || 0) > RL.maxPair) RL.maxPair = m.pairSeverity;
    if (!m.alive) {
      if (RL.air || RL.hits) {
        const pairKill = RL.maxPair > RL.maxSev;
        rlog('EP ' + RL.ep + ' END DIED' + (pairKill ? '(PAIR: bot collision — outside the ring\'s scope)' : '')
          + ' launch=' + (RL.launch ? RL.launch.v : '?')
          + ' pre=' + (RL.lastPred ? (RL.lastPred.splat ? 'RED' : 'GRN') + ':' + Math.round(RL.lastPred.worst) : '?')
          + ' actualMax=' + Math.round(RL.maxSev)
          + (RL.lastPred && !RL.lastPred.splat && !pairKill ? ' MISMATCH(green-splat)' : ''));
        RL.air = false; RL.hits = 0; RL.maxSev = 0; RL.maxPair = 0; RL.lastPred = null; RL.launch = null;
      }
      return;
    }
    const air = m.hitSeverity === 0;
    if (air) {
      const p = predictSplat(state, m, true);
      const v = p.splat ? 'RED' : 'GRN';
      if (!RL.air) {
        RL.ep++; RL.t0 = state.tick; RL.hits = 0; RL.maxSev = 0;
        RL.launch = { v, worst: p.worst };
        rlog('EP ' + RL.ep + ' LAUNCH t=' + state.tick
          + ' pos=(' + Math.round(m.x) + ',' + Math.round(m.y) + ')'
          + ' v=(' + Math.round(m.vx) + ',' + Math.round(m.vy) + ')'
          + ' w=' + m.omega.toFixed(1) + ' ang=' + (m.angle % 6.283).toFixed(2)
          + ' e=' + (m.restitution !== undefined ? m.restitution.toFixed(2) : '?')
          + ' axis=' + (state.input.torqueAxis || 0).toFixed(2)
          + ' pred=' + Math.round(p.worst) + '/' + Math.round(p.T) + ' ' + v);
      } else if (RL.lastPred && RL.lastPred.splat !== p.splat) {
        rlog('EP ' + RL.ep + ' FLIP t=' + state.tick + ' pred=' + Math.round(p.worst) + ' ' + v);
      }
      RL.lastPred = p;
      RL.air = true;
    } else {
      if (RL.air) {
        // First frame of contact: dump the pre-contact prediction.
        const p = RL.lastPred;
        let pc = '';
        if (p && p.trace) pc = ' pc=[' + p.trace.slice(0, 4).map(c => '+' + c.dt + ':' + c.sev + '@vy' + c.vy).join(' ') + ']';
        rlog('EP ' + RL.ep + ' PRE t=' + (state.tick - 1) + ' pred=' + (p ? Math.round(p.worst) : '?')
          + ' ' + (p ? (p.splat ? 'RED' : 'GRN') : '?') + pc);
        RL.air = false;
      }
      if (m.hitSeverity > RL.maxSev * 1.0001 || (m.hitSeverity > 50 && RL.hits < 8)) {
        if (m.hitSeverity > 50) {
          RL.hits++;
          const mr = 1 / (m.invM * CONFIG.mass);
          const T = CONFIG.smashThreshold * (mr === 1 ? 1 : Math.pow(mr, CONFIG.sizeToughness / 3));
          rlog('EP ' + RL.ep + ' HIT t=' + state.tick + ' sev=' + Math.round(m.hitSeverity)
            + ' T=' + Math.round(T) + ' vy@hit=' + Math.round(m.vy) + ' w=' + m.omega.toFixed(1));
        }
        if (m.hitSeverity > RL.maxSev) RL.maxSev = m.hitSeverity;
      }
      // Settled: a stretch of grounded ticks closes the episode.
      if (state.tick - RL.t0 > 3 && RL.hits > 0 && m.hitSeverity < 50) {
        rlog('EP ' + RL.ep + ' END SETTLED launch=' + (RL.launch ? RL.launch.v : '?')
          + ' pre=' + (RL.lastPred ? (RL.lastPred.splat ? 'RED' : 'GRN') + ':' + Math.round(RL.lastPred.worst) : '?')
          + ' actualMax=' + Math.round(RL.maxSev)
          + (RL.lastPred && RL.lastPred.splat ? ' MISMATCH(red-survived)' : ''));
        RL.hits = 0; RL.maxSev = 0; RL.lastPred = null; RL.launch = null;
      }
    }
  }

  // ---- THE DANGER RIM (CONFIG.dangerRim, 2026-08-13) ----
  // The shipped, in-race landing-fate signal. Eddie's constraints
  // shaped it: the verdict lives ON THE PLAYER OBJECT (not the stick,
  // not an instrument circle — the practice ring stays a dev tool),
  // and it must be readable mid-air. So: an outline hugging the
  // body's own silhouette, rotating with it, in three states —
  //
  //   nothing  the landing you are committed to is survivable AS HELD
  //   AMBER    it kills as held, but flare saves it: flare up until
  //            the amber goes out — the rim extinguishing IS the
  //            confirmation, a feedback loop that teaches the flare
  //            without a word of text
  //   RED      no stick position survives this one (the need exceeds
  //            bounceMax): the only play left is steering for
  //            shallower ground — honest exoneration, same doctrine
  //            as the coach line's "nothing would have saved that"
  //
  // Driven by pilot.predictSplat — the SAME clone-stepping forecast
  // the oracle brain races on, so showing it to the player is parity
  // with our own AI, not an assist. Because the clone holds the LIVE
  // inputs, moving the flare (or the spin — the certificate's spinVn
  // term measured a 3x severity swing from spin phase alone) re-asks
  // and re-answers: both survival levers become legible through one
  // signal. Presentation tier: reads state, clones, never writes sim.
  //
  // COST: the prediction re-asks on the oracle's own cadence (10
  // ticks) while airborne, plus a faster path when the flare moves,
  // floored at 3 ticks so a fast swipe can't ask every frame. One
  // extra predicting body under the budget The Rindfather already
  // pays. The tapered egg draws an ellipse rim — a glow, not a
  // collider; the approximation is invisible at 6px of padding.
  const RIM = { askTick: -1e9, askAxis: 0, verdict: 0 };
  const RIM_REASK_TICKS = 10;   // the oracle's own re-ask cadence
  const RIM_INPUT_TICKS = 3;    // floor for input-triggered re-asks
  function drawDangerRim(ctx, state, ix, iy, iangle, toScreenX, toScreenY, zoom) {
    if (!CONFIG.dangerRim) return;
    // The rim coaches a landing the player is about to make; under
    // autopilot they are making none, and on the held grid the hover
    // is not a fall.
    if (window.FF.autopilot && !window.FF.autopilot.playerIsDriving()) return;
    if (window.FF.gridStart && window.FF.gridStart.isHolding && window.FF.gridStart.isHolding()) return;
    const m = state.melon;
    if (!m.alive || m.hitSeverity > 0) { RIM.askTick = -1e9; RIM.verdict = 0; return; }
    const ax = state.input.bounceAxis || 0;
    const since = state.tick - RIM.askTick;
    if (since >= RIM_REASK_TICKS || (since >= RIM_INPUT_TICKS && Math.abs(ax - RIM.askAxis) > 0.12)) {
      RIM.askTick = state.tick;
      RIM.askAxis = ax;
      const p = window.FF.pilot.predictSplat(state, m);
      if (!p.splat) {
        RIM.verdict = 0;
      } else {
        const D = window.FF.damage;
        const need = D.restitutionToSurvive(p.worst, p.T, D.bodyRestitution(m));
        // null = unreachable at any bounciness; above bounceMax = the
        // stick tops out short of it. Both are honest REDs — an amber
        // that full flare cannot actually extinguish would be the rim
        // promising a save it can't deliver.
        RIM.verdict = (need === null || need > CONFIG.bounceMax) ? 2 : 1;
      }
    }
    if (!RIM.verdict) return;
    const col = RIM.verdict === 2 ? '255, 92, 74' : '255, 213, 74';
    const sx = toScreenX(ix), sy = toScreenY(iy);
    const pad = 6;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(iangle);
    // Two strokes, no shadowBlur: a glow a phone can afford. World-
    // scaled weights, same doctrine as the practice ring's stroke.
    ctx.beginPath();
    ctx.ellipse(0, 0, (m.a + pad) * zoom, (m.b + pad) * zoom, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${col}, 0.20)`;
    ctx.lineWidth = Math.max(2.5, 7 * zoom);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${col}, 0.85)`;
    ctx.lineWidth = Math.max(1.1, 2.4 * zoom);
    ctx.stroke();
    ctx.restore();
  }

  function drawSplatVerdict(ctx, state, ix, iy, iangle, toScreenX, toScreenY, zoom) {
    if (!CONFIG.practiceSplat) return;
    // The ring coaches a landing the player is about to make; under
    // autopilot they are making none.
    if (window.FF.autopilot && !window.FF.autopilot.playerIsDriving()) return;
    const m = state.melon;
    // Grounded = rolling contact dissipates a whisper every tick, so
    // hitSeverity > 0 IS the grounded test; airborne fires nothing.
    if (!m.alive || m.hitSeverity > 0) return;
    const p = predictSplat(state, m);
    // BINARY, by design ruling: a fall either kills or it doesn't.
    const col = p.splat ? '255, 92, 74' : '92, 235, 110';
    const sx = toScreenX(ix), sy = toScreenY(iy);
    const r = (Math.max(m.a, m.b) + 14) * zoom;
    ctx.save();
    ctx.strokeStyle = `rgba(${col}, 0.55)`;
    // The ring belongs to the MELON, so its stroke is a world
    // measurement like its radius — not a fixed screen width. A flat
    // 3px looked right at desktop zoom 1 and heavy on a phone, where
    // zoom is ~0.52: the melon shrank and the line did not. The floor
    // keeps it from disappearing entirely if the view ever zooms far
    // out. The coefficient is DESKTOP'S OWN look preserved: 3px at
    // zoom 1 is 5% of the ring's radius, so 3 * zoom holds that 5%
    // everywhere rather than inventing a new weight.
    ctx.lineWidth = Math.max(1.25, 3 * zoom);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }


  // ---- The floating thumbstick (Eddie, 2026-08-11) ----
  // Draws whatever input.js is actually doing — same anchors, same
  // deadzone, same shaping — so the visual is the truth, not a
  // decoration. Design brief: GLASS, not chrome. The player chose
  // where to put their thumb; the stick must never make that choice
  // cost anything, so everything is thin strokes at low alpha, no
  // filled discs. The ring is an INSTRUMENT, not a cursor: the
  // horizontal guide line through the centre IS the flare-neutral
  // marker, and the ring's upper/lower arc brightens with the flare
  // you're actually holding (green up = bouncy armour, ember down =
  // dead rubber) — the one piece of game state that was previously
  // invisible, readable at a glance. Under the CIRCULAR gamut the
  // ring is the TRUE input boundary, so the visual and the semantics
  // are the same shape. Fast fade-in (~80ms), slower
  // fade-out (~250ms) so releases read as deliberate. Multi-touch
  // draws every stick, because input sums every stick — the visual
  // may not lie about the semantics. Strictly presentation-tier.
  const STICK_UI = {
    R: 64,            // must match input.js STICK_R (CSS px)
    DZ: 0.16,         // must match input.js DEADZONE
    NUB: 13,
    UP_TINT: '127, 220, 102',   // bouncy: the game's green family
    DOWN_TINT: '255, 122, 82',  // dead rubber: ember
  };
  function drawInputSticks(ctx) {
    if (!window.FF.getInputSticks) return;
    const sticks = window.FF.getInputSticks(performance.now());
    if (!sticks.length) return;
    ctx.save();
    // Client (CSS px) coordinates -> device pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    for (const s of sticks) {
      const fadeIn = Math.min(1, s.ageDown / 80);
      const fadeOut = s.ageUp === null ? 1 : Math.max(0, 1 - s.ageUp / 250);
      const A = fadeIn * fadeOut;
      if (A <= 0) continue;
      const { R, DZ, NUB } = STICK_UI;
      const cx = s.x0, cy = s.y0;
      // Ring.
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 * A})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      // Deadzone: the null region, so the neutral is learnable.
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.10 * A})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * DZ, 0, Math.PI * 2);
      ctx.stroke();
      // Horizontal guide: the spin axis AND the flare-neutral line.
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 * A})`;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx - R * DZ, cy);
      ctx.moveTo(cx + R * DZ, cy); ctx.lineTo(cx + R, cy);
      ctx.stroke();
      // Flare readout: the held bounce value, painted on the ring.
      if (s.ay > 0.01 || s.ay < -0.01) {
        const up = s.ay > 0;
        const mag = Math.min(1, Math.abs(s.ay));
        const tint = up ? STICK_UI.UP_TINT : STICK_UI.DOWN_TINT;
        // Arc grows from the pole outward with the magnitude; screen y
        // is down, so the UP pole is -PI/2.
        const pole = up ? -Math.PI / 2 : Math.PI / 2;
        const span = (Math.PI / 2.4) * mag;
        ctx.strokeStyle = `rgba(${tint}, ${(0.12 + 0.30 * mag) * A})`;
        ctx.lineWidth = 2 + 2.5 * mag;
        ctx.beginPath();
        ctx.arc(cx, cy, R, pole - span, pole + span);
        ctx.stroke();
      }
      // Nub: the thumb's true offset, clamped to the ring.
      let dx = s.dx, dy = s.dy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * A})`;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.20 * A})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, NUB, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
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
  // English ordinal suffix. The teens are the classic trap (eleventh,
  // not eleven-first), so 11/12/13 are special-cased before the
  // last-digit rule — a 12+ racer field would hit it.
  function ordinalSuffix(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return 'th';
    const d = n % 10;
    return d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  }

  // The place palette, shared in spirit with the finish screen's
  // (.ff-pos rules in flow.js): podium gold/silver/bronze, the
  // player's sacred green, bone white for the rest, with the suffix a
  // step quieter. Kept in sync BY HAND — two renderers, one language.
  const PLACE_COLORS = {
    1: [255, 213, 74],    // gold
    2: [216, 226, 230],   // silver
    3: [224, 160, 106],   // bronze
    0: [207, 232, 207],   // the rest: bone
  };
if (window.FF && window.FF.palette) window.FF.palette.register('places', []); // Phase 0.1

  const PLACE_YOU = [57, 255, 95];
  const PLACE_SUF = [127, 163, 131];

  function drawPlace(ctx, sx, sy, n, zoom, isPlayer) {
    // Ordinal, drawn as TWO pieces so the numeral keeps its full size
    // and the suffix rides small on its shoulder — the number is what
    // you read at a glance mid-race; the suffix only has to be
    // legible. Styled to match the finish screen: BOLD numeral in the
    // podium/player colour, lighter dimmer suffix. Alpha stays
    // moderate because these labels live over the moving track — the
    // finish screen can afford full strength on a dark panel, a race
    // label cannot without shouting over the terrain.
    // The pair is measured and centred as a UNIT, so "1st" and "12th"
    // both sit dead centre over their fruit (centring on the numeral
    // alone would shift the label sideways on every overtake).
    // TIERS, matching the finish screen exactly: the podium is bold,
    // full-size and bright; from 4th back the numbers are lighter,
    // smaller and dimmer, so a field of also-rans can never be
    // mistaken for more silver. Your own label is never dimmed —
    // it's the one you look for.
    const podium = n <= 3;
    const loud = podium || isPlayer;
    const base = Math.max(9, Math.round(CONFIG.semiMinor * 0.8 * zoom));
    const size = loud ? base : Math.max(8, Math.round(base * 0.85));
    const num = String(n);
    const suf = ordinalSuffix(n);
    // The suffix is TWO STEPS down the interface's scale from the
    // numeral (1 / 1.25^2 = 0.64). World-scaled, because these labels
    // live in the scene — but proportioned by the same law as the UI,
    // so the game reads as one typographic system. See js/type.js.
    const R = (window.FF.type && window.FF.type.RATIO) || 1.25;
    const sufSize = Math.max(7, Math.round(size / (R * R)));
    const fNum = `${loud ? 700 : 400} ${size}px "Geist Mono", ui-monospace, monospace`;
    const fSuf = `${loud ? 600 : 400} ${sufSize}px "Geist Mono", ui-monospace, monospace`;
    const c = isPlayer ? PLACE_YOU : (PLACE_COLORS[n] || PLACE_COLORS[0]);
    const s = isPlayer ? PLACE_YOU : PLACE_SUF;
    // Alphas mirror the CSS: 0.62/0.45 for the loud rows, ~0.42 of
    // that presence for the field behind them.
    const numAlpha = loud ? 0.62 : 0.42;
    const sufAlpha = loud ? 0.45 : 0.30;
    if (pxMode && window.FF.pxfont) {
      // Phase 3.1: the ordinal in the bitmap font — numeral scale 2
      // for the podium/player, 1 for the field; alphas become solid
      // pre-composited tones (over the black sky these labels live
      // against). The shoulder convention survives at pixel scale.
      const PF = window.FF.pxfont;
      const scN = loud ? 2 : 1;
      const solid = (rgb, al) => '#' + [0, 1, 2].map((i) =>
        Math.round(rgb[i] * al).toString(16).padStart(2, '0')).join('');
      const wNum2 = PF.measure(num, scN), wSuf2 = PF.measure(suf, 1);
      const x1 = Math.round(sx - (wNum2 + 1 + wSuf2) / 2);
      const y1 = Math.round(sy - 100 * zoom) - 3 * scN;
      PF.draw(ctx, num, x1, y1, scN, solid(c, numAlpha));
      PF.draw(ctx, suf, x1 + wNum2 + 1, y1 - 2, 1, solid(s, sufAlpha));
      return;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = fNum;
    const wNum = ctx.measureText(num).width;
    ctx.font = fSuf;
    const wSuf = ctx.measureText(suf).width;
    const x0 = sx - (wNum + wSuf) / 2;
    const y = sy - 100 * zoom;
    ctx.font = fNum;
    ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${numAlpha})`;
    ctx.fillText(num, x0, y);
    ctx.font = fSuf;
    ctx.fillStyle = `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${sufAlpha})`;
    // The suffix rides on the numeral's SHOULDER. This is the game's
    // one ordinal convention — the finish screen follows it too.
    ctx.fillText(suf, x0 + wNum, y - size * 0.17);
  }

  // ---- BAKED SPRITE MELONS (pixelation mode) ----
  // Per-frame rasterization of a small rotating body is the worst
  // case for low-res rendering: the same melon re-rasterizes to
  // different pixels every frame (boiling). The retro-correct cure:
  // bake each melon ONCE per (colour, pattern, body, radius, decal
  // loadout) at quantized rotations, then blit the identical
  // pixels forever. The bake renders at 8x through the SAME vector
  // painter (64 quantized rotations), then MAJORITY-VOTE
  // downsamples: each sprite pixel takes
  // the dominant colour of its 8x8 block, not the average — voting
  // answers "what IS this pixel" where averaging answers "what is
  // the mean near it" (that mean is anti-aliasing, the mush we are
  // escaping). Stepped 32-angle rotation is a period artifact, kept
  // deliberately.
  let pxMode = false;                  // set by render() per frame
  // Phase 2.1: during a sprite bake this holds the TARGET pixel
  // radius, so pattern painters can simplify below legibility (a
  // 16 px melon carries 3 bold stripes, not 6 fine ones). null
  // outside bakes = full detail.
  let bakeLodR = null;
  // Ruling pending real captures (Eddie, 2026-08-18): the simplified
  // pattern tier is OFF by default — at 320 every melon fell under
  // the 12 px cutoff, so LOD silently restyled the whole cast. Tune
  // with FF.PX_LOD_R (e.g. 12) against dev-lane captures.
  const lodSimple = () => bakeLodR !== null
    && bakeLodR < ((window.FF.PX_LOD_R | 0) || 0);
  const SPRITE_ANGLES = 64;  // ruled up from 32: halves the settle-
                             // snap; past 64 adjacent frames bake
                             // near-identical pixels
  const melonSprites = new Map();
  function decalsSig(decals) {
    if (!decals || !decals.length) return '';
    let sig = '';
    for (const wd of decals) {
      sig += (wd.id || '') + '@' + Math.round((wd.u || 0) * 50) + ','
        + Math.round((wd.v || 0) * 50) + ',' + Math.round((wd.rot || 0) * 10)
        + ',' + Math.round((wd.s || 1) * 20) + ';';
    }
    return sig;
  }
  // Phase 2.2 — BAKE GUARANTEES, pure functions over index sprites so
  // verify-px-honesty can unit-test them without a canvas. Both encode
  // artist judgment the vote lacks:
  //  * the silhouette never breaks: any body pixel touching
  //    transparency (or the sprite border) becomes the rim tone — the
  //    first rule of readable pixel art at small radius;
  //  * the highlight never vanishes: if the vector render carried a
  //    significant lightest tone that the vote erased, it is stamped
  //    back (2 px at its source centroid) — the glint is the melon's
  //    life at 16 px.
  function pxRimGuarantee(idx, w, h, rimIdx) {
    const src = idx.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (src[p] === 255) continue;
        const edge = x === 0 || x === w - 1 || y === 0 || y === h - 1
          || src[p - 1] === 255 || src[p + 1] === 255
          || src[p - w] === 255 || src[p + w] === 255;
        if (edge) idx[p] = rimIdx;
      }
    }
  }
  // Highlight-priority block vote: a block that is >= 25% lit-cap
  // tone goes to the LIGHT — the artist's rule that light reads over
  // mass. Preserves the real lit-region shape instead of a token
  // stamp. Pure, unit-tested.
  function pxBlockWinner(tally, hiInt, quarter) {
    if (hiInt >= 0) {
      const hc = tally.get(hiInt) || 0;
      if (hc >= quarter) return hiInt;
    }
    let bk = 0, bc2 = -1;
    for (const [kk, c] of tally) if (c > bc2) { bc2 = c; bk = kk; }
    return bk;
  }
  // Morphological close: a transparent pixel with >= 6 of 8 opaque
  // neighbours is a vote NOTCH, not silhouette — filled with its
  // neighbours' majority tone. Notches over the black sky read as
  // black holes IN the melon (measured on device). Strict threshold:
  // the silhouette never grows. Pure, unit-tested.
  function pxClose(idx, w, h) {
    const src = idx.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (src[p] !== 255) continue;
        const tally = new Map();
        let op = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nk = src[(y + dy) * w + x + dx];
            if (nk === 255) continue;
            op++;
            tally.set(nk, (tally.get(nk) || 0) + 1);
          }
        }
        if (op >= 6) {
          let bk = 255, bc2 = -1;
          for (const [kk, c] of tally) if (c > bc2) { bc2 = c; bk = kk; }
          idx[p] = bk;
        }
      }
    }
  }
  function pxHighlightGuarantee(idx, w, h, hiIdx, cx, cy) {
    for (let i = 0; i < idx.length; i++) if (idx[i] === hiIdx) return false;
    let best = -1, bd = Infinity;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (idx[p] === 255) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bd) { bd = d; best = p; }
      }
    }
    if (best < 0) return false;
    idx[best] = hiIdx;
    if (idx[best + 1] !== undefined && idx[best + 1] !== 255) idx[best + 1] = hiIdx;
    return true;
  }
  window.FF._pxSprite = { rim: pxRimGuarantee, highlight: pxHighlightGuarantee,
    blockWinner: pxBlockWinner, close: pxClose };
  // Dev-lane capture (Eddie, 2026-08-18): the actual 320 buffer as a
  // PNG data URL — ground truth for visual iteration, because PIL
  // reconstructions passed proofs while the real device regressed.
  window.FF._pxCapture = () => {
    try { return pxCanvas ? pxCanvas.toDataURL('image/png') : null; }
    catch (e) { return null; }
  };

  // ---- THE FRAME CACHE (rebuilt 2026-08-18, Eddie's ruling) ----
  // v1 baked all 64 rotations EAGERLY at 8x supersample the moment a
  // variant first appeared: ~29M pixel reads and 64 getImageData
  // calls, synchronously, on the main thread — the multi-second
  // freeze measured when applying a wrap. Three structural fixes:
  //
  //  1. ON DEMAND, PER FRAME. A melon shows ONE pose at a time; a
  //     portrait shows one forever. Frames bake when first needed.
  //  2. SS 8 -> 4. The vote samples a DOMINANT colour; 16 samples
  //     per block decide it as reliably as 64 at these radii, at a
  //     quarter of the cost.
  //  3. TIME-SLICED. A per-rendered-frame bake budget; anything not
  //     yet baked paints VECTOR this frame and bakes on a later one.
  //     Nothing ever blocks, and the fallback is invisible because
  //     it is the same artwork the bake is derived from.
  //
  // SQUASH IS NOW BAKED (R2 ruled): the deformation is applied INSIDE
  // the bake by the vector painter, so a splat frame is authored
  // pixels, not a runtime affine on a sprite. The parameter space is
  // rotation x squash-axis x squash-magnitude — thousands of
  // combinations in principle, which is exactly why it is lazy: a
  // race visits a few dozen (impacts cluster hard around ground
  // normals), and each is baked once, forever.
  const SQ_AXES = 32;                  // squash axis quantization
  const SQ_MAGS = 4;                   // magnitude levels above the gate
  const SQ_GATE = 0.08;                // below this: undeformed frame
  const SQ_MAX = 0.42;                 // top of the magnitude ladder
  const SS = 4, PAD = 2;
  let bakeBudget = 0;                  // refilled each rendered frame
  const BAKE_PER_FRAME = 3;

  function variantEntry(color, seedKey, a, b, rPx, fruit, decals) {
    const key = color + '|' + seedKey + '|' + (fruit || '') + '|'
      + a.toFixed(1) + '|' + b.toFixed(1) + '|' + rPx + '|' + decalsSig(decals);
    let e = melonSprites.get(key);
    if (e !== undefined) return e;
    if (typeof document === 'undefined') { melonSprites.set(key, null); return null; }
    const spr = 2 * (rPx + PAD);
    e = { spr, rPx, a, b, color, seedKey, fruit, decals, frames: new Map(),
      big: null, btx: null };
    melonSprites.set(key, e);
    return e;
  }

  // frameKey packs (rotation, axis, magnitude) into one integer.
  const frameKey = (rot, ax, mag) => (rot * (SQ_AXES + 1) + ax) * (SQ_MAGS + 1) + mag;

  function bakeFrame(e, rot, ax, mag) {
    const spr = e.spr, big = spr * SS;
    if (!e.big) {
      e.big = document.createElement('canvas');
      e.big.width = big; e.big.height = big;
      e.btx = e.big.getContext('2d');
    }
    const btx = e.btx;
    const zoomBake = (e.rPx * SS) / e.a;
    const half = (SS * SS) * 0.45;
    const quarter = (SS * SS) * 0.25;
    bakeLodR = e.rPx;                  // Phase 2.1: painters simplify
    const sh = window.FF.shading;
    btx.setTransform(1, 0, 0, 1, 0, 0);
    btx.clearRect(0, 0, big, big);
    // The squash the painter applies — quantized, and applied HERE so
    // the deformation is voted into pixels like everything else.
    const sq = mag > 0
      ? { squash: SQ_GATE + (SQ_MAX - SQ_GATE) * (mag / SQ_MAGS),
        squashAngle: (ax / SQ_AXES) * Math.PI * 2 }
      : null;
    drawMelonVector(btx, big / 2, big / 2, rot * 2 * Math.PI / SPRITE_ANGLES,
      sq, e.color, zoomBake, e.seedKey, e.a, e.b, e.fruit, e.decals);
    let src;
    try { src = btx.getImageData(0, 0, big, big); }
    catch (err) { bakeLodR = null; return null; }
    const sd = src.data;
    const colors = [];
    const colorIdx = new Map();
    const cOf = (kk) => {
      let ci = colorIdx.get(kk);
      if (ci === undefined) { ci = colors.length; colors.push(kk); colorIdx.set(kk, ci); }
      return ci;
    };
    const idx = new Uint8Array(spr * spr).fill(255);
    // Pre-pass: the TRUE rendered highlight tone + its centroid.
    const srcHist = new Map();
    for (let sy2 = 0; sy2 < big; sy2++) {
      const row = sy2 * big * 4;
      for (let sx2 = 0; sx2 < big; sx2++) {
        const i4 = row + sx2 * 4;
        if (sd[i4 + 3] < 128) continue;
        const kk = (sd[i4] << 16) | (sd[i4 + 1] << 8) | sd[i4 + 2];
        let hrec = srcHist.get(kk);
        if (!hrec) { hrec = { c: 0, sx: 0, sy: 0 }; srcHist.set(kk, hrec); }
        hrec.c++; hrec.sx += sx2 / SS; hrec.sy += sy2 / SS;
      }
    }
    let hiInt = -1, hiL = -1, hiRec = null;
    if (sh) {
      for (const [kk, rec] of srcHist) {
        if (rec.c < 4) continue;
        const L = sh.lstarOf((kk >> 16) & 255, (kk >> 8) & 255, kk & 255);
        if (L > hiL) { hiL = L; hiInt = kk; hiRec = rec; }
      }
    }
    for (let y = 0; y < spr; y++) {
      for (let x = 0; x < spr; x++) {
        const tally = new Map();
        let opaque = 0;
        for (let sy2 = 0; sy2 < SS; sy2++) {
          const row = ((y * SS + sy2) * big + x * SS) * 4;
          for (let sx2 = 0; sx2 < SS; sx2++) {
            const i4 = row + sx2 * 4;
            if (sd[i4 + 3] < 128) continue;
            opaque++;
            const kk = (sd[i4] << 16) | (sd[i4 + 1] << 8) | sd[i4 + 2];
            tally.set(kk, (tally.get(kk) || 0) + 1);
          }
        }
        if (opaque >= half) idx[y * spr + x] = cOf(pxBlockWinner(tally, hiInt, quarter));
      }
    }
    pxClose(idx, spr, spr);
    if (hiInt >= 0 && hiRec) {
      pxHighlightGuarantee(idx, spr, spr, cOf(hiInt),
        hiRec.sx / hiRec.c, hiRec.sy / hiRec.c);
    }
    const fc = document.createElement('canvas');
    fc.width = spr; fc.height = spr;
    const ftx = fc.getContext('2d');
    const out = ftx.createImageData(spr, spr);
    const od = out.data;
    for (let p = 0; p < idx.length; p++) {
      const ci = idx[p];
      if (ci === 255) continue;
      const kk = colors[ci];
      const o4 = p * 4;
      od[o4] = kk >> 16; od[o4 + 1] = (kk >> 8) & 255;
      od[o4 + 2] = kk & 255; od[o4 + 3] = 255;
    }
    ftx.putImageData(out, 0, 0);
    bakeLodR = null;
    return { canvas: fc, idx, colors };
  }

  // The one door: returns a baked frame, or null when the budget is
  // spent (caller paints vector this frame and tries again next).
  function melonFrame(e, rot, ax, mag) {
    if (!e) return null;
    const fk = frameKey(rot, ax, mag);
    const hit = e.frames.get(fk);
    if (hit !== undefined) return hit;
    if (bakeBudget <= 0) return null;
    bakeBudget--;
    const f = bakeFrame(e, rot, ax, mag);
    e.frames.set(fk, f);
    return f;
  }

  // Quantize a live squash into (axis, magnitude). mag 0 = undeformed.
  function squashSlot(squash) {
    if (!squash || !(squash.squash > SQ_GATE)) return { ax: 0, mag: 0 };
    const t = Math.min(1, (squash.squash - SQ_GATE) / (SQ_MAX - SQ_GATE));
    const mag = Math.max(1, Math.min(SQ_MAGS, Math.round(t * SQ_MAGS)));
    const TAU = Math.PI * 2;
    let ang = squash.squashAngle % TAU;
    if (ang < 0) ang += TAU;
    const ax = Math.round(ang / TAU * SQ_AXES) % SQ_AXES;
    return { ax, mag };
  }

  function melonSpriteFrames(color, seedKey, a, b, rPx, fruit, decals) {
    return variantEntry(color, seedKey, a, b, rPx, fruit, decals);
  }
  // Verification surface for the cache's pure parts.
  window.FF._pxBake = { squashSlot, frameKey, SS, SQ_AXES, SQ_MAGS,
    SQ_GATE, SQ_MAX, BAKE_PER_FRAME };

  function drawMelon(ctx, sx, sy, angle, squash, color, zoom, seedKey, bodyA, bodyB, fruit, decals) {
    if (pxMode) {
      const a = bodyA || CONFIG.semiMajor;
      const b = bodyB || CONFIG.semiMinor;
      const rPx = Math.max(3, Math.round(a * zoom));
      const e = melonSpriteFrames(color, seedKey, a, b, rPx, fruit, decals);
      const slot = squashSlot(squash);
      if (e) {
        const TAU = Math.PI * 2;
        const k = ((Math.round(angle / (TAU / SPRITE_ANGLES)) % SPRITE_ANGLES)
          + SPRITE_ANGLES) % SPRITE_ANGLES;
        // R2 SHIPPED: the squash is IN the frame. No runtime affine —
        // a splat is authored pixels at integer position, like every
        // other frame. A frame not yet baked returns null and the
        // vector painter covers this tick (time-slicing).
        const f = melonFrame(e, k, slot.ax, slot.mag);
        if (f) {
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.translate(Math.round(sx), Math.round(sy));
          ctx.drawImage(f.canvas, -e.spr / 2, -e.spr / 2);
          ctx.restore();
          return;
        }
      }
    }
    drawMelonVector(ctx, sx, sy, angle, squash, color, zoom, seedKey, bodyA, bodyB, fruit, decals);
  }

  function drawMelonVector(ctx, sx, sy, angle, squash, color, zoom, seedKey, bodyA, bodyB, fruit, decals) {
    const a = bodyA || CONFIG.semiMajor;
    const b = bodyB || CONFIG.semiMinor;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(zoom, zoom); // world-sized body under the camera lens

    // Squash: compress along the impact normal, stretch along tangent.
    // Applied in the impact frame, then we rotate into body frame.
    // (fx is null for ghost bodies — they carry no impact FX.)
    // The body carries its own strain: m.squash / m.squashAngle. (This
    // read was .amount/.angle for a while — undefined, silently false,
    // no error, no deformation on screen anywhere.)
    if (squash && squash.squash > 0.003) {
      ctx.rotate(squash.squashAngle + Math.PI / 2);
      ctx.scale(1 + squash.squash, 1 - squash.squash);
      ctx.rotate(-(squash.squashAngle + Math.PI / 2));
    }

    // Cel-shaded body: world-fixed sun, terminator the surface rolls
    // beneath. The rotation that was invisible by design is now
    // readable against the light.
    shadeEllipse(ctx, angle, a, b, color || COLORS.rind, seedKey, fruit, undefined, decals);

    ctx.restore();
  }

// ---- Cel lighting: delegated to the RIG (js/shading.js) ----
  // The renderer owns no lighting constants: sun, bands, deltas, and
  // every effect parameter live in FF.shading.P, editable live by the
  // Shader Studio. This file only DRAWS what the rig solves.
  const RIG = window.FF.shading;
  // Lit tone for non-band consumers (ghosts, legacy call sites): the
  // brightest ENABLED band's delta, so it follows the rig's band stack.
  const litColor = (hex) => RIG.slotColor(hex, RIG.P.highlightFillSlot);
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

  // ---- Body outline: ellipse, or a TAPERED egg ----
  // A species can declare `taper`: the half-height is scaled by
  // (1 - taper * cos t), which narrows one end and fattens the other —
  // a real egg profile rather than a symmetric ellipse. taper 0 traces
  // the plain ellipse, so melons are unaffected.
  // NOTE: the COLLIDER remains a true ellipse. At taper 0.26 the
  // silhouette departs from it by a few px at the narrow end only;
  // making the physics egg-shaped means new support, curvature and
  // segment solvers, which is its own piece of work.
  function bodyPath(ctx, a, b, angle, taper) {
    if (!taper) { ctx.ellipse(0, 0, a, b, angle, 0, Math.PI * 2); return; }
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t) * (1 - taper * Math.cos(t));
      const wx = x * ca - y * sa, wy = x * sa + y * ca;
      if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
    }
    ctx.closePath();
  }

  // patternScale: device pixels per world pixel at the destination.
  // Defaults to the in-race supersample when a caller doesn't know or
  // doesn't care (every racing body).
  function shadeEllipse(ctx, angle, a, b, baseColor, seedKey, fruit, patternScale, decals, decalPreview) {
    const TAU2 = Math.PI * 2;
    // A species may carry ONE colour fact of its own — the pattern-
    // anchor offset (FRUITS[x].patternOffset, e.g. a red star on
    // orange). The lighting curve is global; shading.js applies it to
    // both anchors, so every species shades under the same law.
    const SP = (window.FF.FRUITS && window.FF.FRUITS[fruit]) || null;
    const spPat = SP && SP.patternOffset;
    const taper = (SP && SP.taper) || 0;
    const B = RIG.bands();
    ctx.save();
    // PHYSICS COM: a tapered body's origin is its mass center, which
    // sits a·taper/4 toward the fat end of the geometric profile
    // (state.js). The profile is drawn around the GEOMETRIC center, so
    // shift the whole drawing (silhouette, bands, pattern, rim, ink —
    // everything inside this save) by +sh along the body's major axis.
    // Without this the egg would visibly float/sink ~3px against its
    // own collider as it rotates. taper = 0: sh = 0, exact no-op.
    if (taper) {
      const sh = taper * a / 4;
      ctx.translate(sh * Math.cos(angle), sh * Math.sin(angle));
    }
    ctx.beginPath();
    bodyPath(ctx, a, b, angle, taper);
    ctx.fillStyle = RIG.slotColor(baseColor, RIG.P.baseFillSlot, spPat);
    ctx.fill();
    ctx.clip();

    // Bands darkest -> brightest: each fills its solved iso region.
    // SOFTNESS: at 0 that's one contour at full alpha (the hard cel
    // edge). Above 0 the transition becomes a ramp — solve the outer
    // and inner edges of the transition, then INTERPOLATE the steps
    // between them geometrically (both solves share a spoke basis, so
    // points correspond) and stack them at partial alpha. Overlapping
    // fills accumulate, so the core reaches full colour while the
    // outer edge fades: a smooth Lambert ramp for two solves, not N.
    for (const band of B) {
      // Ramp sampled by the band's THRESHOLD (not its index), so
      // Every colour comes from a SLOT — one system, no overrides.
      // Each melon resolves the same slot against its own seeded base.
      ctx.fillStyle = RIG.slotColor(baseColor, band.fillSlot, spPat);
      // An INVERTED band owns the complement — everywhere DARKER than
      // its threshold — drawn as the body ellipse minus the contour
      // under the even-odd rule. That single flag is the whole
      // difference between a lit band and a core shadow.
      const inv = !!band.inv;
      const paint = (pts, isFull) => {
        ctx.beginPath();
        if (inv) {
          bodyPath(ctx, a, b, angle, taper);
          if (!isFull && pts) {
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
          }
          ctx.fill('evenodd');
        } else {
          if (isFull || !pts) bodyPath(ctx, a, b, angle, taper);
          else {
            for (let i = 0; i < pts.length; i++) {
              if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
            }
            ctx.closePath();
          }
          ctx.fill();
        }
      };
      const soft = Math.max(0, Math.min(100, band.soft || 0)) / 100;
      if (soft <= 0.001) {
        const iso = RIG.isoContour(angle, a, b, band.tau, null, taper);
        // No contour at all: nothing is above the threshold, so an
        // inverted band covers the whole face and a lit band draws none.
        if (!iso) { if (inv) paint(null, true); continue; }
        paint(iso.pts, !!iso.full);
        continue;
      }
      const w = soft * 0.3; // transition half-width in diffuse units
      const outer = RIG.isoContour(angle, a, b, band.tau - w, null, taper);
      const inner = RIG.isoContour(angle, a, b, Math.min(0.995, band.tau + w), null, taper);
      if (!outer) { if (inv) paint(null, true); continue; }
      const STEPS = 7;
      const stepAlpha = 1 - Math.pow(0.06, 1 / STEPS); // core ~94% opaque
      ctx.save();
      ctx.globalAlpha = stepAlpha;
      // Inverted bands ramp the other way: densest at the dark end.
      for (let k = 0; k < STEPS; k++) {
        const t0 = k / (STEPS - 1);
        const t = inv ? 1 - t0 : t0;
        if (outer.full || !inner || inner.full) paint(null, true);
        else {
          const pts = outer.pts.map((p, i) => {
            const q = inner.pts[i] || p;
            return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
          });
          paint(pts, false);
        }
      }
      ctx.restore();
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
    // ---- The rind pattern, per band ----
    // The raster is an alpha MASK; each region paints it in its own
    // pattern colour, clipped to that region. So the marble darkens
    // inside a shadow band and glows inside a highlight band — eight
    // to ten independently addressable colours, all still DERIVED from
    // this melon's own seeded base unless a hex override says otherwise.
    const raster = RIG.P.showPattern
      ? patternRaster(seedKey || baseColor, fruit, a, b, patternScale)
      : null;
    let stamp = null; // set below; the rim region uses it too
    if (raster) {
      // No global alpha: pattern visibility comes from the colour
      // distance between a region's fill slot and its pattern slot.
      stamp = (col) => {
        ctx.save();
        ctx.rotate(angle);
        ctx.drawImage(tintedPattern(raster, col), -raster.w / 2, -raster.h / 2, raster.w, raster.h);
        ctx.restore();
      };
      // Base region first (everything not covered by a band).
      // The base stamp must cover ONLY the base region — not the whole
      // body. Stamping it everywhere and then stamping a band's colour
      // on top leaves residue wherever the mask is partially
      // transparent: two blends of different colours never resolve to
      // the second colour, so pattern EDGES stayed visible even when
      // every slot resolved to the same hex. Clip to the complement of
      // every band's region so each pixel is stamped exactly once.
      ctx.save();
      for (const band of B) {
        const iso = RIG.isoContour(angle, a, b, band.tau, null, taper);
        if (!iso) continue;
        ctx.beginPath();
        if (band.inv) {
          // Inverted band owns OUTSIDE its contour -> base keeps inside.
          if (iso.full) { bodyPath(ctx, a, b, angle, taper); ctx.clip(); continue; }
          for (let i = 0; i < iso.pts.length; i++) {
            const p = iso.pts[i];
            if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          }
          ctx.closePath();
          ctx.clip();
        } else {
          // Normal band owns INSIDE -> base keeps the outside.
          bodyPath(ctx, a, b, angle, taper);
          if (!iso.full) {
            ctx.moveTo(iso.pts[0][0], iso.pts[0][1]);
            for (let i = 1; i < iso.pts.length; i++) ctx.lineTo(iso.pts[i][0], iso.pts[i][1]);
            ctx.closePath();
          }
          ctx.clip('evenodd');
        }
      }
      stamp(RIG.slotColor(baseColor, RIG.P.basePatSlot, spPat));
      ctx.restore();
      // Then each band's region, clipped, in that band's pattern colour.
      for (const band of B) {
        const iso = RIG.isoContour(angle, a, b, band.tau, null, taper);
        const col = RIG.slotColor(baseColor, band.patSlot, spPat);
        ctx.save();
        ctx.beginPath();
        if (band.inv) {
          bodyPath(ctx, a, b, angle, taper);
          if (iso && !iso.full) {
            ctx.moveTo(iso.pts[0][0], iso.pts[0][1]);
            for (let i = 1; i < iso.pts.length; i++) ctx.lineTo(iso.pts[i][0], iso.pts[i][1]);
            ctx.closePath();
          }
          ctx.clip('evenodd');
        } else {
          if (!iso) { ctx.restore(); continue; }
          if (iso.full) bodyPath(ctx, a, b, angle, taper);
          else {
            for (let i = 0; i < iso.pts.length; i++) {
              const p = iso.pts[i];
              if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
            }
            ctx.closePath();
          }
          ctx.clip();
        }
        stamp(col);
        ctx.restore();
      }
    }

    // ---- Rim light: bright crescent hugging the anti-sun silhouette ----
    if (RIG.P.rim) {
      const { tPeak, halfSpan } = RIG.rimArc(angle, a, b, taper);
      const w = RIG.P.rimWidth;
      const caA = Math.cos(angle), saA = Math.sin(angle);
      // MASKING: clip the rim against a band's region so the form's own
      // shadow eats it, instead of a ring sitting on top of everything.
      const mask = RIG.rimMaskRegion();
      let masked = false;
      if (mask) {
        const miso = RIG.isoContour(angle, a, b, mask.tau, null, taper);
        if (miso && !miso.full) {
          ctx.save();
          masked = true;
          ctx.beginPath();
          if (mask.inside) {
            // Show only inside the contour: a plain clip.
            for (let i = 0; i < miso.pts.length; i++) {
              const p = miso.pts[i];
              if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
            }
            ctx.closePath();
          } else {
            // Show only OUTSIDE it: body ellipse minus the contour,
            // via the even-odd rule on a two-subpath clip.
            bodyPath(ctx, a, b, angle, taper);
            ctx.moveTo(miso.pts[0][0], miso.pts[0][1]);
            for (let i = 1; i < miso.pts.length; i++) ctx.lineTo(miso.pts[i][0], miso.pts[i][1]);
            ctx.closePath();
          }
          ctx.clip(mask.inside ? 'nonzero' : 'evenodd');
        }
      }
      ctx.beginPath();
      const N = 26;
      for (let i = 0; i <= N; i++) {
        const t = tPeak - halfSpan + (i / N) * 2 * halfSpan;
        const ct = Math.cos(t);
        const x = a * ct, y = b * Math.sin(t) * (1 - taper * ct);
        const wx = x * caA - y * saA, wy = x * saA + y * caA;
        if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      for (let i = N; i >= 0; i--) {
        const t = tPeak - halfSpan + (i / N) * 2 * halfSpan;
        const ct = Math.cos(t);
        const x = (a - w) * ct, y = (b - w) * Math.sin(t) * (1 - taper * ct);
        ctx.lineTo(x * caA - y * saA, x * saA + y * caA);
      }
      ctx.closePath();
      // The rim is a REGION: its own fill slot, and its own pattern
      // stamped inside it — same treatment as base/shadow/highlight.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = RIG.slotColor(baseColor, RIG.P.rimFillSlot, spPat);
      ctx.fillRect(-a * 2, -a * 2, a * 4, a * 4);
      if (stamp) stamp(RIG.slotColor(baseColor, RIG.P.rimPatSlot, spPat));
      ctx.restore();
      if (masked) ctx.restore();
    }

    // ---- Ink: the cel outline. These controls existed in the rig and
    // the Studio but had NO consumer — dead sliders, the same
    // tool/render disagreement as the old ramp override. Drawn INSIDE
    // the body clip at double width, so the visible stroke is exactly
    // inkWidth and can never bleed outside the silhouette; it sits
    // atop bands, pattern and rim, as ink does. Colour derives like
    // every other colour: darken(resolved base fill), never a literal.
    if (RIG.P.inkMode !== 'none') {
      ctx.strokeStyle = RIG.shadeHex(RIG.slotColor(baseColor, RIG.P.baseFillSlot, spPat), RIG.P.inkDarkK);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const wFull = RIG.P.inkWidth * 2; // clipped: half the stroke falls outside
      ctx.beginPath();
      bodyPath(ctx, a, b, angle, taper);
      ctx.lineWidth = RIG.P.inkMode === 'weighted' ? wFull * 0.55 : wFull;
      ctx.stroke();
      if (RIG.P.inkMode === 'weighted') {
        // Classic thick-thin cel inking: overstrike the anti-sun arc
        // heavy — ink weight lives where the light dies. Same math as
        // rimArc's peak, minus the rim's user rotation (ink follows
        // the SUN, not the rim dressing), traced on the tapered path.
        const s2 = RIG.sun();
        const caI = Math.cos(angle), saI = Math.sin(angle);
        const dxb = -(s2.x * caI + s2.y * saI), dyb = -(-s2.x * saI + s2.y * caI);
        const tPeak = Math.atan2(dyb * b, dxb * a);
        const half = Math.PI * 0.55;
        ctx.beginPath();
        const NI = 40;
        for (let i = 0; i <= NI; i++) {
          const t = tPeak - half + (2 * half) * (i / NI);
          const x = a * Math.cos(t);
          const y = b * Math.sin(t) * (1 - taper * Math.cos(t));
          const wx = x * caI - y * saI, wy = x * saI + y * caI;
          if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
        }
        ctx.lineWidth = wFull * 1.6;
        ctx.stroke();
      }
    }

    // ---- DECALS, last, inside the body clip ----------------------
    // Drawn AFTER the shading bands and clipped to the silhouette, so
    // a sticker cannot spill past the rind. They are NOT part of the
    // pattern mask: that mask is tinted per band, so a red heart
    // composited into it would come out green.
    if (decals && decals.length && window.FF.decals) {
      // Same raster scale as the rind (RSCALE in race, up to 8 for the
      // portrait). Built at 1:1 body pixels it was two to eight times
      // coarser than the pattern beside it, which is exactly what
      // blocky stickers on a smooth melon look like.
      // A live gesture rebakes every pointer move, so the PREVIEW tier
      // trades resolution for latency: raster scale capped at 2, coarse
      // meshes, and NO cache writes — thirty moves a second would
      // otherwise churn the whole LRU with single-use rasters. The
      // crisp bake lands on gesture end, when the editor draws without
      // the flag.
      const rsD = decalPreview
        ? Math.max(1, Math.min(2, patternScale || RSCALE))
        : Math.max(1, Math.min(RSCALE_MAX, patternScale || RSCALE));
      const dr = decalRaster(decals, a, b, rsD, decalPreview);
      if (dr) {
        // A decal is LIT BY THE SAME BANDS as everything else. Drawn
        // once and left alone it sat ON TOP of the shading — a sticker
        // that stayed bright while the melon around it rolled into
        // shadow. So it is stamped exactly like the rind pattern:
        // once per region, in that region's light.
        //
        // The rind gets this free because it is an alpha MASK and each
        // band paints it a different colour. A decal carries its own
        // colours, so instead each region draws a copy MULTIPLIED by
        // how dark that band's fill is against the base fill — the
        // band's own lighting, applied to whatever colour the sticker
        // happens to be.
        const stampDecal = (slot) => {
          const lit = shadedDecal(dr, slot);
          if (!lit) return;
          ctx.save();
          ctx.rotate(angle);
          ctx.drawImage(lit, -dr.w / 2, -dr.h / 2, dr.w, dr.h);
          ctx.restore();
        };
        // Base region: everything no band owns.
        ctx.save();
        for (const band of B) {
          const iso = RIG.isoContour(angle, a, b, band.tau, null, taper);
          if (!iso) continue;
          ctx.beginPath();
          if (band.inv) {
            if (iso.full) { bodyPath(ctx, a, b, angle, taper); ctx.clip(); continue; }
            for (let i = 0; i < iso.pts.length; i++) {
              const p = iso.pts[i];
              if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
            }
            ctx.closePath(); ctx.clip();
          } else {
            bodyPath(ctx, a, b, angle, taper);
            if (!iso.full) {
              ctx.moveTo(iso.pts[0][0], iso.pts[0][1]);
              for (let i = 1; i < iso.pts.length; i++) ctx.lineTo(iso.pts[i][0], iso.pts[i][1]);
              ctx.closePath();
            }
            ctx.clip('evenodd');
          }
        }
        stampDecal(DECAL_SLOTS.base);
        ctx.restore();
        // Then each band's region, in that band's light.
        for (const band of B) {
          const iso = RIG.isoContour(angle, a, b, band.tau, null, taper);
          // The band's OWN slot, applied to the decal's inks.
          const slot = band.fillSlot || DECAL_SLOTS.base;
          ctx.save();
          ctx.beginPath();
          if (band.inv) {
            bodyPath(ctx, a, b, angle, taper);
            if (iso && !iso.full) {
              ctx.moveTo(iso.pts[0][0], iso.pts[0][1]);
              for (let i = 1; i < iso.pts.length; i++) ctx.lineTo(iso.pts[i][0], iso.pts[i][1]);
              ctx.closePath();
            }
            ctx.clip('evenodd');
          } else {
            if (!iso) { ctx.restore(); continue; }
            if (iso.full) bodyPath(ctx, a, b, angle, taper);
            else {
              for (let i = 0; i < iso.pts.length; i++) {
                const p = iso.pts[i];
                if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
              }
              ctx.closePath();
            }
            ctx.clip();
          }
          stampDecal(slot);
          ctx.restore();
        }
      }
    }

    ctx.restore(); // body clip ends here
  }

  // ---- DECAL COLOUR: THE MELON'S OWN LAW (option A) ------------------
  // A decal's colours go through the SAME three-axis offset the rind
  // does — L*, HUE and SATURATION — rather than a brightness multiply.
  //
  // The melon's shading is not a dimmer. Its ramp carries hue rotation
  // and desaturation (shadow: dL -30, dHUE -30, dSAT -10; highlight:
  // dL +30, dHUE -20, dSAT -40), and that behaviour IS the aesthetic:
  // cooler in shadow, chalkier in light. A decal lit only by a scalar
  // stayed at its authored hue and saturation and read as pasted on
  // from another game.
  //
  // THE COST, ACCEPTED: authored colour does not survive. The base band
  // itself carries dHUE -25 / dSAT -25, so a French flag renders teal
  // and pink rather than blue and red. Cohesion is bought with
  // fidelity. (If that trade turns out wrong, option C applies only the
  // DELTA from base to each band, keeping authored colour where the
  // light is neutral while the shading still behaves under this law.)
  const DECAL_SLOTS = { shadow: 'A1', base: 'A2', highlight: 'A3' };

  // A decal raster recoloured band by band, cached per (raster, slot).
  // Per-pixel work, so it must not happen per frame — same reason
  // tintedPattern is cached.
  const SHADED_CAP = 240;
  const shadedCache = new Map();
  function shadedDecal(raster, slot) {
    if (!raster) return null;
    // PREVIEW RASTERS HAVE NO ID (they are deliberately uncached), so
    // they must not touch the shared cache either: keyed by id, every
    // preview of every frame would share 'null|slot' — the first one
    // cached would be returned for ALL of them, and a drag would flick
    // to whatever outfit happened to be cached first (Eddie caught it
    // showing a long-removed flag). Instead a null-id raster memoises
    // its lit copies ON ITSELF, so the memo lives exactly as long as
    // the frame that built it.
    if (!raster.id) {
      if (!raster._lit) raster._lit = new Map();
      const c0 = raster._lit.get(slot);
      if (c0) return c0;
      const cv0 = shadedDecalBuild(raster, slot);
      raster._lit.set(slot, cv0);
      return cv0;
    }
    const ck = raster.id + '|' + slot;
    let c = shadedCache.get(ck);
    if (c) { shadedCache.delete(ck); shadedCache.set(ck, c); return c; }
    const cv = shadedDecalBuild(raster, slot);
    if (cv === raster.canvas) return cv;           // headless passthrough
    shadedCache.set(ck, cv);
    while (shadedCache.size > SHADED_CAP) {
      const oldest = shadedCache.keys().next().value;
      if (oldest === undefined || oldest === ck) break;
      shadedCache.delete(oldest);
    }
    return cv;
  }

  function shadedDecalBuild(raster, slot) {
    if (typeof document === 'undefined') return raster.canvas;
    const RIG = window.FF.shading;
    const src = raster.ctx.getImageData(0, 0, raster.canvas.width, raster.canvas.height);
    const d = src.data;
    const cache = new Map();                       // few distinct inks per decal
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let out = cache.get(key);
      if (out === undefined) {
        const hex = '#' + key.toString(16).padStart(6, '0');
        const lit = RIG.inkColor ? RIG.inkColor(hex, slot) : RIG.slotColor(hex, slot, null);
        const n = parseInt(lit.slice(1), 16);
        out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        cache.set(key, out);
      }
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    }
    const cv = document.createElement('canvas');
    cv.width = raster.canvas.width; cv.height = raster.canvas.height;
    cv.getContext('2d').putImageData(src, 0, 0);
    return cv;
  }

  // Pigment for an ink: memoised, since a decal has a handful of
  // colours and a raster has thousands of pixels.
  const preInkCache = new Map();
  function preInk(c) {
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    let out = preInkCache.get(key);
    if (out) return out;
    const RIG = window.FF.shading;
    const hex = '#' + key.toString(16).padStart(6, '0');
    const pig = (RIG && RIG.preInkColor) ? RIG.preInkColor(hex, DECAL_SLOTS.base) : hex;
    const n = parseInt(pig.slice(1), 16);
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (preInkCache.size > 400) preInkCache.clear();
    preInkCache.set(key, out);
    return out;
  }

  // ---- THE DECAL RASTER ----------------------------------------------
  // A FULL-COLOUR raster, unlike the rind's alpha mask, built once per
  // (outfit, size) and cached. Each worn decal shoots its true-geodesic
  // mesh once at bake time, and every pixel is read back through it
  // (see decals.js: buildStickerMesh). That is what gives a sticker the
  // rind's own foreshortening and makes its straight edges bow around
  // the body — and, since bug 7, what keeps a flag's poleward edge from
  // drawing taller than its equatorward one.
  //
  // Per-pixel work happens HERE, at bake time, never per frame — the
  // raster is reused until the outfit or the body size changes.
  const DECAL_CAP = 48;
  const decalCache = new Map();
  function decalRaster(worn, a, b, rs, preview) {
    const D = window.FF.decals;
    let ck = null;
    if (!preview) {
      const sig = worn.map(w => w.id + ',' + w.u.toFixed(2) + ',' + w.v.toFixed(2)
        + ',' + w.rot.toFixed(2) + ',' + w.s.toFixed(2)).join(';');
      ck = sig + '|' + (a | 0) + '|' + (b | 0) + '|' + rs.toFixed(2);
      const r0 = decalCache.get(ck);
      if (r0 !== undefined) {
        decalCache.delete(ck); decalCache.set(ck, r0);   // LRU touch
        return r0;
      }
    }
    if (typeof document === 'undefined') { if (ck) decalCache.set(ck, null); return null; }
    const w = Math.ceil(a * 2) + 2, h = Math.ceil(b * 2) + 2;
    const pw = Math.round(w * rs), ph = Math.round(h * rs);
    const cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    // willReadFrequently: this raster is read back once per band to be
    // recoloured, so the browser should keep it on the CPU side.
    const octx = cv.getContext('2d', { willReadFrequently: true });
    const img = octx.createImageData(pw, ph);
    const px = img.data;
    // One true-geodesic mesh per worn decal, shot here at bake time.
    const meshes = worn.map(wd =>
      D.byId(wd.id) ? D.buildStickerMesh(wd.u, wd.v, wd.rot, wd.s * b, a, b,
        preview || pxMode || bakeLodR !== null) : null);
      // PIXEL 320 decal LOD (Eddie, 2026-08-18): the sticker mesh's
      // COARSE mode is the pixel tier. The fine mesh spends its
      // budget on sub-pixel curvature fidelity that the vote
      // discards anyway, so coarse costs nothing visible at 320 and
      // bakes faster. (Same switch the editor preview already used;
      // it is now the truth for every baked frame too.)
    for (let py = 0; py < ph; py++) {
      for (let pxi = 0; pxi < pw; pxi++) {
        const x = (pxi + 0.5) / rs - w / 2, y = (py + 0.5) / rs - h / 2;
        const ex = x / a, ey = y / b;
        if (ex * ex + ey * ey > 1) continue;
        for (let i = 0; i < worn.length; i++) {
          const wd = worn[i];
          const item = D.byId(wd.id);
          if (!item || !meshes[i]) continue;
          const half = wd.s * b;
          const q = D.meshSample(meshes[i], x, y);
          if (!q) continue;
          const nx = q.x / half, ny = q.y / half;
          if (Math.abs(nx) > 1 || Math.abs(ny) > 1) continue;
          const c = D.sampleArt(item, nx, ny);
          if (!c) continue;
          const o = (py * pw + pxi) * 4;
          // PRE-COMPENSATED (option A + inverse). The art declares the
          // colour it wants to BE SEEN as; what is stored here is the
          // pigment that produces it once the base band's offsets are
          // applied. So a decal goes through the melon's full colour
          // law — cooler in shadow, chalkier in light — while still
          // reading as its authored colour in neutral light.
          //
          // Not exact where the pigment would need saturation past the
          // gamut: the base band desaturates by 25, so a vivid ink
          // cannot be pushed far enough back. Measured round trip:
          // heart red and black exact, whites within 8, the flag's
          // blue and red about 25 out — still blue and red, not the
          // teal and pink the uncompensated law produced.
          const pre = preInk(c);
          px[o] = pre[0]; px[o + 1] = pre[1]; px[o + 2] = pre[2]; px[o + 3] = 255;
          break;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    const r = { canvas: cv, ctx: octx, w, h, id: ck };   // w/h stay in BODY units
    if (!ck) return r;                 // preview rasters are never cached
    decalCache.set(ck, r);
    while (decalCache.size > DECAL_CAP) {
      const oldest = decalCache.keys().next().value;
      if (oldest === undefined || oldest === ck) break;
      decalCache.delete(oldest);
    }
    return r;
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

  // Tint a pattern MASK with a colour, cached per (mask, colour). The
  // mask's alpha becomes the coverage; 'source-in' paints the colour
  // through it. This is what gives every band its own pattern colour.
  //
  // LRU for the same reason as the raster cache below: this used to
  // CLEAR ENTIRELY at capacity, which throws away the tints of the
  // twelve bodies currently on screen along with the stale ones —
  // every band of every racer rebuilt on the next frame, in one
  // spike. Each raster spawns several tints (one per band it paints),
  // so the capacity is proportionally larger. Touch-on-hit + evict
  // oldest keeps the live set resident.
  const TINT_CAP = 400;
  const tintCache = new Map();
  function tintedPattern(raster, color) {
    const ck = raster.id + '|' + color;
    let t = tintCache.get(ck);
    if (t) {
      tintCache.delete(ck);
      tintCache.set(ck, t);
      return t;
    }
    const cv = document.createElement('canvas');
    cv.width = raster.canvas.width; cv.height = raster.canvas.height;
    const c = cv.getContext('2d');
    c.drawImage(raster.canvas, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, cv.width, cv.height);
    t = cv;
    tintCache.set(ck, t);
    while (tintCache.size > TINT_CAP) {
      const oldest = tintCache.keys().next().value;
      if (oldest === undefined || oldest === ck) break;
      tintCache.delete(oldest);
    }
    return t;
  }

  // Build (and cache) a racer's pattern layer as an offscreen raster.
  //
  // RESOLUTION FOLLOWS THE DESTINATION (2026-08-12). The raster used
  // to be a fixed 2x supersample of the body's WORLD size — ample for
  // a racing melon covering ~90 screen px, and badly under-resolved
  // for the menu portrait, which can be 260 CSS px at devicePixelRatio
  // 3: ~780 device pixels filled from a 200px source, a 4x upscale
  // that reads as pixelation.
  //
  // The pattern is a VECTOR drawing, so building it larger costs only
  // memory and one-time work. Callers that know their true output size
  // pass a scale; the scale is part of the cache key, so racing bodies
  // keep their small rasters and the one big portrait entry lives
  // alongside instead of inflating every melon on screen.
  const RSCALE = 2;      // default supersample for in-race bodies
  const RSCALE_MAX = 8;  // ceiling: the island field is per-pixel work
  // ---- LRU, NOT COST-MAX (2026-08-13) ------------------------------
  // Capacity holds a full grid's live rasters plus a finish screen's
  // spinners without pressure. Eviction is least-recently-USED, which
  // a Map gives for free: iteration follows insertion order, so
  // re-inserting on every hit keeps the live set at the young end and
  // the oldest key is always the first one out.
  //
  // WHY THE OLD POLICY FAILED (browser-profiled, four-leg cup): it
  // evicted the most EXPENSIVE entry, to protect the one 8x menu
  // portrait from being churned out by cheap racing bodies. But a cup
  // mints ~25 NEW keys per leg — the cast keeps its names while each
  // leg deals fresh sizes from its own seed, and size is in the key —
  // so by leg 3 the map was full of stale entries from earlier legs
  // and screens. Among same-scale entries "most expensive" is just
  // "biggest body", so inserting one live racer evicted ANOTHER live
  // racer: a rotating famine across the twelve bodies actually on
  // screen, each rebuilding its per-pixel island field over and over.
  // Measured: leg 1 zero misses and a locked 16.7ms frame; legs 3-4
  // ~1500 misses each, buildMarbleStripes going 0.6% -> 54% of CPU,
  // frame time 42ms. Refreshing emptied the cache, which is exactly
  // why a reload "fixed" it. Under LRU the on-screen field is touched
  // every frame and so is never the eviction candidate, stale legs
  // age out in order, and the portrait survives precisely as long as
  // a screen is still drawing it — the protection the cost heuristic
  // was reaching for, without the pathology.
  const RASTER_CAP = 64;
  const rasterCache = new Map();
  function patternRaster(key, fruit, a, b, scale) {
    const species = fruit || 'watermelon';
    const rs = Math.max(1, Math.min(RSCALE_MAX, scale || RSCALE));
    const ck = key + '|' + species + '|' + (a | 0) + '|' + rs.toFixed(2)
      + (lodSimple() ? '|L1' : '');   // Phase 2.1: LOD keys its own raster
    let rst = rasterCache.get(ck);
    if (rst !== undefined) {
      // TOUCH: delete + re-insert moves this key to the young end of
      // the Map's iteration order. That is the whole LRU bookkeeping.
      rasterCache.delete(ck);
      rasterCache.set(ck, rst);
      return rst;
    }
    if (typeof document === 'undefined') { rasterCache.set(ck, null); return null; }
    const pad = 4; // stroke overhang room (body clip trims at draw time)
    const w = Math.ceil(a * 2) + pad * 2, h = Math.ceil(b * 2) + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * rs); cv.height = Math.round(h * rs);
    const octx = cv.getContext('2d');
    octx.scale(rs, rs);
    octx.translate(w / 2, h / 2);
    if (species === 'dragonBall') drawStar(octx, a, b);
    else if (species === 'yoshiEgg') drawSpots(octx, a, b, key);
    else if (species === 'eightBall') drawEightBall(octx, a, b);
    else if (species === 'tennisBall') drawSeam(octx, a, b, key);
    else if (species === 'cantaloupe') drawNet(octx, a, b, key);
    else if (species === 'honeydew') drawCrackle(octx, a, b, key);
    else buildMarbleStripes(octx, cv, a, b, key, w, h, rs);
    rst = { canvas: cv, w, h, id: ck, scale: rs };
    rasterCache.set(ck, rst);
    // Evict from the OLD end until we are back at capacity. A loop,
    // not a single delete: the cap can be lowered live by a future
    // memory-pressure hook without this needing to know.
    while (rasterCache.size > RASTER_CAP) {
      const oldest = rasterCache.keys().next().value;
      if (oldest === undefined || oldest === ck) break;
      rasterCache.delete(oldest);
    }
    return rst;
  }
  // Dev instrumentation: the browser rig reads these to assert that a
  // cup's later legs stop missing. Zero cost when nobody looks.
  window.FF.rasterStats = () => ({ size: rasterCache.size, cap: RASTER_CAP });

  // ---- Watermelon pattern: loose island field on the stripe scaffold ----
  // Option P, chosen by Eddie from the 2026-08-10 nine-option bracket
  // (between "iconic wavy" and the old marble): smooth bubbly ISLANDS
  // of pattern, grown rather than placed, arranged into APPROXIMATE
  // stripes. The botanical scaffold survives (meridian centers
  // converging at the poles; the per-pixel inverse projection
  // u=acos(x/a), k=y/(b sin u) IS the exact foreshortening). Paint is
  // a single-octave noise LEVEL SET whose threshold rises with
  // distance from the nearest (gently warped) meridian: islands
  // cluster loosely on the stripe lines, thin out beside them, and
  // vanish between — organic, no two alike, and far rounder than the
  // old three-layer marble (one octave = no high-frequency edge
  // noise). Coverage runs ~25-30%, deliberately leaner than the
  // marble's ~55%: fewer, bigger, calmer shapes.
  // rs: the raster's ACTUAL supersample. This field is generated in
  // PIXEL space and projected back to world coordinates, so it is the
  // one pattern generator that is not resolution-independent by
  // construction — it must be told the real scale. Hard-coding RSCALE
  // here meant that raising the portrait's resolution silently
  // re-projected the artwork: same seed, different melon.
  function buildMarbleStripes(octx, cv, a, b, key, w, h, rs) {
    let hsh = 2166136261;
    for (let i = 0; i < key.length; i++) { hsh ^= key.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    const rng = window.FF.mulberry32(hsh >>> 0);
    const nz = makeNoise2((hsh ^ 0x51CE) >>> 0);
    let nStripes = 5 + (rng() * 2 | 0);
    if (lodSimple()) nStripes = 3;   // Phase 2.1: 3 bold stripes at 16 px
    const centers = [];
    for (let i = 0; i < nStripes; i++) {
      centers.push((i + 0.5) / nStripes * Math.PI + (rng() - 0.5) * 0.22);
    }
    let halfW = (0.58 + rng() * 0.14) * (Math.PI / nStripes) / 2; // stripe half-width in longitude
    if (lodSimple()) halfW *= 1.35;  // Phase 2.1: bolder at small radius
    // Per-seed variety lives in the warp and field frequencies; the
    // level-set threshold stays FIXED (coverage is sensitive to it,
    // and every melon should sit in the same visual weight band).
    const warpA = 0.24 + rng() * 0.14;  // meridian wander amplitude
    const fW = 0.55 + rng() * 0.15;     // wander frequency
    const fI = 1.3 + rng() * 0.25;      // island field frequency
    const off1 = rng() * 40, off2 = rng() * 40;
    const TH = -0.18, SLOPE = 0.42;     // proof-tuned (round-2 bracket)

    const img = octx.createImageData(cv.width, cv.height);
    const data = img.data;
    for (let py = 0; py < cv.height; py++) {
      for (let px = 0; px < cv.width; px++) {
        const x = px / rs - w / 2, y = py / rs - h / 2;
        const ex = x / a, ey = y / b;
        if (ex * ex + ey * ey > 1) continue; // outside the body
        // Inverse spheroid projection (exact foreshortening):
        const u = Math.acos(Math.max(-1, Math.min(1, ex)));
        const su = Math.sin(u);
        const k = su < 0.04 ? 0 : Math.max(-1, Math.min(1, ey / su));
        const phi = Math.acos(k); // longitude in [0, PI]
        // Distance to the nearest gently wandering meridian.
        const wPhi = phi + warpA * nz.fbm(u * fW + off1, phi * fW * 0.92, 1);
        let d = 1e9;
        for (const c of centers) { const dd = Math.abs(wPhi - c); if (dd < d) d = dd; }
        // The island field: paint where smooth noise clears a bar that
        // rises with distance from the stripe line.
        const paint = nz.fbm(u * fI + off2, phi * fI * 0.9, 1) > TH + SLOPE * (d / halfW);
        if (paint) {
          const idx = (py * cv.width + px) * 4;
          // MASK, not colour: the raster records WHERE the pattern is;
          // each band tints it with its own pattern colour at draw time.
          data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255;
          data[idx + 3] = 255;
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
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fill(paths.faint);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.56)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (!lodSimple()) { ctx.lineWidth = 0.8; ctx.stroke(paths.veins.fine); }
    // Phase 2.1: fine veins are sub-pixel at 16 px — mush, not detail.
    ctx.lineWidth = 1.4; ctx.stroke(paths.veins.main);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill(paths.pores);
    ctx.restore();
  }

  // ---- Dragon ball: one four-pointed star, centred ----
  // Drawn into the same alpha MASK as every other pattern, so it picks
  // up its colour from the region's pattern slot like anything else —
  // the red comes from the species pattern anchor, not a hard-coded hex.
  // Concave sides via quadratic curves through an inner control radius.
  // ---- 8-ball: the number disc, one mask with a hole ----
  // Patterns are WHITE-ALPHA masks tinted per band, so the "8" is not
  // a third colour: it's an alpha HOLE (destination-out) punched
  // through the disc, letting the near-black BASE read through — the
  // glyph is the ball showing through its own sticker. One mask, zero
  // schema changes, and the disc rolls with the body like the real
  // thing. Centred like the dragon ball's star; a sphere has a = b so
  // no foreshortening mapping is needed at the face centre.
  function drawEightBall(ctx, a, b) {
    const r = Math.min(a, b);
    const discR = r * 0.44;
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    ctx.arc(0, 0, discR, 0, Math.PI * 2);
    ctx.fill();
    // Punch a REAL figure-8 glyph, not two stacked rings: the outer
    // body is the union of two overlapping solid circles (smaller top
    // lobe, bigger bottom — the union's crossing pinches the waist,
    // which IS the typographic silhouette), punched clean through so
    // the black base reads as the numeral; then the two counters (the
    // 8's holes) are re-filled white so the disc shows inside them.
    const rTop = discR * 0.34, rBot = discR * 0.42;
    const gap = (rTop + rBot) * 0.80; // lobe centres: overlap -> waist
    const cyT = -gap * (rBot / (rTop + rBot));
    const cyB = gap * (rTop / (rTop + rBot));
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(0, cyT, rTop, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, cyB, rBot, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Counters: white holes inside each lobe.
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    ctx.arc(0, cyT, rTop * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, cyB, rBot * 0.50, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Tennis ball: the seam ----
  // MEASURED from Eddie's reference (take 5 — the previous passes
  // bowed the arcs the wrong way, twice; this one comes from fitting
  // the reference's band centerlines, not from eyeballing): each band
  // is a circle of radius 0.72r whose centre sits 1.0r out along the
  // corner diagonal — ON the rim, corner side — and the drawn arc is
  // the FAR side of that circle, the side facing the ball centre (D nudged 1.0 -> 1.05 to match the reference's
  // central channel width). Each band wraps its corner, convex toward
  // the middle, apex 0.33r from centre; the two bands frame a narrow
  // central channel, and their curvature (0.72r) is visibly tighter
  // than the rim. Ends overshoot the rim crossings and the body clip
  // trims them on the silhouette. Fixed decal; the roll does the
  // rest.
  function drawSeam(ctx, a, b, key) {
    const r = Math.min(a, b);
    const D = 1.05, RS = 0.72, HALF = 1.35;
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.14;
    const TH0 = -Math.PI / 4; // top-right corner (y-down frame)
    for (const s of [1, -1]) {
      const ux = Math.cos(TH0) * s, uy = Math.sin(TH0) * s;
      const mid = Math.atan2(-uy, -ux); // far point: toward the ball centre
      ctx.beginPath();
      ctx.arc(D * ux * r, D * uy * r, RS * r, mid - HALF, mid + HALF);
      ctx.stroke();
    }
  }






  function drawStar(ctx, a, b) {
    const R = Math.min(a, b) * 0.34;   // outer radius
    const inner = R * 0.34;            // control radius: side concavity
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const t0 = -Math.PI / 2 + i * Math.PI / 2;
      const tm = t0 + Math.PI / 4;
      const t2 = t0 + Math.PI / 2;
      const ox = Math.cos(t0) * R, oy = Math.sin(t0) * R;
      if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
      ctx.quadraticCurveTo(Math.cos(tm) * inner, Math.sin(tm) * inner,
        Math.cos(t2) * R, Math.sin(t2) * R);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---- Yoshi egg: seeded rounded spots ----
  // Same alpha-mask contract as every other pattern, so the green
  // comes from the region's pattern slot. Placed in SURFACE space
  // (u, phi) so they foreshorten toward the rim like real markings,
  // with a few large blobs and a scatter of small ones; each spot is
  // a smooth closed curve, seeded per identity.
  function drawSpots(ctx, a, b, key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rng = window.FF.mulberry32(h >>> 0);
    const surf = (u, phi) => [a * Math.cos(u), b * Math.sin(u) * Math.cos(phi)];
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    const n = 7 + (rng() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const u = 0.35 + rng() * (Math.PI - 0.7);
      // phi = PI/2 is the CENTRE of the visible face (y = 0); phi -> 0
      // or PI is the silhouette. Centre the scatter on the face, or the
      // spots all pile onto the rim.
      const phi = 0.5 + rng() * (Math.PI - 1.0);
      // Power-law sizes: mostly mid, the occasional big one.
      const rr = (0.14 + Math.pow(rng(), 1.6) * 0.26) * Math.min(a, b);
      // Rounder spots: near-circular aspect, only a whisper of wobble.
      const sq = 0.94 + rng() * 0.12;
      const wob = 0.04 + rng() * 0.05;
      const ph = rng() * 6.28;
      const c = surf(u, phi);
      const pts = [];
      const STEPS = 14;
      for (let j = 0; j < STEPS; j++) {
        const t = (j / STEPS) * Math.PI * 2;
        const rad = rr * (1 + wob * Math.sin(3 * t + ph));
        // Offset in surface space so the spot squashes toward the rim.
        const du = (rad / a) * Math.cos(t);
        const dphi = (rad * sq / b) * Math.sin(t) / Math.max(0.35, Math.sin(u) * Math.sin(phi));
        pts.push(surf(Math.max(0.05, Math.min(Math.PI - 0.05, u + du)), phi + dphi));
      }
      ctx.beginPath();
      ctx.moveTo((pts[0][0] + pts[STEPS - 1][0]) / 2, (pts[0][1] + pts[STEPS - 1][1]) / 2);
      for (let j = 0; j < STEPS; j++) {
        const nx = pts[(j + 1) % STEPS];
        ctx.quadraticCurveTo(pts[j][0], pts[j][1], (pts[j][0] + nx[0]) / 2, (pts[j][1] + nx[1]) / 2);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawNet(ctx, a, b, key) {
    const paths = netPaths(key, a, b);
    ctx.save();
    if (!lodSimple()) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.fill(paths.mottle);   // Phase 2.1: mottle is noise at 16 px
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.31)';
    ctx.fill(paths.sutures);
    // Toward white, not cream: the ridges must survive the lit cap
    // (white contrasts with lit cream via saturation, not lightness).
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2; ctx.stroke(paths.ridges.fine);
    ctx.lineWidth = 1.9; ctx.stroke(paths.ridges.mid);
    ctx.lineWidth = 2.6; ctx.stroke(paths.ridges.bold);
    ctx.restore();
  }

    window.FF.shadeEllipse = shadeEllipse; // ghosts borrow the same sun
  // The studio's pinned melon: full stack, no state required.
  // The portrait draw. `scale` is the caller's true output resolution
  // in device pixels per world pixel — the menu knows its CSS size and
  // devicePixelRatio, and nothing else can work it out for it.
  window.FF.drawMelonStandalone = function (ctx2, angle, a, b, color, seedKey, fruit, scale, decals, decalPreview) {
    // PIXEL 320 (Eddie, 2026-08-18): menu and finish melons render
    // through the SAME bake pipeline as the race. The melon keeps its
    // displayed footprint; its pixel CHUNK matches the 320 world — it
    // gets the pixels it would occupy on a 320-wide screen (scale is
    // the caller's device px per world px, so the fraction of the
    // real device width converts directly), nearest-upscaled to the
    // display size. Same sprite cache, same 64 angles, same
    // guarantees — the portrait IS the racing melon. decalPreview
    // (the editor's live hover) stays vector: preview churn would
    // thrash bakes, and an editing surface earns native fidelity.
    // decalPreview NO LONGER escapes to vector (Eddie, 2026-08-18):
    // the editor is where a decal is CHOSEN, so it must show the
    // pixels the race will actually deliver — a native-fidelity
    // preview sells a sticker the game cannot render. Bakes are
    // cached per loadout, so hover churn costs one bake per distinct
    // arrangement, not one per frame.
    if (window.FF.PIXELATE && typeof document !== 'undefined') {
      const devW = ((typeof window !== 'undefined' && window.innerWidth) || 1600)
        * ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const rPx = Math.max(5, Math.round((a * (scale || 1)) * 320 / Math.max(1, devW)));
      const e = melonSpriteFrames(color, seedKey, a, b, rPx, fruit, decals);
      const TAU = Math.PI * 2;
      const k = ((Math.round(angle / (TAU / SPRITE_ANGLES)) % SPRITE_ANGLES)
        + SPRITE_ANGLES) % SPRITE_ANGLES;
      // Portraits are STILL: one frame, and it must not miss. The
      // budget is topped up here so a menu never shows the vector
      // fallback for a pose it will hold forever.
      if (bakeBudget <= 0) bakeBudget = 1;
      const f = melonFrame(e, k, 0, 0);
      if (e && f) {
        // THE FRAME IS WORLD UNITS, NOT DISPLAY PIXELS. Every caller
        // (editor portrait, studio pin, finish rows) has ALREADY
        // applied translate(centre) + scale(fit) before calling — the
        // vector painter draws in world coordinates inside that
        // transform. Sizing the blit in display px therefore
        // multiplied by `fit` a second time and drew a hugely
        // magnified corner (measured on device, 2026-08-18).
        // The sprite's rPx maps to the body's semi-major `a`, so one
        // sprite pixel is a/rPx WORLD px.
        const worldPerPx = a / rPx;
        const halfW = (e.spr / 2) * worldPerPx;
        ctx2.save();
        ctx2.imageSmoothingEnabled = false;
        ctx2.drawImage(f.canvas, -halfW, -halfW,
          e.spr * worldPerPx, e.spr * worldPerPx);
        ctx2.restore();
        return;
      }
    }
    shadeEllipse(ctx2, angle, a, b, color, seedKey, fruit, scale, decals, decalPreview);
  };

  // 100 world px = 1 m squares (Eddie, 2026-08-18; was 200 = 2 m).
  // The old comment's claim that the density change marks the surface
  // no longer holds — the surface is marked by the ground fill itself,
  // and matching densities read as one continuous system.
  const TERRAIN_GRID_SPACING = 100;

  function drawTerrainGrid(ctx, cam, w, h, groundY, zoom, colTop) {
    // Same 1/50/100/200 banding as the background, so emphasis
    // lines read continuously where they cross the ground line.
    const span = (w / 2) / zoom;
    const firstX = Math.floor((cam.x - span) / TERRAIN_GRID_SPACING) * TERRAIN_GRID_SPACING;
    const lastX = cam.x + span + TERRAIN_GRID_SPACING;
    const spacing = TERRAIN_GRID_SPACING * zoom;
    const firstY = ((groundY % spacing) + spacing) % spacing;

    // Pixel mode: filled 1 px rects, tone-only hierarchy — the same
    // law as the background grid, so emphasis still reads
    // continuously where the two grids meet at the ground line.
    if (pxMode) {
      // Every line is clipped by the SHARED column table: a vertical
      // starts at its own column's surface row, a horizontal is drawn
      // only across columns whose surface is above it. Without a
      // table (defensive) nothing is drawn rather than drawing
      // everywhere — an absent grid is a far smaller lie than one
      // floating in the sky.
      if (!colTop) return;
      const topAt = (x) => (x + 1 >= 0 && x + 1 < colTop.length
        ? colTop[x + 1] : h + 2);
      const vline = (x) => {
        const y0 = topAt(x);
        if (y0 <= h) ctx.fillRect(x, y0, 1, h - y0);
      };
      ctx.fillStyle = PX_GRID.tBase;
      for (let wx = firstX; wx < lastX; wx += TERRAIN_GRID_SPACING) {
        if (tierOf(wx / 100) >= 0) continue;
        vline(Math.round((wx - cam.x) * zoom + w / 2));
      }
      for (let sy = firstY; sy < h + spacing; sy += spacing) {
        const y = Math.round(sy);
        // Run-length across the row: contiguous covered columns are
        // one fillRect, so a horizontal line costs about as much as
        // it did when it was a single span.
        let runStart = -1;
        for (let x = 0; x <= w; x++) {
          const covered = x < w && topAt(x) <= y;
          if (covered && runStart < 0) runStart = x;
          else if (!covered && runStart >= 0) {
            ctx.fillRect(runStart, y, x - runStart, 1);
            runStart = -1;
          }
        }
      }
      for (let t = TIER_M.length - 1; t >= 0; t--) {
        ctx.fillStyle = PX_GRID.tTier[t];
        for (let wx = firstX; wx < lastX; wx += TERRAIN_GRID_SPACING) {
          if (tierOf(wx / 100) !== t) continue;
          vline(Math.round((wx - cam.x) * zoom + w / 2));
        }
      }
      return;
    }

    ctx.strokeStyle = COLORS.terrainGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wx = firstX; wx < lastX; wx += TERRAIN_GRID_SPACING) {
      if (tierOf(wx / 100) >= 0) continue;
      const sx = Math.round((wx - cam.x) * zoom + w / 2) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let sy = firstY; sy < h + spacing; sy += spacing) {
      const y = Math.round(sy) + 0.5;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    for (let t = TIER_M.length - 1; t >= 0; t--) {
      ctx.strokeStyle = `rgba(255,255,255,${TIER_ALPHA[t] * 0.6})`;
      ctx.lineWidth = TIER_WIDTH[t];
      ctx.beginPath();
      for (let wx = firstX; wx < lastX; wx += TERRAIN_GRID_SPACING) {
        if (tierOf(wx / 100) !== t) continue;
        const sx = Math.round((wx - cam.x) * zoom + w / 2) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      ctx.stroke();
    }
  }

  function drawGrid(ctx, camX, w, h, groundY, zoom) {
    // Base pass: every 1m line at the quietest weight, then one pass
    // per tier over the top so emphasis lines are drawn, not tinted.
    const span = (w / 2) / zoom;
    const firstX = Math.floor((camX - span) / GRID_SPACING) * GRID_SPACING;
    const lastX = camX + span + GRID_SPACING;
    const spacing = GRID_SPACING * zoom;
    const firstY = ((groundY % spacing) + spacing) % spacing;

    // PIXEL 320: grid lines are FILLED RECTS, not strokes (Eddie,
    // 2026-08-18). A 1 px stroke STRADDLES its path — at integer x it
    // covers x-0.5 to x+0.5, i.e. half of two adjacent columns, which
    // anti-aliases into a 2 px smear that the honesty resolver then
    // hardens into a solid 2 px line (measured on device). Dropping
    // the +0.5 hairline convention in pixel mode was my error: the
    // convention exists to centre a stroke IN a column. fillRect with
    // integer coords needs no convention at all — it covers exactly
    // the columns asked for, which is the "draw FOR the grid"
    // principle applied to the game's largest stroke surface.
    // Hierarchy is TONE-ONLY in pixel mode: every line is 1 px and
    // majors read brighter, which is how period backgrounds did it.
    // BACKGROUND GRID RETIRED IN PIXEL MODE (Eddie, 2026-08-18): the
    // sky is empty. The ground carries the scale reference now — its
    // checker states both scale AND motion — and an empty sky is
    // what Phase 4's parallax bands are for. Vector mode keeps its
    // grid, so the toggle still shows the old world.
    if (pxMode) return;

    ctx.strokeStyle = `rgba(255,255,255,${BASE_ALPHA})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wx = firstX; wx < lastX; wx += GRID_SPACING) {
      if (tierOf(wx / 100) >= 0) continue; // drawn by a tier pass
      const sx = Math.round((wx - camX) * zoom + w / 2) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    // Horizontal (elevation) lines: uniform hairlines. The tier
    // hierarchy is DISTANCE-ONLY by design — depth milestones tested
    // as noise, so the vertical axis stays a plain ruler.
    for (let sy = firstY; sy < h + spacing; sy += spacing) {
      const y = Math.round(sy) + 0.5;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    for (let t = TIER_M.length - 1; t >= 0; t--) {
      ctx.strokeStyle = `rgba(255,255,255,${TIER_ALPHA[t]})`;
      ctx.lineWidth = TIER_WIDTH[t];
      ctx.beginPath();
      for (let wx = firstX; wx < lastX; wx += GRID_SPACING) {
        if (tierOf(wx / 100) !== t) continue;
        const sx = Math.round((wx - camX) * zoom + w / 2) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      ctx.stroke();
    }
  }

  function drawMarkers(ctx, state, camX, w, toScreenX, toScreenY, zoom) {
    const SPACING = 200;
    const span = (w / 2) / zoom;
    ctx.fillStyle = pxMode ? PX_GRID.marker : COLORS.marker;
    ctx.textAlign = 'center';
    // In TRACK mode the numbers are LAP POSITION, not odometer: they
    // wrap every lap length, so the start line reads 0 on every lap
    // and the apron behind it counts down the closing metres (398,
    // 396...) — the line is always 0 (Eddie, 2026-08-10). Endless has
    // no laps, so it keeps the absolute ruler.
    // METRIC MARKERS (stage 3): the ruler measures ARC now — the
    // distance racers actually cover — so marker stops live at s
    // multiples ON THE STRAND, found by walking the loaded points
    // (every 200-arc boundary inside a segment gets its interpolated
    // world point). Under a switchback all three decks carry their
    // own stops, each labelled with its own arc — the ruler follows
    // the track through the fold instead of pretending x is truth.
    const lapPx = (state.race.mode === 'track') ? state.race.lapLengthPx : 0;
    const labelM = (sv) => {
      if (!lapPx) return sv / 100 | 0;
      const rel = (sv % lapPx + lapPx) % lapPx;
      return rel / 100 | 0;
    };
    const xLo = camX - span - SPACING, xHi = camX + span + SPACING;
    for (const poly of state.terrain) {
      if (poly.isWall || !poly.length || poly[0].s === undefined) continue;
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], b = poly[i];
        if (Math.max(a.x, b.x) < xLo || Math.min(a.x, b.x) > xHi) continue;
        const kLo = Math.floor(a.s / SPACING) + 1, kHi = Math.floor(b.s / SPACING);
        for (let k = kLo; k <= kHi; k++) {
          const sv = k * SPACING;
          const t2 = (sv - a.s) / (b.s - a.s);
          const wx = a.x + (b.x - a.x) * t2, wy = a.y + (b.y - a.y) * t2;
          const m = labelM(sv);
          const t = tierOf(m);
          const mtxt = t >= 0 && m !== 0 ? `${m}M` : `${m}`;
          if (pxMode && window.FF.pxfont) {
            const PF = window.FF.pxfont;
            PF.draw(ctx, mtxt, Math.round(toScreenX(wx)) - PF.measure(mtxt, 1) / 2,
              Math.round(toScreenY(wy)) + 8, 1, PX_GRID.marker);
          } else {
            ctx.font = `${t >= 0 ? TIER_FONT[t] : BASE_FONT}px ui-monospace, monospace`;
            ctx.fillText(t >= 0 && m !== 0 ? `${m}m` : `${m}`, toScreenX(wx), toScreenY(wy) + 16);
          }
        }
      }
    }
    // (The 25m catcher block retired with the 25m tier: every
    // surviving milestone lands on the 2m label stops above.)
  }

  return { render, resize };
}

Object.assign(window.FF, { createRenderer });
})();