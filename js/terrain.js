// ============================================================
// TERRAIN — seeded, streaming, endless track generation. (v2)
//
// Principles:
//  * DETERMINISTIC: same seed => identical terrain, always. The RNG
//    (mulberry32) is self-contained integer math — no Math.random,
//    no engine-dependent behavior. This is the foundation the ghost
//    system stands on: a run is (seed + recorded positions).
//    GENERATOR CHANGES BREAK RECORDED GHOSTS — this is v5
//    (2026-08-17: v2 was the dialect rework; v3 is the CHECK-MARK
//    PIT, same day); pre-launch that costs nothing, post-launch it
//    means versioning.
//  * STREAMING: chunks are generated ahead of the melon and pruned
//    behind it, so the polyline stays small forever. Pruning never
//    affects future generation — the generator's cursor (x, y, rng
//    state) is independent of the point list.
//  * THE DIALECT LAW (v2): variance WITHIN a track reads as noise;
//    variance BETWEEN tracks reads as identity. Every numeric range
//    a chunk draws from is itself drawn ONCE per track seed — the
//    RECIPE — so chunks rhyme within a track and differ across
//    tracks. Today's daily lives at 10-13 degrees and never flats;
//    tomorrow's is a 17-degree washboard. Same vocabulary,
//    different games.
//  * NET-DOWNHILL LAW: every chunk ends at or below where it began
//    (y-down, so delta >= 0). Uphills exist only INSIDE roller
//    bumps, kicker ramps, and the gap double's launch.
//
// THE WALL SENTINEL is its own tiny strand (`gen.wall`, tagged
// isWall) as of stage 1 (2026-08-17, spec §4): a tall near-vertical
// face just behind the oldest real point, so the melon can't roll
// backwards off the pruned edge of the world. It used to live at
// pts[0], which made the real terrain and the world's edge one
// polyline; slabs need them apart — the wall is physics-only and
// must never render as a ribbon. prune() walks it as it advances.
// ============================================================

