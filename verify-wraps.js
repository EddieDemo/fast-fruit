// verify-wraps.js
// The flag-wrap laws (ruled 2026-08-16).
//   A. BLEED, not scale: the wrap's emblem is the flag's emblem at
//      flag proportions on the central 1/(1+2*BLEED) of the artboard —
//      Japan's disc radius in wrap coords is the flag's divided by
//      1.5, never grown.
//   B. Full coverage: a wrap's ink is never null anywhere on the
//      artboard, including corners the sticker letterboxes away.
//   C. Edge-clamp extends bands along their run and fields in every
//      direction; China's canton red fills the far corner.
//   D. place() gives every wrap the ONE pose: centred, s = 2.0, rot 0,
//      regardless of seed or index.
//   E. maxScaleFor: wraps fixed at the pose scale, flag stickers cap
//      at 1.2, everything else keeps 2.6.
//   F. Pile grammar (editor pure laws): a wrap applies to the BOTTOM
//      and replaces any other wrap; stickers still arrive on top; a
//      touched wrap never raises; a touched sticker still does.

global.window = { FF: {} };
require('./js/dmath.js');
require('./js/terrain.js');
require('./js/decals.js');
require('./js/editor.js');

const D = window.FF.decals;
const P = window.FF.editor._pure;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

const at = (id, x, y) => {
  const c = D.sampleArt(D.byId(id), x, y);
  return c ? c.join(',') : null;
};

// A: bleed, not scale ---------------------------------------------------
{
  // jp flag disc radius 0.372 -> wrap disc radius 0.372/1.5 = 0.248.
  // Just inside: red. Just outside: white. And on the STICKER the same
  // radii read red/red — proving the wrap shrank the window, not the art.
  const S = 1 + 2 * D.WRAP_BLEED;
  const rIn = 0.372 / S - 0.02, rOut = 0.372 / S + 0.02;
  const ok = at('wrap-jp', rIn, 0) === '188,0,45'
    && at('wrap-jp', rOut, 0) === '246,246,246'
    && at('flag-jp', rIn, 0) === '188,0,45'
    && at('flag-jp', rOut, 0) === '188,0,45';
  check('A wrap disc at flag proportions in the central window', ok,
    'disc edge at ' + (0.372 / S).toFixed(3) + ' wrap coords');
}

// B: full coverage ---------------------------------------------------------
{
  let ok = true, worst = null;
  for (let j = 0; j <= 20 && ok; j++) {
    for (let i = 0; i <= 20; i++) {
      const x = i / 10 - 1, y = j / 10 - 1;
      if (at('wrap-vn', x, y) === null) { ok = false; worst = x + ',' + y; break; }
    }
  }
  check('B a wrap has ink everywhere on the artboard', ok, worst || 'all 441 points inked');
}

// C: edge-clamp extension -----------------------------------------------------
{
  const ok = at('wrap-fr', 0.99, 0.99) === '239,65,53'      // red band runs on
    && at('wrap-fr', -0.99, 0) === '0,85,164'               // blue band runs on
    && at('wrap-de', 0, -0.99) === '24,24,24'               // black top extends up
    && at('wrap-cn', 0.99, 0.99) === '238,28,37'            // field red to far corner
    && at('wrap-bd', -0.99, -0.99) === '0,106,78';          // green everywhere the disc isn't
  check('C bands run on, fields extend, corners belong to the field', ok);
}

// D: one pose ---------------------------------------------------------------
{
  const a = D.place({ seed: 123 }, 'wrap-jp', 0);
  const b = D.place({ seed: 999999 }, 'wrap-jp', 4);
  const c = D.place({ seed: 5 }, 'wrap-cn', 2);
  const P0 = D.WRAP_POSE;
  const same = (w) => w.u === P0.u && w.v === P0.v && w.rot === P0.rot && w.s === P0.s;
  check('D place() gives every wrap the one pose, seed-blind',
    same(a) && same(b) && same(c),
    'u=' + a.u.toFixed(3) + ' s=' + a.s);
}

