# Architecture A — Stage 3: The Metric Spine and the First Fold

**Status: built, verified, swept (2026-08-17). Terrain v4.**

Stage 2 promised that `surfaceAt(s)`'s parameter would become real arc
length "when the geometry demands it." The switchback demands it. This
stage moves the track's parameterization from x to arc, gives the slab
world a projection oracle, teaches every consumer to ask surface
questions with a reference point instead of assuming "the ground under
x" is single-valued, and speaks the first fold word. Bit-identity with
stage 2 formally ends here, as scheduled: a lap is now a lap of arc.

---

## 1. The monotone law moved (terrain v4)

Every generated point carries `s`, its cumulative arc length from the
generation origin — maintained at the single append point in the
generator and the shared cursor, carried through the lap template tiler
(`s = template.s + p · lapArc`), and re-anchored at the template's two
forced-exact closure overwrites. **x-monotonicity is dead; s-monotonicity
is law** (verify-terrain H now states it). The wall strand carries no
arc: it is never a riding surface, and projection skips it.

`provider.lapArc` (the template's total arc) replaces `period.L` as the
lap unit everywhere progress is measured: `race.lapLengthPx`, finish
targets, splits, the HUD's lap position, marker labels. Arc runs longer
than x on every slope, so a "400 m" lap reads as its true ridden length
now — the odometer stopped lying.

## 2. The projection oracle (slab.js)

`world.project(x, y)` → `{ s, x, y, dirX, dist }`: the closest
riding-surface foot to a world point. Expanding-ring hash query (fixed
schedule, 1–5 cells), s-annotated top faces only, canonical tie-break
on equal distance, early stop when a hit lies strictly inside the
ring. Deterministic by construction; verify-spine-parity D holds it
bit-identical across builds. `dirX` is the point-order travel sign at
the foot — the single source both semantic input and the camera's
forward bias read.

Top faces carry `s0/s1` interpolated from their endpoints; bottom
faces, caps, and walls carry NaN and are invisible to projection.

## 3. The metric spine (strand.js)

Same API shape as stage 0, new table behind it:

* `progressOf(body)` — projected arc. Fallback for a body beyond every
  ring (off the playable window): the old `x − startX` expression.
  The bare-spine fallback (no terrain) is bit-identical to the
  degenerate contract — verify-strand D holds it.
* `surfaceAt(s)` — binary search over s-annotated polylines; returns
  the world point **and true tangent** (which may point −x).
* `projectPoint(x, y)` — delegates to the oracle. **Every x-keyed
  surface question now carries a reference y**: under a fold "the
  ground under x" is multivalued, and the projection foot nearest the
  asker picks the deck they mean. Rewired: respawn placement, grid
  placement, nameplates, shadows, stains, ghost anchors.
* `respawnPointBehind` — the respawn-walk law (commit A, ruled
  2026-08-17) rewritten in s-space: parity clause for climbable
  deaths, stretch-scan skipping trap ledges (< 320 px), 420 px
  run-up, 2000 px cap. Climbability is judged in travel
  (−dy per |dx| along point order), so the walk is correct on a
  reversed deck, where "behind" means +x.

## 4. The material-side law (slab.js)

The solid is on the **gravity-down** side of the riding line,
regardless of point order. Per-segment normals flip to ny > 0;
near-vertical segments take the previous segment's orientation by
continuity. For every x-monotone strand the flip never fires — the
geometry is byte-identical to stage 1. True ridden ceilings (material
above) arrive with pockets and will be an explicit amendment here.
verify-slab B states the law independently: material never extrudes
upward except across near-vertical faces.

Debris moved with it: fragments query the slab world (the x-sorted
`segStartIndex` broadphase assumed monotone points), gaining honest
bounces off deck undersides and caps; the tunnel rescue is gated to
riding faces.

## 5. THE SWITCHBACK — the stop-and-drop ruling

Three stacked decks: A climbs gently to a lip, B runs backward beneath
it, C runs forward beneath both. Net-downhill by two clearances.
Clearance law: deck separation ≥ SLAB_T + 160 everywhere decks
overlap; the upper slab's bottom is a live ceiling, clonkable by
design (verify-fold D).

**The ruling, earned empirically.** Three catch designs (a 70 px hook
window, a chute-and-berm, a 120 px drop face) were built and disproven
by their own traversal traces before this settled. The theorem they
kept proving: *in this engine — gravity holds every rider on top, and
point order is travel order — any ridable connector between a forward
deck and a reversed deck re-launches a forward-driving body off its
far edge, and near-vertical faces can move the strand only tens of px.
A reversed deck is entered exactly one way: by braking.* The word
embraces that:

* **The fold line is a precision stop.** Brake to a crawl (≲ 50 px/s),
  pivot off the lip. The drop face **undercuts** (−10 px lean): a
  crawling tipper pivots around the lip vertex and the along-face
  pull of gravity feeds it *toward* B — the face is a funnel, not a
  launcher (the +x-leaning variant measurably rim-launched every
  tipper past the apron; the sign of the lean is the entire
  mechanism). The pivot can lodge a body in the niche between deck
  A's slab bottom and the face; semantic forward spins it down and
  out. Input discipline, verified as the suite's scripted line:
  brake, tip, **release through the fall** (throttle against the face
  rim-kicks past the apron), drive when the world reads reversed and
  grounded.
* **The priced express, open on purpose.** Carry speed off the lip and
  the arc clears everything — a two-clearance fall onto C, vn ≈ 2078
  at neutral against smash 2200: a damage tax, rarely a death.
  Cruise-brained bots never brake, so **bots ride the express**; the
  sweep confirms the toll (2 sw deaths in 144 races). Landing short
  off B's left lip drifts −x into generous headroom; drifting out
  from under B's mitred edge is the sandwich corridor the ceiling
  law advertises.
* Deck A's small climb (gAup 0.01–0.04) bleeds momentum-grammar
  arrival speed, so the stop is biddable and the express is a choice.

Recipe: `sw` weight drawn like gap (45 % of dialects speak it, weight
0.02–0.08); grammar treats it as a set piece (slope/roller before).
Renderer tint `#343c46` — toward blue: the fold.

## 6. Semantic input is live

The motor's travel sign comes from projecting the body
(`world.project(...).dirX`) — +1 on every monotone strand (identical
behaviour), −1 on a reversed deck, where holding forward spins the
body toward −x. verify-fold E: parked on deck B, forward moves x down
and s up. Bots reverse emergently: a lander holding semantic forward
brakes and turns without knowing the word exists.

## 7. Camera direction v1 — and the rotation deferral

Forward-bias follows travel: the look-ahead margin flips with the
smoothed projected `dirX` at the focus, so the camera keeps showing
where the player is going through a fold. **Rotation stays exactly 0,
deliberately**: orienting along the raw tangent turns a reversed
deck's (−1, g) tangent into a ~180° roll — an upside-down world — so
tangent-rotation is ill-defined without a gravity-up constraint.
That treatment is a design ruling with a screenshot gate (Eddie),
parked for the polish pass; the application machinery stays plumbed
and dormant.

## 8. Presentation moved to arc

Distance markers live at 200-arc stops ON the strand (every boundary
inside a segment gets its interpolated world point — under a
switchback all three decks carry their own stops). Lap posts stand at
arc multiples via `surfaceAt(k · lapArc)`. The coarse ghost rides
`surfaceAt(dist)` directly (`worldXAt` died with the x
parameterization). Stains project with the burst point's y.

## 9. Verification

* **verify-fold** (new): geometry + clearance, material side both
  directions, the scripted fold line (brake/tip/release/drive) exits
  reversed, progress net-increases, ceiling clonk, reversed drive,
  double-run bit-identity, and the express is real (full-speed entry
  clears the fold, lip speed 1109).
* **verify-spine-parity** (rewritten): 15 000 round-trips across 6
  dialects, exact arc annotations, flat-strand x-parity, projection
  determinism, grid placement.
* **verify-respawn** (new, commit A): parity, real-kicker and
  roller-wall escapes, the cap.
* Amended: verify-terrain (H: s-monotone), verify-slab (B: material
  law), verify-strand (D: bare-spine fallback), verify-harness (B:
  v4 seeds), verify-grind (suite-local probes).
* Full battery green: harness, slab, contact-order, hash, terrain,
  strand, grind, respawn, spine-parity, fold, grid-order, gridpan.

## 10. Baselines

* **baseline-v4** (commit A, respawn-walk law): 143/144 finished,
  1 DNF, 822 deaths, meanT 117.0. The soft-lock class is dead; the
  15 "stuck" latches are transient >10 s losses (14/15 finished).
* **baseline-v5** (stage 3, terrain v4): **144/144 finished, 0 DNF**,
  656 deaths, meanT 100.1. Deaths by kind: roller 236, flat 263,
  slope 97, kicker 48, gap 9, **sw 2**. Six transient stalls, all
  finished.

## 11. Named deferrals

* Camera rotation through folds (§7) — Eddie's screenshot gate.
* Ridden ceilings / material-above (pockets) — explicit material-law
  amendment when they arrive.
* Ghost minimum-image wrap does not period-shift its handed surface y
  (far-ghost presentation nicety, endless-mode only).
* The egg collider stays parked (Eddie, 2026-08-17).
