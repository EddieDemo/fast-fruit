// ============================================================
// SLAB — the strand becomes a solid. (Architecture A stage 1,
// 2026-08-17, built to the approved spec.)
//
// A strand stops being a line the world hangs under and becomes a
// SLAB: the strand polyline is the riding surface, extruded downward
// by SLAB_T along the surface normal and capped at the ends. Faces
// per segment: TOP (rideable), BOTTOM (clonkable — terrace headroom),
// END CAPS at the strand extremities. The melon-vs-slab test is the
// EXISTING ellipse/egg-vs-segment machinery applied per face; nothing
// about the contact solver changes, only how many surfaces can
// propose contacts.
//
// THE BROADPHASE is a uniform spatial hash over world space (CELL =
// 512px ~ max segment AABB). Faces are inserted once per terrain
// rebuild. LAW: hash iteration order must never influence results —
// query() COLLECTS candidates, dedupes, and returns them in CANONICAL
// order; the hash is an accelerator, not an orderer.
//
// THE CANONICAL CONTACT ORDER (the determinism law, spec §3): all
// terrain contacts for a body in a step resolve in (strandId,
// segmentIndex, face) ascending. The face array is SORTED BY THAT KEY
// AT BUILD, so canonical order IS numeric index order and a query
// only ever sorts small integer lists. Face codes: 0 = TOP,
// 1 = BOTTOM, 2 = CAP-START, 3 = CAP-END (caps carry their
// extremity's segment index).
//
// REBUILDS: the world for a terrain (the state.terrain array of
// polylines) is cached and re-validated per access by a cheap
// signature (per-poly length + both end points). Streaming (endless
// prune/ensure, track re-tiling) changes those, triggering a wholesale
// rebuild — a few hundred faces, trivial, and deliberately simpler
// than incremental insertion: rebuild TIMING cannot influence results
// (canonical ordering sees to that), so the simplest correct rebuild
// wins. Deterministic throughout: geometry in, geometry out, no rng,
// no wall clock.
//
// THE WALL SENTINEL (endless mode) arrives here as its own strand,
// tagged isWall (terrain.js moved it out of the point list at this
// stage, per spec §4): physics collides it like any slab — uniform
// laws — and the renderer skips it.
// ============================================================

