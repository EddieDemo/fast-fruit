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
// ---- THE CLUSTER LEDGER (2026-08-13, replacing per-tick max) ----
// A landing is judged as ONE event: every unit of energy dissipated
// within its CONTACT CLUSTER — every contact, every tick — is summed,
// and the total is what faces the threshold. Under the old rule the
// tick's worst single blow was judged alone, which made the verdict a
// function of how the solver happened to slice the event: a wedge
// landing split over two walls read at roughly HALF its honest energy
// (measured: a 6 m drop reads 98% of lethal on flat, 41% in a 35-
// degree vee under max — but 75% in true total energy), and a landing
// smeared across ticks by corner geometry was forgiven the same way.
// Energy absorbed is additive and rind does not heal between tick 3
// and tick 4 of one landing; the cluster total IS the physical
// quantity. Equal-energy events now get equal verdicts regardless of
// how the discretization sliced them.
//
// THE BOUNDARY (promoted from pilot.js, where the predictor ratified
// it in the field): a cluster ends when the body ROLLS ON (more than
// CLUSTER_ROLL_TICKS consecutive contact ticks — the fall is over,
// the racing has resumed) or REBOUNDS CLEAN (more than
// CLUSTER_GAP_TICKS contact-free ticks — the next landing is a new
// event). The gap rule is what PRESERVES THE FLARE: measured
// inter-bounce gaps run 54-171 ticks against the 6-tick boundary, so
// every rebound of a bleed chain opens its own ledger and tempering a
// big drop across several landings remains the survival skill the
// energy law created. The roll rule is the noise guard: resting
// contact trickles ~0.3 severity per tick, and a ledger capped at 10
// contact ticks can never accumulate it into a phantom death
// (measured worst trickle cluster: 6% of lethal).
//
// One implementation, three readers: the smash rule advances the
// ledger, the splat predictor advances a CLONE's ledger through the
// same function, and the oracle brain acts on the predictor — so the
// law, the forecast and the AI cannot drift. Ledger fields live on
// the body and are SIM STATE: pinned arithmetic, identical on every
// peer, saved and restored by the resume snapshot.
//
// Deterministic: pinned arithmetic + dpow only, same on every peer.
// ============================================================

const { CONFIG, dmath } = window.FF;
const dpow = dmath.pow;
const dmathRef = dmath;

const SEV_SCALE = 1 / 1000;

