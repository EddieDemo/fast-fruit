// ============================================================
// FRUITS — the species registry. AESTHETICS ONLY, by design:
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

const FRUITS = {
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
    aspect: 0.86,        // egg-round: stubbier than a melon, not a sphere
    taper: 0.26,         // ASYMMETRIC: one end pointier, as a real egg
    sizeMult: 0.88,
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
    patternOffset: { dL: 80, dH: 0, dS: 0 },
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
window.FF.FRUITS = FRUITS;

})();