(function () {
'use strict';

// Deterministic 32-bit RNG. Do not replace with Math.random — ever.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random in range [lo, hi).
const rr = (rng, lo, hi) => lo + rng() * (hi - lo);
const rrr = (rng, range) => rr(rng, range[0], range[1]);

// ---- THE RECIPE ------------------------------------------------------
// Drawn once per track from a SALTED stream (so recipe drawing can
// never shift the chunk stream). Each field is a sub-range of the
// global envelope: a centre, then a width, clamped inside.
function subRange(r, gLo, gHi, wLo, wHi) {
  const c = rr(r, gLo, gHi);
  const w = rr(r, wLo, wHi) * (gHi - gLo) * 0.5;
  return [Math.max(gLo, c - w), Math.min(gHi, c + w)];
}

function trackRecipe(seed) {
  const r = mulberry32((seed ^ 0x52454350) >>> 0);   // 'RECP'
  // Chunk weights: drawn inside bounds, then normalised. A track can
  // speak with NO flats (rest notes are a dialect choice), and may
  // not speak the gap double at all.
  const w = {
    slope: rr(r, 0.25, 0.50),
    roller: rr(r, 0.15, 0.40),
    flat: rr(r, 0.00, 0.30),
    kicker: rr(r, 0.06, 0.24),
    gap: r() < 0.55 ? rr(r, 0.03, 0.12) : 0,
    // THE SWITCHBACK (stage 3, terrain v4): the first FOLD word.
    // Rare, and not every dialect speaks it — a track that does is
    // a track ABOUT it.
    sw: r() < 0.45 ? rr(r, 0.02, 0.08) : 0,
    // STAGE 5 (terrain v6): the TUNNEL (a roofed run — the first
    // material-above word) and the TRAPDOOR (the first CHOICE fork).
    // Dialect-gated like the sw: a track that speaks them is a track
    // about them.
    tunnel: r() < 0.5 ? rr(r, 0.03, 0.07) : 0,
    trap: r() < 0.5 ? rr(r, 0.03, 0.08) : 0,
  };
  // THE DRAINED GAP (stage 4, terrain v5): a track speaks its gaps
  // WALLED (the stage-2 check-mark) or DRAINED (the pit floor IS the
  // canyon floor, roofed by the landing bridge) — a dialect choice,
  // not a per-chunk coin, because a track is ABOUT its words.
  const gapDrained = r() < 0.5;
  // Every word in the vocabulary belongs in this sum — verify-terrain
  // B holds it to 1, and a word missing here is a word whose drawn
  // weight silently distorts every other's (stage 5: tunnel + trap
  // were briefly outside it).
  const total = w.slope + w.roller + w.flat + w.kicker + w.gap + w.sw
    + w.tunnel + w.trap;
  for (const k of Object.keys(w)) w[k] /= total;

  return {
    gapDrained,
    weights: w,
    // straight descents: this track's grades live in a lane
    slopeLen: subRange(r, 400, 900, 0.3, 0.9),
    slopeGrade: subRange(r, 0.12, 0.35, 0.25, 0.7),
    // flats: the rest note, with the ruled whisper of tilt — always
    // down-or-level (0..0.03) so the net-downhill law is untouched
    flatLen: subRange(r, 250, 550, 0.3, 0.9),
    flatGrade: subRange(r, 0.0, 0.03, 0.3, 1.0),
    // rollers: ONE wavelength per train (the pumpable law); skew
    // leans every bump in a train the same organic way
    rollLen: subRange(r, 280, 560, 0.3, 0.8),
    rollAmp: subRange(r, 40, 95, 0.3, 0.8),
    rollGrade: subRange(r, 0.08, 0.2, 0.3, 0.9),
    rollSkew: subRange(r, 0.35, 0.65, 0.4, 1.0),
    // kickers: the transition is the earning mechanism (see the law
    // at kickerPlan); heat scales how big this dialect jumps
    kickTrans: subRange(r, 60, 240, 0.3, 0.9),
    kickHeat: rr(r, 0.8, 1.25),
    // the gap double: width, and forgiveness — how far the receiver
    // sits BELOW the launch lip. 0 is a same-height precision exam;
    // 70 is a wide-window park jump. A recipe parameter, not a
    // one-time ruling.
    gapLen: subRange(r, 260, 520, 0.3, 0.8),
    gapDrop: subRange(r, 0, 70, 0.3, 1.0),
  };
}

// ---- PLANS -----------------------------------------------------------
// Set-piece primitives decide their numbers in PURE planners the suite
// holds to their laws; the generator only lays points. Every plan
// carries easeRise explicitly so net-downhill is arithmetic, not hope.

// THE KICKER TRANSITION LAW (2026-08-17): the old kicker's flat
// crashed into its ramp at a hard crease, and the crease is what
// capped fair steepness — the melon slammed the angle change. Real
// lips curve into the takeoff. So max ramp grade is EARNED by
// transition length: a long smooth lead-in buys a vicious exit, a
// short one stays mellow. Uniform, honest, no per-kicker fudge.
function kickerMaxGrade(T) {
  // Ceiling retuned 1.35 -> 0.90 (2026-08-17) after the first lap
  // hand-test: a 53-degree launch is smooth at the lip and still
  // unclimbable at low speed — the whole grid parked on one. 0.90
  // (~42 degrees) over a <=260px ramp is clearable WITH momentum,
  // which the placement grammar below now guarantees. Revisit with
  // the death-economy sweep.
  return 0.45 + 0.45 * (T / 240);
}

function kickerPlan(r, rec) {
  const T = rrr(r, rec.kickTrans);
  const grade = Math.min(kickerMaxGrade(T),
    rr(r, 0.45, kickerMaxGrade(T)) * rec.kickHeat);
  const easeRise = 0.5 * grade * T;
  const rampLen = rr(r, 160, 260);
  const rise = grade * rampLen;
  return {
    approach: rr(r, 120, 220),
    T, grade, easeRise, rampLen, rise,
    extraBelow: rr(r, 140, 280),        // the face bottoms out this far
    landLen: rr(r, 420, 700),           //   below the chunk start
    landDy: rr(r, 130, 220),
  };
}

// THE GAP DOUBLE (2026-08-17, a NEW WORD, not a kicker edit): ramp,
// VOID, receiving ramp. A kicker is a step down — the ground always
// catches you, the skill is rotation. A gap is a hole — the skill is
// SPEED JUDGMENT to clear distance. The receiving ramp mirrors the
// launch, so a jump inside the speed window lands with its velocity
// along the slope: the geometry IS the reward, and the damage law
// pays it out with zero new rules.
//
// THE CHECK-MARK PIT (v3, ruled 2026-08-17): the old V was
// survivable-and-inescapable — a melon slowed by traffic dribbled in
// gently, lived, and parked against a ~3.9-grade exit wall (harness
// finding: whole-field parks on ~1/3 of dialects). The V is now a
// CHECK-MARK: a steep ENTRY wall close under the launch lip, a short
// floor, and a long shallow GRIND RAMP up to the receiving lip —
// escapable from a standstill, slowly. Falling short costs the
// climb, not the race.
//
// THE GRIND-GRADE LAW: every exit grade <= G_GRIND. Not tuned —
// DERIVED: the standstill-climbable grade was measured across the
// cast's size envelope (headless bisection rig, worst body = the
// smallest at 0.68 effective scale, measured 0.634; engine scaling's
// s^4 torque vs s^3 load makes bigger bodies slightly BETTER
// climbers, so the runt binds) and G_GRIND is 0.8x that, rounded
// down. Provenance re-measured by verify-grind on every run.
//
// PIT DEPTH IS THE DERIVED QUANTITY: strands are x-monotone until
// folds (stage 3), so the grind ramp must fit INSIDE the lip-to-lip
// span — lip-to-lip clearance (the jumper's exam) is UNCHANGED, and
// depth follows from the grade law and the exit run. Lethality for a
// failed FAST jump lives where it always really did: in the fall
// from the launch lip, judged by the death-economy sweep, not by pit
// depth. The DRAIN ALLEY (the under-ramp strand that rejoins
// downstream) is the stage 4 version of this word.
const G_GRIND = 0.50;
const GAP_ENTRY_F = 0.20;   // steep entry wall's share of the span
const GAP_FLOOR_F = 0.08;   // the floor's share
const GAP_EXIT_F = 0.72;    // the grind ramp's share
function gapPlan(r, rec) {
  const T = rrr(r, rec.kickTrans);
  const grade = rr(r, 0.45, kickerMaxGrade(T));
  const easeRise = 0.5 * grade * T;
  const rampLen = rr(r, 170, 250);
  const rise = grade * rampLen;
  const gapLen = rrr(r, rec.gapLen);
  // Exit grade drawn inside the law; depth follows by arithmetic.
  const exitGrade = rr(r, 0.5, 1.0) * G_GRIND;
  const landLen = rampLen * rr(r, 1.1, 1.5);
  // Drained-dialect draws (always drawn — one recipe stream for both
  // dialects; which one speaks is the track's gapDrained flag):
  const bridgeDy = landLen * rr(r, 0.05, 0.10);  // bridge descends gently
  const ovExt = rr(r, 80, 140);                  // past the ramp to the cap
  const extDy = ovExt * rr(r, 0.02, 0.05);
  const gFloor = rr(r, 0.01, 0.03);              // canyon floor grade
  return {
    approach: rr(r, 120, 200),
    T, grade, easeRise, rampLen, rise,
    gapLen,
    drop: rrr(r, rec.gapDrop),          // receiver below the launch lip
    exitGrade,
    pitBelow: exitGrade * GAP_EXIT_F * gapLen, // DERIVED (grade law, walled)
    landLen,                            // walled: the mirror; drained: the bridge
    landMargin: rr(r, 120, 200),        // net-downhill by at least this (walled)
    bridgeDy, ovExt, extDy, gFloor,
    // THE CLEARANCE LAW, drained form: the canyon floor sits deep
    // enough that headroom under the WHOLE bridge (which descends
    // toward it) is >= SLAB_T + 160 — pitDeep is DERIVED, exactly as
    // pitBelow is in the walled form. The fall from the launch lip
    // (drop + pitDeep >= ~480) is what makes the drained pit lethal
    // to fast failures again; the drain is what makes it stall-proof
    // for slow ones.
    pitDeep: 420 + bridgeDy + extDy + rr(r, 0, 40),
  };
}

// THE SWITCHBACK (stage 3, 2026-08-17 — the first fold word): three
// stacked decks. A climbs gently to a lip; B runs BACKWARD (-x)
// directly beneath it; C runs forward beneath both. Point order
// follows TRAVEL — arc s stays monotone where x does not, which is
// the whole fold thesis.
//
// THE STOP-AND-DROP RULING (settled at build, after two catch
// designs failed their own traversal tests): in this engine —
// gravity holds every rider on top, and a strand's point order is
// its travel order — ANY ridable connector between a forward deck
// and a reversed deck re-launches a forward-driving body off its far
// edge (chutes, berms and hooks all reproved this empirically), and
// near-vertical faces can only move the strand ~tens of px in x. So
// a reversed deck is entered exactly one way: BY BRAKING. The word
// embraces that instead of fighting it:
//  * The fold line is a PRECISION STOP: brake to a crawl (under
//    ~50 px/s), pivot off the lip and down the UNDERCUT face onto
//    B's right end, drive out backward. Tip with speed and the
//    drift carries you past B — onto the express.
//  * THE PRICED SHORTCUT, open on purpose: carry speed off the lip
//    and the arc clears B entirely — a two-clearance fall onto C,
//    near 9 m: survivable at committed flare, lethal at neutral.
//    Physics says yes; the damage law prices it. Cruise-brained bots
//    never brake, so bots RIDE THE EXPRESS and pay its toll — the
//    death-economy sweep is the word's tuning gauge (C2 is the
//    knob).
//  * Deck A runs slightly UPHILL: momentum-grammar arrivals bleed
//    speed, so the stop is biddable and the express is a choice.
//  * CLEARANCE LAW: deck separation >= SLAB_T + 160 headroom
//    everywhere decks overlap; the upper deck's slab BOTTOM is a
//    live ceiling (stage 1), clonkable by design.
//  * Net-downhill by construction: two clearances plus deck grades,
//    minus deck A's small climb.
// THE TUNNEL (stage 5): a roof slab over a stretch of the line.
// Grounded bodies pass untouched (clearance >= 300 against a grounded
// reach of ~220); flight clonks the roof, and arriving AIRBORNE at
// the mouth meets its cap — the word's teeth (gated in the grammar).
// The roof is a ceiling strand: matAbove, unannotated, rendered —
// solid-appearing = solid by construction (Eddie's ruling, stage 5).
function tunnelPlan(r, rec) {
  return {
    approach: rr(r, 100, 200),
    floorLen: rr(r, 500, 1100),
    gIn: rr(r, 0.02, 0.05),          // the floor descends gently inside
    clear: rr(r, 300, 420),          // roof clearance above the floor
    inset: 40,                       // roof edges sit inside the floor span
  };
}

// THE TRAPDOOR (stage 5): the first CHOICE fork — and in a one-axis
// game, choice IS speed. A level deck reaches a MOUTH: clear it (the
// demand prices the far deck — smooth, short, one cap-drop toll at
// its end) or brake and take the chute down to the washboard floor
// (cheap entry, rough run). The near edge is a steep RIDABLE chute
// with a short vertical tail: deliberate brakers slide it
// tangentially and pay almost nothing; failed sends slam. The word
// punishes indecision, not the choice.
function trapPlan(r, rec) {
  const mDrop = rr(r, 55, 75);          // far edge below the near edge
  const demand = rr(r, 1050, 1400);     // px/s to clear the mouth
  const span = demand / Math.sqrt(1200 / mDrop);   // mouth span, DERIVED
  const chuteG = rr(r, 2.0, 2.4);
  const washAmp = rr(r, 18, 36);
  const washWl = rr(r, 260, 420);
  // THE CLEARANCE LAW, trapdoor form: floor depth derived so the
  // washboard's crests clear the far deck's slab bottom.
  const fDrop = 420 + mDrop + washAmp + rr(r, 0, 40);
  const chuteRun = Math.min(span - 60, fDrop / chuteG);
  const chuteRise = chuteRun * chuteG;
  const nWaves = 2 + ((r() * 3) | 0);
  const washSpan = nWaves * washWl;
  // THE DECK SPANS THE WASHBOARD: dkLen stretches so the cap always
  // lands past the floor's rough stretch with margin — the picture
  // is a deck OVER the washboard, and the arithmetic keeps the
  // s-anchor's closing leg positive unconditionally (found by
  // verify-trap B: a drawn-short deck let the washboard overrun the
  // cap and lay a NEGATIVE closing leg).
  const dkLen = Math.max(rr(r, 420, 700),
    chuteRun + 26 + washSpan + 120 - span);
  return {
    approach: rr(r, 120, 200),
    deckLead: rr(r, 160, 260),          // level deck before the mouth
    mDrop, demand, span, chuteG, chuteRun, chuteRise,
    tail: fDrop - chuteRise,            // near-vertical remainder
    fDrop, washAmp, washWl,
    nWaves,
    gFl: rr(r, 0.02, 0.05),             // floor's net descent per wave
    dkLen,
    gDk: rr(r, 0.01, 0.03),
  };
}

// THE SWITCHBACK v2 (stage 5 addendum, ruled by Eddie): the TURNAROUND
// BOWL. v1's fold was verified and unreachable — deck B was enterable
// only by a sub-crawl tip-over (10 px undercut), so every racer ever
// rode the express and nobody in the game's history travelled
// backward. Ballistics cannot reverse a racer; only geometry that
// redirects can, and the honest mechanism is a quarter-pipe: ride up,
// trade speed for height, stall, come back MOVING LEFT. Route:
// deck A -> (fly the cap) -> APRON -> BOWL -> apron backward -> off
// the apron's left edge onto DECK B (the leftward run, 9-16 m) ->
// drop -> DECK C, where a backward lander faces uphill on ordinary
// descending ground and gravity itself turns them around.
//
// Strand decomposition: the PRIMARY runs deck A -> undercut face ->
// deck B (-x, s increasing along travel: the stage-3 fold machinery)
// -> drop -> deck C. The APRON+BOWL are one UNANNOTATED branch strand
// (collide + render, no s — the wall/roof class): progress pauses
// honestly during the turnaround instead of lying. Self-clearing
// twice over: the apron descends leftward (a parked body rolls off
// onto deck B) and deck B descends in travel (a wrong-way lander at
// its right terminus rolls back left). Clearance law twice over.
function switchPlan(r) {
  // v3 (final): the gallery is a POCKET, and a pocket cannot host the
  // track's through-line — four connector placements each extruded a
  // measured 260 px slab wall into a ride corridor, and the v2 shelf
  // ran back through the approach terrain (whole-field park, seed
  // 1013904327). The lawful topology composes three proven patterns:
  // the PRIMARY BYPASSES (mouth -> entry-law chute -> washboard floor
  // under everything: the trapdoor's machinery, so the gallery is a
  // route CHOICE with fork metadata for free), and deck A, apron+bowl,
  // and deck B are BRANCHES in an s-anchor chain. Deck A's length is
  // DERIVED from D so the gallery nests over its own footprint.
  const mDrop = rr(r, 55, 75);
  const demand = rr(r, 1050, 1400);
  const span = demand / Math.sqrt(1200 / mDrop);
  const chuteG = rr(r, 2.0, 2.4);
  const D = rr(r, 900, 1600);          // the gallery: the leftward run
  const u = rr(r, 120, 180);
  const step = 430 + rr(r, 0, 40);     // cap -> apron (clearance law)
  const apronLen = rr(r, 420, 580);
  const gApr = rr(r, 0.03, 0.06);
  const bowlR0 = rr(r, 520, 640);      // raw draw (stream position kept)
  const C1 = 420 + rr(r, 0, 60);       // apron -> deck B
  const C2 = 420 + rr(r, 0, 60);       // deck B -> the floor
  // the bypass pays in roughness — priced for RACERS (~1-2 s at
  // pace), not as a crowd-trap: amp 28-44 at wl 260 made 0.68-grade
  // crests that held a slowed 12-body field at vx 25 for 500 s
  // (seed 334513, whole-field timeout)
  const washAmp = rr(r, 16, 24);
  const washWl = rr(r, 300, 420);
  // deck A's length is DERIVED: deck B's left end must clear the
  // primary chute's FOOT by a full fall corridor — the chute diagonal
  // crossed the gallery's exit and parked the rider AT the lip with
  // dirX flickering between deck (-1) and chute (+1) faces. The
  // worst-case chute run (cap-lift omitted) makes the one-pass
  // derivation strictly conservative: the real chute is shorter.
  const fDrop0 = mDrop + step + u * 0.06 + 480 + D * 0.10 + 480;
  const aLen = D + fDrop0 / chuteG + u + 205 - span + rr(r, 80, 200);
  const gAup = rr(r, 0.02, 0.05);
  const gB = rr(r, 0.05, 0.10);
  const gFl = rr(r, 0.02, 0.05);
  // The curl must stand ABOVE deck A's cap — a flier falls from cap
  // height and never rises, so a face topping the cap catches every
  // entry speed. rise = 1.2418 R, and the floor DERIVES from the
  // cap's REAL height: the fixed 520 floor lost to a long steep
  // derived deck A by 80 px (suite A). No draw is added; the raw
  // bowlR keeps its stream slot.
  const bowlR = Math.max(bowlR0, (step + aLen * gAup + 140) / 1.2418 + 40);
  return {
    mDrop, demand, span, chuteG, D, aLen, u, step, apronLen, gApr,
    bowlR, C1, C2, washAmp, washWl, gAup, gB, gFl,
  };
}

// ---- the generator ---------------------------------------------------
function createTerrainGen(seed, recipeOverride) {
  const gen = {
    seed,
    recipe: recipeOverride || trackRecipe(seed),
    rng: null,
    x: 0,
    y: 0,
    lastKind: '',
    s: 0,                   // cumulative arc at the cursor (stage 3)
    branches: [],           // side strands (stage 4): each an
                            // s-annotated polyline mapped onto the
                            // spine by the S-ANCHOR LAW (see the
                            // drained gap) — physics, projection,
                            // markers and rendering consume them
                            // through the same machinery as the
                            // primary strand, with no special cases
    chunkKind: 'runway',    // the kind currently being laid — every
    pts: [],                // point carries it, so the renderer's
                            // debug colouring can paint the vocabulary

    reset() {
      this.rng = mulberry32(this.seed);
      this.x = -1300;
      this.y = 0;
      this.lastKind = '';
      this.pts.length = 0;
      this.branches.length = 0;
      this.s = 0;
      this.pts.push({ x: this.x, y: this.y, s: 0 });
      // The wall strand: mutated in place so any terrain list holding
      // it stays valid across resets and prunes.
      this.wall[0].x = this.x - 80; this.wall[0].y = this.y - 2600;
      this.wall[1].x = this.x;      this.wall[1].y = this.y;
      this.flat(1900); // runway: the 12 m grid apron + launch straight
    },

    // ---- primitive vocabulary ----
    // Every point carries `s`, its cumulative ARC LENGTH from the
    // generation origin (stage 3: the metric spine reads it — arc is
    // monotone in point order even where x is not, which is what
    // makes folds parameterizable at all). Maintained at the single
    // append point below; the wall strand carries none (never a
    // riding surface).
    push() {
      const prev = this.pts[this.pts.length - 1];
      const dx = this.x - prev.x, dy = this.y - prev.y;
      this.s += Math.sqrt(dx * dx + dy * dy);
      this.pts.push({ x: this.x, y: this.y, k: this.chunkKind, s: this.s });
    },
    flat(len) { this.x += len; this.push(); },
    slope(len, dy) { this.x += len; this.y += dy; this.push(); },
    // leg(dx, dy, mat): the raw primitive folds are spoken with — dx
    // may be NEGATIVE (the strand doubles back). Words that use it
    // own their clearance and net-downhill arithmetic. mat ('R'|'L')
    // tags the segment's START point for the material-side override.
    leg(dx, dy, mat) {
      if (mat) this.pts[this.pts.length - 1].mat = mat;
      this.x += dx; this.y += dy; this.push();
    },
    // Raised-cosine bump on a linearly descending baseline, with a
    // SKEW: the peak sits at fraction p of the length (0.5 =
    // symmetric, the old shape). Both halves are half-cosines, so
    // the slope is continuous through the peak and zero at the ends.
    bump(len, amp, baseDy, p = 0.5, segs = 12) {
      const x0 = this.x, y0 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const h = t <= p
          ? 0.5 * (1 - window.FF.dmath.cos(Math.PI * t / p))
          : 0.5 * (1 + window.FF.dmath.cos(Math.PI * (t - p) / (1 - p)));
        this.x = x0 + len * t;
        this.y = y0 + baseDy * t + amp * h;
        this.push();
      }
      this.x = x0 + len;
      this.y = y0 + baseDy;
    },
    // Quadratic ease from level into a grade over length T: the slope
    // runs 0 -> grade with constant curvature, so the approach meets
    // the ramp with NO CREASE. This is what the kicker law buys its
    // steepness with.
    easeInto(T, grade, segs = 6) {
      const x0 = this.x, y0 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        this.x = x0 + T * t;
        this.y = y0 - 0.5 * grade * T * t * t;
        this.push();
      }
      this.x = x0 + T;
      this.y = y0 - 0.5 * grade * T;
    },

    // Generate chunks until the terrain extends past minX.
    ensure(minX) {
      while (this.x < minX) nextChunk(this);
    },

    // Drop points behind minX and advance the wall strand.
    prune(minX) {
      const pts = this.pts;
      while (pts.length > 2 && pts[1].x < minX) pts.splice(0, 1);
      // Branch strands prune WHOLE (stage 4): a branch is a small
      // finite side structure — it leaves when its rightmost extent
      // is behind the window. Splicing branch interiors would move
      // caps, and caps are collision faces.
      for (let i = this.branches.length - 1; i >= 0; i--) {
        const br = this.branches[i];
        let hi = -Infinity;
        for (const q of br) if (q.x > hi) hi = q.x;
        if (hi < minX) this.branches.splice(i, 1);
      }
      this.wall[0].x = pts[0].x - 80;
      this.wall[0].y = pts[0].y - 2600;
      this.wall[1].x = pts[0].x;
      this.wall[1].y = pts[0].y;
    },
  };
  gen.wall = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  gen.wall.isWall = true; // slab.js: collide it, never render it

  gen.reset();
  return gen;
}

