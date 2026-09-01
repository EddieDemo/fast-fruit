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
// THE MANIFOLD (phase 2, 2026-08-28): two pre-allocated slots, not
// one. The smooth families fill slot 0 and report a count of 1, so
// their path is unchanged; a polygon face resting on a segment fills
// both. Pre-allocated rather than returned as a fresh array, because
// this runs per body per face per solver iteration.
function makeContact() {
  return {
    hit: false,
    px: 0, py: 0,   // contact point (on segment), world
    nx: 0, ny: 0,   // contact normal, world, pointing INTO the melon
    pen: 0,         // penetration depth along normal (px)
    // POSITIONAL CORRECTION SHARE (P2-B, ruled 2026-08-28).
    // resolveContact ejects by pen x positionCorrection PER CALL, so a
    // flat face returning two points would eject a box twice as far as
    // a curve returning one — over-ejection, and the most likely
    // source of the humming box. The manifold divides one correction
    // between its points. Always 1 for the smooth families, so their
    // arithmetic is untouched.
    corrShare: 1,
  };
}
// curvR REMOVED 2026-08-28: written by both collide routines, read
// by nobody since the certificate dropped it (see makeCertificate).
// A polygon has zero curvature along a face and a singularity at a
// corner, so a third writer could only have lied. Deleted rather
// than given a placeholder — dead code is not a safety net.
const MANIFOLD = [makeContact(), makeContact()];

// Slab-query scratch (stage 1): candidate face indices, and the two
// endpoint shells the narrowphase reads — reused every test, same
// no-churn discipline as `contact`.
const CAND = [];
const SEG_A = { x: 0, y: 0 };
const SEG_B = { x: 0, y: 0 };

// The terrain-contact ACCUMULATOR (PHASE-6 §5.4). These five lived as
// locals across stepBody's iteration loop; the unified pass drives
// terrain sweeps from OUTSIDE the body's own step, so they now ride
// an explicit accumulator with their semantics preserved exactly —
// sumE ADDS, strongestE takes a MAX and owns the impact direction and
// the m.hit* breadcrumbs, grounded is a sticky OR. One module-level
// scratch, reset by stepBody per body per tick: stepBody never nests
// (stepBodyClone IS stepBody), so reuse is the file's own no-churn
// discipline, not a risk.
const TACC = {
  grounded: false,
  strongestE: 0,
  sumE: 0,
  impactNormalAngle: 0,
  impactVn: 0,
};

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

// ---- THE FURNITURE WAKE LAW (wake law B, ruled 2026-08-27k) -------
// A dormant prop wakes when the leader's ARC PROGRESS closes to
// within wakeAhead of the current candidate — a pure function of
// body state, identical on every peer and every run. NEVER
// coverage-gated: provider.update runs per FRAME, so which polys
// exist at a given tick is frame-timing dependent (a lockstep
// catch-up burst runs many ticks against one stale window) — a wake
// that reads coverage is a desync by construction. wakeAhead 1200
// (+ ~360 px max burst drift) sits far inside GEN_AHEAD 3600, and
// arc distance bounds x distance, so streamed coverage at the
// candidate is guaranteed by the time the law fires; the null-
// surface branch below is the streaming contract BROKEN, not a
// path — dev-loud, retried, and suite-held never to fire on a real
// provider.
//
// Placement is STRAND-AWARE by construction: spine.surfaceAt(s) is
// the riding surface at arc s — single-valued per strand, walls
// skipped, the respawn fallback's own convention. (The dead v312
// draft's propFloorAt picked the highest x-spanning segment of ANY
// strand: against a branch deck it parked the ball inside the slab,
// and the solver depenetrates toward the NEAREST face — out the
// bottom, 600 px below the surface it "placed against".)
const WAKE_CAND = new Int32Array(256);
function tryWakeProp(state, p) {
  const spine = state.spine;
  // AN UPPER TIER OF A STACK (2026-08-30): no walk of its own — it
  // wakes the tick its base wakes, placed straight up the column from
  // the base's wake pose. Same-tick is guaranteed by mint order (the
  // base precedes its tiers in state.props, and this sweep clears the
  // base's dormant flag before any tier asks), so the base has been
  // PLACED and not yet STEPPED: the authored gap is exact, and the
  // base's clearance probe already cleared this tier's spot (it
  // probes the whole column — see below).
  if (p.stackBase) {
    const base = p.stackBase;
    if (base.dormant || !base.alive) return;   // a dead-at-wake base strands its tiers dormant, honestly
    const FC = CONFIG.furniture;
    const pitch = supportRadius(p, 0, 1) * 2 + FC.stackGap;
    p.x = base.x;
    p.y = base.y - p.stackTier * pitch;
    p.vx = 0; p.vy = 0; p.omega = 0;
    if (!p.prev) p.prev = { x: p.x, y: p.y, angle: p.angle };
    p.prev.x = p.x; p.prev.y = p.y; p.prev.angle = p.angle;
    p.dormant = false;
    p.wakeTick = state.tick; // telemetry breadcrumb (suite-read)
    if (CONFIG.devPinFurniture) { p.pinX = p.x; p.pinY = p.y; }
    return;
  }
  const w = p.wake;
  if (!spine || !spine.surfaceAt || !w || w.idx >= w.cands.length) return;
  const FCFG = CONFIG.furniture;
  // The leader, in arc: max progress over every seat. Dead bodies
  // keep their position and cannot lead, but including them costs
  // nothing and keeps the scan branch-free.
  let maxS = -Infinity;
  for (const pl of state.players) {
    const s = spine.progressOf(pl.melon);
    if (s > maxS) maxS = s;
  }
  for (const b of state.bots) {
    const s = spine.progressOf(b.melon);
    if (s > maxS) maxS = s;
  }
  const sCand = w.cands[w.idx];
  if (maxS < sCand - FCFG.wakeAhead) return; // not yet — the law waits
  const sp = spine.surfaceAt(sCand);
  if (!sp) {
    // The streaming contract is broken (harness with a hand window,
    // or a real bug): retry next tick, loudly, once.
    if (!w.starved) { w.starved = true;
      console.warn('tryWakeProp: no streamed surface at arc', sCand); }
    return;
  }
  // ONE SYMBOL, TWO JOBS — SPLIT 2026-08-28 (RECTANGULAR-PROPS.md §7).
  // This used to be a single `r = p.a * (1 + taper)` doing both of the
  // below. They coincide for a sphere and diverge for a box, and the
  // phase 0 note had the direction backwards: with a/b as honest
  // half-extents the old expression gave 50 px against a box's 70.71
  // px circumradius — UNDER-inflated, which is the dangerous way. It
  // would have accepted spots a rotated box does not fit.
  //   clearR — how much room the body needs. The circumradius: the
  //            probe inflates a CIRCLE, so it must be the enclosing
  //            one. Conservative; it can only refuse.
  //   restH  — how high the body's centre sits above the surface it
  //            rests on. The support along world-down at the wake
  //            pose, which for a box is the half-extent and for a
  //            sphere is the radius (so the ball is bit-unmoved).
  const clearR = p.boundR;
  const restH = supportRadius(p, 0, 1);
  const cx = sp.x;
  const cy = sp.y - restH - FCFG.wakeGap;
  // THE CLEARANCE PROBE: the whole inflated circle against every
  // nearby face (canonical query order; point-vs-segment distance).
  // One check catches the whole class — overhead decks, wall faces,
  // slab interiors: a face inside the circle means this spot puts
  // the ball where the solver would have to eject it.
  const world = slab.worldFor(state.terrain);
  const R = clearR + FCFG.probeMargin;
  // THE COLUMN PROBE (2026-08-30): a stack's base probes one circle
  // PER TIER, straight up the column — a stack under an overhead deck
  // must refuse the site just as a lone ball beside a wall does. For
  // a lone prop stackTiers is absent and this is exactly the one
  // circle it always probed.
  const probeTiers = p.stackTiers || 1;
  const pitch = probeTiers > 1 ? supportRadius(p, 0, 1) * 2 + FCFG.stackGap : 0;
  let foul = false;
  for (let tier = 0; tier < probeTiers && !foul; tier++) {
    const py = cy - tier * pitch;
    const n = world.query(cx - R, py - R, cx + R, py + R, WAKE_CAND);
    for (let i = 0; i < n && !foul; i++) {
      const fi = WAKE_CAND[i];
      const ax = world.fax[fi], ay = world.fay[fi];
      const bx = world.fbx[fi], by = world.fby[fi];
      const abx = bx - ax, aby = by - ay;
      const len2 = abx * abx + aby * aby;
      let t = len2 > 0 ? ((cx - ax) * abx + (py - ay) * aby) / len2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const dx = cx - (ax + abx * t), dy = py - (ay + aby * t);
      if (dx * dx + dy * dy < R * R) foul = true;
    }
  }
  if (foul && w.idx < w.cands.length - 1) {
    // Burn the candidate; the next one's arc is larger, so it waits
    // on its own wake condition. Dice were thrown at mint — this is
    // a walk, never a re-roll.
    w.idx++;
    return;
  }
  // Place: clean spot, or the FINAL candidate fouled — the stated
  // fallback, generous height over the surface, never a loop.
  p.x = cx;
  p.y = foul ? sp.y - restH - FCFG.fallbackLift : cy;
  p.vx = 0; p.vy = 0; p.omega = 0;
  if (!p.prev) p.prev = { x: p.x, y: p.y, angle: p.angle };
  p.prev.x = p.x; p.prev.y = p.y; p.prev.angle = p.angle;
  p.dormant = false;
  p.wakeTick = state.tick; // telemetry breadcrumb (suite-read)
  // DEV SCAFFOLD (27l): pin at the wake pose so the ball can be
  // found and eyeballed on device. The pin machinery is the grid's
  // own (held after integration AND after contacts, so a shove
  // cannot walk it off either).
  if (CONFIG.devPinFurniture) { p.pinX = p.x; p.pinY = p.y; }
}

// ---- PERIOD RE-HOMING (option A, ruled 2026-08-27k) ---------------
// The prop rides the world's period symmetry. Racer x grows
// unwrapped; the provider tiles racer periods only; the pair pass
// meets the prop through its nearest period image (resolveMelonPair
// wraps by round(dx/L)). So the prop's PHASE is its identity, and
// its unwrapped x may follow the field: when the backmarker clears
// the prop's period end by rehomeMargin, translate by (+L, +D).
// Exact world symmetry — geometry, pair math, and the prop's local
// displacement are all invariant; prev translates with it so the
// interpolated pose carries no streak. Decision reads sim state
// only (deterministic); both periods are streamed at fire time by
// the margin arithmetic (config.js).
function rehomeProp(state, p) {
  const per = state.period;
  if (!per || !per.L) return false;
  let minX = Infinity;
  for (const pl of state.players) if (pl.melon.x < minX) minX = pl.melon.x;
  for (const b of state.bots) if (b.melon.x < minX) minX = b.melon.x;
  if (minX === Infinity) return false;
  const margin = CONFIG.furniture.rehomeMargin;
  // A while, but self-limiting: each pass moves the prop one whole
  // period toward the field; at most one fires per lap in play.
  let moved = false;
  while (minX > (Math.floor(p.x / per.L) + 1) * per.L + margin) {
    p.x += per.L; p.y += per.D;
    if (p.prev) { p.prev.x += per.L; p.prev.y += per.D; }
    // the dev pin is a POSE, so it travels with the symmetry too —
    // a pinned ball is met in the same spot on every lap
    if (p.pinX !== null && p.pinX !== undefined) { p.pinX += per.L; p.pinY += per.D; }
    p.rehomes = (p.rehomes || 0) + 1; // telemetry breadcrumb (suite-read)
    moved = true;
  }
  return moved;
}

// ---- PROP ISLANDS (PHASE-6 §5.2/§5.3, 2026-08-29) ----------------
// THE ISLAND RULE, law (amended 2026-08-30, D6-1 ruling): an island
// qualifies for the unified pass if every member is a prop and it has
// two or more members. Racer arithmetic is untouched by CONSTRUCTION,
// not by care — no racer body ever reaches the unified code path
// (ratchet A23): racers couple to island members through the legacy
// global pair loop, outside the island, so gate-hash.js stays
// byte-identical. Islands of ONE stay on the legacy path: a lone prop
// already works (exp-restpose: 0.27 px / 60 s) and fewer things move.
//
// D6-1 (racer-adjacent reversion) CLOSED 2026-08-30, ruled by Eddie:
// see the qualification note in buildPropIslands. Islands stay
// unified while racers touch them; the racer couples through the
// legacy pair loop, outside the island.

const PROP_STEP = [];   // steppable props this tick (list order = canonical)
const ISL_PARENT = [];  // union-find scratch
// True only while unifiedIslandPass drives sweeps — the terrain-side
// angular correction's gate (see resolveContact and the note in
// unifiedIslandPass). Module-scoped control flow, deterministic.
let UNIFIED_ACTIVE = false;

// Nearest-image proximity, the pair solver's own wrap convention
// (resolveMelonPair): in track mode B's image nearest to A is the one
// judged. Range is each body's broad-phase circle — boundR plus the
// same 32 px slack the terrain query inflates by — so any CONTACTING
// pair is linked by construction, with slack to spare.
function bodiesInRange(A, B, period) {
  let ox = 0, oy = 0;
  if (period) {
    const k = Math.round((B.x - A.x) / period.L);
    if (k !== 0) { ox = -k * period.L; oy = -k * period.D; }
  }
  const dx = B.x + ox - A.x, dy = B.y + oy - A.y;
  const R = A.boundR + B.boundR + 64;
  return dx * dx + dy * dy < R * R;
}

