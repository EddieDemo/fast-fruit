(function () {
'use strict';
// ============================================================
// PHYSICS — deterministic fixed-step simulation of one ellipse
// rolling on polyline terrain.
//
// Design notes:
//  * The ellipse collider is REAL (the game demands it): we collide
//    by transforming each terrain segment into the ellipse's local
//    frame, scaling y by a/b so the ellipse becomes a circle of
//    radius a, doing circle-vs-segment there, then mapping the
//    contact back. Normals map through the inverse-transpose of the
//    scale (i.e. y divided by a/b, then re-normalized) — mapping
//    them like points gives subtly wrong bounces on slopes.
//  * Segment ENDPOINTS are covered by the same closest-point test
//    (t is clamped to [0,1]), so terrain vertices are handled and
//    the pointy ends of the ellipse can't slip through corners.
//  * TAPERED bodies (the egg) cannot use the circle trick — no affine
//    map circles a taper — so they take their own support-function
//    contact path (see TAPERED BODIES below), dispatched on m.taper.
//    tau = 0 bodies run the original code byte-for-byte.
//  * Contact resolution is sequential impulses with Coulomb friction
//    plus direct positional correction. Friction at the contact's
//    lever arm is what converts spin into forward motion — rolling
//    is emergent, not scripted.
//  * Determinism: only +,-,*,/ and sqrt/atan2/sin/cos on state that
//    starts identical. Good enough for consistent feel; ghosts will
//    be recorded positions, not re-simulation (per design).
// ============================================================

const { CONFIG, debris, dmath, damage, slab } = window.FF;
// Surface questions (respawn placement, below) go to the SPINE as of
// stage 2 — the heightfield fast path died in stage 1 for contacts,
// and terrainYAt itself is deleted now. Contact generation never
// touches either: only the slab world.
// Motion-affecting transcendentals MUST be deterministic (lockstep).
const dsin = dmath.sin, dcos = dmath.cos, dpow = dmath.pow;
const { snapshotPrev } = window.FF;

// Scratch object reused every contact test to avoid GC churn.
const contact = {
  hit: false,
  px: 0, py: 0,   // contact point (on segment), world
  nx: 0, ny: 0,   // contact normal, world, pointing INTO the melon
  pen: 0,         // penetration depth along normal (px)
  curvR: 1,       // ellipse curvature radius at the contact (px)
};

// Slab-query scratch (stage 1): candidate face indices, and the two
// endpoint shells the narrowphase reads — reused every test, same
// no-churn discipline as `contact`.
const CAND = [];
const SEG_A = { x: 0, y: 0 };
const SEG_B = { x: 0, y: 0 };

// step() advances every body through the IDENTICAL simulation path.
// This is the fairness guarantee for the bots: same stepBody, same
// terrain, same dt, same tick count — the only difference between
// player and bot is the input object fed in.
//
// After all bodies have stepped against terrain, melon-vs-melon
// contacts are resolved pairwise for a few iterations. Pair order is
// fixed (player first, then bots in spawn order), so the whole pass
// stays deterministic.
const NEAR_MISS_RATIO = 0.85; // flash the player above this fraction of lethal

function step(state, dt) {
  snapshotPrev(state);
  state.tick++;
  const tick = state.tick;

  // ---- Revive bodies whose respawn is due ----
  for (const pl of state.players) reviveIfDue(pl.melon, state, tick);
  for (const b of state.bots) reviveIfDue(b.melon, state, tick);

  // ---- Simulate the living, in CANONICAL order (players by slot,
  // then bots) — identical iteration on every lockstep peer. ----
  for (let i = 0; i < state.players.length; i++) {
    const pl = state.players[i];
    if (pl.melon.alive) {
      stepBody(pl.melon, pl.input, state.terrain, dt, i === state.localSlot ? state : null, state);
    }
  }
  for (let bi = 0; bi < state.bots.length; bi++) {
    const b = state.bots[bi];
    // ---- PILOT PASS ----
    // A bot's brain writes the same two input fields the human's stick
    // writes, immediately before its body steps. Fixed iteration order
    // (roster order) is load-bearing for determinism, and a brain must
    // never draw from the shared rng stream. The index passed is the
    // BOT's own (bi) — reusing the player loop's `i` here would have
    // given every bot the same prediction stagger slot.
    if (b.melon.alive) {
      if (b.brain && b.brain.drive) {
        const cmd = b.brain.drive(b.melon, { state, tick: state.tick, index: bi, input: b.input });
        if (cmd) { b.input.rawAxis = cmd.axis; b.input.rawBounce = cmd.bounce; }
      }
      // ---- THE FIELD FOLLOWS THE PLAYER ONTO THE REV ----
      // Bots hold full throttle forever, so on a pinned grid they
      // would be revving before the player has even touched the
      // screen — a field already straining at the line while the
      // player is still deciding where to put their thumb. Silencing
      // them until the countdown starts makes the grid a moment
      // rather than a scene in progress, and the player's own press
      // is what sets the whole field going.
      //
      // Locomotion is unaffected: every racer is released at GO
      // regardless, so this changes the theatre and not the race.
      if (window.FF.gridStart && window.FF.gridStart.silenceBots
        && window.FF.gridStart.silenceBots()) {
        b.input.rawAxis = 0;
        b.input.rawBounce = 0;
      }
      stepBody(b.melon, b.input, state.terrain, dt, null, state);
    }
  }

  // ---- Melon-vs-melon contacts (living bodies only) ----
  // THE CANONICAL CONTACT ORDER, pair half (stage 1, spec §3): pair
  // contacts resolve AFTER terrain contacts (structural — stepBody
  // above did the terrain), ordered by (racerKey a, racerKey b)
  // lexicographic. Spawn order was deterministic already, but it was
  // an ACCIDENT of construction; the law names an order that any
  // future construction (netplay joins, mid-race substitutions,
  // permuted rosters) must land on identically. Ties — bodies with
  // equal or missing keys — fall back to canonical spawn index, so
  // the comparator is a total order and the sort cannot invent
  // nondeterminism. resolveMelonPair(A, B) is role-sensitive in the
  // last float (the contact point leans on rA), so WHICH body is A is
  // part of the law, not a nicety.

  bodyList.length = 0;
  // CANONICAL INDEX, refreshed every step on EVERY body (dead ones
  // included — a dead killer must still be findable): the pair
  // pass's breadcrumb currency. Recomputed rather than trusted,
  // so joins and substitutions can never leave a stale identity.
  { let ci = 0;
    for (const pl of state.players) pl.melon.canonIdx = ci++;
    for (const b of state.bots) b.melon.canonIdx = ci++; }
  for (const pl of state.players) if (pl.melon.alive) bodyList.push(pl.melon);
  for (const b of state.bots) if (b.melon.alive) bodyList.push(b.melon);
  sortBodiesCanonical(bodyList);
  for (const m of bodyList) { m.pairSeverity = 0; m.pairWorst = 0; }
  if (bodyList.length > 1) {
    const PAIR_ITERS = 3;
    const period = state.period; // set in track mode, null in endless
    for (let iter = 0; iter < PAIR_ITERS; iter++) {
      for (let i = 0; i < bodyList.length; i++) {
        for (let j = i + 1; j < bodyList.length; j++) {
          if (resolveMelonPair(bodyList[i], bodyList[j], period)) {
            // THE CONTACT BREADCRUMB (blessed telemetry): both
            // parties remember each other and the tick. Alive-only
            // by construction (bodyList holds the living); repeated
            // iters re-stamp the same tick, harmless. With three in
            // contact the pair-law order decides who is "last" —
            // deterministic because the order is law.
            bodyList[i].lastContactIdx = bodyList[j].canonIdx;
            bodyList[j].lastContactIdx = bodyList[i].canonIdx;
            bodyList[i].lastContactTick = tick;
            bodyList[j].lastContactTick = tick;
          }
        }
      }
    }
  }

  // ---- Smash resolution: one rule for everyone ----
  for (let i = 0; i < state.players.length; i++) {
    applySmashRule(state.players[i].melon, state, tick, i === state.localSlot, i);
  }
  for (let i = 0; i < state.bots.length; i++) {
    // Bot throttle policy lives in the BRAIN REGISTRY ('cruise' holds
    // right forever, air pump included — deaths are the honest price
    // of that speed; see pilot.js). A rawAxis stomp that used to sit
    // here was a fossil of the pre-brain era: written after the step,
    // overwritten by the brain before the next one, deciding nothing.
    applySmashRule(state.bots[i].melon, state, tick, false, state.players.length + i);
  }

  // ---- Debris: burst physics, guts collisions, wreckage shoving ----
  // Runs inside the fixed step so wreckage stays deterministic and
  // ghost-compatible.
  debris.step(state, dt);
}

// Severity now lives in damage.js: harm tracks the ENERGY DISSIPATED
// in a contact (not the impulse), times the same curvature stress
// concentration as ever. The solver below only reports raw contact
// quantities (vn, kn, e) and lets the law judge — see damage.js for
// the full rationale (the impulse law made bounciness the deadliest
// setting, inverting the flare mechanic).

// The event bus hook. Physics only ANNOUNCES; if nothing is
// listening (headless harnesses, ghosts), this costs one property
// read. Never read back by the sim — announcements can't change
// physics, which is what keeps the bus outside determinism.
function emit(state, type, payload) {
  const bus = window.FF.events;
  if (bus) bus.emit(type, payload, state);
}

function applySmashRule(m, state, tick, isPlayer, bodyIndex) {
  if (!m.alive) return;
  // ---- THE CLUSTER LEDGER (2026-08-13; the law's rationale lives in
  // damage.js). The tick's contribution is the SUM of its sources —
  // terrain and traffic add into the same rind, which is what finally
  // charges the sandwich (landed on WHILE landing) honestly. Spawn
  // protection zeroes the contribution rather than skipping the
  // machinery: protected hits are free exactly as before, and the
  // boundary counters stay coherent through the protected window.
  const tickSev = tick <= m.protectTick ? 0 : m.hitSeverity + m.pairSeverity;
  // The pair share of the cluster, kept so a death can say whether
  // traffic or terrain owned the event. Accumulated BEFORE the ledger
  // steps, because a step that closes the cluster resets the field —
  // the close carries the value out (closed.pairE) for exactly that
  // reason.
  if (tickSev > 0) {
    if (!m.clusterOpen) m.clusterPairE = 0;
    m.clusterPairE += m.pairSeverity;
  }
  const closed = damage.clusterStep(m, tickSev);
  const running = closed ? closed.total : (m.clusterOpen ? m.clusterE : 0);
  if (running <= 0) return;
  // Cluster facts for the certificate: at death the cluster is still
  // open (revive resets it); at a roll-triggered close they ride the
  // close itself.
  const clPairE = closed ? closed.pairE : m.clusterPairE;
  const clTicks = closed ? closed.ticks : m.clusterN;
  // Per-body threshold: rind strength scales with size^k (mass ratio
  // is s^3, so T scales by mr^(k/3)). Pinned dpow: lockstep-safe.
  const mr = 1 / (m.invM * CONFIG.mass); // mass ratio = s^3; 1.0 for the player
  const T = CONFIG.smashThreshold * (mr === 1 ? 1 : dpow(mr, CONFIG.sizeToughness / 3));
  if (running >= T && tickSev > 0) {
    // Death lands the TICK the running total crosses — mid-cluster,
    // immediate — never deferred to the cluster's close.
    // Burst BEFORE clearing the body: fragments inherit its velocity
    // field (v + w x r) at the instant of death.
    debris.spawnFromBody(m, state, tick, bodyIndex);
    m.alive = false;
    // THE CONVEYOR (session chassis, 2026-08-25): an open session may
    // override HOW SOON a dead body returns — Ski Jump's whole loop is
    // die, respawn, go again. Placement law unchanged; no session, no
    // change (the default is the config's own number).
    m.respawnAtTick = tick + ((state.session && !state.session.over)
      ? state.session.respawnDelayTicks : CONFIG.respawnDelayTicks);
    // THE DEATH REMEMBERS ITS STRAND (stage 5): the projection foot's
    // owning poly at the moment of death, so the respawn walk can run
    // on the strand the body actually died on (strand.js).
    {
      const pr = (state.spine && state.spine.projectPoint)
        ? state.spine.projectPoint(m.x, m.y) : null;
      m.deathPoly = (pr && pr.dist < 260) ? pr.poly : undefined;
    }
    // The certificate is built for EVERY body: the ticker commentates
    // the whole field, not just the local player. Only the player's
    // lands in state.lastDeath (the death overlay's single slot).
    const cert = makeCertificate(m, state, tick, running, T, isPlayer, clPairE, clTicks);
    if (isPlayer) state.lastDeath = cert;
    emit(state, 'death', cert);
  } else if (closed) {
    // Near-miss commentary fires ONCE per cluster, at its close, on
    // the final total — the number the law actually judged. (The old
    // per-tick emission could re-announce the same landing.) Worst
    // case the flash arrives CLUSTER_GAP_TICKS late: 50ms, invisible.
    const near = closed.total >= T * NEAR_MISS_RATIO;
    // A blow is newsworthy if it was nearly lethal OR if the player's
    // flare is the only reason it wasn't (see sevAtNeutral above).
    // Building the certificate is the cheapest way to ask the second
    // question, so only do it when the first is plausible.
    if (near || m.restitution > CONFIG.restitution) {
      const cert = makeCertificate(m, state, tick, closed.total, T, isPlayer, clPairE, clTicks);
      if (near || cert.flareSaved) {
        if (isPlayer && near) state.fx.flash = 1; // near-miss: teach the envelope
        emit(state, 'nearMiss', cert);
      }
    }
  }
}

// ---- THE CERTIFICATE ----------------------------------------------
// One honest record of a violent contact, for the presentation layer.
// It answers WHY in the terms that now actually decide outcomes:
// how hard (severity vs this body's threshold), how bouncy you were
// (the one thing under your control), what it would have taken to
// survive (the counterfactual — exactly computable, because severity
// scales with (1 - e^2) at fixed energy), and where in the fall it
// happened. The old certificate's curvR/rFlat pair is GONE: under the
// shape-toughness law those numbers no longer cause anything, and a
// classifier reading them was inventing tip-first stories about
// deaths that had nothing to do with orientation.
// sev is the CLUSTER TOTAL (2026-08-13): the number the law judged.
// The counterfactuals below rescale it by (1 - e^2) exactly as they
// rescaled a single blow — every tick of the cluster carried the same
// factor — with the same standing caveat as ever: exact at fixed
// trajectory (a different e would also have bounced differently).
function makeCertificate(m, state, tick, sev, T, isPlayer, clPairE, clTicks) {
  // Judgment saturation here too: the counterfactual ratios divide by
  // (1 - e^2), which explodes and flips sign in the pump band. The
  // certificate judges at the capped e — the same resilience the
  // charge used. No-op below the band.
  const e = Math.min(damage.bodyRestitution(m), CONFIG.bounceMax);
  // Counterfactual: the same dissipated energy re-judged at full
  // flare. severity ~ (1 - e^2), so the ratio is exact.
  const eMax = CONFIG.bounceMax;
  const sevAtFullFlare = sev * ((1 - eMax * eMax) / (1 - e * e));
  // ...and the same energy re-judged at NEUTRAL: what this blow would
  // have done to a player who never touched the stick. This is the
  // credit side of the ledger, and it must be judged by the
  // counterfactual rather than the outcome — a flare that works
  // pushes the ACTUAL severity far below any "near-lethal" bar, so
  // scoring on the outcome would systematically fail to praise the
  // saves that worked best (measured: a 9m drop lands at 81% of
  // lethal when flared, invisible to an 85% near-miss gate).
  const nE = CONFIG.restitution;
  const sevAtNeutral = e > nE ? sev * ((1 - nE * nE) / (1 - e * e)) : sev;
  return {
    tick,
    isPlayer: !!isPlayer,
    name: m.name || '',
    // Traffic owned the event if the pair share carried the MAJORITY
    // of the cluster's energy — a cluster-level fact now, not the
    // single tick the verdict happened to land on.
    byPair: (clPairE || 0) * 2 >= sev,
    severity: sev,
    clusterTicks: clTicks || 1,           // how many contact ticks the event spanned
    threshold: T,
    overkill: sev / T,                    // 1.02 = squeaker, 4 = vaporised
    survived: sev < T,
    restitution: e,                       // flare AT the moment of truth
    flareAxis: m.flareAxisAtHit === undefined ? 0 : m.flareAxisAtHit,
    sevAtFullFlare,
    sevAtNeutral,
    flareSaved: sev < T && sevAtNeutral >= T, // the flare is WHY they lived
    flareWouldSave: sev >= T && sevAtFullFlare < T,
    // The exact prescription: the minimum restitution that survives,
    // and the stick position that buys it. null = unsurvivable at any
    // bounciness, which the commentary must be able to say honestly.
    eNeeded: damage.restitutionToSurvive(sev, T, e),
    axisNeeded: (() => {
      const need = damage.restitutionToSurvive(sev, T, e);
      // null means UNREACHABLE, not merely "needs a lot": the stick
      // tops out at CONFIG.bounceMax, so a requirement above the cap
      // is beyond the player whatever they do. Clamping to 1 here
      // would have the coach promise a save that full flare cannot
      // actually deliver — worse than saying nothing.
      if (need === null || need > CONFIG.bounceMax) return null;
      return damage.restitutionToBounce(need);
    })(),
    // Traffic blame (meaningful only when byPair; see the pair path).
    pairOtherName: m.pairOtherName || '',
    pairOtherE: m.pairOtherE,
    pairIStiffened: !!m.pairIStiffened,
    pairShare: m.pairShare,
    chainIndex: m.chainIndex || 1,        // 1 = the arrival itself
    airTicks: m.lastFlightTicks || 0,
    fallPx: m.lastFallPx || 0,
    toughness: damage.bodyToughness(m),
    species: m.species || 'watermelon',
    vn: Math.abs(state.telemetry.lastImpactVn || 0),
    speed: Math.sqrt(m.vx * m.vx + m.vy * m.vy),
    // THE SPIN TERM: omega x (r x n) at the cluster's worst terrain
    // blow — the contact-point speed the body's SPIN contributed, in
    // px/s. Negative = the spin drove the contact point INTO the
    // ground (a topspin landing: harder than the fall looked);
    // positive = the spin carried it away (backspin armour). Measured
    // to swing an identical landing between 37% and 111% of lethal —
    // the single biggest severity factor, and until now the only one
    // the certificate could not name. Zero for pure pair events.
    spinVn: (m.hitOmegaPre || 0) * (m.hitRxn || 0),
  };
}

const RESPAWN_DROP = 200; // 2m above the surface; the melon falls back in

function reviveIfDue(m, state, tick) {
  if (m.alive || tick < m.respawnAtTick) return;
  // Respawn placement asks the SPINE for the surface (stage 2), and
  // since the RESPAWN-WALK ruling (2026-08-17) it first walks BACK
  // to the nearest climbable spot (uphill grade <= G_GRIND) — a body
  // reborn at zero speed must be somewhere it can actually drive.
  // Deaths on climbable ground respawn in place, exactly as before.
  // A state without a spine (bare suite worlds) keeps the body's y.
  const laws = window.FF.terrainLaws;
  const maxG = laws && laws.G_GRIND !== undefined ? laws.G_GRIND : 0.5;
  // THE CONVEYOR ANCHOR (session fix, 2026-08-25): an open session
  // respawns at its ANCHOR (the start line, by the Ski Jump ruling
  // "instantly respawn back at the start") — the walk-back law is for
  // races, where dying somewhere means resuming near it. A session
  // with no anchor set keeps the race law.
  const sess = (state.session && !state.session.over) ? state.session : null;
  if (sess && sess.respawnXs) {
    // THE CONVEYOR (re-fixed 2026-08-25): every body returns to ITS
    // OWN captured grid position — x and y both — with the standard
    // drop above it. No projection at revive time: the first version
    // ring-searched around the DEATH y and planted bodies inside the
    // floor; the second staggered by slot but still projected. The
    // grid positions were granted by the grid law at session start
    // and cannot be wrong later, because session terrain never
    // changes. Staggering is inherited from the grid itself.
    // PROTECTION AUDIT, recorded: protectTick zeroes SEVERITY only —
    // a damage shield, not a physics ghost; arrivals must simply not
    // overlap, and distinct grid slots guarantee they do not.
    let slot = 0;
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].melon === m) { slot = i; break; }
    }
    for (let i = 0; i < state.bots.length; i++) {
      if (state.bots[i].melon === m) { slot = state.players.length + i; break; }
    }
    m.x = sess.respawnXs[slot] !== undefined ? sess.respawnXs[slot] : sess.respawnX;
    m.alive = true;
    m.y = (sess.respawnYs && sess.respawnYs[slot] !== undefined
      ? sess.respawnYs[slot] : m.y) - RESPAWN_DROP;
    m.vx = 0; m.vy = 0; m.omega = 0;
    m.airTicks = 0;
    m.flightTicks = 0;
    m.lastFlightTicks = 0;
    m.lastFallPx = 0;
    m.protectTick = tick + CONFIG.spawnProtectTicks;
    return;
  }
  const walked = (state.spine && state.spine.respawnPointBehind)
    ? state.spine.respawnPointBehind(m, maxG) : null;
  let wy = null;
  if (walked && !walked.inPlace) {
    // The walk hands back the placement POINT (stage 3: found by
    // arc, not x — on a reversed deck "behind" means +x).
    m.x = walked.x;
    wy = walked.y;
  } else if (state.spine && state.spine.projectPoint) {
    // In place: the surface is the nearest riding face to the body —
    // the deck it died on, not whatever is vertically above.
    const pr = state.spine.projectPoint(m.x, m.y);
    wy = pr ? pr.y : null;
  }
  m.alive = true;
  // 200px falls in ~0.41s arriving at ~9.8 m/s flat-side — well inside
  // the safe envelope, and spawn protection covers the landing anyway.
  m.y = (wy === null ? m.y : wy - m.b - RESPAWN_DROP);
  m.vx = 0; m.vy = 0; m.omega = 0;
  m.angle = 0;            // flat side down
  m.grounded = false;
  m.hitSeverity = 0;
  m.pairSeverity = 0;
  m.pairWorst = 0;
  // A fresh body gets a fresh ledger: the death's half-judged cluster
  // must not lie in wait for the next life.
  damage.resetCluster(m);
  // ...and a fresh FLIGHT ledger. A body that died mid-air kept its
  // old airTicks, so the respawn drop never opened a new flight
  // record and the first post-respawn landing inherited the DEATH
  // flight's apex and chain index — a fabricated fall height and a
  // spurious "died on the rebound" classification waiting to happen.
  m.airTicks = 0;
  m.flightTicks = 0;
  m.chainIndex = 0;
  m.lastFlightTicks = 0;
  m.lastFallPx = 0;
  // Observer site: reset — observers declare their schema fields
  // here, so every body carries them from birth (the declared-schema
  // law, now extensible).
  for (let oi = 0; oi < SIM_OBSERVERS.length; oi++) {
    if (SIM_OBSERVERS[oi].reset) SIM_OBSERVERS[oi].reset(m, tick);
  }
  m.protectTick = tick + CONFIG.spawnProtectTicks;
}

