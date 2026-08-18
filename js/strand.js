// ============================================================
// STRAND — track-space. (Stage 0 of Architecture A, 2026-08-17.)
//
// THE FOUNDATIONAL MOVE: separate PROGRESS from WORLD X. A track is a
// directed graph of STRANDS — each a world-space polyline with an
// arc-length parameter and a travel direction — and racing (position,
// laps, the finish, standings, markers) lives in S, the parameter
// along a canonical SPINE, while physics stays in world space. This
// is the marriage the heightfield era conflated, and unpicking it
// once, here, is what makes folds, terraces, pockets, falls-between,
// and branches expressible without a single hack downstream.
//
// STAGE 0 CONTRACT: today's game is the DEGENERATE CASE — one strand,
// direction +1, whose spine parameter is chosen as (x - startX), NOT
// metric arc length. That choice is deliberate: it makes progressOf
// bit-identical to every raw `m.x - raceStartX` expression it will
// replace, so the consumer rewiring (finishline, racewatch, hud,
// ghost, resume, renderer markers, main, state — the mapped eight)
// is a pure refactor with provable parity. Metric arc length arrives
// with folds, as a different PARAMETERIZATION of the same spine —
// the API never changes again, only the table behind it.
//
// Everything here is pure and deterministic: tables from integer-
// deterministic input points, no Math.random, no wall clock.
// ============================================================

(function () {
'use strict';

// ---- strands ---------------------------------------------------------
// A strand wraps a world polyline with cumulative arc length. dir is
// the travel direction along the point order: +1 forward, -1 reversed
// (reversed strands arrive with folds; the table is direction-blind).
function makeStrand(id, pts, dir) {
  const cum = new Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  return {
    id, pts, dir: dir || 1,
    length: cum[pts.length - 1],
    cum,
    // World point at arc-length a along the strand (clamped).
    pointAt(a) {
      const c = this.cum;
      if (a <= 0) return { x: pts[0].x, y: pts[0].y };
      if (a >= this.length) {
        const p = pts[pts.length - 1];
        return { x: p.x, y: p.y };
      }
      let lo = 0, hi = c.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid] <= a) lo = mid; else hi = mid;
      }
      const t = (a - c[lo]) / (c[hi] - c[lo]);
      return {
        x: pts[lo].x + (pts[hi].x - pts[lo].x) * t,
        y: pts[lo].y + (pts[hi].y - pts[lo].y) * t,
      };
    },
    // Arc length at a world x, for X-MONOTONE strands only (every
    // strand of the heightfield era; folds bring true projection in
    // stage 1 and this asserts rather than lies).
    arcAtX(wx) {
      if (pts[pts.length - 1].x < pts[0].x) {
        throw new Error('arcAtX: strand not x-monotone; use project()');
      }
      if (wx <= pts[0].x) return 0;
      if (wx >= pts[pts.length - 1].x) return this.length;
      let lo = 0, hi = pts.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].x <= wx) lo = mid; else hi = mid;
      }
      const t = (wx - pts[lo].x) / (pts[hi].x - pts[lo].x);
      return this.cum[lo] + (this.cum[hi] - this.cum[lo]) * t;
    },
  };
}

