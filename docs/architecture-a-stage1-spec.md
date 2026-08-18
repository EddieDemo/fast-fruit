# Architecture A — Stage 1 build spec

*Slab collision, canonical contact ordering, ribbon rendering, and the
headless race harness. Written 2026-08-17 at the end of the session
that shipped stage 0/0.5; implementation begins fresh. Design-approval
document per house rule: Eddie reviews, then we build.*

Ruled already: cross-terrace melon collisions are ON ("physics says
yes"). Stage 0/0.5 shipped: track-space strands + degenerate spine,
all progress consumers rewired with bit parity.

---

## 1. The slab model

A strand stops being a line the world hangs under and becomes a SLAB:
the strand polyline is the riding surface, extruded downward by a
thickness `SLAB_T` (proposal: 260 world px — deep enough that no melon
clips through at terminal velocity in one 120Hz step: max fall speed
bounded by drag; verify, don't assume) along the surface normal,
capped at the ends.

Collision faces per segment: TOP (rideable), BOTTOM (the underside —
clonkable, gives terraces headroom), END CAPS at strand extremities.
The melon-vs-slab test is the existing ellipse-vs-segment support
machinery applied per face; nothing about the contact solver changes,
only how many surfaces can propose contacts.

The heightfield fast path DIES here — `terrainYAt` remains only for
non-physics consumers (respawn placement, markers) until stage 2
replaces those with spine queries. Physics never calls it again.

## 2. Broadphase: the spatial hash

Uniform grid hash over world space, cell size = max(segment AABB) ~
512px. Segments inserted once per terrain rebuild (streaming prune =
remove + insert, already incremental). Query: melon AABB inflated by
max step displacement -> candidate faces.

LAW: hash iteration order must never influence results — candidates
are COLLECTED then SORTED (see 3) before narrowphase. The hash is an
accelerator, not an orderer.

## 3. THE CANONICAL CONTACT ORDER (the determinism law)

Multi-surface contact means several simultaneous impulses; float
resolution is order-dependent; unordered = ghosts and lockstep die
silently. The law:

  All contacts for a body in a step are resolved in the order
  (strandId, segmentIndex, face) ascending, with melon-melon
  contacts after terrain contacts, ordered by (racerKey a, racerKey b)
  lexicographic.

This is a LAW with a named suite (verify-contact-order): construct a
multi-contact scenario, permute hash insertion order, assert
bit-identical trajectories over 5000 steps.

## 4. Ribbon rendering

Fill-to-screen-bottom dies. Each strand renders as its slab polygon
(top polyline + offset bottom polyline, closed). Consequences to
carry:
- The terrain-grid clip clips per-slab.
- The tint debug pass tints per-slab columns (it already draws
  trapezoids; the bottom edge becomes the slab bottom, not screen
  bottom).
- The wall sentinel stays physics-only; it should NOT render as a
  slab (special-case id 0 or move it out of the point list — decide
  at build: moving it out is cleaner and stage 0's strand model
  gives it a natural home as its own tiny strand).

## 5. The headless race harness (verification infrastructure)

Stage 1 cannot ship on geometry checks; it needs raced outcomes.
Harness = node script loading dmath/config/terrain/tracks/strand/
state/physics/fruits/pilot/finishline/damage (no renderer, no DOM):

- `runRace(seed, roster, laps)` -> per-racer {finished, timeSec,
  deaths, maxImpact, path hash}
- Determinism double-run: identical path hashes.
- SWEEP: N seeds x current dialects -> pace distribution, death
  rates, stall detection (any racer with dProgress < epsilon for >
  10s that isn't dead = STUCK, a failure).
- Baseline capture BEFORE slab work on the pre-slab build; the slab
  build must reproduce pace/death distributions within tolerance on
  flat-equivalent tracks (slabs under a heightfield track are
  behaviorally identical if the top face matches — that IS the
  regression claim).

Known unknowns to resolve at build time (read, don't assume): whether
pilot.js brains need frame-rate context; whether finishline's clone
snapshot pattern survives headless; audio module guards.

## 6. Suite list for the stage

- verify-slab: face generation (top/bottom/caps), thickness, normals.
- verify-contact-order: the law in section 3.
- verify-hash: insertion-order independence, prune correctness.
- verify-harness: double-run determinism, stall detector self-test.
- SWEEP report: pace + deaths, pre/post comparison.

## 7. Explicitly out of scope for stage 1

Folds, pockets, reversed strands, semantic input, camera direction
(stage 2). Branches and spine intervals (stage 4). Falls-between
exists implicitly the moment slabs and cross-terrace collisions do,
but no generator word produces terraces yet — so it is unreachable
in stage 1 content, which is correct: physics first, content after.
