// ============================================================
// NAMES.JS — the cast list. Content file, like the billboard sheet:
// edit freely, engine code never needs to change.
//
// Comedy doctrine (Worms-certified): mostly puns, seasoned with
// menace, and a few AGGRESSIVELY MUNDANE entries — because "Just
// Dave" finishing ahead of "Gourdzilla" is the funniest possible
// race result. No real living people: keeps things clean legally
// and tonally.
//
// Assignment is SEEDED from the race seed, never Math.random: names
// are presentation, but shared presentation — every peer in a
// lockstep race sees the same cast, every ghost replays against the
// same rivals, and every daily has its canonical roster ("the day
// Gourdzilla won" is a shared fact).
// ============================================================

(function () {
'use strict';

const NAMES = [
  // ---- Puns ----
  'Sir Squashalot',
  'The Rindfather',
  'Seedy McSeedface',
  'Captain Cantaloupe',
  'Gourdzilla',
  'Melon Collie',
  'Rindiana Jones',
  'Casaba Blanca',
  'Honeydew Nothing',
  'Vlad the Impaled',
  'Notorious M.E.L.',
  'Squish Kebab',
  'Baron von Splat',
  'Rolling Blunder',
  'The Green Baron',
  'Pulp Sensation',
  'Smashley',
  'Sir Rolls-A-Lot',

  // ---- Menace ----
  'The Absolute Unit',
  'Big Rindy',
  'Ten Ton Tessie',
  'Doctor Splatter',
  'Lord Splatterly',
  'Gourdo',
  'The Juggernaut',
  'Grievous Bodily Charm',

  // ---- Aggressively mundane (the secret weapons) ----
  'Just Dave',
  'Nigel',
  'Colin the Melon',
  'Second Place Steve',
  'Unripe Colin',
  'Premium Gary',
  'Wide Boi',
  'Lil Squish',
  'Mushy Peas',
  'Steve With The Good Rind',
];

// Deterministic Fisher-Yates off the race seed, then deal to players
// (slot order) and bots. Names live on the melon body object — they
// die and respawn with their fruit, and the renderer reads them there.
function assignRosterNames(state, raceSeed) {
  const rng = window.FF.mulberry32((raceSeed ^ 0x9e3779b9) >>> 0);
  const deck = NAMES.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  let n = 0;
  for (const pl of state.players) pl.melon.name = deck[n++ % deck.length];
  for (const b of state.bots) b.melon.name = deck[n++ % deck.length];
}

window.FF = window.FF || {};
window.FF.NAMES = NAMES;
window.FF.assignRosterNames = assignRosterNames;

})();