// SIM OBSERVERS (refactor step 5, 2026-08-26): the extension points
// that end per-mode hand-edits of this file. A mode registers an
// observer with any of the hooks below; the sim calls them at FIXED
// SITES in REGISTRATION ORDER (script order is deterministic, so the
// stream is too). Observers write DECLARED-SCHEMA breadcrumbs onto
// bodies — the hitNx precedent, formalized — and never read anything
// nondeterministic. Hooks:
//   reset(m, tick)      — at the melon reset site: declare fields
//   touchdown(m, state) — first contact after flight, BEFORE severity
//                         (a fatal landing still runs it: death can
//                         be the scoring event)
const SIM_OBSERVERS = [];
function registerSimObserver(o) { SIM_OBSERVERS.push(o); return o; }
window.FF.registerSimObserver = registerSimObserver;

// Reused list to avoid per-step allocation.
const bodyList = [];

// Sort bodies into the pair law's order: racerKey ascending, ties by
// the position they already hold (canonical spawn index). No field is
// written on any body — the declared-schema law (state.js) — so the
// sort runs on an index permutation and writes back through scratch.
const SORT_IDX = [];
const SORT_TMP = [];
function sortBodiesCanonical(list) {
  const n = list.length;
  const keyOf = window.FF.racerKey;
  SORT_IDX.length = n;
  for (let i = 0; i < n; i++) SORT_IDX[i] = i;
  SORT_IDX.sort((a, b) => {
    const ka = keyOf(list[a]), kb = keyOf(list[b]);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a - b;
  });
  SORT_TMP.length = n;
  for (let i = 0; i < n; i++) SORT_TMP[i] = list[SORT_IDX[i]];
  for (let i = 0; i < n; i++) list[i] = SORT_TMP[i];
  SORT_TMP.length = 0;
}