// buildPropIslands(state, steppable) — union-find over the steppable
// props, O(n^2) links: props are few, and a spatial structure is not
// worth its determinism surface without a measurement saying so.
// Returns ONLY the qualifying islands (>= 2 members, no live racer in
// range of any member), each an array of prop refs. Islands come back
// ordered by their lowest member index and members by index — the
// steppable list is state.props order, which IS canonical order
// (props index after every seat), so this is the sortBodiesCanonical
// law, not an iteration accident. Marks p.islandId on every member of
// a qualifying island; every other steppable prop keeps the -1 the
// caller reset.
function buildPropIslands(state, steppable) {
  const n = steppable.length;
  const out = [];
  if (n < 2) return out;
  const period = state.period;
  for (let i = 0; i < n; i++) ISL_PARENT[i] = i;
  const find = (i) => {
    while (ISL_PARENT[i] !== i) { ISL_PARENT[i] = ISL_PARENT[ISL_PARENT[i]]; i = ISL_PARENT[i]; }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bodiesInRange(steppable[i], steppable[j], period)) {
        const ri = find(i), rj = find(j);
        // the smaller index is always the root, so a component's root
        // is its lowest member — canonical by construction
        if (ri < rj) ISL_PARENT[rj] = ri;
        else if (rj < ri) ISL_PARENT[ri] = rj;
      }
    }
  }
  // Group by root, walking ascending: islands emerge ordered by
  // lowest member, members ascending within each.
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (r === i) { steppable[i]._islRoot = out.length; out.push([steppable[i]]); }
    else out[steppable[r]._islRoot].push(steppable[i]);
  }
  // Qualification: size >= 2. D6-1 CLOSED (RULED 2026-08-30): a
  // racer in range no longer disqualifies. The island stays unified
  // for its PROPS; the racer talks to those props through the legacy
  // global pair loop exactly as before — an external impulse source
  // with one tick of latency, the same coupling any legacy neighbour
  // has. No racer body reaches the unified code path (ratchet A23
  // holds by construction, not by disqualification), so the smooth
  // gate cannot move. What the old rule actually bought was the
  // DEFECT: the moment a melon touched a stack, the stack reverted
  // to the momentum-injecting sequential solver — unstable exactly
  // when bombarded, and at the 2026-08-30 light box mass the
  // injection runs faster than ever. What it feared — split load —
  // never applied: the island is not split, the racer is outside it.
  const keep = [];
  for (const isl of out) {
    if (isl.length < 2) continue;
    for (const m of isl) m.islandId = keep.length;
    keep.push(isl);
  }
  return keep;
}

// ---- THE UNIFIED PASS (PHASE-6 §5.1) -----------------------------
// One iterated loop over the island's whole contact set: each member
// takes ONE terrain sweep, then each pair takes ONE pair sweep,
// unifiedIters times — instead of every terrain sweep for a body
// completing before any pair contact is applied. This is the stack
// blocker (§11.4 finding 3, evidenced by exp-shelf): the old
// sequencing let the bottom box settle against the ground before the
// weight above it arrived, so load propagated down a stack at one
// contact per tick.
//
// Each member gets its own accumulator for the whole pass (the
// module scratch TACC is per-body-per-call and cannot survive the
// interleave), with the same semantics: sumE adds, strongestE takes
// the max and owns the m.hit* breadcrumbs, grounded is a sticky OR.
const UACC = [];
function makeUacc() {
  return { grounded: false, strongestE: 0, sumE: 0,
    impactNormalAngle: 0, impactVn: 0, wasGrounded: false };
}

function unifiedIslandPass(state, isl, dt) {
  const world = slab.worldFor(state.terrain);
  const period = state.period;
  const n = isl.length;
  while (UACC.length < n) UACC.push(makeUacc());
  for (let i = 0; i < n; i++) {
    const m = isl[i];
    integrateBody(m, m.input, dt);
    const acc = UACC[i];
    acc.wasGrounded = m.grounded;   // last tick's truth, stepBody's own capture point
    acc.grounded = false;
    acc.strongestE = 0;
    acc.sumE = 0;
    acc.impactNormalAngle = 0;
    acc.impactVn = 0;
    m.hitSeverity = 0;
  }
  // The terrain-side ANGULAR correction is a property of THIS pass
  // (see resolveContact): measured exact here (exp-shelf 0.00 px) and
  // a measured creep on the legacy path (exp-restpose: 5.30 px
  // mid-segment, 53.5 px on a seam — the same numbers that got it
  // reverted pre-unified). The flag is pure control flow, cleared on
  // the way out; no legacy sweep ever sees it set.
  UNIFIED_ACTIVE = true;
  for (let it = 0; it < CONFIG.unifiedIters; it++) {
    for (let i = 0; i < n; i++) sweepTerrainContacts(isl[i], isl[i].input, world, UACC[i]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (resolveMelonPair(isl[i], isl[j], period)) {
          // THE CONTACT BREADCRUMB, the legacy pair loop's own law:
          // both parties remember each other and the tick.
          isl[i].lastContactIdx = isl[j].canonIdx;
          isl[j].lastContactIdx = isl[i].canonIdx;
          isl[i].lastContactTick = state.tick;
          isl[j].lastContactTick = state.tick;
        }
      }
    }
  }
  UNIFIED_ACTIVE = false;
  for (let i = 0; i < n; i++) finishBody(isl[i], null, state, UACC[i], UACC[i].wasGrounded);
}

