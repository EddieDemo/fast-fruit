(function () {
'use strict';
// ============================================================
// ROSTER — the permanent cast. A content file, like names.js and
// billboards.js: edit the table, commit, deploy.
//
// THE MODEL (Eddie, 2026-08-14). A MELON is a body. A PILOT is the
// thing that drives it — a bot, or you. Pilots own melons and enter
// one into a race, the way a person enters a duck into a duck race:
// the melon is the personified character, the pilot is the brain.
// The two were one field until now (`melon.name` was doing duty as
// both the character and the primary key), and separating them is
// what lets a bot be a recurring personality without pretending the
// fruit is doing the thinking.
//
// TWELVE, FIXED FOREVER. Every character here is permanent: the same
// pilot, always driving the same melon, with the same body. That is
// the whole point — a cast that rotates cannot accumulate reputation,
// and "The Rindfather beat me again" is only a story if it is the
// same Rindfather every time. Recurring rivals give players something
// to have opinions about, hold grudges against, and talk to each
// other about.
//
// THE STAND-IN. The grid holds twelve. The full cast races the
// exhibition behind the menu; in a real race the PLAYER takes exactly
// one seat, always the same one, so the field is the other eleven.
// STAND_IN names whose seat that is. Bot Trevor drives SECOND PLACE
// STEVE, which turns the mechanic into lore: he is the reserve driver
// who gives up his seat to you every single time, and the only racer
// who can win the exhibition but never a real race.
//
// THE BODY COMES FROM THE NAME. A character recognisable only by a
// text label is a weak character, so each melon's physique and pigment
// derive from a seed hashed out of its own NAME — the same green, the
// same rind, the same size, forever, with nothing stored anywhere.
// The seed still cannot lie; it is simply seeded from the name.
//
// SALT is the escape hatch, and it is authored data, not a knob. A
// name that hashes to the wrong body should not have to be renamed to
// fix it — the name IS the character. Bumping a salt re-rolls that one
// melon's body and leaves everything else untouched. The values below
// came from a deterministic search (tools, not shipped) against three
// requirements, all verified on the whole cast:
//   * SIZE spread across the tuned 0.85-1.18 family (4 small / 5 mid
//     / 3 large), so the field matches the distribution the pace and
//     death baselines were tuned against.
//   * COLOUR distinguishable at a glance: worst pair 15.4 dE in CIE
//     Lab (hue alone is the wrong measure — lightness and saturation
//     separate too). As authored, before salting, the worst pair sat
//     at 3.6 dE: invisible.
//   * NAMES KEEP THEIR PROMISES: a melon called TEN TON TESSIE must
//     actually be heavy and LIL SQUISH must actually be small. A
//     character contradicting its own name is the same class of lie
//     the rest of the project forbids.
// Re-run the audit after ANY edit here — a new name changes only its
// own body, but it can collide in colour with an existing one.
//
// THE SKILL COMES FROM THE NAME TOO (AI Phase 2, 2026-09-03; docs/
// AI-RETHINK-2026-09-03.md §8.4-8.5). Every pilot drives the graded
// 'oracle' brain with two authored numbers:
//   * FLARE in [0, 1] — how well the pilot reads a landing and flares
//     for it. One number, mapped through the shared curve table in
//     pilot.js to every dial (whether it forecasts at all, how late it
//     notices, how far it looks, how wide its thumb misses). 1 is the
//     ceiling: the Rindfather, byte-identical to the brain before the
//     gradient existed. 0.2 is the bottom of the ladder: rarely
//     forecasts, yanks late and too little.
//   * LEAN in about [-1, 1] — personality, not skill: the side the
//     thumb tends to miss on. Negative is reckless (under-flares),
//     positive is cautious (over-flares). Since Phase 3 it is a
//     MARGIN, not an offset: see the margin law below.
// Ruled spread across the eleven who race (§8.4): one at 1.0, two
// near 0.85, four in 0.6-0.7, three in 0.4-0.5, one at 0.2. The field
// tilts slightly reckless on purpose (lean sums to -1.4): an arcade
// racer wants more spills than stalls. Assigned by the doctrine above
// — NAMES KEEP THEIR PROMISES — so Baron von Splat splats and Ten Ton
// Tessie drives like someone who knows she is heavy. THE BODY WINS at
// the ends (v359 measured): the 0.2 was first Vlad the Impaled, whose
// salt seats the cast's smallest body, and the size law makes runts
// nearly unkillable — the bottom of the ladder died less than the
// 0.4s. Eddie moved the 0.2 to a body that can die (2026-09-03);
// Baron von Splat's name already promised it. Second Place
// Steve, the stand-in, gets a solid reserve's 0.75: he races only the
// exhibition, where that can win. Suite #55 holds the spread by count
// and the two ends by name; a mutation of any row that moves a band
// dies there. Eddie may override any row from the device session; the
// spread must survive the edit.
//   * ROUTE was a third column (v361-v362) and was REMOVED (v363): a
//     fork-reading skill was measured twice and moved no outcome, and
//     a number the player cannot see is a promise the game cannot
//     keep. Every pilot makes the fork call at the ceiling's rule.
//   * PACE is not a column: a cautious (positive lean) pilot eases
//     the throttle into launches; that is what caution looks like on
//     the stick, and one personality number should mean one thing.
// The margin law (pilot.js, Phase 3): lean never adds stick units; it
// scales every safety margin by 4^lean. A reckless pilot with a good
// thumb loses nothing; a reckless pilot with a bad one has no margin
// to hide the miss. Recklessness costs in proportion to clumsiness.
// ============================================================

// pilot, melon, brain, salt, flare, lean
const CAST = [
  ['Bot Gary',     'The Rindfather',        'oracle',  7, 1.00,  0.0], // the ceiling, ruled
  ['Bot Hollie',   'Melon Collie',          'oracle', 17, 0.45,  0.7], // mournful, cautious, slow
  ['Bot Jesse',    'Rindiana Jones',        'oracle',  0, 0.85, -0.3], // the adventurer: nearly perfect, a little reckless
  ['Bot Robin',    'The Green Baron',       'oracle',  0, 0.85,  0.3], // the ace: nearly perfect, clean and cautious
  ['Bot Gertrude', 'Ten Ton Tessie',        'oracle', 25, 0.65,  0.6], // heavy and knows it: over-flares, slow, survives
  ['Bot Brenda',   'Grievous Bodily Charm', 'oracle',  5, 0.60, -0.6], // the name is violence
  ['Bot Mabel',    'Baron von Splat',       'oracle',  0, 0.20, -0.8], // the bottom of the ladder: promises splats; delivers them (v360, was 0.45)
  ['Bot Otis',     'Notorious M.E.L.',      'oracle',  7, 0.70, -0.3], // swagger
  ['Bot Priya',    'Casaba Blanca',         'oracle',  6, 0.65,  0.1], // classy, even-handed
  ['Bot Winnie',   'Lil Squish',            'oracle',  1, 0.40, -0.4], // small and scrappy; the size law makes her hard to kill
  ['Bot Klaus',    'Vlad the Impaled',      'oracle', 11, 0.45, -1.0], // the runt (0.866, hardest body to kill), reckless with it (v360, was 0.20)
  ['Bot Trevor',   'Second Place Steve',    'oracle', 13, 0.75,  0.3], // the stand-in: races only the exhibition
];

// Whose seat the player takes. Named by PILOT, because the seat
// belongs to the driver.
const STAND_IN = 'Bot Trevor';

// Every roster melon is a watermelon for now. Stated once, here,
// rather than repeated twelve times: when a character earns a
// different species it becomes an explicit fourth column.
const SPECIES = 'watermelon';

// FNV-1a over name (+salt). Deterministic, dependency-free, and the
// same hash the codebase already uses for pattern keys.
function seedFor(melon, salt) {
  const s = melon + (salt ? '#' + salt : '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// One cast row -> everything a race needs to build that body. The
// derivations live here so that "who is Bot Gary" has exactly one
// answer, whatever asks the question (a race, the exhibition, a
// future roster screen).
function describe(row) {
  const [pilot, melon, brain, salt, flare, lean] = row;
  const seed = seedFor(melon, salt);
  const FF = window.FF;
  const d = FF.melon ? FF.melon.derive(seed) : null;
  return {
    pilot, melon, brain, salt, seed,
    // THE SKILL (AI Phase 2): passed through as authored. state.js
    // treats an absent flare as the ceiling, so a row that forgets its
    // number would seat a Rindfather — suite #55 holds every row.
    flare, lean,
    species: SPECIES,
    scale: d ? d.scale : 1,
    // Pigment and rind follow the same seed, so a character's whole
    // appearance is one fact. Falls back gracefully in headless
    // suites that run without shading.js.
    color: (FF.shading && FF.shading.anchorColor)
      ? FF.shading.anchorColor(SPECIES, seed) : null,
    patKey: 'm' + seed,
  };
}

// The whole cast, in authored order (the exhibition's twelve).
function all() {
  return CAST.map(describe);
}

// The field for a real race: the cast minus the seat the player takes.
// Authored order is preserved, so a given pilot is always the same
// grid slot — which is what makes "Bot Gary starts ahead of me" a
// stable fact rather than a per-race surprise.
function field() {
  return CAST.filter(row => row[0] !== STAND_IN).map(describe);
}

function standIn() {
  const row = CAST.find(r => r[0] === STAND_IN);
  return row ? describe(row) : null;
}

// Look a character up by either of its names. Used by anything
// holding a name and wanting the rest of the identity.
function byMelon(name) {
  const row = CAST.find(r => r[1] === name);
  return row ? describe(row) : null;
}
function byPilot(name) {
  const row = CAST.find(r => r[0] === name);
  return row ? describe(row) : null;
}

window.FF = window.FF || {};
window.FF.roster = { CAST, STAND_IN, SPECIES, seedFor, describe, all, field, standIn, byMelon, byPilot };
})();