// Ellipse radius from center along world direction (nx, ny).
// r(dir) = ab / sqrt(b^2*cos^2 + a^2*sin^2) with the angle measured
// against the body's major axis. Exact for the ellipse; what's
// approximate in the pair solve is only the contact normal (we use
// the center line), which is very close at this low eccentricity.
function supportRadius(m, nx, ny) {
  const c = dcos(m.angle), s = dsin(m.angle);
  const bx = nx * c + ny * s;   // direction component along major axis
  const by = -nx * s + ny * c;  // along minor axis
  const a = m.a, b = m.b;
  if (m.taper) {
    // Tapered radial distance from the COM — NOT symmetric: the fat
    // end reaches less far than the point (COM sits nearer the fat
    // end). Callers must pass each body's true outward direction.
    const t = eggRadialT(m, bx, by);
    const ct = dcos(t), st = dsin(t);
    const qx = eggQx(m, ct), qy = eggQy(m, ct, st);
    return Math.sqrt(qx * qx + qy * qy);
  }
  return (a * b) / Math.sqrt(b * b * bx * bx + a * a * by * by);
}


// Two-body impulse contact between melons A and B, with friction and
// split positional correction by inverse mass (true two-body).
//
// Minimum-image convention (track mode): the terrain repeats every
// (L, D), so each body's periodic images are physically legitimate —
// an image stands on geometry identical to the original's. We collide
// A against B's NEAREST image; because a pure translation changes
// neither velocities nor contact geometry, the impulses apply to the
// real B unchanged. This is what makes "lapping" another melon a
// physical event: a rival one lap back meets you through its image.
function resolveMelonPair(A, B, period) {
  // True two-body dynamics: each side brings its OWN invM/invI. The
  // impulse split follows the mass ratio — the heavy fruit barely
  // recoils, the light one flies. Pack bullying as emergent physics.
  const invMA = A.invM, invIA = A.invI;
  const invMB = B.invM, invIB = B.invI;
  let ox = 0, oy = 0;
  if (period) {
    const k = Math.round((B.x - A.x) / period.L);
    if (k !== 0) { ox = -k * period.L; oy = -k * period.D; }
  }
  const BxI = B.x + ox, ByI = B.y + oy; // B's nearest image to A
  let dx = BxI - A.x, dy = ByI - A.y;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) { dx = 0.01; dy = -0.01; dist = Math.sqrt(dx * dx + dy * dy); }
  const nx = dx / dist, ny = dy / dist;

  const rA = supportRadius(A, nx, ny);
  // B's radius along B's TRUE outward direction (toward A). For an
  // ellipse this is bit-identical to +n (r depends only on squared
  // components); for a tapered body the asymmetry is real.
  const rB = supportRadius(B, -nx, -ny);
  const pen = rA + rB - dist;
  if (pen <= 0) return;

  // Contact point midway between the two overlapping surfaces.
  const cx = A.x + nx * (rA - pen * 0.5);
  const cy = A.y + ny * (rA - pen * 0.5);
  const rax = cx - A.x, ray = cy - A.y;
  const rbx = cx - BxI, rby = cy - ByI; // lever arm from the image center

  // Relative velocity of B w.r.t. A at the contact point.
  const vax = A.vx - A.omega * ray, vay = A.vy + A.omega * rax;
  const vbx = B.vx - B.omega * rby, vby = B.vy + B.omega * rbx;
  let rvx = vbx - vax, rvy = vby - vay;

  // --- Normal impulse ---
  const vn = rvx * nx + rvy * ny; // negative = approaching
  let jn = 0;
  if (vn < 0) {
    // Restitution belongs to the PAIR: the deader material dominates
    // (rubber can't bounce off clay) — e = min of the two bodies',
    // gated by the same slow-contact threshold as ever. At neutral
    // (no body carries its own e) both are CONFIG.restitution and the
    // min is a no-op: the impulse below is bit-identical to the old
    // solver, so trajectories at neutral don't move.
    const gate = -vn > CONFIG.restitutionThreshold;
    const eA = gate ? damage.bodyRestitution(A) : 0;
    const eB = gate ? damage.bodyRestitution(B) : 0;
    const e = eA < eB ? eA : eB;
    const raCn = rax * ny - ray * nx;
    const rbCn = rbx * ny - rby * nx;
    const k = invMA + invMB + raCn * raCn * invIA + rbCn * rbCn * invIB;
    jn = (-(1 + e) * vn) / k;
    A.vx -= jn * nx * invMA; A.vy -= jn * ny * invMA; A.omega -= raCn * jn * invIA;
    B.vx += jn * nx * invMB; B.vy += jn * ny * invMB; B.omega += rbCn * jn * invIB;

    // --- Smash severity, evaluated PER BODY ---
    // The pair dissipates ONE quantity of energy (using the pair's e);
    // it is SHARED BY COMPLIANCE — each body's share tracks its own
    // deadness (equal e -> half each) — then each share is judged by
    // that body's OWN local curvature penalty: a melon struck on its
    // pointy tip suffers more than the one that hit flat. Same
    // collision, different fates. Deadening a pack hit on purpose
    // means eating the larger share: armour that costs.
    const E = damage.dissipated(vn, k, e);
    const [shA, shB] = damage.pairShares(eA, eB);
    const sevA = damage.severityFromE(shA * E, A);
    const sevB = damage.severityFromE(shB * E, B);
    // ---- TRAFFIC BLAME (presentation breadcrumb) ----
    // The pair's restitution is min(eA, eB): ONE body deadened this
    // collision for both. And shares run with deadness, so the
    // stiffer body eats the bigger cut of the energy. Recording both
    // facts turns "TRAFFIC INCIDENT" into an accurate accusation —
    // either your own rigidity cost you, or a rival's took the bounce
    // out from under you. Written every pair contact, read only by
    // the certificate.
    const aStiffer = eA <= eB;
    // Severity ACCUMULATES (2026-08-13): every pair contact in the
    // tick adds into the body's total — two rivals sandwiching one
    // melon are charged together, as the energy actually arrives.
    // Iterations can't double-count: a resolved contact's vn is
    // non-negative on the next pass and dissipates zero.
    A.pairSeverity += sevA;
    B.pairSeverity += sevB;
    // Blame rides with the DOMINANT contact only (tracked separately
    // in pairWorst now that pairSeverity is a sum). A deep overlap
    // produces a second contact point in the same tick whose approach
    // speed is tiny — the restitution gate zeroes both bodies' e
    // there, so writing blame unconditionally let that trivial touch
    // overwrite the real collision's story with a meaningless 50/50
    // (measured: a rigid player's share read 0.50 instead of 0.53).
    if (sevA > A.pairWorst) {
      A.pairWorst = sevA; A.pairNx = -nx; A.pairNy = -ny; A.pairJn = jn;
      A.pairOtherName = B.name || '';
      A.pairOtherE = eB;
      A.pairIStiffened = aStiffer;
      A.pairShare = shA;
    }
    if (sevB > B.pairWorst) {
      B.pairWorst = sevB; B.pairNx = nx; B.pairNy = ny; B.pairJn = jn;
      B.pairOtherName = A.name || '';
      B.pairOtherE = eA;
      B.pairIStiffened = !aStiffer;
      B.pairShare = shB;
    }
  }

  // --- Friction impulse (melon rind on melon rind) ---
  if (jn > 0) {
    const vax2 = A.vx - A.omega * ray, vay2 = A.vy + A.omega * rax;
    const vbx2 = B.vx - B.omega * rby, vby2 = B.vy + B.omega * rbx;
    rvx = vbx2 - vax2; rvy = vby2 - vay2;
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const raCt = rax * ty - ray * tx;
    const rbCt = rbx * ty - rby * tx;
    const kt = invMA + invMB + raCt * raCt * invIA + rbCt * rbCt * invIB;
    let jt = -vt / kt;
    // rind on rind: the two-coefficient friction law
    const maxJt = CONFIG.rindFriction * jn;
    if (jt > maxJt) jt = maxJt;
    if (jt < -maxJt) jt = -maxJt;
    A.vx -= jt * tx * invMA; A.vy -= jt * ty * invMA; A.omega -= raCt * jt * invIA;
    B.vx += jt * tx * invMB; B.vy += jt * ty * invMB; B.omega += rbCt * jt * invIB;
  }

  // --- Positional correction, split by inverse mass ---
  const corr = Math.max(pen - CONFIG.penetrationSlop, 0) * CONFIG.positionCorrection;
  if (corr > 0) {
    const wA = invMA / (invMA + invMB), wB = 1 - wA;
    A.x -= nx * corr * wA; A.y -= ny * corr * wA;
    B.x += nx * corr * wB; B.y += ny * corr * wB;
  }
  // Real contact happened (the pen<=0 early-out returned undefined
  // above): report it so the pair pass can stamp the breadcrumb.
  return true;
}

