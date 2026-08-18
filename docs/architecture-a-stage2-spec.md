# Architecture A — Stage 2 build spec

*Spine surface queries (the death of terrainYAt), semantic input,
camera direction, and the CHECK-MARK PIT (gap word v2). Written
2026-08-17 after stage 1 shipped with bit identity. Design-approval
document per house rule: Eddie reviews, then we build.*

Ruled already (2026-08-17): the pit becomes ESCAPABLE in stage 2; the
DRAIN ALLEY (the under-ramp strand that rejoins downstream) is
earmarked as the flagship first branch word of stage 4 — it needs
spine intervals and is exactly the content stages 2–4 exist to make
expressible. The true egg collider stays parked until Eddie calls it.

---

## 1. Spine surface queries: terrainYAt dies

The last heightfield fossils. `terrainYAt(terrain, x)` answers "the
ground under world x", which has exactly one answer only while
strands are x-monotone — the moment a fold arrives (stage 3) it
becomes a lie with a return value. Stage 2 replaces it BEFORE the
geometry that breaks it exists, so stage 3 changes tables, not
consumers.

The API, on the spine:

    spine.surfaceAt(s) -> { x, y, tx, ty }   // world point + unit tangent
    spine.progressOf(body) -> s               // exists since stage 0

DEGENERATE CONTRACT (the same move as stage 0): today's spine
implements `surfaceAt(s)` as the surface at world x = startX + s —
bit-identical to every `terrainYAt(terrain, wx)` expression it
replaces, so the whole consumer rewiring is a pure refactor with
provable parity, held by suite (verify-spine-parity: N random s
across the sweep dialects, old expression vs new query, exact
equality). When folds arrive, only the table behind the query
changes.

The consumers (the mapped set — enumerate again at build, this list
is from today's grep):
- physics.js reviveIfDue (respawn placement)
- state.js gridPlace (grid placement)
- renderer.js markers, nameplates, shadow ray-march, ground probes
- ghost.js surface anchoring (two sites)
- debris.js spawn placement

After this stage `terrainYAt` is deleted, not deprecated — a helper
that still exists is a helper someone will call.

## 2. Semantic input

The stick stops meaning "+x" and starts meaning FORWARD. `axis`
becomes spin toward the spine's travel direction at the body's
position: motor torque is multiplied by the local strand `dir`.

Degenerate contract: one strand, dir +1, multiplier is the literal
constant 1 — bit-identical. This stage lays the plumbing (the body's
motor asks its strand for dir); reversed strands that make the
multiplier −1 arrive with folds in stage 3 and land on wiring that
already exists.

## 3. Camera direction

Presentation tier only. The camera orients along the spine tangent at
its focus position (smoothed, renderer-owned, never read by the sim).
Degenerate case: tangent is horizontal, rotation is identity, every
frame renders as today. The pre-race grid walk keeps its own framing
and is untouched.

## 4. THE CHECK-MARK PIT (gap word v2)

THE BUG (harness finding, 2026-08-17): the gap pit is survivable-and-
inescapable. A melon slowed by traffic dribbles in gently, lives, and
parks — the V's exit wall (~3.9 grade) is unclimbable from a
standstill. Measured: whole-field parks on ~4 of 12 sweep dialects,
80+ seconds on seed 7101. A stall is a soft-lock, and a soft-lock is
a failure whatever the death economy says.

THE FIX: the V becomes a CHECK-MARK. Entry side stays a steep drop —
close under the launch lip, so a failed jump still falls far and
arrives hard. The exit side becomes a long shallow GRIND RAMP rising
from the floor to the receiving lip: escapable from a standstill,
slowly — the punishment for falling short is the climb, not the
race ending.

### 4a. The grind-grade law (uniform, derived, no per-pit fudge)

    Every pit exit grade <= G_GRIND, where G_GRIND is the MEASURED
    standstill-climbable grade, with margin.

BUILD STEP 1 IS THE MEASUREMENT, not a guess: a headless rig parks
each body size of the cast envelope on a slope at zero speed, holds
full throttle, and bisects the steepest grade that escapes. Engine
scaling (s^4 torque vs s^3 gravity load over s^1 radius) should make
this near size-neutral by the same law that made linear acceleration
size-neutral — verify, take the worst body, apply margin (proposal:
G_GRIND = 0.8 × measured). The kicker note's calibration says 0.90 is
unclimbable; the answer lives somewhere below that, and the config's
gravity-barrier arithmetic (motorTorque 75000 vs the ~18000 floor)
suggests comfortably above the 0.35 slope envelope. The number is an
output of the rig, pinned in the spec amendment at build.

### 4b. Geometry, inside the x-monotone constraint

Stage 2 strands are still x-monotone (folds are stage 3), so the
grind ramp's horizontal run must fit INSIDE the lip-to-lip span —
which caps how deep an escapable pit can be:

    exitRun  ~ 0.75 × gapLen        (entry wall + floor take the rest)
    pitBelow <= G_GRIND × exitRun   (depth becomes the DERIVED quantity)

Consequences, argued rather than hidden:
- LIP-TO-LIP CLEARANCE IS UNCHANGED. The jumper's exam (speed to
  clear gapLen) does not move; only what lies under the flight path
  changes.
