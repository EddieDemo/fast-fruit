(function () {
'use strict';
// ============================================================
// FM — the voice engine. One primitive, and every sound in the game
// expressed as parameters to it.
//
// WHY FM. audio.js already synthesizes every sound from the sim's own
// numbers rather than playing samples — a hard landing sounds hard
// because the impulse the smash rule computed set its volume. FM is
// that same discipline applied to TIMBRE: no asset files, no
// licensing, a handful of oscillators, and it is the sound the
// project is aiming at (Yamaha-era Sega fusion — see
// docs/music-and-vibe.md).
//
// HOW IT WORKS, briefly, because the parameters are meaningless
// without it. A MODULATOR oscillator is wired into a CARRIER's
// frequency. Two numbers do nearly all the work:
//
//   RATIO — modulator frequency / carrier frequency.
//     Whole numbers give harmonic, musical tones (1, 2, 3...).
//     Non-integer ratios give bells, clanks, wet and metallic
//     things (1.7, 2.4...) — inharmonic on purpose.
//
//   INDEX — how hard the modulator pushes, in Hz of deviation.
//     Low index is nearly a sine. High index sprays sidebands and
//     turns bright, buzzy, aggressive.
//
// AN ENVELOPE ON THE INDEX is what makes FM sound alive rather than
// synthetic: bright and metallic at the attack, mellowing as it
// decays, exactly as struck and impacted things behave in the world.
// That single behaviour is most of what makes a Yamaha chip
// recognisable, and it is why the old noise-and-filter voices could
// never get there.
//
// THE SIM STILL DRIVES EVERYTHING. Impact speed already set volume
// and pitch; under FM it also sets the INDEX, so a hard landing is
// BRIGHTER as well as louder — which is how real impacts behave and
// what FM is best at. The doctrine deepens rather than changes.
//
// Presentation tier. Math.random is legitimate here (grain, detune)
// and nothing in this file can reach the simulation.
// ============================================================

// A single FM voice: one modulator into one carrier, with an
// amplitude envelope and an index envelope. Everything is scheduled
// against `t0` and torn down by itself.
//
//   ctx      AudioContext
//   dest     where the voice lands (master, or a panner)
//   o        {
//     t0        start time (defaults to now)
//     carrier   Hz at the attack
//     carrierTo Hz to glide to (optional — the pitch drop)
//     ratio     modulator = carrier * ratio
//     index     modulator depth in Hz at the attack
//     indexTo   depth to decay toward (default 0)
//     attack    seconds to peak amplitude
//     decay     seconds from peak to silence
//     indexDecay seconds for the index to fall (default = decay)
//     vol       peak amplitude
//     type      carrier waveform (default 'sine' — real FM)
//     modType   modulator waveform (default 'sine')
//     detune    cents, for thickening
//     wobble    { rate, depth, decay } — a LOW-frequency oscillator
//               on the carrier's pitch, with its own decay. This is
//               the difference between a THUD and a BOING: a thud is
//               a pitch that falls and stops; a boing is a pitch that
//               falls while OSCILLATING, because a springy thing
//               overshoots and comes back. Depth in Hz.
//     filter    { type, from, to, q } — a resonant filter swept
//               across the voice. A lowpass with real Q sweeping
//               DOWNWARD is the physical shape of something wet
//               closing over: it is what makes a squelch gloop
//               rather than hiss.
//   }
function voice(ctx, dest, o) {
  const t0 = o.t0 === undefined ? ctx.currentTime : o.t0;
  const attack = o.attack === undefined ? 0.004 : o.attack;
  const decay = o.decay === undefined ? 0.2 : o.decay;
  const idec = o.indexDecay === undefined ? decay : o.indexDecay;
  const vol = o.vol === undefined ? 0.2 : o.vol;
  const carrier = o.carrier || 220;
  const ratio = o.ratio === undefined ? 1 : o.ratio;
  const index = o.index === undefined ? 0 : o.index;
  const indexTo = o.indexTo === undefined ? 0 : o.indexTo;
  const end = t0 + attack + decay;

  // Carrier.
  const c = ctx.createOscillator();
  c.type = o.type || 'sine';
  if (o.detune) c.detune.value = o.detune;
  c.frequency.setValueAtTime(carrier, t0);
  if (o.carrierTo && o.carrierTo !== carrier) {
    // Exponential ramps cannot touch zero and hate sign changes.
    c.frequency.exponentialRampToValueAtTime(Math.max(1, o.carrierTo), end);
  }

  // Modulator -> carrier.frequency (this is the whole trick).
  let m = null, mg = null;
  if (index > 0) {
    m = ctx.createOscillator();
    m.type = o.modType || 'sine';
    m.frequency.setValueAtTime(carrier * ratio, t0);
    if (o.carrierTo && o.carrierTo !== carrier) {
      m.frequency.exponentialRampToValueAtTime(Math.max(1, o.carrierTo * ratio), end);
    }
    mg = ctx.createGain();
    // THE INDEX ENVELOPE: bright at the attack, mellowing after.
    mg.gain.setValueAtTime(index, t0);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.0001, indexTo), t0 + idec);
    m.connect(mg).connect(c.frequency);
  }

  // THE WOBBLE: a slow oscillator added to the same pitch input. Not
  // FM in the timbral sense — vibrato deep enough to hear as
  // MOVEMENT, which is what a spring does when it overshoots.
  let w = null;
  if (o.wobble && o.wobble.depth > 0) {
    w = ctx.createOscillator();
    w.type = 'sine';
    w.frequency.value = o.wobble.rate || 14;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(o.wobble.depth, t0);
    wg.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.wobble.decay || decay));
    w.connect(wg).connect(c.frequency);
  }

  // Amplitude envelope.
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  c.connect(g);

  // Optional resonant sweep between the voice and its destination.
  let node = g;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type || 'lowpass';
    f.Q.value = o.filter.q === undefined ? 1 : o.filter.q;
    f.frequency.setValueAtTime(o.filter.from || 4000, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.filter.to || 300), end);
    g.connect(f); node = f;
  }
  node.connect(dest);

  c.start(t0); c.stop(end + 0.02);
  if (m) { m.start(t0); m.stop(end + 0.02); }
  if (w) { w.start(t0); w.stop(end + 0.02); }
  return { end: end + 0.02 };
}

// NO SUSTAINED VOICE HERE ANY MORE. `drone()` lived here for the
// rolling and wind beds, and those were cut (see audio.js: the game
// is events, not beds) — so it went with them rather than sitting
// as speculative dead code. Music will want sustained voices, but it
// will want note-on/note-off, its own envelopes and a voice
// allocator; writing that when the music needs it will be cleaner
// than keeping a guess about it now.

window.FF = window.FF || {};
window.FF.fm = { voice };
})();
