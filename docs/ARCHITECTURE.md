# FAST FRUIT — ARCHITECTURE
*The constitution. Written 2026-08-26 during the refactor (steps 1, 2,
4, 5 landed; step 3, the flow split, opens the next session). Every
law here is HELD BY A SUITE — this document explains; `verify-arch`,
`verify-world` and friends enforce.*

## The tiers, and the one-way rule
Modules live in tiers; a module references only its own tier and
below. `verify-arch` discovers ownership of every `FF.*` global from
the source and convicts upward references.

    core          laws & math, no game knowledge
                  (dmath, config, oklab, palette, sky, shading,
                   events, devtools, names, fruits, tuning, ...)
    sim           the deterministic world
                  (state, physics, terrain, slab, strand, damage,
                   tracks, gridstart)
    fx            deterministic-per-seed dressing on sim events
                  (debris, decals, cloud, billboards, finishline)
    modes         game rules over the sim
                  (cup, session, skijump, partycup, xp, melon, ghost,
                   racewatch, resume, ...)
    presentation  screens, sound, tools   |  net  transport
    shell         composition roots (world, flow, main)

**The doors.** Two sanctioned upward APIs, because they ARE the
design: `FF.world` (the lifecycle door — modes build worlds through
it) and `FF.flow`'s public surface (the screens door — register/go
and the finish contract). **Shared flags** (PIXELATE and kin) are
config-like globals, not dependencies.

**The ledger is a ratchet.** Known upward debts are named in
`verify-arch`'s LEDGER, each with its cure step. New violations fail
the suite the day they are written; cured entries MUST be deleted
(the stale check enforces it). The ledger only shrinks.

## The lifecycle law (world.js)
There is ONE door for building and tearing down worlds. Building any
world ends the previous one — not because callers remember, but
because the door is the teardown (`toDaily` clears the session before
and regardless of the implementation). History: the
session-outliving-its-world bug, the midnight-provider freeze and the
race-inheriting-the-conveyor were all the absence of this organ.

## The signals doctrine (events.js)
The sim ANNOUNCES and never listens. Lifecycle announcements are
emitted at the FRAME BOUNDARY, outside the fixed-step loop, so
listeners that rebuild worlds never run mid-step, and each
announcement fires once per moment (latched). Modes subscribe; nobody
polls state on rAF. First citizen: `session:over`. **Delivery is
(data, event, state)** — the sim state rides third (fix 2026-08-26r:
the bus took the state at emit and dropped it, so the first citizen's
isOver() interrogated the event record and every session end was
silently ignored; verify-session-over holds the whole wire now).

## The sim-observer doctrine (physics.js)
physics.js is NEVER hand-edited for a mode. Modes register observers
(`FF.registerSimObserver`) called at fixed sites in registration
order: `reset` (declare your schema fields — every body carries them
from birth) and `touchdown` (first contact after flight, BEFORE
severity: death can be the scoring event). Observers write
declared-schema breadcrumbs and read nothing nondeterministic.
`verify-skijump C5` holds the era's law: no mode fields in physics.

## The determinism constitution (pre-existing, restated)
Fixed-step 120 Hz; mulberry32 streams from seeds; no `Math.random` in
sim; FNV-1a hashing; declared schemas (fields exist from reset);
physics laws uniform and seed-derived, never per-individual. fx
randomness is presentation-tier. Device captures are ground truth;
PIL/headless proofs are evidence, never verdicts — and proof renders
are ASPECT-TRUE (a compressed profile hid a real spike once).

## The verification culture
Named suites per system; every significant change ships with checks
AND mutations. Hard-won rules, each paid for:
- A check that is true for a reason unrelated to what it names is
  vacuous (tie-break data must discriminate; regexes bounded to the
  function they claim to describe).
- Text pins cannot catch behavioural disabling (`if (false)`): prefer
  FUNCTIONAL harnesses — spy registrars capturing what a module
  actually registers, stubs driving what it actually does. Where only
  a pin is possible, state the limit in the comment.
