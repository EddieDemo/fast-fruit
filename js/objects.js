// ============================================================
// OBJECTS — the species registry. AESTHETICS ONLY, by design:
// physics fields are deliberately absent from this schema, so every
// fruit obeys the same tournament-tuned material laws (config.js) and
// the 144-race win-rate balance carries over BY CONSTRUCTION. When a
// fruit someday earns different materials, that becomes an explicit
// amendment to the laws — never a quiet per-species stat.
//
// Colour is a LAW, not a list (2026-08-10): each species declares an
// anchorBand — seeded H/S/L ranges in pre-sun pigment space — and
// every individual derives its own anchor continuously from its seed
// (shading.js anchorColor). The bands are the measured envelopes of
// the old hand-picked eleven-shade lists, widened 15%, so the
// families are calibrated by the shades that shipped.
// ============================================================

(function () {
'use strict';

const OBJECTS = {
  watermelon: {
    sizeMult: 1.0, // the reference fruit
    anchorBand: { h: [71.6, 170.2], s: [0.576, 0.87], l: [0.342, 0.457] },
    // the wide melon-green family: eleven hand-picked greens became
    // the measured envelope, widened 15%. Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    fleshBand: { h: [14.9, 22.1], s: [1, 1], l: [0.44, 0.6] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#ff4757',      // chunks
      fleshLight: '#ff6b7d', // fine spray
      seed: '#222222',       // black pips
      rindK: 0.72,           // rind tint = darken(body, k)
      slabK: 0.52,
    },
    pattern: 'stripes',      // dark meridian bands (renderer)
  },

  cantaloupe: {
    // Indicative, not accurate (cartoon license): real cantaloupes are
    // ~54% linear scale of a watermelon; 0.8 keeps the ORDERING
    // emphatic while every fruit still reads as a racer. Mass follows
    // the law from total scale: 0.8^3 = 0.51x at the same roll.
    sizeMult: 0.8,
    anchorBand: { h: [37.0, 57.8], s: [0.38, 0.724], l: [0.366, 0.646] },
    // muted tans, creams and yellows. Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    fleshBand: { h: [50.7, 56.5], s: [1, 1], l: [0.329, 0.399] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#ff9438',      // orange flesh: forensic wreckage identity
      fleshLight: '#ffb066',
      seed: '#f2e4c0',       // pale cream seeds, per the real fruit
      rindK: 0.72,
      slabK: 0.52,
    },
    pattern: 'net',          // light raised netting + latitude rings + mottle
  },

  honeydew: {
    sizeMult: 0.9, // between the melon and the cantaloupe, as in life
    anchorBand: { h: [49.6, 57.6], s: [0.732, 0.964], l: [0.365, 0.484] },
    // the bright sunny yellows. Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    fleshBand: { h: [106.4, 114.5], s: [0.885, 0.978], l: [0.556, 0.74] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#b8e086',      // pale green flesh: the third forensic color
      fleshLight: '#d2eda9',
      seed: '#f0e6c8',       // cream seeds
      rindK: 0.72,
      slabK: 0.52,
    },
    pattern: 'crackle',      // hairline vein web + pores + whisper streaks
  },

  // ---- MISC: not a fruit at all ----
  // The registry's schema was already species-shaped; this entry shows
  // it generalizes. `aspect` (b/a) is new: melons inherit the CONFIG
  // ellipse, this one is a perfect sphere. `patternOffset` is the one
  // per-species colour fact — the pattern-anchor derivation (shading.js)
  // — because the default stripe offset can't turn orange into a red
  // star. The lighting CURVE is never per-species.
  // A Yoshi egg: white shell, green spots. Eggs are stubbier than
  // melons but not spherical, so it declares its own aspect. Sized to
  // sit between the ball and the melons.
  yoshiEgg: {
    misc: true,
    // SHAPE RE-RULED 2026-08-30 (Eddie), measured against two of his
    // reference eggs: a photographed egg fit our boundary family at
    // aspect 0.771 / taper 0.16 (1.9 px rms over 915 silhouette
    // rows) and an emoji-style egg at 0.804 / 0.08 (0.8%). The old
    // 0.86 / 0.26 had it backwards — too round overall, too pinched
    // at the tip ("lumpy ball with a dent"). Eddie picked the split:
    // egg-true silhouette with a visible waddle. Taper stays a
    // one-number nudge if device wobble isn't to taste.
    aspect: 0.78,        // real eggs are ~0.77-0.80 wide-to-long
    taper: 0.14,         // gentle: the tip narrows, it does not pinch
    // SIZE + MASS RULED 2026-08-30 (Eddie), for the egg PROP and the
    // Egg Race party game it feeds: ball-sized, "knockable but fairly
    // heavy — slightly unwieldy for 3 melons, still manageable".
    // sizeMult 2.0 puts the egg at 184 x 144 px: the same length as
    // the beach ball's diameter, sitting lower.
    sizeMult: 2.0,
    // Density MEASURED, not guessed (push rig, melons at full
    // throttle on the flat, 6 s, at THIS size). There is a THRESHOLD
    // between 3 and 3.5 melon masses: at 3 one melon shoves the egg
    // down the track alone (1895 px solo); at 3.5 and above a lone
    // melon can only nudge it (69 px) while three still move it
    // briskly (3033 px). 0.564 lands 4.5 masses — clear of the
    // threshold, three melons make ~430 px/s, about half racing
    // pace: an escort that has to commit.
    //
    // RETRACTION on record: the first conversion wrote 0.828 and
    // landed 6.61 masses. The measuring rig passed 2.0 as a scale
    // ARGUMENT on top of the then-registry 0.88, so it measured an
    // egg at effective size 1.76 and the density was solved off that
    // baseline; the earlier "~8 melon masses" estimate quoted to
    // Eddie was right and the "5.44" measurement was the wrong one.
    // The mass TABLE survived (it set masses directly) and was
    // re-run at true size — which moved the threshold from ~4 to
    // ~3.25, since a bigger egg presents a taller face to climb.
    //
    // NOTE: ~150x the light box and ~43x the beach ball. The egg
    // bulldozes scenery, which suits its size.
    density: 0.564,
    anchorBand: { h: [39.4, 48.6], s: [0.194, 0.628], l: [0.888, 0.987] },
    // near-white shells (the high HSL saturation is an artifact of
    // near-white lightness; chroma stays tiny). Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    // The spots are a genuinely different MATERIAL from the shell —
    // pigment, not a lighting response of white — so this is the one
    // per-species colour fact: the pattern anchor swings hue hard and
    // saturates off a base that barely has a hue of its own. The
    // lighting law itself stays global: shell and spots both shade
    // under the shared curve (the near-white shell expresses it almost
    // entirely through dL*, which is correct — hue moves are invisible
    // at zero saturation, not compensated for).
    patternOffset: { dL: -12, dH: 100, dS: 78 },
    fleshBand: { h: [110.1, 118.7], s: [0.951, 1], l: [0.379, 0.666] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#8fd94a',      // yolk-green splatter
      fleshLight: '#c3ee92',
      seed: '#ffffff',       // shell fragments
      rindK: 0.86,
      slabK: 0.7,
    },
    pattern: 'spots',      // seeded rounded blobs, a few large
  },

  // ---- BOULDER (ruled by Eddie 2026-08-30) -------------------------
  // Fragments of the terrain itself, in the lore — which is why the
  // colour comes off the GROUND kit rather than a palette of its own
  // (phase 3 will make that literal; the anchor band below is a
  // placeholder neutral so the body is visible before that ruling).
  //
  // SHAPE IS PER INSTANCE, not per species: `hullGen` tells
  // derivePhysique to grow vertices from the body's own hullSeed
  // (state.js boulderHull), so no two boulders on a track are alike.
  // R 65 gives ~130 px across, Eddie's ruling: between the melon (92)
  // and the egg (184). 6-8 sides, also his.
  boulder: {
    misc: true,          // scenery, not produce
    shape: 'poly',
    hullGen: { R: 65, sidesMin: 6, sidesMax: 8 },
    // A fixed fallback hull, used only if a body reaches the registry
    // with no hullSeed. Deliberately a plain hexagon: if one ever
    // appears on a track it should look WRONG, not plausibly minted.
    poly: [[65, 0], [32, 56], [-32, 56], [-65, 0], [-32, -56], [32, -56]],
    sizeMult: 1,
    // THE HEAVIEST PROP IN THE GAME (Eddie's ruling), measured in the
    // phase-2 rig rather than guessed. Tippable is a SHAPE property,
    // not a mass one: a boulder resting on a small face is unsteady
    // whatever it weighs.
    //
    // DO NOT LOWER THIS TO IMPROVE A BALANCE SWEEP. The 2026-08-30
    // sweep showed boulders costing 21 of 144 finishes; Eddie ruled
    // that a BOT problem, not a boulder problem — a player hops
    // around them and bots cannot yet. Lightening was measured
    // (density 0.22) and is explicitly NOT wanted. See handover
    // addendum 16 before touching this number.
    density: 1.0,
    toughnessMult: 0,    // INDESTRUCTIBLE for now (Eddie's ruling)
    // STONE (Eddie, 2026-08-30): the boulder wears THE GROUND'S OWN
    // TONE and is lit by the same band law as every other body —
    // "why can't it just be the same colour as the ground and be lit
    // the way the ground and melons are lit? That would be most
    // consistent." It is, and it means a rock re-tints with its
    // stage for free. An explicit flag, not inferred from hullGen
    // (Law 1). The anchorBand below is therefore unused for pigment
    // and kept only so any code path that asks a species for a band
    // gets a sane neutral rather than undefined.
    stone: true,
    anchorBand: { h: [200, 220], s: [0.02, 0.06], l: [0.34, 0.46] },
  },
  // ---- THE BOULDER SIZE LADDER (added 2026-08-30 for future use) ---
  // Eddie approved every size on the ladder mockup. They are SPECIES
  // only: none of them has a kind entry in config.furniture, so none
  // is minted and BOTH GATES STAY BYTE-IDENTICAL. Each gets its own
  // mint ruling (count, spacing, sites) when he wants it on a track.
  //
  // `boulder` above is the LARGEST class (R 65 / 130 px) and keeps
  // its plain name because it is minted and referenced by the config
  // kind, the suites and the mutation table; renaming it to fit a
  // ladder would be a rename dressed as a refactor.
  //
  // One density for all of them, deliberately: it is the same stone.
  // Mass falls with VOLUME, so the ladder spans an immovable wall
  // down to something a melon punts aside without a single tuning
  // number — measured masses are in the phase-5 handover addendum.
  boulderBig: {
    misc: true,
    shape: 'poly',
    hullGen: { R: 50, sidesMin: 6, sidesMax: 8 },
    poly: [[50, 0], [25, 43], [-25, 43], [-50, 0], [-25, -43], [25, -43]],
    sizeMult: 1,
    density: 1.0,
    toughnessMult: 0,
    stone: true,          // a shade shorter than the flagship; still taller than a melon
    anchorBand: { h: [200, 220], s: [0.02, 0.06], l: [0.34, 0.46] },
  },
  boulderMid: {
    misc: true,
    shape: 'poly',
    hullGen: { R: 38, sidesMin: 6, sidesMax: 8 },
    poly: [[38, 0], [19, 33], [-19, 33], [-38, 0], [-19, -33], [19, -33]],
    sizeMult: 1,
    density: 1.0,
    toughnessMult: 0,
    stone: true,          // about melon height — the ride-over threshold
    anchorBand: { h: [200, 220], s: [0.02, 0.06], l: [0.34, 0.46] },
  },
  boulderSmall: {
    misc: true,
    shape: 'poly',
    hullGen: { R: 28, sidesMin: 6, sidesMax: 8 },
    poly: [[28, 0], [14, 24], [-14, 24], [-28, 0], [-14, -24], [14, -24]],
    sizeMult: 1,
    density: 1.0,
    toughnessMult: 0,
    stone: true,          // clearly ride-over-able; a jolt, not a wall
    anchorBand: { h: [200, 220], s: [0.02, 0.06], l: [0.34, 0.46] },
  },
  pebble: {
    misc: true,
    shape: 'poly',
    hullGen: { R: 20, sidesMin: 6, sidesMax: 8 },
    poly: [[20, 0], [10, 17], [-10, 17], [-20, 0], [-10, -17], [10, -17]],
    sizeMult: 1,
    density: 1.0,
    toughnessMult: 0,
    stone: true,          // texture
    anchorBand: { h: [200, 220], s: [0.02, 0.06], l: [0.34, 0.46] },
  },
  gravel: {
    misc: true,
    shape: 'poly',
    hullGen: { R: 14, sidesMin: 6, sidesMax: 8 },
    poly: [[14, 0], [7, 12], [-7, 12], [-14, 0], [-7, -12], [7, -12]],
    sizeMult: 1,
    density: 1.0,
    toughnessMult: 0,
    stone: true,          // the smallest measured class
    anchorBand: { h: [200, 220], s: [0.02, 0.06], l: [0.34, 0.46] },
  },
  beachball: {
    misc: true,          // seaside equipment, not produce
    // THE ANNEX'S FIRST FULL CUSTOMER (ruled 2026-08-26): a sphere
    // 4x melon scale at INTRINSIC density 0.008 (relative to melon =
    // roughly water; a real beach ball is ~0.002-0.005 of water, so
    // this is physically plausible). Net mass ~= half a melon
    // despite 64x the volume — a melon can genuinely launch it.
    aspect: 1.0,         // perfect sphere: the collider family's home turf
    sizeMult: 2.0,       // ruled 2026-08-27 after the scale graphics:
                         // the TOY (1.84 m, 0.10 melon masses — a
                         // melon launches it). Other sizes may join
                         // later; density is intrinsic and ready.
    density: 0.008,      // intrinsic; a melon-sized ball is a wisp, by law
    restitutionFloor: 0.6, // bouncy by NATURE: flare adds, never removes
    toughnessMult: 0,    // INDESTRUCTIBLE for now (ruled): the dial at
                         // zero — impulses and breadcrumbs fully live,
                         // only the damage ledger is deaf. Un-zero to
                         // make it poppable later.
    anchorBand: { h: [4.5, 12.0], s: [0.68, 0.82], l: [0.46, 0.55] },
    // classic beach red-orange; individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the RED. The centre gore is the OTHER mechanism:
    patternPigment: 'WHITE',
    // an ABSOLUTE second material (ruled 2026-08-27) — the canonical
    // white as the pattern anchor into the same lighting law, never
    // an offset off the seeded red (which would mint a different
    // "white" per ball: the trace class, again).
  },

  cardboardBox: {
    misc: true,          // league-issue course furniture, not produce
    // THE FIRST POLYGON (ruled 2026-08-27, built 2026-08-28). A true
    // convex hull rather than a rounded approximation, explicitly
    // because a FAMILY of rectangles is coming — crates, pallets,
    // stacks — and rounding stops being cosmetic the moment two of
    // them meet, or one meets an authored edge.
    shape: 'poly',       // EXPLICIT tag; never inferred from fields
    poly: [[-50, -50], [50, -50], [50, 50], [-50, 50]],   // 1 m x 1 m, px
    sizeMult: 1.0,       // semiMajor is 46, so a 50 px half-extent is 1.0 m
    // Density RE-RULED 2026-08-30 (Eddie): a box should only
    // MARGINALLY slow a melon that hits it, and get sent flying —
    // not bouncier (cardboard thuds), LIGHTER. Measured at full
    // throttle, time lost passing a head-on box: the old 0.240
    // melon masses cost 0.12 s and left the melon at 71% speed;
    // 0.030 masses (this value) costs 0.01-0.02 s and leaves 91%,
    // with the box still knocked ~400 px. NOTE, superseding the
    // 2026-08-28 note below: this makes the box LIGHTER than the
    // beach ball (0.080) — an empty cardboard box is light; the
    // old intent lost to the new feel ruling.
    // (2026-08-28, historical: prism volume law makes a 1 m box
    // 4.0045 melon volumes; 0.06 was 0.240 melon masses.)
    density: 0.0075,
    restitutionFloor: 0.08,  // cardboard thuds; flare adds, never removes
    toughnessMult: 0,    // INDESTRUCTIBLE for v1 (ruled), like the ball:
                         // impulses and breadcrumbs fully live, only the
                         // damage ledger is deaf. Un-zero to make it
                         // crushable later.
    anchorBand: { h: [50, 60], s: [0.56, 0.68], l: [0.31, 0.39] },
    // Kraft cardboard, SOLVED PRE-SUN (2026-08-28). The first cut used
    // h 28-36 / s 0.35-0.50 / l 0.42-0.52 — the brown you would pick
    // if you were choosing the FINAL colour, copied straight out of
    // the design doc. The registry declares pigment BEFORE the
    // lighting law, and that band came out a dusty mauve (#ac8683):
    // exactly the failure this file's watermelon-flesh note describes,
    // where authoring in final-colour space turned red into hot pink.
    // Solved numerically instead, so the base slot lands on #aa7c4e
    // against an authored intent of #a87c4e — 2/255 off.
  },

  eightBall: {
    misc: true,          // billiards, not produce
    aspect: 1.0,         // perfect sphere: shares the dragon ball's
    // entire physics character (no tips, sharpness penalty always 1,
    // essentially unsmashable) — one sphere pace-curve serves every
    // sphere species, so sizes are picked off the same sweep.
    sizeMult: 0.80,      // Eddie's call 2026-08-10: the sphere trio
    // races at ONE size, matching the dragon ball. Sweep context
    // (6 seeds x 60s): spheres at 0.80 run ~635-795m vs melons ~550m —
    // the unsmashable class is also the fast class. A deliberate
    // character, not an accident; re-sweep the trio together if the
    // phone says otherwise.
    anchorBand: { h: [219.6, 225.4], s: [0.053, 0.085], l: [0.091, 0.145] },
    // near-black charcoals, faint cool tint. Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    // The number disc: pattern anchor driven to white off the black
    // base purely by lightness — black has no hue or sat to shift.
    patternPigment: 'WHITE',  // converted 2026-08-27: the disc was
                              // offset-driven (dL 80 off the seeded
                              // charcoal), so every eight ball wore
                              // a slightly different white. Now the
                              // one canonical pigment, lit the same.
    fleshBand: { h: [244.2, 249.7], s: [0.264, 0.356], l: [0.191, 0.359] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#2a2b2e',      // phenolic resin shards
      fleshLight: '#4a4b4f',
      seed: '#f2f2f2',       // fragments of the white disc
      rindK: 0.72,
      slabK: 0.52,
    },
    pattern: 'eightBall',  // white disc, the 8 punched through to base
  },

  tennisBall: {
    misc: true,          // sporting goods, not produce
    aspect: 1.0,         // perfect sphere (same sweep as above)
    sizeMult: 0.80,      // Eddie's call 2026-08-10: one size for the
    // sphere trio (see eightBall's note for the sweep context).
    anchorBand: { h: [114.4, 117.5], s: [1, 1], l: [0.426, 0.484] },
    // the PRE-COMPENSATED hyper-greens that race as felt green. Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    // The seam: BETWEEN the felt green and white (Eddie 2026-08-10) —
    // a modest lift and gentle desaturation, so it derives to a pale
    // green (~#ceeeb1 on the reference anchor) rather than pure white.
    patternOffset: { dL: 14, dH: 0, dS: -12 },
    fleshBand: { h: [88.7, 94.6], s: [1, 1], l: [0.656, 0.833] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#e8f2a0',      // felt fuzz
      fleshLight: '#f4f9c8',
      seed: '#2f3a35',       // dark rubber core bits
      rindK: 0.72,
      slabK: 0.52,
    },
    pattern: 'seam',       // the classic face-on U seam decal
  },

  dragonBall: {
    misc: true,          // not produce: excluded from fruit-flavoured copy
    aspect: 1.0,         // perfectly round
    // Tuned against watermelons (10-race headless sweep): a sphere has
    // NO tips, so the sharpness penalty is always 1 and it essentially
    // cannot smash — measured 0 deaths/race at every size. It pays for
    // that in pace, so the size is set where the two roughly meet:
    // 0.62 -> 228m, 0.80 -> 274m, 0.85 -> 373m, 1.00 -> 369m against a
    // ~332m watermelon baseline. 0.80 keeps it a touch behind the pack,
    // which is the honest price of being unkillable.
    sizeMult: 0.80,
    anchorBand: { h: [54.4, 57.1], s: [1, 1], l: [0.333, 0.394] },
    // the PRE-COMPENSATED vivid yellows that race as amber-orange. Individuals derive their anchor
    // continuously from this band (shading.js anchorColor): the seed
    // owns the pigment.
    // The star is the second material: its red is the pattern anchor —
    // hue rotated off the base rather than hard-coded, so every shade
    // of ball still derives its own star. Shading of both shell and
    // star follows the global law. (Re-solved against the new anchors.)
    patternOffset: { dL: -11, dH: -28, dS: 30 },
    fleshBand: { h: [58, 63.7], s: [1, 1], l: [0.271, 0.475] },
    // The INTERIOR's anchor band — same law as the shell's
    // anchorBand, so an individual's flesh derives from its own seed
    // too. PRE-SUN, like the pre-compensated species: these values
    // were SOLVED numerically so that after the lighting law the
    // flesh lands on the authored intent (the law rotates hue ~22
    // degrees, which turned watermelon red into hot pink when the
    // band was authored in final-colour space). Biased darker and
    // slightly richer than the authored pair: an interior surface is
    // self-shadowed, which the law cannot know unless the pigment
    // says so.
    pulp: {
      flesh: '#ffb03a',      // glassy amber shards
      fleshLight: '#ffd08a',
      seed: '#d32f2f',       // fragments of the star
      rindK: 0.72,
      slabK: 0.52,
    },
    pattern: 'star',       // a single four-pointed star, centred
  },
};

window.FF = window.FF || {};
window.FF.OBJECTS = OBJECTS;

})();