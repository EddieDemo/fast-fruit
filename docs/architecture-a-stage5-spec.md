# Architecture A — Stage 5: The Material-Above Amendment, the Tunnel, and the Trapdoor

Terrain v6 · baseline-v7 · 2026-08-17

Stage 5 gives the vocabulary its first ceiling and its first choice. It
also spent a long afternoon in the sweep mines, and the laws that came
out of those mines are documented here with their type specimens.

## §1 The material-above amendment

Ruled by Eddie: **any solid-appearing terrain should be solid.**

A strand tagged `matAbove` is a CEILING: its material sits on the
gravity-up side, its polyline traces the visible under-edge, and its
slab extends upward (`slab.js`, the amendment site stage 3 reserved).
The sign convention is one variable (`want`), so strands without the
tag build byte-identically to the unamended code.

Three structural facts make the ruling hold by construction rather than
by discipline:

- Ceilings carry **no s** (like the wall), so they never own progress
  projection — a body rolling beneath a roof projects to the floor.
- Contact push-out is body-center-derived, so ceiling collision needed
  **zero physics changes** — a body clonks DOWN off an under-edge with
  the same code that bounces it UP off a floor.
- The renderer draws exactly the slab polygon the collider owns, so
  solid-appearing = solid cannot drift.

Suite: `verify-ceiling` A/B (scope; probes inside the roof project to
the floor).

## §2 The tunnel (terrain v6)

A roof slab over a stretch of the line. Laws (`tunnelPlan`):

- clearance drawn in **[300, 420]** against a grounded reach of ~220 —
  a rolling body never touches the roof (verify-ceiling C/D binds the
  pass to roof clearance, not to micro-airtime, which is normal
  rolling physics);
- flight clonks the under-edge and returns to the floor alive (E);
- the mouth cap sits at head height, so the grammar forbids a tunnel
  directly after any airborne word — kicker, gap, sw, trap (G);
- the roof renders in the violet tint; the floor speaks `tunnel`.

## §3 The trapdoor (terrain v6) — the first choice fork

**In a one-axis game, choice IS speed.** The only fork mechanism 2D
physics offers is a mouth you either clear or drop through, so the
choice word is the drain's sibling: same topology, opposite pricing.

Anatomy (`trapPlan`, all derived quantities marked):

- a LEVEL DECK reaches a MOUTH; the far edge sits mDrop ∈ [55, 75]
  below the near edge; the demand is drawn in **[1050, 1400] px/s**
  and the mouth span is DERIVED from it exactly
  (span = demand / √(1200/mDrop));
- the near edge is a steep **ridable chute** (grade [2.0, 2.4]) with a
  short vertical tail (≤ 260): a deliberate braker slides it
  tangentially and pays almost nothing; a failed send slams. **The
  word punishes indecision, not the choice**;
- below, a washboard floor (2–4 waves, amp [18, 36]) descends under
  the far deck; floor depth is DERIVED by the clearance law
  (fDrop = 420 + mDrop + washAmp + jitter) so crests clear the deck's
  slab;
- the far deck's length is DERIVED to span the washboard
  (verify-trap B found the drawn-short case laying a NEGATIVE closing
  leg) and its s obeys the stage-4 S-ANCHOR LAW; it ends in a cap-drop
  (~1450 vn) — the deliberate grammar rhyme with the drain: high lines
  end in cap-drops;
- fork metadata (`dp.entry`: lipX, lipY, farX, demand) rides the
  branch strand and tiles with the period (verify-trap G).

Measured, not assumed: **the deck is the faster route when free**
(verify-trap D: 3.9 s vs 9.8 s over the test word). That measurement
is the oracle's premise.

## §4 Route-aware brains

Every cast member carries a permanent **LEAN** — p(send) at a choice
fork, seeded from pilot identity, spread 0.15–0.90 across the roster
(state.js). A 0.9 bot always sends it; a 0.5 bot is genuinely
unpredictable. Both are character.

The per-race, per-fork ROLL (`pilot.js routeCall`) hashes
(race seed, bot salt, fork position) — bit-deterministic, ghost-safe,
and never touches the shared rng stream. `race.seed` is plumbed
through main, the harness, and the resume snapshot for this.