// Advance one body. `sink` is the state object for the PLAYER body
// (receives telemetry + fx events) and null for ghosts — ghosts must
// never write player-facing telemetry or visual squash.
// Grounded-ness lives ON the body (m.grounded) so each body's motor
// sees its own contact status.
// ---- THE HOP (prototype, 2026-08-25, Eddie's spec) ----
// Coulomb push-off, PURE: given the body's state and the stored
// contact normal, return the delta-v and delta-omega of one hop.
// Normal launch along the (up-blended) contact normal; tangential
// impulse opposes the CONTACT-POINT SLIP (spin and travel both live
// in it), capped by the friction cone mu*Jn, and its torque CONSUMES
// spin — no free energy: lateral kick is paid for in rotation.
// Exported for verify-hop; the suite pins the signs (a melon
// spinning to roll +x kicks +x and loses spin).
function hopImpulse(m, H) {
  let nx = m.hopNx || 0, ny = m.hopNy || 0;
  const nl = Math.hypot(nx, ny);
  if (nl < 1e-9) { nx = 0; ny = -1; } else { nx /= nl; ny /= nl; }
  if (H.upBlend > 0) {
    nx = nx * (1 - H.upBlend);
    ny = ny * (1 - H.upBlend) - H.upBlend;
    const l2 = Math.hypot(nx, ny) || 1;
    nx /= l2; ny /= l2;
  }
  // Normal impulse, expressed as delta-v (the dial's units).
  const dvnX = nx * H.mag, dvnY = ny * H.mag;
  const Jn = H.mag / m.invM;
  // Contact point: one effective radius into the surface. The lever
  // approximation (r along -n) matches the solver's convention for a
  // resting body; a prototype does not need the egg's exact support.
  const r = (m.a + m.b) / 2;
  // Tangent and contact-point slip: t = perp(n); slip = v.t + omega*(r x t term).
  const tx = -ny, ty = nx;
  const rxT = (-nx * r) * ty - (-ny * r) * tx;   // r x t (z), = -r
  // Contact-point slip along t, from the solver's own convention
  // (v_p = v + (-omega*r_y, +omega*r_x)): s = v.t + omega*(r x t).
  // (The first cut carried a stray -1 here; verify-hop B1/B2/B6
  // pinned the roll-direction and spin-consumption signs and caught
  // it before the thumb ever felt an inverted hop.)
  const slip = m.vx * tx + m.vy * ty + m.omega * rxT;
  // The impulse that would ZERO the slip at the point, capped by the cone.
  const kT = m.invM + rxT * rxT * m.invI;
  let Jt = kT > 1e-12 ? -slip / kT : 0;
  const cap = H.mu * Math.abs(Jn);
  if (Jt > cap) Jt = cap;
  if (Jt < -cap) Jt = -cap;
  return {
    dvx: dvnX + Jt * tx * m.invM,
    dvy: dvnY + Jt * ty * m.invM,
    domega: Jt * rxT * m.invI,
    // Presentation extras (fx breadcrumbs; the sim reads none of
    // these): the tangential kick alone, and the push-off normal —
    // the dust sprays OPPOSITE the kick, because that is where the
    // ground's equal-opposite share of the momentum went.
    kx: Jt * tx * m.invM, ky: Jt * ty * m.invM, nx, ny,
  };
}

