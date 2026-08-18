// ============================================================
// PXFONT — the bitmap pixel font (PIXEL 320, Phase 3.1).
//
// Canvas text at 320 is unsalvageable: glyphs anti-alias into mush
// (the billboard copy was the first measured casualty of the whole
// pixelation effort). Period games carried a bitmap font; this is
// ours. One authored 3x5 face (digits, A-Z, the punctuation the game
// actually uses), drawn as integer fillRects in a caller-supplied
// palette tone — the font NEVER mints colours, so every glyph pixel
// is honest by construction. Integer scale gives the headline sizes.
//
// Glyph format: 5 rows of 3 bits, packed low-row-first into one
// number (15 bits). Row bit order: leftmost column = bit 2.
// Node-safe: verify-px-honesty loads it directly.
// ============================================================
(function () {
'use strict';

const W = 3, H = 5;
const G = {
  '0': 0b111101101101111, '1': 0b010110010010111, '2': 0b111001111100111,
  '3': 0b111001111001111, '4': 0b101101111001001, '5': 0b111100111001111,
  '6': 0b111100111101111, '7': 0b111001001010010, '8': 0b111101111101111,
  '9': 0b111101111001111,
  'A': 0b010101111101101, 'B': 0b110101110101110, 'C': 0b011100100100011,
  'D': 0b110101101101110, 'E': 0b111100110100111, 'F': 0b111100110100100,
  'G': 0b011100101101011, 'H': 0b101101111101101, 'I': 0b111010010010111,
  'J': 0b001001001101010, 'K': 0b101110100110101, 'L': 0b100100100100111,
  'M': 0b101111111101101, 'N': 0b101111111111101, 'O': 0b010101101101010,
  'P': 0b110101110100100, 'Q': 0b010101101011001, 'R': 0b110101110110101,
  'S': 0b011100010001110, 'T': 0b111010010010010, 'U': 0b101101101101011,
  'V': 0b101101101010010, 'W': 0b101101111111101, 'X': 0b101101010101101,
  'Y': 0b101101010010010, 'Z': 0b111001010100111,
  ' ': 0b000000000000000, '-': 0b000000111000000, '.': 0b000000000000010,
  ':': 0b000010000010000, '!': 0b010010010000010, '/': 0b001001010100100,
  "'": 0b010010000000000, 'M2': 0,
};
// rows are packed top-first: row r occupies bits [ (H-1-r)*W .. )
function rowBits(g, r) { return (g >> ((H - 1 - r) * W)) & 0b111; }

// Draw text at integer (x, y) top-left, in ONE colour, at integer
// scale. Returns the advance width. Unknown characters render as a
// filled box (visible, never silent).
function draw(ctx, text, x, y, scale, color) {
  const sc = Math.max(1, scale | 0);
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = color;
  let cx = x;
  const t = String(text).toUpperCase();
  for (let i = 0; i < t.length; i++) {
    const g = G[t[i]];
    if (g === undefined) {
      ctx.fillRect(cx, y, W * sc, H * sc);           // the visible box
    } else {
      for (let r = 0; r < H; r++) {
        const bits = rowBits(g, r);
        for (let c = 0; c < W; c++) {
          if (bits & (1 << (W - 1 - c))) {
            ctx.fillRect(cx + c * sc, y + r * sc, sc, sc);
          }
        }
      }
    }
    cx += (W + 1) * sc;                              // 1px letter gap
  }
  return cx - x - sc;                                // trailing gap trimmed
}

function measure(text, scale) {
  const sc = Math.max(1, scale | 0);
  const n = String(text).length;
  return n === 0 ? 0 : n * (W + 1) * sc - sc;
}

const api = { draw, measure, W, H, glyphs: G };
if (typeof window !== 'undefined') {
  window.FF = window.FF || {};
  window.FF.pxfont = api;
}
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
