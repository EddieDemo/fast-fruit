(function () {
'use strict';
// ============================================================
// TUNING — one key for the whole game.
//
// WHY THIS EXISTS. Sound effects and music that are tuned separately
// will fight: a lap chime in A over a track in C is a wrong note
// every lap, and no amount of good writing fixes it. So there is ONE
// key, stated here, and everything pitched reads it — the chimes, the
// blips, and (later) the music. A future daily that picks its own key
// from the day's seed moves this root, and the sound effects
// transpose with it FOR FREE, because they ask for scale degrees
// rather than frequencies.
//
// THE GAME WAS ALREADY IN A. The lap and finish chimes shipped at
// 660 / 880 / 1320 Hz, which are E5, A5 and E6 to within a cent —
// the fifth resolving up to the tonic, then the octave. That was
// never written down; this module writes it down. Adopting A as the
// root means the existing chimes need no retuning at all.
//
// THE SCALE is A LYDIAN DOMINANT by default (1 2 3 #4 5 6 b7): the
// brightest scale that still has a flat seventh in it, which is
// exactly the Sega-fusion sound the direction note is aiming at (see
// docs/music-and-vibe.md). The #4 is the "arcade" colour and the b7
// is the fusion one. Nothing is forced to use every degree — the
// effects mostly want 1, 4, 5 and 9.
//
// Equal temperament, A4 = 440. Presentation tier: this never touches
// the simulation, so ordinary Math is fine here.
// ============================================================

const A4 = 440;
const A4_MIDI = 69;

const SCALES = {
  major:          [0, 2, 4, 5, 7, 9, 11],
  lydian:         [0, 2, 4, 6, 7, 9, 11],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  mixolydian:     [0, 2, 4, 5, 7, 9, 10],
  dorian:         [0, 2, 3, 5, 7, 9, 10],
  minorPentatonic:[0, 3, 5, 7, 10],
};

// The live key. rootMidi 57 = A3, the octave the effects sit around.
const state = {
  rootMidi: 57,
  scale: 'lydianDominant',
};

function setKey(rootMidi, scaleName) {
  if (typeof rootMidi === 'number') state.rootMidi = rootMidi;
  if (scaleName && SCALES[scaleName]) state.scale = scaleName;
  return { rootMidi: state.rootMidi, scale: state.scale };
}
function key() { return { rootMidi: state.rootMidi, scale: state.scale }; }

function midiToHz(m) {
  return A4 * Math.pow(2, (m - A4_MIDI) / 12);
}

// A SCALE DEGREE, in semitones above the root. Degrees wrap and carry
// octaves: degree 7 is the root an octave up, degree -1 is the note
// below. This is the function everything pitched should call.
function degreeToMidi(degree, octaveOffset) {
  const steps = SCALES[state.scale];
  const n = steps.length;
  const oct = Math.floor(degree / n) + (octaveOffset || 0);
  const idx = ((degree % n) + n) % n;
  return state.rootMidi + steps[idx] + 12 * oct;
}

// Hz for a scale degree. `deg(0)` is the root, `deg(4)` the fifth,
// `deg(8)` the ninth, and so on.
function deg(degree, octaveOffset) {
  return midiToHz(degreeToMidi(degree, octaveOffset));
}

// Hz for a raw semitone offset from the root, for the rare sound that
// wants a note the scale does not contain (a deliberate dissonance).
function semi(semitones) {
  return midiToHz(state.rootMidi + semitones);
}

// A key from a seed, for the day-keyed music that will follow. Kept
// here so the rule lives with the tuning rather than in the composer:
// the daily moves the ROOT and leaves the scale alone, so every day
// sounds like the same game in a different key rather than a
// different game.
function keyForSeed(seed) {
  const s = (seed >>> 0);
  // Five roots around A, all comfortable for the effects' octave.
  const roots = [57, 55, 60, 62, 53]; // A3 G3 C4 D4 F3
  return roots[s % roots.length];
}

window.FF = window.FF || {};
window.FF.tuning = { setKey, key, deg, semi, midiToHz, degreeToMidi, keyForSeed, SCALES, A4 };
})();
