(function () {
'use strict';
// ============================================================
// DEVTOOLS — the gate.
//
// The Shader Studio, the tune panel and the ring logger are
// indispensable to development and meaningless to a player: a paint
// palette in the corner and a bank of physics sliders read as either
// broken or as someone else's debug build. They are not removed —
// they are GATED, and the gate is deliberately hard to open by
// accident and trivial to open on purpose.
//
// THE HANDLE: five taps on the title on the main menu. That mirrors
// the convention every phone owner has already met (tapping a build
// number to unlock developer options), it sits OUTSIDE the play area
// so it cannot fire mid-race, and it is on a screen you have to
// choose to visit. A gesture in the play area would eventually be
// triggered by a thumb.
//
// Also: ?dev=1 in the URL turns it on, ?dev=0 turns it off — because
// on a desktop, tapping a title five times to fix a slider is a
// silly ritual, and because a URL is shareable with a tester.
//
// The state PERSISTS: once you have opened the tools they stay open
// across reloads until explicitly closed, so debugging does not
// require the ritual every time you refresh.
//
// Modules register themselves rather than being switched on from
// here: devtools does not need to know what a Shader Studio is, only
// that something wants to appear when the gate opens.
// ============================================================

const KEY = 'ff.dev';
const TAPS_NEEDED = 5;
const TAP_WINDOW_MS = 2500;   // the taps must be a deliberate burst

let on = false;
const consumers = [];         // { show, hide }
let taps = 0;
let firstTapAt = 0;

function readStored() {
  try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
}
function store(v) {
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch (_) {}
}

function isOn() { return on; }

// How much vertical space the dev stack occupies, published so that
// PLAYER UI can step around it rather than each element hard-coding a
// dev-aware offset. Zero when the gate is shut, which is the only
// state a player ever sees.
const LANE_SLOTS = 5;   // tune, cockpit, studio, grant-all, px-capture

function publishLane() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const step = 40;
  document.documentElement.style.setProperty(
    '--dev-lane-h', on ? (LANE_SLOTS * step) + 'px' : '0px');
}

function apply() {
  publishLane();
  for (const c of consumers) {
    try { (on ? c.show : c.hide)(); } catch (err) { console.warn('FF.devtools consumer failed:', err); }
  }
}

// A module that should only exist in dev mode registers here. It is
// shown immediately if the gate is already open, so registration
// order never matters.
function register(consumer) {
  consumers.push(consumer);
  try { (on ? consumer.show : consumer.hide)(); } catch (err) { console.warn('FF.devtools consumer failed:', err); }
}

function enable(quiet) {
  if (on) return false;
  on = true;
  store(true);
  apply();
  if (!quiet) announce('developer tools ON');
  return true;
}

function disable() {
  if (!on) return false;
  on = false;
  store(false);
  apply();
  announce('developer tools off');
  return true;
}

function toggle() { return on ? disable() : enable(); }

// A brief, unobtrusive confirmation — the ritual needs feedback or it
// feels broken when it works.
function announce(text) {
  if (typeof document === 'undefined' || !document.body) return;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);'
    + 'z-index:60;padding:8px 14px;border-radius:999px;pointer-events:none;'
    + 'background:rgba(10,14,10,0.9);border:1px solid #2a5a34;color:#39ff5f;'
    + 'font-family:var(--mono,ui-monospace,monospace);font-size:var(--fs-label,11px);'
    + 'letter-spacing:0.08em;opacity:0;transition:opacity .15s';
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 1400);
}

// Arm an element as the handle. Counting resets if the taps are slow,
// so ordinary interaction with the element can never accumulate into
// an accidental unlock over a session.
function arm(el) {
  if (!el || el._ffArmed) return;
  el._ffArmed = true;
  el.style.cursor = 'default';
  el.addEventListener('click', () => {
    const t = Date.now();
    if (t - firstTapAt > TAP_WINDOW_MS) { taps = 0; firstTapAt = t; }
    taps++;
    if (taps >= TAPS_NEEDED) {
      taps = 0;
      toggle();
    } else if (taps >= 3 && !on) {
      // Halfway feedback, so the ritual is discoverable-by-persistence
      // rather than a secret only the author knows.
      announce((TAPS_NEEDED - taps) + ' more');
    }
  });
}

function init() {
  // URL wins over the stored state: a link is an explicit instruction.
  let fromUrl = null;
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('dev')) fromUrl = q.get('dev') !== '0';
  } catch (_) {}
  on = fromUrl === null ? readStored() : fromUrl;
  if (fromUrl !== null) store(on);
  apply();
}

window.FF = window.FF || {};
window.FF.devtools = { init, arm, register, isOn, enable, disable, toggle, TAPS_NEEDED };
})();
