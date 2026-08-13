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

function derive(seed) {
  const rng = window.FF.mulberry32(seed >>> 0);
  const u = (rng() + rng()) / 2;
  const scale = 0.85 + u * 0.33;
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

// Migration is idempotent: every load repairs whatever is missing, so
// a melon from any past version becomes valid without a version bump
// ladder to maintain.
function migrate(st) {
  let dirty = false;
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
    stable = { v: 1, melons: [{ v: 1, seed: best, name: null, born: new Date().toISOString().slice(0, 10), record: blankRecord() }], active: 0 };
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
function maybeAskName(onDone) {
  const m = active();
  if (m.name) { if (onDone) onDone(m.name); return; }
  if (typeof document === 'undefined' || !document.body) return;
  const wrap = document.createElement('div');
  wrap.id = 'melon-naming';
  const d = derive(m.seed);
  const sizeWord = d.scale < 0.92 ? 'a little one' : d.scale > 1.08 ? 'a big one' : 'a good size';
  wrap.innerHTML = `
    <div class="naming-card">
      <div class="naming-title">you've been dealt a melon</div>
      <div class="naming-sub">${sizeWord} \u2014 ${d.kg.toFixed(1)} kg (${Math.round(d.lb)} lb)</div>
      <input id="melon-name-input" maxlength="24" placeholder="name your melon" autocomplete="off" />
      <button id="melon-name-ok">keep</button>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('#melon-name-input');
  const ok = wrap.querySelector('#melon-name-ok');
  const finish = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    rename(name);
    wrap.remove();
    if (onDone) onDone(name);
  };
  ok.addEventListener('click', finish);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
  setTimeout(() => input.focus(), 50);
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
function stats(seed, fruit) {
  const d = derive(seed);
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

window.FF.melon = { derive, stats, career, recordRace, recordCup, active, setActive, rename, encodeMelon, decodeMelon, maybeAskName, _load: load };

})();
