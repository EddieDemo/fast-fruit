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
// the oracle predicts only while AIRBORNE AND DESCENDING, holds its
// prescription until the next landing, and re-asks only when the
// forecast's premise has broken (a non-terrain contact, or its own
// stick moving) — the event-driven rule, Phase 0. A per-world token
// bucket on clone-STEPS bounds the worst frame on top of that. Not
// difficulty knobs — the difference between shippable and a
// phone-killer.
// ============================================================

const { CONFIG, dmath, damage } = window.FF;
const dpow = dmath.pow;

// ---- THE CENSUS (measurement scaffolding, 2026-09-03) --------------
// Counts what the AI rethink needs sized before any number is chosen:
// asks per flight, asks per tick across the field, and clone-STEPS per
// ask (a 400-tick clone is forty times a 10-tick one, so a cap that
// counts asks may not bound work). OFF by default and read by nothing
// in the game: `STATS.on` is set only by exp/ scripts. Inert to the
// sim by construction — no rng, no clock, no body field, no branch
// taken while off other than the flag test itself.
const STATS = {
  on: false,
  asks: 0, flights: 0, steps: 0,
  freshAsks: 0,    // asked with NO prescription held (the every-tick case)
  heldAsks: 0,     // asked on the cadence, a prescription already held
  represcribe: 0,  // a re-ask that CHANGED the held flare
  unanswered: 0,   // asks whose clone never reached a touchdown — the
                   // "I don't know" that used to be read as "safe"
  // WHY each ask happened. The rule has three triggers besides the
  // opening one, and a trigger that never fires is a rule that is not
  // being tested: these are what verify-brains.js reads to prove each
  // one alive, and what the mutations kill one at a time.
  bumpAsks: 0,     // a non-terrain contact since the last ask
  confirmAsks: 0,  // the look just before the forecast's own touchdown
  retryAsks: 0,    // a retry after an ask that reached no touchdown
  lateSchedules: 0, // confirmations scheduled AFTER the landing they
                   // confirm — must be zero by construction
  lapses: 0,       // flights never forecast (the lapse dial fired)
  ignoredBumps: 0, // bumps seen and not re-checked (the recheck dial)
  reflexes: 0,     // lapsed flights that flared the reflex yank
  reflexSum: 0,    // ...and how much reflex (before panic) they applied
  panics: 0,       // prescriptions exaggerated after a scare
  reflexPanics: 0, // reflex yanks exaggerated after a scare
  missAbsSum: 0,   // total |thumb miss| applied (spread only — lean is a margin, Phase 3)
  firstAskDelayMin: Infinity, // ticks from first falling to the opening ask (reaction)
  // THE MARGIN LAW (Phase 3): every safety margin the brain holds is
  // scaled by 4^lean. Recorded so the law can be held exactly rather
  // than inferred from deaths.
  marginMin: Infinity, marginMax: -Infinity,   // flare margin actually applied
  // THE FORK CALL: the calls made, per tick (the route dials were
  // removed in v363 — see the handover, addendum 49).
  forkSends: 0, forkDrops: 0,
  sendMarginMin: Infinity, sendMarginMax: -Infinity,  // px/s margin over the demand actually applied (the margin law at the fork)
  paceEased: 0,      // grounded ticks the throttle was eased before a launch
  rimAsks: 0, rimUnanswered: 0,   // the danger rim's own asks (rimStep)
  denials: 0,      // asks the meter deferred
  denialsBySeat: [],  // ... and to whom: a bot denied often is quietly
                   // dumber than its number, and fairness under
                   // pressure is ruled on evidence, not assumed
  askHist: [],     // asks per completed flight
  stepHist: [],    // clone-steps per ask
  impactHist: [],  // ticks from the ask to the PREDICTED TOUCHDOWN —
                   // the actionable lead, as opposed to steps, which
                   // runs on to the judgement after the landing
  firstStepHist: [], // clone-steps for the FIRST ask of a flight — the
                   // event-driven rule keeps exactly these and drops the
                   // rest, and an early ask has the LONGEST horizon, so
                   // the work saved is smaller than the asks saved
  tickAsks: [],    // asks per tick, in tick order (ticks with >=1 ask)
  tickSteps: [],   // clone-steps per tick, same ticks — the work a cap
                   // would actually have to bound
  _tick: -1, _cur: 0, _curSteps: 0,
};
function statsReset() {
  STATS.asks = 0; STATS.flights = 0; STATS.steps = 0;
  STATS.freshAsks = 0; STATS.heldAsks = 0; STATS.represcribe = 0;
  STATS.denials = 0; STATS.denialsBySeat = []; STATS.unanswered = 0;
  STATS.bumpAsks = 0; STATS.confirmAsks = 0; STATS.retryAsks = 0;
  STATS.lateSchedules = 0; STATS.lapses = 0; STATS.ignoredBumps = 0;
  STATS.reflexes = 0; STATS.reflexSum = 0; STATS.panics = 0; STATS.reflexPanics = 0;
  STATS.missAbsSum = 0; STATS.firstAskDelayMin = Infinity;
  STATS.marginMin = Infinity; STATS.marginMax = -Infinity;
  STATS.forkSends = 0; STATS.forkDrops = 0; STATS.paceEased = 0;
  STATS.rimAsks = 0; STATS.rimUnanswered = 0;
  STATS.sendMarginMin = Infinity; STATS.sendMarginMax = -Infinity;
  STATS.askHist = []; STATS.stepHist = []; STATS.firstStepHist = []; STATS.impactHist = [];
  STATS.tickAsks = []; STATS.tickSteps = [];
  STATS._tick = -1; STATS._cur = 0; STATS._curSteps = 0;
}
function statsAsk(tick, steps, wasHeld) {
  STATS.asks++; STATS.steps += steps; STATS.stepHist.push(steps);
  if (wasHeld) STATS.heldAsks++; else STATS.freshAsks++;
  if (tick !== STATS._tick) {
    if (STATS._tick >= 0) { STATS.tickAsks.push(STATS._cur); STATS.tickSteps.push(STATS._curSteps); }
    STATS._tick = tick; STATS._cur = 0; STATS._curSteps = 0;
  }
  STATS._cur++; STATS._curSteps += steps;
}
function statsFlush() {
  if (STATS._tick >= 0) {
    STATS.tickAsks.push(STATS._cur); STATS.tickSteps.push(STATS._curSteps);
    STATS._tick = -1; STATS._cur = 0; STATS._curSteps = 0;
  }
}

