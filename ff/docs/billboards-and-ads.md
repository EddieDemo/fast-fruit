# Pulp Friction — Trackside Billboards: Design, Business & Implementation

*Flow-preserving, diegetic ad space: everything discussed and everything built.*

---

## 1. The founding principle

The core objection to mobile-game advertising is that it **interrupts
flow** — interstitials, forced video, reward gates. The billboard idea
inverts this: ads live *inside the world* as literal trackside signs,
the way real race tracks carry real billboards. The player is never
stopped, never gated, never asked to watch anything. Impressions happen
in motion; interaction happens only at rest.

Everything else in this document serves that principle.

---

## 2. Industry context (what exists, what doesn't)

- This category is real: **intrinsic in-game advertising (IGA)**.
  Racing games are its founding genre — trackside boards were among the
  first programmatic in-game placements because racing has natural,
  diegetic ad real estate.
- Networks to know (verify current state when relevant): **Anzu,
  Frameplay, Adverty**. They serve programmatic creatives onto in-game
  surfaces and — critically — solved **viewability measurement**
  (on-screen, sufficient size, unoccluded, long enough, to IAB-blessed
  standards). Measurement acceptance is what unlocked advertiser
  budgets.
- **The gaps for us:**
  1. *Platform* — the SDK ecosystem grew up in Unity/Unreal; support
     for a vanilla-JS browser game may be thin. (The web is, however,
     the easiest place to roll viewability math yourself — we know
     exactly when a board is on screen, at what size, for how long.)
  2. *Scale* — programmatic deals talk in millions of monthly
     impressions. A launch-week indie browser game won't clear the
     floor. **Programmatic is not a launch plan.**
  3. Browser-game monetization is generally harder than app stores.

**Verdict:** build the real estate now (cheap, flow-preserving,
on-brand); let tenants arrive in whatever order growth allows.
Programmatic stays a door on the latch, not a launch dependency.

---

## 3. The indie-shaped revenue modes

In ascending order of scale required:

1. **Direct sponsorship** — sell boards yourself to niche-adjacent
   brands, podcast/newsletter style. "Your logo trackside in every race
   this month." Needs nothing but an email address and a payment link.
2. **Player-purchased boards** — the sleeper hit. Birthday messages,
   "PROPOSAL AT LAP 3," clan tags, memorials. This isn't advertising,
   it's *merch made of world-space* — monetizing affection rather than
   attention. Built-in virality: the buyer sends their friend a link to
   the game to see the board, so **every sale recruits at least one new
   player who arrives delighted**.
3. **Indie cross-promo** — other developers advertise their games on
   your boards (paid or swapped), Flash-portal style.
4. **House ads** — your own games/features as permanent filler tenants.
   Boards are never empty, the world always looks inhabited, players
   learn boards are *a thing* before anyone pays, and your portfolio
   cross-promotes itself.
5. **Programmatic via an IGA network** — the graduation option, if
   traffic ever justifies it.

---

## 4. Design doctrine (enforced in code)

- **Never on the racing line.** Boards place only on flat "breather"
  spans — exactly where the pacing grammar puts low-attention moments.
- **Never clickable mid-race.** Links exist ONLY on the post-race
  sponsor line, when the player is at rest. Impressions in motion,
  clickthrough at rest.
- **Diegetic and consistent** — dark panels on posts, Geist Mono,
  matches the world; background layer, never occluding terrain being
  read at speed.
- **Scarcity is the product.** ~11 boards per 400m lap at current
  spacing (`MIN_SPACING` in boards.js is the dial). Fewer slots =
  meaningful inventory = a price ladder (finish-straight premium,
  back-country discount).
- **Lap identity:** in track mode, a board at lap-position *p* is the
  same board every lap — content keys off position-within-lap, so
  period images of one board always show one ad. Familiarity builds
  value.

## 5. Architecture (why this can't break the game)

- **Positions are world furniture:** a pure, deterministic function of
  terrain geometry (flat spans >= 260px, grade <= 3%, spaced apart).
  Identical for all lockstep peers, stable across frames, ghost-safe.
