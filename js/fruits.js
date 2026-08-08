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
};

window.FF = window.FF || {};
window.FF.FRUITS = FRUITS;

})();
