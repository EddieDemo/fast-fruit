// ============================================================
// MELON — the persistent melon: spec, derivation, stable (data layer).
//
// A melon is A SINGLE SEED plus a name. Everything else derives:
// scale from the triangular distribution, mass/inertia from the laws
// (state.js), rind pattern from the generator (renderer.js, keyed by
// 'm'+seed so renames never change the rind). No stats are stored —
// stats would invite tampering and drift; the seed cannot lie.
//
// Shipped now (forward-compatibility slice of melon-stable.md):
//   * spec format v1 {v, seed, name, born}
//   * starter melon auto-rolled on first boot (weighted average)
//   * one-time NAMING CEREMONY overlay (the attachment moment)
//   * localStorage stable (a list, though the UI to switch waits)
//   * melon codes (base64url) — export/import ready
// Deferred: rolls-on-win, the stable/roster UI, MP handshake field.
// ============================================================

(function () {
'use strict';

const KEY = 'ff-stable';

// ---- Derivation: seed -> physique ----
// Same triangular law as the bots (state.js): middles common,
// extremes rare. Starters roll tighter around 1.0.
// Display weight anchors scale 1.0 at 9.0 kg — a proper average
// picnic watermelon — and follows the SAME s^3 law as the simulated
// mass, so the label is literally proportional to the physics body's
// mass. The seed cannot lie; neither can the scale readout.
const BASE_KG = 9.0;

// ---- SIZE BANDS ---------------------------------------------------
// The standard family, 0.85-1.18, is the one the pace and death
// baselines were tuned against and the one the permanent cast rolls
// in. WON melons roll WIDER: a prize should be able to be a genuine
// runt or a genuine whopper, because collecting is only interesting
// if the things collected differ. The law itself is untouched —
// physics is uniform across every size — so this is a property of the
// MELON, carried on its spec, never a global change (widening the
// band globally would move the cast's bodies, which are authored).
const BAND_STD = { lo: 0.85, span: 0.33 };   // 0.85 .. 1.18
const BAND_WIDE = { lo: 0.80, span: 0.45 };  // 0.80 .. 1.25

// `wide` is optional and defaults to the standard band, so every
// existing caller derives bit-identically.
function derive(seed, wide) {
  const rng = window.FF.mulberry32(seed >>> 0);
  const u = (rng() + rng()) / 2;
  const band = wide ? BAND_WIDE : BAND_STD;
  const scale = band.lo + u * band.span;
  const kg = BASE_KG * scale * scale * scale;
  return {
    scale,
    kg,
    lb: kg * 2.20462,
    patternKey: 'm' + (seed >>> 0),
    // The melon's own green, derived CONTINUOUSLY from the seed via
    // the watermelon anchor band — no two seeds need share a green;
    // the seed owns the pigment forever (was seed % 11 into a list).
    bodyColor: (window.FF.shading && window.FF.shading.anchorColor)
      ? window.FF.shading.anchorColor('watermelon', seed >>> 0) : null,
  };
}

// The canonical accessor: a spec knows its own band, so callers that
// hold a spec should ask this rather than remembering to pass the
// flag. `derive(seed)` stays the primitive for callers that only have
// a seed (the roster, ghost codes).
function deriveSpec(spec) {
  return derive(spec.seed, spec && spec.wide);
}

// ---- Stable persistence ----
let stable = null; // { v: 1, melons: [{v, seed, name, born, record}], active: 0 }

// ---- THE CAREER RECORD -------------------------------------------
// The one genuinely STORED thing about a melon. Everything else on
// the stat card is derived from the seed and can't drift; this can't
// be derived from anything, so it has to be kept — which makes it the
// only part that needs a migration story, a write policy, and honest
// gaps.
//
// WRITE POLICY (ratified): exactly one write, at the finish screen,
// for COMPLETED races only. Abandoning to the menu mid-race records
// nothing — otherwise the race counter becomes a measure of quitting
// and retry-spam inflates it. All completed races count the same,
// dailies included.
//
// HONEST GAPS: a melon that existed before this feature has no
// history. Its counters start at zero and its unknowns read '—'
// rather than being backfilled with invented numbers. `born` was
// already in the schema; melons without one are stamped 'first seen'
// on load, which is true, rather than given a fabricated birthday.
function blankRecord() {
  return {
    races: 0, wins: 0, podiums: 0, splats: 0,
    bestLapTicks: null,     // null = never completed a timed lap
    furthestM: 0,
    biggestSurvived: 0,
    bestPlace: null,
    lastRaced: null,
    // CUPS ARE THEIR OWN UNIT. Without this, "wins" would silently
    // mean two things the day the cup shipped — race wins and cup
    // wins — and every existing number would change meaning. Cup
    // races still count as races; only completed cups count here.
    cups: 0, cupWins: 0, cupPodiums: 0,
    bestCupPlace: null, bestCupPoints: null,
  };
}

// ---- THE PLAYER (the pilot) ---------------------------------------
// A melon is a body; the player is the pilot who enters one. The
// stable therefore holds one player record alongside the melons —
// this is a property of YOU, not of any melon, so it cannot live on a
// melon spec (you would have as many usernames as fruit).
//
// DEFAULTS RATHER THAN PROMPTS. A new player is 'Player' and can race
// immediately; naming yourself is offered later, at the moment it
// starts to matter (your name on a results table beside eleven
// others). Same doctrine as the melon's 'Unnamed Melon': never a wall
// between a new player and the first race.
const DEFAULT_PILOT = 'Player';

function playerName() {
  const st = load();
  return (st.player && st.player.name) || DEFAULT_PILOT;
}

function renamePlayer(name) {
  const st = load();
  if (!st.player) st.player = { name: DEFAULT_PILOT };
  st.player.name = String(name || '').trim().slice(0, 24) || st.player.name;
  save();
  return st.player.name;
}

// Migration is idempotent: every load repairs whatever is missing, so
// a melon from any past version becomes valid without a version bump
// ladder to maintain.
function migrate(st) {
  let dirty = false;
  // The pilot record: added 2026-08-14. An existing save has melons
  // but no player, and gets the default rather than a prompt.
  if (!st.player || typeof st.player.name !== 'string') {
    st.player = { name: DEFAULT_PILOT };
    dirty = true;
  }
  // Career XP: added 2026-08-15 with the pilot progression law. ONE
  // stored integer — level and bar are always derived through xp.js,
  // so they can never drift from the total that justifies them.
  if (typeof st.player.xp !== 'number' || !isFinite(st.player.xp)) {
    st.player.xp = 0;
    dirty = true;
  }
  // The highest level whose decal roll has FIRED. Rolls are keyed by
  // level number and settled by walking rolledLevel up to the current
  // level, so no level ever skips its roll — not across abandoned
  // cups, not across crashes. Initialised to the CURRENT level so
  // pre-existing xp never backdates a windfall of rolls.
  if (typeof st.player.rolledLevel !== 'number') {
    st.player.rolledLevel = window.FF.xp ? window.FF.xp.levelFor(st.player.xp) : 1;
    dirty = true;
  }
  // THE REWARD QUEUE (2026-08-15). Rewards are GRANTED at the moment
  // they become true and QUEUED here for the telling; the reveal
  // screens only present persisted facts. Crash mid-sequence and
  // nothing is lost — unrevealed entries simply re-offer next visit.
  if (!Array.isArray(st.rewards)) {
    st.rewards = [];
    dirty = true;
  }
  // THE OWNED-DECALS SET: added 2026-08-15. Per-install, ids only — a
  // SET, not counts: rarity is arithmetic (set size) and duplicates
  // are impossible by design, so there is nothing else to store.
  // THE ROLL ERA (2026-08-15). The interim grant-all that filled the
  // tray before earning existed is OVER: the level-up roll is the only
  // door now. Saves from the interim era get wiped ONCE — versioned by
  // the eraRoll flag, never repeated, so everything earned after this
  // line is permanent. (Ruled by Eddie: nothing launched, nothing
  // worth keeping; every sticker should be an earned one.)
  if (!Array.isArray(st.decals)) { st.decals = []; dirty = true; }
  if (!st.eraRoll) {
    st.decals = [];
    st.eraRoll = true;
    dirty = true;
  }
  for (const m of st.melons) {
    if (!m.record) { m.record = blankRecord(); dirty = true; }
    else {
      const blank = blankRecord();
      for (const k of Object.keys(blank)) {
        if (m.record[k] === undefined) { m.record[k] = blank[k]; dirty = true; }
      }
    }
    if (!m.born) { m.born = new Date().toISOString().slice(0, 10); m.firstSeen = true; dirty = true; }
  }
  return dirty;
}

function load() {
  if (stable) return stable;
  try { stable = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
  if (!stable || !Array.isArray(stable.melons) || !stable.melons.length) {
    // First boot: deal the starter. Weighted toward average — two
    // extra middling rolls pull the triangular draw toward 1.0.
    let seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    let best = seed, bestDev = Math.abs(derive(seed).scale - 1);
    for (let i = 0; i < 2; i++) {
      const s2 = (seed + 0x9e3779b9 * (i + 1)) >>> 0;
      const dev = Math.abs(derive(s2).scale - 1);
      if (dev < bestDev) { best = s2; bestDev = dev; }
    }
    stable = { v: 1, player: { name: DEFAULT_PILOT }, salt: ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0), melons: [{ v: 1, seed: best, name: null, born: new Date().toISOString().slice(0, 10), record: blankRecord() }], active: 0 };
    save();
  }
  if (migrate(stable)) save();
  return stable;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(stable)); } catch (_) {}
}