- LETHALITY MOVES TO THE FALL, WHERE IT ALWAYS REALLY WAS. The
  fatal quantity for a failed fast jump is the drop from the LAUNCH
  LIP to what it hits (lip height easeRise+rise above the chunk,
  plus drop, plus pit depth): ~430+ px against the 400 px tip-first
  calibration marginal — fast failures still die to the arrival, on
  the steep entry wall or the floor. Slow dribbles survive and
  grind. That is the honest physics reading of "severe-to-fatal":
  severity follows energy, and a slow faller never had the energy.
- THE DEATH-ECONOMY SWEEP is the judge, not this argument: gap
  deaths must stay material for fast failures (compare per-chunk
  death attribution pre/post), stalls must go to ZERO across the
  full sweep.

### 4c. Suite: verify-grind

- Escape law: a melon parked at the pit floor at zero speed, full
  throttle, escapes within a budget (proposal: 8 s) across the whole
  recipe envelope × the cast's size envelope.
- Geometry laws: x strictly increasing; exit grade <= G_GRIND on
  3000 plans; net-downhill re-verified (the exit run lengthens the
  chunk — the closing arithmetic must carry it); receiving lip
  exactly `drop` below launch, as ever.
- SWEEP: full re-run. Expect ZERO stalls, finish rate 144/144 or a
  named explanation per exception, pace/death distributions compared
  against a fresh post-pit baseline (the stage 1 baseline retires —
  see 4d).

### 4d. Versioning

A generator change breaks recorded ghosts: this is terrain v3.
Pre-launch that costs nothing (the v2 rule, restated); the stage 1
sweep baseline is superseded by a new capture the moment the pit
ships, and stage 2's OTHER work (spine queries, semantic input) must
be bit-identical against whichever baseline is current — land the
refactors and the pit as separate commits so parity is provable for
the refactors alone.

## 5. Suite list for the stage

- verify-spine-parity: old expression vs surfaceAt, exact, all
  consumers' call shapes.
- verify-grind: 4c above.
- verify-terrain: gap sections (F) amended to the check-mark laws.
- Full existing battery re-run (the stage 1 suites now guard the
  slab world through this refactor).
- SWEEP: refactor capture (bit-identical to current baseline), then
  post-pit capture (the new baseline).

## 6. Known unknowns to resolve at build time (read, don't assume)

- The full terrainYAt consumer list (grep again; boards.js reads
  polylines directly and may be fine as-is).
- Whether the shadow ray-march wants surfaceAt(s) or a short local
  segment walk (it probes several x around a body).
- G_GRIND (the measurement IS the answer).
- Whether escape budget interacts with spawn protection (a grinder
  should not be re-protected into immortality mid-climb).

## 7. Explicitly out of scope for stage 2

Folds, reversed strands, metric arc length (stage 3). Branches,
spine intervals, THE DRAIN ALLEY (stage 4 — earmarked, ruled).
The true egg collider (parked until called). The pack-spacing
grammar idea (rejected in favour of the check-mark: it treats the
symptom and cannot guarantee absence of pile-ups).

---

## AMENDMENT AT BUILD (2026-08-17, stage 2 shipped)

Pinned per §4a: the standstill-climbable grade measured 0.634 at the
cast's worst body (0.68 effective scale — 0.85 scale x 0.80 sizeMult;
engine scaling's s^4-vs-s^3 makes BIGGER bodies slightly better
climbers, so the runt binds). **G_GRIND = 0.50** (0.8x, rounded down);
provenance re-measured by verify-grind on every run. Check-mark
fractions: entry 0.20 / floor 0.08 / exit 0.72 of gapLen.

Sweep verdict (baseline-v3 vs pre-pit V, same instrumentation):
gap stalls 32 -> ZERO; total latched stalls 43 -> 11; finishes
111 -> 142 of 144; deaths 866 -> 878 (kind mix stable — the V was
never a killer: 3 gap deaths in the whole pre-pit sweep; it was a
parking lot). Refactor commit (spine queries, semantic-input and
camera plumbing) landed separately with BIT IDENTITY against the
stage 1 baseline, as required.

NAMED EXCEPTION (§4c's "zero or named"): the 11 remaining stalls are
a DISTINCT, PRE-EXISTING class — respawn-parks. A body that dies on a
kicker face or inside a roller train respawns AT ITS DEATH X at zero
speed, and local grades there (kicker ramps to 0.90, roller bump
walls to ~1.5) exceed the standstill-climbable 0.634 — it oscillates
until pack traffic frees it (9 of 11 finished; 2 DNFs in 24 races).
PROPOSED RULING, not built (design approval first): respawn placement
walks BACK from the death x to the nearest spot whose local grade is
<= G_GRIND — the same measured constant, a uniform law, no per-spot
fudge. Changes race outcomes, so it mints a fresh baseline.