// ---- THE PREDICTION METER (Phase 0, 2026-09-03) --------------------
// A budget on prediction WORK, not on the number of asks. Measured
// reason (exp/ask-census.js, 12 sweep seeds): peak asks in a tick is
// 11, which is just the field size — a counter that reads 11 at the
// quiet moment and 11 at the spike is a signal that cannot say "I
// don't know". Peak clone-STEPS in a tick is 1658 against a median of
// 222. Steps are also the currency the skill ladder is denominated in
// (a short-horizon bot is cheaper because its clone runs fewer steps),
// so one unit serves the cap, the sweep and the cost model.
//
// A TOKEN BUCKET, not a per-tick allowance: refill per tick, burst
// ceiling. The measured shape is a low median with a 7.5x spike when a
// pack lands together, and a bucket absorbs that without raising the
// steady rate. The meter is charged with what the ask ACTUALLY cost,
// after it returns — so one ask may overshoot and the worst frame is
// bounded by burst + 400 (the horizon bounds the overshoot). Bounded
// by construction, and the bound is sayable.
//
// SCOPED PER WORLD (a WeakMap on the state object, no field on the
// sim): finishline.js clones the world and steps it 400 ticks a frame
// WHILE the live race runs. A module-global meter would let the
// fast-forward spend the live race's allowance on ticks the live race
// has not reached — a replay-breaking coupling, and a lie about the
// fast-forward being what waiting would produce. A bare rig with no
// state (derby's harnesses drive brains with a body alone) has no
// frame to protect: no meter, ask allowed. Stated, not silent.
const METERS = new WeakMap();
function meterAllow(state, tick) {
  if (!state) return true;
  let mt = METERS.get(state);
  if (!mt) { mt = { tick: tick, tokens: CONFIG.predictBurstSteps }; METERS.set(state, mt); }
  else if (tick !== mt.tick) {
    const elapsed = tick - mt.tick;
    // A tick that is not the next one (a fresh race on a reused state,
    // a rewind) refills outright rather than integrating a gap.
    mt.tokens = elapsed > 0
      ? Math.min(CONFIG.predictBurstSteps, mt.tokens + elapsed * CONFIG.predictRefillSteps)
      : CONFIG.predictBurstSteps;
    mt.tick = tick;
  }
  return mt.tokens > 0;
}
function meterCharge(state, steps) {
  if (!state) return;
  const mt = METERS.get(state);
  if (mt) mt.tokens -= steps;
}

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
function predictSplat(state, m, trace, inputOverride, horizon) {
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
  let steps = 0;
  // THE TOUCHDOWN TICK, distinct from the judgement tick: `steps` runs
  // until the cluster CLOSES, which is after the landing is over. A
  // forecast is only actionable before the impact, so anything
  // scheduling off this forecast must use impactAt, not steps.
  let impactAt = -1;
  // HORIZON: how far the clone looks. 400 (3.3 s) is the ring's and the
  // Rindfather's; a short-sighted bot passes less, and a landing beyond
  // it comes back as "I never got there" (impactAt -1), which the brain
  // treats as unanswered rather than safe.
  const H = horizon || 400;
  for (let i = 0; i < H; i++) {
    stepClone(c, inp, state.terrain, dt);
    steps++;
    // Spawn protection zeroes the contribution, mirroring the smash
    // rule's own grace: protected hits are free.
    const tickSev = (state.tick + i + 1 <= m.protectTick) ? 0 : c.hitSeverity;
    if (traceOut && c.hitSeverity > 50) traceOut.push({ dt: i, sev: Math.round(c.hitSeverity), vy: Math.round(c.vy) });
    if (impactAt < 0 && c.hitSeverity > 0) impactAt = i + 1;
    const closed = damage.clusterStep(c, tickSev);
    const running = closed ? closed.total : (c.clusterOpen ? c.clusterE : 0);
    if (running > worst) worst = running;
    if (running >= T && tickSev > 0) lethal = true;
    if (lethal && !traceOut) break;  // verdict sealed
    if (closed) break;               // the landing is judged
  }
  // STEPS is part of the ANSWER, not bookkeeping: it is how many ticks
  // the clone had to run before the landing was judged, which is the
  // forecast's own statement of WHEN the thing it predicted happens.
  // The meter charges it and the confirmation ask is scheduled off it.
  return { worst, T, splat: lethal, trace: traceOut, steps, impactAt };
}