- **The drop discipline COMMITS LATE**: full drive until the computed
  stopping distance says brake. The first sweep's DNF signature was an
  early-braking bot creep-parked in a roller trough a kilometre short
  of its fork.
- **A fork below you is decided**: a body below the deck
  (m.y > lipY + 120) has taken the drop, and holding the drop
  discipline down in the pit was the second DNF signature — a 0.4
  axis cannot climb the first washboard crest (type specimen: seed
  1014238739, four bots parked beneath their own fork).
- **The oracle computes instead of rolling** (the honesty rule): send
  iff current speed already meets the demand with margin; otherwise
  the chute costs less than a failed send pays.

## §5 The rocker

A grounded body making no net progress is functionally soft-locked,
and troughs steeper than the grind grade exist by design (rollers are
a MOMENTUM word). Bots escape the way players do: by pumping.

- **Parked is a net-displacement fact**, not an instantaneous one: a
  traffic jam jostles its bodies past any velocity threshold
  (measured: 25 s at ±60 px with vx spiking to 150) and micro-airtime
  strobes any grounded flag. The test is "has this body moved 90 px in
  two seconds". The pre-GO grid is exempt.
- The escape is a **sign-following throttle** (push the way you are
  already moving): energy injected every half-cycle, amplitude grows
  until a crest is crossed.
- A staggered per-bot **back-off window** breaks touching-pair
  deadlocks (two bodies sign-following the same jostle shove each
  other into the hill forever).
- **Reverse-and-send escalation**: a release that re-stalls within 6 s
  is cycling at something that wants a run-up; after two failed
  attempts the bot backs up for three seconds and commits.
- Full save/load: a resumed race rocks from where it left off.

## §6 The launch law

The grid dumps twelve bodies at walking pace onto the template's
opening metres. A steep roller train there is a pileup machine —
touching pairs pin each other faster than any escape behaviour can
separate them (type specimen: seed 1014238739's four-bot park at
x ≈ 1.6 km). The vocabulary owes a standing start a launch: **the
first 2600 px speak only slope and flat.** Six percent of a lap; a
field at speed rolls straight through it every lap after the first.

## §7 The entry chute

A near-vertical pit entry wall is a WEDGE: its contact normal holds a
crest-parked crawler on the lip forever (seed 1401515656). The
obvious repair — undercutting it like the switchback's drop face — is
WORSE: the sw's undercut feeds an open deck, but a pit corner is
closed, and the overhung pocket collected a measured three-melon
stack. The trapdoor had already ruled the honest shape: **pit entries
are steep ridable chutes** (grade 2.2, vertical tail when cramped). A
crawler tips onto a face it can slide; nothing stacks against a
forward lean; ballistic entries meet it tangentially or not at all.

## §8 The strand-owned respawn walk

A death now remembers the strand its projection foot was on
(`m.deathPoly`, stamped in physics; `project` returns the owning poly
index). The respawn walk runs on that strand first — dying on a deck
respawns on the deck — and falls back to the s-containing scan when
the owner is unknown, unannotated, or too short behind the death to
host a walk. Short branches (the drain's bridge, most far decks)
mostly take the fallback today; the law is what matters, and long
branches arrive with the vocabulary.

## §9 The weight-normalization correction

The recipe normalizes chunk weights by their total — but the total was
a hardcoded six-term sum, so the two new words' drawn weights silently
distorted every other's and the words themselves never fired. The sum
now names every word in the vocabulary, and verify-terrain B holds it
to 1. (An earlier in-session diagnosis blamed the pick chain; that was
wrong, and the pick chain is restored to its original raw form —
normalization was always the mechanism.)

## §10 Baseline v7

144/144 finished · 0 DNF · 22 transient stalls · 763 deaths ·
meanT 106.2 s · medianT 101.1 s. Dialect census: tunnel 7/12,
trap 7/12, drained 5/12. Deaths by kind: flat 241, roller 239,
slope 159, kicker 49, trap 54, gap 13, tunnel 6, runway 2.

The trap's 123 → 54 death drop across the session is the late-commit
and decided-fork fixes landing; gap 34 → 13 is the entry chute.

## §11 Suites

New: `verify-ceiling` (A–G), `verify-trap` (A–G). Amended:
`verify-branch` D (the dribbler caps speed to the ramp base, then
sends — braking must happen while grounded), `verify-harness` B/D
(v6-clean seeds re-picked: 101, 2654435862, 1013904327),
`verify-trap` E probes HOT (a slow probe cannot distinguish a
late-commit drop from a send). The harness gained `opts.observer` — a
read-only probe riding the built-in observers' slot.

All 15 suites pass; the sweep is the sixteenth.

## §12 The spine-native audit (racewatch + pre-race camera)

The stage roadmap's last line-item, done last:

**Racewatch** had four x-fossils: the standings sort, the survival
streak, the pace sampler, and per-racer distance all measured raw x.
Every one lied on a fold's return leg (moving forward while x runs
backward) and across the trapdoor's deck/floor routes. All four now
read `spine.progressOf`; the pace field's units become arc/s, which is
what the finish estimator divides remaining arc by. Bare suite states
without a spine keep the x fallback.