- **Content is presentation-only:** the sim never reads what's on a
  sign. Two multiplayer peers could see different ads without
  desyncing (we don't do this, but the wall exists). Determinism,
  lockstep, and ghosts are untouched *by construction*.
- This mirrors the renderer's existing world/UI split.

---

## 6. What's implemented

**`js/billboards.js` — the booking sheet.** Git IS the ad server:
edit, commit, deploy. Entry fields:

| field  | meaning                                                    |
|--------|------------------------------------------------------------|
| `id`   | unique reference (use as invoice number)                   |
| `text` | main line — short, readable at speed                       |
| `sub`  | optional smaller second line                               |
| `from` | first active day `YYYY-MM-DD` (inclusive, local)           |
| `to`   | last active day (inclusive)                                |
| `url`  | optional link — post-race sponsor line ONLY                |
| `bg` / `fg` | optional colors                                       |

House ads omit `from`/`to` and run forever as filler. The client
filters daily, so **one deploy carries weeks of scheduled bookings**
("HAPPY BIRTHDAY DAVE" committed today, appearing only on the 20th).
Paid bookings sort ahead of house ads, taking the earliest (most-seen)
slots.

**`js/boards.js` — the engine.** Deterministic placement scan with
caching; minimum-image rendering in periodic worlds; auto-fitting text;
the post-race sponsor line ("trackside: X · Y · Z") with `target=_blank`
links, shown only when a track race is finished.

**Verified headless:** placement determinism per seed; flat-only +
spacing respected; lap-position → ad mapping consistent across period
images; date filtering (past/live/future bookings) correct.

---

## 7. Business operations

**Workflow per booking:**
1. Buyer pays (Stripe payment link / Ko-fi tier) + submits text via a
   simple form/email.
2. **You review** — this is the editorial gate.
3. Add entry to `billboards.js`, commit, deploy.
4. Booking activates/expires automatically by date.

**Editorial control is not optional.** Everything on these boards ships
under your name into other players' races. Policy minimums: right to
refuse anything, no impersonation, no trademark abuse, refund if
declined. Manual-commit-as-approval *is* the moderation layer, and at
this scale it's an advantage, not a limitation.

**Pricing thoughts:** scarcity ladder by slot desirability
(finish-line straight > mid-lap breather); duration tiers (day / week /
month); player messages priced as a gift product, sponsor boards priced
as media. Keep it simple until demand teaches you otherwise.

**Regulatory footnote:** if the game attracts a young audience,
in-game advertising to minors carries active rules (disclosure
requirements, COPPA-adjacent concerns in the US, stricter EU/UK
regimes). Another reason to keep content under editorial control rather
than fully programmatic in early days. Not a today-problem; keep it in
pocket.

---

## 8. Future work

- **Finish screen:** solo auto-restart currently gives ~3s to read the
  sponsor line — fine for awareness; a proper post-race screen should
  give sponsors a real home (and is where clickthrough lives).
- **Image creatives:** entries could carry an image URL (logo boards)
  — needs sizing rules and the same editorial review.
- **Booking page:** a simple static page (linked from the "YOUR AD
  HERE" house board) with prices, rules, form, and payment link.
- **Slot-level booking:** let buyers choose a specific board position
  ("the one before the big kicker") once tracks are named and known.
- **Self-serve viewability stats:** we can count on-screen board
  seconds locally and show sponsors honest reach numbers — the indie
  version of what the IGA networks sell.
- **Programmatic:** revisit Anzu/Frameplay-class networks only if
  monthly impressions reach the millions.

---

## 9. The one-paragraph summary

Billboards are launch-cheap, flow-sacred, and deterministic-safe world
furniture with three immediate revenue doors — direct sponsors, player
gift boards, indie cross-promo — operated through a JSON-ish file in
git with manual commits as editorial approval, house ads as permanent
filler, and links confined to the post-race moment. Programmatic ad
networks exist for exactly this format but gate on scale we won't have
at launch; the system is built so that door stays open without
depending on it.
