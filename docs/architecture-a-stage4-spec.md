# Architecture A — Stage 4: Branches, Spine Intervals, and the Drain

**Status: built, verified, swept (2026-08-17). Terrain v5.**

Stage 0 sketched a track as a directed graph of strands and left the
strand→interval mapping empty. This stage fills it — and the payoff
of stage 3's arc annotation is that the mapping needs almost no new
machinery: **a branch is an s-annotated polyline**, and projection,
progress, semantic input, markers, rendering, and physics all consume
it through the same paths as the primary strand, with no special
cases. The flagship content is the DRAIN — Eddie's alleyway
screenshot, ruled and earmarked at stage 1's close.

Also in this stage, ruled first: **the camera never rotates.**
Gravity-down is a permanent invariant of the presentation; direction
changes are a horizontal framing question answered by the forward-bias
flip. The stage-2 tangent-rotation machinery is deleted, not dormant.

---

## 1. Multi-strand plumbing (behavior-neutral commit)

The generator and lap cursor carry `branches`: side strands emitted by
words. Endless streams them (`gen.branches`, pruned whole — a branch
is a small finite structure; splicing interiors would move caps, and
caps are collision faces). The track provider tiles them once per
period with the same `(pL, pD, p·lapArc)` offsets as the primary — the
s-anchor law survives tiling because branch s and anchor s shift
together. `provider.polys()` returns primary first, then wall/branches:
**first-poly-wins makes the primary canonical** for `surfaceAt` over
overlapped spine intervals.

Verified bit-neutral: with no word emitting branches, race path hashes
match baseline-v5 exactly.

## 2. THE S-ANCHOR LAW (spine intervals, v1)

A branch's points carry SPINE s, anchored at its **exit**: the last
point's s equals the primary arc directly beneath/at its rejoin locus,
unit arc rate backwards from there. Consequences:

* Progress is **continuous at the exit** — the whole point. A body
  rolling off the bridge's cap lands on floor whose s matches within
  a body-length.
* The **entry** side is a priced skip: flying from the launch lip onto
  the bridge jumps s by the pit descent the jumper never made —
  exactly the switchback express's semantics, now between strands.
* Vertically stacked routes carry nearly equal s everywhere (unit
  rate, shared anchor), so standings comparisons across routes are
  honest without any fairness machinery.

One noted artifact: mid-air over the pit mouth, the projection foot
legitimately alternates between routes (~500 s apart) until the fall
resolves the ambiguity — sub-second standings flicker, bound to
flights only; the continuity law binds to **feet** (dist < body
reach), held by suite.

## 3. THE DRAINED GAP (gap word v3, terrain v5)

A track speaks its gaps WALLED (the stage-2 check-mark, unchanged) or
DRAINED — a dialect flag (`rec.gapDrained`, ~half of tracks), because
a track is about its words.

**The drained ruling, wedge theorem applied.** The alley does not
climb back to the line: a floor rejoining tangentially from below
would spend its last ~SLAB_T/grade px sealed inside the bridge's slab
(stage 3's wedge, again). So **the pit floor IS the track's
continuing line** — the canyon floor — and the landing ramp becomes a
BRIDGE: a branch strand entered by flight, exited off its cap with a
one-clearance drop (vn ≈ 1450, flare-able — the toll for the high
line). Both routes end on the floor. No wedge exists anywhere, and
the drained pit needs **no G_GRIND coupling at all** — there is
nothing to climb, so the stall class cannot exist in it.

Laws carried in the plan:
* **Clearance, derived**: `pitDeep = 420 + bridgeDy + extDy + rr(0,40)`
  — headroom under the whole descending bridge ≥ SLAB_T + 160, the
  same derived-not-tuned move as the walled pit's `pitBelow`.
* **Lethality restored**: the fall from the launch lip is
  `drop + pitDeep` ≥ ~480 px — fast failures die to the arrival
  again (sweep: gap deaths 9 → 19), slow ones survive by energy and
  drive out. The drain is what makes deep honest.
* **Net-downhill by arithmetic**: pitDeep (≥ 420) always exceeds the
  launch climb (≤ ~333), so the drained chunk nets down
  unconditionally — held across 3000 plans.

No route-choice AI was needed: the drain is a **consequence-branch**
(you enter the alley by falling, the bridge by clearing), so bot
brains are untouched. Choice-branches (true forks) are stage 5
content on this same machinery.

## 4. What needed no changes at all

Physics (the slab world already collides every strand; the bridge's
underside is the alley's ceiling — stage 1's bottom faces, again),
projection (annotated faces, canonical tie-breaks), cross-strand pair
collisions (ruled ON at stage 1), semantic input, markers, lap logic,
racewatch, the renderer (draws all non-wall slabs; primary first,
branches over — the nearer surface paints last). This section exists
because it is the architecture's report card.

One documented v1 simplification: `respawnPointBehind` walks the
s-containing polyline, which for overlapped intervals is the primary
— a body dying ON the bridge respawns on the floor beneath, losing
the high line. Honest as a price, cheap as code; a face-owned walk is
a stage-5 refinement if it ever matters.

## 5. Verification

* **verify-branch** (new): the s-anchor law, the clearance law, and
  net-downhill across 3000 plans; both routes traversed in sim (the
  slow line brakes on the flat — the ramp needs momentum — falls,
  and drives the canyon under the bridge; the fast line clears,
  rides the bridge, drops the cap) with progress continuity bound to
  feet; the ceiling clonk; jumper double-run bit-identity; per-period
  tiling with exact lapArc offsets; projection ownership.
* Amended: verify-terrain F scoped to walled dialects; verify-harness
  B re-picked for v5.
* Full battery green (13 suites).

## 6. Baseline

**baseline-v6**: 144/144 finished, **0 DNF**, 791 deaths, meanT
102.6. 7/12 dialects speak drained gaps; deaths by kind: flat 414,
roller 181, slope 111, kicker 63, gap 19, sw 1. All 13 stall latches
transient (every racer finished); seed 2415419882 drew a brutal
kicker envelope under the v5 re-dialect — named, not masked.

## 7. Named deferrals

* Choice-branches + the strand-owned respawn walk (stage 5).
* Ridden ceilings / material-above (pockets) — explicit material-law
  amendment when they arrive.
* The egg collider stays parked (Eddie).