(function () {
'use strict';

const SLAB_T = 260;   // extrusion depth, world px (spec §1; verified
                      // against the sweep's measured speeds in
                      // verify-slab, not assumed)
const CELL = 512;     // hash cell size ~ max segment AABB (spec §2)
const MITER_MAX = 2;  // crease miter clamp: thickness may thin at a
                      // sharp vee, it may never spike

// ---- slab geometry ---------------------------------------------------
// Downward surface normal of segment (dx, dy), y-down world: the
// up-normal (out of the ground) is (dy, -dx)/len, so downward is its
// negation. Vertex normals are the mitred average of the adjacent
// segments' downward normals, clamped.
function buildSlab(id, pts, isWall) {
  const n = pts.length;
  const bottom = new Array(n);
  // Per-segment MATERIAL normals — THE MATERIAL-SIDE LAW (stage 3):
  // the solid is on the gravity-down side of the riding line. The
  // point-order normal (-dy, dx)/len points down only while x runs
  // forward; on a fold's return leg it points UP, so each segment's
  // normal is flipped to ny > 0, with near-vertical segments (walls,
  // the switchback's drop faces) taking the previous segment's
  // orientation by continuity. For every x-monotone strand the flip
  // never fires and the geometry is byte-identical to stage 1.
  //
  // THE MATERIAL-ABOVE AMENDMENT (stage 5, ruled by Eddie:
  // "any solid-appearing terrain should be solid"): a strand tagged
  // pts.matAbove is a CEILING — its material sits on the gravity-UP
  // side, its polyline traces the visible under-edge, and its slab
  // extends upward. Ceilings carry no s (like the wall), so they
  // never own progress projection; they collide and they render,
  // and because the renderer draws exactly the slab polygon the
  // collider owns, solid-appearing = solid holds BY CONSTRUCTION.
  const want = pts.matAbove ? -1 : 1;
  const snx = new Array(n - 1), sny = new Array(n - 1);
  let sign = want;
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    let nx = -dy / len, ny = dx / len;
    // THE MATERIAL-SIDE OVERRIDE (stage 5 addendum, ruled by Eddie
    // for the serpentine): a segment whose START point carries
    // .mat = 'R' | 'L' takes its material on that ABSOLUTE side of
    // point order — right is the raw (-dy, dx) normal, left its
    // negation — bypassing the gravity rule entirely. Every fold
    // descent face extrudes a ~200-260 px band on one side across
    // its full depth, and a MANDATORY turnaround has ride space in
    // that band somewhere at some level (measured six ways in the
    // serpentine prototype); the tag lets the face tuck its band
    // into its own tier's dead material instead. Untagged segments
    // keep the gravity rule byte-identically, and the following
    // near-vertical continuity inherits from a tagged neighbour,
    // which is the desired weld.
    const m = pts[i].mat;
    if (m === 'R') sign = 1;
    else if (m === 'L') sign = -1;
    else if (ny > 1e-3) sign = want;
    else if (ny < -1e-3) sign = -want;
    // |ny| <= 1e-3 untagged: near-vertical — keep the previous sign.
    snx[i] = nx * sign;
    sny[i] = ny * sign;
  }
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (i === 0) { nx = snx[0]; ny = sny[0]; }
    else if (i === n - 1) { nx = snx[n - 2]; ny = sny[n - 2]; }
    else {
      nx = snx[i - 1] + snx[i];
      ny = sny[i - 1] + sny[i];
      const len = Math.sqrt(nx * nx + ny * ny);
      if (len < 1e-9) { nx = snx[i]; ny = sny[i]; }
      else {
        nx /= len; ny /= len;
        // Miter: uniform thickness needs 1/cos(half-angle); clamp it.
        const cosH = nx * snx[i] + ny * sny[i];
        const k = Math.min(MITER_MAX, 1 / Math.max(cosH, 1 / MITER_MAX));
        nx *= k; ny *= k;
      }
    }
    bottom[i] = { x: pts[i].x + nx * SLAB_T, y: pts[i].y + ny * SLAB_T };
  }
  // dir: the strand's travel direction (+1 forward along point
  // order). Stage 2 plumbing for semantic input — every strand today
  // is +1; reversed strands arrive with folds and ride this field.
  return { id, top: pts, bottom, isWall: !!isWall, dir: pts.dir || 1 };
}

