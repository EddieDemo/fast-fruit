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
  // ellipse, this one is a perfect sphere. `ramp` is an optional
  // per-species palette override, used here because the shared curve
  // can't turn an orange base into a red star.
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
    // The shell is near-white, so the shared curve (which works by
    // darkening and desaturating a coloured base) has nothing to grip.
    // Its own ramp keeps the shell bright and drives the SPOTS green
    // through ramp B: a big hue swing plus saturation, off a base that
    // barely has a hue of its own.
    ramp: {
      rampLoDL: -16, rampLoDH: 0,   rampLoDS: -25,
      rampHiDL: 6,   rampHiDH: 0,   rampHiDS: -30,
      rampBDL: -12,  rampBDH: 100, rampBDS: 78,
    },
    pulp: {
      flesh: '#8fd94a',      // yolk-green splatter
      fleshLight: '#c3ee92',
      seed: '#ffffff',       // shell fragments
      rindK: 0.86,
      slabK: 0.7,
    },
    pattern: 'spots',      // seeded rounded blobs, a few large
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
    bots: [
      '#f2911b', '#eb8a12', '#f79a26', '#e8850c', '#f5931f', '#ee8d17',
      '#f89e2c', '#e58309', '#f39421', '#ec8b14', '#f7982a',
    ],
    // The star's red comes from ramp B: hue rotated off the orange
    // base rather than hard-coded, so every shade still derives.
    ramp: {
      rampLoDL: -28, rampLoDH: -8, rampLoDS: 5,
      rampHiDL: 22,  rampHiDH: 5,  rampHiDS: -10,
      rampBDL: -12,  rampBDH: -28, rampBDS: 25,
    },
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