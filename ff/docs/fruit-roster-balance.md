# Pulp Friction — Fruit Roster & Balance Design

*Different fruits that are different tools, balanced by data, in a
world whose constants never move. Design notes — nothing here is
implemented yet.*

**DECISION LOCKED: true per-body mass/inertia in the pair solver is
approved.** Heavy fruits bullying light fruits off the racing line is
wanted design, not a hazard to avoid. Build it when the fruit work
starts (details in §5).

---

## 1. The target: fairness, not balance

Perfect balance is the wrong goal. If simulation-tuning drives every
fruit to a 50.0% win rate by converging them on the same effective
physics, the result is five skins — the exact failure rejected for
tracks. The target is **viable diversity** (the fighting-game
standard): fruits whose *expected* performance is close (within a few
percent for equally skilled play) while their **variance, skill
expression, and track affinities differ wildly.**

- Blueberry: consistent, forgiving. Low top speed, nearly unsmashable
  (uniform curvature). Beginner's fruit; Grinder-track specialist.
- Pear: high variance, expert's fruit. Asymmetric mass, wild curvature
  range — podium or forty pieces.

So the simulation pipeline must measure and report **distributions**,
not just means: variance, smash rate, per-track-archetype splits. The
tuning goal: *equalize the means, preserve the spreads.*

## 2. The physics already prices shape

Shape differences need no artificial compensation — everything
downstream derives from geometry:

- inertia = m(a² + b²)/4
- rocking barrier ∝ the a−b gap
- smash severity ratio (tips vs flat) = a³/b³
- motor's effective gearing = contact radius

A rounder fruit automatically rolls smoother, smashes less, and
accelerates differently — honestly, from the same equations.

## 3. The three-tier lever hierarchy (write it on the wall)

1. **World constants — SACRED.** Gravity, terrain, smash threshold:
   the shared reality everyone races in. Never per-fruit.
2. **Fruit intrinsics — IDENTITY.** a, b, the shape itself. Touch
   these last; they are what makes a pear a pear.
3. **Fruit materials — THE BALANCE DIALS.** Mass, friction,
   restitution, rolling resistance, motor torque & maxAngVel, and
   per-fruit *rind toughness* (a severity multiplier — fictionally
   perfect: pineapples are armored, blueberries are… concerning).

Per-fruit motor feels like cheating until you remember it's
diegetically sound — different fruits have different "legs" — and it's
the most surgical lever available.

## 4. Mass: the approved trap lever

The current pair solver assumes equal mass/inertia (symmetric impulse
math, 50/50 positional correction). Per-fruit mass requires **true
per-body invM/invI**:

- k = invM_A + invM_B + (r_A×n)²·invI_A + (r_B×n)²·invI_B
- impulses applied with each body's own inverse mass/inertia
- positional correction split by inverse-mass ratio (the light body
  yields ground; the heavy body holds its line)

This is a small, worthwhile generalization — and a **collision-meta
decision**, not just a balance number: it rewrites pack shoving
politics. That's the point. APPROVED — see decision at top.

Implementation notes for later:
- Bodies carry {mass, a, b}; inertia derived per body. Defaults
  snapshot today's melon so the refactor must be **bit-identical** on
  a homogeneous grid (invM+invM ≡ 2·invM; invM/(2·invM) ≡ 0.5 in
  IEEE) — the regression suite doubles as the proof.
- Everything currently reading CONFIG dims must read the body: the
  ellipse collider, support radius, curvature, severity's R_flat,
  respawn height, debris burst silhouette, shove radius.
- Side effect to accept: dims/mass apply at (re)spawn, so the
  semiMajor/semiMinor tuning sliders take effect on next respawn
  rather than live.

## 5. The measurement pipeline (the data-first plan, upgraded)

**Bot skill ladder** — balancing on hold-right alone balances for
zero-skill play and would wrongly buff fruits that reward technique
(the pear). Add cheap deterministic input policies (~20 lines each):

1. *Hold-right* — existing baseline.
2. *Pumper* — modulates torque by terrain slope.
3. *Lander* — backspins before descents to flatten landing angle.

The ladder yields a **skill curve per fruit**, not a point estimate;
tune for "close at every skill level."

**Tournament harness:** every fruit-matchup × every track archetype ×
multiple seeds. Determinism makes each experiment exactly
reproducible; at ~1.2% of real-time cost, thousands of full races run
overnight on a laptop.

**Measure:** finish-time distributions; win rates in mixed grids;
smash rates *and where smashes happen*; speed profiles per terrain
type; head-to-head shove outcomes.

**Output:** a **balance sheet per fruit** — and per-archetype splits
feed back into the track system, because "the blueberry owns Whoops
tracks but drowns on Plummets" is *content*, not a bug: fruit-track
matchup depth is what makes roster games replayable.

## 6. Shapes: the honest fork

- **Free:** anything ellipse-family — blueberry (circle, a=b), melon
  variants, banana-class (long thin) — same collider, different a/b.
- **The honest cheat (recommended default):** ellipse collider +
  distinctive visual dress for any fruit whose silhouette an ellipse
  can approximate.
- **Real new colliders** only for fruits whose *shape is their
  mechanic*: the pear's bottom-heavy wobble deserves real physics
  (≈ two-circle capsule blend — tractable) or it's a lie. Pineapple
  surface texture: harder; park it.

## 7. Determinism contract

Fruit choice affects the sim ⇒ it enters:
- the **lockstep handshake** (peers must agree everyone's fruit), and
- the **ghost header** (a ghost is seed + fruit + positions).

Trivial plumbing, but mandatory. Mixed-fruit multiplayer is exactly
when per-body mass stops being optional.

## 8. Sequencing

1. Generalize physics to per-body fruit parameters (today's melon as
   the reference fruit; bit-identical regression as proof). Includes
   the approved true two-body pair solver.
2. Two cheap ellipse-family fruits to stretch the parameter space:
   small round "blueberry-class," long thin "banana-class."
3. Bot skill ladder.
4. Tournament harness + balance sheets.
5. Only then invent exotic fruits — at that point each new fruit costs
   one definition plus one overnight simulation to know honestly what
   you've made.

That last property is the prize of the data-first approach: roster
design becomes an instrument-rated discipline instead of vibes — while
the three-tier hierarchy guarantees the instruments never quietly
redefine the world everyone shares.
