(function () {
'use strict';
// ============================================================
// PILOT — the shared prediction oracle and the bots' brains.
//
// TWO THINGS LIVE HERE, and they are the same thing seen twice:
//   predictSplat  — clone-steps a body through the sim's OWN stepBody
//                   and reports whether the landing it is committed to
//                   will kill it. The practice ring draws this; the
//                   oracle brain acts on it. One implementation, so
//                   the ring is literally a debug view of the AI and
//                   neither can drift from the other.
//   BRAINS        — named driving policies, registered as FACTORIES
//                   because a brain holds per-body state (a held
//                   prescription now; reaction latency later). One
//                   shared function would leak one bot's state into
//                   another's, which is the classic version of this
//                   bug.
//
// A brain returns { axis, bounce } — the same two numbers the human's
// thumbstick produces — so nothing downstream knows or cares who is
// driving. That is also the HONESTY rule: the oracle solves for the
// restitution it needs and then converts to the nearest STICK
// deflection, because a bot setting restitution directly would be
// doing something no human can.
//
// DETERMINISM: sim tier. dmath for transcendentals, no Math.random,
// no wall-clock, and no draws from the shared rng stream — a brain's
// decisions must never perturb terrain or casting. The prediction
// budget (below) is a function of tick and bot index for the same
// reason.
//
// COST: prediction clone-steps up to 400 ticks. Twelve bots asking
// every tick would be thousands of extra stepBody calls per frame, so
// the oracle only predicts while AIRBORNE AND DESCENDING, holds its
// prescription until the next landing, and re-asks on a deterministic
// stagger. Not difficulty knobs — the difference between shippable
// and a phone-killer.
// ============================================================

const { CONFIG, dmath, damage } = window.FF;
const dpow = dmath.pow;

// ---- Practice-mode splat predictor v3 (2026-08-11) ----
// v1 and v2 both IMITATED the solver and both lied (Eddie's field
// log was the conviction: EP1 exact at w=0, scatter 0.16x-2.3x at
// race spin — the contact-point term w x r turns any approximation
// of the contact geometry into large vn error, and the energy law
// SQUARES it). v3 stops imitating: it clones the player body (all
// scalars) and the current input, and steps the clone through the
// sim's OWN stepBody (exported as stepBodyClone, sink null) over
// the real terrain at the real dt — the forecast is the sim's own
// arithmetic, exact by construction, tracking the worst severity
// across the bounce chain (up to 2.5s, early-out when the verdict
// seals RED or the chain settles). Inputs are HELD at their current
// values: the ring answers "what happens if you keep doing exactly
// this", and moving the flare mid-air re-answers it live. Verdict
// is BINARY by design ruling. Scope, by design: the ring judges the
// LANDING — a bot torpedoing you mid-air is not a fall.
// Presentation tier; the sim is untouched (clone only).
function predictSplat(state, m, trace, inputOverride) {
  const dt = 1 / CONFIG.physicsHz;
  const stepClone = window.FF.stepBodyClone;
  if (!stepClone) return { worst: 0, T: 1, splat: false, trace: null };
  // Clone the body (all-scalar) and the input (so smoothing evolves
  // exactly as it would with the current stick HELD).
  const c = Object.assign({}, m);
  // WHOSE stick is being held? The ring asks about the player; a bot
  // asks about itself. Defaulting to state.input keeps every existing
  // caller identical.
  const src = inputOverride || state.input;
  const inp = {
    rawAxis: src.rawAxis, torqueAxis: src.torqueAxis || 0,
    rawBounce: src.rawBounce || 0, bounceAxis: src.bounceAxis || 0,
  };
  const mr = 1 / (m.invM * CONFIG.mass);
  const T = CONFIG.smashThreshold * (mr === 1 ? 1 : dpow(mr, CONFIG.sizeToughness / 3));
  const traceOut = trace ? [] : null;
  // SCOPE: the ring judges THE FALL — the landing and its bounce
  // chain — not the racing that follows. Without a hard stop, the
  // clone rolls on for seconds and any wall it drives into seals a
  // RED the player rightly calls a lie (field-logged: rolling never
  // tripped the old airborne-only settle test). The fall is OVER
  // after a quarter-second of continuous sub-lethal ground contact.
  // SCOPE (final, from Eddie's second field log): the ring judges
  // THE NEXT LANDING — its contact cluster only. The clone steps
  // until the first contact, holds through the cluster (severity
  // peaks over 2-3 ticks; short air gaps tolerated), and stops the
  // moment the body either rolls on or rebounds clean. Judging any
  // further was the residual lie: a multi-landing budget spans 3-4
  // skips at race pace and SLIDES as you bounce, so the verdict
  // blinked about events seconds away while each immediate landing
  // was benign — the log showed every FIRST-landing prediction
  // exact to the unit, and every wrong verdict borrowed from the
  // future. A bleed chain is judged bounce-by-bounce instead, since
  // the ring re-asks after every rebound — better tempering
  // pedagogy anyway. Cheaper too: the sim stops at the landing.
  let worst = 0, lethal = false, contacted = false, groundSince = 0, airGap = 0;
  for (let i = 0; i < 400; i++) {
    stepClone(c, inp, state.terrain, dt);
    if (c.hitSeverity > 0) {
      contacted = true; airGap = 0; groundSince++;
      if (traceOut && c.hitSeverity > 50) traceOut.push({ dt: i, sev: Math.round(c.hitSeverity), vy: Math.round(c.vy) });
      if (c.hitSeverity > worst) worst = c.hitSeverity;
      // A hit only KILLS after spawn protection expires — the smash
      // rule's own grace, honoured here too.
      if (c.hitSeverity >= T && state.tick + i + 1 > m.protectTick) lethal = true;
      if (lethal && !traceOut) break; // verdict sealed
      if (groundSince > 10) break; // rolled on: the landing is judged
    } else if (contacted) {
      airGap++;
      if (airGap > 6) break; // rebounded clean: the landing is judged
    }
  }
  return { worst, T, splat: lethal, trace: traceOut };
}

// ---- Brains -------------------------------------------------------
const BRAINS = new Map();
function register(name, factory) { BRAINS.set(name, factory); }
function create(name) {
  const f = BRAINS.get(name) || BRAINS.get('cruise');
  return f();
}
function has(name) { return BRAINS.has(name); }

// CRUISE: full throttle right, flare centred. The policy every bot has
// always run, and the one the autopilot and the exhibition field use —
// named here so "drives like a bot" has exactly one definition.
register('cruise', () => ({
  name: 'cruise',
  drive() { return { axis: 1, bounce: 0 }; },
}));

// ORACLE: cruise until the landing it is committed to would kill it,
// then spend the MINIMUM flare that survives — which under the
// circular gamut is also near-optimal, since flare and drive share one
// budget and the least flare leaves the most steering authority.
const RE_ASK_TICKS = 10;   // re-ask cadence while falling
const STAGGER = 7;         // spread predictions across bots
register('oracle', () => {
  let held = 0;            // the stick deflection currently prescribed
  let heldUntilGround = false;
  return {
    name: 'oracle',
    drive(m, ctx) {
      const grounded = m.hitSeverity > 0 || (m.airTicks || 0) === 0;
      if (grounded) { held = 0; heldUntilGround = false; return { axis: 1, bounce: 0 }; }
      // Only a DESCENDING body has a landing to fear (y grows down).
      const falling = m.vy > 0;
      const due = ((ctx.tick + ctx.index * STAGGER) % RE_ASK_TICKS) === 0;
      if (falling && (!heldUntilGround || due)) {
        const p = predictSplat(ctx.state, m, false, ctx.input);
        if (p.splat) {
          // What restitution survives this exact contact? Closed-form
          // from the energy law, then converted to the stick position
          // that buys it — plus one notch, because a prescription that
          // lands exactly on the threshold dies to rounding.
          const e = damage.bodyRestitution(m);
          const need = damage.restitutionToSurvive(p.worst, p.T, e);
          const axis = (need === null) ? 1 : damage.restitutionToBounce(need);
          held = Math.min(1, (axis === null ? 1 : axis) + 0.04);
          heldUntilGround = true;
        } else if (!heldUntilGround) {
          held = 0;
        }
      }
      // Circular gamut: the stick is a budget, so drive gets whatever
      // flare leaves. Spending the least flare that survives is what
      // makes this near-optimal rather than merely safe.
      const drive = Math.sqrt(Math.max(0, 1 - held * held));
      return { axis: drive, bounce: held };
    },
  };
});

window.FF.pilot = { predictSplat, register, create, has, BRAINS };
})();