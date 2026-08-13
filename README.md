# Fast Fruit — the game

Everything needed to run it. Vanilla JS/HTML/CSS, zero dependencies,
works from `file://`.

```
index.html          the page; the script order IS the dependency order
styles.css          global styles (lanes, HUD, panels)
js/                 40 modules + the service worker + manifest
```

Open `index.html`. That's it.

**Developer tools** (Shader Studio, tune panel, ring logger) are hidden
by default: **tap the title on the main menu five times**, or add
`?dev=1` to the URL. `?dev=0` turns them off again.

---

## The modules, roughly in load order

**Foundation**
| File | Role |
|---|---|
| `type.js` | The type scale: named steps, tracking, colour roles, generated as CSS variables. |
| `devtools.js` | The five-tap gate. Dev surfaces register; nothing else knows they exist. |
| `dmath.js` | Deterministic maths (mulberry32, pinned trig). No `Math.random` reaches the sim. |
| `config.js` | Every tunable, the presets, and the roster/brain assignment. |
| `fruits.js` | The species registry: shape, anchor bands, flesh bands, patterns. |

**Simulation** (deterministic; identical on every peer)
| File | Role |
|---|---|
| `state.js` | The world: bodies, inputs, race book, grid placement. |
| `terrain.js` / `tracks.js` | Procedural terrain and the daily/cup track definitions. |
| `damage.js` | The damage law: dissipated energy, shape toughness, the flare mapping. |
| `pilot.js` | The splat predictor and the brain registry (`cruise`, `oracle`). |
| `physics.js` | The step: torque, contacts, the smash rule, the grid pin. |
| `debris.js` | Wreckage. |
| `gridstart.js` | Pre-race sequence: camera pan, waiting grid, tick-based countdown. |

**Presentation**
| File | Role |
|---|---|
| `renderer.js` | Everything drawn: bodies, terrain, camera, place labels, the practice ring. |
| `shading.js` | The lighting law, palettes, anchor colours, pulp. |
| `hud.js` | The HUD, and it publishes its own measured footprint for the lanes. |
| `input.js` | The floating thumbstick: circular gamut, radial deadzone. |
| `flow.js` | The state machine and every screen: menu, race, pause, finish, confirm. |
| `ticker.js` | Commentary lines. |
| `deaths.js` | The death overlay and its coach line. |
| `audio.js` | Sound, and the mute setting the pause screen owns. |

**Race meta**
| File | Role |
|---|---|
| `cup.js` | The daily cup: four legs, 12→1 scoring, attempts, the day record. |
| `finishline.js` | Finish-time estimation (and the exact fast-forward it was validated against). |
| `racewatch.js` | The observer: places, overtakes, laps, streaks, superlatives, pace. |
| `events.js` | The presentation-tier event bus. |
| `melon.js` | Your melon: seed derivation, the stat card, the career record. |
| `names.js` | The cast, and name-keyed brain assignment. |
| `resume.js` | Snapshot and restore of a race in progress. |
| `autopilot.js` | The post-flag handover. |
| `exhibition.js` | The background race behind the menu. |
| `ghost.js` | Ghost racer and challenge codes — **currently off** (`CONFIG.ghosts`). |

**Multiplayer** — `mp.js`, `net.js`, `webrtc.js` (lockstep, inputs only)

**Dev only** — `studio.js` (Shader Studio), `debug.js` (tune panel)

**PWA** — `sw.js` (service worker; not loaded by `index.html`, it is
registered at runtime), `manifest.webmanifest`

---

## Things worth knowing before changing anything

- **Script order in `index.html` is the dependency order.** Modules
  are IIFEs hanging off `window.FF`; there is no bundler.
- **Determinism is load-bearing.** Anything inside the sim uses
  `dmath` and the seeded streams. A stray `Math.random`, or a change
  to the order bodies are stepped in, breaks lockstep multiplayer and
  every replay.
- **Presentation may diverge between peers; the sim may not.** Colour,
  commentary, camera and FX are free to differ. Physics is not.
- **The tests are in `tests/`** — run them after any change to the
  laws. `tests/README.md` explains what each protects.
