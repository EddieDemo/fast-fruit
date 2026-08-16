// ============================================================
// DEATHS — the named-death screen + clean mode.
//
// The conversion layer: physics already computes WHY you died
// (severity source, contact curvature, impact speed), the cast gives
// the death a protagonist, and the squelch gives it a sound. This
// module turns that into the artifact people screenshot:
//
//     CATASTROPHIC NOSE LANDING
//     LIL SQUISH — 19.2 m/s
//
// Passive overlay: pointer-events none, auto-fades, never blocks the
// respawn or the racing. Presentation-only — reads state.lastDeath,
// writes DOM, the sim never looks back.
//
// CLEAN MODE: the tuning cockpit (debug panel + telemetry HUD rows)
// hides behind a "..." toggle, ON by default. Viral traffic is 95%
// people who will never open a menu; their first ten seconds should
// be melon, not instrumentation. Preference persists.
// ============================================================

(function () {
'use strict';

// ---- Death classification ----------------------------------------
// REWRITTEN 2026-08-12. The old classifier bucketed on the curvature
// penalty (rFlat/curvR): "TIP-FIRST ARRIVAL", "LAWN DART". Under the
// shape-toughness law that number no longer causes anything —
// severity is orientation-independent — so those headlines were
// inventing nose-landing stories for deaths that had nothing to do
// with orientation. Fabricated explanations are worse than dull ones.
//
// The honest axes now, in the order they decide a death:
//   BY PAIR   — traffic, not terrain.
//   OVERKILL  — severity / this body's threshold. A squeaker at 1.02
//               and an obliteration at 4x deserve different words,
//               and this ratio already folds in mass, species
//               toughness and flare.
//   FLARE     — the one thing that was under your control. Dead
//               stick, neutral, or flared-and-still-flattened.
//   CHAIN     — did the arrival kill you, or the third bounce? A
//               story the energy law created and the old commentary
//               could not tell.
const LINES = {
  pair: ['PULPED IN THE PACK', 'RIVAL COLLISION', 'TRAFFIC INCIDENT', 'SQUEEZED OUT'],
  // Traffic, with blame. The pair law says exactly who deadened the
  // collision (e = min of the two) and who therefore ate the bigger
  // share of the energy — so these are accusations, not flavour.
  pairStiff: ['TOO RIGID IN TRAFFIC', 'NO GIVE, NO LUCK', 'BRACED INTO THE PACK'],
  pairVictim: ['THE BOUNCE TAKEN OUT OF IT', 'DEADENED BY A RIVAL', 'ABSORBED THE LOT'],
  // Overkill >= 2.5: nothing would have helped.
  obliterated: ['UNSURVIVABLE', 'TOTAL LOSS', 'UNSCHEDULED DISASSEMBLY', 'ERASED'],
  // Died stiff (low restitution) — the flare would have mattered.
  stiff: ['STIFF ON ARRIVAL', 'NO GIVE, NO MERCY', 'RIGID TO THE END', 'BRACED, BROKEN'],
  // Died at neutral: never reached for the flare.
  neutral: ['NEVER FLARED', 'TOOK IT RAW', 'STRAIGHT INTO IT'],
  // Died flared: did the right thing, drop was simply too big.
  flared: ['FLARED, STILL FLATTENED', 'BOUNCE WASN\'T ENOUGH', 'OUTFALLEN'],
  // Killed by a later bounce, not the arrival.
  chain: ['SURVIVED THE FALL, LOST THE LANDING', 'DIED ON THE REBOUND', 'THE SECOND ONE GOT IT'],
  // Squeaker: within 15% of walking away.
  hair: ['BY A RIND\'S WIDTH', 'ALMOST WALKED AWAY', 'ONE BOUNCE SHORT'],
};

function classify(d) {
  const pool = (() => {
    if (d.byPair) {
      // Only accuse when the shares were genuinely lopsided; a
      // symmetric bump is just a bump.
      if (d.pairShare > 0.6) return d.pairIStiffened ? LINES.pairStiff : LINES.pairVictim;
      return LINES.pair;
    }
    if (d.overkill >= 2.5) return LINES.obliterated;
    if ((d.chainIndex || 1) > 1) return LINES.chain;
    if (d.overkill <= 1.15) return LINES.hair;
    const neutralE = window.FF.CONFIG.restitution;
    if (d.restitution < neutralE * 0.6) return LINES.stiff;
    if (d.restitution > neutralE * 1.25) return LINES.flared;
    return LINES.neutral;
  })();
  // Stable pick: same death, same line (tick-keyed, presentation-only).
  return pool[d.tick % pool.length];
}

// ---- THE COACH LINE (element one) --------------------------------
// The death screen's third line: what would have saved you, stated
// exactly. The certificate carries axisNeeded — the minimum stick
// deflection that survives this exact contact, solved closed-form
// from the energy law — so the coaching is a fact, not encouragement.
//
// RESTRAINT IS THE DESIGN. In a measured race sample 21 of 21 deaths
// were survivable at full flare, so a line on every death would be
// wallpaper within a minute and the player would stop reading the
// screen entirely. Three gates:
//   1. Only when it's ACTIONABLE — the player wasn't already flaring
//      hard. Telling someone who flared to flare is noise.
//   2. COOLDOWN — at most one coach line per COACH_GAP_MS, so it
//      arrives as an occasional nudge rather than a nag.
//   3. FADES OUT WITH MASTERY — once the player has demonstrably
//      used the flare well (survived big hits with it), coaching
//      stops. Teaching should end when it's learned.
// The "nothing would have saved that" case is deliberately kept: it
// is exoneration, it costs nothing, and it makes the coaching
// credible precisely because it is not always blaming the player.
const COACH_GAP_MS = 25000;
const MASTERY_SAVES = 3; // flared survivals of near-lethal blows
let lastCoachAt = -1e9;
let masterySaves = 0;

// Learn from the near-misses: a big blow survived WHILE flaring is
// the player demonstrating the skill.
function noteNearMiss(c) {
  if (!c || !c.isPlayer) return;
  const neutral = window.FF.CONFIG.restitution;
  if (c.restitution > neutral * 1.25 && c.overkill > 0.9) masterySaves++;
}

function coachLine(d, now) {
  if (d.byPair) return null;              // traffic isn't a flare lesson
  if (masterySaves >= MASTERY_SAVES) return null;
  if (now - lastCoachAt < COACH_GAP_MS) return null;
  const neutral = window.FF.CONFIG.restitution;
  const alreadyFlaring = d.restitution > neutral * 1.25;
  const need = d.axisNeeded;

  if (need === null || need === undefined) {
    // Unsurvivable at any bounciness — exoneration, only worth saying
    // to a player who actually tried.
    if (!alreadyFlaring) return null;
    lastCoachAt = now;
    return 'NOTHING WOULD HAVE SAVED THAT';
  }
  if (!d.flareWouldSave) return null;     // full flare wasn't enough
  if (alreadyFlaring) return null;        // they were already on it
  lastCoachAt = now;
  // Say HOW MUCH — the prescription is the teaching.
  if (need <= 0.35) return 'A TOUCH OF FLARE WOULD HAVE SAVED THAT';
  if (need <= 0.7) return 'HALF FLARE WOULD HAVE SAVED THAT';
  return 'FULL FLARE WOULD HAVE SAVED THAT';
}

// ---- Overlay ------------------------------------------------------
let overlay = null, titleEl = null, subEl = null, coachEl = null;
let shownTick = -1, hideAt = 0;

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'death-overlay';
  titleEl = document.createElement('div');
  titleEl.className = 'death-title';
  subEl = document.createElement('div');
  subEl.className = 'death-sub';
  coachEl = document.createElement('div');
  coachEl.className = 'death-coach';
  overlay.appendChild(titleEl);
  overlay.appendChild(subEl);
  overlay.appendChild(coachEl);
  document.body.appendChild(overlay);
}

let subscribed = false;
function ensureSubscriptions() {
  if (subscribed || !window.FF.events) return;
  subscribed = true;
  window.FF.events.on('nearMiss', noteNearMiss);
}

function update(state) {
  ensureSubscriptions();
  // After the flag the autopilot is driving: the death screen is
  // feedback for a player who is racing, and this player has stopped.
  // Swallow the certificate (shownTick) so it doesn't fire late when
  // the next race starts.
  const ap = window.FF.autopilot;
  if (ap && !ap.playerIsDriving()) {
    if (state.lastDeath) shownTick = state.lastDeath.tick;
    if (overlay) overlay.classList.remove('show');
    return;
  }
  const d = state.lastDeath;
  if (d && d.tick !== shownTick) {
    shownTick = d.tick;
    ensureOverlay();
    titleEl.textContent = classify(d);
    const who = d.name ? d.name.toUpperCase() : 'YOU';
    // Pair deaths: approach speed isn't the story; skip the number.
    subEl.textContent = d.byPair ? who : `${who} — ${(d.vn / 100).toFixed(1)} m/s`;
    const now = performance.now();
    const coach = coachLine(d, now);
    coachEl.textContent = coach || '';
    coachEl.style.display = coach ? '' : 'none';
    overlay.classList.add('show');
    // A coached death holds a beat longer: there's something to read.
    hideAt = now + (coach ? 3200 : 2200);
  }
  if (overlay && overlay.classList.contains('show') && performance.now() > hideAt) {
    overlay.classList.remove('show');
  }
}

// ---- Clean mode ---------------------------------------------------
let clean = true;
try { clean = localStorage.getItem('pf-clean') !== '0'; } catch (_) {}

function applyClean() {
  document.body.classList.toggle('clean', clean);
}

function buildToggle() {
  const btn = document.createElement('button');
  btn.id = 'cockpit-toggle';
  btn.textContent = '\u2026';
  btn.title = 'toggle cockpit';
  btn.addEventListener('click', () => {
    clean = !clean;
    try { localStorage.setItem('pf-clean', clean ? '1' : '0'); } catch (_) {}
    applyClean();
  });
  document.body.appendChild(btn);
  applyClean();
  // CLEAN MODE hides the tuning cockpit and the telemetry HUD rows —
  // a developer's switch, not a player's, so it lives behind the
  // same gate as the panel it controls.
  if (window.FF.devtools) {
    window.FF.devtools.register({
      show: () => { btn.style.display = ''; },
      hide: () => {
        btn.style.display = 'none';
        // A player must never be left in cockpit mode by a gate that
        // closed while it was on.
        clean = true;
        applyClean();
      },
    });
  }
}
if (typeof document !== 'undefined' && document.body) buildToggle();

window.FF = window.FF || {};
window.FF.deaths = { update, classify };

})();