// E: scale ceilings by kind -----------------------------------------------------
{
  const ok = D.maxScaleFor(D.byId('wrap-jp')) === D.WRAP_POSE.s
    && D.maxScaleFor(D.byId('flag-jp')) === 1.2
    && D.maxScaleFor(D.byId('mark-heart')) === 2.6
    && D.maxScaleFor(D.byId('eye-googly')) === 2.6;
  check('E ceilings: wrap fixed, flag sticker 1.2, others 2.6', ok);
}

// F: pile grammar -----------------------------------------------------------------
{
  const wdOf = (id) => ({ id, u: 1, v: 1, rot: 0, s: 0.3 });
  // wrap applies to the bottom
  const w1 = P.wornWithApplied([wdOf('eye-googly'), wdOf('mark-star')], wdOf('wrap-jp'), true);
  const okBottom = w1.map(w => w.id).join(',') === 'eye-googly,mark-star,wrap-jp';
  // second wrap replaces the first, stickers untouched
  const w2 = P.wornWithApplied(w1, wdOf('wrap-cn'), true);
  const okReplace = w2.map(w => w.id).join(',') === 'eye-googly,mark-star,wrap-cn';
  // a sticker still arrives on top of everything
  const w3 = P.wornWithApplied(w2, wdOf('mark-heart'), false);
  const okTop = w3[0].id === 'mark-heart' && w3[3].id === 'wrap-cn';
  // touching the wrap never raises it; touching a sticker still does
  const same = P.bumpForTouch(w3, 3) === w3;
  const bumped = P.bumpForTouch(w3, 2);
  const okBump = same && bumped[0].id === 'mark-star'
    && bumped[3].id === 'wrap-cn';
  check('F wrap: bottom, replace-only, floor of the pile; stickers ride on top',
    okBottom && okReplace && okTop && okBump,
    w3.map(w => w.id).join(','));
}

// G: WAVE A laws (2026-08-16) ------------------------------------------
{
  // overlays-first: Ghana's black star rides the gold band, sticker
  // and wrap alike, unscaled by the wrap window
  const okOverlay = at('flag-gh', 0, 0) === '24,24,24'
    && at('flag-gh', 0.4, 0) === '252,201,0'
    && at('wrap-gh', 0, 0) === '24,24,24'
    && at('wrap-gh', 0.16, 0) === '252,201,0';   // 0.2/1.5=0.133 wrap radius
  // weighted bands: Spain 1:2:1 puts yellow across the middle half;
  // Thailand's centre blue is double-weight
  const okWeights = at('flag-es', 0, 0) === '241,189,0'
    && at('flag-es', 0, -0.38) === '170,21,27'
    && at('flag-es', 0, 0.38) === '170,21,27'
    && at('flag-th', 0, 0) === '45,42,74'
    && at('flag-th', 0, -0.31) === '246,246,246';
  // weighted wrap: Spain's wrap centre stays yellow, edge-clamp keeps
  // the top red running to the artboard edge
  const okWrapW = at('wrap-es', 0, 0) === '241,189,0'
    && at('wrap-es', 0, -0.99) === '170,21,27';
  check('G Wave A: overlays ride bands, weights hold, wraps inherit both',
    okOverlay && okWeights && okWrapW);
}

// H: the CANTON (USA, 2026-08-16) -----------------------------------------
{
  const okFlag = at('flag-us', -0.5, -0.35) === '60,59,110'      // canton blue
    && at('flag-us', -0.8213, -0.5532) === '246,246,246'         // a star
    && at('flag-us', 0.3, -0.58) === '178,34,52'                 // stripe 1 red, right of canton
    && at('flag-us', -0.5, 0.09) === '246,246,246'               // stripe 8 white below canton
    && at('flag-us', 0, 0.6) === '178,34,52';                    // stripe 13 red
  const okWrap = at('wrap-us', -0.99, -0.99) === '60,59,110'     // canton bleeds to hoist-top
    && at('wrap-us', 0.99, 0.62) === '178,34,52'                 // stripes run on
    && at('wrap-us', -0.99, -0.37) === '60,59,110';              // clamped edge: blue, no star smear
  check('H canton: on stripes under stars, bleeds at the hoist', okFlag && okWrap);
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);