function step(state, dt) {
  snapshotPrev(state);
  state.tick++;
  const tick = state.tick;
  HOP_TICK = tick;

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
  // Furniture steps ONCE per tick with its own inert input: gravity,
  // terrain, damping — no brain, no drive, no revive (reviveIfDue
  // walks players and bots only, so a prop off the world is simply
  // gone, as ruled). (The first cut sat INSIDE the per-bot alive
  // block — stepped once PER BOT, and never with an empty field. A
  // brace is a scope, and node --check cannot see intent.)
  // A DORMANT prop is a record: the wake law below is the only thing
  // that touches it, and only a placed prop enters the sim.
  //
  // ---- CANONICAL INDEX, refreshed every step on EVERY body (dead
  // ones included — a dead killer must still be findable): the pair
  // pass's breadcrumb currency. Recomputed rather than trusted, so
  // joins and substitutions can never leave a stale identity.
  // HOISTED above the prop pass (PHASE-6, 2026-08-29): the island
  // pass stamps contact breadcrumbs with partner canonIdx, so the
  // identities must be fresh BEFORE props move. Idempotent arithmetic
  // read by nothing between here and its old seat — both gates held
  // the hoist byte-identical.
  { let ci = 0;
    for (const pl of state.players) pl.melon.canonIdx = ci++;
    for (const b of state.bots) b.melon.canonIdx = ci++;
    // Props index AFTER every seat: no racer's canonical identity
    // moves when furniture appears (suite-held).
    for (const p of state.props || []) p.canonIdx = ci++; }
  //
  // THE SPLIT PROP PASS (PHASE-6 §5.2/§5.3). Wake and rehome first —
  // per-prop independent decisions, byte-identical to the old
  // interleaved loop because stepBody is terrain-only and cannot
  // influence another prop's wake or rehome within the tick. Then the
  // island partition decides each steppable prop's route:
  //   islandId < 0  — LEGACY: stepBody here, in list order, exactly
  //                   the arithmetic that shipped;
  //   islandId >= 0 — UNIFIED: stepped later by unifiedIslandPass,
  //                   AFTER the pairSeverity reset below, so island
  //                   pair contacts survive to be read this tick.
  // A prop that REHOMED this tick does not step (the re-home tick is
  // the re-home — unchanged law) and takes no island: if its stack
  // rehomed with it, that stack runs legacy sequencing for this one
  // tick, the same shape as the racer-contact seam D6-1 records.
  PROP_STEP.length = 0;
  for (const p of state.props || []) {
    p.islandId = -1;   // reset unconditionally: a stale id on a
                       // rehomed or dying prop must not skip its
                       // legacy pair contacts below
    // else-if: the placement tick is the placement — a freshly woken
    // prop takes its first step NEXT tick, so the placed pose (gap
    // exactly wakeGap) is a real, observable state.
    if (p.alive && p.dormant) tryWakeProp(state, p);
    else if (p.alive) {
      // the re-home tick is the re-home (same law as placement):
      // the translated pose is a real, observable state.
      if (!rehomeProp(state, p)) PROP_STEP.push(p);
    }
  }
  const propIslands = buildPropIslands(state, PROP_STEP);
  for (const p of PROP_STEP) {
    if (p.islandId < 0) stepBody(p, p.input, state.terrain, dt, null, state);
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
  // (Canonical-index refresh HOISTED above the prop pass — see there.)
  for (const pl of state.players) if (pl.melon.alive) bodyList.push(pl.melon);
  for (const b of state.bots) if (b.melon.alive) bodyList.push(b.melon);
  for (const p of state.props || []) if (p.alive && !p.dormant) bodyList.push(p);
  sortBodiesCanonical(bodyList);
  for (const m of bodyList) { m.pairSeverity = 0; m.pairWorst = 0; }
  // ---- THE UNIFIED PASS (PHASE-6 §5.1), qualifying prop islands ----
  // Placed AFTER the pairSeverity reset above and BEFORE the legacy
  // pair loop below, so an island's pair contacts write into the same
  // per-tick ledger a legacy contact writes into, and nothing wipes
  // them. Membership is the island rule (§5.2): every member a prop,
  // no live racer in contact range — racers reach this line having
  // already taken their whole legacy step, untouched by construction.
  for (const isl of propIslands) unifiedIslandPass(state, isl, dt);
  if (bodyList.length > 1) {
    const PAIR_ITERS = 3;
    const period = state.period; // set in track mode, null in endless
    for (let iter = 0; iter < PAIR_ITERS; iter++) {
      for (let i = 0; i < bodyList.length; i++) {
        for (let j = i + 1; j < bodyList.length; j++) {
          // A pair the unified pass already solved is DONE: both in
          // the same qualifying island means their contact was
          // resolved interleaved with their terrain sweeps. Solving
          // it again here would eject a resting stack a second time
          // per tick — the M137 defect, arrived at by routing.
          // Cross-island, island-to-lone and racer-to-prop pairs all
          // still land here (link slack covers contact range, so a
          // CONTACTING prop pair is never split across islands).
          if (bodyList[i].islandId >= 0
            && bodyList[i].islandId === bodyList[j].islandId) continue;
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
    // KO BY: BEACH BALL (ruled 27j): if the last shove came from a
    // PROP within the assist window, the death is ENVIRONMENT WITH
    // FLAVOUR — never a racer's kill, but the furniture gets its
    // name in the story.
    m.deathByProp = null;
    if (state.props && state.props.length
      && m.lastContactTick && (tick - m.lastContactTick) <= 3 * CONFIG.physicsHz) {
      for (const pp of state.props) {
        if (pp.canonIdx === m.lastContactIdx) { m.deathByProp = pp.name || 'FURNITURE'; break; }
      }
    }
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
  if (m.shape === 'poly') {
    // EXACT for a polygon, where the smooth families are only close:
    // the support is the largest projection over the vertices, and a
    // vertex list is finite. Body frame, so the direction is rotated
    // in rather than the hull rotated out. Note this is a radius
    // along a DIRECTION, not the circumradius — returning the latter
    // would inflate every pair contact to the corner distance.
    const P = m.poly;
    let best = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const d = P[i][0] * bx + P[i][1] * by;
      if (d > best) best = d;
    }
    return best;
  }
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
// ---- THE PAIR ROUTE TABLE (P5-A, ruled 2026-08-28g) ---------------
// Contact GENERATION for a pair is dispatched on the SHAPE PAIR, and
// the table is DATA rather than an if-chain, for one reason: the
// cells that are still approximate must be VISIBLE. An if-chain
// records only what was implemented; a table records what was
// decided, and the empty cells are the standing defect list.
//
//            ellipse      egg          poly
//   ellipse  centres      centres      centres  (D5-1)
//   egg      centres      centres      centres  (D5-1)
//   poly     centres      centres      SAT
//
// 'centres' is the line-of-centres solve: each body's exact support
// radius along the centre line. It is right for two smooth convex
// bodies and WRONG against a flat face, because a flat face's normal
// does not point at its owner's centre.
//
// D5-1 — THE POLY-VS-SMOOTH CELL IS A MEASURED DEFECT, NOT AN
// APPROVED APPROXIMATION. A melon resting on the flat top of a 1 m
// box, offset 30 px from centre, is given a normal 19.2 degrees off
// the true face normal and 9.4 px of penetration THAT DOES NOT EXIST
// (measured, exp-pairnormal.js). At 40 px offset it is 24.9 degrees.
// It is the same defect as the box-vs-box detonation this build
// fixes, one order of magnitude smaller, and it is scheduled as the
// next build — poly-vs-ellipse is exactly tractable by the affine
// trick ellipseVsSegment already uses (scale the melon to a circle;
// an affine map takes the polygon to another convex polygon).
// It is NOT fixed in this build because it moves racer trajectories,
// so it needs its own re-baselined gate and its own balance
// measurement. Landing it here would destroy the one property that
// makes THIS build checkable: that the melon-vs-melon arithmetic is
// provably untouched.
// ---- D5-1: ELLIPSE VS POLY, EXACT BY THE AFFINE TRICK -------------
// (PHASE-6 doc §9, built 2026-08-30.) The line-of-centres route
// handed a melon resting 30 px off a box-top's centre a normal 19.2
// degrees off true and 9.4 px of penetration that does not exist
// (exp-pairnormal.js) — every racer that touched a box got this.
// The cure is ellipseVsSegment's own trick, one polygon wider: in
// the ellipse's frame, scale y by a/b so the ellipse is a circle;
// an affine map keeps the box a CONVEX hull, so the closest point
// to the circle's centre is an exact edge walk; map the contact
// back, recover the TRUE normal by the inverse-transpose, and
// measure penetration IN WORLD along that normal with the exact
// support functions — never with scaled-space distance, which the
// map does not preserve.
//
// THE EGG DOES NOT ADMIT THIS TRICK: a tapered body is not an
// ellipse. egg|poly is a NAMED cell in the route table below and
// stays on the line of centres until it earns its own routine.
//
// Normal convention: E toward P (the caller flips when the poly is
// party A, so PAIR_C always carries A-toward-B like every route).
function polySupportAlong(P, px0, py0, dx, dy) {
  const c = dcos(P.angle), s = dsin(P.angle);
  let best = -Infinity;
  for (let i = 0; i < P.poly.length; i++) {
    const v = P.poly[i];
    const wx = v[0] * c - v[1] * s;
    const wy = v[0] * s + v[1] * c;
    const d = wx * dx + wy * dy;
    if (d > best) best = d;
  }
  return best;
}

const EVP_V = [];   // scaled-hull scratch (grown on demand)

function ellipseVsPolyPair(E, ex, ey, P, px0, py0, out) {
  const a = E.a, b = E.b;
  const s = a / b;
  const cosE = dcos(E.angle), sinE = dsin(E.angle);
  const cosP = dcos(P.angle), sinP = dsin(P.angle);
  const n = P.poly.length;
  while (EVP_V.length < n) EVP_V.push({ x: 0, y: 0 });
  // The hull, in the ellipse's scaled frame (world -> E-local -> y*s).
  for (let i = 0; i < n; i++) {
    const v = P.poly[i];
    const wx = px0 + v[0] * cosP - v[1] * sinP;
    const wy = py0 + v[0] * sinP + v[1] * cosP;
    const rx = wx - ex, ry = wy - ey;
    EVP_V[i].x = rx * cosE + ry * sinE;
    EVP_V[i].y = (-rx * sinE + ry * cosE) * s;
  }
  // Closest point on the hull to the origin, and the inside test
  // (winding-agnostic: inside means every edge cross carries one
  // sign). Exact and cheap: closest point per edge, take the min.
  let bestD2 = Infinity, cx = 0, cy = 0;
  let sawPos = false, sawNeg = false;
  for (let i = 0; i < n; i++) {
    const va = EVP_V[i], vb = EVP_V[(i + 1) % n];
    const abx = vb.x - va.x, aby = vb.y - va.y;
    const cr = abx * (-va.y) - aby * (-va.x);
    if (cr > 0) sawPos = true; else if (cr < 0) sawNeg = true;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? -(va.x * abx + va.y * aby) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const qx = va.x + abx * t, qy = va.y + aby * t;
    const d2 = qx * qx + qy * qy;
    if (d2 < bestD2) { bestD2 = d2; cx = qx; cy = qy; }
  }
  const inside = !(sawPos && sawNeg);
  const dist = Math.sqrt(bestD2);
  if (!inside && dist >= a) return false;
  if (dist < 1e-9) return false;   // centre ON the boundary: no direction to trust
  // Circle-space normal, E toward P: toward the hull when outside,
  // out through the nearest face when the centre is swallowed.
  const sign = inside ? -1 : 1;
  const ncx = sign * cx / dist, ncy = sign * cy / dist;
  // Normal back to world by the JACOBIAN TRANSPOSE: multiply y by s,
  // re-normalize, rotate by +E.angle. PROVEN BY MEASUREMENT
  // (2026-08-30): at tilt -0.9, dx=45 — tangency ON the face — the
  // inverse-transpose spelling (divide by s) returns -12.51 deg off
  // the true vertical; multiply returns 0.00 exact. Level poses
  // cannot distinguish the two (both normalize to the face normal),
  // which is how the divide spelling survived every level gate.
  // NOTE, FLAGGED FOR RULING: ellipseVsSegment carries the SAME
  // divide-by-s — a candidate latent terrain-normal defect for
  // TILTED melons, gate-held, not to be changed silently. Named for
  // Eddie; do not copy this fix there without its own measurement
  // and a deliberate re-baseline.
  let nlx = ncx, nly = ncy * s;
  const nlen = Math.sqrt(nlx * nlx + nly * nly);
  nlx /= nlen; nly /= nlen;
  const nx = nlx * cosE - nly * sinE;
  const ny = nlx * sinE + nly * cosE;
  // Contact point: the hull's closest point, mapped back to world
  // (unscale y, rotate, translate) — a real point on the box's
  // surface, so the lever arms are honest.
  const lx = cx, ly = cy / s;
  out.px = ex + lx * cosE - ly * sinE;
  out.py = ey + lx * sinE + ly * cosE;
  if (!inside) {
    // Penetration by ellipseVsSegment's own method, exact at every
    // tilt: the ellipse surface point along the circle-space radial,
    // unscaled to world, measured along the true normal. NOT via
    // supportRadius — that function is the POLAR radius, which for a
    // tilted ellipse under-measures the support by up to ~1 px
    // (measured: 37.72 vs 38.53 analytic at 0.5 rad), and not via
    // scaled-space distance, which the map does not preserve.
    const spx = (cx / dist) * a;
    const spy = ((cy / dist) * a) / s;
    const ex2 = ex + spx * cosE - spy * sinE;
    const ey2 = ey + spx * sinE + spy * cosE;
    out.pen = (ex2 - out.px) * nx + (ey2 - out.py) * ny;
  } else {
    // The centre is swallowed (deep crash): the surface-point radial
    // points the wrong way; the support formula is the honest
    // measure here, and sub-pixel exactness is meaningless at this
    // depth. supportRadius's polar-vs-support gap is bounded ~1 px.
    const rE = supportRadius(E, nx, ny);
    const rP = polySupportAlong(P, px0, py0, -nx, -ny);
    out.pen = rE + rP - ((px0 - ex) * nx + (py0 - ey) * ny);
  }
  if (out.pen <= 0) return false;
  out.nx = nx; out.ny = ny;
  out.corrShare = 1;   // a smooth body's contact is its own manifold
  return true;
}

// ---- THE EGG PAIR CELLS (RULED 2026-08-30: an egg PROP is coming,
// so its contacts must be real before it lands) -------------------
// egg|poly: the tapered body does not admit the ellipse's affine
// trick, but it does not need one — eggVsSegment is the gate-held
// honest construction, and a convex polygon IS its edges. Run it per
// edge, keep the deepest contact. The frame rule: eggVsSegment reads
// the egg's STORED pose, so when the pair logic hands us an IMAGED
// egg we shift the EDGES into the egg's stored frame and shift the
// contact back — the body is never touched.
// egg|smooth (egg|ellipse, egg|egg): two smooth convex bodies. The
// penetration along a direction d is supA(d) + supB(-d) - sep·d; the
// TRUE contact axis is the direction minimizing it. Coarse 32-scan
// over the circle, then fixed golden refinement in the bracketing
// interval — fixed counts, pinned arithmetic, lockstep-safe like
// every egg search in this file. Uses TRUE support functions (the
// ellipse's closed form, the egg's search) — NOT supportRadius,
// which is the polar radius (the D5-1 finding).
// ellipse|ellipse stays on centres: that is the racers' gate-held,
// balance-tuned law, and nothing here may touch it.

const EGGP_SEG_A = { x: 0, y: 0 }, EGGP_SEG_B = { x: 0, y: 0 };
const EGGP_C = makeContact();

function resolveEggPoly(E, ex, ey, P, px0, py0, out) {
  // Shift everything into the egg's STORED frame.
  const sx = E.x - ex, sy = E.y - ey;
  const c = dcos(P.angle), s = dsin(P.angle);
  const n = P.poly.length;
  // FACE-FIRST MINIMUM-TRANSLATION LAW (corrected twice during the
  // suite build, before shipping — both corrections convicted by
  // measurement, both held by mutations):
  //   1. Among contacts of one phase, keep the SMALLEST penetration —
  //      the short way out. The first cut kept the deepest, which for
  //      a deep overlap ejects the egg the LONG way through the box
  //      (M168). SAT and the affine cell answer with the minimum.
  //   2. FACE contacts outrank endpoint-clamped VERTEX contacts. A
  //      naive minimum let a 0.38 px corner graze on the NEIGHBOURING
  //      edge outvote a true 1.0 px face rest 7 px from the corner —
  //      a 10.3 deg wrong normal at a legitimate pose, caught by the
  //      taper-0 cross-check against the affine cell. An endpoint
  //      clamp is an artifact of cutting the hull into edges: the
  //      corner belongs to two edges, and when either adjacent edge
  //      holds a face contact, the face IS the closest feature. A
  //      true corner touch has no face hit anywhere, and only then
  //      do vertex hits answer (M169).
  let bestFace = Infinity, bestVert = Infinity;
  for (let i = 0; i < n; i++) {
    const v0 = P.poly[i], v1 = P.poly[(i + 1) % n];
    EGGP_SEG_A.x = px0 + v0[0] * c - v0[1] * s + sx;
    EGGP_SEG_A.y = py0 + v0[0] * s + v0[1] * c + sy;
    EGGP_SEG_B.x = px0 + v1[0] * c - v1[1] * s + sx;
    EGGP_SEG_B.y = py0 + v1[0] * s + v1[1] * c + sy;
    eggVsSegment(E, EGGP_SEG_A, EGGP_SEG_B, EGGP_C);
    if (!EGGP_C.hit) continue;
    const takes = EGGP_C.vertexHit
      ? (bestFace === Infinity && EGGP_C.pen < bestVert)
      : (EGGP_C.pen < bestFace);
    if (EGGP_C.vertexHit) { if (EGGP_C.pen < bestVert) bestVert = EGGP_C.pen; }
    else if (EGGP_C.pen < bestFace) bestFace = EGGP_C.pen;
    if (takes) {
      // eggVsSegment's n pushes the egg AWAY (terrain law); the pair
      // convention is E toward P — flip. Contact back to the caller's
      // frame.
      out.nx = -EGGP_C.nx; out.ny = -EGGP_C.ny;
      out.px = EGGP_C.px - sx; out.py = EGGP_C.py - sy;
      out.pen = EGGP_C.pen;
    }
  }
  const best = bestFace < Infinity ? bestFace : bestVert;
  if (best === Infinity || best <= 0) return false;
  out.corrShare = 1;
  return true;
}

// True support of a smooth body along a WORLD direction: value and
// the world support point. Ellipse closed form; egg by the fixed
// search. (The polar-radius supportRadius is NOT this — D5-1.)
function smoothSupportWorld(m, dx, dy, out) {
  const c = dcos(m.angle), s = dsin(m.angle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  let qx, qy;
  if (m.shape === 'egg') {
    const t = eggSupportT(m, lx, ly);
    const ct = dcos(t), st = dsin(t);
    qx = eggQx(m, ct); qy = eggQy(m, ct, st);
  } else {
    const h = Math.sqrt(m.a * m.a * lx * lx + m.b * m.b * ly * ly);
    qx = (m.a * m.a * lx) / h; qy = (m.b * m.b * ly) / h;
  }
  out.px = m.x + qx * c - qy * s;
  out.py = m.y + qx * s + qy * c;
}

const EGGS_PA = { px: 0, py: 0 }, EGGS_PB = { px: 0, py: 0 };
const EGGS_GOLD = 0.381966011250105;   // the same golden ratio as eggSupportT

function eggSmoothPen(A, ax, ay, B, bx, by, dx, dy) {
  // Penetration along d (A toward B): supports both ways less the
  // centre separation projected on d. Positive = overlapping on this
  // axis.
  const c1 = dcos(A.angle), s1 = dsin(A.angle);
  let lx = dx * c1 + dy * s1, ly = -dx * s1 + dy * c1;
  let vA;
  if (A.shape === 'egg') {
    const t = eggSupportT(A, lx, ly);
    const ct = dcos(t), st = dsin(t);
    vA = lx * eggQx(A, ct) + ly * eggQy(A, ct, st);
  } else vA = Math.sqrt(A.a * A.a * lx * lx + A.b * A.b * ly * ly);
  const c2 = dcos(B.angle), s2 = dsin(B.angle);
  lx = -dx * c2 - dy * s2; ly = dx * s2 - dy * c2;
  let vB;
  if (B.shape === 'egg') {
    const t = eggSupportT(B, lx, ly);
    const ct = dcos(t), st = dsin(t);
    vB = lx * eggQx(B, ct) + ly * eggQy(B, ct, st);
  } else vB = Math.sqrt(B.a * B.a * lx * lx + B.b * B.b * ly * ly);
  return vA + vB - ((bx - ax) * dx + (by - ay) * dy);
}

function resolveEggSmooth(A, B, BxI, ByI, out) {
  // Coarse scan for the minimizing axis.
  let bestTh = 0, bestPen = Infinity;
  for (let i = 0; i < 32; i++) {
    const th = (i / 32) * 6.283185307179586;
    const p = eggSmoothPen(A, A.x, A.y, B, BxI, ByI, dcos(th), dsin(th));
    if (p < bestPen) { bestPen = p; bestTh = th; }
  }
  if (bestPen <= 0) return false;    // a separating axis exists
  // Fixed golden refinement in the bracketing interval.
  const dTh = 6.283185307179586 / 32;
  let lo = bestTh - dTh, hi = bestTh + dTh;
  let m1 = hi - (1 - EGGS_GOLD) * (hi - lo), m2 = lo + (1 - EGGS_GOLD) * (hi - lo);
  let f1 = eggSmoothPen(A, A.x, A.y, B, BxI, ByI, dcos(m1), dsin(m1));
  let f2 = eggSmoothPen(A, A.x, A.y, B, BxI, ByI, dcos(m2), dsin(m2));
  for (let k = 0; k < 24; k++) {
    if (f1 < f2) {
      hi = m2; m2 = m1; f2 = f1;
      m1 = hi - (1 - EGGS_GOLD) * (hi - lo);
      f1 = eggSmoothPen(A, A.x, A.y, B, BxI, ByI, dcos(m1), dsin(m1));
    } else {
      lo = m1; m1 = m2; f1 = f2;
      m2 = lo + (1 - EGGS_GOLD) * (hi - lo);
      f2 = eggSmoothPen(A, A.x, A.y, B, BxI, ByI, dcos(m2), dsin(m2));
    }
  }
  const th = (lo + hi) / 2;
  const dx = dcos(th), dy = dsin(th);
  const pen = eggSmoothPen(A, A.x, A.y, B, BxI, ByI, dx, dy);
  if (pen <= 0) return false;
  // Contact: midpoint of the two facing support points, n = A toward
  // B. smoothSupportWorld reads the stored pose; B may be imaged —
  // the frame rule again: evaluate at stored pose, shift the RESULT.
  smoothSupportWorld(A, dx, dy, EGGS_PA);
  smoothSupportWorld(B, -dx, -dy, EGGS_PB);
  EGGS_PB.px += BxI - B.x; EGGS_PB.py += ByI - B.y;
  out.px = (EGGS_PA.px + EGGS_PB.px) * 0.5;
  out.py = (EGGS_PA.py + EGGS_PB.py) * 0.5;
  out.nx = dx; out.ny = dy;
  out.pen = pen;
  out.corrShare = 1;
  return true;
}

const PAIR_ROUTE = {
  'poly|poly': 'sat',
  // D5-1 (2026-08-30): the ellipse|poly cell is EXACT by the affine
  // trick — see ellipseVsPolyPair.
  'ellipse|poly': 'affine',
  'poly|ellipse': 'affine',
  // THE EGG EARNED ITS ROUTINES (RULED 2026-08-30, superseding the
  // §9 named centres cell): a tapered body is not an ellipse, so
  // egg|poly runs the per-edge honest construction and egg|smooth
  // runs the support-axis search — see the egg pair cells above.
  'egg|poly': 'eggpoly',
  'poly|egg': 'eggpoly',
  'egg|ellipse': 'eggsmooth',
  'ellipse|egg': 'eggsmooth',
  'egg|egg': 'eggsmooth',
};
function pairRoute(A, B) {
  return PAIR_ROUTE[A.shape + '|' + B.shape] || 'centres';
}

// Pair-contact scratch. Separate from MANIFOLD on purpose: MANIFOLD
// belongs to stepBody's terrain loop, and stepBodyClone can run that
// loop from a prediction call. Two owners of one buffer is a bug
// waiting for the day the passes interleave.
const PAIR_MANIFOLD = [makeContact(), makeContact()];
const PAIR_C = makeContact();

function resolveMelonPair(A, B, period) {
  let ox = 0, oy = 0;
  if (period) {
    const k = Math.round((B.x - A.x) / period.L);
    if (k !== 0) { ox = -k * period.L; oy = -k * period.D; }
  }
  const BxI = B.x + ox, ByI = B.y + oy; // B's nearest image to A
  const route = pairRoute(A, B);
  if (route === 'affine') {
    // D5-1: the exact ellipse|poly cell. The ellipse party runs the
    // narrowphase at ITS in-frame pose; the normal comes back
    // E-toward-P and is flipped when the poly is party A, so PAIR_C
    // carries A-toward-B like every route, into the ONE solver (F1).
    let hit;
    if (A.shape === 'ellipse') {
      hit = ellipseVsPolyPair(A, A.x, A.y, B, BxI, ByI, PAIR_C);
    } else {
      hit = ellipseVsPolyPair(B, BxI, ByI, A, A.x, A.y, PAIR_C);
      if (hit) { PAIR_C.nx = -PAIR_C.nx; PAIR_C.ny = -PAIR_C.ny; }
    }
    if (!hit) return;
    applyPairContact(A, B, BxI, ByI, PAIR_C);
    return true;
  }
  if (route === 'eggpoly') {
    // The egg party runs per-edge at its in-frame pose; n comes back
    // egg-toward-poly and flips when the poly is party A.
    let hit;
    if (A.shape === 'egg') {
      hit = resolveEggPoly(A, A.x, A.y, B, BxI, ByI, PAIR_C);
    } else {
      hit = resolveEggPoly(B, BxI, ByI, A, A.x, A.y, PAIR_C);
      if (hit) { PAIR_C.nx = -PAIR_C.nx; PAIR_C.ny = -PAIR_C.ny; }
    }
    if (!hit) return;
    applyPairContact(A, B, BxI, ByI, PAIR_C);
    return true;
  }
  if (route === 'eggsmooth') {
    if (!resolveEggSmooth(A, B, BxI, ByI, PAIR_C)) return;
    applyPairContact(A, B, BxI, ByI, PAIR_C);
    return true;
  }
  if (route === 'sat') {
    const n = polyVsPoly(A, B, BxI, ByI, PAIR_MANIFOLD);
    if (n === 0) return;
    // TWO REAL CONTACTS ARE TWO REAL CONTACTS (P5-C, the pair half of
    // the terrain ruling P2-C): the whole per-contact block runs per
    // point — impulse, friction, dissipation, blame — because that is
    // how the energy actually arrives. Only the POSITIONAL correction
    // is shared, via corrShare, since one overlap must be undone once.
    // A TWO-point manifold solves as a BLOCK (2026-08-29): sequential
    // per-point resolution injects signed spin on a symmetric stack —
    // see applyPairBlock2 for the measurement.
    if (n === 2) applyPairBlock2(A, B, BxI, ByI, PAIR_MANIFOLD[0], PAIR_MANIFOLD[1]);
    else for (let k = 0; k < n; k++) applyPairContact(A, B, BxI, ByI, PAIR_MANIFOLD[k]);
    return true;
  }
  return resolvePairCentres(A, B, BxI, ByI);
}

// The line-of-centres solve, unchanged from the day it was written.
// Its arithmetic is held byte-for-byte by gate-hash.js.
function resolvePairCentres(A, B, BxI, ByI) {
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
  PAIR_C.nx = nx; PAIR_C.ny = ny; PAIR_C.pen = pen;
  PAIR_C.px = A.x + nx * (rA - pen * 0.5);
  PAIR_C.py = A.y + ny * (rA - pen * 0.5);
  PAIR_C.corrShare = 1;   // a centre-line contact is its own manifold
  applyPairContact(A, B, BxI, ByI, PAIR_C);
  // Real contact happened (the pen<=0 early-out returned undefined
  // above): report it so the pair pass can stamp the breadcrumb.
  return true;
}

// ---- THE PAIR CHARGE (extracted 2026-08-29, gate-proven pure) ----
// Dissipation, compliance shares, severity accumulation and traffic
// blame for ONE pair contact. Factored out of applyPairContact so the
// two-point block solve below charges through the SAME lines — a
// second copy of blame bookkeeping is how pairShare and pairWorst
// would drift apart by the second edit.
function chargePairContact(A, B, nx, ny, vn, k, jn, eA, eB) {
  const e = eA < eB ? eA : eB;
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

// ---- THE TWO-POINT BLOCK SOLVE (PHASE-6, 2026-08-29) --------------
// Both normal impulses of a two-point face manifold, solved
// SIMULTANEOUSLY from the same pre-state. Sequential per-point
// resolution injects a SIGNED torque every tick on a bit-symmetric
// stack — measured, not argued: exp-onetick-probe reads dOmega
// +6.297e-6 and dVx +7.054e-4 per tick on a configuration physics
// cannot pick a sign for, because the canonical order resolves the
// left point first and the right point then sees a velocity the left
// impulse already changed. That injection, amplified by the
// offset->torque->ramp feedback, is the residual stack killer
// (exp-lean-probe: exponential, ~1.3x/s).
//
// THIS IS NOT THE KILLED BLOCK-SOLVER HYPOTHESIS of §11.4 finding 1.
// That test convicted ITERATION COUNT (more sweeps converge, tilt
// residual stays) and is recorded so it is not walked again. This is
// SIMULTANEITY: fresh evidence (a per-tick signed injection on a
// symmetric configuration) that no amount of sequential iteration
// removes, because each iteration re-commits the same ordered bias.
//
// The solve is the standard 2x2 LCP enumeration, FIXED case order
// (full solve; point-1-only; point-2-only; neither), closed form,
// deterministic. Friction: both tangent impulses computed from ONE
// shared post-normal state, then both applied — symmetric by
// construction. Charging and blame go through chargePairContact per
// point, the same lines the one-point solver charges through.
function applyPairBlock2(A, B, BxI, ByI, c1, c2) {
  const invMA = A.invM, invIA = A.invI;
  const invMB = B.invM, invIB = B.invI;
  // HOP OFF ANYTHING: the two-point block is one face contact; both
  // points share the normal. Fed once per point so a melon flat on a
  // box counts the face at both lever arms, like the terrain block.
  if (CONFIG.hopProto) {
    for (const c of [c1, c2]) {
      if (A.hopArmed) hopTouch(A, -c.nx, -c.ny, B, c.px - BxI, c.py - ByI);
      if (B.hopArmed) hopTouch(B, c.nx, c.ny, A, c.px - A.x, c.py - A.y);
    }
  }
  // Both points of a reference-face clip carry the SAME normal.
  const nx = c1.nx, ny = c1.ny;
  const ra1x = c1.px - A.x, ra1y = c1.py - A.y;
  const rb1x = c1.px - BxI, rb1y = c1.py - ByI;
  const ra2x = c2.px - A.x, ra2y = c2.py - A.y;
  const rb2x = c2.px - BxI, rb2y = c2.py - ByI;
  const ra1n = ra1x * ny - ra1y * nx, rb1n = rb1x * ny - rb1y * nx;
  const ra2n = ra2x * ny - ra2y * nx, rb2n = rb2x * ny - rb2y * nx;

  // Relative normal velocity at each point, both from the PRE-state.
  const va1x = A.vx - A.omega * ra1y, va1y = A.vy + A.omega * ra1x;
  const vb1x = B.vx - B.omega * rb1y, vb1y = B.vy + B.omega * rb1x;
  const vn1 = (vb1x - va1x) * nx + (vb1y - va1y) * ny;
  const va2x = A.vx - A.omega * ra2y, va2y = A.vy + A.omega * ra2x;
  const vb2x = B.vx - B.omega * rb2y, vb2y = B.vy + B.omega * rb2x;
  const vn2 = (vb2x - va2x) * nx + (vb2y - va2y) * ny;

  // Per-point restitution, the pair law per point (P5-C).
  const g1 = vn1 < 0 && -vn1 > CONFIG.restitutionThreshold;
  const g2 = vn2 < 0 && -vn2 > CONFIG.restitutionThreshold;
  const eA1 = g1 ? damage.bodyRestitution(A) : 0;
  const eB1 = g1 ? damage.bodyRestitution(B) : 0;
  const eA2 = g2 ? damage.bodyRestitution(A) : 0;
  const eB2 = g2 ? damage.bodyRestitution(B) : 0;
  const e1 = eA1 < eB1 ? eA1 : eB1;
  const e2 = eA2 < eB2 ? eA2 : eB2;

  const mSum = invMA + invMB;
  const k11 = mSum + ra1n * ra1n * invIA + rb1n * rb1n * invIB;
  const k22 = mSum + ra2n * ra2n * invIA + rb2n * rb2n * invIB;
  const k12 = mSum + ra1n * ra2n * invIA + rb1n * rb2n * invIB;
  const b1 = vn1 < 0 ? -(1 + e1) * vn1 : 0;
  const b2 = vn2 < 0 ? -(1 + e2) * vn2 : 0;

  // 2x2 LCP, fixed enumeration.
  let j1 = 0, j2 = 0;
  const det = k11 * k22 - k12 * k12;
  let solved = false;
  // SCALE-AWARE det guard (2026-08-30, corrected same day): the
  // absolute `det > 1e-12` was scale-wrong — a very heavy body's k
  // values are ~invM, det ~ invM^2, and the guard silently rejected
  // EVERY solve (found by a heavy-box rig: the body free-falls in
  // velocity while positional correction holds its pose). The first
  // fix was PURE relative (1e-12 * k11 * k22) — and that overclaimed
  // inertness: proven byte-identical only on the prop gate's
  // trajectories, it is 100x+ STRICTER at normal body scales and
  // regressed the humming-box rig (verify-polyseg C2: 0.60 deg
  // swing), because near-vertex manifolds carry near-singular dets
  // the shipped solver accepts. min(1, ...) keeps the shipped
  // behavior BIT-EXACT for every k11*k22 >= 1 and rescues only the
  // tiny scales that were broken. Conditioning at normal scales is
  // its own measured project, not a drive-by.
  if (b1 > 0 && b2 > 0 && det > 1e-12 * Math.min(1, k11 * k22)) {
    const t1 = (b1 * k22 - b2 * k12) / det;
    const t2 = (b2 * k11 - b1 * k12) / det;
    if (t1 >= 0 && t2 >= 0) { j1 = t1; j2 = t2; solved = true; }
  }
  if (!solved && b1 > 0) {
    const t1 = b1 / k11;
    if (k12 * t1 >= b2) { j1 = t1; j2 = 0; solved = true; }
  }
  if (!solved && b2 > 0) {
    const t2 = b2 / k22;
    if (k12 * t2 >= b1) { j1 = 0; j2 = t2; solved = true; }
  }
  // (neither: j1 = j2 = 0 stands)

  if (j1 > 0 || j2 > 0) {
    const jSum = j1 + j2;
    const aTw = ra1n * j1 + ra2n * j2;
    const bTw = rb1n * j1 + rb2n * j2;
    A.vx -= jSum * nx * invMA; A.vy -= jSum * ny * invMA; A.omega -= aTw * invIA;
    B.vx += jSum * nx * invMB; B.vy += jSum * ny * invMB; B.omega += bTw * invIB;
  }

  // --- Friction: both points from ONE shared post-normal state ---
  if (j1 > 0 || j2 > 0) {
    const tx = -ny, ty = nx;
    const wa1x = A.vx - A.omega * ra1y, wa1y = A.vy + A.omega * ra1x;
    const wb1x = B.vx - B.omega * rb1y, wb1y = B.vy + B.omega * rb1x;
    const vt1 = (wb1x - wa1x) * tx + (wb1y - wa1y) * ty;
    const wa2x = A.vx - A.omega * ra2y, wa2y = A.vy + A.omega * ra2x;
    const wb2x = B.vx - B.omega * rb2y, wb2y = B.vy + B.omega * rb2x;
    const vt2 = (wb2x - wa2x) * tx + (wb2y - wa2y) * ty;
    const ra1t = ra1x * ty - ra1y * tx, rb1t = rb1x * ty - rb1y * tx;
    const ra2t = ra2x * ty - ra2y * tx, rb2t = rb2x * ty - rb2y * tx;
    const kt1 = mSum + ra1t * ra1t * invIA + rb1t * rb1t * invIB;
    const kt2 = mSum + ra2t * ra2t * invIA + rb2t * rb2t * invIB;
    let jt1 = j1 > 0 ? -vt1 / kt1 : 0;
    let jt2 = j2 > 0 ? -vt2 / kt2 : 0;
    const max1 = CONFIG.rindFriction * j1;
    const max2 = CONFIG.rindFriction * j2;
    if (jt1 > max1) jt1 = max1; else if (jt1 < -max1) jt1 = -max1;
    if (jt2 > max2) jt2 = max2; else if (jt2 < -max2) jt2 = -max2;
    const jtSum = jt1 + jt2;
    const aTw = ra1t * jt1 + ra2t * jt2;
    const bTw = rb1t * jt1 + rb2t * jt2;
    A.vx -= jtSum * tx * invMA; A.vy -= jtSum * ty * invMA; A.omega -= aTw * invIA;
    B.vx += jtSum * tx * invMB; B.vy += jtSum * ty * invMB; B.omega += bTw * invIB;
  }

  // --- Charge: per point, through the one charge function ---
  if (vn1 < 0 && j1 > 0) chargePairContact(A, B, nx, ny, vn1, k11, j1, eA1, eB1);
  if (vn2 < 0 && j2 > 0) chargePairContact(A, B, nx, ny, vn2, k22, j2, eA2, eB2);

  // --- Positional correction, translation split per point ---
  // (Pair-side ANGULAR correction is a measured NOT-YET — see the
  // note in applyPairContact.) Spelled with a ternary, not Math.max,
  // so the M142 anchor in applyPairContact stays UNIQUE: a shadowed
  // anchor silently skips its mutation, which is the trap the
  // handover names. The block path carries its own mutation sibling.
  const wA = invMA / (invMA + invMB), wB = 1 - wA;
  const over1 = c1.pen - CONFIG.penetrationSlop;
  const corr1 = over1 > 0 ? over1 * CONFIG.positionCorrection * c1.corrShare : 0;
  if (corr1 > 0) {
    A.x -= nx * corr1 * wA; A.y -= ny * corr1 * wA;
    B.x += nx * corr1 * wB; B.y += ny * corr1 * wB;
  }
  const over2 = c2.pen - CONFIG.penetrationSlop;
  const corr2 = over2 > 0 ? over2 * CONFIG.positionCorrection * c2.corrShare : 0;
  if (corr2 > 0) {
    A.x -= nx * corr2 * wA; A.y -= ny * corr2 * wA;
    B.x += nx * corr2 * wB; B.y += ny * corr2 * wB;
  }
}

// ---- THE ONE PAIR SOLVER ------------------------------------------
// Impulse, friction, severity, blame and positional correction for
// ONE contact between two bodies. Both routes above end here, so the
// restitution law, the compliance share and the traffic breadcrumb
// exist once. A second copy of this block for the polygon path was
// offered and rejected: it would have been safe on the day and drifted
// by the second edit, which is the buildLapTemplate lesson.
function applyPairContact(A, B, BxI, ByI, c) {
  // True two-body dynamics: each side brings its OWN invM/invI. The
  // impulse split follows the mass ratio — the heavy fruit barely
  // recoils, the light one flies. Pack bullying as emergent physics.
  const invMA = A.invM, invIA = A.invI;
  const invMB = B.invM, invIB = B.invI;
  const nx = c.nx, ny = c.ny, pen = c.pen;
  const cx = c.px, cy = c.py;
  // HOP OFF ANYTHING: a pair contact is a surface for whichever
  // party is armed. n is A-toward-B, so A pushes off along -n and B
  // along +n. The lever arm is stored from the OTHER body's image
  // centre, since B may be a periodic image here.
  if (CONFIG.hopProto) {
    if (A.hopArmed) hopTouch(A, -nx, -ny, B, cx - BxI, cy - ByI);
    if (B.hopArmed) hopTouch(B, nx, ny, A, cx - A.x, cy - A.y);
  }
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
    // Severity, shares and blame: the one charge (see chargePairContact).
    chargePairContact(A, B, nx, ny, vn, k, jn, eA, eB);
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
  // ...and by the contact's SHARE OF ITS MANIFOLD (P5-B, the pair
  // half of P2-B). Two points of one flat contact must separate the
  // pair exactly as far as one point of a curved contact, or a box
  // resting on a box is ejected twice per tick and climbs. corrShare
  // is 1 on the centre-line route, and multiplying by 1 is exact, so
  // the smooth arithmetic is untouched — which the gate proves.
  const corr = Math.max(pen - CONFIG.penetrationSlop, 0)
    * CONFIG.positionCorrection * c.corrShare;
  if (corr > 0) {
    // PAIR-SIDE ANGULAR CORRECTION: measured and NOT shipped. With
    // the pair form live (A/B.angle nudged through the pair Jacobian)
    // a FREE 2-stack goes exponentially unstable — every off-centre
    // positional fix injects rotation, the boxes tilt into a growing
    // ramp, and the burst moves from 26.1 s to 3.4 s (exp-lean-probe:
    // dx and tilt growing ~1.3x per second in lockstep). The pinned
    // shelf it made exact returns to its acceptable 0.33 px under
    // translation. Terrain-side keeps the angular form (see
    // resolveContact); the pair cell is recorded NOT-YET, with this
    // measurement as the reason.
    const wA = invMA / (invMA + invMB), wB = 1 - wA;
    A.x -= nx * corr * wA; A.y -= ny * corr * wA;
    B.x += nx * corr * wB; B.y += ny * corr * wB;
  }
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
  // THE MAGNITUDE LAW (ruled 2026-08-30, "most consistent with our
  // physics"): the hop is as strong as the net direction it can push
  // off. A single floor is length 1 -> full; a gully sums past 1 ->
  // capped at full; walls closing toward opposed shrink the sum and
  // the hop with it, still pointed the right way; a true pinch is
  // length 0 -> no hop at all. No threshold, and the direction is
  // never a near-zero vector divided by itself. (The old fallback
  // hopped straight up off a zero sum — a mercy rule, retired.)
  if (nl < 1e-12) return null;
  const strength = nl < 1 ? nl : 1;
  nx /= nl; ny /= nl;
  if (H.upBlend > 0) {
    nx = nx * (1 - H.upBlend);
    ny = ny * (1 - H.upBlend) - H.upBlend;
    const l2 = Math.hypot(nx, ny) || 1;
    nx /= l2; ny /= l2;
  }
  // Normal impulse, expressed as delta-v (the dial's units).
  const mag = H.mag * strength;
  const dvnX = nx * mag, dvnY = ny * mag;
  const Jn = mag / m.invM;
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

// ---- THE SPLIT (PHASE-6 §5.4, 2026-08-29) ----
// stepBody owned integration, the terrain solve and the post-solve
// bookkeeping in one body. The unified contact pass needs to drive
// terrain sweeps from OUTSIDE a body's own step — interleaved with
// pair sweeps across an island — so the three are now named:
//   integrateBody         everything before the collide phase
//   sweepTerrainContacts  ONE solver iteration: one broad-phase
//                         query, the candidate loop, the shape
//                         dispatch, resolveContact per manifold point
//   finishBody            everything after the sweeps: pin re-hold,
//                         grounded, the flight ledger, severity,
//                         player telemetry
// stepBody is now `integrate; 6 sweeps; finish` and is BIT-IDENTICAL
// to the un-split body — the legacy path is most of the field, and
// both gates hold it. Signatures differ from the §5.4 sketch where
// the sketch under-counted: the sweep needs `inp` (the hop
// accumulator is guarded on it), finish needs `sink`/`simState`/
// `wasGrounded`, and neither needs `dt`.
function stepBody(m, inp, terrain, dt, sink, simState) {
  // HOP ARMING: the pair solver sees bodies, not seats, so the body
  // carries the fact. Written only under the flag (bit-parity).
  if (CONFIG.hopProto && inp) m.hopArmed = !!inp.hopEligible;
  // The slab world, once per body step: the collision phase queries
  // it. Fetched first, exactly where the un-split body fetched it.
  const world = slab.worldFor(terrain);
  integrateBody(m, inp, dt);
  // ---- 5. Collide & resolve ----
  const wasGrounded = m.grounded;
  const acc = TACC;
  acc.grounded = false;
  acc.strongestE = 0;   // the tick's worst SINGLE blow: FX direction, telemetry
  acc.sumE = 0;         // the tick's TOTAL dissipation: what the law charges
  acc.impactNormalAngle = 0;
  acc.impactVn = 0;
  m.hitSeverity = 0;
  for (let iter = 0; iter < CONFIG.solverIterations; iter++) {
    sweepTerrainContacts(m, inp, world, acc);
  }
  finishBody(m, sink, simState, acc, wasGrounded);
}

function integrateBody(m, inp, dt) {
  const invI = m.invI;

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
      inp.hopBuffer = (CONFIG.hop && CONFIG.hop.bufferTicks) || 12;
    }
    const H = CONFIG.hop;
    // Recency is the touch STAMP: any surface, terrain or body.
    const sinceTouch = m.hopTouchTick === undefined ? 1e9 : (HOP_TICK - 1 - m.hopTouchTick);
    const groundedNow = sinceTouch <= (H.coyoteTicks || 0);
    const d = (m.alive && groundedNow) ? hopImpulse(m, H) : null;
    if (d) {
      m.vx += d.dvx; m.vy += d.dvy; m.omega += d.domega;
      // THE REACTION (ruling 1). The melon gained momentum P; each
      // contributor takes -P times its share of the summed normal,
      // w_i = (n_i . S) / |S|^2, which sum to exactly one — so the
      // shares sum to exactly -P and momentum is conserved to the
      // last bit of arithmetic, not approximately. Terrain
      // contributors (other = null) absorb theirs. Applied at the
      // contact point, so a hop off a box's corner also tips it.
      const T = m.hopTouches;
      if (T && T.length) {
        const Sx = m.hopNx, Sy = m.hopNy;
        const S2 = Sx * Sx + Sy * Sy;
        const Sl = Math.sqrt(S2);
        const Px = d.dvx / m.invM, Py = d.dvy / m.invM;   // momentum gained
        // Split P into the part along the summed direction S-hat and
        // the remainder (the friction kick, and upBlend if ever set).
        // The along-S part goes back to each body ALONG ITS OWN
        // NORMAL, n_i/|S| — those sum to S-hat exactly, so a floor
        // box under a corner hop is pushed straight down and the wall
        // beside it straight sideways, each getting only what it
        // gave. The remainder is split by the same weights w_i (which
        // sum to one). Total reaction is -P to the last bit.
        // (The first cut handed every body a fraction of the WHOLE
        // vector P and a floor box took a diagonal shove — caught by
        // B4, the cell that exists to see the distribution.)
        const pAlong = (Px * Sx + Py * Sy) / (Sl || 1);
        const remX = Px - pAlong * (Sx / (Sl || 1));
        const remY = Py - pAlong * (Sy / (Sl || 1));
        for (let i = 0; i < T.length; i++) {
          const t = T[i];
          if (!t.other || S2 < 1e-18) continue;
          const w = (t.nx * Sx + t.ny * Sy) / S2;
          const o = t.other;
          const jx = -pAlong * (t.nx / Sl) - remX * w;
          const jy = -pAlong * (t.ny / Sl) - remY * w;
          o.vx += jx * o.invM; o.vy += jy * o.invM;
          o.omega += (t.rx * jy - t.ry * jx) * o.invI;
        }
      }
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
}

// sweepTerrainContacts — ONE solver iteration (PHASE-6 §5.4): one
// broad-phase query, the candidate loop, the shape dispatch,
// resolveContact per manifold point. Accumulates into `acc` rather
// than locals because the accumulators must survive across sweeps
// driven from outside. The body below is the un-split loop body,
// byte-for-byte, with the five locals renamed onto acc.
function sweepTerrainContacts(m, inp, world, acc) {
  const invM = m.invM;
  const invI = m.invI;
  // Broad phase: the slab world's spatial hash (stage 1). Candidates
  // are COLLECTED then returned in CANONICAL (strandId, segmentIndex,
  // face) order — hash iteration order can never influence results
  // (THE LAW, spec §2/§3). The query AABB is the body's bound radius
  // plus slack for the solver's positional corrections; anything the
  // inflation admits beyond that is non-contacting and resolves to
  // nothing, so the candidate set is a superset of the contact set
  // and the inflation amount cannot move trajectories.
  // ONE BOUND FIELD, every family (2026-08-28). Was
  // `m.a * (1 + (m.taper || 0))` inline — an expression that silently
  // means "circumradius" only for the smooth families. A polygon's
  // bound is its true circumradius, which for a square is a factor
  // sqrt(2) above the half-extent: the inline form would have
  // under-queried by 20 px and dropped real faces. m.boundR carries
  // the same number as before for ellipse and egg (gate-held).
  const boundR = m.boundR + 32;
  const nCand = world.query(m.x - boundR, m.y - boundR,
    m.x + boundR, m.y + boundR, CAND);
  // POLY TAKES THE CROSS-FACE COLLECTION (2026-08-30): every face's
  // manifold from one pose, merged and block-solved — see
  // sweepPolyTerrain. The smooth families keep the per-face loop
  // below verbatim (merging would move racers; the gate forbids it).
  if (m.shape === 'poly') {
    sweepPolyTerrain(m, inp, world, acc, nCand);
    return;
  }
  for (let ci = 0; ci < nCand; ci++) {
      const fi = CAND[ci];
      SEG_A.x = world.fax[fi]; SEG_A.y = world.fay[fi];
      SEG_B.x = world.fbx[fi]; SEG_B.y = world.fby[fi];
      const A = SEG_A, B = SEG_B;
      // SHAPE DISPATCH IS ON THE TAG (Law 1, 2026-08-28). The poly
      // arm branched to the collection pass above (2026-08-30); the
      // smooth families report ONE contact per face, resolved here
      // exactly as shipped.
      let nC;
      if (m.shape === 'egg') {
        eggVsSegment(m, A, B, MANIFOLD[0]);
        nC = MANIFOLD[0].hit ? 1 : 0;
      } else {
        ellipseVsSegment(m, A, B, MANIFOLD[0]);
        nC = MANIFOLD[0].hit ? 1 : 0;
      }
      for (let k = 0; k < nC; k++) {
        const contact = MANIFOLD[k];
        const omegaPre = m.omega; // spin AT approach: the certificate's spin term
        const applied = resolveContact(m, contact, invM, invI);
        accumulateContact(m, inp, acc, contact, applied, omegaPre);
      }
    }
}

// ---- THE CROSS-FACE COLLECTION (2026-08-30, D6-2 / seam ruling) ---
// The block solve of 2026-08-29 made the two points of ONE face
// simultaneous — and left faces sequential: a later face's
// narrowphase read a pose an earlier face's resolution had already
// moved, which is the same injection one level up. Measured: a lone
// box STRADDLING a segment vertex drifted 3.81 px/60 s against the
// 0.29 baseline (D6-2), and a seam 2-stack burst at 36 s while its
// mid-segment twin stood forever.
//
// For POLY bodies only, the sweep now COLLECTS every candidate
// face's manifold from ONE pose, MERGES contacts whose normals agree
// (a flat seam's two faces are one plane wearing two segment ids),
// REDUCES each merged group to its two extreme points along the
// tangent (interior points of a rigid convex face are implied by the
// extremes), and solves each group as the block it is. Groups with
// genuinely different normals — a vee, a notch — still resolve in
// canonical order: rocking in a vee is physics, not bias.
//
// The smooth families keep their loop verbatim below: a melon
// crossing a seam still resolves per face, exactly as shipped —
// merging would move racers, and the gate forbids it.
const TSET_CAP = 16;           // faces near a 100 px box are few; loud clamp below
const TSET = [];
for (let i = 0; i < TSET_CAP; i++) {
  TSET.push({ px: 0, py: 0, nx: 0, ny: 0, pen: 0, corrShare: 1, grp: -1 });
}
// Two normals are ONE plane within this dot. 6 degrees: wide enough
// that a flat run's gentle per-vertex turn merges (the measured
// defect cells are exactly-collinear and merge at any epsilon),
// narrow enough that no deliberate vee ever does. (Eddie's number to
// tune if device seams disagree.)
const TSET_MERGE_DOT = 0.9945;

function sweepPolyTerrain(m, inp, world, acc, nCand) {
  const invM = m.invM;
  const invI = m.invI;
  // COLLECT: every candidate face's manifold, all from THIS pose.
  let nPts = 0;
  for (let ci = 0; ci < nCand; ci++) {
    const fi = CAND[ci];
    SEG_A.x = world.fax[fi]; SEG_A.y = world.fay[fi];
    SEG_B.x = world.fbx[fi]; SEG_B.y = world.fby[fi];
    const nC = polyVsSegment(m, SEG_A, SEG_B, MANIFOLD);
    for (let k = 0; k < nC; k++) {
      if (nPts >= TSET_CAP) {
        // A signal that cannot say "I don't know" says "yes": the cap
        // is stated out loud, once, rather than silently dropping.
        if (!sweepPolyTerrain._capWarned) {
          sweepPolyTerrain._capWarned = true;
          console.warn('sweepPolyTerrain: contact set capped at', TSET_CAP);
        }
        break;
      }
      const c = MANIFOLD[k], t = TSET[nPts++];
      t.px = c.px; t.py = c.py; t.nx = c.nx; t.ny = c.ny;
      t.pen = c.pen; t.corrShare = c.corrShare; t.grp = -1;
    }
  }
  if (nPts === 0) return;
  // GROUP by shared normal: greedy, collection (canonical) order.
  let nGrp = 0;
  for (let i = 0; i < nPts; i++) {
    if (TSET[i].grp >= 0) continue;
    TSET[i].grp = nGrp;
    for (let j = i + 1; j < nPts; j++) {
      if (TSET[j].grp >= 0) continue;
      if (TSET[i].nx * TSET[j].nx + TSET[i].ny * TSET[j].ny > TSET_MERGE_DOT) {
        TSET[j].grp = nGrp;
      }
    }
    nGrp++;
  }
  // SOLVE each group: reduce to its extremes, then the block law.
  for (let g = 0; g < nGrp; g++) {
    let first = -1, second = -1, count = 0;
    for (let i = 0; i < nPts; i++) {
      if (TSET[i].grp !== g) continue;
      count++;
      if (first < 0) first = i;
      else if (second < 0) second = i;
    }
    if (count > 2) {
      // Extremes along the group's tangent; ties break to the lowest
      // collection index (the < / > below keep the first seen).
      const tx = -TSET[first].ny, ty = TSET[first].nx;
      let loI = first, hiI = first, loC = 0, hiC = 0;
      for (let i = 0; i < nPts; i++) {
        if (TSET[i].grp !== g) continue;
        const c = (TSET[i].px - TSET[first].px) * tx + (TSET[i].py - TSET[first].py) * ty;
        if (c < loC) { loC = c; loI = i; }
        if (c > hiC) { hiC = c; hiI = i; }
      }
      first = loI < hiI ? loI : hiI;
      second = loI < hiI ? hiI : loI;
      // ONE plane's overlap is undone ONCE: the kept pair shares the
      // correction exactly as a single face's two points do.
      TSET[first].corrShare = 0.5;
      TSET[second].corrShare = 0.5;
    }
    const omegaPre = m.omega;
    if (count === 1) {
      const applied = resolveContact(m, TSET[first], invM, invI);
      accumulateContact(m, inp, acc, TSET[first], applied, omegaPre);
    } else {
      const ap2 = resolveContactBlock2(m, TSET[first], TSET[second], invM, invI);
      accumulateContact(m, inp, acc, TSET[first], ap2[0], omegaPre);
      accumulateContact(m, inp, acc, TSET[second], ap2[1], omegaPre);
    }
  }
}


// The per-contact ACCUMULATION (extracted 2026-08-29, gate-pure):
// grounded, the hop normal, dissipation into the tick's total, and
// the strongest-blow breadcrumbs. One spelling, consumed by the
// ---- HOP OFF ANYTHING (ruled 2026-08-30) ----------------------------
// The hop never cared what surface fed it: it works off two facts —
// how recently the melon touched something, and the summed normal of
// what it touched. Only the terrain routes used to feed those facts,
// so a melon standing on a boulder was hop-dead. Now EVERY contact
// feeds them, terrain and pair alike, through this one function.
//
// Three rulings, all Eddie's:
//   1. The hop PUSHES BACK on what it pushed off. Each contributor
//      receives the opposite of its own share, so momentum is exactly
//      conserved; terrain absorbs its share as an infinitely heavy
//      thing does.
//   2. Wall-jumps are allowed — they fall out of the summed normal.
//   3. Other racers count as surfaces.
// And the degenerate case, ruled "whatever is most consistent with
// our physics": the hop is AS STRONG AS THE NET DIRECTION you can
// push off — magnitude scales with the summed normal's length, capped
// at one, never normalised by a near-zero. A true pinch hops zero.
// No threshold anywhere. (The old code hopped straight UP off a zero
// sum — a mercy rule, retired.)
//
// Recency is a TICK STAMP, not a reset of airTicks: airTicks means
// "off terrain" and other systems read it that way. Overloading its
// meaning is how quiet bugs start.
let HOP_TICK = 0;
const HOP_MAX_TOUCH = 8;   // contributors per tick; a melon in a pile
function hopTouch(m, nx, ny, other, rx, ry) {
  if (m.hopTouchTick !== HOP_TICK) {
    // First touch this tick: last tick's sum is spent.
    m.hopTouchTick = HOP_TICK;
    m.hopNx = 0; m.hopNy = 0;
    if (!m.hopTouches) m.hopTouches = [];
    m.hopTouches.length = 0;
  }
  m.hopNx += nx;
  m.hopNy += ny;
  if (m.hopTouches.length < HOP_MAX_TOUCH) {
    m.hopTouches.push({ other, nx, ny, rx, ry });
  }
}

// sequential, block, and cross-face terrain routes.
function accumulateContact(m, inp, acc, contact, applied, omegaPre) {
  acc.grounded = true;
  // HOP: terrain is a contributor with no body to push back on.
  // Flag-guarded so the flag-off sim writes not one new field.
  if (CONFIG.hopProto && inp && inp.hopEligible) {
    hopTouch(m, contact.nx, contact.ny, null, 0, 0);
  }
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
  acc.sumE += ev;
  // The worst SINGLE blow still picks the event's direction and
  // telemetry — drama follows the biggest hit, damage follows
  // the total.
  if (ev > acc.strongestE) {
    acc.strongestE = ev;
    acc.impactNormalAngle = Math.atan2(contact.ny, contact.nx);
    acc.impactVn = applied.vn;
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

// finishBody — everything after the sweeps (PHASE-6 §5.4): the pin
// re-hold, grounded, the flight ledger, severity/strain, and the
// player-only telemetry. The un-split tail byte-for-byte, with the
// five accumulators read from acc.
function finishBody(m, sink, simState, acc, wasGrounded) {
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

  m.grounded = acc.grounded;
  // ---- FLIGHT LEDGER (presentation telemetry, every body) ----
  // The commentary layer needs to know the SHAPE of an event, not
  // just its magnitude: how long you were up, how high, and whether
  // the blow that got you was the arrival or the third bounce of a
  // bleed chain (a story the energy law made possible and the old
  // orientation commentary couldn't tell). Cheap scalars, written
  // every tick, read by nobody in the sim — same divergence license
  // as fx and telemetry.
  const wasAir = (m.airTicks || 0) > 0;
  m.airTicks = acc.grounded ? 0 : (m.airTicks || 0) + 1;
  if (!acc.grounded) {
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
  if (acc.sumE > 0) {
    // hitSeverity is the tick's TOTAL severity now (2026-08-13): the
    // exact quantity the cluster ledger accumulates, so squash below
    // stays a truthful preview of how close to bursting — a wedge
    // landing deforms for BOTH walls, as it should.
    m.hitSeverity = damage.severityFromE(acc.sumE, m);

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
  state.telemetry.grounded = acc.grounded;

  // A "landing" = airborne last step, meaningful impact this step.
  if (acc.grounded && !wasGrounded && acc.impactVn < -CONFIG.restitutionThreshold) {
    state.telemetry.lastImpactVn = -acc.impactVn; // report as positive speed
    state.telemetry.lastImpactTick = state.tick;

    // Landing orientation: angle between the melon's MAJOR axis and the
    // surface tangent, folded to [0°, 90°]. 0° = flat-side landing
    // (safe), 90° = landed on the pointy end (future break territory).
    const tangentAngle = acc.impactNormalAngle + Math.PI / 2;
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
  let vertexPhase = false;   // reported on out (2026-08-30): the pair
  // per-edge law needs to know an endpoint clamp from a face hit;
  // terrain readers ignore the field, gate-verified.

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
      vertexPhase = true;
      const vx = proj < 0 ? ax : bx, vy = proj < 0 ? ay : by;
      if (!eggVertexContact(m, vx, vy)) return;
      // eggVertexContact leaves its results in the module scratch:
      nlx = EGGV.nx; nly = EGGV.ny; penL = EGGV.pen;
      qx = EGGV.qx; qy = EGGV.qy; tStar = EGGV.t;
      pxL = vx; pyL = vy;
    }
  } else {
    // Degenerate segment: pure vertex.
    vertexPhase = true;
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
  out.vertexHit = vertexPhase;
  out.pen = penL;
  out.corrShare = 1;   // a smooth body's contact is its own manifold
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
// POLYGON vs SEGMENT (phase 2, 2026-08-28). Fills up to TWO slots of
// the manifold and returns the count. Same contact contract as the
// smooth routines, so resolveContact needs no branch.
//
// SAT over the face normals of both shapes — the polygon's edge
// normals, plus the segment's own normal. A segment is a degenerate
// convex hull of two points, so that axis set is complete; the axis
// of least overlap is the minimum translation.
//
// ORIENTATION IS NON-ORIENTED (P2-D, ruled 2026-08-28). A terrain
// face carries no solid side: slab.js knows which side the material
// is on and bakes it into the extrusion, but buildWorld's face list
// is not consistently wound — the top runs t[i]->t[i+1] and the
// bottom runs b[i]->b[i+1], the SAME direction, and the end caps run
// top-to-bottom — so a->b order carries no outward sense. This
// routine therefore uses the convention the other two already use:
// push the body back the way it came, by orienting the axis toward
// the body's centre. Correct while the centre is outside the solid,
// which the slab's thickness makes true.
//
// THE CLIP (§3.2): the reference face is whichever feature owns the
// winning axis; the other is the incident feature. Clipping the
// incident edge against the reference face's side planes yields up to
// two points — which is what stops a box see-sawing on a single
// deepest point when it lies WITHIN one long segment. Both cases are
// written (P2-E): a box on a slope wins on a polygon edge normal as
// often as a box on flat ground wins on the segment's.
const POLY_WX = [0, 0, 0, 0, 0, 0, 0, 0];   // clip scratch, body frame
const POLY_WY = [0, 0, 0, 0, 0, 0, 0, 0];
function polyVsSegment(m, A, B, out) {
  out[0].hit = false; out[1].hit = false;
  const P = m.poly;
  const nV = P.length;
  const cos = dcos(m.angle), sin = dsin(m.angle);
  // Segment into the body frame.
  const adx = A.x - m.x, ady = A.y - m.y;
  const bdx = B.x - m.x, bdy = B.y - m.y;
  const ax = adx * cos + ady * sin, ay = -adx * sin + ady * cos;
  const bx = bdx * cos + bdy * sin, by = -bdx * sin + bdy * cos;
  const ex = bx - ax, ey = by - ay;
  const eLen2 = ex * ex + ey * ey;
  if (eLen2 < 1e-12) return 0;   // degenerate face: nothing to collide
  const eLen = Math.sqrt(eLen2);

  let bestPen = Infinity, bestNx = 0, bestNy = 0, bestRef = -1;
  // THE TWO-SIDED DEPTH. A segment is a DEGENERATE hull — on any axis
  // perpendicular to it, both endpoints project to the same value, so
  // the naive overlap `min(pMax,sMax) - max(pMin,sMin)` is identically
  // ZERO and reads as separation. It is not: a point sitting inside
  // the polygon's interval must still be pushed out one side or the
  // other. The separating distance is the SMALLER of the two exits,
  // and its sign is the direction to push the body — which also
  // removes any need to guess the orientation from a midpoint (a
  // guess that fails outright when the segment is long and its middle
  // is nowhere near the contact).
  function axis(nx, ny, ref) {
    let pMin = Infinity, pMax = -Infinity;
    for (let k = 0; k < nV; k++) {
      const d = P[k][0] * nx + P[k][1] * ny;
      if (d < pMin) pMin = d;
      if (d > pMax) pMax = d;
    }
    const sA = ax * nx + ay * ny, sB = bx * nx + by * ny;
    const sMin = sA < sB ? sA : sB, sMax = sA < sB ? sB : sA;
    const d1 = pMax - sMin;   // push the body along -n by d1 to clear
    const d2 = sMax - pMin;   // push the body along +n by d2 to clear
    if (d1 <= 0 || d2 <= 0) return false;   // a separating axis
    const ov = d1 < d2 ? d1 : d2;
    if (ov < bestPen) {
      bestPen = ov;
      const sgn = d1 < d2 ? -1 : 1;
      bestNx = nx * sgn; bestNy = ny * sgn;
      bestRef = ref;
    }
    return true;
  }
  // --- axes 0..nV-1: the polygon's own edge normals ---
  // Vertices are canonically wound (positive signed area), so the
  // outward normal of edge (ex, ey) is (ey, -ex).
  for (let i = 0; i < nV; i++) {
    const p = P[i], q = P[(i + 1) % nV];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-12) continue;
    if (!axis(dy / len, -dx / len, i)) return 0;
  }
  // --- the segment's own normal ---
  if (!axis(ey / eLen, -ex / eLen, -1)) return 0;

  // THE TOUCHING FACE. bestN points INTO the body, so the polygon face
  // actually meeting the segment is the one whose outward normal is
  // most aligned with -bestN. Selected generically rather than taken
  // as "the edge that won the axis": when the winning exit is the
  // FAR side of the interval, the face that won is the opposite one.
  let faceDot = -Infinity, faceI = 0;
  for (let i = 0; i < nV; i++) {
    const p = P[i], q = P[(i + 1) % nV];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-12) continue;
    const d = (dy / len) * -bestNx + (-dx / len) * -bestNy;
    if (d > faceDot) { faceDot = d; faceI = i; }
  }

  // --- reference and incident features ---
  let rAx, rAy, rBx, rBy;      // reference face, body frame
  let refNx, refNy;            // reference face's outward normal (toward the other feature)
  let iAx, iAy, iBx, iBy;      // incident feature
  if (bestRef >= 0) {
    // A polygon edge won. The touching face is the reference; the
    // segment is the incident feature.
    const p = P[faceI], q = P[(faceI + 1) % nV];
    rAx = p[0]; rAy = p[1]; rBx = q[0]; rBy = q[1];
    const dx = rBx - rAx, dy = rBy - rAy;
    const len = Math.sqrt(dx * dx + dy * dy);
    refNx = dy / len; refNy = -dx / len;   // the face's own outward normal
    iAx = ax; iAy = ay; iBx = bx; iBy = by;
  } else {
    // The segment won. The incident feature is the touching polygon
    // face — the one actually lying against the ground.
    rAx = ax; rAy = ay; rBx = bx; rBy = by;
    refNx = bestNx; refNy = bestNy;
    const p = P[faceI], q = P[(faceI + 1) % nV];
    iAx = p[0]; iAy = p[1]; iBx = q[0]; iBy = q[1];
  }

  // --- clip the incident edge to the reference face's extent ---
  let tx = rBx - rAx, ty = rBy - rAy;
  const tLen = Math.sqrt(tx * tx + ty * ty);
  if (tLen < 1e-12) return 0;
  tx /= tLen; ty /= tLen;
  let lo = rAx * tx + rAy * ty;
  let hi = rBx * tx + rBy * ty;
  if (lo > hi) { const s = lo; lo = hi; hi = s; }
  const t0 = iAx * tx + iAy * ty;
  const t1 = iBx * tx + iBy * ty;
  const dT = t1 - t0;
  let u0 = 0, u1 = 1;
  if (Math.abs(dT) < 1e-12) {
    if (t0 < lo || t0 > hi) return 0;   // incident edge sits off the end
  } else {
    let ua = (lo - t0) / dT, ub = (hi - t0) / dT;
    if (ua > ub) { const s = ua; ua = ub; ub = s; }
    if (ua > u0) u0 = ua;
    if (ub < u1) u1 = ub;
    if (u0 > u1) return 0;              // no overlap along the face
  }
  POLY_WX[0] = iAx + (iBx - iAx) * u0; POLY_WY[0] = iAy + (iBy - iAy) * u0;
  POLY_WX[1] = iAx + (iBx - iAx) * u1; POLY_WY[1] = iAy + (iBy - iAy) * u1;

  // --- keep the points that are actually behind the reference face ---
  // A SPECULATIVE MARGIN WAS TRIED HERE AND REVERTED (2026-08-28f).
  // The manifold does collapse from two points to one at about 0.2
  // degrees of tilt, which is real and measured. But it was NOT
  // causing the sideways walk it was added to fix — that turned out
  // to be a rig artefact — and keeping near-touching points made a
  // resting box sit visibly cocked at 2.74 degrees instead of 0.43,
  // because a corner 2 px clear of the ground still got a normal
  // impulse holding it up. Whether the collapse matters for STACKS is
  // an open question for the SAT work; it earns its place there or
  // not at all.
  let n = 0;
  const keepX = [0, 0], keepY = [0, 0], keepPen = [0, 0];
  for (let k = 0; k < 2; k++) {
    const px = POLY_WX[k], py = POLY_WY[k];
    const pen = -((px - rAx) * refNx + (py - rAy) * refNy);
    if (pen <= 0) continue;
    // Two clip parameters can coincide (a corner strike); one point.
    if (n === 1 && Math.abs(px - keepX[0]) < 1e-9
      && Math.abs(py - keepY[0]) < 1e-9) continue;
    keepX[n] = px; keepY[n] = py; keepPen[n] = pen;
    n++;
  }
  if (n === 0) return 0;
  // CANONICAL ORDER (P2-A, ruled 2026-08-28): ascending along the
  // tangent DERIVED FROM THE CONTACT NORMAL, (-ny, nx). The points
  // are fed to resolveContact in sequence and each mutates velocity,
  // so their order is physics, not tidiness.
  //
  // The first cut sorted along the REFERENCE FACE's tangent and was
  // wrong: which feature is the reference depends on which axis won
  // SAT, and a polygon face's tangent direction depends on the
  // registry's winding — so the same box in the same pose ordered its
  // contacts one way on flat ground and the other on a slope. The
  // normal is a physical quantity; the winding is an authoring
  // accident. Sort on the physics.
  const oX = -bestNy, oY = bestNx;
  if (n === 2 && (keepX[1] * oX + keepY[1] * oY) < (keepX[0] * oX + keepY[0] * oY)) {
    let s = keepX[0]; keepX[0] = keepX[1]; keepX[1] = s;
    s = keepY[0]; keepY[0] = keepY[1]; keepY[1] = s;
    s = keepPen[0]; keepPen[0] = keepPen[1]; keepPen[1] = s;
  }
  const share = 1 / n;
  for (let k = 0; k < n; k++) {
    const c = out[k];
    c.nx = bestNx * cos - bestNy * sin;
    c.ny = bestNx * sin + bestNy * cos;
    c.px = m.x + keepX[k] * cos - keepY[k] * sin;
    c.py = m.y + keepX[k] * sin + keepY[k] * cos;
    c.pen = keepPen[k];
    c.corrShare = share;
    c.hit = true;
  }
  return n;
}

// ------------------------------------------------------------
// POLYGON vs POLYGON (phase 5, 2026-08-28g). Fills up to TWO slots of
// the manifold and returns the count. Normals point from A to B,
// which is the convention applyPairContact already uses.
//
// WHY THIS EXISTS. The line-of-centres solve asks each body for its
// support radius along the line joining the centres. For two smooth
// bodies that line is very nearly the contact normal. For two BOXES
// it is not the normal at all, and worse, a box's support radius
// GROWS toward its corner: 50 px straight down, 70.71 px diagonally.
// Two 1 m boxes stacked 102 px apart with a hair of horizontal offset
// therefore read as 141 px of combined radius and report ~39 px of
// penetration THAT DOES NOT EXIST. Measured consequence: a stack of
// two detonates in 1.36 s at 704 px/s.
//
// And the error is not a constant — it is a FEEDBACK LOOP. At perfect
// alignment it is zero; every degree the centre line tilts raises both
// supports, which ejects the boxes further, which tilts it more. That
// is why iterations never helped, why a taller stack goes sooner
// (0.30 s at five), and why warm starting would not have touched it:
// there is no stability question until the contact is correct.
//
// THE ROUTINE. Textbook SAT, working in A's body frame, mirroring
// polyVsSegment feature for feature:
//   - axes are both hulls' face normals (a complete set for two
//     convex polygons — unlike the segment case, both hulls are
//     proper, so the plain interval overlap is correct here and the
//     two-sided depth trick of polyVsSegment does NOT belong);
//   - the axis of least overlap is the minimum translation;
//   - the reference face is chosen GENERICALLY by alignment with the
//     winning normal, never taken as "the face whose index won" —
//     opposite faces of a rectangle give identical overlap, so the
//     index can name the far side (the bug polyVsSegment already ate);
//   - the incident face is clipped to the reference face's extent,
//     giving the two points that stop a box see-sawing on one corner;
//   - canonical order along the tangent DERIVED FROM THE NORMAL
//     (P2-A), because the points mutate velocity in sequence;
//   - corrShare = 1/n (P5-B).
//
// TIE-BREAK IS LAW, NOT LUCK. Axes are tested A's faces first, in
// vertex order, and the winner is kept on strict `<`. A perfectly
// square contact therefore resolves on A's face every time. Which
// body is A is already law (the canonical pair order), so this is
// deterministic rather than merely repeatable.
// THE HULL CEILING (raised 2026-08-30, boulders phase 0). Was eight
// slots with `if (nB > PP_BX.length) return 0` — a body with more
// vertices than the scratch reported NO CONTACT and passed straight
// through its neighbour. Silent, and exactly wrong: a signal that
// cannot say "I don't know" says "no collision". Boulders are ruled
// at 6-8 sides, which sat ON the old ceiling with zero margin.
//
// Now 32, and overflow SAYS SO (once) instead of ghosting. 32 is not
// a guess about boulders: it is the same cap the terrain contact set
// (TSET_CAP) states out loud, doubled, so one number does not quietly
// become the smaller of two limits. A hull that large is an authoring
// error long before it is a physics problem.
const PP_CAP = 32;
const PP_BX = new Array(PP_CAP).fill(0);   // B's hull, A's frame
const PP_BY = new Array(PP_CAP).fill(0);
function polyVsPoly(A, B, BxI, ByI, out) {
  out[0].hit = false; out[1].hit = false;
  const PA = A.poly, PB = B.poly;
  if (!PA || !PB) return 0;
  const nA = PA.length, nB = PB.length;
  if (nB > PP_CAP) {
    // LOUD, not silent: the old spelling returned "no contact", which
    // is a lie the caller cannot detect.
    if (!polyVsPoly._capWarned) {
      polyVsPoly._capWarned = true;
      console.warn('polyVsPoly: hull of', nB, 'vertices exceeds PP_CAP', PP_CAP,
        '- contact SKIPPED; this is an authoring error, not a physics limit');
    }
    return 0;
  }
  const cA = dcos(A.angle), sA = dsin(A.angle);
  const cB = dcos(B.angle), sB = dsin(B.angle);
  // B's frame expressed in A's frame: R(-thetaA)*R(thetaB). Composed
  // from each body's OWN angle rather than dcos(B.angle - A.angle):
  // the difference is a new argument to the deterministic trig table,
  // and a body's pose should only ever be read at its own angle.
  const cR = cA * cB + sA * sB;
  const sR = cA * sB - sA * cB;
  const ddx = BxI - A.x, ddy = ByI - A.y;
  const dX = ddx * cA + ddy * sA;     // B's centre, A's frame
  const dY = -ddx * sA + ddy * cA;
  for (let i = 0; i < nB; i++) {
    PP_BX[i] = PB[i][0] * cR - PB[i][1] * sR + dX;
    PP_BY[i] = PB[i][0] * sR + PB[i][1] * cR + dY;
  }

  let bestOv = Infinity, bestNx = 0, bestNy = 0, bestOwner = -1;
  function axis(nx, ny) {
    let aMin = Infinity, aMax = -Infinity;
    for (let k = 0; k < nA; k++) {
      const d = PA[k][0] * nx + PA[k][1] * ny;
      if (d < aMin) aMin = d;
      if (d > aMax) aMax = d;
    }
    let bMin = Infinity, bMax = -Infinity;
    for (let k = 0; k < nB; k++) {
      const d = PP_BX[k] * nx + PP_BY[k] * ny;
      if (d < bMin) bMin = d;
      if (d > bMax) bMax = d;
    }
    const ov = (aMax < bMax ? aMax : bMax) - (aMin > bMin ? aMin : bMin);
    return { sep: ov <= 0, ov };
  }
  function tryAxis(nx, ny, owner) {
    const r = axis(nx, ny);
    if (r.sep) return false;            // a separating axis: no contact
    if (r.ov < bestOv) {
      // ORIENT A -> B by the centre-to-centre vector, which is a
      // physical direction and not a winding accident. Exactly zero
      // (concentric along this axis) takes +1 so the choice is total.
      const sgn = (dX * nx + dY * ny) >= 0 ? 1 : -1;
      bestOv = r.ov; bestNx = nx * sgn; bestNy = ny * sgn; bestOwner = owner;
    }
    return true;
  }
  for (let i = 0; i < nA; i++) {
    const p = PA[i], q = PA[(i + 1) % nA];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < 1e-12) continue;
    if (!tryAxis(ey / len, -ex / len, 0)) return 0;
  }
  for (let i = 0; i < nB; i++) {
    const ix = (i + 1) % nB;
    const ex = PP_BX[ix] - PP_BX[i], ey = PP_BY[ix] - PP_BY[i];
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < 1e-12) continue;
    if (!tryAxis(ey / len, -ex / len, 1)) return 0;
  }
  if (bestOwner < 0) return 0;          // degenerate hull: nothing to do

  // --- reference and incident features, both chosen by alignment ---
  // The reference face lives on the owner of the winning axis and is
  // the face most aligned with the push direction: +bestN if A owns it
  // (A pushes B along +n), -bestN if B owns it.
  const refWant = bestOwner === 0 ? 1 : -1;
  let rAx = 0, rAy = 0, rBx = 0, rBy = 0, refNx = 0, refNy = 0;
  {
    let best = -Infinity, bi = 0, bnx = 0, bny = 0;
    const n = bestOwner === 0 ? nA : nB;
    for (let i = 0; i < n; i++) {
      const ix = (i + 1) % n;
      const px = bestOwner === 0 ? PA[i][0] : PP_BX[i];
      const py = bestOwner === 0 ? PA[i][1] : PP_BY[i];
      const qx = bestOwner === 0 ? PA[ix][0] : PP_BX[ix];
      const qy = bestOwner === 0 ? PA[ix][1] : PP_BY[ix];
      const ex = qx - px, ey = qy - py;
      const len = Math.sqrt(ex * ex + ey * ey);
      if (len < 1e-12) continue;
      const fnx = ey / len, fny = -ex / len;
      const d = (fnx * bestNx + fny * bestNy) * refWant;
      if (d > best) { best = d; bi = i; bnx = fnx; bny = fny; }
    }
    const ix = (bi + 1) % n;
    if (bestOwner === 0) {
      rAx = PA[bi][0]; rAy = PA[bi][1]; rBx = PA[ix][0]; rBy = PA[ix][1];
    } else {
      rAx = PP_BX[bi]; rAy = PP_BY[bi]; rBx = PP_BX[ix]; rBy = PP_BY[ix];
    }
    refNx = bnx; refNy = bny;
  }
  // The incident face is on the OTHER hull, most anti-aligned with the
  // reference normal — the face actually lying against it.
  let iAx = 0, iAy = 0, iBx = 0, iBy = 0;
  {
    let best = Infinity, bi = 0;
    const n = bestOwner === 0 ? nB : nA;
    for (let i = 0; i < n; i++) {
      const ix = (i + 1) % n;
      const px = bestOwner === 0 ? PP_BX[i] : PA[i][0];
      const py = bestOwner === 0 ? PP_BY[i] : PA[i][1];
      const qx = bestOwner === 0 ? PP_BX[ix] : PA[ix][0];
      const qy = bestOwner === 0 ? PP_BY[ix] : PA[ix][1];
      const ex = qx - px, ey = qy - py;
      const len = Math.sqrt(ex * ex + ey * ey);
      if (len < 1e-12) continue;
      const d = (ey / len) * refNx + (-ex / len) * refNy;
      if (d < best) { best = d; bi = i; }
    }
    const ix = (bi + 1) % n;
    if (bestOwner === 0) {
      iAx = PP_BX[bi]; iAy = PP_BY[bi]; iBx = PP_BX[ix]; iBy = PP_BY[ix];
    } else {
      iAx = PA[bi][0]; iAy = PA[bi][1]; iBx = PA[ix][0]; iBy = PA[ix][1];
    }
  }

  // --- clip the incident edge to the reference face's extent ---
  let tx = rBx - rAx, ty = rBy - rAy;
  const tLen = Math.sqrt(tx * tx + ty * ty);
  if (tLen < 1e-12) return 0;
  tx /= tLen; ty /= tLen;
  let lo = rAx * tx + rAy * ty;
  let hi = rBx * tx + rBy * ty;
  if (lo > hi) { const s = lo; lo = hi; hi = s; }
  const t0 = iAx * tx + iAy * ty;
  const t1 = iBx * tx + iBy * ty;
  const dT = t1 - t0;
  let u0 = 0, u1 = 1;
  if (Math.abs(dT) < 1e-12) {
    if (t0 < lo || t0 > hi) return 0;   // incident edge sits off the end
  } else {
    let ua = (lo - t0) / dT, ub = (hi - t0) / dT;
    if (ua > ub) { const s = ua; ua = ub; ub = s; }
    if (ua > u0) u0 = ua;
    if (ub < u1) u1 = ub;
    if (u0 > u1) return 0;              // no overlap along the face
  }
  POLY_WX[0] = iAx + (iBx - iAx) * u0; POLY_WY[0] = iAy + (iBy - iAy) * u0;
  POLY_WX[1] = iAx + (iBx - iAx) * u1; POLY_WY[1] = iAy + (iBy - iAy) * u1;

  // --- keep the points actually behind the reference face ---
  // No speculative margin. The same margin was tried on the segment
  // routine to fix a defect that turned out to be a rig artefact, and
  // it made a resting box sit cocked at 2.74 degrees (§10.4). If the
  // manifold collapse matters for stacks it will show in the stack
  // measurement, and it earns a fix there on evidence.
  let n = 0;
  const keepX = [0, 0], keepY = [0, 0], keepPen = [0, 0];
  for (let k = 0; k < 2; k++) {
    const px = POLY_WX[k], py = POLY_WY[k];
    const pen = -((px - rAx) * refNx + (py - rAy) * refNy);
    if (pen <= 0) continue;
    if (n === 1 && Math.abs(px - keepX[0]) < 1e-9
      && Math.abs(py - keepY[0]) < 1e-9) continue;   // a corner strike
    keepX[n] = px; keepY[n] = py; keepPen[n] = pen;
    n++;
  }
  if (n === 0) return 0;
  // CANONICAL ORDER (P2-A): ascending along the tangent derived from
  // the CONTACT normal. The reference face's own tangent is not
  // usable — which hull owns the reference depends on which axis won,
  // so the same pose would order its contacts one way on a face hit
  // and the other on a corner hit.
  const oX = -bestNy, oY = bestNx;
  if (n === 2 && (keepX[1] * oX + keepY[1] * oY) < (keepX[0] * oX + keepY[0] * oY)) {
    let s = keepX[0]; keepX[0] = keepX[1]; keepX[1] = s;
    s = keepY[0]; keepY[0] = keepY[1]; keepY[1] = s;
    s = keepPen[0]; keepPen[0] = keepPen[1]; keepPen[1] = s;
  }
  const share = 1 / n;
  for (let k = 0; k < n; k++) {
    const c = out[k];
    c.nx = bestNx * cA - bestNy * sA;
    c.ny = bestNx * sA + bestNy * cA;
    c.px = A.x + keepX[k] * cA - keepY[k] * sA;
    c.py = A.y + keepX[k] * sA + keepY[k] * cA;
    c.pen = keepPen[k];
    c.corrShare = share;
    c.hit = true;
  }
  return n;
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

  // Normal back to world by the JACOBIAN TRANSPOSE: multiply y by s,
  // re-normalize, rotate by +angle. RULED BY EDDIE 2026-08-30 after
  // measurement: the original divide-by-s (inverse-transpose
  // spelling) is exact at level contact but rotates the bounce
  // direction of TILTED touchdowns — 6 deg wrong at 10 deg of tilt,
  // peaking 13.5 deg at 30-45 — and the whole game's feel was tuned
  // on top of it (the A/B sweep read +24% deaths at unmoved pace
  // under the true math; lethality retune deferred, Eddie's call
  // after play). The pair cell ellipseVsPolyPair proved the correct
  // mapping first; this brings the terrain sibling to the same law.
  // Smooth gate deliberately re-baselined: every melon-terrain
  // trajectory in the game moves.
  let nlx = ncx;
  let nly = ncy * s;
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

  const ex = m.x + spx * cos - spy * sin;
  const ey = m.y + spx * sin + spy * cos;
  out.pen = (out.px - ex) * out.nx + (out.py - ey) * out.ny;
  if (out.pen <= 0) return;

  out.corrShare = 1;   // a smooth body's contact is its own manifold
  out.hit = true;
}

// ---- THE TERRAIN TWO-POINT BLOCK SOLVE (PHASE-6, 2026-08-29) ------
// The terrain sibling of applyPairBlock2, with the ground as the
// infinite-mass partner. CONVICTED BY SIGN FLIP, not argued: a lone
// bit-symmetric box on flat ground exits its FIRST tick with
// vx +8.311e-2, omega +1.644e-3 — and with the manifold resolve
// order reversed in a scratch copy, exactly -8.311e-2, -1.644e-3.
// Sequential resolution of the two face points injects signed
// momentum because the second point reads a velocity the first
// point's impulse already changed; the canonical order (P2-A, left
// first) makes the sign systematic. The block solves both normal
// impulses from ONE pre-state (standard 2x2 LCP, fixed enumeration),
// then both friction impulses from ONE shared post-normal state.
// Rolling resistance stays per point: it clamps |omega| toward zero
// and cannot carry a sign. Positional correction stays per point:
// corr reads stored pen, never a re-read of live state, so its adds
// commute and carry no systematic bias.
//
// Reached only when a manifold has TWO points, which only the
// polygon narrowphases produce — the smooth families are structurally
// outside (gate-held).
const TBLK = [
  { jn: 0, vn: 0, kn: 0, e: 0, rxn: 0 },
  { jn: 0, vn: 0, kn: 0, e: 0, rxn: 0 },
];
function resolveContactBlock2(m, c1, c2, invM, invI) {
  // Both points of one face manifold carry the same normal (P2-A).
  const nx = c1.nx, ny = c1.ny;
  const r1x = c1.px - m.x, r1y = c1.py - m.y;
  const r2x = c2.px - m.x, r2y = c2.py - m.y;
  const r1n = r1x * ny - r1y * nx;
  const r2n = r2x * ny - r2y * nx;

  // Normal velocities, both from the PRE-state.
  const vn1 = (m.vx - m.omega * r1y) * nx + (m.vy + m.omega * r1x) * ny;
  const vn2 = (m.vx - m.omega * r2y) * nx + (m.vy + m.omega * r2x) * ny;
  const e1 = (vn1 < 0 && -vn1 > CONFIG.restitutionThreshold) ? damage.bodyRestitution(m) : 0;
  const e2 = (vn2 < 0 && -vn2 > CONFIG.restitutionThreshold) ? damage.bodyRestitution(m) : 0;

  const k11 = invM + r1n * r1n * invI;
  const k22 = invM + r2n * r2n * invI;
  const k12 = invM + r1n * r2n * invI;
  const b1 = vn1 < 0 ? -(1 + e1) * vn1 : 0;
  const b2 = vn2 < 0 ? -(1 + e2) * vn2 : 0;

  let j1 = 0, j2 = 0;
  const det = k11 * k22 - k12 * k12;
  let solved = false;
  // SCALE-AWARE det guard (2026-08-30, corrected same day): the
  // absolute `det > 1e-12` was scale-wrong — a very heavy body's k
  // values are ~invM, det ~ invM^2, and the guard silently rejected
  // EVERY solve (found by a heavy-box rig: the body free-falls in
  // velocity while positional correction holds its pose). The first
  // fix was PURE relative (1e-12 * k11 * k22) — and that overclaimed
  // inertness: proven byte-identical only on the prop gate's
  // trajectories, it is 100x+ STRICTER at normal body scales and
  // regressed the humming-box rig (verify-polyseg C2: 0.60 deg
  // swing), because near-vertex manifolds carry near-singular dets
  // the shipped solver accepts. min(1, ...) keeps the shipped
  // behavior BIT-EXACT for every k11*k22 >= 1 and rescues only the
  // tiny scales that were broken. Conditioning at normal scales is
  // its own measured project, not a drive-by.
  if (b1 > 0 && b2 > 0 && det > 1e-12 * Math.min(1, k11 * k22)) {
    const t1 = (b1 * k22 - b2 * k12) / det;
    const t2 = (b2 * k11 - b1 * k12) / det;
    if (t1 >= 0 && t2 >= 0) { j1 = t1; j2 = t2; solved = true; }
  }
  if (!solved && b1 > 0) {
    const t1 = b1 / k11;
    if (k12 * t1 >= b2) { j1 = t1; j2 = 0; solved = true; }
  }
  if (!solved && b2 > 0) {
    const t2 = b2 / k22;
    if (k12 * t2 >= b1) { j1 = 0; j2 = t2; solved = true; }
  }

  if (j1 > 0 || j2 > 0) {
    const jSum = j1 + j2;
    const tw = r1n * j1 + r2n * j2;
    m.vx += jSum * nx * invM;
    m.vy += jSum * ny * invM;
    m.omega += tw * invI;
  }

  // --- Friction: both points from ONE shared post-normal state ---
  if (j1 > 0 || j2 > 0) {
    const tx = -ny, ty = nx;
    const vt1 = (m.vx - m.omega * r1y) * tx + (m.vy + m.omega * r1x) * ty;
    const vt2 = (m.vx - m.omega * r2y) * tx + (m.vy + m.omega * r2x) * ty;
    const r1t = r1x * ty - r1y * tx;
    const r2t = r2x * ty - r2y * tx;
    const kt1 = invM + r1t * r1t * invI;
    const kt2 = invM + r2t * r2t * invI;
    let jt1 = j1 > 0 ? -vt1 / kt1 : 0;
    let jt2 = j2 > 0 ? -vt2 / kt2 : 0;
    const max1 = CONFIG.friction * j1;
    const max2 = CONFIG.friction * j2;
    if (jt1 > max1) jt1 = max1; else if (jt1 < -max1) jt1 = -max1;
    if (jt2 > max2) jt2 = max2; else if (jt2 < -max2) jt2 = -max2;
    const jtSum = jt1 + jt2;
    const tw = r1t * jt1 + r2t * jt2;
    m.vx += jtSum * tx * invM;
    m.vy += jtSum * ty * invM;
    m.omega += tw * invI;
  }

  // --- Rolling resistance, per point (clamped toward zero: no sign) ---
  if (j1 > 0 && m.omega !== 0) {
    const rLen = Math.sqrt(r1x * r1x + r1y * r1y);
    const dOmega = CONFIG.rollingResistance * j1 * rLen * invI;
    if (m.omega > 0) m.omega = Math.max(0, m.omega - dOmega);
    else m.omega = Math.min(0, m.omega + dOmega);
  }
  if (j2 > 0 && m.omega !== 0) {
    const rLen = Math.sqrt(r2x * r2x + r2y * r2y);
    const dOmega = CONFIG.rollingResistance * j2 * rLen * invI;
    if (m.omega > 0) m.omega = Math.max(0, m.omega - dOmega);
    else m.omega = Math.min(0, m.omega + dOmega);
  }

  // --- Positional correction, per point (order-free adds) ---
  // Same gates as resolveContact: the angular form only for poly
  // inside the unified pass (measured there, creeps on legacy).
  applyTerrainCorrection(m, c1, r1n, invM, invI);
  applyTerrainCorrection(m, c2, r2n, invM, invI);

  TBLK[0].jn = j1; TBLK[0].vn = vn1; TBLK[0].kn = k11; TBLK[0].e = e1; TBLK[0].rxn = r1n;
  TBLK[1].jn = j2; TBLK[1].vn = vn2; TBLK[1].kn = k22; TBLK[1].e = e2; TBLK[1].rxn = r2n;
  return TBLK;
}

// The one spelling of the terrain positional correction, shared by
// the sequential and block solvers (rCrossN arrives precomputed).
function applyTerrainCorrection(m, c, rCrossN, invM, invI) {
  const over = c.pen - CONFIG.penetrationSlop;
  const corr = over > 0 ? over * CONFIG.positionCorrection * c.corrShare : 0;
  if (corr > 0) {
    if (m.shape === 'poly' && UNIFIED_ACTIVE) {
      const k = invM + rCrossN * rCrossN * invI;
      const P = corr / k;
      m.x += P * c.nx * invM;
      m.y += P * c.ny * invM;
      m.angle += P * rCrossN * invI;
    } else {
      m.x += c.nx * corr;
      m.y += c.ny * corr;
    }
  }
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
  // Scaled by the contact's share of its manifold (P2-B): a flat face
  // returning two points must eject the body exactly as far as a
  // curve returning one, or a resting box climbs out of the ground.
  // corrShare is 1 for every smooth-body contact, so this is inert.
  const corr = Math.max(c.pen - CONFIG.penetrationSlop, 0)
    * CONFIG.positionCorrection * c.corrShare;
  if (corr > 0) {
    if (m.shape === 'poly' && UNIFIED_ACTIVE) {
      // THE ANGULAR POSITIONAL CORRECTION (PHASE-6 §8, 2026-08-29),
      // through the contact Jacobian as a pseudo-impulse. For a
      // sphere the contact lies on the line through the COM and there
      // is no angular term to miss; for a flat face there is — under
      // translation-only correction a cocked box could never be
      // un-cocked, sat at a permanent 0.28 deg, and its top face was
      // a ramp the box above drifted down (measured: exp-lean-probe,
      // 0.5 px/s^2 of friction leak until the half-width overhang at
      // ~16 s). This REDUCES EXACTLY to the translation law when the
      // lever vanishes: rCrossN = 0 gives k = invM, P = corr/invM,
      // dx = corr*nx.
      //
      // TWO GATES, both measured. Poly: the smooth families have
      // non-zero r x n too, so the general form would move racers —
      // the smooth cell is a recorded deferral (D5-1's shape).
      // UNIFIED_ACTIVE: on the legacy path this same arithmetic
      // CREEPS a lone resting box sideways — 5.30 px/60 s
      // mid-segment, 53.5 px on a seam (exp-restpose), the numbers
      // that got the first landing reverted — while inside the
      // unified pass it measures EXACT (exp-shelf: 0.00 px, 0.000
      // deg). Scoped to where it is right; the lone box keeps its
      // proven 0.27 px translation-only rest.
      const k = invM + rCrossN * rCrossN * invI;
      const P = corr / k;
      m.x += P * c.nx * invM;
      m.y += P * c.ny * invM;
      m.angle += P * rCrossN * invI;
    } else {
      m.x += c.nx * corr;
      m.y += c.ny * corr;
    }
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
  // PHASE-6: exported for verify-island's construction checks, which
  // are bypasses by design — the suite's REAL-DOOR sections go
  // through FF.step (integration-sibling law).
  buildPropIslands,
  _hopImpulse: hopImpulse, _supportRadius: supportRadius,
  _polyVsSegment: polyVsSegment, _makeContact: makeContact,
  _polyVsPoly: polyVsPoly, _pairRoute: pairRoute,
  _ellipseVsPolyPair: ellipseVsPolyPair,
  _ellipseVsSegment: ellipseVsSegment,
  _resolveEggPoly: resolveEggPoly, _resolveEggSmooth: resolveEggSmooth,
  _smoothSupportWorld: smoothSupportWorld, _eggSmoothPen: eggSmoothPen });
})();