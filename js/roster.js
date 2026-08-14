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
// ============================================================

// pilot, melon, brain, salt
const CAST = [
  ['Bot Gary',     'The Rindfather',        'oracle',  7],
  ['Bot Hollie',   'Melon Collie',          'cruise', 17],
  ['Bot Jesse',    'Rindiana Jones',        'cruise',  0],
  ['Bot Robin',    'The Green Baron',       'cruise',  0],
  ['Bot Gertrude', 'Ten Ton Tessie',        'cruise', 25],
  ['Bot Brenda',   'Grievous Bodily Charm', 'cruise',  5],
  ['Bot Mabel',    'Baron von Splat',       'cruise',  0],
  ['Bot Otis',     'Notorious M.E.L.',      'cruise',  7],
  ['Bot Priya',    'Casaba Blanca',         'cruise',  6],
  ['Bot Winnie',   'Lil Squish',            'cruise',  1],
  ['Bot Klaus',    'Vlad the Impaled',      'cruise', 11],
  ['Bot Trevor',   'Second Place Steve',    'cruise', 13],
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
  const [pilot, melon, brain, salt] = row;
  const seed = seedFor(melon, salt);
  const FF = window.FF;
  const d = FF.melon ? FF.melon.derive(seed) : null;
  return {
    pilot, melon, brain, salt, seed,
    fruit: SPECIES,
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