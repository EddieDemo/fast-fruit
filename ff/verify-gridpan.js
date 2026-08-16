// verify-gridpan.js
// The grid walk, held to its stated laws — gridstart is DOM-free, so
// the whole ceremony verifies headless.
//   A. Duration law: ticks derive from real grid extent at PAN_SPEED,
//      clamped both ends; a one-body grid gets the minimum (a held
//      close-up, not a crash).
//   B. The sweep: x travels tail -> pole, monotonically, linearly —
//      starts on the tail body, ends on the pole body.
//   C. y rides the field: between two bodies the shot's y lerps
//      between THEIR y, not a fixed height.
//   D. The touch cut: arm() mid-walk flips to ready AND drops
//      camera.initialized (the renderer's snap trigger).
//   E. The timeout cut: the walk expiring does the same.
//   F. Determinism: same grid, same tick -> same shot, twice over.
//   G. No shot outside the pan phase.

global.window = { FF: {} };
require('./js/gridstart.js');
const G = window.FF.gridStart;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
}

function makeState(bodies) {
  return {
    tick: 1000,
    melon: bodies[0],
    bots: bodies.slice(1).map(m => ({ melon: m })),
    camera: { x: 0, y: 0, initialized: true },
  };
}
function body(x, y) { return { x, y, pinX: null, pinY: null }; }

// A: duration law -----------------------------------------------------------
{
  // 12 bodies over 2200px -> 2200/900*120 = 293 ticks, inside clamps
  const bodies = [];
  for (let i = 0; i < 12; i++) bodies.push(body(i * 200, 50));
  const gs = makeState(bodies);
  G.begin(gs);
  const s0 = G.cameraShot(gs);
  const expect = Math.round(2200 / G.PAN_SPEED * 120);
  // walk ticks are internal; recover from when the shot reaches the pole
  let reached = null;
  for (let t = 0; t <= G.PAN_MAX_TICKS + 5; t++) {
    gs.tick = 1000 + t;
    const s = G.cameraShot(gs);
    if (s && s.x >= 2200 - 1e-6 && reached === null) reached = t;
    G.update(gs);
    if (G.phase() !== 'pan') break;
  }
  const okMain = Math.abs(reached - expect) <= 1;
  // clamps: tiny grid floors at PAN_MIN_TICKS, huge grid caps at MAX
  const tiny = makeState([body(0, 0), body(10, 0)]);
  G.begin(tiny);
  let tinyEnd = 0;
  for (let t = 0; t <= G.PAN_MAX_TICKS + 5; t++) {
    tiny.tick = 1000 + t; G.update(tiny);
    if (G.phase() !== 'pan') { tinyEnd = t; break; }
  }
  const huge = makeState([body(0, 0), body(999999, 0)]);
  G.begin(huge);
  let hugeEnd = 0;
  for (let t = 0; t <= G.PAN_MAX_TICKS + 5; t++) {
    huge.tick = 1000 + t; G.update(huge);
    if (G.phase() !== 'pan') { hugeEnd = t; break; }
  }
  const solo = makeState([body(0, 0)]);
  G.begin(solo);
  const soloShot = G.cameraShot(solo);
  check('A duration from extent, clamped; solo grid holds a close-up',
    okMain && tinyEnd === G.PAN_MIN_TICKS && hugeEnd === G.PAN_MAX_TICKS
    && s0 && soloShot && soloShot.x === 0,
    'pole reached t=' + reached + ' (expect ~' + expect + '), clamps '
    + tinyEnd + '/' + hugeEnd);
}

// B: the sweep --------------------------------------------------------------
{
  const bodies = [body(500, 10), body(0, 20), body(900, 30), body(300, 40)];
  const gs = makeState(bodies);
  G.begin(gs);
  let prev = -Infinity, mono = true;
  let first = null, last = null;
  for (let t = 0; ; t++) {
    gs.tick = 1000 + t;
    const s = G.cameraShot(gs);
    if (!s) break;
    if (first === null) first = s.x;
    last = s.x;
    if (s.x < prev - 1e-9) mono = false;
    prev = s.x;
    G.update(gs);
    if (G.phase() !== 'pan') { last = G.cameraShot(gs) ? G.cameraShot(gs).x : last; break; }
  }
  check('B sweeps tail (0) -> pole (900), monotone',
    mono && Math.abs(first - 0) < 1e-9 && Math.abs(last - 900) < 4,
    first + ' -> ' + last.toFixed(1));
}