**The pre-race grid walk** sorted bodies by raw x and swept the camera
by x-interpolation — lawful only on monotone ground, and the grid sits
on the previous period's tail, which may fold. The walk now sorts by
progress (tail-to-pole = grid order by construction) and traverses by
cumulative path length through the bodies' positions, with x and y
lerping together — which is exactly what lets the shot follow a field
parked across a fold. Duration derives from the same arc.
verify-gridpan C is amended to assert the arc model.

## §13 — Stage 5 addendum: THE TURNAROUND GALLERY (switchback v3)

**The finding.** The v1 switchback was verified machinery wrapped around
dead content: sw spoke in 23% of daily templates (69/300), yet sims at
race, mid, and crawl speeds produced ZERO backward travel. Deck B was
enterable only by a sub-crawl tip-over past a 10 px undercut. Nobody in
the game's history had ever travelled backward. Ruled: rebuild around a
mechanism that can actually reverse a racer. Ballistics cannot; only
redirecting geometry can — the quarter-pipe. Ride up, trade speed for
height, come back moving left.

**Four failed topologies, each with a measured wall.** The rework's
real lesson is structural, so the failures are the spec:

1. *Unannotated apron + bowl branch.* Semantic input reads the nearest
   ANNOTATED face's point-order direction; the apron inherited deck A's
   +1 and the throttle fought the turnaround. Bodies pocketed (104 px
   of backward travel, then equilibrium).
2. *Annotated reversed apron, shallow step (110–150).* Deck A's own
   slab side (SLAB_T 260 > step) walled the ride at minX 2388. The
   clearance law's third instance: the step is 430+.
3. *Shelf connector, drop face leaning −x.* The material-side law reads
   a −x lean as material-on-the-right and extruded a 900 px slab wall
   across the apron at exactly the pocket's x (2455–2463). Leaning +x
   instead buried deck B's right 260 px and left a 32 px chimney that
   rejects 72 px bodies.
4. *The v2 long shelf.* Running the primary back at cap height put it
   through the APPROACH terrain — whole-field park on seed 1013904327.
   v1's hidden invariant: its fold tucked under its own deck A.

**The pocket theorem.** Any near-vertical primary face within ~285 px
of the apron's span extrudes a wall into a ride corridor. The gallery
is topologically a POCKET, and the track's through-line cannot thread
a pocket.

**The v3 composition** (three proven patterns, no new machinery):
- PRIMARY BYPASSES via the trapdoor's own grammar: level lip → mouth
  (demand 1050–1400) → entry-law chute (fully ridable, fDrop/chuteG,
  fits under deck A) → washboard floor under everything (amp 16–24 —
  28–44 crowd-trapped a slowed field at vx 25 for 500 s, seed 334513)
  → out past the bowl.
- BRANCHES in an s-anchor chain (the drain-bridge pattern): deck A
  (+x, carries the sw entry {lipX, lipY, farX, demand, wallX}), the
  apron (right-to-left, dirX −1 drives the turnaround), deck B
  (right-to-left, D 900–1600, exit anchored to the floor's arc beneath
  its left end — captured AT the bLx crossing, since back-projection
  at the flat rate mis-anchored by 30 px), and THE BOWL as a WALL:
  unannotated, laid BASE-TO-TOP. Point order is the material call on
  a curl — laid top-first, the ny>0 rule offsets every steep segment
  into the bowl's own airspace and bodies wedge against their own
  strand's slab (measured: 220 s). Annotating it planted a dirX seam
  at the base that parked half a field.
