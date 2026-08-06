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

- Terrain is a polyline; ramps and slopes are just more points in
  `buildFlatLevel` (rename it when you do).
- The collider handles arbitrary segment angles and segment *endpoints*
  (vertices), so angled terrain needs zero physics changes.
- `state.telemetry.lastImpactVn` already records landing impact speed —
  the HUD shows it. Your break-threshold tuning data is already flowing.
- `state.tick` counts physics steps: it's the future replay/ghost clock.
