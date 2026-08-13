(function () {
'use strict';
// ============================================================
// TICKER — the commentary surface.
//
// Short, transient lines about what just happened, stacked top-centre
// under the button cluster. Deliberately NOT the death overlay: that
// is a big red full-stop for the one event that interrupts your race,
// while the ticker is peripheral colour for events you keep racing
// through. Different jobs, different furniture.
//
// It is a pure BUS CONSUMER: it subscribes to window.FF.events and
// knows nothing about physics. Every later commentary element
// (overtakes, records, laps) lands by emitting an event and adding a
// formatter here — no reach-through, no new plumbing.
//
// ELEMENT TWO: near-misses. Surviving a near-lethal blow is the most
// thrilling thing that happens in a race and it used to pass in
// total silence (a screen flash, nothing else). Three things get
// said, in priority order:
//   1. THE FLARE SAVED IT — computable exactly: re-judge the same
//      dissipated energy at neutral restitution; if that would have
//      been lethal, the player's flare is literally why they lived.
//      This is the positive mirror of the death screen's coach line,
//      and praise for a correct input teaches faster than blame.
//   2. A RECORD — biggest blow survived this race, which needs the
//      bus's history to know (comparative commentary has no meaning
//      without memory).
//   3. A TIER — how close it was, as a percentage of lethal.
//
// Presentation tier only: the sim never reads any of this, and peers
// legitimately see different lines.
// ============================================================

const MAX_LINES = 3;
const LIFE_MS = 2600;
const GAP_MS = 900;      // don't stack near-identical events

const CSS = `
/* The top band is free now that the respawn and daily buttons are
   gone, so commentary rises to sit on the same line as the HUD and
   the pause button. It is BOUNDED by both: the width budget is the
   screen minus the HUD (measured, published by hud.js) on the left
   and a pause-sized margin on the right — doubled, because a centred
   element grows in both directions. Without that, a long line would
   slide under the HUD on a narrow phone. */
#ff-ticker { position: fixed; z-index: 9; pointer-events: none;
  /* NARROW SCREENS KEEP IT BELOW THE HUD. A centred element grows
     both ways, so sharing the top band with a 128px HUD leaves only
     ~86px of usable width on a 390px phone — not enough for a line
     like "NEARLY PULP — 97% OF LETHAL". Rising there would be a
     worse layout wearing the right idea. */
  /* ...and below the DEV LANE when it exists: in portrait the stack
     runs down the left edge at exactly the height a centred ticker
     would occupy. --dev-lane-h is 0px for every player, so this costs
     them nothing. */
  top: calc(var(--lane-t, 10px) + var(--hud-h, 76px) + var(--dev-lane-h, 0px));
  left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  font-family: var(--mono, ui-monospace, monospace); }
.ff-tick { padding: 5px 12px; border-radius: 999px; white-space: nowrap;
  font-size: var(--fs-label); letter-spacing: 0.07em;
  background: rgba(10, 14, 10, 0.82); color: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.09);
  opacity: 0; transform: translateY(-6px);
  transition: opacity 0.16s ease-out, transform 0.16s ease-out; }
.ff-tick.in { opacity: 1; transform: translateY(0); }
/* Green speaks for the flare, everywhere in this game: the stick's
   up-arc, the splat ring, the coach line, and here. */
.ff-tick.flare { color: rgba(92, 235, 110, 0.95);
  border-color: rgba(92, 235, 110, 0.35); }
.ff-tick.record { color: rgba(255, 213, 74, 0.95);
  border-color: rgba(255, 213, 74, 0.35); }
/* WIDE ENOUGH TO SHARE THE LINE: on landscape phones and up, the top
   band has real room beside the HUD, so commentary rises to sit on
   the same line as the HUD and the pause button — bounded by both, so
   a long line can never slide under either. (540px of budget on an
   844px landscape phone, against 86px in portrait.) */
@media (min-width: 700px) {
  #ff-ticker {
    top: var(--lane-t, max(10px, env(safe-area-inset-top)));
    max-width: calc(100vw - (var(--hud-w, 128px) + var(--lane-l, 10px) + 14px) * 2);
  }
}
`;

let root = null;
let lastAt = -1e9;
let bestSurvived = 0;   // race-scoped record (severity)

function ensureRoot() {
  if (root) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.id = 'ff-ticker';
  document.body.appendChild(root);
}

function push(text, kind) {
  // Commentary is for the player racing; behind the results panel
  // there is no one to talk to. One gate here covers every producer
  // (near-misses, overtakes, laps, rivals) rather than each learning
  // about the autopilot separately.
  const ap = window.FF.autopilot;
  if (ap && !ap.playerIsDriving()) return;
  ensureRoot();
  const el = document.createElement('div');
  el.className = 'ff-tick' + (kind ? ' ' + kind : '');
  el.textContent = text;
  root.appendChild(el);
  // Newest at the top; oldest retires when the stack is full.
  while (root.children.length > MAX_LINES) root.firstChild.remove();
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 220);
  }, LIFE_MS);
}