// ---- the spine -------------------------------------------------------
// The spine is the canonical progress axis: a parameterization every
// strand maps onto. Stage 0 ships the DEGENERATE spine — one straight
// strand whose parameter IS (x - startX) — plus the general shape the
// later stages fill (strand->interval mapping for branches, metric
// parameterization for folds).
//
// STAGE 2 (2026-08-17): the spine also answers SURFACE questions —
// surfaceAt(s) and tangentAt(s) — and terrainYAt is DEAD. The
// degenerate contract, same move as stage 0: surfaceAt probes the
// polylines at world x = startX + s with terrainYAt's arithmetic
// VERBATIM, so every consumer rewiring is a pure refactor with
// provable parity (verify-spine-parity). When folds arrive, only the
// table behind these queries changes.
function metricSpine(startX, lapArc, terrain) {
  return {
    kind: 'metric',
    startX,
    lapLen: lapArc || null,   // a LAP OF ARC now, not of x (stage 3)
    terrain: terrain || null,
    // ---- STAGE 3: THE PARAMETER IS ARC LENGTH ----
    // Points carry cumulative arc s (annotated at generation); the
    // slab world projects bodies onto the nearest riding face. The
    // degenerate x-parameterization is dead — arc is monotone in
    // point order even where x is not, which is what makes the
    // switchback parameterizable at all. The API shape is unchanged
    // from stage 0; only the table behind it moved, as promised.
    _world() {
      return (this.terrain && window.FF.slab)
        ? window.FF.slab.worldFor(this.terrain) : null;
    },
    // Progress = projected arc. Fallback for a body beyond every
    // projection ring (pruned window edges): the old x expression —
    // approximate, but only reachable off the playable window.
    progressOf(body) {
      const w = this._world();
      if (w && w.project) {
        const pr = w.project(body.x, body.y);
        if (pr) return pr.s;
      }
      return body.x - this.startX;
    },
    lapOf(body) {
      if (!this.lapLen) return 0;
      return Math.floor(this.progressOf(body) / this.lapLen);
    },
    // The world POINT at arc s (with unit point-order tangent), or
    // null off the loaded window. Binary search over s-annotated
    // polylines — s is strictly increasing in point order (the
    // monotone law, held by verify-terrain H).
    surfaceAt(s) {
      if (!this.terrain) return null;
      for (const poly of this.terrain) {
        if (poly.isWall) continue;
        const n = poly.length;
        if (n < 2 || poly[0].s === undefined) continue;
        if (s < poly[0].s || s > poly[n - 1].s) continue;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (poly[mid].s <= s) lo = mid; else hi = mid;
        }
        const a = poly[lo], b = poly[lo + 1];
        const span = b.s - a.s;
        const t = span > 0 ? (s - a.s) / span : 0;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: a.x + dx * t, y: a.y + dy * t, tx: dx / len, ty: dy / len };
      }
      return null;
    },
    tangentAt(s) {
      const sp = this.surfaceAt(s);
      return sp ? { tx: sp.tx, ty: sp.ty } : { tx: 1, ty: 0 };
    },
    // The nearest riding-surface foot to a world point: {s, x, y,
    // dirX, dist} or null. THE x-KEYED SURFACE QUESTION'S TRUE FORM:
    // "the ground under x" is multivalued beneath a fold, so every
    // asker now brings a reference y and gets the deck nearest it.
    projectPoint(x, y) {
      const w = this._world();
      return (w && w.project) ? w.project(x, y) : null;
    },
    // ---- THE RESPAWN-WALK LAW (ruled 2026-08-17; s-space form) ----
    // Walk BACKWARD IN ARC from the death point to the nearest
    // climbable stretch long enough to launch from (see stage 2
    // amendment). Climbability is judged in TRAVEL: uphill grade =
    // -dy per |dx| along point order — the same physics on a
    // reversed deck, where travel runs -x. Near-vertical faces are
    // never climbable; stretches shorter than MIN_STRETCH (roller
    // troughs, deck-drop ledges) are traps and are skipped.
    respawnPointBehind(body, maxGrade, maxWalk) {
      if (!this.terrain) return null;
      const RUNUP = 420, MIN_STRETCH = 320;
      const cap = maxWalk || 2000;
      const s0 = this.progressOf(body);
      // STRAND-OWNED WALK (stage 5): a death remembers the strand its
      // projection foot was on (body.deathPoly, physics.js). The walk
      // runs on THAT strand when it is annotated and contains s0 —
      // dying on a deck respawns on the deck, not the floor beneath —
      // and falls back to the s-containing scan (the primary, for
      // overlapped intervals) when the owner is unknown, unannotated,
      // or too short behind the death point to host a walk. Short
      // branches (the drain's bridge, most far decks) mostly take the
      // fallback today; the law is what matters, and long branches
      // arrive with the vocabulary.
      let order = this.terrain;
      const dp = body.deathPoly;
      if (dp !== undefined && dp >= 0 && dp < this.terrain.length) {
        const own = this.terrain[dp];
        if (own && !own.isWall && own.length >= 2 && own[0].s !== undefined
            && s0 >= own[0].s && s0 <= own[own.length - 1].s) {
          order = [own, ...this.terrain.filter((q) => q !== own)];
        }
      }
      for (const poly of order) {
        if (poly.isWall) continue;
        const n = poly.length;
        if (n < 2 || poly[0].s === undefined) continue;
        if (s0 < poly[0].s || s0 > poly[n - 1].s) continue;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (poly[mid].s <= s0) lo = mid; else hi = mid;
        }
        const climbable = (k) => {
          const adx = Math.abs(poly[k + 1].x - poly[k].x);
          if (adx <= 1e-9) return false;
          return (-(poly[k + 1].y - poly[k].y) / adx) <= maxGrade + 1e-12;
        };
        const place = (sTarget) => {
          let a = 0, b = n - 1;
          while (b - a > 1) {
            const mid = (a + b) >> 1;
            if (poly[mid].s <= sTarget) a = mid; else b = mid;
          }
          const pa = poly[a], pb = poly[a + 1];
          const span = pb.s - pa.s;
          const t = span > 0 ? (sTarget - pa.s) / span : 0;
          return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
        };
        if (climbable(lo)) return { x: body.x, inPlace: true };
        let j = lo - 1;
        while (j >= 0 && s0 - poly[j + 1].s <= cap) {
          while (j >= 0 && !climbable(j)) j--;
          if (j < 0 || s0 - poly[j + 1].s > cap) return null;
          const stretchEnd = j + 1;
          while (j >= 0 && climbable(j)) j--;
          const stretchStart = j + 1;
          const len = poly[stretchEnd].s - poly[stretchStart].s;
          if (len >= MIN_STRETCH || s0 - poly[stretchStart].s > cap) {
            const anchor = poly[stretchEnd].s - 1e-6;
            const sT = Math.max(anchor - RUNUP,
              poly[stretchStart].s + 1e-6, s0 - cap);
            return place(sT);
          }
        }
        // This strand cannot host the walk (too short behind, or no
        // climbable stretch in range): try the next in order — the
        // owner's fallback to the primary lives exactly here.
        continue;
      }
      return null;
    },
  };
}

window.FF = window.FF || {};
window.FF.trackSpace = { makeStrand, metricSpine,
  // Transitional alias: every caller means the metric spine now.
  degenerateSpine: metricSpine };

})();
