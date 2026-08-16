# Fast Fruit — Track Variety Design Notes

*How to generate tracks that feel different, not just look different.*

The organizing principle: the game has roughly five core skills — throttle
rhythm, momentum management on climbs, air rotation for landings, speed
regulation before hazards, and pack navigation. A track feels distinct when
it **reweights those demands**. Everything below is ordered roughly by
feel-per-effort.

---

## 1. Chunk weight profiles — track archetypes

The cheapest big win. The generator already has a vocabulary (slope, bump,
flat, kicker) with hardcoded probabilities; make those weights part of the
track recipe and named archetypes fall out of pure data:

- **Flow** — zero flats, long low-amplitude rollers whose wavelength matches
  cruising speed. Skill: pumping rhythm, never touching the brake.
- **Airfield** — kicker after kicker with generous landing slopes. An
  air-rotation exam.
- **Grinder** — steep short climbs, tight drops, low drop-per-lap ratio.
  Skill: momentum banking. Smashing is brutally punished because
  re-acceleration uphill is slow.
- **Plummet** — huge D/L ratio, near-continuous descent. You live above
  comfortable speed; the skill inverts to *brake* discipline and choosing
  where to scrub.

Same vocabulary, wildly different games.

## 2. New primitives — new sentences the track can say

Each primitive creates a new demand. Candidates that fit the physics:

- **Whoops** — dense small chatter bumps (motocross-style). Punish wrong
  spin rates; reward a specific speed band.
- **Tabletop vs. double** — the same jump with a flat safe top versus a gap
  where landing short means a face-first slam into the far lip. Friendly
  track vs. scary track from identical launch geometry.
- **Step-down** — sudden drop mid-descent; blind landing.
- **Compression** — steep chute into a sharp valley. The G-out spikes
  contact impulse and can smash at high speed *without a jump*. Teaches
  that speed itself is a hazard.
- **The Wall** — a grade just under the static climb limit, placed after a
  slow section. Passable only with banked momentum — makes the *preceding*
  200m matter retroactively.
- **Uphill finish** — converts a whole lap's speed management into the
  final result.

All slot into the existing drift-control assembler unchanged.

## 3. Per-segment materials — one mechanism, many tracks

Highest-leverage structural addition: optional per-segment properties
`{ frictionMul, restitutionMul, boost }`. Yields:

- **Ice** — low friction; torque stops converting to motion; spin
  management becomes survival.
- **Mud** — high rolling resistance zones that eat speed; line choice
  matters.
- **Boost strips** — tangential impulse on contact; risk/reward placement
  on dangerous lines.
- **Trampoline** — high restitution segments.

Physics cost: a few multipliers read at contact resolution. Determinism
unaffected. Composes with archetypes (Ice-Flow ≠ Ice-Grinder). The melon
equivalent of Mario Kart discovering item boxes: one system, combinatorial
variety.

## 4. Ceilings and tunnels — the sleeping giant

Terrain is *a list of polylines* and collision already handles arbitrary
segments — nothing stops a second polyline hanging above the track as a
**ceiling**. Low-clearance tunnels invert the core temptation: big air
becomes *lethal* (smash on the roof), and the skill becomes staying low and
flat through a section where the terrain below begs you to launch. A tunnel
after a speed-building descent is genuinely wicked design.

Cost is moderate: renderer must fill downward-hanging ceiling geometry;
respawn/marker height-lookup must query the *ground* polyline specifically.
The physics is already paid for.

## 5. Pacing grammar — tracks with dramatic structure

Chunks are currently drawn i.i.d., which produces texture but not
*narrative*. Add a small grammar: a lap is

```
Intro -> Build -> Signature -> Breather -> Finale
```

with per-phase weights, where the **Signature** slot guarantees exactly one
oversized set-piece (mega-kicker, canyon, tunnel). Effects:

- Every generated track becomes memorable and nameable ("the one with the
  triple step-down") — the entire pleasure of circuits.
- Authorial control of tension without hand-building anything.
- Placement is a dial: the same hard feature early in the lap (learnable,
  low stakes) vs. right before the finish (lap-time roulette) produces
  completely different emotional tracks.

## 6. The auditioning pipeline — the secret weapon

We already have deterministic bots and a headless harness, so **tracks can
be auto-rated at generation time**. Run the hold-right ensemble over a
candidate seed and measure:

- smash rate (too low = boring, too high = unfair)
- airtime distribution
- speed variance (good tracks have tempo changes)
- pack spread (does it string racers out or keep them brawling?)

Generate a thousand seeds overnight, keep the ones whose metrics land in
the "interesting" band, hand-audition only the survivors — curator with a
telescope, not prospector with a pan. The same metrics give every track an
honest difficulty grade for free. A validation pass (reject any seed the
reference bot can't physically complete) makes the generator unbreakable no
matter how wild the archetype weights get.

## 7. Rule-flavor tracks

Cheapest of all — per-track overrides of existing globals:

- **Glass** — lower smash threshold, gentle terrain; every mistake fatal.
  A precision discipline.
- **Moon** — 60% gravity: floatier arcs, longer air, rotation timing
  rewritten.
- **Sprint** — one lap, triple length, no memorization: pure sight-reading.

Two-line recipe entries once the recipe carries an overrides object, and
they teach players how deep the physics goes.

---

## Suggested build order

1. **Archetype weights + 3–4 new primitives** (whoops, double, compression,
   wall) — five genuinely different tracks in the registry within a session.
2. **Materials.**
3. **Pacing grammar with signature slots.**
4. **Auditioning pipeline** — once there's enough variety to be worth
   sieving.
5. **Tunnels** — saved as their own event; biggest single feel-change and
   deserves undivided attention.

Everything stays inside the recipe-as-data philosophy: every track remains
five lines of registry — shareable, deterministic, ghost-compatible.
