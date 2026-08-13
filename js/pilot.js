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
  // SCOPE: the ring judges THE NEXT LANDING — its contact cluster
  // only (ratified across two of Eddie's field logs; a multi-landing
  // budget borrowed verdicts from events seconds away while each
  // immediate landing was benign). Since 2026-08-13 the cluster IS
  // the law's own judged unit: the smash rule sums dissipated energy
  // across a contact cluster and judges the total, and the boundary
  // (roll-on / rebound-clean) lives in damage.clusterStep. So the
  // forecast below no longer runs a private copy of that machinery —
  // it advances the CLONE's ledger through the same function the
  // smash rule uses. The clone carried the live ledger in
  // (Object.assign above), which is correct by design: a short skip's
  // open cluster continues into the predicted landing, exactly as the
  // law will judge it. One boundary, three readers (rule, ring,
  // oracle) — none can drift.
  let worst = 0, lethal = false;
  for (let i = 0; i < 400; i++) {
    stepClone(c, inp, state.terrain, dt);
    // Spawn protection zeroes the contribution, mirroring the smash
    // rule's own grace: protected hits are free.
    const tickSev = (state.tick + i + 1 <= m.protectTick) ? 0 : c.hitSeverity;
    if (traceOut && c.hitSeverity > 50) traceOut.push({ dt: i, sev: Math.round(c.hitSeverity), vy: Math.round(c.vy) });
    const closed = damage.clusterStep(c, tickSev);
    const running = closed ? closed.total : (c.clusterOpen ? c.clusterE : 0);
    if (running > worst) worst = running;
    if (running >= T && tickSev > 0) lethal = true;
    if (lethal && !traceOut) break;  // verdict sealed
    if (closed) break;               // the landing is judged
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
  // Stateless: nothing to carry across a resume.
  save() { return null; },
  load() {},
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
    // A brain's HELD PRESCRIPTION is real state: an oracle caught
    // mid-fall has already decided how much flare this landing needs,
    // and a resume that forgot it would drive differently for the
    // next few ticks. Small, but it is the difference between "the
    // same race continues" and "a similar race continues".
    save() { return { h: held, u: heldUntilGround ? 1 : 0 }; },
    load(s) {
      if (!s) return;
      held = s.h || 0;
      heldUntilGround = !!s.u;
    },
  };
});

window.FF.pilot = { predictSplat, register, create, has, BRAINS };
})();