// ---- Brains -------------------------------------------------------
// ---- THE DANGER RIM'S ASK RULE (2026-09-03q) ------------------------
// The shipped landing-fate signal on the player's melon (renderer.js
// drawDangerRim) reads the same forecast the bots do. Its rule lives
// here, beside the forecast, so a headless suite can hold it:
//   * ask on the oracle's old 10-tick cadence, or sooner (>= 3 ticks)
//     when the flare moved, or when ANOTHER MELON HIT YOU since the
//     last ask (the pair law stamps m.lastContactTick; terrain never
//     does — the bots' bump trigger, borrowed);
//   * an ask whose clone never reached a landing (impactAt < 0) is
//     NOT an answer: keep the last verdict and ask again next tick.
//     Measured before this rule (v365, 265 flights): 72% of flights
//     opened with an unanswered ask read as "safe", ~8 ticks blind on
//     average, 40 at worst, and in 2.3% of flights the silence hid a
//     real amber or red. Unanswered asks are cheap by construction
//     (the clone stops in a handful of ticks), so the retry costs
//     what Phase 0's did: almost nothing.
// Verdict: 0 off / 1 on — BINARY (Eddie, 2026-09-04: a fall either
// kills as held or it does not). The amber/red split (flare saves it
// / nothing does) retired with the pixel-world rim; the feedback loop
// that teaches the flare survives — red, flare, red goes out. RIM is
// the caller's state object; returns it.
const RIM_REASK_TICKS = 10, RIM_INPUT_TICKS = 3;
function rimStep(RIM, state, m) {
  if (!m.alive || m.hitSeverity > 0) { RIM.askTick = -1e9; RIM.verdict = 0; RIM.unanswered = false; return RIM; }
  const ax = (state.input && state.input.bounceAxis) || 0;
  const since = state.tick - RIM.askTick;
  const bumped = m.lastContactTick !== undefined && m.lastContactTick > RIM.askTick;
  const due = since >= RIM_REASK_TICKS
    || (since >= RIM_INPUT_TICKS && Math.abs(ax - RIM.askAxis) > 0.12)
    || bumped
    || (RIM.unanswered && since >= 1);
  if (!due) return RIM;
  RIM.askTick = state.tick;
  RIM.askAxis = ax;
  const p = predictSplat(state, m);
  if (STATS.on) STATS.rimAsks++;
  if (p.impactAt < 0) { RIM.unanswered = true; if (STATS.on) STATS.rimUnanswered++; return RIM; }   // keep the last verdict
  RIM.unanswered = false;
  RIM.verdict = p.splat ? 1 : 0;
  return RIM;
}

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