function active() {
  const st = load();
  return st.melons[st.active] || st.melons[0];
}

function rename(name) {
  const m = active();
  m.name = String(name || '').trim().slice(0, 24) || m.name;
  save();
  return m.name;
}

// The ONE write. Called by the finish screen with a completed race's
// facts; everything it needs is already computed by the standings and
// the race book, so this only folds them into the record.
//   { place, fieldSize, splats, bestLapTicks, distanceM, biggestSurvived }
function recordRace(result) {
  if (!result || !result.place) return null;
  const m = active();
  const r = m.record || (m.record = blankRecord());
  r.races++;
  if (result.place === 1) r.wins++;
  if (result.place <= 3) r.podiums++;
  if (r.bestPlace === null || result.place < r.bestPlace) r.bestPlace = result.place;
  r.splats += result.splats || 0;
  if (result.bestLapTicks && (r.bestLapTicks === null || result.bestLapTicks < r.bestLapTicks)) {
    r.bestLapTicks = result.bestLapTicks;
  }
  if ((result.distanceM || 0) > r.furthestM) r.furthestM = Math.round(result.distanceM);
  if ((result.biggestSurvived || 0) > r.biggestSurvived) r.biggestSurvived = Math.round(result.biggestSurvived);
  r.lastRaced = new Date().toISOString().slice(0, 10);
  save();
  return r;
}

