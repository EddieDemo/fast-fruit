# Pulp Friction — Ideas Backlog (High-Value, Undiscussed-Elsewhere)

*Seven additions beyond the existing design docs (tracks, billboards,
fruit roster, virality). Ranked at the bottom.*

---

## 1. Sound — procedural, physics-driven  [IN PROGRESS]

The biggest omission in the project: silent slapstick is a mime;
slapstick with a wet splat is Chaplin.

- **Web Audio synthesis driven by the sim's own numbers** — no asset
  files, keeps the zero-dependency purity, fully presentation-side
  (no determinism risk).
- Rolling = filtered noise tracking omega and ground contact.
  Landings = thuds scaled by the same impulse the smash rule computes.
  Smash = noise burst + low squelch sized by severity. Debris patters.
  Bot smashes audible, distance-attenuated and stereo-panned.
- Because every sound derives from physics state, audio is *honest*:
  players learn to hear an over-speed landing coming — a skill
  channel, not just juice.
- Clips with funny audio travel categorically better than mute ones;
  the smash-squelch alone should raise clip share-rate.
- Mobile haptics: `navigator.vibrate` on landings/smashes — two lines.
- Constraint: browsers require a user gesture to start audio; first
  touch (which the control scheme guarantees) unlocks it. Mute toggle
  persisted in localStorage.

## 2. The commentary ticker

One-line text ticker announcing sim events: "NIGEL TAKES THE LEAD" ·
"GOURDZILLA HAS BEEN PULPED" · "JUST DAVE SURVIVES A 19 m/s LANDING" ·
"COLIN THE MELON: LAP 2 PERSONAL BEST."

- Event detection is trivial (lead changes, smashes, near-misses,
  splits are all already known).
- The writing is a content file, like the cast list.
- Transforms a physics sandbox into a *broadcast*: races generate
  narrative in real time — exactly what makes spectating and clips
  funny. The names are a loaded gun; this fires it. An afternoon.

## 3. Melon TV — the attract mode

When idle on the title (or post-finish), run a bots-only race with a
roaming director camera cutting to lead battles and imminent smashes,
ticker running.

- Arcade attract-mode tradition; solves the first-ten-seconds funnel:
  a new visitor's first three seconds become *watching melons explode*
  instead of parsing UI.
- Free ambient footage for portals/streams; doubles as a demo of
  every feature. Small cost: existing sim + camera logic.

## 4. Last Melon Standing — a second ruleset

Same physics, no laps: a rising kill floor (or smash threshold
tightening every ~10s); last survivor wins.

- Reuses everything (smash rule, debris, names, lockstep).
- Inverts the skill: survival pacing instead of speed.
- Natural party mode for private multiplayer; battle-royale framing is
  meme-legible to everyone.
- Deeper point: modes are cheap once physics is rich, and a two-mode
  game reads as a *game*, not a demo.

## 5. PWA installability + offline

Manifest + small service worker → installable to home screen,
full-screen, and (being dependency-free static files) fully playable
offline.

- Converts "link I saw once" into "icon on my phone" — the retention
  step between virality and habit.
- The daily seed gives the icon a reason to be tapped. An afternoon.

## 6. The career sheet — local persistence

LocalStorage lifetime stats: total distance, smashes suffered *and by
which named rival*, deaths-by-type, best dailies, longest air.

- Stats are share-artifacts: "2,341 lifetime smashes, 78 caused by
  Gourdzilla" is a screenshot.
- Substrate for later cosmetic unlocks (trails, melon patterns — pure
  renderer candy, zero balance impact) if soft progression is ever
  wanted.
- Deliberately no accounts, no backend: on-device, zero-infrastructure
  ethos preserved.

## 7. Accessibility as reach

- Colorblind-safe palette toggle (current racer colors are red/green
  hostile).
- Reduced-motion option (skip screenshake/flash).
- One-switch play: a single held button = right, release = coast — one
  option flag away from adaptive-switch playable.
- Small work, real audience expansion, and the write-up is itself a
  distribution story.

---

## Ranking

1. **Sound** — non-negotiable before launch; a silent physics comedy
   leaves half the medium unused. Highest value-per-effort item left.
2. **Ticker** — cheapest large multiplier; compounds with names and
   future clips.
3. **Melon TV** — fixes the first-ten-seconds funnel.
4. **Last Melon Standing** — makes friend groups stay a second hour.
5. **PWA** — retention plumbing.
6. **Career sheet** — personal stakes + share-artifacts.
7. **Accessibility** — principled reach.
