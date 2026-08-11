(function () {
'use strict';
// ============================================================
// DAMAGE — the law of hurt, separated from the law of motion.
//
// physics.js owns the collision SOLVER: geometry, impulses, how
// bodies move. This module owns the DAMAGE LAW: given what a contact
// was (approach speed, effective mass, restitution, local curvature),
// how much structural harm each body suffers. The solver hands over
// raw contact quantities and never computes severity itself; the law
// never touches velocities. One boundary, both sides simpler.
//
// THE LAW (2026-08-11, replacing impulse-based severity): harm tracks
// the ENERGY DISSIPATED in the contact, not the impulse —
//
//   E_diss = 1/2 * (1 - e^2) * vn^2 / kn
//
// (vn = normal approach speed, kn = the contact's inverse effective
// mass from the solver, e = restitution actually applied). This is
// the physically honest model: a bouncy collision returns its energy
// and hurts LESS; a dead one eats it all. Under the old impulse law
// bounciness was the deadliest setting — the (1+e) factor — which
// inverted the planned flare mechanic; under this law e is armour,
// and the multi-bounce energy bleed after a big drop becomes a real
// survival skill. Severity = E_diss (in kilo-units, see SEV_SCALE)
// times the same curvature stress concentration as before, so the
// tips stay deadly and the egg's tip/blunt asymmetry carries over
// unchanged.
//
// PAIRS: restitution is a property of the collision PAIR, not of one
// body — the deader material dominates (rubber can't bounce off
// clay), so the pair uses e = min(eA, eB). The dissipated energy is
// then SHARED BY COMPLIANCE: each body's share is proportional to its
// own deadness (1 - e_i^2), normalized — the body that absorbs is the
// body that hurts. At equal e this reduces to half each. Choosing a
// low e to deaden a pack collision is therefore possible and COSTS
// you: you eat the larger share. Self-balancing by construction.
//
// PER-BODY RESTITUTION (the Phase-B hook): bodyRestitution(m) reads
// m.restitution when a body carries one and falls back to the live
// CONFIG value (which biome presets legitimately swap). Nothing else
// in the codebase needs to change when the flare stick lands — it
// will simply write m.restitution on the player.
//
// UNITS: raw dissipated energy at racing speeds is ~10^6, awkward for
// thresholds and sliders; SEV_SCALE keeps severity in the familiar
// thousands. A display constant with zero physical meaning.
//
// Deterministic: pinned arithmetic + dpow only, same on every peer.
// ============================================================

const { CONFIG, dmath } = window.FF;
const dpow = dmath.pow;
const dmathRef = dmath;

const SEV_SCALE = 1 / 1000;

// The restitution a body brings to a contact (Phase-B hook).
function bodyRestitution(m) {
  return m.restitution === undefined ? CONFIG.restitution : m.restitution;
}

// ---- SHAPE TOUGHNESS (2026-08-11, replacing per-contact stress
// concentration — Eddie's decision, ratified after the flare
// tournament): WHERE you land no longer matters; WHAT you are still
// does. The orientation mechanic never tested as a skill loop, it
// scrambled the flare mechanic's feedback (two hidden multipliers on
// every death), and it didn't generalize across shapes. But the
// curvature term was also the roster's entire material-character
// system, so it doesn't die — it becomes a SHAPE CONSTANT: each
// body's toughness factor is its pointwise concentration
// (R_flat/R)^exp averaged over UNIFORM LANDING ORIENTATION (the
// Gauss-map measure: weight = dphi = kappa*ds — the expected
// concentration of a random landing). One uniform law, derived from
// shape, no per-species stat: spheres come out at EXACTLY 1 (their
// per-contact value was always 1, so sphere behavior is unchanged to
// the bit), melons keep a tip-informed baseline, the egg's taper
// raises its average. Spin returns to being purely locomotion, and a
// fall's fate is sealed at launch except for the flare — which is
// what makes the practice-mode splat predictor honest.
const concCache = new Map();
function bodyToughness(m) {
  const key = m.a + ',' + m.b + ',' + (m.taper || 0) + ',' + CONFIG.curvExponent;
  let c = concCache.get(key);
  if (c === undefined) {
    c = shapeToughness(m.a, m.b, m.taper || 0);
    if (concCache.size > 128) concCache.clear();
    concCache.set(key, c);
  }
  return c;
}
// Fixed 256-sample quadrature over the parametric boundary (the
// tapered forms reduce to the ellipse at taper 0). Pinned arithmetic,
// fixed count: lockstep-safe.
function shapeToughness(a, b, taper) {
  const dsin = dmathRef.sin, dcos = dmathRef.cos;
  const Rflat = (a * a) / b;
  let num = 0, den = 0;
  for (let i = 0; i < 256; i++) {
    const t = ((i + 0.5) / 256) * 6.283185307179586;
    const c = dcos(t), s = dsin(t);
    const dx = -a * s;
    const dy = b * (c + taper - 2 * taper * c * c);
    const sp2 = dx * dx + dy * dy;
    const sp = Math.sqrt(sp2);
    const kNum = a * b * (1 + taper * c * (2 * c * c - 3)); // curvature numerator
    const R = (sp2 * sp) / kNum;
    const w = kNum / sp2; // kappa * |p'| = dphi/dt (Gauss-map weight)
    num += dpow(Rflat / R, CONFIG.curvExponent) * w;
    den += w;
  }
  return num / den;
}

// Energy dissipated in a contact (kilo-units). Zero for separating or
// resting contacts (vn >= 0, or vn tiny -> vn^2 negligible), which is
// what keeps idle ground contact harmless without a special case.
function dissipated(vn, kn, e) {
  if (vn >= 0 || kn <= 0) return 0;
  return 0.5 * (1 - e * e) * vn * vn / kn * SEV_SCALE;
}

// Severity of a contact for body m: energy times the body's SHAPE
// toughness — orientation-independent by design.
function severityFromE(E, m) {
  return E * bodyToughness(m);
}

// Pair energy shares by compliance: proportional to each body's own
// deadness. Equal e -> half each; a dead body against a lively one
// eats nearly everything.
function pairShares(eA, eB) {
  const dA = 1 - eA * eA, dB = 1 - eB * eB;
  const s = dA + dB;
  if (s <= 0) return [0.5, 0.5]; // both perfectly elastic: nothing to share
  return [dA / s, dB / s];
}

// The flare stick's mapping (Phase B): a smoothed bounce axis in
// [-1, +1] becomes this body's restitution. Neutral (0) is EXACTLY
// the live CONFIG value — a passive player's physics doesn't move a
// bit. Full up lerps to CONFIG.bounceMax (capped well below 1:
// perfect elasticity would be immortality under the energy law, and
// monster drops must still demand the multi-bounce bleed). Full down
// lerps to dead rubber. Piecewise linear; pinned arithmetic.
function bounceToRestitution(axis) {
  const n = CONFIG.restitution;
  if (axis >= 0) return n + (CONFIG.bounceMax - n) * axis;
  return n + n * axis; // axis in [-1,0): lerp toward 0
}

window.FF.damage = { bodyRestitution, bodyToughness, shapeToughness, dissipated, severityFromE, pairShares, bounceToRestitution, SEV_SCALE };
})();