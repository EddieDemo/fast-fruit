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
// ---- THE ROUTE CALL (stage 5) ---------------------------------------
// A choice fork's entry metadata rides on its branch strand
// (dp.entry, terrain.js). Approaching one, a bot COMMITS: send the
// mouth or brake for the chute. The commitment is a seeded roll of
// the bot's permanent LEAN (melon.leanP, dealt in state.js from cast
// identity) keyed on (race seed, bot salt, fork position) — per-race
// variety, per-bot character, bit-deterministic, ghost-safe. Brains
// never touch the shared rng stream (the iron rule above), which is
// exactly why this hash exists.
const FORK_LOOK = 1000;      // px of lookahead to commit
function hash01(a, b, c) {
  let h = ((a >>> 0) ^ Math.imul(b >>> 0, 2654435761) ^ Math.imul(c >>> 0, 40503)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function routeCall(m, ctx) {
  const st = ctx.state;
  if (!st || !st.terrain) return null;
  let best = null;
  for (const poly of st.terrain) {
    const e = poly.entry;
    if (!e || (e.kind !== 'trap' && e.kind !== 'sw')) continue;
    const d = e.lipX - m.x;
    if (d <= -30 || d >= FORK_LOOK) continue;
    // A body BELOW the deck has already taken the drop — the fork is
    // decided, and holding the drop discipline down in the pit was
    // the stage-5 DNF: a 0.4 axis cannot climb the first washboard
    // crest (found on seed 1014238739, four bots parked in the
    // trough beneath their own fork).
    if (e.lipY !== undefined && m.y > e.lipY + 120) continue;
    if (best === null || d < best.d) best = { d, e };
  }
  // THE WALL DISCIPLINE: an sw sender past the mouth is committed to
  // the turnaround bowl, and the mouth's demand (1050+) carried into
  // that face is a measured death (~5300 severity at full send). The
  // wall telegraphs itself to players; bots get the same call here —
  // brake to a bowl-safe speed on deck A. Depth-cut excludes floor
  // riders passing beneath and bodies already in the gallery.
  for (const poly of st.terrain) {
    const e = poly.entry;
    if (!e || e.kind !== 'sw' || e.wallX === undefined) continue;
    // HEADING-AWARE (serpentine finding): a left turn's wall sits at
    // DECREASING x and its riders carry -vx; the travel sign is the
    // fork's own geometry. The semantic flip already makes the brake
    // axis direction-correct — only this window math needed the sign.
    const dirW = e.wallX >= e.farX ? 1 : -1;
    const dW = (e.wallX - m.x) * dirW;
    const past = (m.x - e.farX) * dirW;
    if (past < 40 || dW < 60) continue;
    if (m.y > e.lipY + 300) continue;
    // THE METER: per-bot corner speed and approach length, hashed
    // from leanSalt per turn. Identical brake targets COMPRESS a
    // field into one arrival; personal corner styles spread twelve
    // bodies over ~ten seconds, and the funnel that mounds under a
    // 2-second burst flows at 2-3 bodies (measured both ways in the
    // serpentine prototype).
    const sd = (st.race && st.race.seed) >>> 0;
    const sl = (m.leanSalt !== undefined ? m.leanSalt : (ctx.index + 1)) >>> 0;
    const h1 = hash01(sd, (sl ^ 0x51AB) >>> 0, Math.round(e.wallX));
    const h2 = hash01(sd, (sl ^ 0xC0FE) >>> 0, Math.round(e.wallX));
    return { wall: true, d: dW, demand: e.demand, send: true,
      vTarget: 300 + h1 * 520, brakeLen: 600 + h2 * 3200 };
  }
  if (!best) return null;
  const seed = (st.race && st.race.seed) >>> 0;
  const salt = (m.leanSalt !== undefined ? m.leanSalt : (ctx.index + 1)) >>> 0;
  const pSend = m.leanP !== undefined ? m.leanP : 0.5;
  const send = hash01(seed, salt, Math.round(best.e.lipX)) < pSend;
  return { send, demand: best.e.demand, d: best.d };
}
// The DROP discipline both brains share — and it COMMITS LATE: a
// drop is braking near the lip, not crawling the last kilometre.
// Full drive holds until the computed stopping distance says brake
// (parking in a roller trough short of the fork was the stage-5
// sweep's DNF signature: an early-braking bot with a creep blip
// cannot climb a crest). Between the brake point and the lip the
// bot coasts; past the lip the fork clears and the brain resumes.
// THE WALL AXIS, metered: outside the bot's personal approach zone,
// full drive; inside it, a speed LIMITER at the bot's personal
// corner speed. |vx| because the wall may face either heading; the
// returned axis is semantic, so the flip delivers it correctly on
// reversed tiers.
function wallAxis(m, rc) {
  const target = rc.vTarget || 480;
  const sp = Math.abs(m.vx);
  if (rc.d > (rc.brakeLen || 900)) return 1;
  if (sp > target + 50) return -1;
  if (sp < target - 90) return 1;
  return 0.3;
}
function dropAxis(m, rc) {
  const target = rc.demand - 260;
  const over = m.vx - target;
  if (over <= 0) return rc.d > 240 ? 1 : 0.4;   // drive on, ease at the lip
  const brakeDist = (m.vx * m.vx - target * target) / (2 * 1800) + 140;
  if (rc.d > brakeDist) return 1;               // not yet: keep racing
  return -1;                                     // now: shed the excess
}

// THE TRAVEL DIRECTION (raw-input era): physics no longer flips
// torque by strand direction — stick right rolls right everywhere.
// Direction choice belongs to the BRAINS: every drive axis a policy
// returns in the travel frame is multiplied by the nearest riding
// face's point-order direction, the exact lookup the old physics
// flip used, so bot trajectories are bit-preserved across the input
// rework.
function travelDir(m, ctx) {
  const st = ctx && ctx.state;
  if (!st || !st.terrain) return 1;
  const w = window.FF.slab.worldFor(st.terrain);
  if (!w.project) return 1;
  const prj = w.project(m.x, m.y);
  return prj ? prj.dirX : 1;
}

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
// THE ROCK (stage 5): a grounded body parked at ~zero speed for two
// seconds is functionally soft-locked — troughs steeper than the
// grind grade exist by design (rollers are a MOMENTUM word), and a
// bot must escape them the way a player does: by pumping. The
// sign-following throttle (push the way you are already moving)
// injects energy every half-cycle like pumping a swing; amplitude
// grows until a crest is crossed. Tick-derived, rng-free, and the
// slight forward bias at rest breaks the symmetry deterministically.
const STALL_TICKS = 240, ESCAPE_V = 380;
const RESTALL_GRACE = 6 * window.FF.CONFIG.physicsHz;   // a release that re-stalls inside 6s failed
const BACKUP_TICKS = 3 * window.FF.CONFIG.physicsHz;    // the reverse-and-send: 3s of run-up
function makeRocker() {
  let stallT = 0, rocking = false, backupT = 0, attempts = 0, sinceRelease = 1e9;
  let refX = null, refT = 0, rockX0 = 0, escDir = -1;
  return {
    step(m, ctx) {
      // PARKED is a NET-DISPLACEMENT fact, not an instantaneous one:
      // a traffic jam jostles its bodies past any velocity threshold
      // (measured: 25 s at +-60 px with vx spiking to 150) and
      // micro-airtime strobes any grounded flag. The only honest
      // question is "has this body gone anywhere in two seconds".
      // The pre-GO grid is exempt: a pinned field is not a stall.
      if (ctx.state && ctx.state.race && ctx.state.race.goTick === null
          && ctx.state.race.mode === 'track') {
        stallT = 0; refX = null;
        return null;
      }
      if (refX === null || ctx.tick - refT >= 240) { refX = m.x; refT = ctx.tick; }
      const parked = (ctx.tick - refT >= 200) && Math.abs(m.x - refX) < 90;
      sinceRelease++;
      // THE REVERSE-AND-SEND (escalation): rocking to ESCAPE_V frees
      // a trough, but a kicker foot wants a RUN-UP — a bot that
      // re-stalls right after release is cycling, and what a racer
      // does there is back up and send it. Three seconds of reverse,
      // then full commitment.
      if (backupT > 0) {
        backupT--;
        if (backupT === 0) { attempts = 0; sinceRelease = 0; stallT = -480; }
        return { axis: escDir * travelDir(m, ctx), bounce: 0 };
      }
      if (rocking) {
        if (Math.abs(m.vx) > ESCAPE_V || Math.abs(m.x - rockX0) > 260) {
          rocking = false; stallT = 0; sinceRelease = 0; refX = null;
          return null;
        }
        const backoff = ((ctx.tick + ctx.index * 137) % 720) < 150;
        if (backoff) return { axis: -travelDir(m, ctx), bounce: 0 };
        // Under raw input the pump is naturally heading-true: push
        // along motion in the world frame — sign(vx), no lookup.
        return { axis: m.vx >= -5 ? 1 : -1, bounce: 0 };
      }
      if (parked) {
        if (++stallT > STALL_TICKS) {
          if (sinceRelease < RESTALL_GRACE && ++attempts >= 2) {
            // ALTERNATING escalation: the semantic flip turns a raw
            // axis around on reversed strands, so no fixed sign can
            // promise \"backward\" everywhere — but one of the two
            // directions is always out of a pocket (measured: the
            // fixed -1 drove a bowl-parked body deeper for 220 s).
            backupT = BACKUP_TICKS;
            escDir = -escDir;
          } else {
            rocking = true; rockX0 = m.x;
          }
        }
      } else stallT = Math.min(stallT, 0);
      return null;
    },
    save() { return { st: stallT, rk: rocking ? 1 : 0, bu: backupT, at: attempts, sr: Math.min(sinceRelease, 1e9) }; },
    load(s) {
      if (s) {
        stallT = s.st || 0; rocking = !!s.rk;
        backupT = s.bu || 0; attempts = s.at || 0;
        sinceRelease = s.sr === undefined ? 1e9 : s.sr;
      }
    },
  };
}

register('cruise', () => {
  const rocker = makeRocker();
  return {
    name: 'cruise',
    drive(m, ctx) {
      const rock = rocker.step(m, ctx);
      if (rock) return rock;
      // THE ROUTE CALL next: a committed drop overrides the throttle
      // until the fork is behind. Lean state lives on the BODY, so
      // per-bot state here is only the rocker's.
      const dir = travelDir(m, ctx);
      const rc = m && ctx ? routeCall(m, ctx) : null;
      if (rc && rc.wall) return { axis: wallAxis(m, rc) * dir, bounce: 0 };
      if (rc && !rc.send) return { axis: dropAxis(m, rc) * dir, bounce: 0 };
      return { axis: dir, bounce: 0 };
    },
    save() { return rocker.save(); },
    load(s) { rocker.load(s); },
  };
});

// ORACLE: cruise until the landing it is committed to would kill it,
// then spend the MINIMUM flare that survives — which under the
// circular gamut is also near-optimal, since flare and drive share one
// budget and the least flare leaves the most steering authority.
const RE_ASK_TICKS = 10;   // re-ask cadence while falling
const STAGGER = 7;         // spread predictions across bots
register('oracle', () => {
  let held = 0;            // the stick deflection currently prescribed
  let heldUntilGround = false;
  const rocker = makeRocker();
  return {
    name: 'oracle',
    drive(m, ctx) {
      const grounded = m.hitSeverity > 0 || (m.airTicks || 0) === 0;
      if (grounded) {
        held = 0; heldUntilGround = false;
        const rock = rocker.step(m, ctx);
        if (rock) return rock;
        // THE ORACLE'S ROUTE CALL is a computation, not a roll (the
        // honesty rule): send iff current speed already meets the
        // demand with margin — the far deck is the shorter arc when
        // free (measured, verify-trap D) — otherwise braking for the
        // chute costs less than a failed send pays.
        const dir = travelDir(m, ctx);
        const rc = routeCall(m, ctx);
        if (rc && rc.wall) return { axis: wallAxis(m, rc) * dir, bounce: 0 };
        if (rc && m.vx < rc.demand + 80) return { axis: dropAxis(m, rc) * dir, bounce: 0 };
        return { axis: dir, bounce: 0 };
      }
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
      return { axis: drive * travelDir(m, ctx), bounce: held };
    },
    // A brain's HELD PRESCRIPTION is real state: an oracle caught
    // mid-fall has already decided how much flare this landing needs,
    // and a resume that forgot it would drive differently for the
    // next few ticks. Small, but it is the difference between "the
    // same race continues" and "a similar race continues".
    save() { return { h: held, u: heldUntilGround ? 1 : 0, r: rocker.save() }; },
    load(s) {
      if (!s) return;
      held = s.h || 0;
      heldUntilGround = !!s.u;
      rocker.load(s.r);
    },
  };
});

window.FF.pilot = { predictSplat, register, create, has, BRAINS };
})();