// C: y rides the field --------------------------------------------------------
{
  const bodies = [body(0, 100), body(1000, 300)];
  const gs = makeState(bodies);
  G.begin(gs);
  // halfway through the walk the camera is at x=500 -> y must be 200
  const w = Math.max(G.PAN_MIN_TICKS, Math.round(1000 / G.PAN_SPEED * 120));
  gs.tick = 1000 + Math.round(w / 2);
  const s = G.cameraShot(gs);
  check('C y lerps between the bodies being passed',
    s && Math.abs(s.x - 500) < 6 && Math.abs(s.y - (100 + s.x / 1000 * 200)) < 1,
    s && ('x=' + s.x.toFixed(1) + ' y=' + s.y.toFixed(1)));
}

// D + E: both cuts drop camera.initialized -------------------------------------
{
  const gs = makeState([body(0, 0), body(600, 0)]);
  G.begin(gs);
  gs.camera.initialized = true;
  gs.tick = 1010;
  const did = G.arm(gs);                           // touch mid-walk
  // A FRESH press mid-walk both cuts and starts the countdown (the
  // one-tap-not-two rule), so the phase after is COUNT; the cut is
  // the dropped camera flag.
  const okTouch = did === 'started' && G.phase() === 'count'
    && gs.camera.initialized === false;

  const gs2 = makeState([body(0, 0), body(600, 0)]);
  G.begin(gs2);
  gs2.camera.initialized = true;
  for (let t = 0; t <= G.PAN_MAX_TICKS + 5; t++) {
    gs2.tick = 1000 + t; G.update(gs2);
    if (G.phase() !== 'pan') break;
  }
  const okTimeout = G.phase() === 'ready' && gs2.camera.initialized === false;
  check('D touch cut: skip-and-start, camera snap armed', okTouch);
  check('E timeout cut: ready + camera snap armed', okTimeout);
}

// F: determinism ---------------------------------------------------------------
{
  const mk = () => {
    const gs = makeState([body(0, 5), body(400, 15), body(800, 25)]);
    G.begin(gs);
    const out = [];
    for (const t of [0, 30, 77, 120]) {
      gs.tick = 1000 + t;
      const s = G.cameraShot(gs);
      out.push(s ? s.x.toFixed(6) + ',' + s.y.toFixed(6) : 'null');
    }
    return out.join(';');
  };
  check('F same grid, same ticks -> same shots', mk() === mk());
}

// G: no shot outside the pan ------------------------------------------------------
{
  const gs = makeState([body(0, 0), body(500, 0)]);
  G.begin(gs);
  gs.tick = 1005;
  G.arm(gs);                                       // -> ready
  const s = G.cameraShot(gs);
  G.cancel();
  check('G shot exists only during the walk', s === null && G.cameraShot(gs) === null);
}

// H: THE EASING IS REAL — verified by velocity, not position. Every
// position check above passes identically for linear travel (both
// start at the tail, end at the pole, hit the midpoint at half time),
// which is exactly how a failed easing patch shipped as "eased" once.
// Speed near the ends must be a small fraction of mid-walk speed.
{
  const gs = makeState([body(0, 0), body(2200, 0)]);
  G.begin(gs);
  const T = Math.round(2200 / G.PAN_SPEED * 120);
  const speedAt = (f) => {
    gs.tick = 1000 + Math.round(T * f);
    const a = G.cameraShot(gs).x;
    gs.tick += 1;
    const b = G.cameraShot(gs).x;
    return b - a;
  };
  const early = speedAt(0.05), mid = speedAt(0.5), late = speedAt(0.93);
  const ok = early < mid * 0.45 && late < mid * 0.45 && mid > 0;
  check('H eased velocity: slow ends, fast middle',
    ok, 'px/tick early ' + early.toFixed(2) + ' mid ' + mid.toFixed(2)
    + ' late ' + late.toFixed(2) + ' (linear would be flat)');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall clear');
process.exit(failures ? 1 : 0);