// ---- the world -------------------------------------------------------
// Face storage: flat parallel arrays sorted by the canonical key, so
// canonical order IS index order. sortKey packs (strand, seg, face);
// strands are few and segments < 2^20 in any streamed window.
function buildWorld(polys) {
  const slabs = [];
  for (let s = 0; s < polys.length; s++) {
    const pts = polys[s];
    if (!pts || pts.length < 2) continue;
    slabs.push(buildSlab(s, pts, !!pts.isWall));
  }

  // Collect faces. TOP faces carry their endpoints' ARC values (s0,
  // s1) when the strand is annotated — the projection below
  // interpolates progress from them. Wall/unannotated faces carry
  // NaN and are excluded from projection.
  const F = [];
  for (const sl of slabs) {
    const t = sl.top, b = sl.bottom, m = t.length - 1;
    for (let i = 0; i < m; i++) {
      F.push({ k: key(sl.id, i, 0), ax: t[i].x, ay: t[i].y, bx: t[i + 1].x, by: t[i + 1].y,
        pi: sl.id,
        s0: (sl.isWall || t[i].s === undefined) ? NaN : t[i].s,
        s1: (sl.isWall || t[i + 1].s === undefined) ? NaN : t[i + 1].s,
        dn: !!t[i].dirNeutral });
      F.push({ k: key(sl.id, i, 1), ax: b[i].x, ay: b[i].y, bx: b[i + 1].x, by: b[i + 1].y, s0: NaN, s1: NaN });
    }
    F.push({ k: key(sl.id, 0, 2), ax: t[0].x, ay: t[0].y, bx: b[0].x, by: b[0].y, s0: NaN, s1: NaN });
    F.push({ k: key(sl.id, m - 1, 3), ax: t[m].x, ay: t[m].y, bx: b[m].x, by: b[m].y, s0: NaN, s1: NaN });
  }
  F.sort((a, b2) => a.k - b2.k);

  const nF = F.length;
  const fax = new Float64Array(nF), fay = new Float64Array(nF);
  const fbx = new Float64Array(nF), fby = new Float64Array(nF);
  const fs0 = new Float64Array(nF), fs1 = new Float64Array(nF);
  const fpi = new Int32Array(nF);
  const fdn = new Uint8Array(nF);
  for (let i = 0; i < nF; i++) {
    fax[i] = F[i].ax; fay[i] = F[i].ay; fbx[i] = F[i].bx; fby[i] = F[i].by;
    fs0[i] = F[i].s0; fs1[i] = F[i].s1;
    fpi[i] = F[i].pi === undefined ? -1 : F[i].pi;
    fdn[i] = F[i].dn ? 1 : 0;
  }

  // Spatial hash: cell -> face index list.
  const grid = new Map();
  for (let i = 0; i < nF; i++) {
    const x0 = Math.floor(Math.min(fax[i], fbx[i]) / CELL);
    const x1 = Math.floor(Math.max(fax[i], fbx[i]) / CELL);
    const y0 = Math.floor(Math.min(fay[i], fby[i]) / CELL);
    const y1 = Math.floor(Math.max(fay[i], fby[i]) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const ck = cx * 92837111 + cy; // integer key, exact for game ranges
        let list = grid.get(ck);
        if (!list) { list = []; grid.set(ck, list); }
        list.push(i);
      }
    }
  }

  const stamp = new Int32Array(nF);
  let queryId = 0;
  const PROJ = []; // projection's own candidate buffer

  return {
    slabs, faceCount: nF, fax, fay, fbx, fby, fs0, fs1,
    // ---- PROJECTION (stage 3): the geometric oracle -------------
    // The closest RIDING-SURFACE point to (x, y): expanding-ring
    // hash query over annotated TOP faces, fixed expansion schedule
    // (deterministic — no tolerance exits), canonical tie-break on
    // equal distance. Returns { s, x, y, dirX, dist } or null when
    // nothing annotated lies within the last ring. dirX is the
    // point-order travel sign at the foot — semantic input's dir.
    project(x, y) {
      // THE DIRECTION-NEUTRAL TAG (stage 5 addendum, ruled by Eddie
      // for the serpentine): a face whose start point carries
      // .dirNeutral owns s and projection as normal but CEDES
      // DIRECTION to the nearest directional face. Any vertex where
      // dirX flips +1 -> -1 is a semantic ATTRACTOR — both domains
      // drive bodies toward it and hold them there by their own
      // throttle (the watershed law; measured contact-proof at the
      // serpentine crest). Tagging one side dissolves the attractor:
      // the whole junction region reads one direction and drains.
      // Both bests use the same canonical iteration and tie-break,
      // so hash order still cannot influence the result (spec §2).
      let best = -1, bestD = Infinity, bestT = 0;
      let bestDir = -1, bestDirD = Infinity;
      for (let ring = 1; ring <= 5; ring++) {
        const r = ring * CELL;
        const n = this.query(x - r, y - r, x + r, y + r, PROJ);
        for (let ci = 0; ci < n; ci++) {
          const fi = PROJ[ci];
          if (fs0[fi] !== fs0[fi]) continue; // NaN: not a riding face
          const ax = fax[fi], ay = fay[fi];
          const dxs = fbx[fi] - ax, dys = fby[fi] - ay;
          const l2 = dxs * dxs + dys * dys;
          let t = l2 > 0 ? ((x - ax) * dxs + (y - ay) * dys) / l2 : 0;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const px = ax + dxs * t, py = ay + dys * t;
          const d2 = (x - px) * (x - px) + (y - py) * (y - py);
          if (d2 < bestD - 1e-12 || (d2 < bestD + 1e-12 && (best < 0 || fi < best))) {
            bestD = d2; best = fi; bestT = t;
          }
          if (!fdn[fi]
              && (d2 < bestDirD - 1e-12
                  || (d2 < bestDirD + 1e-12 && (bestDir < 0 || fi < bestDir)))) {
            bestDirD = d2; bestDir = fi;
          }
        }
        // A hit strictly inside the ring cannot be beaten by a
        // farther ring; stop expanding (the DIRECTIONAL best keeps
        // the same guarantee only once found — expand until both).
        if (best >= 0 && Math.sqrt(bestD) < r - 1
            && (bestDir >= 0 || ring === 5)) break;
      }
      if (best < 0) return null;
      const ax = fax[best], ay = fay[best];
      const dxs = fbx[best] - ax, dys = fby[best] - ay;
      const di = (fdn[best] && bestDir >= 0) ? bestDir : best;
      return {
        s: fs0[best] + (fs1[best] - fs0[best]) * bestT,
        x: ax + dxs * bestT,
        y: ay + dys * bestT,
        dirX: (fbx[di] - fax[di]) >= 0 ? 1 : -1,
        dist: Math.sqrt(bestD),
        poly: fpi[best],   // owning strand index (stage 5: respawn walk)
      };
    },
    // Exposed for the SUITES ONLY (verify-hash, verify-contact-order):
    // they shuffle these cell lists to prove that hash iteration order
    // cannot influence candidates or trajectories. Runtime never reads
    // it back.
    grid,
    // Query an AABB. Fills `out` (a plain array the caller reuses)
    // with candidate face indices in CANONICAL order; returns count.
    // Dedup via a per-face stamp; the final numeric sort is what
    // makes hash iteration order irrelevant (THE LAW, spec §2).
    query(x0, y0, x1, y1, out) {
      queryId++;
      let count = 0;
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
      const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const list = grid.get(cx * 92837111 + cy);
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const fi = list[j];
            if (stamp[fi] === queryId) continue;
            stamp[fi] = queryId;
            // Face AABB vs query AABB (cheap reject inside the cell).
            if (Math.max(fax[fi], fbx[fi]) < x0 || Math.min(fax[fi], fbx[fi]) > x1) continue;
            if (Math.max(fay[fi], fby[fi]) < y0 || Math.min(fay[fi], fby[fi]) > y1) continue;
            out[count++] = fi;
          }
        }
      }
      // Insertion sort: candidate lists are small (a handful of faces).
      for (let i = 1; i < count; i++) {
        const v = out[i];
        let j = i - 1;
        while (j >= 0 && out[j] > v) { out[j + 1] = out[j]; j--; }
        out[j + 1] = v;
      }
      return count;
    },
  };
}

function key(sid, seg, face) { return (sid * 1048576 + seg) * 4 + face; }

// ---- cache: terrain array -> world -----------------------------------
// Signature covers per-poly length and both end points — everything
// the streaming providers move (prune, ensure, re-tile, wall walk).
const CACHE = new WeakMap();

function signature(polys) {
  const parts = [];
  for (const p of polys) {
    if (!p || p.length === 0) { parts.push('0'); continue; }
    const a = p[0], b = p[p.length - 1];
    parts.push(p.length + ',' + a.x + ',' + a.y + ',' + b.x + ',' + b.y);
  }
  return parts.join(';');
}

function worldFor(terrain) {
  let entry = CACHE.get(terrain);
  const sig = signature(terrain);
  if (!entry || entry.sig !== sig) {
    entry = { sig, world: buildWorld(terrain) };
    CACHE.set(terrain, entry);
  }
  return entry.world;
}

window.FF = window.FF || {};
window.FF.slab = { SLAB_T, CELL, buildSlab, buildWorld, worldFor };

})();
