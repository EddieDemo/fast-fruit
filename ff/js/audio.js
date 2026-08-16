// ============================================================
// AUDIO — procedural, physics-driven sound. No asset files: every
// sound is synthesized by Web Audio from the sim's own numbers, so
// the audio is HONEST — a hard landing sounds hard because the very
// impulse the smash rule computes sets its volume.
//
// Entirely presentation-side: reads state, never writes it. Free to
// use Math.random for texture (grain jitter) with zero determinism
// risk.
//
// THE GAME IS EVENTS, NOT BEDS (Eddie's ruling, 2026-08-14). The two
// continuous noise layers — `rolling` (bandpassed noise tracking
// omega) and `wind` (highpassed noise tracking airspeed) — are GONE,
// for four reasons worth keeping written down so they do not creep
// back:
//   * NOT HONEST. A melon rolling on dirt is nearly silent. The layer
//     was borrowed engine noise from racing games that have engines;
//     this one has a fruit.
//   * REDUNDANT. Spin is already legible from the rotating body, the
//     scrolling terrain, the HUD readout and the stick in your hand.
//   * IT WOULD RUIN THE MUSIC. A constant noise bed on a phone
//     speaker is hiss under the mix — and it is the most fatiguing
//     thing in a five-to-ten minute cup, which makes it the likeliest
//     reason a player reaches for mute and loses every other sound.
//   * IT WAS THE EXPENSIVE ONE: two oscillators running for the whole
//     race, versus events that cost nothing when nothing is
//     happening.
// The silence between impacts is what makes the smash land. If the
// feedback is ever missed, the replacement is rotation-locked TICKS
// (one per contact as the body turns) — rhythmic, physics-honest,
// free when slow, and it sits WITH music rather than under it.
//
// Events (edge-detected each frame):
//   landing  — thud sized by impact speed (telemetry vn)
//   smash    — noise burst + falling squelch; bots' smashes are
//              distance-attenuated and stereo-panned
//   nearMiss — short high tick alongside the white flash
//   lap      — two-note chime; finish — rising triad
//   respawn  — soft pop
//
// Browsers require a user gesture before audio: the first touch or
// keypress (which the control scheme guarantees) unlocks the context.
// Mute toggle persists in localStorage.
// ============================================================

(function () {
'use strict';

let ctx = null;          // AudioContext, created on first gesture
let master = null;       // master gain (mute lives here)
let noiseBuf = null;     // shared white-noise buffer (thud click, squelch body)
let muted = false;
try { muted = localStorage.getItem('pf-muted') === '1'; } catch (_) {}

// Stats counter: lets the headless suite verify event detection
// without an AudioContext.
const stats = { landings: 0, smashes: 0, nearMisses: 0, laps: 0, respawns: 0 };

// ---- Bootstrapping ----
function ensureContext() {
  if (ctx || typeof AudioContext === 'undefined') return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  // 2s of white noise, looped by every noise voice.
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

function unlock() {
  ensureContext();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
if (typeof window.addEventListener === 'function') {
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (ctx && document.visibilityState === 'visible' && !muted) ctx.resume();
    });
  }
}

// ---- Small synth vocabulary ----
function envGain(t0, peak, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  g.connect(master);
  return g;
}

// Low thud: pitch-dropping triangle + noise click.
function thud(vol, baseFreq) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = envGain(t, vol, 0.16);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(baseFreq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, baseFreq * 0.4), t + 0.12);
  o.connect(g); o.start(t); o.stop(t + 0.18);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass'; nf.frequency.value = 900;
  const ng = envGain(t, vol * 0.5, 0.05);
  n.connect(nf).connect(ng); n.start(t); n.stop(t + 0.08);
}

// The squelch: wet noise + two detuned oscillators sliding down.
function squelch(vol, pan) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 1;
  let dest = out;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    out.connect(p); p.connect(master);
  } else {
    out.connect(master);
  }
  // Wet noise body.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.setValueAtTime(2600, t);
  nf.frequency.exponentialRampToValueAtTime(180, t + 0.28);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  n.connect(nf).connect(ng).connect(dest);
  n.start(t); n.stop(t + 0.35);
  // Falling glorp.
  for (const det of [1, 1.31]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140 * det, t);
    o.frequency.exponentialRampToValueAtTime(38 * det, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(og).connect(dest);
    o.start(t); o.stop(t + 0.3);
  }
}

function blip(freq, vol, decay, delay) {
  if (!ctx) return;
  const t = ctx.currentTime + (delay || 0);
  const g = envGain(t, vol, decay);
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  o.connect(g); o.start(t); o.stop(t + decay + 0.02);
}

function vibrate(ms) {
  try { if (navigator.vibrate && !muted) navigator.vibrate(ms); } catch (_) {}
}

