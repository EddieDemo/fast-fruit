// ============================================================
// DMATH — deterministic transcendentals for lockstep multiplayer.
//
// IEEE 754 pins + - * / sqrt to bit-exact results on every engine,
// but Math.sin/cos/pow/hypot are NOT spec-pinned: V8, JSC and
// SpiderMonkey may differ in the last bit. One ulp compounds through
// our (measured) chaotic sim into a full desync within seconds. So
// every transcendental the SIMULATION touches comes from here, built
// only from pinned operations. Presentation code may keep Math.*.
// (Math.atan2 survives in physics because it only feeds telemetry
// and FX — it never influences motion.)
//
// Accuracy ~1e-11 over game ranges — far below anything physical —
// and identical on every browser, which is the entire point.
// ============================================================

(function () {
'use strict';

const PI = Math.PI; // literal double: identical everywhere
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;

// ---- sin/cos: range-reduce to [-pi, pi], fold, odd Taylor deg 15 ----
function dsin(x) {
  x = x - Math.floor((x + PI) / TWO_PI) * TWO_PI; // floor/mul/sub: pinned
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1.6666666666666666e-1 + x2 * (8.333333333333333e-3
    + x2 * (-1.984126984126984e-4 + x2 * (2.7557319223985893e-6
    + x2 * (-2.505210838544172e-8 + x2 * (1.6059043836821613e-10
    + x2 * -7.647163731819816e-13)))))));
}

function dcos(x) {
  return dsin(x + HALF_PI);
}

// ---- ln: scale mantissa into [2/3, 4/3] by exact halvings/doublings,
// then atanh series: ln(m) = 2*(z + z^3/3 + z^5/5 + ...), z=(m-1)/(m+1)
function dln(x) {
  if (!(x > 0)) return NaN;
  let k = 0;
  while (x > 1.3333333333333333) { x *= 0.5; k++; }   // *0.5 is exact
  while (x < 0.6666666666666666) { x *= 2; k--; }     // *2 is exact
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let term = z, sum = 0;
  for (let n = 1; n <= 19; n += 2) { // z <= 0.2: converges very fast
    sum += term / n;
    term *= z2;
  }
  return 2 * sum + k * LN2;
}

// ---- exp: reduce by ln2, Taylor on [-ln2/2, ln2/2], exact 2^k scale
function dexp(x) {
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1, sum = 1;
  for (let n = 1; n <= 14; n++) {
    term *= r / n;
    sum += term;
  }
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2;
  else for (let i = 0; i < -k; i++) scale *= 0.5;
  return sum * scale;
}

// ---- pow for positive bases (all sim uses qualify) ----
function dpow(b, e) {
  if (b <= 0) return b === 0 ? 0 : NaN;
  if (e === 0) return 1;
  if (e === 1) return b;
  return dexp(e * dln(b));
}

window.FF = window.FF || {};
window.FF.dmath = { sin: dsin, cos: dcos, ln: dln, exp: dexp, pow: dpow };

})();