- DERIVATIONS, no fudges: aLen = D + worst-case chute run + margins
  (the exit clears the chute foot by 220+); bowlR floored by
  (step + aLen·gAup + 140)/1.2418 so the curl tops the cap and
  catches every entry speed (no draw added; the raw bowlR keeps its
  stream slot); RESERVE 4800 → 5600 (the gallery is now the longest
  word; overrun made the closer lay a negative slope: a backward
  weld the field jammed against).

**Brains.** routeCall accepts sw forks (lean-rolled like the trap);
THE WALL DISCIPLINE gives committed senders a brake to bowl-safe
speed on deck A (same late-commit arithmetic as the drop). The
rocker's reverse-and-send now ALTERNATES sign per attempt — the
semantic flip turns a fixed raw axis around on reversed strands, and
one of the two directions is always out of a pocket.

**Verification.** verify-gallery A–H (plan laws, corridor sweep,
direction audit, the ride at race and walking pace, the bypass, the
s-anchor chain, determinism, grammar + RESERVE). 16-suite battery
green. Baseline v8 vs v7: stuck 22 → 2, deaths 763 → 340, meanTime
106.2 → 86.2, maxTime 232 → 124. 144/144, zero DNF.

**PENDING RULING (pricing).** Measured across five galleries: the
bypass runs 2.5–6 s faster (gallery 8.0–11.6 s, bypass 3.9–6.5 s).
The gallery is the scenic-commitment line; bots visibly lean into it,
the field's tail can lose ~30 s/lap to a repeated send (191 s worst
finisher on 2654435862, still under v7's 232 s). Options: (a) accept
as character; (b) pay the gallery back honestly via exit speed (tune
gB so the gallery exits hotter than the floor); (c) raise the
washboard toll — bounded above by the crowd-trap measurement. Ruling
requested before Stage 6.

## §14 — Serpentine prototype: laws found, machinery shipped

Prototype status: NOT SHIPPED. proto-serpentine.js is a harness rig,
not game content — the 12-body field does not yet transit a mandatory
turnaround. What follows is what the prototype paid for.

**Machinery shipped to the main tree (battery-green, baseline v9):**
- THE TWO-COEFFICIENT FRICTION LAW (config.js, physics.js): rind on
  rind is 0.15 against 0.95 on ground. Driven bodies in sustained
  mutual contact spin-lock like meshed gears (measured: raw 1.00,
  torque 1.00, grounded, omega 0); slick rind dissolves the lock.
  Baseline v9 vs v8: stuck 2 -> 1, meanTime 86.2 -> 82.7 (pack
  traffic flows), deaths 340 -> 363 (slick packs jostle — the
  recorded trade).
- THE MATERIAL-SIDE TAG (slab.js, terrain.js): pts[i].mat = 'R'|'L',
  per SEGMENT via the start point; leg(dx, dy, mat). Untagged
  segments keep the gravity rule byte-identically. USAGE LAW: tag
  every segment of a wall — one untagged segment at |ny| > 1e-3
  reverts to the auto rule and flips sides mid-strand (the bow-tie
  bottom is the render signature).
- THE DIRECTION-NEUTRAL TAG (slab.js): pts[i].dirNeutral — the face
  owns s and projection but cedes DIRECTION to the nearest
  directional face. Canonical iteration and tie-breaks unchanged.
- THE METERED, HEADING-AWARE WALL DISCIPLINE (pilot.js): per-bot
  vTarget (300-820) and brakeLen (600-3800) hashed from leanSalt per
  turn; window math signed by the fork's own geometry so mirrored
  (leftward) turns brake correctly.
- THE SEMANTIC-AWARE ROCKER PUMP (pilot.js): a heading-blind pump
  REMOVES energy on reversed strands; the pump now pushes along
  motion in the strand's own frame.

**The serpentine turn's conservation laws (the prototype's yield —
any future turn design must satisfy all of them):**
1. THE WATERSHED LAW: any vertex where dirX flips +1 -> -1 is a
   semantic attractor — both domains drive bodies into it and hold
   them by their own throttle. Proven contact-free: trajectories
   were bit-identical under terrain changes below the vertex.
   Attractors must be undwellable, gapped, or direction-neutralised.
