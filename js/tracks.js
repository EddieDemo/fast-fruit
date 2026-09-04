// ============================================================
// TRACKS — lap circuits as data: the Penrose staircase.
//
// A track is a RECIPE, not geometry: { seed, lapLengthM, dropPerLapM,
// laps }. From the seed we deterministically generate ONE lap template
// (a polyline spanning exactly x: 0..L, y: 0..D), then tile it: period
// p is the template offset by (p*L, p*D). The world descends forever,
// but every lap is geometrically identical — a wrapping circuit the
// player can memorize, while physics keeps honest downhill gravity.
//
// The template opens with a 300px flat and CLOSES with a 1300px one,
// so each seam is a 1600px start straight with perfect slope
// continuity — the closing flat is the STARTING GRID's apron: 12 m of
// guaranteed flat immediately before the line (which sits 120px into
// the opening flat), one spawn metre per racer, plus body-width slack. Nothing
// ever teleports: all bodies live in absolute coordinates; only the
// terrain repeats. Melon-vs-melon "lapping" is handled in physics via
// the minimum-image convention (see physics.js).
//
// Template generation uses DRIFT CONTROL: chunks are chosen like the
// endless generator, but whenever accumulated height strays >250px
// from the ideal descent line (x/L)*D, a corrective chunk steers it
// back — so the final closing slope is always gentle and the lap hits
// (L, D) exactly.
// ============================================================