function stepBody(m, inp, terrain, dt, sink, simState) {
  const invM = m.invM;
  const invI = m.invI;
  // The slab world, once per body step: the motor reads strand dir
  // from it and the collision phase queries it.
  const world = slab.worldFor(terrain);

  // ---- 0.5 THE HOP (prototype; player only, flag-gated) ----
  // Consumed at step START so the grounding test reads LAST tick's
  // truth (airTicks, stored normal) — deterministic within a run;
  // excluded from ghosts and mp until ruled a phase.
  if (CONFIG.hopProto && inp && inp.hopEligible
    && (inp.hopPending || inp.hopBuffer)) {
    // BUFFERED HOP (pump ruling): a tap while airborne beyond coyote
    // WAITS briefly for touchdown instead of evaporating — input
    // hospitality, ~100ms, so pre-landing taps land the pump instead
    // of feeling dropped. A fresh tap refills the buffer.
    if (inp.hopPending) {
      inp.hopPending = 0;
      inp.hopBuffer = (CONFIG.pump && CONFIG.pump.bufferTicks) || 12;
    }
    const H = CONFIG.hop;
    const groundedNow = (m.airTicks || 0) <= (H.coyoteTicks || 0);
    if (m.alive && groundedNow && (m.hopNx || m.hopNy)) {
      const d = hopImpulse(m, H);
      m.vx += d.dvx; m.vy += d.dvy; m.omega += d.domega;
      // fx breadcrumbs (divergence license, like hitNx): where the
      // hop pushed off, and the tangential kick to react against.
      const rEff = (m.a + m.b) / 2;
      m.hopFxSeq = (m.hopFxSeq || 0) + 1;
      m.hopFxX = m.x - d.nx * rEff;
      m.hopFxY = m.y - d.ny * rEff;
      m.hopFxKx = d.kx; m.hopFxKy = d.ky;
      m.hopFxNx = d.nx; m.hopFxNy = d.ny;
      inp.hopBuffer = 0;
    } else if (inp.hopBuffer > 0) {
      inp.hopBuffer--;
    }
  }

  // ---- 1. Input smoothing (ease torqueAxis toward rawAxis) ----
  const ease = Math.min(1, CONFIG.inputResponse * dt);
  inp.torqueAxis += (inp.rawAxis - inp.torqueAxis) * ease;
  // The flare smooths on its OWN, snappier constant (2026-08-13):
  // steering is a steering skill, but the flare is a TIMING skill —
  // at the shared rate a panic flick reached 90% deflection 92ms
  // after the thumb did, so last-instant saves were judged at half
  // the deflection the player was holding. Falls back to the shared
  // rate for configs that predate the split. Bots hold rawBounce 0
  // forever, which maps to exactly the live CONFIG restitution —
  // full throttle at neutral bounce, no special case (Eddie's spec).
  const bEase = Math.min(1, (CONFIG.bounceResponse || CONFIG.inputResponse) * dt);
  inp.bounceAxis += ((inp.rawBounce || 0) - inp.bounceAxis) * bEase;
  m.restitution = damage.bounceToRestitution(inp.bounceAxis);
  m.flareAxisAtHit = inp.bounceAxis; // certificate breadcrumb (presentation)

  // ---- 2. Motor torque ----
  // Electric-motor curve: full torque from standstill, tapering to zero
  // as spin approaches maxAngVel in the driven direction. Driving
  // AGAINST current spin (braking / reversing) gets a boost — this is
  // what makes backspin-to-brake feel authoritative.
  //
  // SEMANTIC INPUT (stage 2 plumbing): axis means FORWARD — spin
  // toward the strand's travel direction — not "+x". Every strand
  // today runs dir +1, so the branch below never fires and the
  // arithmetic is untouched (the bit-parity contract); reversed
  // strands (stage 3 folds) make it real. The dir is read from the
  // slab world so physics and rendering share one source of truth.
  const axis = inp.torqueAxis;
  if (axis !== 0) {
    // RAW INPUT (ruled by Eddie, 2026-08-17, replacing stage-3
    // semantic input): stick right spins the melon clockwise and
    // rolls it right, EVERYWHERE, on every surface. The camera never
    // rotates, so the screen is world-space — Sonic logic, not
    // car-game logic. Semantic input flipped torque by the nearest
    // face's point-order direction; it shipped as reasoning and was
    // never felt in play (v1's reversed deck was unreachable), and
    // its flip was the hidden engine of the watershed attractor.
    // Direction choice now lives in the BRAINS (pilot.js), where it
    // is a tunable behaviour, not a physics inevitability.
    let torque;
    // ENGINE SCALING: bigger fruit, bigger engine. Motor torque scales
    // as I/r (i.e. s^4), which makes LINEAR acceleration size-neutral:
    // torque * invI * r = const. Without this, angular accel inherits
    // the full s^-5 and the whopper is a freight train (tournament-
    // measured: -49% distance even with deaths equalized). Player at
    // scale 1.0: engineK is exactly 1. Pinned ops only.
    const sRatio = m.a / CONFIG.semiMajor;
    // THE ENGINE FOLLOWS THE MASS (ruled 2026-08-27g). The beautiful
    // form of this law is: torque ~ mass x radius x size^-0.5 — one
    // physical term (constant power-to-weight: every body in the
    // universe gets identical linear acceleration) and ONE authored
    // term (s^-0.5, the hare/freight-train character: small spools
    // quick, big carries a higher ceiling via the untouched rev cap).
    // COMPUTED as density x s^3.5 because the forms are equal —
    // density is exactly the ratio by which mass departs from the
    // s^3 assumption the old heuristic baked in — and this form is
    // BIT-IDENTICAL for every density-1 body: x1.0 is exact, so the
    // whole melon family, the eggs and the spheres keep their
    // tournament-tuned numbers to the bit (the tau=0 fast-path
    // precedent, applied again). What changes: bodies whose density
    // departs from 1 stop being outside the law — the beach ball was
    // receiving a big body's torque against 0.008 of the assumed
    // inertia, ~90x the intended acceleration. The rev cap stays
    // mass-free on purpose: top speed is a SIZE character (s^0.6),
    // not a mass one.
    const rho = window.FF.speciesDensity ? window.FF.speciesDensity(m.species) : 1;
    const engineK = (sRatio === 1 && rho === 1) ? 1
      : dpow(sRatio, CONFIG.sizeEngineExp) * rho;
    // Rev limit: small wheels rev higher (real vehicle mechanics).
    const revCap = CONFIG.maxAngVel * (sRatio === 1 ? 1 : dpow(sRatio, -CONFIG.sizeRevExp));
    const sameDir = axis * m.omega > 0;
    if (sameDir) {
      const headroom = Math.max(0, 1 - Math.abs(m.omega) / revCap);
      torque = axis * CONFIG.motorTorque * engineK * headroom;
    } else {
      torque = axis * CONFIG.motorTorque * engineK * CONFIG.brakeBoost;
    }
    if (!m.grounded) torque *= CONFIG.airTorqueScale;
    m.omega += torque * invI * dt;
  }

  // ---- 3. Forces & damping ----
  m.vy += CONFIG.gravity * dt;
  const linDamp = Math.max(0, 1 - CONFIG.linearDamping * dt);
  const angDamp = Math.max(0, 1 - CONFIG.angularDamping * dt);
  m.vx *= linDamp;
  m.vy *= linDamp;
  m.omega *= angDamp;

  // ---- 4. Integrate ----
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.angle += m.omega * dt;

  // ---- GRID PIN (pre-race) ----
  // A pinned body may spin and bounce but cannot travel: x is held at
  // the grid slot it was placed in. That is what lets a melon REV on
  // the line — building angular momentum, hopping on its own
  // elliptical geometry — without dragging itself, or the melon in
  // front of it, over the line. Applied after integration and again
  // after contacts below, because a neighbour's shove arrives there.
  if (m.pinX !== null && m.pinX !== undefined) {
    m.x = m.pinX;
    m.vx = 0;
  }
  if (m.pinY !== null && m.pinY !== undefined) {
    m.y = m.pinY;
    m.vy = 0;
  }

  // ---- 5. Collide & resolve ----
  const wasGrounded = m.grounded;
  let grounded = false;
  let strongestE = 0;   // the tick's worst SINGLE blow: FX direction, telemetry
  let sumE = 0;         // the tick's TOTAL dissipation: what the law charges
  let impactNormalAngle = 0;
  let impactVn = 0;
  m.hitSeverity = 0;

  // Broad phase: the slab world's spatial hash (stage 1). Candidates
  // are COLLECTED then returned in CANONICAL (strandId, segmentIndex,
  // face) order — hash iteration order can never influence results
  // (THE LAW, spec §2/§3). The query AABB is the body's bound radius
  // plus slack for the solver's positional corrections; anything the
  // inflation admits beyond that is non-contacting and resolves to
  // nothing, so the candidate set is a superset of the contact set
  // and the inflation amount cannot move trajectories.
  const boundR = m.a * (1 + (m.taper || 0)) + 32;
  for (let iter = 0; iter < CONFIG.solverIterations; iter++) {
    const nCand = world.query(m.x - boundR, m.y - boundR,
      m.x + boundR, m.y + boundR, CAND);
    for (let ci = 0; ci < nCand; ci++) {
      const fi = CAND[ci];
      SEG_A.x = world.fax[fi]; SEG_A.y = world.fay[fi];
      SEG_B.x = world.fbx[fi]; SEG_B.y = world.fby[fi];
      const A = SEG_A, B = SEG_B;
      if (m.taper) eggVsSegment(m, A, B, contact);
      else ellipseVsSegment(m, A, B, contact);
      if (!contact.hit) continue;
      grounded = true;
      // HOP PROTOTYPE: remember what we last stood on. Accumulated
      // per tick (a gully sums both walls, pointing out of the
      // notch), normalized at hop time. Flag-guarded so the
      // flag-off sim writes not one new field (bit-parity).
      if (CONFIG.hopProto && inp && inp.hopEligible) {
        if (m.airTicks !== 0) { m.hopNx = 0; m.hopNy = 0; }
        m.hopNx = (m.hopNx || 0) + contact.nx;
        m.hopNy = (m.hopNy || 0) + contact.ny;
      }

      const omegaPre = m.omega; // spin AT approach: the certificate's spin term
      const applied = resolveContact(m, contact, invM, invI);
      // JUDGMENT SATURATES (pump ruling, 2026-08-25): dissipation's
      // (1 - e^2) goes NEGATIVE past e=1 — unclamped, pumping would
      // HEAL. Resilience caps at the passive max: a pumped landing is
      // charged as if at bounceMax, which is what builds the
      // per-bounce toll and the cliff. Bit-safe when e <= bounceMax
      // (min is a no-op), so the passive game is untouched.
      const ev = damage.dissipated(applied.vn, applied.kn,
        Math.min(applied.e, CONFIG.bounceMax));
      // The law charges the tick's TOTAL: every contact's dissipation
      // adds (a wedge landing's two walls both count — under the old
      // max a 35-degree vee read at barely half its honest energy).
      // Iterations can't double-count: once a contact's approach is
      // resolved, its vn is non-negative and dissipates zero.
      sumE += ev;
      // The worst SINGLE blow still picks the event's direction and
      // telemetry — drama follows the biggest hit, damage follows
      // the total.
      if (ev > strongestE) {
        strongestE = ev;
        impactNormalAngle = Math.atan2(contact.ny, contact.nx);
        impactVn = applied.vn;
        // Escape direction of the blow (away from the ground) —
        // pinned ops only: the debris burst aims along this, so it
        // must be deterministic (Math.atan2 above is telemetry-only).
        m.hitNx = contact.nx;
        m.hitNy = contact.ny;
        m.hitJn = applied.jn; // raw impulse: severity decides death, impulse decides drama
        m.hitRxn = applied.rxn;     // r x n at the blow: the spin term's lever
        m.hitOmegaPre = omegaPre;   // certificate breadcrumb (presentation)
      }
    }
  }
  // Contacts (terrain and neighbours) can move a pinned body; hold it
  // again so a revving pack cannot push the front row over the line,
  // and so a melon hovering on the grid is not knocked off its mark.
  if (m.pinX !== null && m.pinX !== undefined) {
    m.x = m.pinX;
    m.vx = 0;
  }
  if (m.pinY !== null && m.pinY !== undefined) {
    m.y = m.pinY;
    m.vy = 0;
  }

  m.grounded = grounded;
  // ---- FLIGHT LEDGER (presentation telemetry, every body) ----
  // The commentary layer needs to know the SHAPE of an event, not
  // just its magnitude: how long you were up, how high, and whether
  // the blow that got you was the arrival or the third bounce of a
  // bleed chain (a story the energy law made possible and the old
  // orientation commentary couldn't tell). Cheap scalars, written
  // every tick, read by nobody in the sim — same divergence license
  // as fx and telemetry.
  const wasAir = (m.airTicks || 0) > 0;
  m.airTicks = grounded ? 0 : (m.airTicks || 0) + 1;
  if (!grounded) {
    if (!wasAir) {
      // Launch: open a flight record.
      m.flightTicks = 0;
      m.flightApexY = m.y;
      m.launchY = m.y;
      m.chainIndex = 0;
    }
    m.flightTicks = (m.flightTicks || 0) + 1;
    if (m.y < (m.flightApexY === undefined ? m.y : m.flightApexY)) m.flightApexY = m.y;
  } else if (wasAir) {
    // Touchdown: this contact is the next link in the landing chain.
    m.chainIndex = (m.chainIndex || 0) + 1;
    m.lastFlightTicks = m.flightTicks || 0;
    // Fall height in px: apex to the ground we just met.
    m.lastFallPx = Math.max(0, m.y - (m.flightApexY === undefined ? m.y : m.flightApexY));
    // Observer site: touchdown, BEFORE severity (fatal landings
    // still run — death can be the scoring event). The ski-jump mark
    // lived here as a hand-edit from 2026-08-25 to 2026-08-26; it is
    // now skijump.js's own registered observer, the first customer
    // of the sites that end such hand-edits.
    // THE WORLD, NOT THE SINK (fix 2026-08-26q). This line shipped
    // reading `state` — a const declared thirty lines DOWN (the
    // player-only telemetry alias of sink), so any landing with an
    // observer registered threw a TDZ ReferenceError and killed the
    // frame loop. The battery never saw it: the harness loads the sim
    // tier only, and verify-skijump's SPY registrar replaces the real
    // one — no suite ever ran real physics with a real observer. The
    // `simState` guard is also the CLONE FENCE: stepBodyClone passes
    // no world, so predictSplat's forecast landings can never fire
    // observers and write predicted marks over real ones.
    for (let oi = 0; oi < SIM_OBSERVERS.length; oi++) {
      if (simState && SIM_OBSERVERS[oi].touchdown) SIM_OBSERVERS[oi].touchdown(m, simState);
    }
  }
  if (sumE > 0) {
    // hitSeverity is the tick's TOTAL severity now (2026-08-13): the
    // exact quantity the cluster ledger accumulates, so squash below
    // stays a truthful preview of how close to bursting — a wedge
    // landing deforms for BOTH walls, as it should.
    m.hitSeverity = damage.severityFromE(sumE, m);

    // ---- Per-body STRAIN (deformation): every melon, not just the
    // player. Strain is severity per unit mass — impulse scaled by the
    // curvature penalty (a tip concentrates the same force into far
    // higher pressure, so it deforms more) and divided by mass (light
    // fruit is springier than heavy fruit at equal load). Presentation
    // tier: nothing reads it back, so determinism is untouched — but
    // unlike the old raw-impulse squash it now tracks the SAME quantity
    // the smash rule judges, making deformation a truthful preview of
    // how close a body came to bursting.
    // Stiffening response: deformation rises steeply for light hits and
    // flattens toward the 0.3 limit, so the whole envelope stays
    // legible instead of saturating (see CONFIG.squashCurve).
    const rel = (m.hitSeverity * m.invM) / CONFIG.squashRef;
    const strain = Math.min(0.3, 0.3 * dpow(Math.min(1, rel), CONFIG.squashCurve));
    if (strain > (m.squash || 0)) {
      m.squash = strain;
      m.squashAngle = Math.atan2(m.hitNy, m.hitNx); // pinned-op normal
    }
  }

  // ---- 6. Telemetry & FX events (player body only) ----
  if (!sink) return;
  const state = sink;
  state.telemetry.grounded = grounded;

  // A "landing" = airborne last step, meaningful impact this step.
  if (grounded && !wasGrounded && impactVn < -CONFIG.restitutionThreshold) {
    state.telemetry.lastImpactVn = -impactVn; // report as positive speed
    state.telemetry.lastImpactTick = state.tick;

    // Landing orientation: angle between the melon's MAJOR axis and the
    // surface tangent, folded to [0°, 90°]. 0° = flat-side landing
    // (safe), 90° = landed on the pointy end (future break territory).
    const tangentAngle = impactNormalAngle + Math.PI / 2;
    let d = (tangentAngle - m.angle) % Math.PI;
    if (d < 0) d += Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    state.telemetry.lastImpactAngleDeg = (d * 180) / Math.PI;
  }

  // (Squash now lives per-body as m.squash — written above for every
  // melon, player and bot alike — so state.fx no longer carries it.)
}