2. THE GRAVITY-VALLEY IDENTITY: the entry leg and any right-side
   catcher that both descend into the junction form a V — a hopper
   with a point outlet. Hopper outlets under ~4-5 body diameters
   arch (granular jamming, measured repeatedly).
3. THE COULOMB REST BOUND: mu = 0.50 statically holds slope 0.50;
   at 0.45 gravity-along eats 0.41 of the 0.455 traction budget and
   the drive's residual is a 0.045 g crawl a pile absorbs. Anti-rest
   means >= 0.55, not 0.30.
4. THE DUAL-ROLE CONSERVATION LAW (the capstone): landing wants
   <= 0.3 and slopes-away; draining wants >= 0.55 and slopes-toward.
   No single surface can serve both — which is why every pan variant
   oscillated between mound and smash. Catchers must be VERTICAL
   (walls are exempt from both bounds: no rest, tangential landings)
   and drains must be steep or free-fall.
5. THE BOUNCE-LEAK LAW: any free edge over void sheds hot landers to
   their death; every catch surface extends under its worst bounce.

**Render-first is mandatory for turn geometry**: three sessions of
blind coordinate arithmetic ran ~50% wrong on first contact; every
defect found by render was found in minutes.

**Open**: the panless turn (bowl-as-sole-catcher, truncated-V mouth,
one-way floor, mini-wall lip) is the first shape violating no law;
field transit remains unproven. Next: derive the turn from the law
set, render, then run.

## §15 — Raw input (ruled by Eddie, 2026-08-17)

Semantic input (stage 3) is DELETED. Stick right spins the melon
clockwise and rolls it right, everywhere, on every surface — the
camera never rotates, so the screen is world-space. The physics
torque flip by nearest-face direction is removed (physics.js);
direction choice now lives in the BRAINS (pilot.js travelDir), which
multiply every travel-frame drive axis by the nearest riding face's
point-order direction — the exact lookup the old flip used, so bot
trajectories are BIT-PRESERVED: baseline v10 equals baseline v9 in
every aggregate. The harness player seat steers raw (stick toward
travel, looked up per tick).

Suite consequences: verify-gallery rides steer raw (green);
verify-fold's E is rewritten as the STEERED ride (green); verify-fold
C (the fold traversal) is RED pending a raw-era refresh of the
suite's bespoke stage-3 world — that geometry was tuned around the
semantic flip's per-tick lookup flicker, which acted as an accidental
ratchet freeing bodies from its miter pockets (the lip niche,
measured). The niche was always a trap; raw input merely stopped
masking it. The fold world refresh is scoped as its own task.

Player-facing note: the gallery plays BETTER raw — fly in holding
right, the bowl turns you, switch to holding left. The switch is the
fun. The serpentine's watershed attractor loses its physics engine
(the flip) entirely; bot behaviour at direction boundaries becomes a
brain-design surface, which is tunable, rather than a physics
inevitability, which was not.

## §15 — The raw-input rework (ruled by Eddie, 2026-08-17)

Semantic input (stage 3: forward = advancing arc, physics flipping
torque by the nearest face's point-order direction) is REMOVED. Stick
right spins the melon clockwise and rolls it right, everywhere, on
every surface. The camera never rotates, so the screen is world-space
— Sonic logic, not car-game logic. Semantic input shipped as
reasoning and was never felt in play (v1's reversed deck was
unreachable), and its flip was the hidden engine of the watershed
attractor.

**Where direction lives now:** the BRAINS (pilot.js). travelDir(m,
ctx) reads the same projection the old flip used; every drive axis a
policy computes in the travel frame is multiplied by it. Because the
lookup is identical, bot trajectories are BIT-PRESERVED: baseline v10
equals baseline v9 exactly, every aggregate. The rocker's pump
reverts to raw sign-following (naturally heading-true now); its
backoff and escalation carry travelDir. The harness player seat
steers per-tick toward travel (a constant 1 under semantic meant
exactly this).

**Suite reworks:**
- verify-gallery D/E rides steer by projection dirX per tick.
- verify-fold E's invariant is the STEERED ride (the old assertion
  tested the deleted flip).
