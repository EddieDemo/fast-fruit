# Flags — priority, build order, and the ones that are decisions

Written 2026-08-16, after the wraps shipped. Goal on record: **every
country flag, eventually.** This doc is the order, the reasoning, and
the handful of flags that are political or religious decisions rather
than art tasks.

Context for why flags matter more than other decals: the wraps turned
out to be a vector for national pride — people love declaring a
nationality — and a round body in correctly-proportioned national
colours reads instantly through the Polandball meme tradition, so a
wrapped melon arrives with ready-made comic personhood. Every flag
added is a whole population who now has *their* wrap to want. Flags
are the set that should grow forever.

---

## The two axes

"Which flags first" is really two questions multiplied:

* **Audience value** — browser game, English-first distribution,
  meme-literate web culture, football/Panini overlap.
* **Implementation cost under our primitives** — bands are free;
  disc and star exist; everything else is either a small new
  primitive or compiler-tier (the SVG outline compiler, not yet
  built, planned for Wales).

Some enormous audiences are nearly free (Indonesia is two horizontal
bands). Some small flags are expensive. Rank on the product, not on
either axis alone.

---

## Top 10 by audience value

1. **USA** — biggest web-game audience. 13 bands free; canton needs a
   rect primitive plus a star loop we mostly have.
2. **UK** — huge audience AND it unlocks a family: build cross/saltire
   machinery for the Union Jack and England, Scotland, Australia and
   New Zealand (UJ canton + star field) fall out nearly free. Five
   flags of demand for one composite's work.
3. **Brazil** — massive gaming population, deeply flag-proud. Honest
   version needs the compiler (globe + banner); a lozenge-and-disc
   simplification is recognisable but Brazilians will notice.
4. **India** — enormous mobile market; tricolour free, the Ashoka
   Chakra needs one small primitive (ring + 24 spokes). Worth building
   the primitive for this flag alone.
5. **Mexico** — big audience; eagle emblem is compiler-tier, and the
   bands-only version is Italy, so no shortcut exists.
6. **Indonesia** — vast mobile population, two horizontal bands, free
   today. Best value-per-line-of-code on earth. (Ships Monaco
   accidentally; they'll cope.)
7. **Philippines** — huge English-speaking web-gaming culture;
   triangle primitive plus sun/stars.
8. **Netherlands** — free today; strong meme-culture presence,
   orange-army sports identity.
9. **Canada** — the maple leaf is a single authored polygon (11
   points), a cousin of the star machinery, not compiler work. Loud,
   loyal audience.
10. **Nigeria** — Africa's biggest gaming population, free today
    (green-white-green).

---

## Build waves (how to actually sequence it)

**Wave A — free with today's primitives.** Indonesia, Netherlands,
Nigeria, Hungary, Austria, Belgium, Romania, Côte d'Ivoire; Ghana,
Senegal, Cameroon (band + star, already have both); and with one
trivial extension — **unequal band weights** — Spain (the civil
version is legitimately plain bands), Colombia, Thailand. Roughly a
dozen flags and their wraps in an afternoon.

**Wave B — one small primitive each.**

* *Crescent* (two-disc subtraction) → Turkey, Tunisia, Pakistan,
  and most of the Malaysia composite.
* *Cross / saltire* → the five Nordics, England, Scotland,
  Switzerland, Greece's canton cross.
* *Triangle* → Cuba, Czechia, Philippines, Jordan, Palestine.
* *Canton rect* → USA, Chile, Liberia, Malaysia, Greece.

**Wave C — compiler-tier** (the SVG outline compiler planned for
Wales): UK and family, Brazil, Mexico, Canada if not hand-authored,
Argentina's sun, India's chakra if not hand-authored, Portugal,
Wales, Sri Lanka, Albania.

---

## Strategic withholding — endorsed, with a refinement

Deliberately not shipping some flags generates demand and discussion
("beg for Kuwait"). The dynamic works best on **rivalry pairs**: ship
one half and the other half's fans arrive loud.

* England without Scotland
* Spain without Portugal
* Brazil without Argentina
* Greece without Turkey

That is *productive absence* — it reads as "not yet."

**But three pairs ship both-or-neither**, because splitting them
reads as a statement, not a teaser:

* **Russia / Ukraine**
* **Israel / Palestine**
* **China / Taiwan** — and note China already shipped, so Taiwan is a
  live decision with real app-store and market consequences whenever
  it comes up, not just an art task.

---

## Flags that are decisions, not art

**Saudi Arabia — hold indefinitely.** The flag carries the shahada,
the Islamic declaration of faith: sacred text, on an object that in
this game splatters down hillsides, gets crushed, and dies for
comedy. This is not a hypothetical sensitivity — the games and
merchandising industries have real precedent:

* The best-documented case is the **1994 World Cup McDonald's
  incident**: Saudi Arabia's flag was printed on disposable Happy
  Meal bags alongside the other qualifiers', meaning sacred text was
  being crumpled and thrown in the bin. It caused genuine offence and
  an apology/withdrawal, and it taught sponsors and FIFA's licensing
  world a lasting lesson: **the shahada does not go on surfaces that
  get abused.** Since then, tournament merchandising has repeatedly
  excluded or modified the Saudi flag on disposable and wearable
  items (footballs themselves being a canonical example — a flag that
  may not be kicked), sometimes generating its own controversy in the
  other direction.
* The relevant reading for us: a melon is the *most* abusable surface
  in this game. Its whole job is to be destroyed charmingly. The
  deadpan register does not protect us here the way it does for
  ordinary flags.

Bangladesh-style geometric flags of Muslim-majority countries are
fine (we ship Bangladesh already); the issue is sacred *text*
specifically — which also covers a few others when we reach them
(e.g. Iraq's takbir, Iran's border script, Brunei's crest text at
any legible size).

**Afghanistan — hold.** Choosing *which* flag (republic tricolour vs
Taliban-era shahada flag — which is also a sacred-text case) is
itself a political act right now.

**North Korea — legal, but a statement.** Fine to ship mechanically;
just know that including it is read as a choice, and so is excluding
it. Low demand either way; no rush.

None of the held flags are top-of-demand, so the cost of holding is
low. Revisit this section whenever the catalogue approaches
completeness, since "every flag eventually" will collide with this
list and the collision should be decided consciously.

---

## Next action

Wave A plus the unequal-band-weights tweak: one short session,
~13 flags and 13 wraps, including Indonesia and Nigeria — two of the
largest audiences on the list — for effectively nothing.