// The career half of the stat card. Same structured shape as stats(),
// so the menu renders both with one code path. Unknowns are '\u2014',
// never a fake zero.
function career(melonRef) {
  const m = melonRef || active();
  const r = m.record || blankRecord();
  const hz = (window.FF.CONFIG && window.FF.CONFIG.physicsHz) || 120;
  const rows = [];
  const add = (key, label, value, note) => rows.push({ key, label, value, note });
  add('races', 'RACES', String(r.races));
  add('wins', 'WINS', String(r.wins), r.races ? Math.round(100 * r.wins / r.races) + '% of starts' : null);
  add('podiums', 'PODIUMS', String(r.podiums));
  add('best', 'BEST FINISH', r.bestPlace ? ordinal(r.bestPlace) : '\u2014');
  add('lap', 'BEST LAP', r.bestLapTicks ? (r.bestLapTicks / hz).toFixed(1) + 's' : '\u2014');
  add('splats', 'SPLATS', String(r.splats),
    r.races ? (r.splats / r.races).toFixed(1) + ' per race' : null);
  add('tough', 'BIGGEST HIT SURVIVED', r.biggestSurvived ? String(r.biggestSurvived) : '\u2014');
  add('cups', 'CUPS', String(r.cups || 0));
  add('cupwins', 'CUP WINS', String(r.cupWins || 0));
  add('bestcup', 'BEST CUP', r.bestCupPlace ? ordinal(r.bestCupPlace) : '\u2014');
  add('born', m.firstSeen ? 'FIRST SEEN' : 'RECEIVED', m.born || '\u2014');
  return rows;
}

