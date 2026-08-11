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

const { CONFIG, melonInertia, terrainYAt, segStartIndex, debris, dmath, damage } = window.FF;
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
      stepBody(pl.melon, pl.input, state.terrain, dt, i === state.localSlot ? state : null);
    }
  }
  for (const b of state.bots) {
    if (b.melon.alive) stepBody(b.melon, b.input, state.terrain, dt, null);
  }

  // ---- Melon-vs-melon contacts (living bodies only) ----

  bodyList.length = 0;
  for (const pl of state.players) if (pl.melon.alive) bodyList.push(pl.melon);
  for (const b of state.bots) if (b.melon.alive) bodyList.push(b.melon);
  for (const m of bodyList) m.pairSeverity = 0;
  if (bodyList.length > 1) {
    const PAIR_ITERS = 3;
    const period = state.period; // set in track mode, null in endless
    for (let iter = 0; iter < PAIR_ITERS; iter++) {
      for (let i = 0; i < bodyList.length; i++) {
        for (let j = i + 1; j < bodyList.length; j++) {
          resolveMelonPair(bodyList[i], bodyList[j], period);
        }
      }
    }
  }

  // ---- Smash resolution: one rule for everyone ----
  for (let i = 0; i < state.players.length; i++) {
    applySmashRule(state.players[i].melon, state, tick, i === state.localSlot, i);
  }
  for (let i = 0; i < state.bots.length; i++) {
    // Bots race by the SAME rules and the same throttle as the player:
    // hold right, forever — the air pump included (spinning up mid-
    // flight to convert into speed on landing). An earlier policy
    // braked them out of over-rev; it also locked them out of the
    // game's central speed mechanic and handed the player a structural
    // 43% pace advantage. Deaths are the honest price of that speed.
    state.bots[i].input.rawAxis = 1;
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

function applySmashRule(m, state, tick, isPlayer, bodyIndex) {
  if (!m.alive) return;
  const sev = Math.max(m.hitSeverity, m.pairSeverity);
  if (tick <= m.protectTick || sev <= 0) return;
  // Per-body threshold: rind strength scales with size^k (mass ratio
  // is s^3, so T scales by mr^(k/3)). Pinned dpow: lockstep-safe.
  const mr = 1 / (m.invM * CONFIG.mass); // mass ratio = s^3; 1.0 for the player
  const T = CONFIG.smashThreshold * (mr === 1 ? 1 : dpow(mr, CONFIG.sizeToughness / 3));
  if (sev >= T) {
    // Burst BEFORE clearing the body: fragments inherit its velocity
    // field (v + w x r) at the instant of death.
    debris.spawnFromBody(m, state, tick, bodyIndex);
    m.alive = false;
    m.respawnAtTick = tick + CONFIG.respawnDelayTicks;
    if (isPlayer) {
      // Death certificate for the presentation layer (same per-peer
      // divergence license as fx: sim never reads it).
      state.lastDeath = {
        tick,
        name: m.name || '',
        byPair: m.pairSeverity >= m.hitSeverity,
        severity: sev,
        curvR: m.lastHitCurvR || 1,
        rFlat: (m.a * m.a) / m.b,
        vn: Math.abs(state.telemetry.lastImpactVn || 0),
        speed: Math.sqrt(m.vx * m.vx + m.vy * m.vy),
      };
    }
  } else if (isPlayer && sev >= T * NEAR_MISS_RATIO) {
    state.fx.flash = 1; // near-miss: teach the envelope
  }
}

const RESPAWN_DROP = 200; // 2m above the surface; the melon falls back in

function reviveIfDue(m, state, tick) {
  if (m.alive || tick < m.respawnAtTick) return;
  const wy = terrainYAt(state.terrain, m.x);
  m.alive = true;
  // 200px falls in ~0.41s arriving at ~9.8 m/s flat-side — well inside
  // the safe envelope, and spawn protection covers the landing anyway.
  m.y = (wy === null ? m.y : wy - m.b - RESPAWN_DROP);
  m.vx = 0; m.vy = 0; m.omega = 0;
  m.angle = 0;            // flat side down
  m.grounded = false;
  m.hitSeverity = 0;
  m.pairSeverity = 0;
  m.protectTick = tick + CONFIG.spawnProtectTicks;
}

// Reused list to avoid per-step allocation.
const bodyList = [];

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

// Curvature radius of a melon's surface at the point facing world
// direction (nx, ny) — the melon-vs-melon analogue of contact.curvR.
function curvAtDirection(m, nx, ny) {
  const c = dcos(m.angle), s = dsin(m.angle);
  const bx = nx * c + ny * s;
  const by = -nx * s + ny * c;
  const a = m.a, b = m.b;
  if (m.taper) {
    const t = eggRadialT(m, bx, by);
    return eggCurvR(m, dcos(t), dsin(t));
  }
  const r = (a * b) / Math.sqrt(b * b * bx * bx + a * a * by * by);
  const u = (r * bx) / a;   // cos t at the surface point
  const v = (r * by) / b;   // sin t
  const q = a * a * v * v + b * b * u * u;
  return (q * Math.sqrt(q)) / (a * b);
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
    const sevA = damage.severityFromE(shA * E, curvAtDirection(A, nx, ny), A);
    const sevB = damage.severityFromE(shB * E, curvAtDirection(B, -nx, -ny), B);
    if (sevA > A.pairSeverity) { A.pairSeverity = sevA; A.pairNx = -nx; A.pairNy = -ny; A.pairJn = jn; }
    if (sevB > B.pairSeverity) { B.pairSeverity = sevB; B.pairNx = nx; B.pairNy = ny; B.pairJn = jn; }
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
    const maxJt = CONFIG.friction * jn;
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
}

// Advance one body. `sink` is the state object for the PLAYER body
// (receives telemetry + fx events) and null for ghosts — ghosts must
// never write player-facing telemetry or visual squash.
// Grounded-ness lives ON the body (m.grounded) so each body's motor
// sees its own contact status.
function stepBody(m, inp, terrain, dt, sink) {
  const invM = m.invM;
  const invI = m.invI;

  // ---- 1. Input smoothing (ease torqueAxis toward rawAxis) ----
  const ease = Math.min(1, CONFIG.inputResponse * dt);
  inp.torqueAxis += (inp.rawAxis - inp.torqueAxis) * ease;
  // The flare axis smooths identically, then maps onto the body's
  // restitution through the damage law. UNIFORM: bots hold rawBounce
  // 0 forever, which maps to exactly the live CONFIG restitution —
  // full throttle at neutral bounce, no special case (Eddie's spec).
  inp.bounceAxis += ((inp.rawBounce || 0) - inp.bounceAxis) * ease;
  m.restitution = damage.bounceToRestitution(inp.bounceAxis);

  // ---- 2. Motor torque ----
  // Electric-motor curve: full torque from standstill, tapering to zero
  // as spin approaches maxAngVel in the driven direction. Driving
  // AGAINST current spin (braking / reversing) gets a boost — this is
  // what makes backspin-to-brake feel authoritative.
  const axis = inp.torqueAxis;
  if (axis !== 0) {
    let torque;
    // ENGINE SCALING: bigger fruit, bigger engine. Motor torque scales
    // as I/r (i.e. s^4), which makes LINEAR acceleration size-neutral:
    // torque * invI * r = const. Without this, angular accel inherits
    // the full s^-5 and the whopper is a freight train (tournament-
    // measured: -49% distance even with deaths equalized). Player at
    // scale 1.0: engineK is exactly 1. Pinned ops only.
    const sRatio = m.a / CONFIG.semiMajor;
    const engineK = sRatio === 1 ? 1 : dpow(sRatio, CONFIG.sizeEngineExp);
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

  // ---- 5. Collide & resolve ----
  const wasGrounded = m.grounded;
  let grounded = false;
  let strongestE = 0;
  let strongestCurvR = 1;
  let impactNormalAngle = 0;
  let impactVn = 0;
  m.hitSeverity = 0;

  // Broad phase: only segments near the melon can touch it. Terrain
  // points are x-sorted, so binary-search the window start instead of
  // scanning every segment (matters with long streamed polylines).
  const cullR = CONFIG.semiMajor * 1.08 + 80; // headroom for size-varied bots
  for (let iter = 0; iter < CONFIG.solverIterations; iter++) {
    for (const poly of terrain) {
      const startIdx = segStartIndex(poly, m.x - cullR);
      for (let i = startIdx; i < poly.length - 1; i++) {
        const A = poly[i], B = poly[i + 1];
        if (A.x > m.x + cullR) break;
        if (B.x < m.x - cullR) continue;
        if (m.taper) eggVsSegment(m, A, B, contact);
        else ellipseVsSegment(m, A, B, contact);
        if (!contact.hit) continue;
        grounded = true;

        const applied = resolveContact(m, contact, invM, invI);
        // The tick's defining blow is the one that DISSIPATED the most
        // energy (the damage law's currency), not the biggest impulse.
        const ev = damage.dissipated(applied.vn, applied.kn, applied.e);
        if (ev > strongestE) {
          strongestE = ev;
          strongestCurvR = contact.curvR;
          impactNormalAngle = Math.atan2(contact.ny, contact.nx);
          impactVn = applied.vn;
          // Escape direction of the blow (away from the ground) —
          // pinned ops only: the debris burst aims along this, so it
          // must be deterministic (Math.atan2 above is telemetry-only).
          m.hitNx = contact.nx;
          m.hitNy = contact.ny;
          m.hitJn = applied.jn; // raw impulse: severity decides death, impulse decides drama
        }
        m.lastHitCurvR = contact.curvR; // death-certificate breadcrumb
      }
    }
  }
  m.grounded = grounded;
  m.airTicks = grounded ? 0 : (m.airTicks || 0) + 1;
  if (strongestE > 0) {
    m.hitSeverity = damage.severityFromE(strongestE, strongestCurvR, m);

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
  let jn = 0, knOut = 0, eOut = 0;
  if (vn < 0) {
    const e = -vn > CONFIG.restitutionThreshold ? damage.bodyRestitution(m) : 0;
    const rCrossN = rx * c.ny - ry * c.nx;
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

  return { jn, vn, kn: knOut, e: eOut };
}

Object.assign(window.FF, { step });
})();