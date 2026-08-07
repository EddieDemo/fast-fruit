# Pulp Friction — Meme-ability & Virality Strategy

*Games don't go viral — artifacts of games go viral. Design notes for
maximizing audience; no code yet. Implementation follows the sequence
at the bottom.*

---

## 1. The two structural assets (and their fine print)

### Accessibility
The genuinely viral browser games of the last decade — Wordle,
Agar.io, Slither, 2048 — share one profile: zero install, zero
tutorial, input understood in one second, session in one minute.
"Hold left/right or nothing" is about as close to the theoretical
floor of input complexity as a physics game gets, and it demos in a
single sentence.

- **Camera consistency is spectation quality**, not just fairness:
  every clip anyone records looks like the game everyone else plays,
  so clips are *accurate advertisements*.
- **Gap to close:** the current chrome (tune panel, HUD rows) is a dev
  cockpit, not a first-time experience. Viral traffic is 95% people
  who will never open a menu. A "clean mode" default with the cockpit
  behind a toggle is cheap and matters enormously: link → melon
  rolling → dead → grinning, inside ten seconds.

### Fun while skill-less: the two fun engines
Most games have one fun engine; this has two.

1. **Slapstick** — chaos, leapfrogging, explosions. Funny with zero
   input, i.e. entertaining *to people who are bad at it* — which is
   99% of any viral audience.
2. **Mastery** — the smash rule, landing prep, the measured 30–48%
   skill gradient over the bots.

**Design rule:** as depth is tuned, never let engine one die. The
hold-right pack staying competitive-but-doomed is not a balance
failure — it is **the comedy floor**, and the comedy floor is what
makes clips funny to people who've never played. Protect it like a
feature, because it is one.

---

## 2. The artifact factory (ranked by leverage)

### 2.1 The challenge link — crown jewel, nearly built
Determinism means a run is `(seed, time)`, so *"I did 1:47.2 on this
exact track — beat me: [link]"* is a URL. The ghost system makes the
loss visible: you race their translucent, corpse-strewn ghost.

Wordle's share mechanic wearing a helmet: the artifact contains the
**challenge, the proof, and the invitation in one link**, needs zero
backend, and every share is a targeted recruitment of exactly one
motivated player. Highest-ROI build remaining in the project; most
plumbing (seeds, determinism, tick clock) already exists.

### 2.2 Engineer the clippable moment
People share *moments* — manufacture their capturability:

- **Death-cam:** slow-mo beat or freeze-frame on your own smash. The
  death replay is the punchline of the whole game; at full speed you
  miss your own comedy.
- **Native clip share** of the last ~8 seconds: canvas → WebM, or the
  deterministic-replay trick where the "clip" is just data
  re-rendered. Even phase one — a dramatic death-cam that makes
  screen-recording irresistible — moves the needle.
- The black-void-neon aesthetic is accidentally perfect: it reads
  instantly at feed compression, in thumbnails, at tiny sizes.
  **Do not "improve" it into visual mush.**

### 2.3 The Daily Grind — ritualize it   [CONFIRMED: building this]
One shared seed per day; everyone races the same track; share your
time. Dailies convert one-shot visitors into returners and give feeds
a *recurring reason* to mention the game — Wordle's true genius was
the ritual, not the puzzle.

- **Decision: the seed IS the day's date** (e.g. seed = YYYYMMDD or a
  simple function of it). Human-readable, self-describing, and anyone
  can reconstruct any day's track forever.
- ~Ten lines: date-derived seed + a "Daily" button.
- Synergy: the billboard system gets stakes — today's boards on
  today's track that everyone sees.

### 2.4 Name the deaths
The game *knows why* you died — tip-first at 19 m/s, squashed by the
pack, (eventually) the tunnel roof. Surface it:

- "CATASTROPHIC NOSE LANDING — 19.2 m/s"
- "PULPED BY 3 RIVALS"

Named deaths become vocabulary; vocabulary becomes memes; death
screens become screenshots. Getting Over It / Fall Guys DNA: the game
*commentating on your failure* is what people paste into group chats.
Cost: a lookup table and a text line. Add rarity flourish ("only 2% of
racers die this way") and failure becomes collectible.

### 2.5 Spectacle-first multiplayer moments
- The mid-air two-player collision where one bursts on both screens is
  the trailer shot.
- **Grudge rematch link** after a private race (same seed, same fruit
  slots) turns every friend-race into a series.

---

## 3. Build sequence (producer hat)

Before ANY acquisition push:

1. **Clean mode** (cockpit behind a toggle) + **a death screen worth
   screenshotting** (named death + your time + one-tap retry).
2. **Challenge link** (seed + time + ghost in a URL).
3. **Daily** (date-derived seed).
4. Only then spend on acquisition — traffic sent at a game without
   share-artifacts is water through a sieve; the mechanics above are
   the sieve-mending.

Later: death-cam/clip share, grudge rematch, rarity lines.

## 4. Distribution beachheads

Matched to the product:

- **Web-game communities first:** itch.io, r/WebGames-style
  ecosystems.
- **The engineering story is itself a viral artifact** for the dev
  audience — "I built a deterministic-lockstep physics racer in
  vanilla JS" is a Hacker-News-shaped post, and dev audiences seed
  games.
- **Web portals** (Poki/CrazyGames class) are a real later channel
  that also intersects monetization.

---

## 5. One-line summary

The accessibility and the comedy already exist; what's missing is the
**packaging** — challenge links, dailies, named deaths, clippable
failure. All small against what's built, most of it rides on
determinism already paid for, and every piece is an artifact factory.
