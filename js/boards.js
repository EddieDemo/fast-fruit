// ============================================================
// BOARDS — trackside billboard engine.
//
// Doctrine, in order:
//  * FLOW IS SACRED. Boards live in the world, never on the racing
//    line, never clickable mid-race. Links appear only on the
//    post-race sponsor line, when the player is at rest.
//  * Placement is a pure function of terrain geometry: near-flat
//    spans get a board, spaced apart, so positions are deterministic,
//    stable across frames, identical for every lockstep peer — and
//    they land exactly where the pacing grammar puts breathers,
//    which is where eyes have spare attention.
//  * Content is PRESENTATION ONLY. The sim never knows what's on a
//    sign; two multiplayer peers could even see different ads
//    without desyncing (we don't do that, but the wall is there).
//  * In track mode a board at lap-position p is the SAME board every
//    lap: content keys off position-within-lap, so period images of
//    one board always show one ad.
// ============================================================

(function () {
'use strict';

const BOARD_W = 230;         // world px
const BOARD_H = 92;
const POST_H = 130;          // panel bottom sits this far above the surface
const MIN_FLAT_LEN = 260;    // only spans at least this long qualify
const MAX_GRADE = 0.03;      // "flat" tolerance
const MIN_SPACING = 2600;    // between boards — scarcity IS the product

// ---- Active bookings (date-filtered, house ads always on) ----
let activeCache = null;
let activeCacheDay = '';

function activeAds() {
  const today = new Date();
  const day = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0')
    + '-' + String(today.getDate()).padStart(2, '0');
  if (activeCache && activeCacheDay === day) return activeCache;
  const all = window.FF.BILLBOARDS || [];
  const paid = all.filter(a => a.from && a.to && day >= a.from && day <= a.to);
  const house = all.filter(a => !a.from && !a.to);
  // Paid bookings first so they take the earliest (most-seen) slots.
  activeCache = paid.concat(house);
  activeCacheDay = day;
  if (activeCache.length === 0) activeCache = [{ id: 'blank', text: '' }];
  return activeCache;
}

// ---- Placement: pure function of the terrain polyline ----
let placeCache = { key: '', boards: [] };

function placements(terrain) {
  const poly = terrain[0];
  if (!poly || poly.length < 2) return [];
  const key = poly.length + ':' + poly[0].x + ':' + poly[poly.length - 1].x;
  if (placeCache.key === key) return placeCache.boards;

  const boards = [];
  let lastX = -Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = poly[i], B = poly[i + 1];
    const dx = B.x - A.x;
    if (dx < MIN_FLAT_LEN) continue;
    if (Math.abs((B.y - A.y) / dx) > MAX_GRADE) continue;
    const x = A.x + dx / 2;
    if (x - lastX < MIN_SPACING) continue;
    boards.push({ x, y: A.y + (B.y - A.y) * ((x - A.x) / dx) });
    lastX = x;
  }
  placeCache = { key, boards };
  return boards;
}

// Stable content key: in a periodic world, a board's identity is its
// position WITHIN the lap, so every period image shows the same ad.
function adFor(board, period) {
  const ads = activeAds();
  let pos = board.x;
  if (period) pos = ((pos % period.L) + period.L) % period.L;
  const idx = Math.abs(Math.round(pos / 10)) % ads.length;
  return ads[idx];
}

// ---- Rendering (called by renderer inside the world pass) ----
function draw(ctx, state, cam, width, toScreenX, toScreenY, zoom) {
  const boards = placements(state.terrain);
  if (boards.length === 0) return;
  const period = state.period;
  const span = (width / 2) / zoom + BOARD_W;

  for (const b of boards) {
    // Nearest image to the camera (periodic worlds).
    let bx = b.x, by = b.y;
    if (period) {
      const k = Math.round((b.x - cam.x) / period.L);
      if (k !== 0) { bx -= k * period.L; by -= k * period.D; }
    }
    if (bx < cam.x - span || bx > cam.x + span) continue;

    const ad = adFor(b, period);
    const sx = toScreenX(bx);
    const sy = toScreenY(by);

    // PIXEL 320 Phase 3.2: the board redraws as INTEGER screen-space
    // geometry with bitmap-font copy — no zoom transform (fillRects
    // under a fractional scale land between pixels), no alpha border
    // (pre-composited solid), no canvas text (mush at 320).
    if (window.FF.PIXELATE && window.FF.pxfont) {
      const PF = window.FF.pxfont;
      const px2 = Math.round(sx), py2 = Math.round(sy);
      const bw = Math.max(24, Math.round(BOARD_W * zoom));
      const bh = Math.max(12, Math.round(BOARD_H * zoom));
      const ph2 = Math.max(6, Math.round(POST_H * zoom));
      const bx0 = px2 - (bw >> 1), by0 = py2 - ph2 - bh;
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(bx0 + 3, py2 - ph2, 1, ph2);
      ctx.fillRect(bx0 + bw - 4, py2 - ph2, 1, ph2);
      // the panel's default ground is the canonical off-black (INK,
      // 2026-09-04) — it had been a hand-typed #101010 near it
      const bg = ad.bg || window.FF.shading.INK_HEX;
      ctx.fillStyle = bg;
      ctx.fillRect(bx0, by0, bw, bh);
      ctx.fillStyle = '#636363';           // 0.35 white over the panel
      ctx.fillRect(bx0, by0, bw, 1);
      ctx.fillRect(bx0, by0 + bh - 1, bw, 1);
      ctx.fillRect(bx0, by0, 1, bh);
      ctx.fillRect(bx0 + bw - 1, by0, 1, bh);
      const fgpx = ad.fg || '#e8f2df';
      if (window.FF.palette) {
        window.FF.palette.register('boards', [bg, fgpx,
          '#636363', '#8e9a88', '#2a2a2a']);
      }
      if (ad.text) {
        const t = String(ad.text);
        const fit = Math.max(1, Math.floor((bw - 4) / 4));
        const shown = t.length > fit ? t.slice(0, fit) : t;
        PF.draw(ctx, shown, px2 - PF.measure(shown, 1) / 2,
          by0 + (ad.sub ? 3 : ((bh - 5) >> 1)), 1, fgpx);
      }
      if (ad.sub) {
        const t2 = String(ad.sub);
        const fit2 = Math.max(1, Math.floor((bw - 4) / 4));
        const shown2 = t2.length > fit2 ? t2.slice(0, fit2) : t2;
        PF.draw(ctx, shown2, px2 - PF.measure(shown2, 1) / 2,
          by0 + bh - 8, 1, '#8e9a88');     // pre-composited dim copy
      }
      continue;
    }

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(zoom, zoom);

    const top = -(POST_H + BOARD_H);
    // Posts.
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(-BOARD_W / 2 + 18, -POST_H, 6, POST_H);
    ctx.fillRect(BOARD_W / 2 - 24, -POST_H, 6, POST_H);
    // Panel + border.
    ctx.fillStyle = ad.bg || window.FF.shading.INK_HEX;   // INK (2026-09-04)
    ctx.fillRect(-BOARD_W / 2, top, BOARD_W, BOARD_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-BOARD_W / 2, top, BOARD_W, BOARD_H);

    // Text, fitted to the panel.
    const fg = ad.fg || '#e8f2df';
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxW = BOARD_W - 26;
    if (ad.text) {
      ctx.font = '400 26px "Geist Mono", ui-monospace, monospace';
      const w = ctx.measureText(ad.text).width;
      if (w > maxW) ctx.font = `400 ${Math.max(11, Math.floor(26 * maxW / w))}px "Geist Mono", ui-monospace, monospace`;
      ctx.fillText(ad.text, 0, top + (ad.sub ? BOARD_H * 0.36 : BOARD_H * 0.5));
    }
    if (ad.sub) {
      ctx.fillStyle = 'rgba(232,242,223,0.6)';
      ctx.font = '400 13px "Geist Mono", ui-monospace, monospace';
      const w2 = ctx.measureText(ad.sub).width;
      if (w2 > maxW) ctx.font = `400 ${Math.max(9, Math.floor(13 * maxW / w2))}px "Geist Mono", ui-monospace, monospace`;
      ctx.fillText(ad.sub, 0, top + BOARD_H * 0.72);
    }
    ctx.restore();
  }
}

// ---- Post-race sponsor line (the ONLY place links live) ----
let sponsorEl = null;
let sponsorShown = false;

function updateSponsorLine(state) {
  const shouldShow = state.race.mode === 'track' && state.race.finishedTick !== null;
  if (shouldShow === sponsorShown) return;
  sponsorShown = shouldShow;

  if (!sponsorEl) {
    sponsorEl = document.createElement('div');
    sponsorEl.id = 'sponsor-line';
    document.body.appendChild(sponsorEl);
  }
  if (!shouldShow) {
    sponsorEl.style.display = 'none';
    return;
  }
  const ads = activeAds().filter(a => a.text);
  sponsorEl.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'sponsor-label';
  label.textContent = 'trackside: ';
  sponsorEl.appendChild(label);
  ads.forEach((a, i) => {
    if (i > 0) sponsorEl.appendChild(document.createTextNode(' \u00b7 '));
    if (a.url) {
      const link = document.createElement('a');
      link.href = a.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = a.text;
      sponsorEl.appendChild(link);
    } else {
      sponsorEl.appendChild(document.createTextNode(a.text));
    }
  });
  sponsorEl.style.display = 'block';
}

window.FF = window.FF || {};
window.FF.boards = { draw, updateSponsorLine, placements, activeAds, adFor };

})();