- A constant that encodes the size of its container breaks on rescale;
  a signal that cannot say "I don't know" says "yes"; sampled and
  analytic checks fail differently — carry both.
- Zips are GATED on a green battery inside the batch; failed asserts
  abort before any write; verify state after any batch error.

**The integration-sibling law (amendment 2026-08-26w).** A spy that
REPLACES the real door tests the module and UNTESTS the integration —
three shipped bugs hid behind exactly this (the TDZ observer site,
the clone fence, the bus signature drift: all green under spies,
all broken on device). The law: every suite that bypasses a real
door — a replacing spy over a registration door, or driving a module
through its `_test` door — must have a real-door integration sibling
that exercises the same seam through the game's own wire. `_test`
STATE INJECTION is permitted where the wire under test is real; such
suites are declared setup-only. Wrapping spies that delegate to the
real door are not bypasses — the wire fires. Enforced as a ratchet
in `verify-arch` A7–A9: bypass suites are discovered from source and
must be enrolled with their sibling or declared setup-only; known
uncovered seams are named REMAINDERS, each with its cure, pinned to
the marker in the suite that states the limit; the sets only shrink.
Current remainders: partycup's leg advance (cure: Wrong Way's
`race:over` suite drives it over the real bus) and input's autopilot
subscription (cure: the input harness).

## The screen contract (flow split, step 3 — landed 2026-08-26)
flow.js is the ~200-line machine plus its organs (confirm, fade,
countdown, settle, the race/pause registrations, the dev lane); the
big screens are modules that register INTO it: flow-lib.js (the
shared privates — DOM helper, formatters, the standings law, the
spinner subsystem; presentation tier, loads BEFORE flow), then
screen-finish, screen-menu, screen-rewards, screen-naming (load
AFTER flow, before main; A4 holds every pair).

The registered screen object IS the surface:
- **build()** — runs once from flow.init, in registration order, at
  the phase the in-file builds always ran; a screen hides itself at
  the end of its own build.
- **Machine pokes go through the registry**, never a module's
  element: SCREENS.menu.refresh()/paintPortrait(),
  SCREENS.naming.openAward. The element is private again.
- **flow._internals** is the family entrance: accessors over the
  machine's own variables (state, practice, fromMenuOrRetry,
  sessionCtx, the init handles, confirm/fade). Accessors, not
  copies — two modules can never hold divergent state.
- **Cross-module handles resolve at CALL time** (the trampoline
  rule): _internals.runRewards -> window.FF.rewards.run,
  _internals.openAwardFlow -> SCREENS.naming.openAward. A load-time
  binding freezes whatever loaded first.
Held by verify-flowlib: functional contracts, round-trips through
the real machine variables, spy-registrar proofs per screen, and
absence checks that flow.js stays out of the screen business.

## Process
Design ruling before implementation. Move-only commits separate from
behaviour commits. One version per delivery, build stamp per session,
packaged-tree battery before presenting. The refactor sequence and
its remaining work: rolling: renderer passes (which also extract the
standalone melon painter and cure the last helper debt,
ghost:shadeEllipse), verify-lib harness kit, storage.js boundary (the
Steam save seam). Step 6b landed 2026-08-26u: the racer color LAW
lives in palette (core; fx and presentation read downward), and the
wheel handover is an ANNOUNCEMENT — autopilot states it engaged,
input gates itself as a subscriber. The ledger shrank by the two
debts truly cured; shadeEllipse's entry stays, honestly, with its
cure re-annotated. Practice is REMOVED (ruling B, 2026-08-26): practiceMode excised —
every reachable race is a cup race, sessions guard on st.session,
daily attempt 1 is a plain attempt (unlimited-attempts covers it);
the dead inCup()/cupJustEnded() pair died with it. Known debt,
unruled: CSS stays centralized in flow.js rather than per-screen
(the panel contract is one law).