// ---- Per-frame update: continuous layers + event edges ----
const prev = {
  grounded: true, alive: true, flashHot: false,
  lapIndex: 0, finished: false,
  botAlive: [],
};

function update(state, dtFrame) {
  const m = state.melon;
  // Autopilot: keep the edges tracked (so prev stays honest and the
  // next race doesn't fire a phantom smash on its first frame) but
  // play nothing. A squelch over the results panel is the sound of a
  // race the player is no longer in.
  const ap = window.FF.autopilot;
  if (ap && !ap.playerIsDriving()) {
    prev.grounded = m.grounded;
    prev.alive = m.alive;
    return;
  }

  // --- Event edges (run even before ctx exists, for stats/haptics) ---
  // Landing: airborne -> grounded with a real impact behind it.
  if (m.alive && m.grounded && !prev.grounded) {
    const vn = Math.abs(state.telemetry.lastImpactVn || 0);
    if (vn > 120) {
      stats.landings++;
      const vol = Math.min(0.5, 0.05 + (vn / 2000) * 0.5);
      thudSafe(vol, 90 + Math.min(80, vn / 25));
      if (vn > 900) vibrate(20);
    }
  }

  // Local smash / respawn.
  if (!m.alive && prev.alive) {
    stats.smashes++;
    squelchSafe(0.6, 0);
    vibrate([30, 40, 60]);
  }
  if (m.alive && !prev.alive) {
    stats.respawns++;
    blipSafe(300, 0.12, 0.09, 0);
  }

  // Bot smashes: distance-attenuated, panned by side.
  const bots = state.bots;
  for (let i = 0; i < bots.length; i++) {
    const alive = bots[i].melon.alive;
    if (prev.botAlive[i] === true && !alive) {
      stats.smashes++;
      let dx = bots[i].melon.x - m.x;
      if (state.period) {
        const L = state.period.L;
        dx = dx - Math.round(dx / L) * L; // nearest image distance
      }
      const dist = Math.abs(dx);
      const vol = 0.55 / (1 + dist / 900);
      if (vol > 0.02) squelchSafe(vol, Math.max(-1, Math.min(1, dx / 800)));
    }
    prev.botAlive[i] = alive;
  }

  // Near-miss flash rising edge.
  const flashHot = state.fx.flash > 0.7;
  if (flashHot && !prev.flashHot) {
    stats.nearMisses++;
    blipSafe(1900, 0.1, 0.05, 0);
  }
  prev.flashHot = flashHot;

  // Lap / finish chimes.
  const race = state.race;
  if (race.mode === 'track') {
    if (race.lapIndex > prev.lapIndex && race.finishedTick === null) {
      stats.laps++;
      blipSafe(660, 0.12, 0.1, 0);
      blipSafe(880, 0.12, 0.12, 0.09);
    }
    const finished = race.finishedTick !== null;
    if (finished && !prev.finished) {
      stats.laps++;
      blipSafe(660, 0.14, 0.1, 0);
      blipSafe(880, 0.14, 0.1, 0.1);
      blipSafe(1320, 0.16, 0.22, 0.2);
    }
    prev.finished = finished;
    prev.lapIndex = race.lapIndex;
  }

  prev.grounded = m.grounded;
  prev.alive = m.alive;

  // No continuous layers: every sound in this file is an EVENT, so
  // there is nothing to steer per frame and nothing running between
  // impacts.
}

// Safe wrappers: no-ops before the context exists.
function thudSafe(v, f) { if (ctx) thud(v, f); }
function squelchSafe(v, p) { if (ctx) squelch(v, p); }
function blipSafe(f, v, d, del) { if (ctx) blip(f, v, d, del); }

// ---- Mute toggle ----
function setMuted(v) {
  muted = v;
  try { localStorage.setItem('pf-muted', v ? '1' : '0'); } catch (_) {}
  if (master) master.gain.value = v ? 0 : 1;
}

function buildToggle() {
  if (typeof document === 'undefined' || !document.body) return;
  const btn = document.createElement('button');
  btn.id = 'snd-toggle';
  btn.textContent = muted ? 'snd off' : 'snd on';
  btn.addEventListener('click', () => {
    setMuted(!muted);
    btn.textContent = muted ? 'snd off' : 'snd on';
    unlock();
  });
  document.body.appendChild(btn);
}
// The floating corner toggle is RETIRED: sound is a setting, and
// settings live on the pause screen now. A phone whose entire input
// model is "one thumb, anywhere" cannot afford eight persistent
// controls around the play area. buildToggle survives unused for a
// build that wants the old chrome back.

window.FF = window.FF || {};
window.FF.audio = {
  update, setMuted, stats,
  isMuted: () => muted,
  // Toggling from a UI control must also UNLOCK the audio context:
  // browsers only allow that inside a user gesture, and the pause
  // screen's tap is one.
  toggleMuted: () => { setMuted(!muted); unlock(); return muted; },
};

})();
