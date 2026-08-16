// ============================================================
// NAMES.JS — the melon-name pool. Content file, like the billboard
// sheet: edit freely, engine code never needs to change.
//
// WHAT THIS IS NOW (2026-08-14). The permanent cast lives in
// roster.js: twelve authored characters, each a PILOT driving one
// fixed MELON, and that is what a solo race fields. This list is the
// pool those melon names were authored FROM, and it remains the
// dealer for every field the roster does not build — netplay,
// harnesses, and any explicitly configured roster. Names dealt here
// are MELON names; pilots are a separate identity (see roster.js).
//
// Comedy doctrine (Worms-certified): mostly puns, seasoned with
// menace, and a few AGGRESSIVELY MUNDANE entries — because "Just
// Dave" finishing ahead of "Gourdzilla" is the funniest possible
// race result. No real living people: keeps things clean legally
// and tonally.
//
// Assignment is SEEDED from the race seed, never Math.random: names
// are presentation, but shared presentation — every peer in a
// lockstep race sees the same cast, and every ghost replays against
// the same rivals.
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
  // RESERVED SEATS. Any melon named in CONFIG.botBrains carries a
  // brain, so it must actually be in the field — otherwise the clever
  // racer would simply be absent on days its name wasn't dealt. Seat
  // those first (deterministically, in declaration order), then deal
  // the shuffled deck around them.
  const reserved = Object.keys((window.FF.CONFIG && window.FF.CONFIG.botBrains) || {});
  const taken = new Set();
  let seat = 0;
  for (const nm of reserved) {
    if (seat >= state.bots.length) break;
    state.bots[seat].melon.name = nm;
    taken.add(nm);
    seat++;
  }
  let n = 0;
  const next = () => {
    // Skip names already seated: a duplicate in the field would make
    // two melons indistinguishable in the standings.
    let name = deck[n++ % deck.length];
    let guard = 0;
    while (taken.has(name) && guard++ < deck.length) name = deck[n++ % deck.length];
    taken.add(name);
    return name;
  };
  for (const pl of state.players) pl.melon.name = next();
  for (let i = seat; i < state.bots.length; i++) state.bots[i].melon.name = next();

  // Attach brains by name. Naming runs after resetBots, so this is the
  // only point where both the melon's identity and its body exist —
  // and it keeps the rule in ONE place rather than splitting it
  // between the roster and the cast.
  const map = (window.FF.CONFIG && window.FF.CONFIG.botBrains) || {};
  const pilot = window.FF.pilot;
  for (const b of state.bots) {
    const want = map[b.melon.name];
    // A per-slot roster override still wins (the harnesses use it);
    // otherwise the name decides.
    if (want && b.brainName === 'cruise' && pilot && pilot.create) {
      b.brainName = want;
      b.brain = pilot.create(want);
    }
  }
}

window.FF = window.FF || {};
window.FF.NAMES = NAMES;
window.FF.assignRosterNames = assignRosterNames;

})();