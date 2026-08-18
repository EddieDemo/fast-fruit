// EMOTE — the finish-line handshake.
//
// One word, GG. A single-word vocabulary is a greeting protocol, not
// a chat system: the deadpan register, and the anti-toxicity position
// for the day multiplayer humans arrive (an emote is a one-byte
// message; bots and humans render through this same machinery and
// become indistinguishable at the presentation layer, which is the
// point).
//
// LAWS (ruled 2026-08-16):
//   * The player's own portrait is the emote button; everywhere else
//     is the racer card. You can only speak as yourself.
//   * One bubble per racer at a time; taps during an active bubble
//     are ignored (natural rate limit, matters later in MP).
//   * Bots answer INDEPENDENTLY at ~30%, staggered 600-2500ms — the
//     stagger is the entire illusion: simultaneous responses read as
//     a machine, scattered ones read as people looking up from their
//     phones.
//   * The response plan is SEEDED PER RACE, not wall-clock: "Bot Otis
//     didn't GG me" is a fact about that race, not a coin that
//     reflips. The moment personality arrives (PILOTS table below),
//     reproducibility is what makes it characterisation.
(function () {
'use strict';

// The personality socket: per-pilot overrides, empty until the roster
// session fills it. The Rindfather answering instantly every time
// while some pilot never answers is characterisation for the price of
// two numbers.
const DEFAULT = { chance: 0.3, delayMin: 600, delayMax: 2500 };
const PILOTS = {
  // 'Bot Gary': { chance: 1.0, delayMin: 250, delayMax: 400 },
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- the pure core ----------------------------------------------------
// One plan per race: for each pilot, an independent seeded roll and a
// delay drawn inside the stagger window. Same race, same plan.
function plan(raceSeed, pilots) {
  const out = {};
  for (const p of pilots) {
    const t = PILOTS[p] || DEFAULT;
    const rng = window.FF.mulberry32(((raceSeed >>> 0) ^ hash(p)) >>> 0);
    const responds = rng() < t.chance;
    const delayMs = Math.round(t.delayMin + rng() * (t.delayMax - t.delayMin));
    out[p] = { responds, delayMs };
  }
  return out;
}

// ---- the bubbles --------------------------------------------------------
const CSS = `
.ff-emote { position: absolute; z-index: 5; pointer-events: none;
  background: #f2f4ee; color: #16210f; border-radius: 999px;
  padding: 4px 10px; font-weight: var(--fw-bold);
  font-size: var(--fs-label); letter-spacing: var(--tr-label);
  opacity: 0; transform: translateY(6px) scale(0.6);
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.ff-emote::after { content: ''; position: absolute; left: 6px; bottom: -5px;
  width: 10px; height: 10px; background: inherit;
  border-radius: 0 0 10px 0; transform: skewX(-18deg); }
.ff-emote.on { opacity: 1; transform: translateY(0) scale(1); }
`;
let cssIn = false;
function injectCSS() {
  if (cssIn || typeof document === 'undefined') return;
  cssIn = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Row registry: a pilot may have a row on more than one tab (PLACES
// and CUP show the same field), and a bubble speaks on all of them.
let rows = new Map();      // pilot key -> [{ row, canvas }]
let active = new Map();    // pilot key -> true while a bubble is up
let timers = [];
let raceSeed = 0;
let cachedPlan = null;

function reset(seed) {
  rows = new Map();
  active = new Map();
  for (const t of timers) clearTimeout(t);
  timers = [];
  raceSeed = seed >>> 0;
  cachedPlan = null;
}

function registerRow(pilotKey, rowEl, canvasEl) {
  if (!rows.has(pilotKey)) rows.set(pilotKey, []);
  rows.get(pilotKey).push({ row: rowEl, canvas: canvasEl });
  rowEl.style.position = 'relative';
}

// HOLD_MS between the eases; the eases themselves live in the CSS.
const HOLD_MS = 1500, EASE_MS = 200;

function say(pilotKey) {
  if (active.get(pilotKey)) return false;    // one bubble per racer
  const anchors = rows.get(pilotKey);
  if (!anchors || !anchors.length) return false;
  injectCSS();
  active.set(pilotKey, true);
  const made = [];
  for (const a of anchors) {
    if (!a.row.isConnected) continue;
    const b = document.createElement('div');
    b.className = 'ff-emote';
    b.textContent = 'GG';
    // top-right of the portrait, overlapping like a thought arriving
    b.style.left = (a.canvas.offsetLeft + a.canvas.offsetWidth - 14) + 'px';
    b.style.top = (a.canvas.offsetTop - 6) + 'px';
    a.row.appendChild(b);
    made.push(b);
    requestAnimationFrame(() => b.classList.add('on'));
  }
  timers.push(setTimeout(() => {
    for (const b of made) b.classList.remove('on');
    timers.push(setTimeout(() => {
      for (const b of made) if (b.parentNode) b.parentNode.removeChild(b);
      active.delete(pilotKey);
    }, EASE_MS + 30));
  }, EASE_MS + HOLD_MS));
  return true;
}

// The player emoted: their bubble, then the field answers per the
// race's plan. Bot pilot keys are everyone registered who isn't the
// speaker.
function playerEmote(playerKey) {
  if (!say(playerKey)) return;               // active bubble: tap ignored
  if (!cachedPlan) {
    const pilots = [...rows.keys()].filter(k => k !== playerKey);
    cachedPlan = plan(raceSeed, pilots);
  }
  for (const [pilot, p] of Object.entries(cachedPlan)) {
    if (!p.responds) continue;
    timers.push(setTimeout(() => say(pilot), p.delayMs));
  }
}

window.FF = window.FF || {};
window.FF.emote = { reset, registerRow, playerEmote, say, plan,
  DEFAULT, PILOTS };

})();