// ------------------------------------------------------------
// TAPERED BODIES (the egg): boundary geometry for τ ≠ 0.
//
// The circle-scaling trick above is structurally dead for a taper —
// no affine map turns an egg into a circle — so tapered bodies take
// their own contact path, dispatched on m.taper, and MELONS NEVER
// ENTER IT: τ = 0 bodies run the original code byte-for-byte, which
// is what carries the tournament balance over by construction.
//
// Boundary in the COM frame (the body origin IS the mass center;
// m.sh = aτ/4 is where the geometric center sits):
//   q(t) = (a·cos t + sh,  b·sin t·g),  g = 1 − τ·cos t
// Derivatives (used for normals, support and curvature — all closed
// form, no inverse trig anywhere; the sim may not touch atan2/acos):
//   q'(t) = (−a·sin t,  b·(cos t + τ − 2τ·cos²t))
//   curvature radius R(t) = (qx'² + qy'²)^{3/2} / (ab·(1 + τc(2c²−3)))
// which lands exactly on the ellipse forms at τ = 0 and gives the
// honest asymmetry at the ends: R_tip = b²(1−τ)²/a (sharper, more
// fragile under the smash law), R_blunt = b²(1+τ)²/a (tougher). The
// profile is convex for τ up to ~0.38 (1 + τc(2c²−3) > 0), well
// clear of the egg's 0.26.
//
// DETERMINISM: dsin/dcos only, a FIXED coarse grid (trig precomputed
// once below), and refinement loops with FIXED iteration counts —
// identical arithmetic on every peer, no tolerance-dependent exits.
// ------------------------------------------------------------