// ---- Chunk vocabulary, spoken in the track's dialect -----------------
// g is any CURSOR carrying {x, y, pts, rng-free}: the streaming
// generator is one, the lap-template builder (tracks.js) is another.
// ONE vocabulary, two consumers — the fork where races quietly ran a
// stale duplicate generator (found 2026-08-17) must never reopen.
function nextChunk(g, rOpt, recOpt) {
  const r = rOpt || g.rng;
  const rec = recOpt || g.recipe;
  const w = rec.weights;
  // Weights arrive NORMALISED from the recipe (sum exactly 1 over the
  // whole vocabulary), so the raw pick against the cumulative chain
  // is the whole mechanism.
  const pick = r();
  let kind;
  if (pick < w.slope) kind = 'slope';
  else if (pick < w.slope + w.roller) kind = 'roller';
  else if (pick < w.slope + w.roller + w.flat) kind = 'flat';
  else if (pick < w.slope + w.roller + w.flat + w.kicker) kind = 'kicker';
  else if (pick < w.slope + w.roller + w.flat + w.kicker + w.gap) kind = 'gap';
  else if (pick < w.slope + w.roller + w.flat + w.kicker + w.gap + w.sw) kind = 'sw';
  else if (pick < w.slope + w.roller + w.flat + w.kicker + w.gap + w.sw + w.tunnel) kind = 'tunnel';
  else kind = 'trap';
  // placement grammar: a rest note never follows a rest note
  if (kind === 'flat' && g.lastKind === 'flat') kind = 'slope';
  // MOMENTUM GRAMMAR (2026-08-17): a set piece (kicker, gap) may only
  // follow a chunk that arrives WITH SPEED — a slope or a roller.
  // After a flat, the runway, another set piece, or the lap builder's
  // corrections, the field could face a launch ramp at walking pace:
  // the first lap hand-test showed twelve melons parked on one. Not a
  // difficulty tweak — a stall on a ramp is a soft-lock.
  if ((kind === 'kicker' || kind === 'gap' || kind === 'sw' || kind === 'trap')
      && g.lastKind !== 'slope' && g.lastKind !== 'roller') {
    kind = 'slope';
  }
  // The tunnel's converse gate: its mouth cap sits at head height, so
  // it may not follow a word that launches the field airborne.
  if (kind === 'tunnel' && (g.lastKind === 'kicker' || g.lastKind === 'gap'
      || g.lastKind === 'sw' || g.lastKind === 'trap')) {
    kind = 'flat';
  }
  // THE LAUNCH LAW (stage 5): the grid dumps twelve bodies at walking
  // pace onto the template's opening metres, and a steep roller train
  // there is a pileup machine — touching pairs pin each other in the
  // troughs faster than any escape behaviour can separate them (seed
  // 1014238739's four-bot park is the type specimen). The vocabulary
  // owes a standing start a launch: the first stretch speaks only
  // slope and flat. Six percent of a lap, and a field at speed rolls
  // straight through it on every lap after the first.
  if (g.x < 2600 && kind !== 'slope' && kind !== 'flat') {
    kind = 'slope';
  }
  g.lastKind = kind;
  g.chunkKind = kind;

  if (kind === 'slope') {
    const len = rrr(r, rec.slopeLen);
    g.slope(len, len * rrr(r, rec.slopeGrade));
  } else if (kind === 'roller') {
    // THE PUMPABLE LAW: one wavelength, one skew, one sign per TRAIN
    // — a rhythm you can find, not four unrelated bumps. Amplitude
    // jitters a little so it breathes.
    const n = 2 + Math.floor(r() * 3);
    const len = rrr(r, rec.rollLen);
    const skew = rrr(r, rec.rollSkew);
    const sign = r() < 0.5 ? -1 : 1;
    const amp0 = rrr(r, rec.rollAmp);
    for (let i = 0; i < n; i++) {
      g.bump(len, sign * amp0 * rr(r, 0.85, 1.15), len * rrr(r, rec.rollGrade), skew);
    }
  } else if (kind === 'flat') {
    // the rest note, with the ruled whisper of tilt
    const len = rrr(r, rec.flatLen);
    g.slope(len, len * rrr(r, rec.flatGrade));
  } else if (kind === 'sw') {
    const p = switchPlan(r);
    g.flat(rr(r, 120, 200));
    g.flat(rr(r, 160, 240));            // the level lip
    const lipX = g.x, lipY = g.y;
    // gallery levels, all derived from the lip
    const aEnY = lipY + p.mDrop;                       // deck A entry
    const capX = lipX + p.span + p.aLen, capY = aEnY - p.aLen * p.gAup;
    const aprY = capY + p.step;
    const aprL = capX - p.u, aprR = aprL + p.apronLen;
    const aprYL = aprY + p.u * p.gApr;
    const bRx = aprL + 15, bY = aprYL + p.C1;
    const bLx = bRx - p.D, bLy = bY + p.D * p.gB;
    const fDrop = (bLy + p.C2) - lipY;                 // floor depth, DERIVED
    // PRIMARY: the bypass. Entry-law chute (full-ridable: fDrop/chuteG
    // fits under deck A, measured), then the washboard floor under
    // the whole gallery, out past the bowl.
    const chuteRun = fDrop / p.chuteG;
    g.leg(chuteRun, fDrop);
    const wl = p.washWl;
    const bowlFar = aprR + window.FF.dmath.sin(104 * Math.PI / 180) * p.bowlR;
    // sExit is captured AT the bLx crossing: back-projecting from the
    // loop's end at the flat-floor rate ignored the washboard's
    // zigzag arc and mis-anchored the exit by 30 px (suite F2).
    let sExit = null;
    const washLeg = (dx, dy) => {
      const x0 = g.x, s0 = g.s;
      g.leg(dx, dy);
      if (sExit === null && x0 <= bLx && g.x > bLx) {
        sExit = s0 + (g.s - s0) * (bLx - x0) / (g.x - x0);
      }
    };
    while (g.x < bowlFar + 320) {
      washLeg(wl * 0.5, -p.washAmp + wl * 0.5 * p.gFl);
      washLeg(wl * 0.5, p.washAmp + wl * 0.5 * p.gFl);
    }
    if (sExit === null) sExit = g.s;
    g.leg(140, 140 * p.gFl);
    // BRANCH: deck B, right to left (dirX -1), exit anchored beneath
    const db = [{ x: bRx, y: bY, k: 'sw' }, { x: bLx, y: bLy, k: 'sw' }];
    const arcB = Math.sqrt((bRx - bLx) * (bRx - bLx) + (bLy - bY) * (bLy - bY));
    db[0].s = sExit - arcB; db[1].s = sExit;
    g.branches.push(db);
    // BRANCH pair: the APRON (right-to-left: dirX -1 drives the
    // turnaround) and the BOWL as its OWN strand laid BASE-TO-TOP —
    // ascending point order puts the slab on the curl's OUTSIDE.
    // Laid top-first, the ny>0 material rule offsets every steep
    // segment INTO the bowl's airspace and the slab-bottom chord
    // crosses the riding pocket (measured: a 30 px body wedged
    // between the face and its own slab for 220 s). Point order IS
    // the material call on a curl; no rule change needed.
    const by0 = aprY - (p.apronLen - p.u) * p.gApr;
    const ap = [
      { x: aprR, y: by0, k: 'sw' },
      { x: capX + 30, y: aprY - 30 * p.gApr, k: 'sw' },
      { x: aprL, y: aprYL, k: 'sw' },
    ];
    let apArc = 0;
    const apCum = [0];
    for (let i = 1; i < ap.length; i++) {
      const dx = ap[i].x - ap[i - 1].x, dy = ap[i].y - ap[i - 1].y;
      apArc += Math.sqrt(dx * dx + dy * dy);
      apCum.push(apArc);
    }
    for (let i = 0; i < ap.length; i++) ap[i].s = (sExit - arcB) - (apArc - apCum[i]);
    g.branches.push(ap);
    // The bowl is a WALL: unannotated (no s), so it never owns
    // projection or direction — a grounded body at the base reads the
    // apron beneath (dirX -1) and the throttle always drives the
    // exit. Annotating it planted a dirX seam at the base that
    // parked half a field (measured: 6/12 stuck at the word).
    const bw = [];
    for (let i = 0; i <= 13; i++) {
      const th = (i / 13) * (104 * Math.PI / 180);
      bw.push({ x: aprR + window.FF.dmath.sin(th) * p.bowlR,
        y: by0 - (1 - window.FF.dmath.cos(th)) * p.bowlR, k: 'sw' });
    }
    g.branches.push(bw);
    // BRANCH: deck A, ridden +x (dirX +1), its cap continuous with the
    // apron's s where fliers land (the point laid at capX + 30)
    const da = [
      { x: lipX + p.span, y: aEnY, k: 'sw' },
      { x: capX, y: capY, k: 'sw' },
    ];
    const arcA = Math.sqrt((capX - da[0].x) * (capX - da[0].x)
      + (capY - aEnY) * (capY - aEnY));
    const sCap = ap[1].s;
    da[0].s = sCap - arcA; da[1].s = sCap;
    da.entry = { kind: 'sw', lipX, lipY, farX: lipX + p.span, demand: p.demand,
      wallX: aprR };
    g.branches.push(da);
  } else if (kind === 'kicker') {  } else if (kind === 'kicker') {
    const p = kickerPlan(r, rec);
    g.flat(p.approach);
    g.easeInto(p.T, p.grade);
    g.slope(p.rampLen, -p.rise);
    // the face: from the lip (easeRise + rise above start) down to
    // extraBelow BELOW the chunk start — net-downhill by arithmetic
    g.slope(12, p.easeRise + p.rise + p.extraBelow);
    g.slope(p.landLen, p.landDy);
  } else if (kind === 'tunnel') {
    const p = tunnelPlan(r, rec);
    g.flat(p.approach);
    const x0 = g.x, y0 = g.y;
    g.slope(p.floorLen, p.floorLen * p.gIn);
    g.flat(90);                       // exit margin before the next word
    // THE ROOF: a ceiling strand — matAbove, no s (it never owns
    // projection, like the wall), rendered (unlike the wall). Its
    // polyline traces the visible under-edge; the slab extends up.
    const roof = [
      { x: x0 + p.inset, y: y0 + p.inset * p.gIn - p.clear, k: 'tunnel' },
      { x: x0 + p.floorLen - p.inset,
        y: y0 + (p.floorLen - p.inset) * p.gIn - p.clear, k: 'tunnel' },
    ];
    roof.matAbove = true;
    g.branches.push(roof);
  } else if (kind === 'trap') {
    const p = trapPlan(r, rec);
    g.flat(p.approach);
    g.flat(p.deckLead);
    const lipX = g.x, lipY = g.y;     // the mouth's near edge
    // the chute: steep but ridable, then the short vertical tail —
    // deliberate brakers slide down tangentially; failed sends slam
    g.leg(p.chuteRun, p.chuteRise);
    g.leg(26, p.tail);
    // the washboard floor: rough, cheap, open to everyone
    const wl = p.washWl;
    for (let i = 0; i < p.nWaves; i++) {
      g.leg(wl * 0.5, -p.washAmp + wl * 0.5 * p.gFl);
      g.leg(wl * 0.5, p.washAmp + wl * 0.5 * p.gFl);
    }
    // run out past the far deck's cap, capturing the S-ANCHOR
    const capX = lipX + p.span + p.dkLen;
    if (g.x < capX + 60) {
      const run1 = capX - g.x;
      g.leg(run1, run1 * p.gFl);
    }
    const sAnchor = g.s;
    g.leg(140, 140 * p.gFl);
    // THE FAR DECK (branch strand): entered by clearing the mouth,
    // exited off its cap — the drain's sibling, priced the opposite
    // way. Its s obeys the S-ANCHOR LAW (stage 4).
    const dp = [
      { x: lipX + p.span, y: lipY + p.mDrop, k: 'trap' },
      { x: capX, y: lipY + p.mDrop + p.dkLen * p.gDk, k: 'trap' },
    ];
    let arc = 0;
    const cums = [0];
    for (let i = 1; i < dp.length; i++) {
      const dx = dp[i].x - dp[i - 1].x, dy = dp[i].y - dp[i - 1].y;
      arc += Math.sqrt(dx * dx + dy * dy);
      cums.push(arc);
    }
    for (let i = 0; i < dp.length; i++) dp[i].s = sAnchor - (arc - cums[i]);
    // FORK METADATA for route-aware brains (stage 5): the entry
    // rides on the strand and survives tiling.
    dp.entry = { kind: 'trap', lipX, lipY, farX: lipX + p.span, demand: p.demand };
    g.branches.push(dp);
  } else {
    const p = gapPlan(r, rec);
    g.flat(p.approach);
    g.easeInto(p.T, p.grade);
    g.slope(p.rampLen, -p.rise);
    if (rec.gapDrained) {
      // THE DRAINED GAP (stage 4, terrain v5) — the first branch
      // word, and the flagship (Eddie's alleyway screenshot, ruled
      // 2026-08-17). The pit floor does not climb back: it IS the
      // track's continuing line — the canyon floor — and the landing
      // ramp becomes a BRIDGE over it, a separate strand entered by
      // flight and exited off its cap.
      //
      // NO CLIMB, BY THEOREM: a floor that rejoined the line
      // tangentially from below would spend its last ~SLAB_T/grade
      // px sealed inside the bridge's slab (the stage-3 wedge,
      // again). So both routes end on the floor: jumpers ride the
      // bridge and drop one clearance off its cap (vn ~1450,
      // flare-able — the toll for the high line); fallers survive
      // or die by fall energy and drive out on the flat. The stall
      // class CANNOT exist here — there is nothing to climb.
      const lipX = g.x, lipY = g.y;
      // the entry wall: steep, deep — drop + pitDeep below the lip
      // THE ENTRY CHUTE (stage 5, by the trapdoor's ruled mechanism):
      // a near-vertical entry wall is a WEDGE — its contact normal
      // holds a crest-parked crawler on the lip forever (seed
      // 1401515656, bot parked at vx 0 on the very crest; the rocker
      // feeds a wedge). An undercut is WORSE: the overhung corner
      // collects a stack of parked bodies (measured: three melons
      // towered in the pocket). The trapdoor already ruled the honest
      // shape: a steep RIDABLE chute (grade ~2.2) with a short
      // vertical tail when cramped. A crawler tips onto a face it
      // can slide; nothing stacks against a forward lean; ballistic
      // entries meet it tangentially or not at all.
      {
        const depth = p.drop + p.pitDeep;
        const chuteRun = Math.min(p.gapLen * 0.5, depth / 2.2);
        g.leg(chuteRun, chuteRun * 2.2);
        const tail = depth - chuteRun * 2.2;
        if (tail > 0.5) g.leg(12, tail);
      }
      // the canyon floor, laid in two pieces so the S-ANCHOR LAW can
      // read the primary arc directly under the bridge's cap:
      const capX = lipX + p.gapLen + p.landLen + p.ovExt;
      const run1 = capX - g.x;
      g.leg(run1, run1 * p.gFloor);
      const sAnchor = g.s;             // primary arc under the cap
      g.leg(140, 140 * p.gFloor);      // ...and out past the bridge
      // THE BRIDGE (branch strand): receiving lip -> landing ramp ->
      // cap. Its points carry SPINE s by the S-ANCHOR LAW: the cap's
      // s equals the primary arc directly beneath it, unit arc rate
      // backwards from there — so progress is continuous at the
      // drop-off, and the flight from the launch lip onto the bridge
      // is a priced skip, exactly like the switchback express.
      const bp = [
        { x: lipX + p.gapLen, y: lipY + p.drop, k: 'gap' },
        { x: lipX + p.gapLen + p.landLen, y: lipY + p.drop + p.bridgeDy, k: 'gap' },
        { x: capX, y: lipY + p.drop + p.bridgeDy + p.extDy, k: 'gap' },
      ];
      let arc = 0;
      const cums = [0];
      for (let i = 1; i < bp.length; i++) {
        const dx = bp[i].x - bp[i - 1].x, dy = bp[i].y - bp[i - 1].y;
        arc += Math.sqrt(dx * dx + dy * dy);
        cums.push(arc);
      }
      for (let i = 0; i < bp.length; i++) bp[i].s = sAnchor - (arc - cums[i]);
      g.branches.push(bp);
    } else {
      // launch lip: easeRise + rise above chunk start. The CHECK-MARK
      // (v3): a steep entry wall down to the floor (drop + pitBelow
      // under the lip), a short floor, then the GRIND RAMP up to the
      // receiving lip exactly `drop` below the launch lip. Same
      // endpoints as the old V — the closing arithmetic is untouched.
      g.slope(p.gapLen * GAP_ENTRY_F, p.drop + p.pitBelow);
      g.slope(p.gapLen * GAP_FLOOR_F, 0);
      g.slope(p.gapLen * GAP_EXIT_F, -p.pitBelow);
      // the mirror: descends past the start line so the chunk nets down
      g.slope(p.landLen, (p.easeRise + p.rise - p.drop) + p.landMargin);
    }
  }
}