function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  const d = n % 10;
  return n + (d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th');
}

// The cup's own write, mirroring recordRace: one call, at the end of
// a COMPLETED cup. Practice and abandoned cups never reach here.
function recordCup(result) {
  if (!result || !result.place) return null;
  const m = active();
  const r = m.record || (m.record = blankRecord());
  r.cups++;
  if (result.place === 1) r.cupWins++;
  if (result.place <= 3) r.cupPodiums++;
  if (r.bestCupPlace === null || result.place < r.bestCupPlace) r.bestCupPlace = result.place;
  if (r.bestCupPoints === null || (result.points || 0) > r.bestCupPoints) r.bestCupPoints = result.points || 0;
  save();
  return r;
}

// ---- THE STABLE: SIZE, AWARDS, DELETION ---------------------------
// A stable holds SIX melons. A cap is what makes acquisition matter:
// unlimited attempts times an unlimited stable is an inflating pile
// of near-identical fruit behind a pair of arrows, and a prize that
// costs nothing to hold is not a prize. At six, a new melon arriving
// when you are full is a DECISION.
const STABLE_MAX = 6;
// ...and at most two won per day, so a good hour of cups cannot flood
// the stable, and tomorrow still has something to offer.
const DAILY_AWARD_CAP = 2;

// THE ODDS. Halving at each step down the podium, so the rule is one
// a player can hold in their head and repeat: winning is certain,
// second is half, third is half again.
const AWARD_CHANCE = { 1: 1, 2: 0.5, 3: 0.25 };

// THE ROLL IS SEEDED, AND IT IS SEEDED PER INSTALL.
//
// Seeded, because unlimited attempts plus a live roll means closing
// the tab at the right instant is the optimal way to re-roll a 50% —
// an exploit that teaches players to game the moment instead of
// racing it. Same day, same attempt, same place always produces the
// same outcome on this device, so there is nothing to scum.
//
// Per install, because a roll seeded only from public facts would
// hand every player who won Tuesday's cup on their second attempt the
// SAME melon. The salt is minted once, at first boot, and folded into
// every award: uniqueness comes from the salt, unscummability from
// the salt being FIXED. (Clearing storage mints a new one — and
// destroys the whole stable in the process, which is punishment
// enough.) The cost, accepted: a won melon is no longer reproducible
// from public information, so a friend cannot verify it. That is the
// right trade for a personal collection.
// ---- THE OWNED-DECALS SET ------------------------------------------
// Ids only, per install (see migrate). Grant validates against the
// catalogue AT GRANT TIME, not at read time: a save carrying an id the
// catalogue later dropped (the varsity 2) keeps it harmlessly — byId
// returns null everywhere it matters — and gets it back the day the
// item returns.
function ownedDecals() {
  const st = stable || (load(), stable);
  return (st.decals || []).slice();
}
function hasDecal(id) {
  const st = stable || (load(), stable);
  return !!(st.decals && st.decals.indexOf(id) !== -1);
}
function grantDecal(id) {
  const D = window.FF.decals;
  if (!D || !D.byId(id)) return false;
  const st = stable || (load(), stable);
  if (!st.decals) st.decals = [];
  if (st.decals.indexOf(id) !== -1) return false;   // duplicates impossible
  st.decals.push(id);
  save();
  return true;
}

// ---- PILOT XP --------------------------------------------------------
// addXp is the ONLY door: it clamps to non-negative integers, saves,
// and reports what the addition did in level terms so callers can
// queue level-up ceremonies without re-deriving anything.
function pilotXp() {
  const st = stable || (load(), stable);
  return (st.player && st.player.xp) || 0;
}
function addXp(n) {
  const X = window.FF.xp;
  const st = stable || (load(), stable);
  const add = Math.max(0, Math.floor(n || 0));
  const before = st.player.xp || 0;
  st.player.xp = before + add;
  save();
  const lv0 = X.levelFor(before), lv1 = X.levelFor(st.player.xp);
  return { added: add, xp: st.player.xp, level: lv1, levelsGained: lv1 - lv0 };
}