// Fixed 16-point parameter grid for coarse scans (pinned constants).
const EGG_N = 16;
const EGG_C = new Float64Array(EGG_N), EGG_S = new Float64Array(EGG_N);
for (let i = 0; i < EGG_N; i++) {
  const t = (i / EGG_N) * 6.283185307179586;
  EGG_C[i] = dcos(t); EGG_S[i] = dsin(t);
}
const EGG_DT = 6.283185307179586 / EGG_N;
const GOLD = 0.6180339887498949;

// Boundary point in the COM frame from (cos t, sin t).
function eggQx(m, c) { return m.a * c + m.sh; }
function eggQy(m, c, s) { return m.b * s * (1 - m.taper * c); }

// Curvature radius at (cos t, sin t) — closed form, pinned ops.
function eggCurvR(m, c, s) {
  const a = m.a, b = m.b, T = m.taper;
  const dx = -a * s;
  const dy = b * (c + T - 2 * T * c * c);
  const num = a * b * (1 + T * c * (2 * c * c - 3));
  const sp2 = dx * dx + dy * dy;
  return (sp2 * Math.sqrt(sp2)) / num;
}

// Maximize f(t) = dx·qx(t) + dy·qy(t) (the support parameter in
// direction (dx,dy), COM frame). Coarse grid then fixed golden-section
// refinement. Returns t.
function eggSupportT(m, dx, dy) {
  let bi = 0, bv = -Infinity;
  for (let i = 0; i < EGG_N; i++) {
    const v = dx * eggQx(m, EGG_C[i]) + dy * eggQy(m, EGG_C[i], EGG_S[i]);
    if (v > bv) { bv = v; bi = i; }
  }
  let lo = bi * EGG_DT - EGG_DT, hi = bi * EGG_DT + EGG_DT;
  let m1 = hi - GOLD * (hi - lo), m2 = lo + GOLD * (hi - lo);
  let f1 = eggDot(m, dx, dy, m1), f2 = eggDot(m, dx, dy, m2);
  for (let k = 0; k < 18; k++) {
    if (f1 < f2) {
      lo = m1; m1 = m2; f1 = f2;
      m2 = lo + GOLD * (hi - lo); f2 = eggDot(m, dx, dy, m2);
    } else {
      hi = m2; m2 = m1; f2 = f1;
      m1 = hi - GOLD * (hi - lo); f1 = eggDot(m, dx, dy, m1);
    }
  }
  return (lo + hi) / 2;
}
function eggDot(m, dx, dy, t) {
  const c = dcos(t), s = dsin(t);
  return dx * eggQx(m, c) + dy * eggQy(m, c, s);
}

// Minimize |q(t) − (px,py)|² — the closest boundary parameter to a
// point (COM frame). Same coarse + fixed golden scaffold.
function eggClosestT(m, px, py) {
  let bi = 0, bv = Infinity;
  for (let i = 0; i < EGG_N; i++) {
    const ex = eggQx(m, EGG_C[i]) - px, ey = eggQy(m, EGG_C[i], EGG_S[i]) - py;
    const v = ex * ex + ey * ey;
    if (v < bv) { bv = v; bi = i; }
  }
  let lo = bi * EGG_DT - EGG_DT, hi = bi * EGG_DT + EGG_DT;
  let m1 = hi - GOLD * (hi - lo), m2 = lo + GOLD * (hi - lo);
  let f1 = eggD2(m, px, py, m1), f2 = eggD2(m, px, py, m2);
  for (let k = 0; k < 18; k++) {
    if (f1 > f2) {
      lo = m1; m1 = m2; f1 = f2;
      m2 = lo + GOLD * (hi - lo); f2 = eggD2(m, px, py, m2);
    } else {
      hi = m2; m2 = m1; f2 = f1;
      m1 = hi - GOLD * (hi - lo); f1 = eggD2(m, px, py, m1);
    }
  }
  return (lo + hi) / 2;
}
function eggD2(m, px, py, t) {
  const c = dcos(t), s = dsin(t);
  const ex = eggQx(m, c) - px, ey = eggQy(m, c, s) - py;
  return ex * ex + ey * ey;
}

// Radial boundary parameter: the t where q(t) is PARALLEL to (dx,dy)
// with positive dot — the ray from the COM along (dx,dy) meets the
// boundary. Bracket the cross-product sign change on the fixed grid,
// then fixed bisection. Convexity + interior COM make it unique.
function eggRadialT(m, dx, dy) {
  let prevCr = 0, prevDot = 0, bi = -1;
  // Grid values at i = 0 first, then walk the ring including wrap.
  const q0x = eggQx(m, EGG_C[0]), q0y = eggQy(m, EGG_C[0], EGG_S[0]);
  let cr0 = q0x * dy - q0y * dx, dot0 = q0x * dx + q0y * dy;
  prevCr = cr0; prevDot = dot0;
  for (let i = 1; i <= EGG_N; i++) {
    const j = i % EGG_N;
    const qx = eggQx(m, EGG_C[j]), qy = eggQy(m, EGG_C[j], EGG_S[j]);
    const cr = qx * dy - qy * dx, dot = qx * dx + qy * dy;
    if (prevCr * cr <= 0 && (prevDot + dot) > 0) { bi = i - 1; break; }
    prevCr = cr; prevDot = dot;
  }
  if (bi < 0) bi = 0; // degenerate direction; harmless fallback
  let lo = bi * EGG_DT, hi = (bi + 1) * EGG_DT;
  let crLo = eggCr(m, dx, dy, lo);
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    const crM = eggCr(m, dx, dy, mid);
    if (crLo * crM <= 0) { hi = mid; } else { lo = mid; crLo = crM; }
  }
  return (lo + hi) / 2;
}
function eggCr(m, dx, dy, t) {
  const c = dcos(t), s = dsin(t);
  return eggQx(m, c) * dy - eggQy(m, c, s) * dx;
}

// ------------------------------------------------------------
// Tapered body vs segment: the honest convex construction —
// face phase (support point against the segment's line) with a span
// test, else vertex phase (closest boundary point to the endpoint).
// Same output contract as ellipseVsSegment; resolveContact needs no
// changes and stays shape-blind.
// ------------------------------------------------------------
function eggVsSegment(m, A, B, out) {
  out.hit = false;
  const cos = dcos(m.angle);
  const sin = dsin(m.angle);

  // World -> COM-local (translate + rotate by -angle; NO scaling).
  const ax = (A.x - m.x) * cos + (A.y - m.y) * sin;
  const ay = -(A.x - m.x) * sin + (A.y - m.y) * cos;
  const bx = (B.x - m.x) * cos + (B.y - m.y) * sin;
  const by = -(B.x - m.x) * sin + (B.y - m.y) * cos;

  // Cheap reject: closest segment point vs a generous bounding radius.
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let tSeg = len2 > 0 ? -(ax * abx + ay * aby) / len2 : 0;
  tSeg = tSeg < 0 ? 0 : (tSeg > 1 ? 1 : tSeg);
  const cpx = ax + abx * tSeg, cpy = ay + aby * tSeg;
  const boundR = m.a * (1 + m.taper);
  if (cpx * cpx + cpy * cpy >= boundR * boundR) return;

  let nlx, nly, penL, qx, qy, tStar, pxL, pyL;

  if (len2 > 1e-12) {
    // ---- Face phase: support against the segment's line ----
    const invLen = 1 / Math.sqrt(len2);
    const ux = abx * invLen, uy = aby * invLen;
    // Line normal pointing toward the body (the COM is the origin).
    let nx0 = uy, ny0 = -ux;
    if (nx0 * ax + ny0 * ay > 0) { nx0 = -nx0; ny0 = -ny0; }
    const tS = eggSupportT(m, -nx0, -ny0); // deepest point against the face
    const cS = dcos(tS), sS = dsin(tS);
    const sqx = eggQx(m, cS), sqy = eggQy(m, cS, sS);
    const proj = (sqx - ax) * ux + (sqy - ay) * uy;
    if (proj >= 0 && proj <= 1 / invLen) {
      penL = nx0 * (ax - sqx) + ny0 * (ay - sqy);
      if (penL <= 0) return;
      nlx = nx0; nly = ny0;
      qx = sqx; qy = sqy; tStar = tS;
      pxL = ax + ux * proj; pyL = ay + uy * proj; // on the segment
    } else {
      // ---- Vertex phase: the nearer endpoint ----
      const vx = proj < 0 ? ax : bx, vy = proj < 0 ? ay : by;
      if (!eggVertexContact(m, vx, vy)) return;
      // eggVertexContact leaves its results in the module scratch:
      nlx = EGGV.nx; nly = EGGV.ny; penL = EGGV.pen;
      qx = EGGV.qx; qy = EGGV.qy; tStar = EGGV.t;
      pxL = vx; pyL = vy;
    }
  } else {
    // Degenerate segment: pure vertex.
    if (!eggVertexContact(m, ax, ay)) return;
    nlx = EGGV.nx; nly = EGGV.ny; penL = EGGV.pen;
    qx = EGGV.qx; qy = EGGV.qy; tStar = EGGV.t;
    pxL = ax; pyL = ay;
  }

  // Local -> world.
  out.nx = nlx * cos - nly * sin;
  out.ny = nlx * sin + nly * cos;
  out.px = m.x + pxL * cos - pyL * sin;
  out.py = m.y + pxL * sin + pyL * cos;
  out.pen = penL;
  {
    const c = dcos(tStar), s = dsin(tStar);
    out.curvR = eggCurvR(m, c, s);
  }
  out.hit = true;
}

