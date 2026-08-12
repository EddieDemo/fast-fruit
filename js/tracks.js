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
  const rng = window.FF.mulberry32(seed);
  const rr = (lo, hi) => lo + rng() * (hi - lo);

  const pts = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  const push = () => pts.push({ x, y });
  const flat = (l) => { x += l; push(); };
  const slope = (l, dy) => { x += l; y += dy; push(); };
  const bump = (l, amp, base, segs = 12) => {
    const x0 = x, y0 = y;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      pts.push({ x: x0 + l * t, y: y0 + base * t + amp * 0.5 * (1 - window.FF.dmath.cos(2 * Math.PI * t)) });
    }
    x = x0 + l; y = y0 + base;
  };

  flat(300); // start straight (pairs with the previous period's ending flat)

  // Chunk sizes are capped (<~1200px) so the reserved closing zone can
  // never be squeezed into a steep correction.
  const RESERVE = 3600; // room for the closing correction + the 1300px apron
  while (x < L - RESERVE) {
    const drift = y - (x / L) * D; // + = dropped too much, - = not enough
    if (drift > 250) {
      flat(rr(250, 450)); // ease off, let the ideal line catch up
    } else if (drift < -250) {
      const len = rr(400, 700);
      slope(len, len * rr(0.25, 0.34)); // steepen to catch the line
    } else {
      const pick = rng();
      if (pick < 0.34) {
        const len = rr(350, 750);
        slope(len, len * rr(0.12, 0.3));
      } else if (pick < 0.62) {
        const n = 2 + Math.floor(rng() * 2); // 2-3 bumps, capped length
        for (let i = 0; i < n; i++) {
          const len = rr(300, 450);
          bump(len, (rng() < 0.5 ? -1 : 1) * rr(40, 85), len * rr(0.08, 0.18));
        }
      } else if (pick < 0.8) {
        flat(rr(220, 420));
      } else {
        // Kicker jump, same anatomy as endless mode.
        flat(rr(120, 200));
        const rise = rr(90, 140);
        slope(rr(200, 260), -rise);
        slope(12, rise + rr(140, 240));
        slope(rr(420, 650), rr(120, 200));
      }
    }
  }

  // Closing: one gentle correction slope onto the finish straight,
  // then the GRID APRON (1300px flat), FORCING exact (L, D) so tiling
  // is bit-perfect across periods.
  slope((L - 1300) - x, D - y);
  x = L - 1300; y = D;
  pts[pts.length - 1] = { x, y };
  flat(1300);
  pts[pts.length - 1] = { x: L, y: D };

  return pts;
}

// ---- Periodic terrain provider ----
// Same interface as the endless provider in main.js: reset(), then
// update(loX, hiX) keeps `pts` covering the window. Rebuild only
// happens when the set of visible periods changes (about once a lap).
function createTrackProvider(def) {
  const L = def.lapLengthM * 100;
  const D = def.dropPerLapM * 100;
  const template = buildLapTemplate(def.seed, L, D);

  const provider = {
    def,
    period: { L, D },
    pts: [],
    _pLo: null,
    _pHi: null,

    reset() {
      this._pLo = null;
      this._pHi = null;
      this.pts.length = 0;
    },

    update(loX, hiX) {
      const pLo = Math.floor(loX / L);
      const pHi = Math.floor(hiX / L);
      if (pLo === this._pLo && pHi === this._pHi) return;
      this._pLo = pLo;
      this._pHi = pHi;
      this.pts.length = 0;
      for (let p = pLo; p <= pHi; p++) {
        // Skip each subsequent period's first point: it duplicates the
        // previous period's forced-exact last point.
        for (let i = p === pLo ? 0 : 1; i < template.length; i++) {
          this.pts.push({ x: template[i].x + p * L, y: template[i].y + p * D });
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

// The four legs of a day's cup, in order. Leg 1 is the plain daily.
function dailyCupTracks(d) {
  const base = dailyTrackName(d);
  return [base, base + ' #2', base + ' #3', base + ' #4'];
}

// Today's daily name, from the local date: the seed IS the date.
function dailyTrackName(d) {
  const day = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Daily ${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
}

Object.assign(window.FF, { TRACKS, createTrackProvider, trackDefByName, dailyTrackName, dailyCupTracks });

})();