// ---- THE DECAL ROLL ---------------------------------------------------
// One roll per pilot level-up (ruled 2026-08-15). PURE: rolling draws,
// it does not grant — the caller grants, so the draw is testable and
// the grant is explicit. Determinism: the draw is a seeded fact of
// (install salt, level reached, owned set at roll time) — the same
// level-up always yields the same sticker, so there is nothing to
// re-roll by reloading.
//
// RARITY IS ARITHMETIC, and the roll IS the arithmetic: pick an
// eligible SET uniformly, then an item within it uniformly. A specific
// flag is therefore exactly nine times rarer than the googly eye,
// which is precisely what the tray's "1 of 9 FLAGS" line has been
// claiming all along. Sets with nothing left to give (fully owned, or
// empty like NUMBERS today) are not eligible.
//
// Eyes arrive singly by construction — a roll grants one item, and an
// eye is one item. The one-eyed melon remains the joke until a second
// eye is EARNED, which is the joke maturing, not breaking.
//
// A full collection rolls null: the level-up beat still plays, the
// decal beat simply doesn't. Completion is its own reward, deadpan.
function rollDecal(level) {
  const D = window.FF.decals;
  if (!D) return null;
  const st = stable || (load(), stable);
  const owned = st.decals || [];
  const eligible = [];
  for (const key of Object.keys(D.SETS)) {
    const items = D.SETS[key].items.filter(it => owned.indexOf(it.id) === -1);
    if (items.length) eligible.push({ key, label: D.SETS[key].label, items });
  }
  if (!eligible.length) return null;
  const seed = (playerSalt() ^ Math.imul(level >>> 0, 2654435761)) >>> 0;
  const rng = window.FF.mulberry32(seed);
  const set = eligible[Math.floor(rng() * eligible.length)];
  const item = set.items[Math.floor(rng() * set.items.length)];
  return { id: item.id, label: item.label, setLabel: set.label,
    setSize: window.FF.decals.SETS[set.key].items.length };
}

// ---- THE REWARD QUEUE ------------------------------------------------
function queueReward(entry) {
  const st = stable || (load(), stable);
  st.rewards.push(entry);
  save();
}
function pendingRewards() {
  const st = stable || (load(), stable);
  return (st.rewards || []).slice();
}
// Pop happens when the player ADVANCES PAST a card, not when it is
// shown — so a crash mid-reveal re-offers rather than swallows.
function shiftReward() {
  const st = stable || (load(), stable);
  const e = (st.rewards || []).shift() || null;
  if (e) save();
  return e;
}
// Remove and return the first entry of a kind, wherever it sits.
// Exists for consumers that handle one kind out of order (the melon
// ceremony predates the card sequence).
function takeReward(kind) {
  const st = stable || (load(), stable);
  const i = (st.rewards || []).findIndex(e => e.kind === kind);
  if (i === -1) return null;
  const e = st.rewards.splice(i, 1)[0];
  save();
  return e;
}

// Fire every decal roll the pilot has earned but not yet received:
// one per level between rolledLevel and the current level. A null
// roll (complete collection) still CONSUMES the level — completion
// means the beat simply doesn't play, not that it accrues.
function settleLevelRolls() {
  const X = window.FF.xp;
  const st = stable || (load(), stable);
  const cur = X.levelFor(st.player.xp || 0);
  const queued = [];
  while ((st.player.rolledLevel || 1) < cur) {
    const L = (st.player.rolledLevel || 1) + 1;
    const r = rollDecal(L);
    if (r) {
      grantDecal(r.id);
      const entry = { kind: 'decal', level: L, id: r.id, label: r.label,
        setLabel: r.setLabel, setSize: r.setSize };
      st.rewards.push(entry);
      queued.push(entry);
    }
    st.player.rolledLevel = L;
  }
  save();
  return queued;
}

