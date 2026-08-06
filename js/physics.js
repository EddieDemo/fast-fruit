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
//  * Contact resolution is sequential impulses with Coulomb friction
//    plus direct positional correction. Friction at the contact's
//    lever arm is what converts spin into forward motion — rolling
//    is emergent, not scripted.
//  * Determinism: only +,-,*,/ and sqrt/atan2/sin/cos on state that
//    starts identical. Good enough for consistent feel; ghosts will
//    be recorded positions, not re-simulation (per design).
// ============================================================

const { CONFIG, melonInertia } = window.FF;
const { snapshotPrev } = window.FF;

// Scratch object reused every contact test to avoid GC churn.
const contact = {
  hit: false,
  px: 0, py: 0,   // contact point (on segment), world
  nx: 0, ny: 0,   // contact normal, world, pointing INTO the melon
  pen: 0,         // penetration depth along normal (px)
};

function step(state, dt) {
  snapshotPrev(state);
  state.tick++;

  const m = state.melon;
  const I = melonInertia();
  const invM = 1 / CONFIG.mass;
  const invI = 1 / I;

  // ---- 1. Input smoothing (ease torqueAxis toward rawAxis) ----
  const inp = state.input;
  const ease = Math.min(1, CONFIG.inputResponse * dt);
  inp.torqueAxis += (inp.rawAxis - inp.torqueAxis) * ease;

  // ---- 2. Motor torque ----
  // Electric-motor curve: full torque from standstill, tapering to zero
  // as spin approaches maxAngVel in the driven direction. Driving
  // AGAINST current spin (braking / reversing) gets a boost — this is
  // what makes backspin-to-brake feel authoritative.
  const axis = inp.torqueAxis;
  if (axis !== 0) {
    let torque;
    const sameDir = axis * m.omega > 0;
    if (sameDir) {
      const headroom = Math.max(0, 1 - Math.abs(m.omega) / CONFIG.maxAngVel);
      torque = axis * CONFIG.motorTorque * headroom;
    } else {
      torque = axis * CONFIG.motorTorque * CONFIG.brakeBoost;
    }
    if (!state.telemetry.grounded) torque *= CONFIG.airTorqueScale;
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
  const wasGrounded = state.telemetry.grounded;
  let grounded = false;
  let strongestImpulse = 0;
  let impactNormalAngle = 0;
  let impactVn = 0;

  for (let iter = 0; iter < CONFIG.solverIterations; iter++) {
    for (const poly of state.terrain) {
      for (let i = 0; i < poly.length - 1; i++) {
        ellipseVsSegment(m, poly[i], poly[i + 1], contact);
        if (!contact.hit) continue;
        grounded = true;

        const applied = resolveContact(m, contact, invM, invI);
        if (applied.jn > strongestImpulse) {
          strongestImpulse = applied.jn;
          impactNormalAngle = Math.atan2(contact.ny, contact.nx);
          impactVn = applied.vn;
        }
      }
    }
  }

  // ---- 6. Telemetry & FX events ----
  state.telemetry.grounded = grounded;

  // A "landing" = airborne last step, meaningful impact this step.
  if (grounded && !wasGrounded && impactVn < -CONFIG.restitutionThreshold) {
    state.telemetry.lastImpactVn = -impactVn; // report as positive speed
    state.telemetry.lastImpactTick = state.tick;
  }

  // Squash is an FX event sourced from physics but never read back.
  if (strongestImpulse > 0) {
    const squash = Math.min(0.3, strongestImpulse * CONFIG.squashStrength);
    if (squash > state.fx.squash) {
      state.fx.squash = squash;
      state.fx.squashAngle = impactNormalAngle;
    }
  }
}

// ------------------------------------------------------------
// Ellipse vs segment. Writes result into `out` scratch object.
// ------------------------------------------------------------
function ellipseVsSegment(m, A, B, out) {
  out.hit = false;

  const a = CONFIG.semiMajor;
  const b = CONFIG.semiMinor;
  const s = a / b; // local y-scale that turns the ellipse into a circle radius a

  const cos = Math.cos(m.angle);
  const sin = Math.sin(m.angle);

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
  let jn = 0;
  if (vn < 0) {
    const e = -vn > CONFIG.restitutionThreshold ? CONFIG.restitution : 0;
    const rCrossN = rx * c.ny - ry * c.nx;
    const kn = invM + rCrossN * rCrossN * invI;
    jn = (-(1 + e) * vn) / kn;
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

  return { jn, vn };
}

Object.assign(window.FF, { step });
})();