// The restitution a body brings to a contact (Phase-B hook).
function bodyRestitution(m) {
  const e = m.restitution === undefined ? CONFIG.restitution : m.restitution;
  // THE RESTITUTION FLOOR (annex): some species are bouncy by
  // NATURE — flare can add bounce but never remove what the material
  // is (beach ball: 0.6). Default floor 0: max(e, 0) is bit-exact
  // for every legal e.
  const F = window.FF.OBJECTS;
  const fl = (F && F[m.species] && F[m.species].restitutionFloor) || 0;
  return e > fl ? e : fl;
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
// THE KEY CARRIES THE SHAPE (2026-08-28). shapeToughness quadrates
// over the PARAMETRIC ellipse/egg boundary; a polygon's boundary is
// not that curve at all. Untagged, a polygon body whose (a, b)
// happened to match an ellipse body's would silently collect that
// body's cached toughness — a wrong answer with no symptom, since
// both shapes return the SAME number today and the collision would
// only surface once the polygon earned its own quadrature.
//
// Lifted out of bodyToughness so the tag can be checked at all: with
// the key inlined, a suite could only observe the VALUE, which is
// identical either way — the check would have passed with the tag
// removed. A signal that cannot say "I don't know" says "yes".
// The tag is PREPENDED, so no existing body's computed value moves;
// only the string that indexes it does.
function toughnessKey(m) {
  return (m.shape || 'ellipse') + ',' + m.a + ',' + m.b + ','
    + (m.taper || 0) + ',' + CONFIG.curvExponent;
}
function bodyToughness(m) {
  const key = toughnessKey(m);
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
  // THE TOUGHNESS DIAL (annex, 2026-08-26af): a species multiplier
  // on severity. x1 default is bit-exact. AT ZERO the species is
  // indestructible BUT NOT INTANGIBLE — impulses, shoves and
  // breadcrumbs all live above this line; only the damage ledger
  // goes deaf (beach ball, ruled; un-zero the dial to make it
  // poppable later).
  const F = window.FF.OBJECTS;
  const tm = F && F[m.species] && F[m.species].toughnessMult;
  return E * bodyToughness(m) * (tm === undefined ? 1 : tm);
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

// ---- The cluster ledger ------------------------------------------
// Boundary constants. These ARE the pilot's field-ratified landing
// scope (see the predictor's history in pilot.js); they live here now
// because the boundary is part of the law, not of the forecast.
const CLUSTER_ROLL_TICKS = 10;  // contact ticks: after this, it's racing
const CLUSTER_GAP_TICKS = 6;    // air ticks: after this, next landing is new

// Advance a body's ledger by one tick. tickSev is the tick's TOTAL
// severity (terrain sum + pair share sum; zero while spawn-protected,
// which is what keeps protected hits free exactly as the old rule
// did). Returns null while the cluster is open or absent, and
// { total, ticks } on the tick the cluster CLOSES — the caller judges
// the running total (m.clusterE) for death every contact tick, and
// the closed total for near-miss commentary once per event.
//
// Called from exactly two places: the smash rule (real bodies) and
// predictSplat (clones). The clone carries the live ledger in, which
// is correct by design: a short skip's open cluster continues into
// the predicted landing, exactly as the law will judge it.
function clusterStep(m, tickSev) {
  if (tickSev > 0) {
    if (!m.clusterOpen) {
      m.clusterOpen = 1;
      m.clusterE = 0;
      m.clusterN = 0;
      m.clusterGround = 0;
    }
    m.clusterE += tickSev;
    m.clusterN++;
    m.clusterGround++;
    m.clusterAir = 0;
    if (m.clusterGround > CLUSTER_ROLL_TICKS) return closeCluster(m);
    return null;
  }
  if (m.clusterOpen) {
    m.clusterGround = 0;
    m.clusterAir++;
    if (m.clusterAir > CLUSTER_GAP_TICKS) return closeCluster(m);
  }
  return null;
}

function closeCluster(m) {
  // pairE rides out with the close: the caller accumulates it before
  // stepping the ledger, and resetCluster wipes it along with the
  // rest — so the certificate must be handed the value, not the field.
  const out = { total: m.clusterE, ticks: m.clusterN, pairE: m.clusterPairE || 0 };
  resetCluster(m);
  return out;
}

// A fresh body gets a fresh ledger (respawn, race build).
function resetCluster(m) {
  m.clusterOpen = 0;
  m.clusterE = 0;
  m.clusterN = 0;
  m.clusterGround = 0;
  m.clusterAir = 0;
  m.clusterPairE = 0;
}

// The flare stick's mapping (Phase B): a smoothed bounce axis in
// [-1, +1] becomes this body's restitution. Neutral (0) is EXACTLY
// the live CONFIG value — a passive player's physics doesn't move a
// bit. Full up lerps to CONFIG.bounceMax (capped well below 1:
// perfect elasticity would be immortality under the energy law, and
// monster drops must still demand the multi-bounce bleed). Full down
// lerps to dead rubber. Piecewise linear; pinned arithmetic.
function bounceToRestitution(axis) {
  // THE CURVE (ruled 2026-08-27i): two straight lines meeting at
  // neutral — 0 at full down, base at rest, flareCeil (1.0, a
  // PERFECT bounce) at full up. The pump band is retired: the stick
  // cannot cross e=1, so holding up cannot self-excite; energy gain
  // is the tap-hop's job alone. The old 0.8 kink (slope jumped 8.6x
  // in the last fifth of travel) was why full-up felt like a cliff.
  const n = CONFIG.restitution;
  if (axis >= 0) {
    return n + ((CONFIG.flareCeil || 1) - n) * axis;
  }
  return n + n * axis; // axis in [-1,0): lerp toward 0
}

// The inverse of bounceToRestitution: what stick position produces
// this restitution? Used by the commentary layer to say HOW MUCH
// flare a death needed ("half flare would have done it"), which is
// far more teachable than a binary would/wouldn't.
function restitutionToBounce(e) {
  const n = CONFIG.restitution;
  // (The pump-band inverse branch retired with the band, 27i: the
  // curve is two straight lines, so the inverse is too.)
  if (e >= n) {
    const span = (CONFIG.flareCeil || 1) - n;
    return span <= 0 ? 0 : Math.min(1, (e - n) / span);
  }
  return n <= 0 ? 0 : Math.max(-1, (e - n) / n);
}

// The MINIMUM restitution that would have survived this contact.
// Severity scales with (1 - e^2) at fixed dissipated energy, so
// solving sev * (1 - e^2)/(1 - e0^2) = T is closed-form and exact.
// Returns null when no bounciness in [0, 1) could have saved it —
// the honest "nothing would have helped" case.
function restitutionToSurvive(sev, T, e0) {
  if (sev <= 0 || T <= 0) return 0;
  const need2 = 1 - (T / sev) * (1 - e0 * e0);
  if (need2 <= 0) return 0;      // even dead rubber survives
  if (need2 >= 1) return null;   // nothing survives
  return Math.sqrt(need2);
}

window.FF.damage = { bodyRestitution, bodyToughness, toughnessKey, shapeToughness, dissipated, severityFromE, pairShares, bounceToRestitution, restitutionToBounce, restitutionToSurvive, clusterStep, resetCluster, SEV_SCALE, CLUSTER_ROLL_TICKS, CLUSTER_GAP_TICKS };
})();