function playerSalt() {
  const st = load();
  if (!st.salt) {
    st.salt = ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    save();
  }
  return st.salt >>> 0;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// How many melons has this day already awarded?
function awardsToday(day) {
  const st = load();
  const a = st.awards;
  return (a && a.day === day) ? (a.count || 0) : 0;
}
function noteAward(day) {
  const st = load();
  if (!st.awards || st.awards.day !== day) st.awards = { day, count: 0 };
  st.awards.count++;
  save();
}

// Decide (and, if won, MINT) the prize for a completed cup.
//   { day, attempt, place }  ->  { won, reason, spec?, full? }
//
// THE MELON IS PERSISTED THE MOMENT IT IS WON, unnamed — never at the
// end of a ceremony. A player told they have won a melon and then
// closing the tab before naming it must not lose the prize; and an
// unnamed melon already trips the boot gate, so a ceremony missed for
// any reason simply happens on next launch. The ceremony is
// decoration on top of a fact that is already true.
//
// When the stable is FULL the melon is still minted, but held aside
// rather than added: the caller runs the keep-or-release flow and
// either commits it (acceptAward) or drops it.
function awardForCup(result) {
  const day = result.day || today();
  const place = result.place;
  const chance = AWARD_CHANCE[place] || 0;
  if (!chance) return { won: false, reason: 'place' };
  if (awardsToday(day) >= DAILY_AWARD_CAP) return { won: false, reason: 'dailyCap' };
  const rng = window.FF.mulberry32(
    hashStr(day + '|' + (result.attempt || 1) + '|' + place) ^ playerSalt());
  if (rng() >= chance) return { won: false, reason: 'roll' };
  // The prize's own seed comes from the same stream, so the melon is
  // fully determined by the achievement that earned it.
  const seed = (rng() * 4294967296) >>> 0;
  const spec = { v: 1, seed, name: null, wide: 1, won: { day, place, attempt: result.attempt || 1 },
    born: today(), record: blankRecord() };
  noteAward(day);
  const st = load();
  if (st.melons.length >= STABLE_MAX) return { won: true, spec, full: true };
  st.melons.push(spec);
  save();
  return { won: true, spec, full: false };
}

// Commit a held prize by releasing one of the existing melons for it.
// The record dies with the released melon — that is the part that is
// genuinely irreversible, and the confirm must say so.
function acceptAward(spec, replaceIndex) {
  const st = load();
  if (replaceIndex >= 0 && replaceIndex < st.melons.length) {
    st.melons.splice(replaceIndex, 1);
    // Keep the active pointer on the melon it was pointing AT, not on
    // whatever slid into that index.
    if (st.active >= st.melons.length) st.active = st.melons.length - 1;
  }
  st.melons.push(spec);
  save();
  return spec;
}

// Release a melon from the start screen. You cannot delete your last
// one — a player must always have something to race — and deleting
// the active one moves the pointer rather than leaving it dangling.
function deleteMelon(index) {
  const st = load();
  if (st.melons.length <= 1) return false;
  if (index < 0 || index >= st.melons.length) return false;
  st.melons.splice(index, 1);
  if (st.active >= st.melons.length) st.active = st.melons.length - 1;
  save();
  return true;
}

function today() {
  return (window.FF.dailyTrackName ? window.FF.dailyTrackName() : new Date().toISOString().slice(0, 10));
}

function stableFull() { return load().melons.length >= STABLE_MAX; }
function stableList() { return load().melons.slice(); }
// ---- Melon codes: the seed cannot lie ----
function b64url(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); }

function encodeMelon(m) {
  return b64url(JSON.stringify({ v: 1, s: m.seed >>> 0, n: m.name || '', b: m.born || '' }));
}
function decodeMelon(code) {
  try {
    const o = JSON.parse(unb64url(code));
    if (o.v !== 1 || typeof o.s !== 'number') return null;
    return { v: 1, seed: o.s >>> 0, name: o.n || null, born: o.b || '' };
  } catch (_) { return null; }
}