window.FF = window.FF || {};
// terrainYAt DIED IN STAGE 2 (2026-08-17): "the ground under world x"
// has exactly one answer only while strands are x-monotone, and folds
// (stage 3) end that. Surface questions go to the SPINE now —
// state.spine.surfaceAt(s) — whose degenerate implementation carries
// the old arithmetic verbatim (strand.js; parity held by
// verify-spine-parity). Deleted rather than deprecated: a helper that
// still exists is a helper someone will call.

// First segment index whose END could reach xLo (points are x-sorted).
// Callers scan forward from here and stop when segment start > xHi —
// turns O(n) terrain scans into O(log n + k).
function segStartIndex(poly, xLo) {
  let lo = 0, hi = poly.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poly[mid + 1].x < xLo) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

window.FF.segStartIndex = segStartIndex;
window.FF.createTerrainGen = createTerrainGen;
window.FF.mulberry32 = mulberry32;
// The pure parts, exported so the suite holds the laws to themselves
// rather than doing geometry archaeology on point lists.
// makeCursor: the primitive vocabulary without the streaming shell —
// same push/flat/slope/bump/easeInto the generator uses, on a bare
// point list, so the lap-template builder lays IDENTICAL geometry.
function makeCursor(x0, y0) {
  const c = {
    x: x0, y: y0, s: 0, lastKind: '', chunkKind: 'runway',
    branches: [],
    pts: [{ x: x0, y: y0, k: 'runway', s: 0 }],
    push() {
      const prev = this.pts[this.pts.length - 1];
      const dx = this.x - prev.x, dy = this.y - prev.y;
      this.s += Math.sqrt(dx * dx + dy * dy);
      this.pts.push({ x: this.x, y: this.y, k: this.chunkKind, s: this.s });
    },
    flat(len) { this.x += len; this.push(); },
    slope(len, dy) { this.x += len; this.y += dy; this.push(); },
    leg(dx, dy, mat) {
      if (mat) this.pts[this.pts.length - 1].mat = mat;
      this.x += dx; this.y += dy; this.push();
    },
    bump(len, amp, baseDy, p = 0.5, segs = 12) {
      const x1 = this.x, y1 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t2 = i / segs;
        const h = t2 <= p
          ? 0.5 * (1 - window.FF.dmath.cos(Math.PI * t2 / p))
          : 0.5 * (1 + window.FF.dmath.cos(Math.PI * (t2 - p) / (1 - p)));
        this.x = x1 + len * t2;
        this.y = y1 + baseDy * t2 + amp * h;
        this.push();
      }
      this.x = x1 + len;
      this.y = y1 + baseDy;
    },
    easeInto(T, grade, segs = 6) {
      const x1 = this.x, y1 = this.y;
      for (let i = 1; i <= segs; i++) {
        const t2 = i / segs;
        this.x = x1 + T * t2;
        this.y = y1 - 0.5 * grade * T * t2 * t2;
        this.push();
      }
      this.x = x1 + T;
      this.y = y1 - 0.5 * grade * T;
    },
  };
  return c;
}

window.FF.terrainLaws = { trackRecipe, kickerPlan, gapPlan, switchPlan, tunnelPlan, trapPlan, kickerMaxGrade,
  subRange, speakChunk: nextChunk, makeCursor, G_GRIND,
  GAP_ENTRY_F, GAP_FLOOR_F, GAP_EXIT_F };

})();