// Vertex-vs-boundary scratch + solver: is the local point (vx,vy)
// inside the body? If so, contact at the closest boundary point with
// the INWARD surface normal there (the ellipse path's semantics).
const EGGV = { nx: 0, ny: 0, pen: 0, qx: 0, qy: 0, t: 0 };
function eggVertexContact(m, vx, vy) {
  // Inside test via the implicit form (COM frame; sh restores the
  // geometric parameterization).
  const Xg = (vx - m.sh) / m.a;
  if (Xg <= -1 || Xg >= 1) return false;
  const g = 1 - m.taper * Xg;
  const yr = vy / (m.b * g);
  if (Xg * Xg + yr * yr >= 1) return false;
  const t = eggClosestT(m, vx, vy);
  const c = dcos(t), s = dsin(t);
  const qx = eggQx(m, c), qy = eggQy(m, c, s);
  // Inward normal from the tangent q' = (−a·s, b·(c + τ − 2τc²)):
  // outward is (q'y, −q'x); inward is the negation, normalized.
  const dqx = -m.a * s;
  const dqy = m.b * (c + m.taper - 2 * m.taper * c * c);
  let nx = -dqy, ny = dqx;
  const nn = Math.sqrt(nx * nx + ny * ny);
  nx /= nn; ny /= nn;
  const pen = (vx - qx) * nx + (vy - qy) * ny;
  if (pen <= 0) return false;
  EGGV.nx = nx; EGGV.ny = ny; EGGV.pen = pen;
  EGGV.qx = qx; EGGV.qy = qy; EGGV.t = t;
  return true;
}

// ------------------------------------------------------------
// Ellipse vs segment. Writes result into `out` scratch object.
// ------------------------------------------------------------
function ellipseVsSegment(m, A, B, out) {
  out.hit = false;

  const a = m.a;
  const b = m.b;
  const s = a / b; // local y-scale that turns the ellipse into a circle radius a

  const cos = dcos(m.angle);
  const sin = dsin(m.angle);

  // World -> local (translate, rotate by -angle), then scale y by s.
  let ax = (A.x - m.x) * cos + (A.y - m.y) * sin;
  let ay = (-(A.x - m.x) * sin + (A.y - m.y) * cos) * s;
  let bx = (B.x - m.x) * cos + (B.y - m.y) * sin;
  let by = (-(B.x - m.x) * sin + (B.y - m.y) * cos) * s;

  // Closest point on segment AB to origin (the circle's center).
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? -(ax * abx + ay * aby) / len2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t); // clamped => vertices handled too
  const cx = ax + abx * t;
  const cy = ay + aby * t;

  const dist = Math.sqrt(cx * cx + cy * cy);
  if (dist >= a || dist < 1e-9) return;

  // Normal in circle space: from contact toward center.
  const ncx = -cx / dist;
  const ncy = -cy / dist;

  // Normal back to world: inverse-transpose of diag(1, s) = diag(1, 1/s),
  // then re-normalize, then rotate by +angle.
  let nlx = ncx;
  let nly = ncy / s;
  const nlen = Math.sqrt(nlx * nlx + nly * nly);
  nlx /= nlen; nly /= nlen;
  out.nx = nlx * cos - nly * sin;
  out.ny = nlx * sin + nly * cos;

  // Contact point (on the segment) back to world: unscale y, rotate, translate.
  const lx = cx, ly = cy / s;
  out.px = m.x + lx * cos - ly * sin;
  out.py = m.y + lx * sin + ly * cos;

  // Penetration: distance from the ellipse surface point (toward the
  // segment) to the segment contact point, measured along the normal.
  // Computed in world space because the y-scale distorts distances.
  const spx = (cx / dist) * a;        // surface point, circle space
  const spy = ((cy / dist) * a) / s;  // unscaled to ellipse local

  // Curvature radius at that surface point: with (spx, spy) =
  // (a cos t, b sin t), R = (a^2 sin^2 + b^2 cos^2)^{3/2} / (ab).
  // Big on the flat side (a^2/b), small at the tips (b^2/a) —
  // this is the smash rule's stress-concentration input.
  {
    const u = spx / a;       // cos t
    const v = spy / b;       // sin t
    const q = a * a * v * v + b * b * u * u;
    out.curvR = (q * Math.sqrt(q)) / (a * b);
  }
  const ex = m.x + spx * cos - spy * sin;
  const ey = m.y + spx * sin + spy * cos;
  out.pen = (out.px - ex) * out.nx + (out.py - ey) * out.ny;
  if (out.pen <= 0) return;

  out.hit = true;
}

// ------------------------------------------------------------
// Sequential impulse resolution at one contact.
// Returns { jn, vn } for telemetry (normal impulse magnitude and
// pre-solve normal velocity).
// ------------------------------------------------------------
function resolveContact(m, c, invM, invI) {
  // Lever arm from center of mass to contact point.
  const rx = c.px - m.x;
  const ry = c.py - m.y;

  // Velocity of the contact point on the body: v + ω × r.
  const cvx = m.vx - m.omega * ry;
  const cvy = m.vy + m.omega * rx;

  // --- Normal impulse ---
  const vn = cvx * c.nx + cvy * c.ny; // negative = approaching
  // r x n: the contact's lever about the COM. It appears twice in the
  // physics — the spin's contribution to vn is exactly omega*(r x n),
  // and the same quantity squared sits in kn — and once in the
  // certificate, as the spin term the death screen can finally name.
  const rCrossN = rx * c.ny - ry * c.nx;
  let jn = 0, knOut = 0, eOut = 0;
  if (vn < 0) {
    const e = -vn > CONFIG.restitutionThreshold ? damage.bodyRestitution(m) : 0;
    const kn = invM + rCrossN * rCrossN * invI;
    jn = (-(1 + e) * vn) / kn;
    knOut = kn; eOut = e;
    m.vx += jn * c.nx * invM;
    m.vy += jn * c.ny * invM;
    m.omega += rCrossN * jn * invI;
  }

  // --- Friction impulse (Coulomb, clamped to μ·jn) ---
  if (jn > 0) {
    // Recompute contact velocity after normal impulse.
    const cvx2 = m.vx - m.omega * ry;
    const cvy2 = m.vy + m.omega * rx;
    // Tangent = normal rotated 90°.
    const tx = -c.ny, ty = c.nx;
    const vt = cvx2 * tx + cvy2 * ty;
    const rCrossT = rx * ty - ry * tx;
    const kt = invM + rCrossT * rCrossT * invI;
    let jt = -vt / kt;
    const maxJt = CONFIG.friction * jn;
    if (jt > maxJt) jt = maxJt;
    if (jt < -maxJt) jt = -maxJt;
    m.vx += jt * tx * invM;
    m.vy += jt * ty * invM;
    m.omega += rCrossT * jt * invI;
  }

  // --- Rolling resistance (contact losses) ---
  // Torque impulse opposing spin, proportional to normal impulse and
  // lever length: τ = μ_roll · jn · |r|. Clamped so it can only slow
  // spin toward zero, never reverse it. This is what makes a coasting
  // melon actually come to rest instead of rocking forever.
  if (jn > 0 && m.omega !== 0) {
    const rLen = Math.sqrt(rx * rx + ry * ry);
    const dOmega = CONFIG.rollingResistance * jn * rLen * invI;
    if (m.omega > 0) m.omega = Math.max(0, m.omega - dOmega);
    else m.omega = Math.min(0, m.omega + dOmega);
  }

  // --- Positional correction (prevents sinking, kills jitter) ---
  const corr = Math.max(c.pen - CONFIG.penetrationSlop, 0) * CONFIG.positionCorrection;
  if (corr > 0) {
    m.x += c.nx * corr;
    m.y += c.ny * corr;
  }

  return { jn, vn, kn: knOut, e: eOut, rxn: rCrossN };
}

// stepBodyClone: the per-body step exported for PREDICTION — the
// practice ring steps a CLONE of the player through this exact
// function (sink null: no FX side effects), so its forecast is the
// sim's own arithmetic. Imitation predictors kept diverging: at race
// spin rates the contact-point term (w x r) turns any approximation
// of the contact geometry into large vn error, squared by the energy
// law (field-logged 2026-08-11, EP1 exact at w=0, chaos at w=15-37).
Object.assign(window.FF, { step, stepBodyClone: (m, inp, terrain, dt) => stepBody(m, inp, terrain, dt, null),
  _hopImpulse: hopImpulse });
})();