(function () {
'use strict';

// ---- The registry: add a track = add an entry. ----
const TRACKS = {
  'Track 1': { seed: 7101, lapLengthM: 400, dropPerLapM: 70, laps: 3 },
};

function buildLapTemplate(seed, L, D) {
  // V2 (2026-08-17): the lap builder SPEAKS THE SHARED VOCABULARY —
  // terrain.js's recipe, chunk speaker, and cursor — instead of the
  // stale duplicate generator it once was (v1 shapes, own weights, no
  // dialects: the fork meant the whole v2 rework never reached actual
  // races until this port). What remains local here is the LAP LAW:
  // drift correction against the ideal line, and the closing zone
  // that forces exact (L, D) so periods tile bit-perfectly.
  const Laws = window.FF.terrainLaws;
  const rng = window.FF.mulberry32(seed);
  const rr = (lo, hi) => lo + rng() * (hi - lo);
  const rec = Laws.trackRecipe(seed);        // same dialect as endless
  const cur = Laws.makeCursor(0, 0);

  cur.chunkKind = 'runway';
  cur.flat(300); // start straight (pairs with the previous period's apron)

  // The reserve must cover the LONGEST chunk plus the closing
  // correction and the 1300px apron. The stage-5 gallery is now the
  // longest word: leads + mouth span + derived deck A (D 1600 + a
  // worst-case chute run) + apron + bowl reach + floor margin
  // ~= 5200 px — 4800 let a legally-started gallery overrun the
  // closer, whose forced correction then laid a NEGATIVE-length
  // slope: a backward weld the whole field jammed against (seed
  // 334513, 110 s at vx 25).
  const RESERVE = 5600;
  while (cur.x < L - RESERVE) {
    const drift = cur.y - (cur.x / L) * D; // + dropped too much, - not enough
    if (drift > 250) {
      // ease off, let the ideal line catch up (the lap's own rest note)
      cur.chunkKind = 'flat';
      cur.lastKind = 'flat';
      cur.flat(rr(250, 450));
    } else if (drift < -250) {
      // steepen to catch the line
      cur.chunkKind = 'slope';
      cur.lastKind = 'slope';
      const len = rr(400, 700);
      cur.slope(len, len * rr(0.25, 0.34));
    } else {
      Laws.speakChunk(cur, rng, rec);
    }
  }

  // Closing: one gentle correction slope onto the finish straight,
  // then the GRID APRON (1300px flat), FORCING exact (L, D) so tiling
  // is bit-perfect across periods.
  cur.chunkKind = 'slope';
  cur.slope((L - 1300) - cur.x, D - cur.y);
  cur.x = L - 1300; cur.y = D;
  // The forced-exact overwrites must carry ARC (stage 3): recompute
  // s from the surviving neighbour, and re-anchor the cursor's own
  // arc so the apron continues from the corrected point.
  const fixS = () => {
    const n = cur.pts.length;
    const a = cur.pts[n - 2], b = cur.pts[n - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    b.s = a.s + Math.sqrt(dx * dx + dy * dy);
    cur.s = b.s;
  };
  cur.pts[cur.pts.length - 1] = { x: cur.x, y: cur.y, k: 'slope' };
  fixS();
  cur.chunkKind = 'runway';
  cur.flat(1300);
  cur.pts[cur.pts.length - 1] = { x: L, y: D, k: 'runway' };
  fixS();

  cur.pts.branches = cur.branches; // template carries its side strands
  return cur.pts;
}

// ---- Periodic terrain provider ----
// Same interface as the endless provider in main.js: reset(), then
// update(loX, hiX) keeps `pts` covering the window. Rebuild only
// happens when the set of visible periods changes (about once a lap).
function createTrackProvider(def) {
  const PXM = window.FF.CONFIG.pxPerMetre;
  const L = def.lapLengthM * PXM;
  const D = def.dropPerLapM * PXM;
  const template = buildLapTemplate(def.seed, L, D);

  // THE LAP ARC (stage 3): the template's total arc length — the
  // spine's lap unit now that progress is metric. Differs from L on
  // every track (arc runs longer than x on every slope, and a
  // switchback packs ~3 deck-lengths of arc into one deck of x).
  const lapArc = template[template.length - 1].s;
  const tplBranches = template.branches || [];

  // ---- REST SITES (ruled 2026-08-27, furniture placement) ----------
  // Where the WORLD will hold a ball still. A dip is a point where
  // the surface stops descending and starts rising: a true local
  // minimum in travel, so a body placed there at rest has nowhere
  // to roll. Furniture is placed where the ground holds it rather
  // than held by a rule — a ball parked mid-slope runs thousands of
  // px downhill (measured: 29k-32k on the steepest ground), which
  // is why the arbitrary-arc draw never survived to be met.
  //
  // Computed from the TEMPLATE, at construction: the whole lap
  // exists before the race starts (streaming only TILES it), so
  // this is a pure question with a pure answer, no coverage
  // involved. Arc-keyed, so a site is the same site on every lap.
  const restSites = [];
  for (let i = 1; i < template.length - 1; i++) {
    const dyA = template[i].y - template[i - 1].y;      // + = descending (y down)
    const dyB = template[i + 1].y - template[i].y;
    if (dyA > 0 && dyB <= 0) {
      restSites.push({ s: template[i].s, k: template[i].k || 'runway' });
    }
  }

  // ---- FLAT SITES (rectangular props, phase 3) ---------------------
  // Where the world will hold a BOX still. A sphere wants a dip; a box
  // wants a RUN — a stretch of near-level ground long enough that its
  // whole footprint sits on one grade. A box placed at a dip would
  // bridge the vee and rock on two corners; a box placed at the edge
  // of a flat run would hang half over the drop.
  //
  // Same construction-time, template-only, arc-keyed law as restSites
  // above. A run is a maximal span of consecutive segments whose grade
  // stays inside flatGrade; the site is the MIDDLE of the run, and the
  // run's arc length rides along so the mint can refuse a run too
  // short for a given species' footprint.
  const flatSites = [];
  {
    const FG = window.FF.CONFIG.furniture.flatGrade;
    let i = 0;
    while (i < template.length - 1) {
      let j = i;
      while (j < template.length - 1) {
        const dx = template[j + 1].x - template[j].x;
        const dy = template[j + 1].y - template[j].y;
        if (dx === 0 || Math.abs(dy / dx) > FG) break;
        j++;
      }
      if (j > i) {
        const len = template[j].s - template[i].s;
        if (len >= window.FF.CONFIG.furniture.flatMinRun) {
          // The run's steepest segment, as |dy/dx| (2026-08-31): a
          // "flat" run may grade up to flatGrade, and bricked box
          // piles CREEP on anything past ~2% (measured: 24 px in 5 s
          // at 5%). Kinds that care filter on it; kinds that don't
          // never read it, so no deal moves.
          let grade = 0;
          for (let q = i; q < j; q++) {
            const gx = template[q + 1].x - template[q].x;
            const gy = template[q + 1].y - template[q].y;
            if (gx !== 0) grade = Math.max(grade, Math.abs(gy / gx));
          }
          flatSites.push({ s: (template[i].s + template[j].s) * 0.5,
            k: template[i].k || 'runway', len, grade,
            s0: template[i].s, s1: template[j].s });   // the run it claims
        }
      }
      i = j + 1;
    }
  }

  const provider = {
    def,
    period: { L, D },
    lapArc,
    restSites,            // dips the world holds a body in (furniture)
    flatSites,            // level runs a BOX can sit flat on (phase 3)
    _template: template,  // verification surface: copy-vs-copy
                          // comparison masks SYMMETRIC field drops
                          // (mat was dropped at every period alike);
                          // only copy-vs-template catches the class

    pts: [],
    branches: [],
    _pLo: null,
    _pHi: null,

    reset() {
      this._pLo = null;
      this._pHi = null;
      this.pts.length = 0;
      this.branches.length = 0;
    },
    // The strand list (stage 4): primary, then branches. Track mode
    // has no world-edge wall.
    polys() { return [this.pts, ...this.branches]; },

    update(loX, hiX) {
      const pLo = Math.floor(loX / L);
      const pHi = Math.floor(hiX / L);
      if (pLo === this._pLo && pHi === this._pHi) return;
      this._pLo = pLo;
      this._pHi = pHi;
      // REV (2026-08-18): every rebuild replaces the branch ARRAYS,
      // so any spread captured from polys() goes stale. Consumers
      // watch this counter and recapture. Without it, state.terrain
      // kept the race-start snapshot forever: laps 2+ lost every
      // branch strand — gallery decks, aprons, bowls — invisible AND
      // non-colliding.
      this.rev = (this.rev || 0) + 1;
      this.pts.length = 0;
      this.branches.length = 0;
      for (let p = pLo; p <= pHi; p++) {
        // Skip each subsequent period's first point: it duplicates the
        // previous period's forced-exact last point.
        for (let i = p === pLo ? 0 : 1; i < template.length; i++) {
          const o = { x: template[i].x + p * L, y: template[i].y + p * D,
            k: template[i].k,      // the kind survives the tiling
            fam: template[i].fam,  // and the lip family (telemetry)
            s: template[i].s + p * lapArc }; // ...and so does the arc
          // the material-side override survives too — dropping it
          // re-created the verify-fold C defect in track mode only
          // (fold bands extruded to the auto side on every lap)
          if (template[i].mat !== undefined) o.mat = template[i].mat;
          this.pts.push(o);
        }
        // Branch strands tile whole, one copy per period, same
        // offsets — the s-anchor law survives tiling because both
        // the branch's s and its anchor's s shift by p * lapArc.
        for (const br of tplBranches) {
          const cp = br.map((q) => {
            const o = { x: q.x + p * L, y: q.y + p * D, k: q.k, fam: q.fam };
            if (q.s !== undefined) o.s = q.s + p * lapArc; // ceilings carry no s
            if (q.mat !== undefined) o.mat = q.mat; // material override survives
            return o;
          });
          cp.matAbove = br.matAbove;      // strand flags survive tiling
          // EVERY positional entry field shifts. wallX was omitted
          // here: period 0 worked (offset zero) and every later lap
          // had its wall discipline pointing a full lap behind —
          // dirW flipped (pilot.js reads wallX >= farX) and bots
          // committed to the gallery jump, then met the bowl
          // unbraked. Laps LOOKED different because the field's
          // behavior at the fork was.
          if (br.entry) cp.entry = { ...br.entry, lipX: br.entry.lipX + p * L,
            farX: br.entry.farX + p * L,
            lipY: br.entry.lipY + p * D,
            wallX: br.entry.wallX === undefined
              ? undefined : br.entry.wallX + p * L };
          this.branches.push(cp);
        }
      }
    },
  };

  return provider;
}

window.FF = window.FF || {};
// Resolve a track definition from its NAME. Registry tracks come from
// TRACKS; daily tracks are SELF-DESCRIBING — 'Daily 2026-08-07' carries
// its own seed (20260807), so a challenge link for any daily works
// forever, with no registry entry and no server.
const DAILY_RE = /^Daily (\d{4})-(\d{2})-(\d{2})$/;

// A daily name may carry a CUP LEG: "Daily 2026-08-12" is leg 1, and
// "Daily 2026-08-12 #2..#4" are the rest of that day's cup. All four
// derive from the same date, so a day has ONE identity and practising
// leg 1 genuinely prepares you for the cup's first race.
const LEG_RE = /\s#([1-4])$/;

function trackDefByName(name) {
  if (TRACKS[name]) return TRACKS[name];
  const legM = LEG_RE.exec(name || '');
  const leg = legM ? parseInt(legM[1], 10) : 1;
  const base = legM ? name.slice(0, legM.index) : name;
  // DEV TRACKS: 'Dev <seed>' resolves like a daily but with the seed
  // written in the name — so a random dev track is still perfectly
  // reproducible (paste the name, get the track), and resume can
  // resolve it after a reload. Legs salt exactly as dailies do.
  const dm = /^Dev (\d+)$/.exec(base || '');
  if (dm) {
    const baseSeed = parseInt(dm[1], 10) >>> 0;
    const seed = leg === 1 ? baseSeed : (baseSeed ^ Math.imul(leg, 0x9E3779B1)) >>> 0;
    if (window.FF.DEV_RANDOM_TRACKS) {
      console.log('[FF dev] track "' + name + '" seed ' + seed);
    }
    return { seed, lapLengthM: 400, dropPerLapM: 70, laps: 3, leg };
  }
  const m = DAILY_RE.exec(base || '');
  if (m) {
    const dateSeed = parseInt(m[1] + m[2] + m[3], 10);
    // Leg 1 MUST keep the bare date seed, or today's practice track
    // stops matching the cup's first race (and every stored daily
    // ghost/record from before the cup would silently change track).
    const seed = leg === 1 ? dateSeed : (dateSeed ^ Math.imul(leg, 0x9E3779B1)) >>> 0;
    return {
      seed,
      lapLengthM: 400,
      dropPerLapM: 70,
      laps: 3,
      leg,
    };
  }
  return null;
}

// The legs of a day's cup, in order. Leg 1 is the plain daily; the
// COUNT is the cup's law (cup.js LEGS), read at call time so the two
// can never disagree. Falls back to 3 for load order.
function dailyCupTracks(d) {
  const base = dailyTrackName(d);
  const n = (window.FF.cup && window.FF.cup.LEGS) || 3;
  const out = [base];
  for (let i = 2; i <= n; i++) out.push(base + ' #' + i);
  return out;
}

// Today's daily name, from the local date: the seed IS the date.
// DEV_RANDOM_TRACKS (console: FF.DEV_RANDOM_TRACKS = true): every
// call mints a FRESH 'Dev <seed>' name instead — so each PLAY CUP or
// PRACTICE press is a new random track, for generator testing. The
// seed lives in the name, so anything that resolves the name later
// (resume, retry, ghosts within the session) gets the same terrain;
// the randomness is in the CHOICE, never in the track. Session-only:
// reload and you're back on dailies. Not sim code, so Date/random
// here breaks no law — the seed drives the same deterministic
// generator as ever.
function dailyTrackName(d) {
  if (window.FF.DEV_RANDOM_TRACKS) {
    return 'Dev ' + (((Date.now() & 0xffffffff) ^ ((Math.random() * 0x10000) | 0) * 65536) >>> 0);
  }
  const day = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Daily ${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
}

// Is this name a self-describing DAILY (any leg)? The date is in the
// name, so a daily belongs to a DAY — which is what lets resume.js
// expire a snapshot at midnight without knowing anything about track
// naming. Registry tracks ('Track 1') and anything unresolvable are
// not dailies and never expire by date.
function isDailyTrackName(name) {
  const legM = LEG_RE.exec(name || '');
  const base = legM ? name.slice(0, legM.index) : name;
  return DAILY_RE.test(base || '');
}

Object.assign(window.FF, { TRACKS, createTrackProvider, trackDefByName, dailyTrackName, dailyCupTracks, isDailyTrackName });

})();