- verify-fold C's bespoke world gained the raw-era tip path, each
  piece measured in: a back-leaned drop face ('R'-tagged — a
  back-leaned leg's auto material ledges into the tip corridor), a
  HIGH CATCH TONGUE (s-anchored branch, laid right-to-left so it
  natively reads -1) spanning the measured 35-155 px roll-off drift,
  pouring landers onto deck B clear of the face's wedge corner, with
  the drop face dirNeutral-tagged so the seam reads deck B's
  direction. Failed intermediate shapes (leaned-face ski jump at
  vx +590; floorless heel pocket; corner wedge at full throttle) are
  documented in the suite's comments — all four turn conservation
  laws reappeared at suite scale.

**Serpentine implication:** the watershed attractor was largely a
semantic-input artifact. Under raw input a steered body rolls
through a junction; direction-boundary behaviour is now a BRAIN
design surface (tunable) rather than a physics inevitability. The
turn derivation restarts from the law set under raw semantics.

## §16 — Serpentine turn derivation under raw input (session log, 2026-08-17)

The turn restarted from the law set under raw semantics and converged
by measurement to THE GALLERY-ORDER TURN: entry -> mouth -> conveyor
(0.60, the Coulomb drain: gravity-along 0.51g beats the full 0.43g
traction budget, defeating rest AND adverse semantics) -> chute
descending RIGHTWARD with the flow -> run-out -> gallery-verbatim
bowl at the BOTTOM of the descent -> trapdoor exit -> v1 fold-drop ->
tier 2. The energy-budget insight that ended five rounds of top-bowl
geometry: a bowl turns fast bodies ballistically and parks slow ones;
at the bottom of the descent everyone arrives hot.

Measured advances locked in this session: buried wall bases (slab end
caps eject corner impacts and form underside ledges — rendered frame
by frame); the bowl-as-tongue (stub+arc laid with descending s reads
dirX -1 natively, pulling parked bodies to the trapdoor — the
gallery-apron semantic recreated with fold-suite machinery); the
200 px trapdoor (a 90-wide body bridges 40 px without noticing);
fold clearance C >= SLAB_T+140 (a 260 drop left a 12 px cavity).

OPEN — the next session's first move: the run-out slab's bottom
outline miters 237 px past the lip (dump: bottom face (6149,2628) ->
(6757,2665)) and paves the trapdoor's underside as a landable shelf,
because faces collide two-sidedly (ceiling-clonk heritage). v1's
fold never exhibited this: its lip was deck A's END — a squared cap.
THE RULE: EVERY LIP MUST BE A STRAND END. Restructure layWorld as
primary-ending-at-lip-1 plus s-annotated tier branches (the tongue
pattern at full scale), then re-run the metered escalation.

## §16 — Serpentine topology ruling request (2026-08-18)

### The measured failure ladder (proto-serpentine, primary-threads-the-tiers)

The proto routes the primary THROUGH each turn: entry → mouth → conveyor
→ chute → run-out → fold → tier 2. Fifteen rounds of staged escalation
(1/3/6/12, metered entries, player wall-wiggle rig) produced a complete
failure ladder at the fold basin, every rung measured:

1. Wall bases at surface level leak via slab bottom-caps (normal-down
   ejection; underside ledge ride to void).
2. Buried bases only bury the base POINT — the 260 px end-cap needs full
   enclosure, and enclosure slabs are themselves surfaces that leak.
3. Sub-0.55 floors rest fields (Coulomb bound); the 0.60 conveyor cure
   then imprisons slow bodies at its own bottom (reverse traction 0.43 g
   < gravity-along 0.51 g — drains are one-way by design).
4. A bowl at the descent TOP parks metered arrivals (flat base tangent
   holds under drive); a bowl base ON the fold vertex paves the fold's
   mouth (measured oscillation, run-out ↔ arc).
5. The trapdoor form (lip + gap + stub bowl) fails on a constraint
   circle: pour mouth ≥ body width, landings within grounding reach
   (≤ foot+45 STATIC ONLY — edge grounding is metastable), no sub-body
   slots anywhere (an 80 px slot passed a 90 px body in 0.2 s via
   resolution chatter: THE SLOT BOUND IS ZERO), and the drop face
   blades every shelf at some height. With the face terminating at the
   cap corner the pour seals at body radius (measured park 9 px shy of
   a coplanar cap). The constraint set is circular; no local geometry
   satisfies it.

Additional standing findings: a back-leaned leg's AUTO material goes
right (verify-fold C defect, cure = mat tag); a forward lean's auto
material tucks correctly and an added tag aims the band INTO the gap
(measured, rendered); s-annotating a bowl arc re-creates the shipped
game's own measured dirX-seam park.

### The shipped answer

terrain.js `kind === 'sw'` (the gallery) IS a verified switchback and
its comments document this exact war: "a pocket cannot host the track's
through-line — four connector placements each extruded a measured
260 px slab wall into a ride corridor." Its lawful topology:

- PRIMARY BYPASSES: mouth → entry-law chute → washboard floor UNDER
  everything, out past the bowl. Monotone, s-carrying, never trapped.
- Deck A (+1), apron (−1, the turnaround driver, self-clearing slope),
  BOWL (unannotated wall-class: never owns projection; grounded bodies
  at the base read the apron and the throttle drives the exit), and
  deck B (−1 leftward run, D = 900–1600) are BRANCHES in an s-anchor
  chain, lengths DERIVED so no corridor is crossed.
- The bypass floor doubles as the safety net: there is no void under
  the structure, so every leak class from the proto's ladder is
  structurally absent.

### Proposal: the serpentine is chained gallery switchbacks

Primary = one monotone descent running under/past the whole formation
(the safety floor). Tiers = branch decks in an s-anchor chain; each
turnaround = apron + unannotated bowl (mirrored on alternate ends);
deck-length derivation per the shipped rules with D at tier length.

Ruling needed on ONE design fork before implementation:

**(a) Bypassable turns (shipped semantics verbatim).** The washboard
bypass prices the express line; the serpentine is a route choice, fork
metadata for free. Lowest risk: the 'sw' chunk generalises with D
extended and a mirror flag; verification = existing gallery suites
re-parameterised.

**(b) Mandatory turns.** The primary bypass is walled off after laying
(or priced beyond use), making the branch chain the only route. Honest
physics concern: the primary would exist as machinery rather than as
ridable track, and the s-chain becomes the de-facto through-line the
shipped comments warn about. Requires new verification (branch-chain
soft-lock sweeps at 12 bodies per turn, both mirrors).

Recommendation: (a). It composes only shipped, verified machinery, and
the gallery precedent (express vs scenic) already establishes the
racing grammar. If the daily-cup mix needs forced reversals later, (b)
can be revisited per-template rather than per-architecture.

### §16 addendum — ruling (a) implemented (2026-08-18)

Eddie ruled (a): chained gallery switchbacks, bypassable turns.
proto-serpentine.js rebuilt on the shipped topology; first full
serpentine transits achieved. Results (standing-start rig, 12-body
field, metered entries, deterministic — identical md5 across runs):
fin 12/12, serpentine 4 / bypass 8, deaths 2 (both at bowl 1, the
canonical hot structure; the player rig carries no wall discipline),
worst jam 25 ticks.

Derivations added to the shipped set, all measured:
- The nesting inequality: aLen solved (4-pass iteration) so the WHOLE
  chain, turn 2's bowl reach included, nests right of the chute foot.
  A leftward-folded chute was tried first and crosses any left-nested
  structure — a diagonal spans all depths (the shipped bug verbatim,
  re-measured at a 66 px corridor).
- The floor-tilt credit: the C2 constraint binds at deck C's far end,
  where the floor has already descended gFl times the span. Omitting
  the credit dug the chute ~300 too deep; foot arrivals ran hot and
  the washboard's first crest killed 10 of 12.
- The eased foot: chuteG 2.0 + grade steps 1.5/1.0/0.55/0.3 (300 px
  each) + 700 px landing run before the washboard pricing starts.
  Deaths at the foot: 11 raw -> 6 short-ease -> 0.
- Turn 2's transfer ramp (aLen2 2400) plus a mirrored entry tag
  (demand 0, wallX at apron 2) — the discipline is travelDir-aware
  post-rework and holds the leftward approach.

OPEN — pricing ruling needed: the bypass currently BEATS the
serpentine (~11-15 s vs 20-30 s): the express skips two tiers, so the
shipped washboard pricing (tuned for the gallery's short bypass) is
far too cheap here. Options when this graduates from proto to
template: heavier washboard on the long floor, a slower express
grade, or scoring/route incentives. Not a correctness issue; the fork
itself works as designed.
