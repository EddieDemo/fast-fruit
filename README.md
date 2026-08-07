# Fast Fruit — Stage 1

Ellipse melon + torque input + flat ground + tuning cockpit.

## Run it

No build, no server, no dependencies — double-click `index.html` and it runs.

**Mobile testing:** push to a GitHub repo, enable Pages (Settings → Pages →
deploy from branch), open the URL on your phone. Note: the clipboard "copy"
button in the tuning panel works on GitHub Pages (HTTPS) and localhost;
from a plain `file://` open it falls back to printing config in the console.

## Controls

- **Mobile:** hold left half of the screen = spin left, right half = spin right.
  Slide your thumb across the midline to change direction without lifting.
- **Desktop:** ← / → or A / D.
- **tune** button (top-right): live sliders for every physics parameter.
  `copy` exports your tuned values as JSON — paste them into
  `js/config.js` DEFAULTS when a feel is worth keeping.

## What to evaluate (the stage-1 questions)

1. Does the uneven, wobbling ellipse roll feel *alive*?
2. Does spinning up have weight? Does backspin-brake feel authoritative?
3. Is touch responsive enough that the melon feels like your thumb?

Tune with: `motorTorque`, `maxAngVel`, `friction`, `angularDamping` first.
Those four are ~80% of the feel.

## The hold-right pack

BOT_COUNT solid-colored melons (main.js, default 5) spawn in a cascade
behind you and hold right forever. They collide with you and each other
(orientation-aware ellipse contact along the center line). The HUD
"vs bot" row shows your lead in metres over the LEADING bot. Set
BOT_COUNT to 0 for solo, 1 to recreate the old single-rival race.
The pack is fully deterministic per seed when your inputs are the same —
any same-seed divergence you didn't cause means determinism broke.

## The smash rule

Severity = contact impulse x (R_flat/R_contact)^curvExponent, evaluated
at the exact contact point on the ellipse. Flat-side landings spread
load (safe to ~9.5 m/s); the pointy tips concentrate it (~2x more
fragile). Impulse-based severity makes melon-vs-melon inherently
gentler than terrain (the other melon recoils; the ground doesn't) and
asymmetric (each melon suffers by its OWN contact curvature — hit them
with your flat side on their tip and only they smash). Near-lethal
landings flash the player white. A smashed melon vanishes for 0.1s,
then respawns on the surface at the smash point, still and briefly
protected. Bots smash by the same rule — headless measurement: the
hold-right pack is ~48% slower with smashing on. Skill now pays.

## Debris (js/debris.js)

Smashed melons burst into 16-22 rind/flesh fragments that inherit the
body's exact velocity field (v + w x r) — spinning deaths spiral, fast
deaths spray forward. Fragments bounce on terrain, collide with each
other while "hot" (~1.5s, spatial-hash), then settle cold and persist
for the whole race: lap wreckage accumulates and racers plow through it
(one-way — debris scatters, racers are never slowed). All randomness is
seeded per-smash, so identical runs produce identical carnage. Pool is
capped at 400 with oldest-cold eviction; off-world fragments are reaped.

## Track mode (lap circuits)

Tracks are recipes in js/tracks.js: { seed, lapLengthM, dropPerLapM,
laps }. The lap is generated from the seed as a template spanning
exactly (L, D), then tiled — terrain repeats every lap, offset downward
(a Penrose staircase): you descend forever but ride the same circuit.
Melon-vs-melon collision uses the minimum-image convention, so lapping
a rival is physical: they meet you through their periodic image.
Switch between Endless and tracks in the tune panel ("Track" section);
the HUD shows lap count, last lap, and best lap. The stopwatch freezes
at the finish line. Splits are tick-accurate and deterministic.

## Architecture

```
index.html        shell: canvas + HUD + debug mount
styles.css        overlay chrome only; the canvas is the game
js/               classic scripts sharing one `window.FF` namespace;
                  <script> order in index.html IS the dependency order
  config.js       SOURCE OF TRUTH: tunables + slider schema + derived values
  state.js        SOURCE OF TRUTH: everything mutable, with ownership contract
  physics.js      fixed-step sim: real ellipse collider, impulse solver, motor
  input.js        device events -> state.input.rawAxis, nothing else
  renderer.js     state -> pixels; owns camera + fx decay; never writes sim
  hud.js          state.telemetry -> DOM, throttled
  debug.js        tuning panel generated from config schema
  main.js         composition root + fixed-timestep loop
```

Ownership contract (who writes what) is documented at the top of `state.js`.
The rule that matters for later stages: **nothing presentational may feed
back into the melon slice** — that's what will keep ghost recording sane.

## Already wired for stage 2

- Terrain is an endless seeded stream: js/terrain.js generates chunks
  ahead of the melon and prunes behind (same seed = same track, always).
  Change SEED in main.js for a different world.
- The collider handles arbitrary segment angles and segment *endpoints*
  (vertices), so angled terrain needs zero physics changes.
- `state.telemetry.lastImpactVn` already records landing impact speed —
  the HUD shows it. Your break-threshold tuning data is already flowing.
- `state.tick` counts physics steps: it's the future replay/ghost clock.