// A launch word (kicker, lip, gap) within PACE_ZONE px ahead in the
// travel direction — the pace ease's trigger. Reads the word tag every
// terrain point already carries (pt.k); a body below the deck of a
// fork is not "before a launch" and the tag says so (its points are
// the fork's own kind).
function launchAhead(m, ctx, dir) {
  const st = ctx && ctx.state;
  if (!st || !st.terrain) return false;
  for (const poly of st.terrain) {
    for (let i = 0; i < poly.length; i++) {
      const pt = poly[i];
      if (!LAUNCH_WORDS[pt.k]) continue;
      const d = (pt.x - m.x) * dir;
      if (d > 0 && d < PACE_ZONE && Math.abs(pt.y - m.y) < 300) return true;
    }
  }
  return false;
}

const BRAINS = new Map();
function register(name, factory) { BRAINS.set(name, factory); }
// opts rides through to the factory: the roster's skill numbers
// ({ flare, lean }) are data on the entry, handed to the brain at
// creation. A brain that takes no opts ignores them.
function create(name, opts) {
  const f = BRAINS.get(name) || BRAINS.get('cruise');
  return f(opts);
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
// ---- THE FLARE GRADIENT (AI Phase 1, 2026-09-03) ---------------------
// One number per bot, `flare` in [0, 1], and a SHARED table of curves
// that says what a bot at 0.37 does. Bands are then just names for
// points on the curve; two bots can sit 0.05 apart. The table is the
// rethink's §4b first draft — the sweep tunes it (exp/sweep-ladder.js).
// Knots at 0 / 0.3 / 0.5 / 0.8 / 1, linear between: readable, and every
// number here is one a person can argue with.
//
// THE LAW THAT ANCHORS IT: flare = 1, lean = 0 is BYTE-IDENTICAL to the
// Phase 0 oracle. The Rindfather is the ceiling; the gradient hangs
// off it and must not move it (the gates hold this).
const FLARE_KNOTS = [0, 0.3, 0.5, 0.8, 1];
const FLARE_CURVES = {
  askP:      [0,    0.6,  0.9,  1.0,  1],    // asks when the fall begins
  recheckP:  [0,    0.1,  0.4,  0.8,  1],    // re-asks after a bump / own input change
  reaction:  [30,   22,   12,   4,    0],    // ticks late to notice the drop (and to retry)
  spread:    [0.30, 0.20, 0.12, 0.04, 0],    // thumb error, stick units, half-width
  horizon:   [110,  140,  180,  300,  400],  // ticks the clone looks ahead
  panicP:    [0.8,  0.6,  0.4,  0.15, 0],    // chance the flare after a scare is exaggerated
  panicSize: [0.35, 0.25, 0.15, 0.05, 0],    // ...and by how much, stick units
  reflex:    [0.40, 0.30, 0.15, 0.03, 0],    // the fixed yank on a flight that was never forecast
};
// THE ROUTE COMPETENCY WAS BUILT AND REMOVED (Phase 3, v361 -> v363).
// A second number per bot (attention: did it look at the fork;
// precision: how far off its read of its own speed) was wired,
// verified and measured twice — in the broken and the fixed world —
// and moved no outcome: a wrong trap call costs a second, and the
// switchback kills for reasons one landing beyond the forecast. A
// skill number the player cannot see is a promise the game cannot
// keep, so it went (handover, addendum 49). The code is kept whole in
// exp/pilot-route-experiment.js.txt for the day a track word makes a
// fork call a matter of life or time. What stayed: the fork call
// itself, at the ceiling's rule for every bot, with the send margin
// under the margin law below.
// THE MARGIN LAW (Phase 3): lean is personality, not skill, and it is
// held to that by construction. It never adds or subtracts stick
// units (v358-v360 did, at 0.15 per unit, and measured as the biggest
// death dial in the mid band — addendum 43); it SCALES every safety
// margin the brain keeps, geometrically: 4^lean. Lean -1 keeps a hair
// (x0.25), +1 quadruples, 0 is exactly x1 so the ceiling is untouched.
// A reckless bot with a perfect thumb loses nothing; a reckless bot
// with a clumsy thumb dies because there is no margin to absorb the
// miss. Recklessness costs in proportion to clumsiness — which is
// what the word means. Applied to: the flare margin, the reflex yank,
// the fork's send margin, and (positive lean only) the pace ease.
function leanScale(lean) { return Math.pow(4, lean); }
// THE PACE (Phase 3): timid into launches. A positive-lean bot eases
// the throttle over the last PACE_ZONE px before a launch word
// (kicker, lip, gap): axis = 1 - PACE_EASE * lean. Zero and negative
// lean hold full throttle — today's behaviour, byte-identical. Derived
// from lean, not a fourth number: caution is one personality.
const PACE_ZONE = 400, PACE_EASE = 0.5;
const LAUNCH_WORDS = { kicker: 1, lip: 1, gap: 1 };
function curve(name, s, table) {
  const K = FLARE_KNOTS, V = (table || FLARE_CURVES)[name];
  if (s <= K[0]) return V[0];
  for (let i = 1; i < K.length; i++) {
    if (s <= K[i]) {
      const t = (s - K[i - 1]) / (K[i] - K[i - 1]);
      return V[i - 1] + (V[i] - V[i - 1]) * t;
    }
  }
  return V[V.length - 1];
}
function dialsFor(flare) {
  const s = Math.max(0, Math.min(1, flare === undefined ? 1 : flare));
  return {
    skill: s,
    askP: curve('askP', s), recheckP: curve('recheckP', s),
    reaction: Math.round(curve('reaction', s)),
    spread: curve('spread', s), horizon: Math.round(curve('horizon', s)),
    panicP: curve('panicP', s), panicSize: curve('panicSize', s),
    reflex: curve('reflex', s),
  };
}

// THE ORACLE, graded. At flare 1 this is the Phase 0 brain exactly; the
// dials below it are the human-shaped ways of being worse, each drawn
// from the bot's OWN counter-based stream (hash01 on race seed, seat,
// draw index — the route call's device), never the shared one.
//
// WHEN IT ASKS (Phase 0, 2026-09-03 — the 10-tick cadence retired).
// Once a body is in the air the landing is DETERMINED, unless
// something the clone could not know has happened. The clone steps
// against the terrain ONLY, holding the inputs — so there are exactly
// two ways its answer goes stale:
//   1. a NON-TERRAIN contact (a rival, a prop) since the last ask;
//   2. the bot's OWN held stick changed since the last ask.
// The bounce chain is not a third: the forecast already tracks the
// worst severity across the whole chain. So: ask at first DESCENDING
// (a forecast on the way up spends a horizon to learn the same
// landing), then only on those two events, plus a confirmation just
// before the forecast's own touchdown, plus a retry when the clone
// never reached a landing. Measured across Phase 0: 863,277 asks ->
// 87,133, deaths per racer 1.038 -> 0.803 (addendum 40).
register('oracle', (opts) => {
  const D = dialsFor(opts && opts.flare);
  const lean = (opts && opts.lean) || 0;
  const LS = leanScale(lean);
  const pace = lean > 0 ? PACE_EASE * lean : 0;
  let held = 0;            // the stick deflection currently prescribed
  let heldUntilGround = false;
  // THE ASK STATE: what the last forecast assumed. asked=false means no
  // live forecast (a new flight, or one that has not started falling).
  // askAxis/askBounce are the stick the clone was told to HOLD — the
  // forecast's own premise, so comparing them to the live input is
  // literally "is the premise still true", not a proxy for it.
  let asked = false, lastAskTick = -1, askAxis = 0, askBounce = 0;
  // The tick the last forecast said its landing would arrive, less the
  // confirmation lead. -1 = nothing scheduled.
  let confirmTick = -1;
  // THE GRADIENT'S STATE. fallTick: when this flight started falling
  // (reaction counts from here). lapsed: this flight was never going
  // to be forecast — the reflex yank instead. draws: the bot's stream
  // position. scareMax / scared: the bot's own perception of the last
  // landing, for panic — read off its ledger, no bus, no stream.
  let fallTick = -1, lapsed = false, draws = 0;
  let scareMax = 0, scared = false, wasClusterOpen = false;
  const rocker = makeRocker();
  // Census state, per bot. A FLIGHT is one descending episode: it opens
  // at the first falling tick and closes on the next grounded tick, so
  // it is exactly the unit the ask rule is about.
  let flying = false, asksThisFlight = 0;
  function roll(ctx) {
    const sd = (ctx.state && ctx.state.race && ctx.state.race.seed) >>> 0;
    return hash01((sd ^ 0xF1A2E) >>> 0, (ctx.index + 1) >>> 0, draws++);
  }
  return {
    name: 'oracle',
    dials: D, lean,   // read-only introspection: what this seat was dealt
    drive(m, ctx) {
      const grounded = m.hitSeverity > 0 || (m.airTicks || 0) === 0;
      // THE SCARE: the ledger's running total while the cluster is
      // open; at its close, compare to this body's lethal threshold.
      // The same ratio the sim's nearMiss event uses (0.85), read
      // from the same ledger — no second detector.
      if (m.clusterOpen) { if (m.clusterE > scareMax) scareMax = m.clusterE; wasClusterOpen = true; }
      else if (wasClusterOpen) {
        const mr = 1 / (m.invM * CONFIG.mass);
        const T = CONFIG.smashThreshold * (mr === 1 ? 1 : dpow(mr, CONFIG.sizeToughness / 3));
        scared = scareMax >= 0.85 * T;
        scareMax = 0; wasClusterOpen = false;
      }
      if (grounded) {
        if (STATS.on && flying) { STATS.askHist.push(asksThisFlight); flying = false; }
        held = 0; heldUntilGround = false;
        asked = false; lastAskTick = -1; confirmTick = -1;
        fallTick = -1; lapsed = false;
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
        if (rc) {
          // THE FORK CALL, every tick, on the real speed against the
          // demand plus the bot's personal margin (the margin law).
          const sendMargin = 80 * LS;
          if (STATS.on) { if (sendMargin < STATS.sendMarginMin) STATS.sendMarginMin = sendMargin; if (sendMargin > STATS.sendMarginMax) STATS.sendMarginMax = sendMargin; }
          if (m.vx < rc.demand + sendMargin) {
            if (STATS.on) STATS.forkDrops++;
            return { axis: dropAxis(m, rc) * dir, bounce: 0 };
          }
          if (STATS.on) STATS.forkSends++;
        }
        // THE PACE: a cautious bot rolls off the throttle into a launch.
        if (pace > 0 && launchAhead(m, ctx, dir)) {
          if (STATS.on) STATS.paceEased++;
          return { axis: (1 - pace) * dir, bounce: 0 };
        }
        return { axis: dir, bounce: 0 };
      }
      // Only a DESCENDING body has a landing to fear (y grows down).
      const falling = m.vy > 0;
      if (falling && fallTick < 0) {
        fallTick = ctx.tick;
        // THE LAPSE: did this bot notice it was falling at all? One
        // draw per flight, always drawn (a bot's stream position is a
        // function of its events, not of its skill). At skill 1 the
        // draw is made and cannot fail.
        lapsed = roll(ctx) >= D.askP;
        if (lapsed) {
          // THE REFLEX: the beginner's yank, no forecast. Too much by
          // design (it bleeds speed), fading with skill to nothing.
          // Panic exaggerates it like any other flare.
          let r = D.reflex * LS;
          if (STATS.on) { STATS.reflexes++; STATS.reflexSum += Math.max(0, r); }
          if (scared) { if (roll(ctx) < D.panicP) { r += D.panicSize; if (STATS.on) STATS.reflexPanics++; } scared = false; }
          held = Math.max(0, Math.min(1, r));
          heldUntilGround = true;
        }
        if (STATS.on) {
          if (!flying) { flying = true; asksThisFlight = 0; STATS.flights++; }
          if (lapsed) STATS.lapses++;
        }
      }
      // REACTION: a bot that notices the drop late asks late. The same
      // wait governs a retry after an unanswered ask: noticing takes as
      // long as noticing takes. (This is what keeps a short horizon
      // cheap — a short-sighted bot that retried every tick would pay a
      // full horizon per tick until the landing came into range.)
      const noticed = falling && !lapsed && (ctx.tick - fallTick) >= D.reaction
        && (lastAskTick < 0 || (ctx.tick - lastAskTick) >= Math.max(1, D.reaction));
      // THE TWO THINGS THE CLONE COULD NOT KNOW. A contact breadcrumb
      // is stamped by the pair law only (resolveMelonPair, physics.js)
      // — terrain never stamps it — so idx >= 0 with a tick newer than
      // the last ask is exactly "a rival or a prop has touched me
      // since I asked". The input test compares the live stick to the
      // one the forecast was told to hold.
      let bumped = asked && m.lastContactIdx >= 0 && m.lastContactTick > lastAskTick;
      let inputMoved = asked && !!ctx.input
        && (ctx.input.rawAxis !== askAxis || (ctx.input.rawBounce || 0) !== askBounce);
      // THE RE-CHECK: noticing a quick bump mid-flight is hard, and
      // only the very good do it every time. A bot that fails the roll
      // has SEEN the event and ignored it — the premise is re-stamped
      // so the same bump is not rolled again next tick. The Phase 0
      // "obliviousness" dial, as a probability on the curve.
      if (bumped || inputMoved) {
        if (roll(ctx) >= D.recheckP) {
          bumped = false; inputMoved = false;
          lastAskTick = ctx.tick;
          askAxis = ctx.input ? ctx.input.rawAxis : askAxis;
          askBounce = ctx.input ? (ctx.input.rawBounce || 0) : askBounce;
          if (STATS.on) STATS.ignoredBumps++;
        }
      }
      const dueConfirm = asked && confirmTick >= 0 && ctx.tick >= confirmTick;
      const stale = (!asked && noticed) || bumped || inputMoved || dueConfirm;
      // The reason, in the order the conditions are written. A retry is
      // the specific case of "no live forecast because the last one
      // reached no landing", which is why it is distinguished from the
      // opening ask of a flight.
      const reason = !asked ? (lastAskTick >= 0 ? 'retry' : 'open')
        : bumped ? 'bump' : dueConfirm ? 'confirm' : 'input';
      // THE METER decides only whether the ask happens NOW. A denied
      // bot keeps its last answer (per the commitment argument, still
      // usually right) and stays stale, so it retries next tick when
      // tokens have refilled — denial defers an ask, it does not
      // cancel one.
      const allowed = falling && stale && meterAllow(ctx.state, ctx.tick);
      if (STATS.on && falling && stale && !allowed) {
        STATS.denials++;
        STATS.denialsBySeat[ctx.index] = (STATS.denialsBySeat[ctx.index] || 0) + 1;
      }
      if (allowed) {
        const wasHeld = heldUntilGround, before = held;
        const p = predictSplat(ctx.state, m, false, ctx.input, D.horizon);
        meterCharge(ctx.state, p.steps);
        // THE CONFIRMATION (2026-09-03, measured): the pure event rule
        // — ask once, re-ask only on a bump or an input change — cost
        // 28x fewer asks and 21% MORE deaths (137 -> 166 over the 12
        // sweep seeds). The forecast itself says WHEN its landing
        // arrives, so the bot looks again just before it — the way a
        // person glances early and then again on the way in.
        // AN UNANSWERED ASK IS NOT A NEGATIVE ONE (2026-09-03,
        // measured). The clone early-outs when the cluster CLOSES, and
        // a body that left the ground with its ledger still open closes
        // that carried cluster in a handful of ticks — so the forecast
        // returns splat:false having reported on the landing the body
        // has just FINISHED, never reaching the next one. 19% of asks
        // come back like this. Committing to one made the silence
        // load-bearing: a signal that cannot say "I don't know" says
        // "yes". Only an ask that REACHED a touchdown is an answer; an
        // unanswered one leaves the bot stale and it asks again after
        // its reaction time. A short horizon (skill below 1) says "I
        // don't know" more often, which is exactly what short sight is.
        const answered = p.impactAt >= 0;
        // Scheduled off the TOUCHDOWN, not the judgement (measured:
        // the two clocks sit 7 ticks apart at the median, 129 at p99;
        // scheduling off steps is quietly late, past the landing in
        // 9.6% of asks). The invariant is exact: a confirmation is
        // never scheduled after the landing it confirms.
        confirmTick = (answered && p.impactAt > CONFIG.oracleConfirmLead)
          ? ctx.tick + p.impactAt - CONFIG.oracleConfirmLead : -1;
        if (STATS.on && answered && confirmTick > ctx.tick + p.impactAt) STATS.lateSchedules++;
        asked = answered;
        lastAskTick = ctx.tick;
        askAxis = ctx.input ? ctx.input.rawAxis : 0;
        askBounce = ctx.input ? (ctx.input.rawBounce || 0) : 0;
        if (STATS.on) {
          asksThisFlight++;
          statsAsk(ctx.tick, p.steps, wasHeld);
          if (asksThisFlight === 1) STATS.firstStepHist.push(p.steps);
          STATS.impactHist.push(p.impactAt);
          if (!answered) STATS.unanswered++;
          if (reason === 'bump') STATS.bumpAsks++;
          else if (reason === 'confirm') STATS.confirmAsks++;
          else if (reason === 'retry') STATS.retryAsks++;
          else if (reason === 'open' && ctx.tick - fallTick < STATS.firstAskDelayMin) STATS.firstAskDelayMin = ctx.tick - fallTick;
        }
        if (p.splat) {
          // What restitution survives this exact contact? Closed-form
          // from the energy law, then converted to the stick position
          // that buys it — plus the expert's margin, because a
          // prescription that lands exactly on the threshold dies to
          // rounding.
          const e = damage.bodyRestitution(m);
          const need = damage.restitutionToSurvive(p.worst, p.T, e);
          const axis = (need === null) ? 1 : damage.restitutionToBounce(need);
          const margin = CONFIG.oracleFlareMargin * LS;   // the margin law
          if (STATS.on) { if (margin < STATS.marginMin) STATS.marginMin = margin; if (margin > STATS.marginMax) STATS.marginMax = margin; }
          let want = (axis === null ? 1 : axis) + margin;
          // THE THUMB: a human lands near the answer, not on it.
          // Spread is a triangular miss (two draws) scaled by skill.
          // Lean is NOT here (Phase 3): it scales the margin above, so
          // a reckless bot never aims under the surviving minimum —
          // its thin margin just cannot absorb a clumsy thumb.
          // Always drawn, so the stream position does not depend on
          // skill; at skill 1 the miss is zero by construction.
          const miss = (roll(ctx) + roll(ctx) - 1) * D.spread;
          want += miss;
          if (STATS.on) STATS.missAbsSum += Math.abs(miss);
          // PANIC: after a scare, the next flare is exaggerated —
          // sometimes, and by an amount, both falling with skill.
          if (scared) { if (roll(ctx) < D.panicP) { want += D.panicSize; if (STATS.on) STATS.panics++; } scared = false; }
          held = Math.max(0, Math.min(1, want));
          heldUntilGround = true;
          if (STATS.on && wasHeld && held !== before) STATS.represcribe++;
        } else if (!heldUntilGround && answered) {
          held = 0;
        }
      }
      // Circular gamut: the stick is a budget, so drive gets whatever
      // flare leaves. Spending the least flare that survives is what
      // makes this near-optimal rather than merely safe.
      const drive = Math.sqrt(Math.max(0, 1 - held * held));
      return { axis: drive * travelDir(m, ctx), bounce: held };
    },
    // A brain's state is real state: an oracle caught mid-fall has
    // already decided how much flare this landing needs, has a
    // forecast it is holding, a confirmation scheduled, and a stream
    // position. A resume that forgot any of it would drive differently
    // for the next few ticks — the difference between "the same race
    // continues" and "a similar race continues". (finishline.js clones
    // brains through exactly this door.)
    save() {
      return { h: held, u: heldUntilGround ? 1 : 0, r: rocker.save(),
        a: asked ? 1 : 0, lt: lastAskTick, ax: askAxis, ab: askBounce, ct: confirmTick,
        ft: fallTick, lp: lapsed ? 1 : 0, dr: draws, sm: scareMax, sc: scared ? 1 : 0,
        wc: wasClusterOpen ? 1 : 0 };
    },
    load(s) {
      if (!s) return;
      held = s.h || 0;
      heldUntilGround = !!s.u;
      rocker.load(s.r);
      asked = !!s.a; lastAskTick = s.lt === undefined ? -1 : s.lt;
      askAxis = s.ax || 0; askBounce = s.ab || 0;
      confirmTick = s.ct === undefined ? -1 : s.ct;
      fallTick = s.ft === undefined ? -1 : s.ft; lapsed = !!s.lp;
      draws = s.dr || 0; scareMax = s.sm || 0; scared = !!s.sc; wasClusterOpen = !!s.wc;
    },
  };
});

// meterAllow/meterCharge are exported for verify-brains.js. A suite
// that reimplemented the bucket would be testing its own copy — the
// per-world scoping cell has to drive the REAL door to mean anything.
window.FF.pilot = { predictSplat, register, create, has, BRAINS,
  STATS, statsReset, statsFlush, meterAllow, meterCharge,
  dialsFor, FLARE_KNOTS, FLARE_CURVES, leanScale, rimStep };
})();