// ============================================================
// FRUITS — the species registry. AESTHETICS ONLY, by design:
// physics fields are deliberately absent from this schema, so every
// fruit obeys the same tournament-tuned material laws (config.js) and
// the 144-race win-rate balance carries over BY CONSTRUCTION. When a
// fruit someday earns different materials, that becomes an explicit
// amendment to the laws — never a quiet per-species stat.
//
// Palettes are L*-normalized into [54, 74] (same solver as the
// greens), so the constant-contrast highlight and nameplate
// guarantees hold for every species automatically.
// ============================================================

(function () {
'use strict';

const FRUITS = {
  watermelon: {
    sizeMult: 1.0, // the reference fruit
    // Eleven greens (L* 54-74). The player's sacred #00ff00 lives in
    // PLAYER_PALETTE, outside the species table.
    bots: [
      '#90c710', '#6bb31a', '#56c516', '#37a01c', '#1bc01b', '#24a93f',
      '#17ce54', '#25965a', '#20b378', '#22a07e', '#608e24',
    ],
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
    // Eleven muted tans/creams/yellows (hues 38-56, L* 54-74).
    bots: [
      '#d4b16c', '#c39b2e', '#c4ad4f', '#9b8c29', '#c4a163', '#b18f1f',
      '#c3b539', '#9b8042', '#b59d26', '#979132', '#a57a29',
    ],
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
    // Eleven BRIGHT sunny yellows (hues 50-57, saturated, L* raised
    // to 64-80 — honeydews are the luminous ones on the shelf).
    bots: [
      '#e3c609', '#cab70d', '#e1bf12', '#b3a914', '#d9ba0b', '#c0b005',
      '#dcc516', '#a69f18', '#ccb30d', '#b1a60e', '#af9f16',
    ],
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
    bots: [
      '#f6f4ee', '#f2f0e8', '#fbf9f4', '#eeece4', '#f8f6f0', '#f4f1ea',
      '#fdfbf7', '#eae7de', '#f7f5ef', '#f1eee6', '#faf8f3',
    ],
    // The spots are a genuinely different MATERIAL from the shell —
    // pigment, not a lighting response of white — so this is the one
    // per-species colour fact: the pattern anchor swings hue hard and
    // saturates off a base that barely has a hue of its own. The
    // lighting law itself stays global: shell and spots both shade
    // under the shared curve (the near-white shell expresses it almost
    // entirely through dL*, which is correct — hue moves are invisible
    // at zero saturation, not compensated for).
    patternOffset: { dL: -12, dH: 100, dS: 78 },
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
    // Eleven near-black charcoals (L* ~10, whisper of hue variance).
    // The law reads them honestly: shadow band vanishes into the body,
    // highlight lifts to a dark-gray sheen — a billiard ball's polish.
    bots: [
      '#1c1d20', '#191a1c', '#202124', '#17181a', '#1e1f22', '#1a1b1e',
      '#222326', '#16171a', '#1d1e21', '#18191b', '#212225',
    ],
    // The number disc: pattern anchor driven to white off the black
    // base purely by lightness — black has no hue or sat to shift.
    patternOffset: { dL: 80, dH: 0, dS: 0 },
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
    // PRE-COMPENSATED anchors (the dragon-ball lesson, applied at
    // birth): the seeded colour is the pigment BEFORE the sun. The law
    // rotates hue -25 and desaturates at its base slot, so these
    // hyper-greens RACE as bright felt GREEN (retargeted greener per
    // Eddie 2026-08-10, away from fluorescent yellow; numerically
    // inverted through the real offsetColor, hue- and L*-true). The
    // vivid saturation keeps it cleanly apart from the melons' muted
    // olives despite the shared hue family.
    bots: [
      '#12e600', '#0de000', '#14eb00', '#0adb00', '#10e600', '#12eb00',
      '#0cdb00', '#16f500', '#0ee000', '#0fe600', '#0bdb00',
    ],
    // The seam: BETWEEN the felt green and white (Eddie 2026-08-10) —
    // a modest lift and gentle desaturation, so it derives to a pale
    // green (~#ceeeb1 on the reference anchor) rather than pure white.
    patternOffset: { dL: 14, dH: 0, dS: -12 },
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
    // PRE-COMPENSATED anchors, like the melon greens: the global law's
    // base slot rotates hue -25 and desaturates -47, so the seeded
    // colour is the PIGMENT BEFORE THE SUN, not the on-track look —
    // the melons' vivid greens race as muted olives, and these vivid
    // yellow-ambers race as muted ambers (numerically inverted through
    // the real offsetColor against the old on-track orange, hue- and
    // L*-true; the old vivid saturation is outside the law's image, so
    // the ball now sits in the same muted register as everyone —
    // which is the point of one law).
    bots: [
      '#bdb100', '#b3a900', '#c2b700', '#ada400', '#c2b600', '#b8ad00',
      '#c7bc00', '#aca300', '#bcb000', '#b8ae00', '#c7b500',
    ],
    // The star is the second material: its red is the pattern anchor —
    // hue rotated off the base rather than hard-coded, so every shade
    // of ball still derives its own star. Shading of both shell and
    // star follows the global law. (Re-solved against the new anchors.)
    patternOffset: { dL: -11, dH: -28, dS: 30 },
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