// ---- The naming ceremony (one-time overlay) ----
// THE HEADLINE IS CONTENT, NOT CODE. Same doctrine as names.js and
// billboards.js: a list you extend without touching the ceremony.
//
// THE RULE, so the next entry doesn't wander (Eddie, 2026-08-14):
// every headline is a BORROWED MOMENT OF BEING HANDED A THING,
// transposed to melon. The old man in the cave pressing a sword on
// you before you set off; the mail server announcing your post; the
// midwife; the talk-show host; the item-get jingle; the parcel at the
// door. If it is not somebody GIVING you something, it does not
// belong here — an encounter ("a wild melon appeared"), an identity
// ("yer a melon"), or an inventory line ("melon acquired") all break
// the rule, however funny, because the screen exists to land one
// beat: this melon is now yours.
//
// ("You've got Melon!" is the mass-noun joke; it is not "a melon".)
//
// LENGTH: the title step fits about 22 characters on one line at a
// 390px phone. Longer is allowed — the title wraps and balances (see
// .ff-title in flow.js) — but check it breaks somewhere you'd choose,
// as "Congratulations, it's a Melon!" does at its comma.
const NAMING_HEADLINES = [
  "You've got Melon!",      // AOL: "You've got mail!"
  'Take this!',             // Zelda: "It's dangerous to go alone! Take this!"
  'You get a Melon!',       // Oprah: "You get a car!"
  "Congratulations, it's a Melon!", // the delivery-room announcement
  'Special delivery!',      // the parcel at the door
];
// 'Melon get!' USED TO LIVE HERE and has moved to the finish screen's
// prize button (flow.js). It is the Gratuitous English acquisition
// message from the Japanese release of Super Mario Sunshine —
// "SHINE GET!" — snowcloned as "[X] GET!", and the joke is the word
// order rather than the words. It earns more as a button than as a
// headline: a headline shows on a sixth of prizes, the button shows
// on every one. Keeping it in both places would have the button
// promise a phrase the ceremony then failed to deliver five times in
// six — and stutter the sixth.

// Presentation tier: Math.random is correct here (nothing derives from
// it, and it happens before any race exists). PICKED ONCE and held, so
// a re-render can never swap the headline mid-look.
function pickHeadline() {
  return NAMING_HEADLINES[Math.floor(Math.random() * NAMING_HEADLINES.length)];
}

// THE CARD ITSELF LIVES IN flow.js (2026-08-14). This module owns
// the melon — the seed, the derivation, the record, the name — and
// flow owns every screen the player looks at. The ceremony used to
// build its own DOM here, which is how it ended up with a private
// visual language (#111 panels, a pink keep button) that predated
// type.js and never got migrated with the rest of the interface. It
// is now the 'naming' flow screen, assembled from the same
// components as the start screen; what remains here is the content
// and the rules.

// THE DEFAULT NAME, in one place. Every screen that has to render a
// melon with no chosen name says exactly this, so the menu, the
// standings, the finish screen and the stat card cannot disagree
// about who you are. `rename()` clamps to 24 chars, which this fits.
const UNNAMED_NAME = 'Unnamed Melon';

// Does this melon still need its ceremony? Asked by the boot sequence
// so the gate can run BEFORE the menu rather than racing it.
function needsName() {
  const m = active();
  return !m.name;
}

window.FF = window.FF || {};
// setActive: the stable's selector (the menu's arrows).
function setActive(i) {
  const st = load();
  if (i >= 0 && i < st.melons.length) { st.active = i; save(); }
  return st.active;
}