// ---- Near-miss formatting ----------------------------------------
// Returns { text, kind } or null. Pure: the harness tests it directly.
function nearMissLine(c, now, state) {
  if (!c || !c.isPlayer) return null;          // the pack's scrapes aren't news
  if (now - lastAt < GAP_MS) return null;      // one line per bounce chain
  const ratio = c.overkill;                    // severity / lethal, < 1 here
  // The flare-saved case is NOT gated on closeness: a flare that
  // works lands you comfortably clear of lethal, and praising only
  // the squeakers would praise the worst-executed saves.
  if (c.flareSaved) {
    lastAt = now;
    bestSurvived = Math.max(bestSurvived, c.severity);
    return { text: 'THE FLARE SAVED THAT', kind: 'flare' };
  }
  if (ratio < 0.85) return null;
  // A record needs memory — that's what the bus history is for.
  if (c.severity > bestSurvived * 1.02 && bestSurvived > 0) {
    lastAt = now;
    bestSurvived = c.severity;
    return { text: 'BIGGEST HIT SURVIVED — ' + Math.round(c.severity), kind: 'record' };
  }
  bestSurvived = Math.max(bestSurvived, c.severity);
  lastAt = now;
  const pct = Math.min(99, Math.round(ratio * 100));
  if (ratio >= 0.97) return { text: "A RIND'S WIDTH — " + pct + '% OF LETHAL', kind: null };
  if (ratio >= 0.92) return { text: 'NEARLY PULP — ' + pct + '% OF LETHAL', kind: null };
  return { text: 'CLOSE ONE — ' + pct + '% OF LETHAL', kind: null };
}

function onNearMiss(c) {
  const line = nearMissLine(c, performance.now());
  if (line) push(line.text, line.kind);
}

// ---- Race events (element three) ---------------------------------
// Formatting only: racewatch decides what counts as news, the ticker
// decides how it reads. Kept pure and exported so the harness can
// assert the wording without a DOM.
function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  const d = n % 10;
  return n + (d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th');
}

function raceLine(type, d) {
  switch (type) {
    case 'lead':
      return { text: 'INTO THE LEAD', kind: 'record' };
    case 'overtake':
      if (d.gained) {
        // Podium entry is worth more than a routine pass.
        if (d.place <= 3) return { text: 'UP TO ' + ordinal(d.place) + (d.name ? ' — PAST ' + d.name.toUpperCase() : ''), kind: 'record' };
        return { text: d.name ? 'PASSED ' + d.name.toUpperCase() : 'UP TO ' + ordinal(d.place), kind: null };
      }
      return { text: d.name ? 'PASSED BY ' + d.name.toUpperCase() : 'DOWN TO ' + ordinal(d.place), kind: null };
    case 'lap': {
      const secs = (d.ticks / (window.FF.CONFIG.physicsHz || 120)).toFixed(1);
      return d.best
        ? { text: 'LAP ' + d.lap + ' — ' + secs + 's  PERSONAL BEST', kind: 'record' }
        : { text: 'LAP ' + d.lap + ' — ' + secs + 's', kind: null };
    }
    case 'streak':
      return { text: 'CLEAN RUN — ' + d.metres + 'm', kind: 'flare' };
    case 'airtime': {
      const s = d.seconds.toFixed(1);
      if (d.seconds >= 3) return { text: 'HUGE AIR — ' + s + 's', kind: 'record' };
      return { text: s + 's OF HANG TIME', kind: null };
    }
    case 'rivalDown':
      if (d.wasLeader) return { text: (d.name || 'THE LEADER').toUpperCase() + ' IS OUT — LEADER DOWN', kind: 'record' };
      return { text: (d.name || 'A RIVAL').toUpperCase() + ' IS PULP — ' + ordinal(d.place) + ' GONE', kind: null };
    default:
      return null;
  }
}

// A new race wipes the race-scoped records.
function reset() {
  bestSurvived = 0;
  lastAt = -1e9;
  if (root) root.textContent = '';
}

function init() {
  ensureRoot();
  const bus = window.FF.events;
  if (!bus) return;
  bus.on('nearMiss', onNearMiss);
  for (const type of ['lead', 'overtake', 'lap', 'streak', 'airtime', 'rivalDown']) {
    bus.on(type, (d) => {
      const line = raceLine(type, d);
      if (line) push(line.text, line.kind);
    });
  }
}

window.FF.ticker = { init, reset, push, nearMissLine, raceLine, _state: () => ({ bestSurvived, lastAt }) };
})();
