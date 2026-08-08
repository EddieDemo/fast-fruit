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

## Launch checklist

Before the first public push:
1. Replace every `SITE_URL` in index.html with the deployed URL
   (absolute URLs are mandatory for link previews).
2. Point the "YOUR AD HERE" house billboard (js/billboards.js) at a
   real booking page, or leave url null.
3. Deploy once, then paste the URL into a messenger to confirm the
   preview card renders (icons/og.png).
4. PWA: manifest.webmanifest + sw.js ship ready; sw is network-first,
   so deploys stay fresh and the game works offline after first load.
5. Name: "Fast Fruit" is provisional — rename pass pending decision.

## Racer names (js/names.js)

Every racer — player and bots alike — draws a name from a 36-strong
Worms-style cast (puns, menace, and aggressively mundane secret
weapons). Assignment is a seeded Fisher-Yates off the race seed, so
every peer, ghost, and daily shares the same canonical roster.
Nameplates render in Geist Mono in each fruit's color: x tracks the
fruit, y anchors to the terrain surface — a shadow-label that stays in
the floor while its fruit tumbles overhead. The cast list is a content
file: edit js/names.js freely, engine untouched.

## Trackside billboards (js/billboards.js + js/boards.js)

Diegetic, flow-preserving ad space. js/billboards.js is the booking
sheet — edit, commit, deploy; git IS the ad server. Entries carry
from/to dates (client filters daily), optional url, colors. House ads
fill unsold slots so the world never looks vacant. Boards place
themselves deterministically on flat breathers (~6 per lap, well
spaced), are never on the racing line and NEVER clickable mid-race;
links appear only on the post-race sponsor line. Content is
presentation-only — the sim never sees it, so lockstep and ghosts are
untouched. Manual commit is the editorial approval step: everything on
these boards ships under your name.

## Private multiplayer (2-4 friends)

Deterministic lockstep over WebRTC — peers exchange ONLY inputs (a few
bytes per tick) because every machine runs the bit-identical sim:
js/dmath.js supplies cross-engine deterministic sin/cos/pow (Math.* is
not spec-pinned), js/net.js is the delay-based lockstep core (6-tick
input delay ~50ms), js/webrtc.js is a zero-server P2P transport with
copy-paste signaling, js/mp.js is the host/join UI (the "mp" button,
bottom-right). Host picks 2-4p, sends each friend a code over any
messenger, pastes their reply, hits START. Host is slot 0 and relays
guest inputs. During a net race, respawn/auto-restart/mode switching
are disabled (they'd desync). Verified headless: three simulated peers
over latency links, full 12-body sim + debris, bit-identical at tick
3000. The WebRTC/UI layer itself is browser-only and needs live
testing. Known limits: no TURN fallback (~10-15% of network pairs
won't connect), no rejoin after disconnect, no synced rematch yet.

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

Smashes are tessellated, contact-aimed, and conservation-honest:
~66 fragments spawn AS cells of the dying ellipse (frame zero looks
like the melon with cracks in it, never a swap), sized by fracture's
power law (few big rind slabs, many flesh flecks) to ~1.2x the
silhouette area — a melon is a volume, and its hidden depth unpacks
onto the ground. The burst aims along the killing blow's escape
normal: crush-zone flecks near the contact, surviving slabs on the far
side; a nose-dive sprays forward, a pancake slam squirts sideways, a
rival hit throws you away from the rival. Each smash also leaves a
persistent dark stain on the terrain (the liquid to the fragments'
solids). Fragments inherit the body's velocity field (v + w x r),
bounce on terrain, collide while hot (~1.5s, spatial-hash), then
settle cold for the race. Everything is seeded per-smash and
deterministic. Pool capped at 900 with oldest-cold eviction; the
ORIGINAL center-radial burst survives as debris.confettiBurst,
reserved for balloon pops (docs/physics-witnesses.md).

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