// ---- THE STAT CARD ----------------------------------------------
// Everything here is DERIVED, never stored: given the seed and the
// species, the same numbers come out on every device, forever. That
// is the whole point — a stat card that can't drift, can't be edited,
// and can't disagree with the body you actually race. (Career
// history is a separate, genuinely stored thing; it lives elsewhere.)
//
// Values are returned structured — { key, label, value, note } — so
// the menu stays a renderer and never does arithmetic. New stats land
// by adding a row here.
function stats(seed, fruit, wide) {
  const d = derive(seed, wide);
  const CONFIG = window.FF.CONFIG;
  const F = (window.FF.FRUITS && window.FF.FRUITS[fruit]) || {};
  const mult = F.sizeMult || 1;
  const aspect = F.aspect === undefined ? 0.78 : F.aspect;
  const taper = F.taper || 0;
  const a = CONFIG.semiMajor * d.scale * mult;
  const b = a * aspect;
  const rows = [];
  const add = (key, label, value, note) => rows.push({ key, label, value, note });

  // WEIGHT follows the sim's own VOLUME law (state.js: mass ~ a*b^2 *
  // (1 + tau^2/5)), not scale^3 — otherwise a species with its own
  // sizeMult or aspect would show a weight its physics body doesn't
  // have. Anchored so a scale-1.0 watermelon reads the familiar
  // 9.0 kg, and it reduces to exactly derive().kg for that case.
  const REF_A = CONFIG.semiMajor, REF_B = CONFIG.semiMajor * 0.78;
  const volRef = REF_A * REF_B * REF_B;
  const vol = a * b * b * (1 + taper * taper / 5);
  const kg = (d.kg / (d.scale * d.scale * d.scale)) * (vol / volRef);
  add('weight', 'WEIGHT', kg.toFixed(1) + ' kg', Math.round(kg * 2.20462) + ' lb');
  // Length across the long axis, in the world's own scale (100px = 1m).
  add('size', 'LENGTH', Math.round(2 * a) + ' cm',
    d.scale < 0.92 ? 'a little one' : d.scale > 1.08 ? 'a big one' : 'a good size');
  // Species keys are camelCase identifiers; the card is read by
  // humans. Split on the case boundary rather than adding a label
  // field to every species (one place to get wrong instead of seven).
  const nice = String(fruit || 'watermelon').replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
  add('species', 'SPECIES', F.label ? F.label.toUpperCase() : nice);

  // Shape toughness: the per-species constant the damage law uses,
  // stated against the sphere it's normalised to. Honest and
  // comparative — 1.00 really is the unsmashable ball.
  const D = window.FF.damage;
  if (D && D.shapeToughness) {
    add('tough', 'TOUGHNESS', D.shapeToughness(a, b, taper).toFixed(2) + '\u00d7', 'vs a perfect sphere');
  }
  // Engine and rev limit scale with size by the same laws physics
  // uses, so a big melon really does pull harder and rev lower.
  const sRatio = (d.scale * mult);
  add('engine', 'ENGINE', Math.pow(sRatio, CONFIG.sizeEngineExp).toFixed(2) + '\u00d7', 'torque vs average');
  add('revs', 'REV LIMIT', Math.round(CONFIG.maxAngVel * Math.pow(sRatio, -CONFIG.sizeRevExp)) + ' rad/s');
  // Rind strength: the body's own smash threshold, size-scaled.
  const mr = Math.pow(sRatio, 3);
  add('rind', 'RIND', (Math.pow(mr, CONFIG.sizeToughness / 3)).toFixed(2) + '\u00d7', 'impact it can take');
  add('bounce', 'BOUNCE', CONFIG.restitution.toFixed(2), 'neutral stick');
  return rows;
}

window.FF.melon = { BASE_KG, derive, deriveSpec, _save: save, stats, career, awardForCup, acceptAward, deleteMelon,
  ownedDecals, hasDecal, grantDecal, pilotXp, addXp, rollDecal,
  queueReward, pendingRewards, shiftReward, takeReward, settleLevelRolls,
  awardsToday, playerSalt, stableFull, stableList, STABLE_MAX, DAILY_AWARD_CAP, AWARD_CHANCE, BAND_WIDE, BAND_STD, recordRace, recordCup, active, setActive, rename, playerName, renamePlayer, DEFAULT_PILOT, encodeMelon, decodeMelon, needsName, pickHeadline, UNNAMED_NAME, NAMING_HEADLINES, _load: load,
  // TRUE reload: drops the in-memory stable and re-reads storage.
  // _load is a cached accessor (production calls it as "get the
  // stable"); this one exists for harnesses and dev work, where
  // "survives a reload" must mean the storage, not the object.
  _reload: () => { stable = null; return load(); } };

})();