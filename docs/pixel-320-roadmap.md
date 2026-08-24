# PIXEL 320 — the vector-to-pixel rendering roadmap

Ruling (Eddie, 2026-08-18): the pixelated aesthetic is the direction,
locked at 320 internal width — the literal Sega OutRun-board
resolution (Out Run, Super Hang-On, Turbo Out Run all ran 320x224).
This document is the refactor plan: foundations first, then painters,
then finesse, then lighting. Render-tier only throughout — the sim,
determinism, and the honest-physics thesis are untouched by every
phase. Each phase ships independently and is reversible.

## The governing facts

At 320 under the shipped camera box law, the melon is a 16-18 px
sprite (1920x1080: 16 px; phones: 18 px). Out Run's Testarossa was
~80 px on the same 320 — our hero body is Game-Boy-enemy sized, not
Sega-hero sized. Every LOD decision below flows from this number.
The measured session findings that shape the plan: per-frame
rasterization of small bodies boils (cured by baking); canvas 2D
cannot disable AA (cured by majority vote at bake, local-resolve at
runtime); blends must be resolved locally, never globally; lighting
through multiplication reads as filtering (all lighting moves through
palette steps).

## Open rulings (needed before their phases, not before Phase 0)

R1 — MELON SCREEN SIZE. Keep the 16m box (melon 16-18 px, more
lookahead, racing-at-a-distance read) or add a px-mode camera box
(e.g. 10-12 m wide -> melon 24-29 px, the Sega hero-sprite read, less
lookahead). Silhouette=collider is unaffected either way — this is
the camera's lens, not the body. Interacts with the parked
landscape-width-parity ruling; decide together.

R2 — SQUASH BAKE. Live-transform squash (current, brief resample on
impact) vs canonical-axis bake (64 rot x 3-4 magnitudes, ~4x bake).
Eddie is watching splats at speed before ruling.

R3 — PATTERN LOD. How much identity each fruit keeps at 16-18 px
(see Phase 2). Needs a proof sheet before ruling.

## Phase 0 — Foundations (everything else stands on these)

0.1 SEMANTIC PALETTE MODULE (js/palette.js). The single foundational
change. A global table of NAMED ramps — rind[0..2], stripe[0..1],
ground[0..2], dirt[0..1], sky[0..3], rim, highlight, per-bot accent —
each ramp a short ordered tone list. COLORS and litColor's band
outputs re-plumbed to RESOLVE through the table instead of computing
free RGB. The four-band cel shading already gives the structure
(bands = ramp indices in waiting); this phase adds the indirection.
Rule: band softness pinned to 0 in px mode (softness > 0 is a
gradient, the forbidden move).

0.2 GRID-HONESTY TELEMETRY. The dominant-snap histogram already
counts non-genuine pixels per frame; expose it as FF.PX_STRAYS and
add verify-px-honesty (headless: render known scenes via the bake
painters, assert stray counts under budget, assert every emitted
colour is a palette member). The corrective passes (dominant-snap,
local resolve) are re-labelled SCAFFOLDING: they stay load-bearing
now, decay to safety net as painters become grid-honest, and the
suite is what proves each decay step.

0.3 PX-SPACE CONVENTIONS. One documented coordinate contract: the
320-wide buffer is the pixel grid; camera mapping quantised (shipped);
all painter positions integer in px space; no fractional lineWidths.
A tiny helper set (pxRect, pxLine, pxDisc — Bresenham circle) that
painters migrate onto phase by phase.

## Phase 1 — Terrain and world paint (biggest screen area first)

1.1 STROKE TABLE. Authored integer widths at 320: surface stroke 1px,
slab edge 1px, danger edges 1px in accent. Kills the dashing/vanishing
stroke class measured in the first proof.

1.2 VERTEX SNAP. Terrain polylines snap to the px grid before stroke/
fill, so the vote and the rasterizer never adjudicate half-pixel
edges. (World geometry untouched — snap happens in the screen
mapping.)

1.3 BANDED FILLS + DITHER. Slab tops and bodies painted from ramps;
depth shading as Bayer 4x4 ordered dither between adjacent ramp tones
instead of gradients. This one change carries most of the Sega ground
read.

1.4 TILE BAKE (optional finesse). Repeating baked textures for grass
top / dirt body (8x8 or 16x16 tiles from the ramps, hand-tuned once),
blitted along slabs. Ships after 1.3 proves the banded look; tiles
are the authored upgrade of it.

## Phase 2 — Melons at authored quality

2.1 LOD-AWARE VECTOR PAINTER. The painter gains a pixel-radius
argument and simplifies below thresholds: stripe count clamps (a 16px
melon carries 2-3 stripes, not 6), micro-details (netting, crackle
fine lines) drop below r=12, decal minimum feature size enforced
(features under 1.5 bake-px are omitted, not mushed). Fruit identity
at small radius is a design pass per species — proof sheet for R3.

2.2 BAKE GUARANTEES. Post-vote passes that encode artist judgment:
silhouette ring forced complete (1px rim tone — the vote may erode
corners; artists never let the silhouette break), highlight preserved
(if the vote erases the highlight feature, re-stamp its 1-2 px from
the highlight tone). Both deterministic, both cheap, both proofed.

2.3 INDEXED SPRITES. Bake emits Uint8 INDEX maps (palette indices per
pixel) plus a resolve step to RGBA against the current palette table.
This is what makes Phase 5 free: a light-state change re-resolves
every sprite and tile from the same indices — zero re-bake.

2.4 GHOSTS AND FLASH. Ghost translucency becomes a dedicated dim
ghost-ramp (alpha retired); the white impact flash becomes a 1-frame
resolve through the flash column. Same mechanism, no special cases.

2.5 SQUASH per R2. If canonical-axis bake wins: frames at 64 rot x
3-4 magnitudes along one axis, blit picks by relative angle of impact
axis to body rotation. Sun-angle fidelity is NOT multiplied in —
impact frames reuse the nearest lighting frame (2-3 frame transients
don't read lighting).

## Phase 3 — Text and signage

3.1 BITMAP FONT. One authored 3x5 (and 5x7 for headline) pixel font,
blitted 1:1: place tags, name labels, billboard copy, finish banner.
In-world canvas text is retired entirely — it is unsalvageable at 320
and was the first measured casualty.

3.2 BILLBOARD BAKE. Boards become baked signs (frame from ramps, copy
in the bitmap font), keyed by message. The sponsor-line machinery
feeds the bake instead of live text.

## Phase 4 — Background and atmosphere

4.1 PARALLAX STRIPS. 2-4 baked bands (horizon, hills, cloud line),
each scrolling at its own rate and snapped to its OWN pixel grid (the
temporal rule: nothing moves by less than one screen pixel). This is
mostly NEW art surface the retro direction unlocks, not conversion.

4.2 SKY BANDS. The sky fill becomes 3-4 ramp bands with dithered
boundaries — the Out Run sunset mechanism, ready to be driven by
Phase 5's light states.

## Phase 5 — Lighting (stands on 0.1 + 2.3)

5.1 LIGHT STATES AS TABLE COLUMNS. The palette table gains columns:
BRIGHT / STANDARD / DIM / DARK (strength) and optionally hue-cast
states (golden final lap, tunnel cool). A global light state selects
the column; every indexed sprite and tile re-resolves. Stepped states
only — interpolation between columns is forbidden (it re-creates
multiplication). Transitions are timed step sequences, which is
period-correct (Out Run's sunset steps).

5.2 SUN ANGLE AS BAKE DIMENSION. The cel terminator already derives
from a world-fixed sun; the bake samples N sun angles (start at 4) as
a sprite dimension: 64 rot x 4 sun frames per variant. Overhang
shadow = the region's light state driving both the column (5.1) and
the sun frame choice. Memory math at 18 px: ~1.3 KB/frame, 64x4 =
~330 KB per variant-state — acceptable; revisit if variants explode.

5.3 LOCAL SOURCES. One-or-few dynamic sources as pixel-space ramp
shifts: inside radius R, resolve indices +1 step brighter; the
boundary ring dithered, never faded. Multiple sources take the max
shift, capped at ramp top. Cheap at 320; counts kept small by design
budget (2 concurrent), because each source's ring is a per-pixel
pass.

## Order and verification

Ship order: 0.1 -> 0.2/0.3 -> 1.1-1.3 -> 2.1-2.3 -> 3.1 -> (R2, R3
rulings land here) -> 2.4/2.5 -> 3.2 -> 1.4 -> 4.x -> 5.x. Every
phase: PIL proof before code ships, verify-px-honesty extended with
named checks per phase, stray-count budget ratcheted DOWN as painters
convert (the suite enforces that scaffolding decays instead of
quietly persisting). Baselines: px mode is render-tier, so sim
baselines are untouched by construction — the determinism double-run
stays in the battery as the tripwire.

## Phase 0 — SHIPPED (2026-08-18)

R1 ruled: 16m box stays; 320 locked as the shipped pixel width (the
cycle button is now VECTOR/320; FF.PIXELATE_W remains a dev tunable).
Delivered: js/palette.js (semantic registry over the shading law —
NOT a second colour system; the law's cache-fill sites and the seeded
anchors register their tones, world statics/bot accents/place colours
register at renderer init); softness pinned to 0 in pixel mode via
effSoft at the band read sites (studio slider untouched in vector
mode); FF.PX_STRAYS telemetry published every pixel frame before the
all-common early return; verify-px-honesty in the battery (registry
roundtrip, law-tone capture, softness pin, telemetry shape, negative
control). Battery 25/28 — the 3 are the parked decals set. Light
STATES reserved as ['STANDARD']; columns land with Phase 5 on the
Phase 2.3 indexed sprites.

## Phase 1 — SHIPPED (2026-08-18)

R4 ruled: quantized anchors acceptable provided melon variety
survives (generous menu; lands with Phase 0.5, folded into the Phase
2 work). Delivered in pixel mode only, vector byte-identical: 1.1
solid pre-composited grid tones replace alpha hairlines (PX_GRID
ramp, registered; +0.5 hairline convention dropped on the pixel
grid; integer tier widths); 1.2 vertex snap — every terrain vertex,
tint column, and finish post lands on the integer grid via tsx/tsy;
1.3 banded ground — surface (+8 L*) and underside (-8 L*) bands
derived from bandColor() of the ground grey, so they register through
the law hook and will follow Phase 5 light columns for free; Bayer
dither deferred to Phase 4's sky bands where gradients actually live.
Suite: F1/F2 added (grid tones registered, bands law-derived and
members). Battery 25/28 (parked decals set). PIL proof:
phase1-terrain-proof.png.

## Phase 0.5 + Phase 2 (2.1-2.3) — SHIPPED (2026-08-18)

0.5 THE LAW SPEAKS PALETTE (R4): in pixel mode seeded anchors
quantize to a 6x3x4 lattice inside each species band (<=72 pigments,
generous variety, collisions possible and accepted); ramp solves step
L* to 4-unit rungs, offsets snap hue/sat to coarse grids; solver
caches key on the mode so toggling never serves the other mode's
colour. Vector mode continuous and untouched.

2.1 LOD-AWARE PAINTERS: bakeLodR carries the target radius through a
bake; below 12 px the watermelon island field clamps to 3 bolder
stripes, crackle drops its fine veins, net drops its mottle; the
pattern raster keys LOD so caches never collide.

2.2 BAKE GUARANTEES (pure, unit-tested): the silhouette never breaks
(body pixels touching transparency become the law-derived rim tone,
bandColor(base, -22)); the highlight never vanishes (the lightest
source tone with real area is stamped 2 px at its centroid if the
vote erased it).

2.3 INDEXED SPRITES: bakes emit Uint8 index maps + per-frame colour
lists, resolved to RGBA once (identity) — Phase 5 light columns
re-resolve with zero re-bake.

Suite G1-G5 (stepping collapse + mode-keyed caches, anchor lattice,
rim ring, highlight stamp idempotence, rim tone membership). Battery
25/28 (parked decals). R3 EVIDENCE (r3-lod-sheet.png): at 16 px,
watermelon and eightBall carry identity via bold features; cantaloupe
and honeydew lose texture identity ENTIRELY (fine detail contributes
nothing at this radius even un-simplified) — RULING NEEDED: give each
texture-identity species ONE bold replacement feature (e.g. 3 forced
2 px suture arcs; 2 bold veins), or accept colour-plus-silhouette
identity for them.

## Phase 3 — SHIPPED (2026-08-18)

3.1 THE BITMAP FONT (js/pxfont.js): one authored 3x5 face (digits,
A-Z, working punctuation), drawn as integer fillRects in a
caller-supplied palette tone — the font never mints colours, so every
glyph pixel is honest by construction; unknown glyphs render a
visible box, never a silent skip. Converted in pixel mode: racer
name + pilot labels (name tones register as 'names'; sub-labels
pre-composited solid), the place ordinal (numeral scale 2 for
podium/player, 1 for the field, shoulder convention preserved, alphas
pre-composited), and the distance markers (marker tone from PX_GRID).
Vector mode untouched at every site.

3.2 BOARDS: in pixel mode each billboard redraws as integer
screen-space geometry — no zoom transform (fillRects under a
fractional scale land between pixels), solid pre-composited border,
copy and sub-line in the bitmap font with fit-truncation; board tones
register as the 'boards' ramp. Vector path untouched.

Suite H1-H4 (charset completeness, measure math, integer/one-colour/
scale discipline via a recording ctx, visible-box fallback). Battery
25/28 (parked decals). Proof: phase3-font-proof.png — the BEFORE
panel reproduces the original billboard-smear casualty; the shipped
glyphs read clean at 320.

## Device verdict + reverts (2026-08-18, Eddie on real phone)

Phase 2's device test regressed: the rim guarantee ate the outer
body ring (read as a NEW outline the art never had — inkMode is
'none' — and as ~12% shrinkage on an 18 px melon against black); the
+/-8 L* ground bands read as anti-aliasing along every terrain
silhouette (a 1-2 px intermediate tone IS edge smoothing, whatever
the intent); and the 12 px LOD cutoff caught EVERY melon at 320,
silently restyling the whole cast. Root process failure: PIL proofs
approximate the painters instead of running them — proofs passed
while the device regressed.

REVERTED: rim application (pure fn stays exported; any future rim
grows OUTWARD and is a design ruling); ground banding (any future
banding must read as paint, judged on device). LOD gated OFF by
default (FF.PX_LOD_R tunable, 0 = off). KEPT: vertex snap, solid
grid tones, palette registry + quantized law, bitmap font, indexed
sprites, highlight guarantee.

NEW TOOLING: dev-lane 'px capture' button (slot 5) saves the ACTUAL
live 320 buffer as PNG — every future visual phase iterates against
device captures, not reconstructions. Visual-proof doctrine amended
accordingly.

## Phase 4 (sky) — SHIPPED (2026-08-18)

Minimal sky, ruled: hard bands, law-derived tones, screen-anchored
with a damped camera coupling. The law is atmospheric perspective as
Super Hang-On encoded it — SATURATION FALLS and LIGHTNESS RISES
toward the horizon, quantised to steps. One base (SKY_BASE, the
zenith) plus SKY_LIFT / SKY_FADE / SKY_BANDS; every band is an
offsetColor() solve, so all six register into the palette and Phase
5's light columns will drive them without new machinery.

Anchoring: the drift reference is the camera's own TRAILING average
(SKY_SETTLE), not an absolute world depth — the first version
referenced a state.race.startY that does not exist, and absolute
depth would have pinned the drift to its clamp within a lap on a
descending track. A trailing reference reacts to height CHANGES (a
drop reads as falling past the sky) then settles.

Suite: verify-px-render F0-F6 (monotone lighten/desaturate, palette
membership, distinct steps, seamless coverage, drift settling, and a
guard against the invented state field).

PARKED FOR LATER, by ruling: DITHERED band transitions, and a
hard/dither HYBRID — the reference art uses both (America stage is
crisp, the title screen and green stage dither). The ramp loop is
where that pass hooks in.
NEXT for the sky: seeded per-track hue (draw SKY_BASE's hue from the
track seed — the machinery is already a single parameter).

### Sky v4 — pinned, fine ladder (2026-08-18)

Two rulings after device review of v2/v3:
* PINNED. All camera coupling removed (drift = 0). On a track that
  descends forever, ANY height coupling reads as the backdrop
  sliding rather than as depth — and a fixed sky is what the
  reference hardware did: a fixed palette region with the world
  moving past it.
* FINE LADDER. Bands are 1 px, and the sky now uses its OWN
  quantisation (shading.skyRamp, SKY_QUANT = 1 L*) instead of the
  body law's 4-L* rungs. That was the real limiter: 166 rows
  collapsed into 29 tones, so however thin the bands, plateaus of
  5-8 px still read as slabs. With the fine ladder: 166 rows, ~115
  tones, mean plateau 1.4 px. A long ramp of near-neighbour tones is
  legitimate exactly here — the reference hardware spent much of its
  palette on sky.
* The horizon row is now integer (a fractional hz gave the final
  band a sub-pixel height).

Suite: F3 (fine stripe field, measured on PLATEAU size, not band
height), F3a (density rises toward the horizon), F3e (pinned, no
coupling), F3f (the zenith plateau is broad by design), F5 (zero
movement over a long descent).

## Phase 5.0a — LIGHT COLUMNS (strength) — SHIPPED (2026-08-18)

A light state is a COLUMN of the palette table. Every tone the game
emits resolves through palette.lit(), so a state change shifts the
world coherently — sky, ground, checker, melons, signage — because
they all read one table. Sprites RE-RESOLVE from their index maps
(Phase 2.3's whole purpose): the 64 rotations and their supersampled
renders are untouched; only the colour list is read against the new
column. Columns: BRIGHT / STANDARD / DIM / DARK, with STANDARD the
identity so nothing changes until a state is chosen.

COLUMN MODEL v2 (Eddie's correction): v1 moved value and chroma
TOGETHER — brighter meant more saturated — which is a brightness
slider, not light, and made mud at the dark end. The painter's
convention, and the physics: STRONG LIGHT WASHES COLOUR OUT (lit
surfaces climb toward white, chroma falls as value rises) and SHADOW
GAINS CHROMA (unlit surfaces take bounced coloured ambient, which is
why night is deep blue, not grey). Three moves per column: lift (a
fraction of the REMAINING distance to white — a ceiling, since
scaling clips once a tone is already pale), a chroma scale moving
OPPOSITE the value change, and a tint toward the column's ambient
hue. The tint is load-bearing: a chroma SCALE leaves greys untouched,
so without it the terrain would stay neutral while everything
coloured deepened. Its weight falls with the tone's own saturation,
so a grey takes the full cast and a saturated tone defends itself.
Multiplying HERE is legitimate — the result is a discrete registered
palette entry; what stays forbidden is multiplying at COMPOSITE time
over pixels.

Dev: lane slot 6 cycles the column live.
Suite: verify-px-render G0-G7 (identity, grey neutrality, no crush,
ordering, whole-frame shift and exact return, membership, re-resolve
not re-bake). verify-px-honesty A6 updated from the Phase 0 stub.

STILL OPEN in Phase 5: TIME OF DAY (hue-cast columns; ruling needed —
seeded per track, or sequenced across a cup: morning -> dusk) and SUN
ANGLE as a bake dimension, plus local sources as dithered ramp-shift
rings.

## Phase 5.0b — TIME OF DAY (the hours) — SHIPPED (2026-08-18)

A SECOND axis, orthogonal to strength: strength is local light (a
tunnel, a flare), time is the world's hour, and they compose — a
tunnel at dusk is not a tunnel at noon. Five hours: MORNING, NOON
(the identity), GOLDEN, DUSK, NIGHT. Each carries its own SKY
parameters (base/lift/fade/turn), because a sunset is a different
RAMP, not a cast over a blue sky.

KEY CORRECTION: the ambient cast is applied in HSL and touches HUE
and CHROMA ONLY. Blending toward a tint in RGB necessarily drags
VALUE with it, which is why GOLDEN kept coming out BRIGHTER than
NOON however the tint tone was chosen (caught by the ordering
check, twice). Ambient light colours a surface; how much light there
is stays mL's job. With that split the hour ordering holds by
construction rather than by tuning.

NOON is a TRUE identity (declares no moves) so the declaration
matches the fast path — the first version declared lift/tint values
that the identity short-circuit never applied.

Dev: lane slot 7 cycles the hour, slot 6 the strength.
Suite: verify-px-render H0-H5.

STILL OPEN: the SELECTION ruling — seeded per track
(palette.timeForSeed is implemented and deterministic, not wired) or
sequenced across a cup (race 1 morning -> race 3 dusk). Wiring
either is one line; the model does not care.
NEXT in Phase 5: sun angle as a bake dimension, and local sources as
dithered ramp-shift rings.

### The cast: three versions, one law (2026-08-18)

The ambient cast went through three forms before it was right, and
the failures are worth keeping because each was a DIFFERENT class:

v1 blended toward the tint in RGB. Physically wrong: blending toward
a colour drags VALUE with it, so GOLDEN came out brighter than NOON
however the tint tone was chosen. Value must stay mL's job alone.

v2 rotated HUE toward the ambient along the shorter arc, keeping
value fixed. Mathematically wrong: the shorter arc is AMBIGUOUS when
the ambient sits ~180 degrees from the tone, and a warm cast on a
blue sky is exactly that. As the sky ramp's hue drifted past the
antipode the rotation flipped sign and the sky jumped from cyan to
indigo at a single row — the solid block Eddie spotted at the top of
MORNING. A bug that only appears on sunsets, i.e. on the feature.

v3 (shipped) blends in RGB and then RESTORES the pre-blend
luminance. No wrap, so continuity holds by construction; value stays
mL's. Suite I1 measures the largest row-to-row value jump across
every hour's sky (worst 0.018) so a seam cannot return unnoticed.

SUITE LESSON REPEATED: I2 first checked for the ABSENCE of the
string "shorter arc" in palette.js and failed against the comment
EXPLAINING the fix. Third time a suite of mine has read prose as
code; comment-stripping is now the default in these checks.

## Phase 5 — RENUMBERED (Eddie, 2026-08-18)

Strength and the hours are now 5.0a / 5.0b (shipped). The remaining
work is numbered as Eddie ruled:
  5.1 SELECTION      — which hour a race actually gets  [SHIPPED]
  5.2 REGIONAL LIGHT — terrain regions carry a strength; the
                       renderer resolves per REGION, not per frame.
                       This is what turns strength from a dev toggle
                       into a feature (a tunnel that is actually dim).
  5.3 SUN ANGLE      — a fourth bake dimension beside rotation,
                       squash axis and magnitude, so a melon's
                       terminator swings as it moves through the
                       world.
  5.4 LOCAL SOURCES  — dithered ramp-shift rings, two concurrent.

## Phase 5.1 — SELECTION — SHIPPED (2026-08-18)

RULED: hybrid. The hour is drawn from a seed and offset by the cup
leg, so it is deterministic (no stored state) AND a cup walks
through the day.

THE CORRECTION THAT MATTERS: the sequencing half only works if every
leg hashes the SAME base. The first implementation hashed each leg's
own TRACK seed and added the leg — measured, 157 of 300 cups still
repeated an hour, i.e. the guarantee I had just written into the
comment was false. A cup therefore passes its DAY as the base (legs
0..4 land on consecutive, distinct hours by construction) and a
one-off race passes its own track seed. Measured after: 0 of 400
cups repeat, distribution even across the five hours.

Also caught: the wire-up first called cup.state(), which does not
exist — it would have evaluated to leg 0 for every race and silently
deleted the sequencing half. The real accessor is cup.current().
Second invented-field bug of the day (state.race.startY was the
first), and the suite now pins the accessor by name.

Suite: verify-px-render H5-H8.

## Phase 5.2 — REGIONAL LIGHT — SHIPPED (2026-08-18)

Strength stops being a global dev toggle: regions of one frame now
resolve in different light. The rule is STRUCTURAL — anything under a
roof is shaded — rather than a table mapping chunk kinds to states.
That is physically honest, it covers the tunnel word automatically,
and any future roofed structure inherits it without a new entry
anywhere. Ceilings are the strands already flagged matAbove.

Mechanism: palette.litIn(hex, strength) is the same door with an
explicit column, so regional light OVERRIDES the global state per
region rather than replacing it. Terrain resolves per COLUMN (cached
per screen x, since a roof cannot move within a frame); melons
resolve by their own world position; sprite frames therefore cache a
resolved canvas PER STRENGTH, because two melons in one frame can
legitimately sit in different light.

Caught in build: drawMelon is a helper OUTSIDE render() and has no
`state` — the terrain is published per frame instead (a
ReferenceError on the first run, not a silent wrong answer, which is
the good kind).

Suite: verify-px-render J1-J5, and G7's markers moved with the
resolveFrame signature (the LAW is unchanged: index maps in,
resolved canvases out, never a re-bake).

## Phase 5.2b + 5.3 — SPLIT SHADOW and SUN ANGLE — SHIPPED (2026-08-18)

Done together because both change a sprite's lighting by WORLD
POSITION and land in the same resolve path; retrofitting either
afterward would have cost far more than doing them in one pass.

5.2b SPLIT SHADOW. A melon at an overhang's edge is now half lit and
half shaded. No curvature or mesh is involved, and none is needed:
the shadow boundary under a straight deck lip is a VERTICAL line in
world space, so on the sprite it is a column split. Curvature would
only matter if the edge had to WRAP the form. The boundary is found
by probing cover at the body's left and right extremes and bisecting
for the crossing, then quantised to sprite columns — an 18 px sprite
has 19 positions — so the resolved canvas caches per (strength,
side, column) exactly as squash caches per (axis, magnitude).
The split records WHICH SIDE is shaded: a first cut encoded only a
column and silently dropped every left-shaded case.

5.3 SUN ANGLE. The sun bearing is a fourth bake dimension beside
rotation, squash axis and magnitude, and each HOUR carries its own
bearing — so morning light falls from one side and evening from the
other, and every melon's terminator swings with the day. In practice
a race visits one bearing, so the key space does not widen; including
it in the key is what guarantees a frame baked under morning light is
never served at dusk.

Suite: verify-px-render K2a-K2f. G7/G7b/J4 markers moved with the
resolveFrame and bakeFrame signatures — the LAWS are unchanged.

### Sun bearings tightened (2026-08-18, Eddie on device)

The first set ran to 165 degrees at dusk — within 15 of HORIZONTAL,
which is grazing rim-light — and 120 at night, low enough that
melons read as UP-lit. The day now swings between roughly 60 and 125
(worst 34 off vertical), so morning and evening are clearly angled
without the light ever crawling under the body.

NIGHT sits near vertical with a SEEDED offset (-15/0/+15 by track
seed): a moon is somewhere overhead, not in a fixed socket, and not
random either. SUN_SLOTS went 12 -> 24 (15-degree steps) because the
coarser quantisation would have rounded the moon's variation away to
nothing — a knob that silently did nothing would have been worse
than not having it.

Suite: K2a1 (no grazing angle), K2a2 (night near vertical), K2a3
(the moon varies per track AND survives quantisation).

### The sun's ZERO was wrong (2026-08-19, Eddie on device)

Melons were lit from BELOW for the whole of 5.3. The world is Y-DOWN
and this shading law's overhead is ~270 degrees — the shipped default
is 260, commented "upper-left in a y-down world" — and I built the
entire hour set around 90, which is straight DOWN. Tightening the
spread (the previous fix) only made the up-lighting more uniform,
which is why it survived a round of review.

Hours re-centred on the shipped default: NOON 268, MORNING 236,
GOLDEN 292, DUSK 300, NIGHT 262 with its seeded offset. Every hour's
light vector now has negative y, i.e. genuinely from above.

THE TESTING LESSON, and it is the important part: K2a1 measured "off
vertical" as |deg - 90|, which ASSUMED the answer it was meant to
check. A suite built on the same wrong premise as the code reports
all clear forever. It now asserts the LIGHT VECTOR itself — sun().y
must be negative — which is a fact about the world rather than about
my arithmetic. (The rewritten check then failed on its own seeded
initialiser, caught immediately because the reported number was
absurd.)

## Phase 5.5 — SHADOWS CAST ALONG THE SUN RAY — SHIPPED (2026-08-19)

Shadows are now thrown by the light rather than dropped straight
down. v1 asked "is anything directly above this point", which is a
vertical projection — correct only for a sun at true vertical, and
we no longer have one. The probe is a RAY traced back toward the
sun, tested against terrain segments by exact segment crossing (not
sampling, which would miss thin decks at the shallow angles this
exists for).

Measured, deck at world x -300..300:
  NOON     shadow centre  25   (near vertical, under the caster)
  MORNING  centre 474           (thrown right)
  GOLDEN   centre -283          (thrown left)
  DUSK     centre -387          (further, sun lower)
Caster height governs the throw — MORNING at 400/700/1400 px up
gives centres 271/474/805 — which is the thing a vertical projection
could never express and the reason this is a ray.

The melon's split shadow inherits all of it for free: the bisection
that finds the boundary calls the same probe, so a melon at the edge
of a THROWN shadow splits in the right place.

TEST NOTES, two of my own measurement bugs worth keeping:
* The pixel classifier compared open ground against
  lit(bandColor(x)) while the renderer computes bandColor(lit(x)) —
  different order, so every checker partner cell counted as shadow
  and the shadow appeared to cover the whole screen. Direct probing
  of shadowedAt() is what separated a real bug from a measurement
  artefact.
* J1/J2a encoded the OLD law ("the ground below the deck"), which an
  angled cast makes false by design. They now assert that a shaded
  band exists; WHERE it falls is L3-L5's business.

### 5.5b — the shadow edge RAKES (2026-08-19, Eddie on device)

The cast was offset correctly but its EDGE ran straight down the
terrain: the shadow was probed ONCE PER COLUMN at the surface and
that answer painted the whole vertical span, so the boundary could
only ever be a vertical line between columns. A shadow edge must
rake across a face at the light's angle.

Fix: probe PER BAND, at each band's own world height. A deeper point
must trace further along the ray to reach the caster's height, so its
shadow edge sits at a different x — that difference IS the angle.

The first attempt over-corrected: probing inside a slab, the ray
exits through that slab's OWN top surface, so every column read as
shadowed below a shallow depth (physically true — underground is
dark — but not a cast shadow). shadowedAt now takes the strand the
point BELONGS to and skips it: a visible face is darkened by other
casters, not by the ground it is part of. buildSlab returns
`top: pts`, so a slab identifies its own source strand for free.

Measured (deck at x -200..500, 900 px up): at MORNING the edge moves
from x 410 at the surface to x 140 at 400 px depth — a raking
boundary; at NOON the same measurement moves only 20 px, because the
sun is near vertical. Suite M1-M4.

Also shipped: a SHADOW DEBUG view (dev lane slot 8) painting the cast
flat — magenta shadowed, green lit, with the hour and bearing on the
button — because a screenshot could not settle whether the shadow was
wrong or merely large.

### 5.5c — the rake is PER PIXEL, not per metre (2026-08-19)

The edge stepped in 1 m blocks because the shadow was probed once per
CHECKER CELL and the answer painted across the cell. Probing per
pixel row would be ~57k segment tests a frame; instead the
transition depth is BISECTED once per column (9 probes — cheaper
than the per-cell scan) and the checker band is SPLIT at that exact
row.

Measured, deck 900 px up: MORNING walks the boundary 102 -> 153
across 35 columns with EVERY row distinct; DUSK rakes the other way
(152 -> 103); NOON has 3 edge columns because the sun is near
vertical. Suite N1-N5, with M1 re-pinned to the surviving law (the
shadow is evaluated at DEPTH, not once at the surface).

Known limit, stated not hidden: bisection assumes ONE transition down
a column, which holds for a single caster. Two overlapping casters
would need an interval scan.

MEASUREMENT NOTE: three separate readings of this bug were my
instrument, not the code — filtering for pure magenta while the
checker painted its PARTNER tone; sampling the first 44 shadowed
columns, all of which were fully-shadowed ones under the deck rather
than the 35 edge columns; and inferring from painted rects at all.
Tracing the boundary VARIABLE settled it in one run. The debug view
now paints flat for the same reason.

### 5.5d — the melon's shadow edge rakes too (2026-08-19)

The terrain raked but the melon did not: its split was a VERTICAL
column test, written in 5.2b before the cast could rake at all. It is
now the same geometry as the ground — a HALF-PLANE along the sun
ray, through the boundary column — so a melon at a shadow edge is
cut at the light's angle. The sprite cache keys on the boundary's
ANGLE as well as its column, since the same split under a different
sun is a different sprite.

Measured (sweeping a deck until its shadow edge crosses the melon):
MORNING walks the boundary across sprite columns 1 -> 12 down the
body, DUSK runs the other way 12 -> 6, NOON stays at column 5 with
the sun overhead. Suite K2d/K2d1.

### 5.5e — the melon's shaded SIDE (2026-08-19)

The boundary was right and at the right angle; the two sides were
swapped. Cause: the split carried `left: covL` and picked the shaded
half from the cross product's SIGN. Those describe the same thing
only while the boundary is VERTICAL — once it slants along the ray,
"left of the line" and "negative cross" part company, and the melon
shades on exactly the wrong side. Boundary right, sides mirrored, is
the signature of a sign error.

Fix, and the reason it is not just a flipped sign: covL is a WORLD
probe at the body's left extreme, and in sprite space that point is
(col 0, row spr/2). Evaluating the same cross product THERE gives the
sign that means covL, so the sprite inherits the ground's answer
instead of re-deriving it from a convention that can disagree at some
sun angles and not others. Flipping the comparison would have been
correct at one hour and wrong at another.

NEW CHECK, and the one that would have caught it: K2d3 asserts the
melon's shaded half AGREES with the ground probe at the melon's own
extreme, at every hour. They cannot disagree by construction — which
is exactly why the disagreement shipped unnoticed.

## The sky is AUTHORED, not re-lit (Eddie's ruling, 2026-08-19)

Before developing the sky further, the double-application was
removed. The hour already gives the sky its OWN ramp — base, lift,
fade, turn — because a sunset is a different ramp, not a blue sky
recoloured. Every one of those 166 rows was then ALSO passed through
lit(), which applies the hour's colour column: NIGHT chose a dark
base and was darkened again for being NIGHT. The authored ramp and
the global column were doing the same job, so any sky tuning was
aimed at a moving target.

The sky now bypasses lit() entirely:
  * what skyRamp authors is exactly what renders (verified
    byte-for-byte at every hour);
  * STRENGTH no longer touches the sky, which is the right reading —
    standing in a tunnel dims your surroundings, not the sky above
    the world;
  * terrain, melons, signage and text still go through lit() as
    before. The exemption is the sky's alone.

Consequence for the next work: the four sky parameters per hour are
now the ONLY thing controlling how a sky looks, so they can be tuned
directly, and seeded per-track hues become a clean parameter draw.

Suite: verify-px-render O1-O4.

### Strand ORDER must not change the picture (2026-08-19)

Overhangs almost vanished in pixel mode while rendering correctly in
vector. Cause: the column fill samples the slab's BOTTOM polyline by
screen x, and that sampler walked the underside with a cursor and two
while-loops assuming x ASCENDS with index. True for the primary line;
false for any strand laid RIGHT-TO-LEFT — reversed gallery decks,
fold return legs, the overhang in the screenshot — where the forward
walk ran off the end and returned a bottom from the wrong segment, so
the fill height collapsed to almost nothing.

The vector path never had the bug because it fills a CLOSED POLYGON
(top forward, bottom reversed) and never asks about ordering at all.
That asymmetry is the lesson: the pixel path re-expresses the polygon
as a per-column question, and every implicit property of the polygon
has to be re-earned explicitly.

The sampler now finds its segment by x-RANGE containment, with the
cursor kept only as a hint that is validated before use. Measured
against the analytic slab: left-to-right and right-to-left decks now
both match to 0.33 px mean error on the underside.

Suite: verify-px-render P1-P3, with P2 the reversed case specifically.

## Terrain fill v3 — THE SLAB POLYGON IS THE ONE AUTHORITY (2026-08-19)

Two device bugs, one root cause. In pixel mode the underside took a
different shape from vector's on curved ground, and matAbove
CEILINGS painted as a 1 px line — the roof was 99% invisible. The
audit (5 seeds, every strand class, shipped fill vs an exact
rasterization of the slab polygon) measured three failure classes:

  * CEILINGS: matAbove extrudes the bottom UPWARD, so yBot < yTop
    and Math.max(1, yBot - yTop) collapsed every roof column to 1 px.
    The P2 fix was for reversed DECKS; ceilings invert the vertical
    order, which the sampler never touched.
  * NON-FUNCTION BOUNDARIES: the underside is the top offset 260 px
    along the normal, so at rollers and vees it backtracks in x and
    self-overlaps; "first containing segment" picked an arbitrary
    lobe — worst 140 px on a shipped primary, 580 px on fold legs.
  * X-EXTENT: columns were only visited under TOP segments, but the
    bottom and the caps protrude sideways by up to SLAB_T·|nx| —
    30% of a fold leg was never painted at all.

All three are the same modelling error: two independent
single-valued samplers (yTop(x) from the top polyline, yBot(x) from
the bottom) standing in for a polygon, re-earning the polygon's
implicit properties one shipped bug at a time — exactly the strand-
order lesson, still being paid.

THE FIX deletes both samplers. The fill now rasterizes THE SAME
closed polygon the vector path fills (top forward, bottom reversed —
traceSlabPath's geometry), column by column: intersect the boundary
with the column's centre line, sort the crossings, fill the NONZERO
WINDING spans — the rule canvas fill() applies. Pixel silhouette
equals vector silhouette BY CONSTRUCTION; ceilings, reversed
strands, folds (several spans per column), caps and self-overlapping
offsets are not cases, because nothing is a case to a polygon.
Integer vertices (Phase 1.2 snap) + half-integer sample lines mean a
sample can never land on a vertex: the crossing-parity tie-break is
retired by construction, not by epsilon. Everything downstream of
the span decision — per-band shadow bisection, the world-anchored
checker — is the shipped logic verbatim; only where [yTop, yBot]
comes from changed. Mechanically: an edge table bucketed by first
visible column, swept with an active list — O(edges + columns +
crossings), and the off-screen bulk of a streamed strand costs one
range check per edge. The renderer also stops mutating shared
geometry (the sampler's bo._cur cursor is gone).

THE SUITE LESSON: P1-P3 validated the SAMPLER in isolation — the
component, not the picture — which is how three classes shipped
behind a passing suite. New Q1-Q4 assert the picture itself:
per-column painted coverage must EXACTLY equal the nonzero-winding
spans of the snapped slab polygon (edgeOff=0, no tolerance), across
the four measured classes — curved primary, reversed deck,
non-monotone strand, matAbove ceiling. The reference is an
independent implementation (direct per-column gather, library sort)
over the snapped vertices; referencing the SNAPPED polygon is what
permits exactness, since a float reference legitimately disagrees on
near-vertical edges (a 0.5 px snap moves a steep crossing by
|dy/dx|/2). Both checks were mutation-tested: forcing spans to 1 px
fails all four; dropping the cap edges fails Q3/Q4 — the checks can
fail, per the K2a1 rule. E3/P3/M1 re-pinned to the new law; E1/E2,
P1/P2, N1-N5 pass unchanged on behaviour.

# PHASE 6 — THE SKY IS AUTHORED (2026-08-19)

Eddie's review of cropped reference skies (Out Run, Super Hang-On)
against ours settled that the Phase 4 model was not merely tuned
wrong but STRUCTURALLY unable to draw four of six references:

  * FLAT. The Out Run title sky is ONE COLOUR. A model whose every
    parameter is a RATE cannot express "no gradient".
  * FIELD + BURST. In the crops 60-75% of the sky is a genuine
    PLATEAU and the whole tonal journey happens in the bottom
    quarter. Ours ran a ladder the full height and merely COMPRESSED
    it (SKY_SQUEEZE). That shape difference, not colour choice, was
    the single biggest reason ours did not read as period.
  * CHROMA MAY RISE. The Asia sky walks cyan -> yellow-green at FULL
    saturation. `fade` only ever subtracts, so the SIGN of the chroma
    move was hard-coded into a law we called atmospheric perspective.
    Haze is real; a stylised Sega sky is under no obligation to be
    hazy.
  * NON-MONOTONE VALUE AND HARD CUTS. The America sky cuts from a
    violet field into a pale band and back down again, twice. One
    eased segment has no way to turn around.

Fifth finding, and the one that changed a shipped justification: TONE
COUNT. The crops run 4-20 tones for a whole sky. Phase 4 spent ~115,
justified by "the reference hardware spent much of its palette on
sky" — true, but that was much of SIXTY-FOUR. The budget is now a
declared number per sky with a suite check, and it is what forces
plateaus to be plateaus.

## 6.0 THE MODEL — js/sky.js

A sky is an ordered list of STOPS in sky space (t=0 zenith, t=1
horizon) plus a BAND POLICY. Everything above becomes expressible: a
flat sky is two stops of one colour; field-plus-burst is a pair at the
top and a cluster at the bottom; rising chroma is two stop values; a
cut is a segment the policy refuses to interpolate.

HUE IS STORED UNWRAPPED, and it is load-bearing. Phase 5.0b's v2 cast
rotated along the SHORTER ARC and seamed wherever the ends sat near
180 degrees apart — a bug that only appeared on sunsets, i.e. on the
feature. Here the author writes the hue they mean (cyan 175 to
yellow-green 78 descends through green; 438 would climb through
purple). Both are expressible, neither is guessed, and there is no arc
for an algorithm to choose ambiguously.

QUANTISATION IS THREE-AXIS. Stepping LIGHTNESS alone does not hold a
tone budget: measured, a burst with a moving hue emitted a distinct
tone per row at a single lightness rung, because only one of three
axes was being stepped. The reference hardware quantised COLOURS, not
brightness — that is the difference between a small palette and a
small brightness ladder.

DITHER IS A TRANSITION MECHANISM, NOT A TEXTURE. The crops show
transition zones ALTERNATING (pale, darker, pale) over several rows —
one-row alternation between adjacent palette entries, which is how the
hardware faked intermediate tones. Implemented as ordered dithering on
the RUNG's fractional part. The first cut applied the threshold at
EVERY row, so a flat field whose lightness happened to sit between two
rungs alternated forever: a 66%-plateau sky measured an 8% field. It
now engages only where the exact rung is actually moving.

## 6.1 ROWS, NOT PAINT — the separation that makes the bench honest

`sky.rows(height, horizonY, spec) -> [{y, h, hex}]` is PURE: no
canvas, no DOM, no state. The renderer blits that list, sky-bench.html
blits the same list, and verify-px-render reads the same list instead
of scraping fillRect calls. One authority, three consumers.

This ordering was deliberate. A bench that re-implements the painter
is a proof that approximates the painter, which is exactly how Phase
2's rim guarantee passed its PIL proofs and regressed on the device.
The bench therefore loads the shipped modules and contains no solver —
pinned by suite check R6a.

The bench AUTHORS DATA, never code: its export is a spec object to
paste into the library, so a bad sky is never a code change and every
sky in the game stays diffable and reviewable. Its "field ends" and
"burst bias" sliders MOVE THE STOPS rather than adding a second shape
axis — ergonomics over one authority, not a rival to it.

## 6.2 THE LIBRARY

The five shipped hours re-expressed as two-stop specs, BYTE-IDENTICAL
to Phase 4 (F1: 835 rows, zero mismatches). If a stop list could not
reproduce the shipped ladder exactly the model would have been wrong,
and that is how we would have found out before authoring anything.

Six authored against the crops: flat-cobalt (flat), asia-lime (rising
chroma, descending hue), america-violet (hard cuts, two value dips),
hangon-violet (violet->cream stripes), africa-pale (5 tones, 77%
field), night-indigo. Authored, not generated: the reference look
comes from somebody CHOOSING those stops, and a free generator's
median output is mud. Variety is a wide library plus a seeded draw —
art direction with a random seat, not randomness with an art budget.

Proof: phase6-sky-library.png (rendered FROM rows(), not reconstructed).

## 6.3 LIGHT DERIVED FROM THE SKY

Outdoors the sky IS the light, so a sky and a light column are two
tellings of one fact; Phase 5 authored them side by side and kept them
in sync by hand. A sky now has two constituents that do different
jobs: the FIELD (the plateau, most of the area) is the ambient fill,
and the HORIZON (the burst) is the bounce. The tint mixes them
field-dominant.

EVERYTHING IS RELATIVE TO A REFERENCE SKY, which is what makes the
identity EXACT rather than tuned: the reference derives to lift 0 /
mL 1 / mS 1 / tintK 0 by construction. Phase 5.0b's first NOON
declared moves its own identity short-circuit never applied; this
shape makes that class of lie impossible.

Two rules carried forward, each of which cost a shipped bug: VALUE IS
mL's JOB ALONE (the cast carries hue and chroma only), and CHROMA
MOVES OPPOSITE VALUE (so mS is derived FROM mL, not measured).

MIGRATION IS EDDIE'S RULING, NOT AN ASSUMPTION. The five classic
hours keep their AUTHORED columns (pinned by R8d), so nothing that
exists today changes appearance; only the new skies light themselves.
Their derived columns differ noticeably from the hand-tuned ones
(DUSK derives mL 0.80 against an authored 0.70), which is exactly the
side-by-side judgement to make on device.

Caught in build: lit()'s fast path tested `currentTime === 'NOON'`,
true only because NOON's column HAPPENS to be the identity — an
accident of the table, not a fact about the light. With skies choosing
columns, a NOON-role sky can legitimately cast and the named test
silently dropped it. It now asks whether THIS COLUMN is the identity,
which is the question that was always meant.

Also caught: the ambient's first cut measured the below-horizon fill,
which is ONE row stretched over the rest of the buffer and therefore
outweighs any real band by area — every legacy hour reported a WHITE
field and the whole cast collapsed. That row is a continuation of the
horizon, not a constituent of the sky.

## 6.4 LEGIBILITY IS A LAW

The gameplay read is an 18 px melon airborne against the sky with a
green nameplate over it. A generator that can make any sky can make
one that eats the cast.

The metric is COLLISION AREA, not a worst pair: the shipped ladder's
near-white horizon row legitimately matches a pale melon's highlight,
and a law the shipped game FAILS is a law whose tolerance gets quietly
widened until it means nothing. The ceiling is the shipped worst
(noon, 20.5% of sky area within a redmean distance of 40), stated as
such. Every authored sky measures under 4%.

## 6.5 SELECTION

Orthogonal to Phase 5.1 by construction. That ruling's guarantee — a
cup walks the day, consecutive legs never repeat an hour — is a
property of the ROLE sequence and cost a measured 157-of-300 failure
to get right, so it is not reopened: the seed now chooses WHICH SKY
of the already-chosen role. One line at the call site; R10 re-measures
the old guarantee (0 repeats in 400 cups) alongside the new spread.

## Suite and tooling

verify-px-render F0-F7 (library well-formed, BYTE-IDENTITY, palette
membership, the classic ladder's own laws re-measured through rows(),
pinned, coverage, no-movement, and the renderer no longer solving) and
R1-R10c (tone budget, field share, the four impossible shapes drawn,
unwrapped hue in source AND behaviour, dither gating, purity, bench
has no solver, legibility, derived columns, computed fast path,
selection). Battery 18/18.

MUTATION-TESTED, per the K2a1 rule that a check must be able to fail:
breaking the Asia plateau fails R1/R2; deleting the authored-column
door fails R8d (and H2); ungating the dither fails R1/R2; reverting
the named fast path fails R9/R9a; swapping the ramp for a shortest-arc
solve fails R4 and R4b.

SUITE LESSONS, two more for the pile. R9a first failed against the
COMMENT explaining its own fix — fourth time a check of mine has read
prose as code, so comment-stripping is now applied here too. And R4b's
first hue probe ran 200 -> 380: exactly 180 degrees, the ANTIPODE,
where both arcs have equal magnitude — so the shortest-arc mutation
slipped through and only the source check fired. It runs 200 -> 400
now. Failing to the very ambiguity the rule exists to retire was a
fitting way to find out that a source check alone is a weak guard.

Dev: lane slot 9 cycles the sky (slot 6 strength, slot 7 hour).
Retired: SKY_BASE's ramp constants, SKY_BANDS (vestigial), and
SKY_DRIFT / SKY_SETTLE (dead since the pinning ruling) — a knob that
silently does nothing is the hazard SUN_SLOTS nearly shipped.

STILL OPEN. (1) Whether the five classic hours MIGRATE to derived
columns — needs a device side-by-side. (2) Whether the reference's
transition alternation is genuinely line dither or capture artefact —
the bench now renders both, so it is Eddie's eye to settle. (3) Clouds
remain Phase 4.1's parallax layer and are deliberately not conflated
with the ramp.

### Phase 6 PERFORMANCE — a pure function is not a free function (2026-08-19)

Eddie, on device: the frame rate collapsed after Phase 6. Measured on
a fixed scene, warm, stub canvas: 19 ms/frame under a CLASSIC sky,
268 ms under a DERIVED one. About 4 fps — and only on the new skies,
so a race crawled or did not depending on its seed.

ROOT CAUSE, one bug with a second queued behind it. lit() opened with
skyColumn() -> sky.columnFor(spec). On a classic sky that returns the
authored column immediately; on a derived one it solved TWO ENTIRE
SKIES (the spec's own ambient, and the reference's) — 0.23 ms per
call against 0.85 us, roughly 1157 lit() calls a frame. And it ran
BEFORE litCache.get(), so a cache HIT paid full price too: a memo
placed after the work it memoises is not a memo.

Attribution, so the fix aimed at the right thing: the reference
ambient recomputed every call was ~50% (497 ms vs 256 ms per 2000
calls), the spec's own ambient most of the rest, and register()'s
linear ramp.indexOf() ~14% — real, and secondary.

FIVE FIXES, in that order of leverage:
 1. THE COLUMN IS MEMOISED per (sky, palette version). A column is a
    pure function of a spec and a spec does not change during a race;
    `version` is the counter every setSky/setTime/setLight already
    bumps, so the memo cannot outlive the state it describes.
 2. THE REFERENCE AMBIENT IS A CONSTANT, solved once, lazily.
 3. THE CACHE IS CONSULTED FIRST in lit(). The key already carries
    the sky, so a hit is a complete answer on its own.
 4. THE REGISTRY IS O(1): a Set beside the ordered array. The array
    still owns the ramp's ORDER (which consumers read); the Set
    answers the only question indexOf was actually being asked. The
    ramp reached 572 entries once every sky had been touched.
 5. THE ROW LIST IS CACHED per (spec identity, height, horizon). The
    sky is PINNED by ruling, so frame N's rows are provably identical
    to frame N-1's; re-solving also allocated ~167 objects a frame.
    Keyed by IDENTITY (WeakMap), not by a serialisation: the bench
    edits one spec object in place, and a value key would have served
    it a stale sky on every slider move. The bench, ambient(),
    toneCount() and fieldShare() take rowsUncached() for exactly that
    reason — correctness over an optimisation none of them was paying
    for anyway.

RESULT: 268 ms -> 3.2 ms for asia-lime; every sky now between 0.36x
and 0.95x the classic frame (the classic FINE ladder is the most
expensive sky in the library, which is the right shape). The registry
fix also halved the classic path, 19 ms -> 8 ms.

THE REAL LESSON, and why the suite grew a new section: NOTHING IN F OR
R COULD HAVE CAUGHT THIS. Every check asks whether the output is
CORRECT, and a function tested for purity and determinism passes
identically at 1 us and at 1 ms. Phase 6's whole design was "solve it
properly, once" — the "once" was simply never wired, and no law said
it had to be.

verify-px-render S1-S5 now says so. The primary checks count WORK, not
milliseconds — how many times the solver actually runs, which is a
fact about the code and identical on every machine — with a wall-clock
RATIO as a loose backstop (2.5x), because absolutes rot across
machines while ratios do not. S1 measures OBJECT IDENTITY: its first
version wrapped sky.rowsUncached and counted calls, and was VACUOUS,
because rows() reaches rowsUncached through the module's own closure
rather than the exported api object — the wrapper was never called and
the check reported a clean zero for a reason unrelated to the law. It
announced itself by naming its worst offender 'null'. Mutation-tested:
disabling the column memo fails S2, moving the cache lookup back
behind the derivation fails S3, restoring indexOf fails S4, removing
the rows memo fails S1/S1a.

## Phase 6.1 — THE FLOOR AND THE BAND (2026-08-19)

Two device findings from Eddie, and a third the measurement turned up
underneath them.

FINDING 1 — THE BANDS WERE TOO THICK. Measured at Eddie's window
(1512x850 -> buffer 320x180): america-violet ran a 9 px burst mean,
africa-pale 9.3, against a reference burst of 1-3 px. Not a bug — I
simply under-authored, placing too few stops too far apart. But the
reason it could ship unnoticed IS the defect: band thickness had no
name, no measure and no gate. It was an implicit product of stop
spacing x floor x buffer height, exactly as tone count had been
before it was given a budget.

FINDING 2 — THE RAMP RAN TO THE BOTTOM OF THE FRAME. It should bottom
out around mid-screen, leaving the lower half for the parallax land
layers to come. The full-height version is not lost: it is the
ABOVE-THE-CLOUDS sky, and is now a declared variant.

FINDING 3 (measured, neither of us had named it) — BAND THICKNESS WAS
DEVICE-DEPENDENT. asia-lime's burst came out 6 px on a desktop and
24 PX IN PORTRAIT — the same authored sky, four times coarser —
because every stop was a FRACTION of a buffer whose height runs 148
(landscape phone) to 693 (portrait). The reference hardware was a
fixed 320x224 and never had this problem.

### THE FLOOR

`spec.floor`: where the ramp completes. Below it the horizon tone
HOLDS — which is what the sky always did beneath its last band, so
this is a parameter, not a mechanism. What is new is WHO OWNS IT: the
renderer's SKY_HORIZON constant made the proportion of the frame a
sky occupies a camera decision, and it is an art-direction one. The
renderer now supplies only the buffer height; SKY_HORIZON is retired.

Ground-level skies floor at 0.5; the classic five keep 0.92 (their
shipped geometry, on which byte-identity rests) and flat-cobalt
floors at 1.0 — the Out Run title sky fills the frame, and a flat sky
has no burst to bottom out anyway.

The held region is NOT dead space: it is the backdrop the parallax
land layers will sit against, so the horizon tone becomes a
composition decision once those land.

CONSEQUENCE, caught in build: the ambient derivation samples at a
fixed HEIGHT (so lighting is device-independent) but the floor within
that window has to be the SPEC's. Sampling a half-height sky over a
full-height window counts ~76 rows of held horizon tone as though
they were sky, and the field/horizon split — the whole basis of the
cast — comes out wrong. Without it, an above-the-clouds sky and a
ground-level sky with identical stops would light the world
differently for no reason. Pinned by T5.

### PIXEL-ANCHORED STOPS

A stop declares EITHER a fraction `t` OR `px`: rows above the floor.
The burst is authored in pixels and is therefore identical on every
device; the FIELD — a flat plateau by design — absorbs all the buffer
variation by simply being taller. That is how the reference art is
actually built: the burst is authored, the field is a fill.

Measured after: asia-lime's burst is 3-4 px at every buffer height
from 148 to 693 (was 6 / 24), while its field grows 45 -> 318 px.
The classic five stay fraction-anchored — they are a full-height
eased sweep and byte-identity rests on it — and they DO still drift
(3.8x on a portrait buffer). That is stated, not hidden: T3d asserts
the drift exists, which is precisely why pixel anchoring does, and
their budgets are declared at the reference height only.

Short buffers cannot break the solve: pixel stops driven past each
other clamp to monotone, and a collapsed segment contributes no rows
— the honest outcome of asking for more bands than there are pixels
(T4, checked down to an 8-row buffer).

### THE BAND BUDGET

`spec.bandPx`, declared per sky and gated, exactly as the tone budget
is. The FIELD plateau is excluded by construction (it is the single
longest run), the same exemption F3f already grants the zenith.
Authored skies now run a 4 px maximum and a 1.3-2.9 px mean; the
classic five declare 20 and are exempt by declaration rather than by
a rule with a hole in it.

The library was re-authored against it: america-violet went to 3 px
CUT spacing (under CUT, band thickness IS stop spacing), africa-pale
and hangon-violet gained intermediate stops where quantisation had
been merging neighbours into one long run.

### Suite

verify-px-render T1-T5: the floor is declared and sealed, the held
row is one row and reaches the buffer bottom, band budgets hold, the
authored skies read as a period stripe field, pixel anchoring holds
thickness on every buffer while the field absorbs the variation,
anchoring is declared rather than inferred, the fraction-anchored
drift is asserted to EXIST, short buffers still solve, and each sky
is measured at its own floor. Battery 18/18. Frame cost unchanged
(every sky 0.36x-0.93x the classic frame).

MUTATION-TESTED: reverting the floor default fails T1a/T2/T2a/T3a;
removing a stop from america-violet fails T2/T2a/T3a; pinning px
anchoring to one buffer height fails T3a; stopping ambient following
the spec floor fails T5.

SUITE LESSON, the fifth of its kind: F7 failed against the COMMENT
explaining that SKY_HORIZON had moved. There is now a comment-stripped
`srcNC` at the top of the file, and every absence check reads it.
Separately, R5a was rewritten: it looked for a strict ABAB
alternation and found almost none, because with a dither period of 2
the pattern is AABB — the check was describing one particular period
rather than the mechanism. It now measures the NON-MONOTONE walk that
line dither actually is, against a dither-off control (4 reversals vs
0), which is a fact about the mechanism rather than about a setting.

Proof: docs/phase61-sky-floor.png (rendered from rows(), floor row
marked).

### The bench threw on load — mulberry32 lived in the wrong module (2026-08-19)

Eddie, browser console: sky-bench.html threw
`window.FF.mulberry32 is not a function` from shading.js:471 and
rendered blank.

CAUSE. mulberry32 was defined and published by js/terrain.js. Every
seeded consumer in the game — melon, decals, names, emote, and
shading's seeded ANCHORS — therefore depended on the TERRAIN
GENERATOR being loaded, for a ten-line function that has nothing to
do with terrain. The bench deliberately loads the colour tier only
(dmath, config, fruits, palette, shading, sky), and
shading.anchorColor() is what it calls for its legibility marks and
its raw/lit probe strip. The dependency had always been satisfied by
accident.

FIX, not a patch: mulberry32 moved to js/dmath.js, which is the
deterministic-arithmetic module — a seeded RNG is deterministic
arithmetic — and which loads FIRST in both index.html and the
harness, so no consumer can now be earlier than its own dependency.
terrain.js consumes it like everyone else. The function is
byte-identical and every consumer reads it at CALL time through
window.FF, so no stream can move: verified by re-running a full race
and diffing the FNV-1a path hashes before and after — bit-identical.

The wrong fix, considered and rejected, was adding terrain.js to the
bench's script tags: it would have worked, dragged the entire terrain
generator in for an RNG, and left the bench's stated dependency tier
a lie.

TWO THINGS ADDED SO IT CANNOT RECUR SILENTLY.

1. A DEPENDENCY GATE in sky-bench.html: every global the bench uses
   is named in one list and checked before anything runs, so a
   load-order mistake reports itself in the header instead of in a
   stack trace. This is the same class as index.html silently losing
   roster.js — a missing module reads as a broken FEATURE, not as a
   missing module.

2. verify-bench.js, a new suite. NO EXISTING CHECK COULD HAVE CAUGHT
   THIS, and that is the whole point: every headless suite loads
   harness.js, and harness.js loads terrain.js, so the dependency was
   always present in test. This file boots the bench's exact six
   script tags — no harness, no terrain — and runs every call the
   bench makes at startup. Check A asserts the module list matches
   the page's script tags; the duplication IS the check, because
   without it the suite would happily verify a load order the browser
   never performs. Mutation-tested: unpublishing the RNG fails C/D/F,
   dropping a script tag fails A, adding a sim module fails A/B.
   Battery is now 19.

### S5 was flaky, which is worse than absent (2026-08-19)

The performance backstop timed the baseline ONCE and measured every
sky against that single sample, so one fast baseline inflated every
ratio at once: it reported 2.81x for flat-cobalt on one run and
1.07-1.29x on the next three. A flaky check is worse than no check,
because the habit it teaches is re-running until it passes.

Each sky is now timed BACK-TO-BACK with the baseline, three times,
and the MEDIAN ratio taken. Pairing cancels machine drift because
both halves of a ratio meet the same conditions; the median discards
the scheduling hiccup that pairing cannot. Measured across five
consecutive runs: 1.05x to 1.13x. Still catches the real class — the
column-memo mutation fails S2 immediately.

The general rule, now that a wall-clock check exists in the battery:
a timing check must be BUILT so its noise cannot cross its threshold,
or the threshold is measuring the runner rather than the code.

### The bench rendered BLACK — an opaque overlay (2026-08-19)

Eddie: "it's just a black screen". It had never rendered. Everything
else on the page was correct — the header reported 11 specs, the
dimensions read "320x190 floor 95 (50%)", the legibility panel
reported real numbers off real rows — so the script was running and
the solver was producing tones. Only the picture was missing.

CAUSE, and it is embarrassingly plain: the stylesheet says
`canvas { background: #000 }`, which applies to EVERY canvas, and
#ref — the reference-screenshot overlay — is absolutely positioned
directly over #sky. Its DRAWING SURFACE was always transparent; its
CSS BACKGROUND was not. An opaque black rectangle sat over the
preview from the day the bench was built.

Two more of mine, visible in the same screenshot:
 * #legib was a <div>, but row() emits <tr>. The browser discarded
   the row structure and the panel rendered as run-together text
   ("collision area5.3% / 25%closest pair...").
 * Default zoom 3 put the preview at 960px, which forced the three
   columns to wrap into one. Now 2.

And one found while fixing: resolvedStops caches per (spec identity,
hz), which is right for the game — where a spec never changes — and
wrong for the bench, which edits ONE spec in place, so a slider move
would have redrawn from the previous stop positions. It now has an
uncached door, the same one ambient/toneCount/bandStats already
carried; the stop table was added later and had not inherited it.

WHAT THE SUITE LEARNED. verify-bench gained J, K and L:
 * J — a stacked canvas must declare its own background. Narrow, but
   it is the honest guard: no module-tier check can see an opaque
   overlay, so the check has to name the specific structural risk.
 * K — every panel built from row() must be a <table>, derived from
   the source rather than listed by hand.
 * L — the bench script is EXECUTED against a thin DOM shim (element
   identity and canvas fill calls, nothing more) and must run to
   completion, paint the preview, and paint ONLY tones that rows()
   emitted. That last one is the important half: it proves what
   reaches the canvas is the shipped solver's output and not
   something the bench computed for itself.

Mutation-tested: removing the transparent background fails J;
reverting #legib to a div fails K; painting invented rows fails
I/L1/L2.

THE STANDING LESSON. Three bench defects in a row — a missing global,
an opaque overlay, a mis-typed host element — all invisible to a
battery that only ever exercised modules. A dev tool needs its own
suite for the same reason the game does, and that suite has to
execute the page, not just its dependencies.

### Bench: the GROUND LAYER (2026-08-19)

A toggle that fills from the floor row down in the terrain tone, so
the sky can be judged against the thing it actually meets rather than
against held sky. Colour picker beside it (defaults to COLORS.ground,
#3a3a3a, with a one-click reset) for trying other floors.

THREE DECISIONS WORTH RECORDING.

1. IT LIVES ON ITS OWN CANVAS. Preview aids are painted on layers
   above #sky, never on it — which is what lets the suite hold #sky
   to "every pixel came from rows(), no exemptions". The floor marker
   moved off #sky at the same time for the same reason; it had been
   the one excused-by-name tone in that check, and an exemption is a
   hole that widens.

2. IT IS PAINTED THROUGH THE SKY'S OWN LIGHT COLUMN, not raw. An
   asia-lime sky casts green on the terrain in game (#3a3a3a ->
   #273b2b); a bench showing raw grey would be lying about the
   composition it exists to judge.

3. IT IS AN AID, NOT DATA. It touches neither the spec nor the
   export, so a sky can never acquire a property because of how we
   happened to be looking at it. M5 asserts exactly that.

Also added: a HORIZON vs GROUND contrast readout beside the
legibility figures. If the lowest sky band and the lit terrain sit
too close the horizon stops reading as an edge and the world loses
its floor — reported, never gated, because where that line falls is a
judgement rather than a number.

The overlay CSS rule was generalised from `#ref` to
`#refwrap canvas.layer`, and J1 now asserts that every canvas stacked
over the preview carries that class — so the next aid inherits the
transparent-background fix instead of repeating the black-screen bug.

Suite: verify-bench J1, M1-M6. Mutation-tested — filling the whole
frame fails M3, painting raw fails M4, dropping class="layer" fails
J1, and letting an aid creep back onto #sky fails L2/M6.

SHIM LESSON: M2 (the colour defaults to the terrain grey) first
failed because the test shim hand-seeded a few control values and
left the rest empty, so it disagreed with a default the HTML did
declare. The shim now seeds itself from the page's own input
attributes. A shim that disagrees with the page is worse than no
shim: it tests a document that does not exist.

### The bench's ground stayed green after the sky changed (2026-08-19)

Eddie edited a sky down to two stops — white and purple — and the
ground box kept painting asia-lime's green, while the panel beside it
correctly reported the new tint (#d2b8c1, k=0.192).

CAUSE. lit()'s cache key was (sky id, strength, tone). That is
sufficient only while a sky ID maps to ONE column forever — true of
the game, FALSE of the bench, which installs a scratch spec under a
stable id and changes its column on every edit. The first answer was
cached and served for every later one. Reproduced exactly:
#7a7a7a -> #5d7a63 under both columns; with a unique id, #938e90.

FIX. The key carries `version`, the counter every mutator already
bumps (setSky / setTime / setLight / setSunSeed) — so it is precisely
"has anything that could change the answer changed". skyColumn's memo
already keyed this way; lit() was the one door that did not, and the
two now share a discipline instead of differing by accident. Costs
nothing in a race, where version is constant (measured: 10-11 ms per
20k calls, unchanged). Determinism re-verified bit-identical.

### R8b HAD BEEN VACUOUS — and failed the moment the cache was fixed

R8b (the cast carries hue and chroma, never luminance) installed two
scratch specs under FIXED ids and swapped their columns per sky. Under
the old key that meant every sky after the first was served the first
one's answer: eleven skies, one measurement. Sixth check of mine to
be true for the wrong reason.

With the cache fixed it tested all eleven and failed — and the
failure was the CHECK's, not the code's, in a second way.
applyColumn restores sRGB-WEIGHTED LUMA after the blend; R8b measured
L*, which is gamma-corrected. On a saturated tone a large hue/chroma
shift at constant luma legitimately moves L* a little. Measured
across the library: worst luma drift 0.43 (i.e. none), worst L* drift
2.72. No leak — two rulers.

R8b now asserts on LUMA, the quantity the implementation actually
preserves, with a loose L* bound alongside so a genuine leak cannot
hide behind the distinction. Mutation-tested: disabling the
luminance restore drives luma drift to 36.8 and fails it (and H2).

OPEN, for a ruling: applyColumn preserves luma while the column model
is otherwise stated in L*. Restoring in L* instead would be more
consistent with the model's own axis, but it shifts every non-NOON
hour's lit tones slightly — a visual change to shipped hours, so it
is Eddie's call, not an implementation detail.

### Bench: the reference overlay REMOVED (Eddie's ruling, 2026-08-19)

Removed root and branch — canvas, file picker, opacity slider,
handlers. It stretched an arbitrary-aspect screenshot to fill the
preview (so you matched a distortion), alpha-blended it (so you
judged a blend rather than a comparison), and smeared exactly the
compression artefacts we had already established could be mistaken
for real dithering. Right instinct, wrong instrument; deleted rather
than left as furniture. If comparison returns it should be as
MEASUREMENT — extract a reference's tone count, band thicknesses and
field share and show them beside ours as a target.

Also fixed, spotted in the same screenshot: the field-ends readout
said "NaN%". The shape sliders only govern a FRACTION-anchored field
stop, and with two px-anchored stops there is no fraction to read.
They now disable themselves and say why ("px-anchored" / "needs 3+
stops") rather than reporting nonsense about a spec they do not
govern.

Suite: verify-bench N (the reference is gone root and branch), O (a
reused scratch id resolves each column on its own merits), O1 (the
key carries the version counter). Battery 19/19.

### Achromatic hue, and the step controls that capped the model (2026-08-19)

Eddie authored a two-stop PINK -> WHITE sky and got magenta, purple,
blue, cyan, green, then white: 17 tones, nine of which nobody asked
for.

CAUSE. White, black and grey have NO HUE. HSL reports 0 for all of
them, which is not "red" — it is "not applicable" wearing a number.
Interpolating magenta (300) to white walked 300 degrees of hue and
passed through every colour in between. The unwrapped-hue rule exists
precisely so a hue path is AUTHORED rather than guessed, and an
achromatic endpoint smuggled a guess back in through a hue that was
never authored at all.

FIX, in the MODEL not the UI: a colourless stop inherits its hue from
its nearest chromatic neighbour, so a ramp into white holds its hue
and simply desaturates — what a painter means by "fading to white".
Pink -> white is now 8 tones, all of them chosen. An EXPLICIT h still
outranks inheritance (a rule that fills an absent value must never
overrule a stated one), so the long walk stays expressible: the same
spec with h:0 declared still runs 17 tones.

CAUGHT IN BUILD, and worth keeping: the first cut broke the classic
ladder in 558 rows. The legacy sweep's endpoint is an UNCLAMPED HSL
triple whose saturation can go NEGATIVE (clamping happens after
interpolation — that is what makes byte-identity possible), and
inheritance read that as "achromatic" and overwrote a deliberate
rotation. Legacy stops now declare hueAuthored, and a negative
saturation counts as chromatic.

### The bench's step sliders were capping the model

Eddie: why is 17 the fewest tones I can make, and why do bigger rungs
give FEWER tones?

 * A rung is a STEP SIZE, not a step count — coarser graduations,
   fewer marks. The label said "rung", which reads as the opposite.
   Renamed to STEP, and each now reports the number of STATIONS it
   leaves on the current ramp, which is the number the author is
   actually reaching for.
 * 17 was not a floor of the model; it was a floor of MY SLIDERS. The
   maxima (L 16, hue 30, chroma 20) were numbers I picked with no
   derivation, and they had been quietly capping the design ever
   since: a ramp travelling 300 degrees of hue cannot get below ten
   hue steps at a 30-degree cap, however far the slider goes. The
   real ceilings are the ones the model has — L 100, hue 360, chroma
   100 — and at those, two stops reach two tones. (Measured ladder:
   30/16/20 -> 17 tones; 60 -> 8; 120/25/60 -> 5; 360/50/100 -> 2.)
   A tool limitation that looks like a design limitation is the worst
   kind, because it is invisible.

Also added: a HUE PATH readout above the stop list, stating the walk
and its total travel before it appears in the picture, and marking
any hue that was INHERITED rather than authored; and a label on the
derived-column probe strip, which was showing terrain greys, melon
anchors and the nameplate green with nothing to say so.

Suite: verify-bench P1-P8. Mutation-tested — removing inheritance
fails P1/P2, capping the hue slider fails P4, and dropping the
hueAuthored flag fails P3/P3a.

CHECK LESSON. P3's first cut sampled two of the five classic hours,
and both happened to be protected by the OTHER guard (their endpoint
saturation is negative). GOLDEN's lands at 0.012 — inside the
achromatic band, not negative — so it is the only hour that genuinely
depends on the flag, and it was the one not sampled. The mutation
passed. P3 now covers all five, and P3a names which hour the flag is
load-bearing for, so the sample can never drift away from the case
again.

# PHASE 7 — THE PALETTE IS AUTHORED (2026-08-19)

Eddie's proposal, and it is the right architecture: stop deducing the
palette and start declaring it. Four rulings taken together — the
two-stage model, OKLCh as the authoring space, byte-identity retired,
and terrain keeping its own colours.

## 7.0 WHY THE OLD MODEL HAD TO GO

The palette was EMERGENT: two authored endpoints, a continuous
interpolation, then three separate quantisation axes. You could not
ask for fourteen colours — only for step sizes, and then count what
came out. Eddie's question ("why seventeen tones, and why can I not
get two?") needed an answer about a hue rung interacting with a 300
degree travel, which is not a thing anyone should reason about in
order to pick colours. Two further symptoms of the same cause: two
authored colours quietly landing on one rung and becoming a fat band
(which forced africa-pale and hangon-violet to be re-authored), and
slider maxima that capped the model invisibly.

## 7.1 TWO STAGES THAT DO NOT KNOW ABOUT EACH OTHER

STAGE ONE — THE PALETTE. A sky is N COLOURS, in order. Nothing about
pixels, height or the screen. Any entry may be PINNED with an
explicit (L, C, h); the rest interpolate by INDEX between pinned
neighbours — two nodes give a ramp, more give the non-monotone shapes
a cut sky needs. Measured: every sky in the library now emits exactly
the number of tones it declares. Ask for fourteen, get fourteen.

STAGE TWO — THE DISTRIBUTION. N colours is not N bands: one entry
holds 60-75% of the sky (the FIELD) and the rest share the bottom
quarter (the BURST). The burst is authored in PIXELS and the field
takes the remainder, so band thickness is identical from a 148-row
landscape buffer to a 693-row portrait one while the field absorbs
the difference — measured 4-5 px at every height, against 4/5/7/14
when the distribution was fractional.

The seam is what matters: the two stages compose but never consult
each other, which is what lets them be seeded independently. It also
retires three whole axes of control, the tone budget as a
measurement, and the merge-surprise class of bug.

## 7.2 OKLCH — A DRAWING BOARD, NOT A THIRD COLOUR SYSTEM

A ramp is designed in OKLCh and converted ONCE to hex; every
downstream consumer — the registry, lit(), the rows the renderer
blits — sees exactly what it saw before.

THE REASON IS GENERATION. In HSL the same numbers mean different
things at different hues: saturation 100 / lightness 50 is a usable
deep blue and an unusable highlighter yellow-green, so a "safe" range
is safe only at some hues and a seeded roll needs a table of per-hue
exceptions — the crazy-colour problem arriving by the back door. In
OKLCh a bounded range is bounded everywhere, so "not crazy" is
expressible as ranges. It also delivers what an N-step palette
promises: measured, even steps come out within 1.15x of each other
perceptually, where HSL bunches near white.

GAMUT CLIPPING holds lightness and hue and reduces chroma — lightness
carries the ramp's structure and hue its identity; chroma is the axis
that can give way without the shape changing. Bisection with a FIXED
iteration count, because a generator that rolled a different colour
on a different machine would break the seed law. Verified: hex
round-trips through OKLCh with ZERO channel error over 4096 colours,
and the conversions match Ottosson's published values to 3dp.

Bonus: the legibility law's redmean approximation is retired. In
OKLab "how different do these look" is the straight line between
them.

## 7.3 BYTE-IDENTITY RETIRED, BY RULING

The classic five are re-authored as 22-24 entry palettes rather than
a second solver being kept alive for them. What that cost: the
strongest regression tripwire the sky had. What it bought: one model;
no legacy path; and the classic hours stop being a special case that
constrained everything else (they had forced a floor pin at 0.92, a
tone-budget exemption of 130, and nearly broke the achromatic-hue
fix). The replacement guarantee checks the LAWS rather than one
historical output, which constrains the future instead of pinning the
past. Their authored light columns are unchanged, so the world still
lights exactly as it did.

## 7.4 THE GENERATOR — never roll a colour, roll inside a recipe

Rolling six independent numbers gives incoherent skies, because a sky
is not two colours: it is a RELATIONSHIP between them. Three layers:

 1. THE HOUR sets the REGION — morning, noon, golden, dusk and night
    are neighbourhoods of the same space, not a separate system.
 2. THE FAMILY sets the RELATIONSHIP — WASH (to white, chroma falls),
    SHIFT (hue travels, chroma holds — the Asia move), WARM, CUT,
    FLAT. Values must satisfy the family, which is what makes
    "zenith bright yellow, horizon dark purple" not a possible
    outcome rather than an unlikely one.
 3. THE GATES reject the rest — legibility against the melon cast,
    band thickness, and horizon-versus-ground contrast, each ceiling
    set to the authored library's own worst case.

Measured: 500 seeded rolls across five hours and six ground kits,
ZERO fallbacks, 86% passing on the first attempt, all five families
drawn, and deterministic to the bit.

THE ROLL IS GROUND-AWARE, and this is a constraint rather than a
repair. Blind rolling failed 19% at NIGHT and 36% on a SNOW stage,
both for the same reason — the horizon and the ground sat at the same
lightness and the horizon stopped reading as an edge. TWO PASSES,
and the second is the one that matters: the clearance must be
measured against the ground AS IT WILL APPEAR (its own tone under
THIS sky's column), not against its raw base. A first cut compared
against the raw tone and barely helped at night, because a night
column darkens the ground far below where the comparison thought it
sat.

CALIBRATION NOTE. The collision radius was first set at OKLab deltaE
0.10 and africa-pale measured 100% collision — a metric whose worst
case is 100% is not a metric. Swept against the library (0.02 -> 5%,
0.04 -> 18%, 0.06 -> 24%, 0.10 -> 100%) and set at 0.04, which is
~6 JND and leaves the shipped worst meaningfully under the ceiling.

## 7.5 THE TERRAIN KEEPS ITS OWN COLOURS (Eddie's ruling)

Terrain is RECOLOURED by the light exactly as a melon is, but its
base tones are its own rather than derived from the sky. That is
already how the pipeline works — a melon rolls a base from its
species band, derives a shading ramp, and passes every tone through
lit(); terrain used the same door and simply had ONE base, and that
base was a pure NEUTRAL, which is the most cast-susceptible thing
there is. Measured under a lime sky: neutral grey dyes to 20% chroma
while a saturated red only shifts from 63% to 54%. Give terrain
chroma of its own and the sky tints it instead of dyeing it.

GROUND KITS: tarmac (the shipped grey, byte for byte — nothing moves
by default), grass, ochre, clay, slate, snow.

STAGE IDENTITY: sky and ground are ONE decision. Rolled separately a
seed could hand you a lime sky over an ochre desert; the reference
never does that — Asia is a cyan sky AND green fields. A track rolls
a STAGE, and the stage names both.

## 7.6 THE BENCH IS NOW AN AUDITOR

The goal is seeded generation that can be trusted, not skies tuned
one at a time, so the headline view is ROLL 100: a contact sheet of
seeded skies with the ground painted under them, judged as a SPREAD
rather than as specimens. Tiles that needed a re-roll are outlined,
the gate distribution is reported, and a second sheet shows ONE seed
across all five hours — because a cup walks those in order and they
have to hold together as a set. The single-sky editor remains, with
both stages exposed by name and OKLCh nodes.

## Suite

verify-px-render F (palette), R (distribution), T (OKLCh), U
(generator), V (ground kits and stage identity); verify-bench
rewritten for the two-stage tool. Battery 19/19, determinism
bit-identical.

MUTATION-TESTED: disabling gamut clipping fails T3a; making the burst
fractional again fails R2/R2a; removing the ground clearance fails
U2; removing achromatic hue inheritance fails F4; and pointing the
renderer back at the hard-coded grey fails V5.

CHECK LESSON. F4's first version measured the HUE OF A COLOURLESS
TONE — the final entry is white, whose measured hue is noise, and it
read 90. The check was asking a colourless tone what hue it was,
which is precisely the mistake the feature under test exists to
prevent. Colourless entries are now excluded from the measurement.

Proofs: docs/phase7-library.png, docs/phase7-rolls.png (both rendered
FROM rows(), not reconstructed).

STILL OPEN: SHIFT at NIGHT lands in cyan/teal, which reads odd at the
small scale — a candidate for tightening that family's hue range per
hour. And the terrain's ground kits are authored but not yet varied
within a stage; per-region kits (grass shoulders, tarmac road) are
the natural next step now that the mechanism exists.

### Bench: the node editor collapsed its own nodes (2026-08-19)

Eddie, from a screenshot: a six-entry sky authored from a cyan node
and a yellow node rendered as one cyan and FIVE IDENTICAL YELLOWS,
not a ramp.

CAUSE, and it was not the colour maths. BOTH NODES WERE PINNED TO
ENTRY 0. With no span to interpolate across, nodesOf() appends a
terminal copy of the last node at the final index, so entry 0 takes
the first node and entries 1..N-1 become a ramp from the second node
TO ITSELF. Reproduced exactly: 2 tones of 6; move the second node to
index 5 and the same two colours give the expected six-step ramp.

They got there because THE ENTRY COUNT CLAMPED NODE INDICES, which is
destructive and irreversible:
  entries 6 -> nodes [0, 5]
  entries 1 -> nodes [0, 0]   (clamped)
  entries 6 -> nodes [0, 0]   (never comes back)
One is the slider's minimum, so passing through it in a drag was
enough. Nodes now carry a PROPORTIONAL position and are RESCALED, so
a node at the far end stays at the far end and the round trip is
lossless.

TWO MORE, both the same shape — the tool hiding a spec problem:
 * Duplicate node indices are now reported in words, because the
   result is silent and reads as a colour bug.
 * "tones emitted" only warned when tones EXCEEDED entries, so "2 of
   6" — four duplicated entries, i.e. the palette you asked for not
   being the palette you got — rendered in GREEN. A measurement that
   can only fail in one direction is half a measurement. It now warns
   both ways and names the cause.
Also surfaced: nodes asking for more chroma than sRGB can show at
that lightness and hue are reported as clipped, since an author is
entitled to know they did not get what they asked for.

### Bench: sliders beside the boxes for L, C and h

Each node channel is now TWO CONTROLS OVER ONE VALUE — the slider for
finding it, the box for saying it exactly — each writing the model and
then mirroring the other, so they cannot disagree.

Two details that are not cosmetic:
 * THE ROW IS NOT REBUILT WHILE A CONTROL IS BEING DRAGGED. The old
   editor called renderNodes() on every input event, which replaced
   the very slider under the pointer — survivable for a number box,
   useless for a drag. Rows are now real DOM elements built once;
   editing updates the model, the paired control, the swatch and the
   picture, and leaves the row alone.
 * THE HUE SLIDER SPANS -360..720, not 0..360. Unwrapped hue is the
   rule that stops an arc being guessed, and a single-turn slider
   would have quietly retired it: a path like 300 -> 620 must stay
   expressible.

Suite: verify-bench Q1-Q5, mutation-tested — unpairing the controls
fails Q1, a single-turn hue slider fails Q2, clamping instead of
rescaling fails Q3, and a one-way tone measure fails Q4. Battery
19/19.

SHIM LESSON, again: the test shim had no querySelector or
removeChild, which the node editor uses, so it could not run the page
it claims to test. It now models children. Second time the shim has
had to grow to match the page — the rule stands that a shim which
disagrees with the page tests a document that does not exist.

### Bench: the preview is pinned (2026-08-19)

Every knob in the single-sky editor changes the picture, so scrolling
to reach one and losing sight of the other made the tool answer a
question you could no longer see. The preview column now sticks to
the viewport while the controls scroll past it, and the palette strip
and the gate panel ride with it — those are the other two things you
read while turning a knob.

One CSS detail worth pinning in the suite rather than in memory:
`align-self: flex-start` is load-bearing. A flex child stretches to
the row's height by default, and a stretched element has no unfilled
space to stick within, so `position: sticky` would silently do
nothing. Checked by R1a, and mutation-tested — removing align-self
fails it.

Suite: verify-bench R1-R2.

## Phase 7.1 — SHAPES ARE DATA, NOT MODES (2026-08-19)

The old band POLICIES (FINE / STRIPE / CUT / FLAT) were names for
QUANTISATION configurations. Quantisation is gone and so are they —
and measured, what each of them MEANT is now a couple of numbers:
FINE and STRIPE differed only in how many tones, which is literally
`entries`; CUT's hard edges are the DEFAULT, since every entry is
already a solid band; FLAT is entries 1.

But that cost DISCOVERABILITY. "Pick STRIPE" is something you can do
without knowing the model; "set entries to 10 and burstPx to 32" is
not. There was also an asymmetry: colour had named families in the
generator (WASH, SHIFT, WARM, CUT, FLAT) while the distribution had
no named starting points at all.

So the names return as DATA — a table of known-good starting points
that seeds the numbers and gets out of the way. FINE, STRIPE, HAZE,
CUT, FLAT, each carrying a sentence saying what it reads as.

THE DISTINCTION IS THE POINT, and it is the same one that makes the
bench export specs rather than code: a preset that SEEDS NUMBERS is
an authoring affordance; a preset that LIVES IN THE MODEL is a mode,
and modes are what Phase 7 spent itself deleting. Nothing in the
pipeline reads the table — paletteOf, distribute, rows and nodesOf
have never heard of it, and W1 asserts as much.

A shape touches DISTRIBUTION ONLY: never a node, never a hue, never
the floor. Colour is stage one's business and how much of the frame a
sky occupies is a composition decision. Node POSITIONS rescale
proportionally with the entry count, so a round trip through FLAT
(which is one entry, and therefore collapses every node to 0) comes
back with the spread intact — otherwise a shape button would be a
trap.

Measured, applied to asia-lime: FINE 26 tones / 13% field, STRIPE 10
tones / 64% field, HAZE 18 / 49%, CUT 12 / 60%, FLAT 1 / 100%. All
inside the band gate.

Suite: verify-px-render W1-W4, verify-bench S1-S1c. Mutation-tested —
letting the pipeline read the table fails W1, making STRIPE
many-toned fails W2a/W2b, and collapsing nodes on apply fails
W2b/W2d.

TWO MEASUREMENT BUGS IN W1 ITSELF, both of the "true for the wrong
reason" family and both worth keeping:
 * The first slice ran from paletteOf to ambient and swallowed the
   SHAPES DECLARATION sitting between them — the check reported the
   table as evidence against itself. Slicing function by function
   still swallowed it, because a `const` sits between distribute and
   applyShape: a body must end at the next TOP-LEVEL declaration of
   ANY kind, not the next `function`.
 * The name list included `solveRow`, which the two-stage model does
   not have. The lookup returned an empty string and contributed
   nothing, silently. Every name is now asserted to have been FOUND,
   so the check cannot pass by examining nothing — mutation-tested by
   naming a function that does not exist.

## Phase 7.2 — PER-ENTRY WEIGHTS AND THE RHYTHM VOCABULARY (2026-08-19)

Eddie, from a Super Hang-On crop: the bands are of varying thickness
AND NOT IN ORDER — thin, thin, THICK, thin, medium, thin, thin.

He was right that we could not do it. Measured across the whole range
of `spread` on a 12-entry, 36 px burst, the only variation it produces
is rounding noise: it is a MONOTONE curve, so widths either shrink
toward the horizon or grow toward it. The reference is not a curve —
the artist was choosing row counts.

THE MECHANISM. An entry may carry a WEIGHT, and the burst's fixed
pixel height is apportioned among the entries in proportion. One
field, one mechanism: a short list TILES, which is exactly what a
rhythm is. Largest-remainder apportionment, so the rows sum EXACTLY
and the result is deterministic to the bit.

PURELY ADDITIVE, and asserted rather than claimed: with no weights
the old curve runs untouched, and the whole library renders
byte-for-byte as before at four buffer heights (X1, hashed).

DEVICE INDEPENDENCE SURVIVES: the burst is a fixed pixel count and
weights only divide it up, so TICK reads 2,2,6,2,2,6,... identically
at 148 rows and at 693.

THE VOCABULARY, held as DATA exactly as SHAPES is — nothing in the
pipeline reads it:
  EVEN     every band the same — the curve, unaccented
  TICK     two thin, one thick — the commonest reference beat
  PULSE    an irregular five, never quite repeating to the eye
  BREATH   wide then narrowing, over and over
  ACCENT   a heavy beat every sixth band
  CLUSTER  two tight clusters with a plateau between them

CLUSTERS CAME FREE. "Two burst clusters" was listed as a separate
gap; it is the same mechanism — CLUSTER yields 2,2,2,10,2,2,2,2,2,2,10
which is precisely two tight groups with a plateau between them. That
it fell out rather than needing its own feature is the sign that
weights were the right generalisation and not a patch.

THE GATE HAD TO MOVE TO THE MEDIAN. bandMax was written for an
UNACCENTED burst, where every band was supposed to be thin — and a
rhythm strikes thick beats on purpose (TICK 6 px, CLUSTER 10 px), so
under the old rule none of the vocabulary could ever be rolled. The
law was never "no band is thick", it was "the TYPICAL band is thin",
which a median states and a max cannot. GATES.bandTypical (the
median) plus GATES.bandAccent (a looser bound, so an accent cannot
quietly grow into a second field). The classic hours declare their
own typical band of 20 — they are a full-height LADDER, not a stripe
field, and holding them to a stripe field's law would be holding them
to something they never claimed. Exempt BY DECLARATION, as with the
tone budget.

THE GENERATOR ROLLS A RHYTHM INDEPENDENTLY OF THE COLOUR, which is
the whole reason the two stages were kept from consulting each other.
Measured over 500 rolls: zero fallbacks, all six rhythms drawn, all
five colour families drawn, and 25 distinct family x rhythm pairings.
EVEN is weighted in deliberately — an unaccented burst is a
legitimate look, not a failure to choose one.

Bench: rhythm buttons beside the shape buttons, plus a weights field
for typing a pattern directly (typing one drops the rhythm NAME,
since it is no longer that rhythm). The resulting pixel widths are
shown, not just the pattern, because a tiling pattern against a fixed
budget is not obvious from the pattern alone. The roll sheet reports
the rhythm spread alongside the family spread.

Suite: verify-px-render X1-X7b, verify-bench T1-T6. Mutation-tested —
ignoring weights fails X2a/X5, dropping the apportionment remainders
fails X4a (and U2), and stopping the generator rolling rhythms fails
X7/X7a.

Proof: docs/phase72-rhythms.png — the six rhythms over one palette,
then thirty seeded rolls.

STILL OPEN, and deliberately after this: STRIPES AS TEXTURE (a broad
region of fine alternation, rather than a transition — dither is
gated to transitions by ruling, so this would be authored as
alternating pinned nodes and wants more reference crops before it
becomes a feature), a DECLARED HORIZON LIP (currently spends an
entry, which works but is positional rather than named), and PALETTE
ANIMATION (the hardware cycled sky entries on some stages; we are
wholly static).

### Phase 7.3 — presets compose, and selection is DERIVED (2026-08-20)

Three things from one screenshot.

DO SHAPE AND RHYTHM COMPOSE? Yes, and now asserted: they write
DISJOINT fields — a shape owns how many bands and how wide the burst
is, a rhythm owns how the burst divides — so neither clears the other
and the order cannot matter. Verified both ways over the whole field
set including node positions. STRIPE alone gives 4,3,4,3,4,3,4,3,4;
STRIPE + TICK gives 2,2,7,2,2,7,2,2,6. FLAT is the one apparent
exception and is not a clobber: it sets entries to 1, and with one
entry there are no burst entries for weights to divide.

A RETRACTION, mid-build. I first "fixed" a cosmetic wrinkle — a shape
writing `spread` while a rhythm overrides it, i.e. writing a field
that currently does nothing — by skipping the write. That broke
order-independence: pressing shape-then-rhythm and
rhythm-then-shape gave different specs. Order-independence is what
composition MEANS and is worth far more than the tidiness. Reverted,
and the reasoning is now in the code: the field is DORMANT, not dead
— it takes over the moment the rhythm is cleared, so writing it
stores the shape's intention. Y1d checks exactly that.

THE HIGHLIGHT BUG. There was no `:focus` styling anywhere, so the
browser's default ring on the last-clicked button was doing duty as a
selection state — an artefact that happened to mean roughly the right
thing, and therefore kept saying FINE long after `entries` had moved
away from FINE. Focus is now styled deliberately and in a different
colour, so "this has keyboard focus" can never be mistaken for "this
is what the sky currently is". The `title` attributes went too: they
fired the OS tooltip on top of the description line, so the same
sentence appeared twice in two places.

SELECTION IS DERIVED, NEVER STORED. A remembered flag goes stale the
instant a knob moves, and the tool then reports something that used
to be true — the same failure the lit() fast path had when it asked
whether the hour was CALLED noon rather than whether the column WAS
the identity. `matchesShape` / `matchesRhythm` ask the spec on every
redraw, comparing only the fields the preset OWNS. So:
 * clicking STRIPE lights STRIPE;
 * nudging `entries` puts it out by itself, with no event to remember;
 * changing the floor, the colours or the rhythm leaves it lit,
   because those are not its business;
 * loading a library sky lights whichever preset it happens to match,
   which is information the tool did not previously have;
 * two presets can never be lit at once;
 * and typed weights that HAPPEN to equal a named rhythm light that
   rhythm — because the answer is about the numbers, not about which
   button was pressed.

Suite: verify-px-render Y1-Y2f, verify-bench U1-U3. Mutation-tested —
skipping the spread write fails Y1/Y1c, dropping a field from the
matcher fails Y2a, un-deriving the lights fails U1a, and removing the
focus styling fails U2.

## Phase 7.4 — RANDOMISE, and chroma that means the same at every hue (2026-08-20)

### The button goes through the shipped roll

"Randomise stop 1, derive stop 2" is the GENERATOR, at node scale —
so the button calls `rollSky` rather than growing its own ranges and
its own derivation rule, which would be a second authority for the
same decision and would drift. What you audition is therefore
something a race could actually produce.

Two things that would have made it a worse idea if taken literally:
 * "Hue bend, lighter, less chroma" for stop 2 is precisely the WASH
   family — one of five. A fixed derivation would have made every
   press a variation on the same sky and you would never have
   discovered SHIFT, WARM or CUT by pressing it. Stop 2 comes from a
   ROLLED family.
 * It replaces the whole node list with the rolled pair (Eddie's
   ruling), and THE SEED IS THE WAY BACK rather than an undo — any
   roll is reproducible and shareable, and "the one three presses
   ago" is answerable.

It randomises the COLOUR, not the composition: the author's burst,
rhythm, floor and dither survive untouched. Only the palette size
comes from the roll, because a family chooses how many entries it
wants.

ANY HOUR is offered and is the honest default, because in a race the
cup's day-walk chooses the hour — nobody picks it. The hour dropdown
is an INPUT to the next roll, not a mode that rewrites the sky under
you.

### A CORRECTION: a bounded chroma range is not uniformly reachable

When OKLCh went in I said a bounded range is bounded everywhere. That
is true of what chroma MEANS — 0.12 looks equally colourful at every
hue — and NOT true of what sRGB can REACH. Measured, max chroma at
L 0.5 runs 0.085 at cyan and 0.281 at blue; at L 0.8 it runs 0.100 at
blue and 0.252 at green. So a flat range like [0.10, 0.17] is a fully
saturated blue and a 61%-CLIPPED yellow, and the roll comes out
punchy at some hues and muddy at others for no visible reason.
Measured across the shipped ranges, they represented anywhere from
29% to 247% of the achievable maximum — NIGHT was routinely asking
for more than twice what the screen can show.

Chroma is now rolled as a SHARE of the maximum at that lightness and
hue, with an absolute band for taste. Measured after: zenith chroma
holds 0.42-0.83 of max across every hour, and ZERO of 579 nodes ask
for something the screen cannot show. A family's chroma move became a
MULTIPLIER for the same reason: "lose about half the colour" means
the same thing at every hue, where "lose 0.08" does not.

TWO BUGS CAUGHT IN BUILD, both the same shape:
 * The horizon's chroma was evaluated at the PROVISIONAL lightness,
   and then the ground-clearance pass moved that lightness — the
   achievable maximum moves with it, so 131 of 500 rolls over-asked.
   It is now evaluated at the lightness actually used.
 * THE ACHIEVABLE MAXIMUM OUTRANKS THE TASTE BAND. The lower cap
   exists to stop a roll coming out washed out, but a very light
   horizon near blue holds only ~0.02 chroma, so a floor of 0.08 was
   asking four times what was possible, and at the extreme sixteen.
   A minimum that cannot be met is not a minimum; it is a request for
   clipping.

### The floor left the hour table (Eddie's ruling)

Where the sky meets the ground is a COMPOSITION decision about the
frame, not a fact about the time of day — a night sky and a noon sky
sit above the same terrain. The giveaway was that all five hour
ranges were near-identical (0.42-0.60). It now defaults to 0.5 and
stays there unless the author moves it; the generator does not roll
it at all.

Suite: verify-px-render Z1-Z3g, verify-bench V1-V3. Mutation-tested —
letting the taste band outrank the gamut fails Z1/Z1b, a flat
absolute chroma fails Z1/Z1a, clobbering the author's distribution
fails Z3c, and rolling a floor again fails Z2b.

Proof: docs/phase74-roll.png — 24 rolls at any hour over one author's
burst, rhythm and floor.

## Phase 7.5 — the chroma ceilings were mine, and they were wrong (2026-08-20)

Eddie: "is there a reason we're not allowing maxed-out chroma for
stop 1?" There was not. The evidence:

THREE OF THE SIX skies authored from the reference crops sat ABOVE
what the generator could roll — flat-cobalt at 0.89 of the achievable
maximum, night-indigo at 0.85, america-violet at 1.05. The generator
could not produce the skies we built from Out Run and Super Hang-On.

AND WIDENING COST NOTHING. 500 rolls at 0.55-1.00 gave the same 500
generated, the same 1.01 mean attempts, the same 16.7% worst
collision. The gates simply did not object. The only real effect was
that the cast strengthened slightly (mean tintK 0.067 -> 0.075),
which is the sky-is-the-light coupling working as designed and still
gentler than DUSK's own authored column at 0.42.

A ceiling that prevents nothing is not protecting anything.

### THE ACCEPTANCE CRITERION

"Can the generator produce something recognisably like each sky we
authored FROM the reference?" is a far better test than any number
chosen by eye, and it is now a permanent law (AA1). It immediately
surfaced two more gaps that no amount of staring at the ranges would
have:
 * NOON's hue arc stopped at 265 while the Out Run title sky is a
   violet-blue at 285.
 * DUSK's lift topped out at 0.40 while america-violet climbs 0.50 to
   a near-white horizon.
All six now reach, worst gap deltaE 0.098.

### WHAT THE CEILINGS SHOULD ACTUALLY HAVE BEEN

Only one chroma ceiling has a reason behind it, and it belongs to the
FAMILY rather than the hour: a zenith at the top of the gamut leaves
the horizon nowhere to GAIN chroma, and gaining chroma is SHIFT's
entire signature. So SHIFT keeps headroom (0.80) while WASH and CUT
head downward anyway (0.95) and FLAT has no horizon at all (1.00) —
which is exactly where the Out Run title sky sits.

THE LIFT IS PART OF THE RELATIONSHIP, so a family may own that too. A
hue-shifting sky TRAVELS SIDEWAYS; washing to white is WASH's job.
Measured, the reference Asia sky lifts just 0.05, while our SHIFT
rolls were taking the hour's 0.30-0.44 and climbing almost to white
where no gamut remains — only 14% of them managed the chroma hold
that defines the family. With SHIFT's own small lift, 37%. Likewise
CUT gained a larger lift, because a cut sky can carry all the way to
a white horizon.

### A FAULT IN THE LIBRARY, found by the same check

america-violet declared chroma 0.250 where the gamut allows 0.239 —
an OVER-ASK that clipped silently, i.e. the authored library
declaring something the generator is forbidden to roll. Corrected to
0.235, and AA1b now audits the whole library for the same fault. The
X1 library hash moved once, deliberately, and the reason is recorded
beside the number so it does not read as arbitrary.

### A CHECK THAT PINNED A VALUE INSTEAD OF A LAW

Z1a asserted the zenith chroma share sat within 0.35-0.90 — a
SNAPSHOT of what the ranges happened to be — and so it broke the
moment those ranges were widened on purpose. A check that pins a
value rather than a law punishes the improvement it should be
permitting. It now holds the actual claim: no share exceeds what the
screen can show, none comes out limp, and the INTERQUARTILE SPREAD
within an hour stays narrow (measured 0.17-0.27, against the 0.29 to
2.47 range an absolute would have given).

MUTATION-TESTED: re-narrowing NOON's cap fails AA1a, removing the
family lift fails AA1/AA3a, narrowing NOON's hue arc fails AA1, and
a library spec over-asking fails X1/AA1a. Note that re-narrowing the
cap did NOT fail the sampled AA1 — at a tolerance of 0.10 it absorbs
a modest change — which is why the analytic AA1a sits beside it. A
sampled check and an analytic one fail in different ways, and that is
the point of having both.

## The MEGA DRIVE LOOKING GLASS (2026-08-20)

A second preview in the bench's single-sky tab, below the real one,
showing the same sky snapped into the VDP's colours. BENCH-ONLY: the
game does not load js/megadrive.js and neither the sky model nor the
palette reaches for it. That containment is the point, and the
measurements below are why.

### The hardware, stated correctly

Nine bits — three per channel, EIGHT levels, 512 colours. The DAC
ramp is NOT linear: measured, the gaps run 52, 35, 29, 28, 28, 34, 49
— tight in the middle, wide at the ends. Using an evenly spaced
0/36/73/... ramp is the commonest way to get this wrong and it makes
the shadows too bright.

The other half of the constraint, not modelled because it is a design
discipline rather than a conversion problem: 64 on screen at once,
four banks of sixteen with entry 0 transparent, so 61 unique plus a
backdrop. For scale, a frame of ours spends roughly 100 distinct
colours (24 sky, ~48 melon bands, terrain, text, decals).

### TWO MEANINGS OF "NEAREST", and the bench offers both

PER-CHANNEL is what a converter does — round each channel to its
nearest level independently, which is what the hardware's registers
imply. PERCEPTUAL asks which of the 512 actually LOOKS closest, in
OKLab. Measured over the shipped library they disagree on 22% of
colours: small differences (mean deltaE 0.006, worst 0.018), but a
real choice, so it is offered rather than decided.

### What the snap costs — measured, per sky

  noon            24 -> 11   lost 13   mean dE 0.033
  morning         24 -> 12   lost 12
  golden          24 -> 13   lost 11
  dusk            24 -> 12   lost 12
  night           22 -> 10   lost 12
  flat-cobalt      1 ->  1   lost  0
  asia-lime       16 ->  5   lost 11
  america-violet  12 ->  9   lost  3
  hangon-violet   18 ->  9   lost  9
  africa-pale      8 ->  4   lost  4
  night-indigo    12 ->  6   lost  6

THE PATTERN IS THE FINDING: the skies that survive are the ones
authored LIKE a Mega Drive sky. america-violet — hard cuts, big
colour jumps — keeps 9 of 12. asia-lime, a smooth hue walk, keeps 5
of 16. A fine ladder loses half. Quantisation does not damage a sky
that was already making decisive steps; it destroys one built on
subtle neighbours.

And beyond the sky, a naive snap would break two more shipped
systems: 14 of 35 seeded melon anchors COLLIDE, and FOUR OF THE FIVE
HOURS produce an identical terrain colour, because the grey-axis step
here is deltaE 0.091-0.325 while the light column's moves are
smaller. The hardware's grid is coarser than the distinctions our
lighting makes.

### The conclusion the numbers point at

A strict fork could not be a filter. It would have to author INSIDE
the 512 — making it the gamut that clippedC, the collision radius and
the reachability criterion all speak in — and it would have to make
the HOURS A PALETTE SWAP rather than a computed tint, which is what
the hardware actually did: you did not recolour the world, you wrote
a different CRAM. That is a coherent project and arguably more
authentic; it is not a switch.

Suite: verify-bench W1-W4a. The second preview snaps THE SAME rows()
output rather than re-solving, so the two pictures can only differ by
the snap itself — the one thing the view exists to isolate. W3 pins
the containment: the game must not load the module.

J EARNED ITS KEEP. The layer rule — written for the CLASS rather than
for one id after the black-screen bug — caught the new Mega Drive
overlay the moment it was added, because the new preview needed the
same transparent-background treatment. A rule written for the shape
of a mistake rather than for its instance.

Proof: docs/megadrive-compare.png — every library sky, real above,
snapped below.

## THE BAND RIPPER (2026-08-20)

A first tab in the bench that recovers a sky's SOURCE band structure
from a screenshot, so "does our sky look like Super Hang-On" stops
being a judgement and becomes a number.

### What it promises, and what it refuses to

It does NOT reproduce the screenshot pixel-for-pixel, and should not:
a scaled, compressed capture contains rows that are not sky colours
at all but blends of two bands the hardware never drew — three of 74
runs on the reference crop measured ZERO source pixels tall. Chasing
those would mean reproducing the scaler.

The goal is to reconstruct THE SOURCE FRAME, and the score is the
RESIDUAL: how much of the capture the reconstruction fails to
explain, split by band EDGES versus INTERIORS. Edge-concentrated is
scaler ringing and the rip is sound; spread through interiors and the
rip is wrong. Measured on Eddie's crop: mean 0.0110, edges 0.0375,
interiors 0.0087 — a 4x ratio, edge-concentrated.

### Three things measurement decided rather than opinion

SCALE FROM THE MODE, NOT THE THINNEST RUN. The thinnest latches onto
an anti-aliasing sliver; the mode is overwhelmingly robust — 56 of 74
runs on the crop were exactly one source pixel. A GCD cross-check is
reported alongside, and when they disagree that is information, not
something to resolve silently.

OCCLUDED ROWS ARE ABSORBED, NOT DROPPED. A row with a HUD box over it
still occupies vertical space. The first cut dropped them and
silently shrank the sky: 301 of 1400 rows sat under the HUD and the
rip reported 154 px where 1400 rows at 7x must be 200. Absorbing them
took the residual from 0.104 to 0.011. They are counted and reported,
and excluded from the score — marking ourselves on furniture would
make the residual a measure of how much HUD is in the screenshot.

TOLERANT AGREEMENT, NOT EXACT. In a JPEG no two pixels in a row are
identical, so exact agreement is near zero everywhere and a threshold
on it rejects the entire image. The first run returned ZERO bands.

### The palette cross-reference: measured, and refused

Eddie asked whether ripped colours could be matched against the
Genesis palette. Measured, on this source, NO — and the tool now
reports the evidence rather than assuming either way. Fitting the
ripped colours against every candidate depth:

  3-bit  measured 9.27  vs 9.11 expected if UNQUANTISED  no signal
  4-bit  measured 4.78  vs 4.25                          no signal
  5-bit  measured 2.07  vs 2.06                          no signal
  6-bit  measured 0.94  vs 1.01                          no signal
  MD DAC measured 9.72  (worse than the linear ramp)     no signal

At every depth the distance matches what arbitrary 8-bit colour would
give: scaling and JPEG have destroyed the quantisation signature
entirely. Snapping anyway would not correct compression — it would
invent a provenance the pixels do not support, and we would then be
chasing a target we had fabricated. Note also that ARCADE Super
Hang-On ran at 5 bits per channel, not the Mega Drive's 3, so
snapping an arcade sky to the Genesis palette is a category error
before compression enters into it. Feed the tool a clean emulator PNG
and the signal will appear; it says so when it does.

### What the rip found

  scale 7x   54 runs -> 47 source bands, 33 colours
  field  80px (40%)      burst 119px in 38 bands
  burst typical 1px, max 18px
  sequence: 24 up, 13 down -> OSCILLATION 35%

The oscillation is the headline. A monotone ramp scores 0%. The
reference SAWS — rises, rises, drops back, rises — because it is
using ordered dithering as a TEXTURE across the whole burst, not just
at transitions. Our model cannot express that at all: entry k sits at
position k, in palette order, each used exactly once. We march, they
saw. That is the missing third stage — palette (which colours),
distribution (how thick), SEQUENCE (which colour where) — and it also
retires the "stripes as texture" open item, which turns out not to be
a separate feature but something a free sequence gives for nothing.

The field is also 40%, not the bottom-quarter burst inferred by eye
from the earlier crops.

### Suite and honesty

verify-bench X1-X5c, all against SYNTHETIC rows — which is the point
of the module never touching a canvas. Mutation-tested: dropping
occluded rows fails X3, scale-from-thinnest fails X1/X1a/X1c, and a
depth fit that always claims a signal fails X4a.

ONE HONEST NULL RESULT. The rule that a band's colour comes from its
INTERIOR rows survived a mutation that removed it — because taking
the MODE already outvotes a contaminated row. Rather than manufacture
a contrived case to justify the line, it is recorded in both the
module and the check as a REFINEMENT that matters only on short
bands. A check that cannot fail should say so rather than pretend.

Proof: docs/ripper-proof.png — measured beside reconstructed.

NEXT: free the sequence. The ripper's natural output — palette,
sequence, widths — IS a spec in that model, so ripped targets become
loadable with no conversion. That the two jobs meet exactly is the
strongest evidence available that a free sequence is the right
extension rather than a bolt-on.

### Ripper diagnostics: not flattering weak evidence (2026-08-20)

Eddie ran the ripper on arcade Super Hang-On (Europe stage) and asked
whether it did well. Mechanically yes; but THREE of the numbers said
"treat with caution" and the tool was showing two of them in green.
All three were my calibration, not his input.

WHAT THE SOURCE ACTUALLY WAS, and it vindicates a warning while
correcting my reading of it. The file is a 480x360 YouTube thumbnail
of arcade Super Hang-On, which runs at 320x224 — so the file is at
1.5x — and the bench was handed a RETINA SCREENGRAB of it, hence 3x.
The ripper's inferred 3 was CORRECT. The gcd of 1 was mechanically
right (1.5 is fractional, so runs land on 2, 3 and 4 rows and no
common divisor exists) but I read it as "the rip is suspect" when it
meant "there is a fractional stage upstream". Different thing, and the
tool now says which.

THE RESIDUAL REWARDS DOING NOTHING. 31 colours for 41 runs scored
0.0034 — but that rip had barely clustered, so it was echoing its
input. Clustered properly (20 colours) the same source scores 0.0143
with the INTERIOR residual EXCEEDING the edge residual (0.6:1), which
is the "rip is wrong" signature. The low number was the weaker
evidence. The compression ratio now sits beside the residual and the
verdict is withheld entirely when compression is too low.

CAUGHT BY ITS OWN CHECK: the first compression metric was
palette/bands, which is self-defeating — when clustering merges
ADJACENT bands both numerator and denominator shrink together and the
ratio sits at 1.00 however hard the rip worked. A probe that clustered
twenty bands into one still reported "too little compression". It is
now measured against the RAW RUN COUNT.

Also corrected: the far-repeat gap was >2, which missed a return with
exactly one intervening colour — already a genuine return to an
earlier entry rather than an alternation with a neighbour.

Thresholds tightened: mode share wants 60%+ (was 30%), edge:interior
wants 2:1 (was 1.5), and a fractional scale is stated in words.

### WHAT WE LEARNED ABOUT THE SKIES — for the single-sky tab

Two reference stages ripped, and they are STRUCTURALLY DIFFERENT
skies. Both need to be reproducible before the bench can claim to
make Super Hang-On skies.

EUROPE (arcade, blue):
  scale 1.5x   ~30 bands, ~20 colours after clustering
  field 41%    burst 98px in 33 bands, typical 1px
  oscillation: 0% ABOVE the field, 38-40% BELOW
  far repeats: 10
  TWO FIELDS, not one — 67px and 41px, with burst between them and
  more below. The two-cluster shape, confirmed in a reference rather
  than hypothesised.
  Its sequence marches strictly upward for 23 entries and only then
  saws: 0,1,2,...,22,21,23,24,21,22,23,23,21,22,23,25

VIOLET (the earlier crop):
  scale 7x     47 bands, ~20 colours
  field 40%    burst 119px in 38 bands, typical 1px
  oscillation: 86-100% above, 36-39% below — it saws THROUGHOUT
  far repeats: 18-23

THE MODEL CANNOT EXPRESS EITHER. Entry k sits at position k, in
palette order, each used exactly once. Both references RETURN to
earlier entries after other colours have intervened — Europe does
...4,3,5,6,7,8,4,3... — which is not a dither alternation between
neighbours but an actual reuse. That is the missing third stage:
palette (which colours), distribution (how thick), SEQUENCE (which
colour where).

And one average was hiding the difference: a sky that marches then
saws and a sky that saws throughout both read ~35% oscillation. The
figure is now split above and below the field, and far-repeats are
counted separately, so the two skies are distinguishable by number.

NOTE ON THE SPLIT: it is field-relative, and Europe has TWO fields
while the split only knows about the largest. It is a useful signal,
not a complete description — per-segment reporting would be the
honest next step if it starts carrying weight.

Suite: verify-bench Y1-Y3b.

### Ripper: three more ways it was flattering itself (2026-08-20)

A second real run, on the same Europe stage but with the sky selected
in the tool, surfaced three more. Two were the SAME MISS one notch
further down each time — a confidence signal that only fired in the
case I had already thought of.

A SCALE OF 1 CANNOT BE VERIFIED. The gcd test only fires when the mode
is above 1, so a fractional scale BELOW 2 slipped past it entirely and
was reported CONFIDENT. Measured: a 480x360 capture of a 320x224
arcade frame is 1.5x, an integer inference cannot represent that, so
it reports 1 — and every width it hands back is then in SCREENSHOT
pixels. The reported 182 px total was really ~121 arcade px; the
119 px field was really ~79. Everything 1.5x too large, in green.
Scale 1 is now reported as unverifiable, with the reason and the
instruction to divide by the true scale.

AN EMPTY SAMPLE IS n/a, NOT 0%. When the field is the first band there
is nothing above it, and "0% oscillation above the field" reads as
"it marches" when the honest answer is "there was nothing to measure".

A TOO-NARROW REGION IS FLAGGED. Voting the modal colour across the
width is the whole robustness of the sampler, and the run used a 2%
selection — about ten columns of a 480 px frame. It worked only
because the left edge happened to be clear sky; one mountain or HUD
box would have corrupted it silently.

THE PATTERN WORTH KEEPING: every one of these was a diagnostic that
was correct in the case it was designed for and silently wrong just
outside it. A confidence signal that cannot say "I do not know" will
say "yes" instead.

Suite: verify-bench Y1c, Y3c, Y3d, Y4. Mutation-tested — calling
scale 1 confident fails Y1c, reporting 0% for an empty sample fails
Y3c, and removing the narrow-region warning fails Y4.

## THE RIPPER SAW CHECKERBOARDS (2026-08-20)

Eddie, from a zoomed crop of America Stage 1: is there also a
CHECKERBOARD dither, rather than only bands? There is, and the ripper
had been silently destroying it.

Measured: America_Stage1 has 19 checkered rows of 114 and
Africa_Stage1B has 24 of 119 — exactly 50/50, ONE-PIXEL cells, offset
one column per row. A 2x2 ordered dither at the finest possible
grain.

THE SIGNATURE WAS IN THE TOOL'S OWN OUTPUT. Those two files, and only
those two, printed an agreement of exactly 0.50 — and I read past it.
Taking the modal colour of a 50/50 row collapses it to whichever
colour wins a coin toss, so two of eight reference captures were
transcribed as flat bands and reported EXACT.

THE FIX. A row may now carry its runner-up colour and the modal
share. A two-colour row at a roughly even split is recorded as a
DITHER — kept, both colours entering the palette, never mistaken for
occlusion — and a dithered band never merges into a solid neighbour
that happens to share its modal colour. All eight references rip
exact again, with the dither reported rather than hidden.

AND THE RESIDUAL'S LIMIT IS NOW STATED. It is a ROW-BASED score: it
measures vertical structure exactly and CANNOT SEE horizontal
structure at all. `ditherPx` and `ditherBands` report that separately
so a perfect residual is not allowed to imply the rip caught
everything. A first rebuild alternated by ROW parity and introduced
error where there was none — a 1-pixel checkerboard varies ACROSS the
row, not down it.

ANOTHER VACUOUS CHECK, and this one is worth the space. Z2 asserted
"the vertical residual stays exact" and COULD NOT FAIL when the
rebuild was broken, because the dithered row was already being
skipped — by its AGREEMENT falling below the threshold, which made
the exclusion an accident of one number rather than a stated rule.
Two corrections: the residual now excludes dithered rows EXPLICITLY,
and Z2d asserts the rebuilt band directly. The parity mutation now
fails as it should. The pattern, roughly the sixth of its kind: a
check that is true for a reason unrelated to the thing it names.

### FOUR KINDS OF DITHER NOW CATALOGUED FROM THE REFERENCES

  1. NONE — spend palette entries instead. Asia_Stage10: 24 colours,
     23 of them one-pixel bands.
  2. VERTICAL ALTERNATION with a SHIFTING DUTY CYCLE. America_Stage14
     and _Stage1B, NameEntry: FOUR colours each, sequences like
     0,1,0,1,0,1,2,1,2,3,2,3,2,3 — pairs of adjacent entries
     alternating, walking down the palette. The widths ramp
     (1,2,1,1,7,1,3,1,2,2) so the duty cycle crossfades rather than
     flickers.
  3. HORIZONTAL CHECKERBOARD, 1px cells, 50/50, offset per row.
     America_Stage1, Africa_Stage1B.
  4. Combinations — Africa_Stage1B does 2 AND 3.

### WHAT THE SINGLE-SKY GENERATOR STILL CANNOT DO

Measured against our own library through the same instrument:

  * NO HORIZONTAL DIMENSION AT ALL. Every row we emit is a solid
    band by construction, so type 3 is unreachable.
  * FIXED DUTY CYCLE. Our dither gives 64,1,1,1,1,16,1,1,1,1,16
    against a reference 44,1,2,1,1,7,1,3,1,2,2 — the right SHAPE of
    sequence (I was wrong to say we cannot repeat entries; we can),
    but a flicker at a boundary rather than a crossfade across the
    burst.
  * INTERPOLATION BETWEEN PINS. Africa_Stage1's eleven colours step
    0.0013, 0.0024, 0.0037, 0.0056, then JUMP 0.0677, then six even
    steps — a 54x ratio between smallest and largest. Pinning nodes
    captures the jump; the segments between pins are still walked
    EVENLY, and four of eleven entries came out wrong. At eleven
    colours a palette is a list to be STATED, not a ramp to be
    interpolated — every entry should be pinnable.

Suite: verify-bench Z1-Z3a. Mutation-tested — removing dither
detection fails Z1/Z1b, rebuilding with row parity fails Z2d, and a
sampler that drops the runner-up fails Z3.

## Phase 7.6 — ALL EIGHT REFERENCES REPRODUCED EXACTLY (2026-08-20)

The three capabilities the 1:1 emulator grabs proved we lacked, built
and measured against those grabs. Every one of the eight now
reproduces exactly: same palette, same widths, same dither.

### 1. A PALETTE MAY BE STATED, NOT INTERPOLATED

Africa_Stage1's steps run 0.0013, 0.0024, 0.0037, 0.0056, then JUMP
0.0677, then six even steps — a 54x ratio between smallest and
largest. Pinning nodes AT the jump catches the discontinuity, but the
segments between pins are still walked EVENLY: measured, seven of
eleven entries came out wrong.

At a dozen colours a palette is a LIST TO BE STATED, not a ramp to be
interpolated. `pinAll` turns one into the other, and interpolation
stays what it always was — a convenience for authoring a 24-entry
ladder, not a law about what a sky is.

### 2. AN EXPLICIT SEQUENCE

Band k used entry k, in palette order, each exactly once: the model
MARCHED. Every reference RETURNS to earlier entries after others have
intervened, which is reuse and not a dither between neighbours. A
spec may now state which entry goes in which band, and entry order
and band order stop being the same list.

### 3. CROSSFADE, and the HORIZONTAL DIMENSION

The old dither is a fixed flicker at a boundary: 64,1,1,1,1,16
against a reference 44,1,2,1,1,7,1,3,1,2,2. `crossfade` spends a
share of each band fading into the next with a duty cycle that RAMPS
— A holds while B flickers, then the reverse. Measured, four entries
now produce 24 to 46 bands, which is how the references get sixteen
apparent steps out of four colours.

`checkerFade` renders the middle of each fade as a 1-pixel
CHECKERBOARD across the row. rows() has only ever described vertical
structure, so it is carried as an OPTIONAL field: a consumer that
does not understand it paints `hex` and gets the modal colour —
exactly what the old model produced. The renderer paints the second
colour in alternating cells, offset per row.

### THE RIPPER'S OUTPUT IS A SPEC

`fromRip` takes palette, sequence and widths straight into the model
with no conversion and no lossy step. That the two halves meet
exactly — one built to READ skies, one to WRITE them — is the
clearest evidence available that they were designed against the same
idea of what a sky is.

### AND A REAL AMBIGUITY, NOW REFUSED RATHER THAN GUESSED

Three references would not reproduce until this was fixed. A capture
upscaled 2x from 1-pixel bands and a NATIVE capture whose artist drew
2-pixel bands produce IDENTICAL run lengths — nothing in the data can
tell them apart. Measured on Africa_Stage1, a 1:1 grab: every run is
even, the mode reads 2, and dividing by it HALVED a sky that was
never scaled.

So an unconfirmed scale is DETECTED AND REPORTED BUT NOT APPLIED.
Dividing by a number the data cannot justify rewrites the artist's
work. The caller may still say so explicitly.

That change broke three bench checks, correctly — they had been
asserting that a 7x synthetic probe rips to source resolution
automatically. They now test DETECTION and APPLICATION separately,
which is the honest shape.

Suite: verify-px-render AB1-AB4d, verify-bench X1x. Mutation-tested —
ignoring stated sequences fails AB2, a flat duty cycle fails AB3a,
removing checkered rows fails AB4.

A CHECK THAT MEASURED THE WRONG THING: AB3a first counted the second
entry across a FOUR-entry sky, where it appears in two different
fades — as the target of one and the source of the next — so the
totals said nothing about either. Two entries means one fade and an
unambiguous reading.

Proof: docs/phase76-repro.png — reference left, our model right, for
all eight, plus an AUTHORED four-colour sky using crossfade and
checker rather than a rip.

## Phase 7.7 — BREATH, split seed streams, and the VDP sees dither (2026-08-20)

### The Mega Drive preview was lying about checkerboards

It painted `MD.snap(row.hex)` as a flat band and stopped — the exact
fault the ripper had, reproduced on the other side of the tool. The
colour translation was always sound; it simply did not know the
second colour existed. Both are now snapped and painted in
alternating cells.

AND SNAPPING CAN COLLAPSE A CHECKERBOARD. If both colours land on the
same VDP entry the dither does nothing and the row is flat on the
hardware — a real constraint on designing a sky for the machine. It
is COUNTED and reported, not quietly rendered as a solid band.

### BREATH — the space between FLAT and WASH

Nothing was enforcing a minimum difference between the two stops. The
separation came from every hour's LIFT floor (0.10 at the lowest,
0.30 for most), so a sky that varies SUBTLY rather than not at all
could not be rolled: the closest zenith/horizon pair in 2000 rolls
measured deltaE 0.084, twelve times the collision radius.

Loosening every hour's floor would have made every family capable of
near-flatness and stopped them reading as themselves. A family with
its own tiny lift (0.005 to 0.09) puts the behaviour where a reader
looks for it. Measured after: the closest pair is now deltaE 0.0063 —
about one L* step, essentially the same colour.

It is exempt from the ground clearance, and that exemption is
principled rather than convenient: the clearance exists so the
HORIZON reads as an edge, and a BREATH sky is one tone throughout —
its edge comes from the contrast with the terrain instead. Shoving
its horizon 0.17 in lightness would destroy the thing the family
exists to make.

A NAME COLLISION AVOIDED: the rhythm vocabulary already had a BREATH.
Two namespaces sharing one word would have printed roll captions like
"BREATH/BREATH", so the RHYTHM became SWELL — same meaning, and AC2
now asserts no name appears in both tables.

### ONE SEED STREAM PER STEP

A shared stream means changing anything changes everything, because
the numbers after it in the sequence have moved. Each step now
derives its own — `seed|colour`, `seed|dist` — so a step can be
rolled alone, "roll everything" is all of them with one base seed,
and any combination is reproducible from a single string.

The bench has three buttons: colour, distribution, everything.
DISTRIBUTION ROLLING WAS THE BIGGEST VISIBLE GAIN, because until now
every rolled sky had the same proportions and only its colours
changed — which is why a contact sheet read as one sky in many
colours. Measured over 60 rolls: 29 burst sizes, 32 spreads, all six
rhythms.

### Three check lessons, all the same family

AA1 (REACHABILITY) FAILED FOR A REASON UNRELATED TO WHAT IT MEASURES.
Splitting the streams changed the random SEQUENCE without touching a
single range, and the 400-seed sample went from deltaE 0.098 to
0.128. Reachability is a property of the RANGES; a sample must be
large enough to DEMONSTRATE that rather than lucky enough to stumble
on it. Raised to 1600 (it reaches at 1200, comfortably at 4000).

AC3 AND AC3a COULD NOT CATCH A MERGED STREAM. They compare
randomiseColour against randomiseDistribution, and those copy
DISJOINT FIELDS — so they pass whether the underlying streams are
separate or not, and the mutation sailed through. AC3e tests the
observable property instead: a gate RE-ROLL exists because attempt 0
failed a law about colour, so it must redraw the colour and leave the
distribution alone.

AC3e THEN FAILED ON CLEAN CODE, and the claim was wrong rather than
the code. The distribution is not FULLY independent of the colour,
because its ranges live on the FAMILY — a FLAT family declares
burstPx [0,0] — and the family is a colour decision. The true
property is narrower: GIVEN THE SAME FAMILY, the distribution is
identical across attempts. Still catches a merged stream.

Suite: verify-px-render AC1-AC3e, verify-bench AA1-AB1b.
Mutation-tested — giving BREATH a normal lift fails AC1/AC1b, merging
the streams fails AC3e, a distribution roll that keeps the burst
fails AC3c, and an uncounted checkerboard collapse fails AA1a.

### STILL TO ROLL, in the order agreed

  1. distribution — DONE
  2. DITHER CHARACTER — crossfade, checkerFade, and the trade between
     "spend entries" and "spend dither". This is the axis separating
     Asia_Stage10 (24 colours, no dither) from America_Stage14 (4
     colours, all dither), and the most distinctive thing about the
     reference set. Needs a RULE, because the two trade off: a
     24-entry sky should not crossfade and a 4-entry sky must.
  3. entry count — the same decision seen from the other side.
  4. sequence — the reuse patterns. Hardest to roll well, because
     random reuse is noise; wants a vocabulary like the rhythms.

## Phase 7.8 — THE PALETTE BUDGET, and a rolled floor (2026-08-20)

### Entry count and dither are ONE decision

The reference set shows two solutions to the same problem:
Asia_Stage10 spends TWENTY-FOUR colours and dithers not at all;
America_Stage14 spends FOUR and dithers everything. Both read as a
gradient. Rolling them independently would produce the two incoherent
corners — a 24-entry sky crossfading (pointless, it already has the
steps) and a 4-entry sky not (four visible bands, not a sky).

So a BUDGET is rolled once, from its own stream, and sets both:
  LADDER   17-26 entries, no dither          — spend the palette
  STEPPED  11-17 entries, a light fade       — a middle course
  FADE      4-9  entries, 70-100% crossfade  — spend the dither
  WEAVE     5-11 entries, heavy checkerboard — spend it sideways

Measured before this existed: ZERO of 500 generated skies had ANY
crossfade or ANY checker. The most distinctive quality of the
reference set never appeared in a roll. After: 330 crossfade, 327
checker, entry counts spanning 1 to 26, every budget drawn.

THE ENTRY COUNT NOW LIVES ON THE BUDGET AND NOWHERE ELSE. It used to
sit on the family as well, and two authorities for one number is
exactly what this project keeps deleting. FLAT is the single
exception, and it declares `fixedEntries: 1` — one colour is what
FLAT MEANS rather than a way of spending a budget.

### The floor is rolled again, 40% to 90%

Eddie's ruling. It does not reopen the earlier one: what that settled
was WHERE the floor belongs — composition, not time of day — and it
still holds. No hour carries it; it is rolled from the GEOMETRY
stream alongside the burst and the rhythm.

### A BUG THE GATES CAUGHT: the field was crossfading

95 of 500 rolls fell back when the budget step first landed, almost
all on FADE and WEAVE, and the accent gate fired 1192 times. The
cause was not the gate: the crossfade was being applied to the FIELD.
A 6-entry sky with a 119-row plateau came out as 21,1,7,1,3,1,3,...
with the field shredded.

THE FIELD IS A PLATEAU BY DEFINITION and fading it destroys the thing
it is — the reference does exactly this, holding 44 solid rows before
it begins to fade. With the exemption: 473 of 500, and a FADE sky now
profiles 38,2,3,1,3,2,3,4,1,3,3,3,1,3,4 against the reference's
44,1,2,1,1,7,1,3,1,2,2.

### Five checks re-based, and two of them were wrong rather than stale

U2's threshold moved 490 -> 450: a much larger roll space contains
more combinations that genuinely fail a law, which is the gates
working. But U2 ALSO conflated two meanings of one variable — it
counted fallbacks and flagged shipped failures in the same counter,
so "no sky that ships may fail a gate" was never actually asserted
despite the comment claiming it was. Now counted separately.

Z2b asserted every generated sky floors at 0.5, superseded by the new
ruling — and its replacement then failed on a FALLBACK, because an
authored classic declares its own 0.92. The range is a law about what
is ROLLED, not about what the library contains.

AB3a read the ramp BACKWARDS. With three entries the faded band runs
entry 1 -> entry 2, and the check counted entry 1 — the colour the
fade is LEAVING, which is naturally commoner early. It counts the
target now.

AB3a also needed three entries rather than two: with the field
exempt, a two-entry sky has nothing left to fade, since band 0 is the
field and band 1 is the last.

Suite: verify-px-render AD1-AD4b, verify-bench AB1c. Mutation-tested
— letting the field crossfade fails U2/X7, collapsing LADDER into
FADE fails AD1b/AD2b, and a fixed floor fails AD2d.

Proof: docs/phase78-roll.png — 24 skies from 'roll everything'.

### STILL TO ROLL

  4. SEQUENCE — the reuse patterns. Hardest to roll well, because
     random reuse is noise; wants a vocabulary like the rhythms.

## Phase 7.9 — THE PATH, and an acceptance criterion that could see it

### The criterion went blind first, so it was fixed first

AA1 compared only the ZENITH and the HORIZON. Measured, that hid
exactly what mattered: america-violet scored 0.030 on its two ends
and 0.218 ACROSS THE PALETTE — the generator matched both extremes
and got everything between them wrong. The check had been PASSING on
a sky we could not make.

It now resamples both palettes by index fraction (so an 11-entry
reference and a 17-entry roll compare fairly) and takes the worst
pointwise difference: what is measured is the SHAPE of the ramp. The
threshold is 0.15 and is NOT comparable to the old 0.10 — that
measured two colours, this measures a whole path.

### The path

A family describes the relationship between the two ENDPOINTS. It
says nothing about the journey, and there was no journey: 473 of 500
rolled skies had exactly TWO nodes, so every palette was a straight
line. The references are not straight — america-violet bends 0.282
away from the line against 0.064 for the worst of 500 rolls, and
Africa_Stage1 takes four near-invisible steps then jumps twelve times
as far (53.9x step ratio, against 9.4x).

A pin needs a REASON or rolling one is noise, so the vocabulary names
the reasons the references actually show:
  DIRECT  the straight line — today's behaviour, unchanged
  EASE    one interior pin off the line
  JUMP    a pin PAIR straddling a hard step
  CUT     several pins, allowed to turn back
  SAW     rises and drops back, twice or more

PURELY ADDITIVE: the path rolls from its OWN stream, DIRECT is
weighted heavily (278 of 500), and a path that will not fit the entry
count falls back to DIRECT — with four entries there is no room for
three interior pins.

SAW EXISTS BECAUSE CUT WAS NOT ENOUGH. Spacing single alternating
pins made the fit to america-violet slightly WORSE (0.218 -> 0.223).
Its reversals are ADJACENT PAIRS: i0 L.46, i3 L.84, i4 L.52, i7 L.80,
i8 L.60, i11 L.96 — it rises, drops back in ONE step, rises again.
Modelling the tooth as a pair took the gap to 0.113.

### A HYPOTHESIS TESTED AND REVERTED

america-violet's chroma also saws, and OPPOSITE its lightness — light
pins at C 0.045 and 0.055, dark pins at 0.15 and 0.12. That looked
like the light column's own law (CHROMA MOVES OPPOSITE VALUE)
appearing inside a palette, which is a satisfying story.

Swinging chroma that way made the fit WORSE at every sample size
tested: 0.1160 against 0.1129 at both 4000 and 10000 seeds. The
observation is real; the mechanism is not, so it is not shipped. The
reasoning is recorded in the code beside the place it would have gone.

### A LAW THE NEW CODE WALKED AROUND

Moving a pin's LIGHTNESS changes how much chroma is reachable there,
and carrying the line's chroma across unchanged asked for what the
screen cannot show: 143 of 935 pinned nodes over-asked, the worst by
12.7x. This is Phase 7.4's law — the achievable maximum outranks
everything — and the new code had simply not consulted it. Every pin
now fits.

### A MUTATION TEST THAT LIED

Removing SAW's dispatch made the suite CRASH, and the mutation helper
grepped only for lines beginning FAIL — so a crash read as a pass.
The helper now requires ALL PASS to declare a survivor.

Suite: verify-px-render AE1-AE4, AA1 rewritten. Mutation-tested —
demoting DIRECT fails AE1, unclamped pins fail Z1/AA4a, and removing
the SAW dispatch is caught now that crashes count.

Proof: docs/phase79-paths.png — 24 rolled skies labelled by path.

## Phase 7.10 — the teeth were wrong three ways (2026-08-21)

Eddie, from a rolled sky: too many pinned entries, and obvious dark
bars interrupting the gradient. Three separate faults, all mine.

### 1. The tooth was DOUBLE what it said

`bend` was applied as +bend to the high pin and -bend to the low one,
so the step between them was 2 x bend — up to 0.68, where the
reference cut sky's biggest single step is 0.38. Measured worst
across 1000 rolls: 0.760. `bend` now means the step BETWEEN the pins,
which is what it always claimed to.

### 2. It was ABSOLUTE where it should have been RELATIVE

The deeper one, and the reason that sky was unusable rather than
merely strong. The offending roll was a BREATH sky whose two ends
span L 0.382 to 0.414 — a range of 0.032, near-flat by design — and
each tooth dropped 0.66. TWENTY TIMES the palette's entire range.

A saw on a sky that climbs 0.5 is a feature; the same saw on one that
climbs 0.03 is vandalism. The tooth is now scaled to the span the
palette actually covers, with a floor so it stays visible rather than
vanishing. Measured after: 1.1x the span, against 20x.

### 3. THREE TEETH IS EIGHT NODES

america-violet, the reference cut sky, uses SIX nodes and two teeth.
Ours allowed three, and 131 of 1000 rolls carried 6 or 8 nodes.
Capped at two teeth; the most any sky now pins is 6.

### AND PATHS ARE GATED BY FAMILY

The same shape of rule as HOUR_FAMILIES. 25 of 131 saws had landed on
a BREATH sky, and those two contradict each other by definition — one
says "vary as little as possible", the other "reverse hard, twice".
Even at a correct amplitude that pairing is incoherent, and a WASH
should not cut either. Now: 0 of 35.

### THE SAMPLE HAD TO GROW AGAIN, for the same reason as last time

Capping the teeth and gating by family took SAW from every family to
76 rolls in 1600 — and america-violet then read 0.189 at 1600 seeds
against 0.132 at 6000, with NO capability lost between them. This is
the second time this number has moved and both times the lesson was
identical: THE RARER THE THING BEING DEMONSTRATED, THE LARGER THE
SAMPLE IT NEEDS. 400 -> 1600 when the seed streams split; 1600 ->
6000 now. It costs 1.2s against 0.6s, which is not a reason to
measure a smaller truth.

Reported rather than quietly widened, as promised when the cap was
proposed.

Suite: verify-px-render AE1c-AE1g, AA1 sample raised. Mutation-tested
— an absolute bend fails AA1/AE1d, three teeth fails AE1c/AE1d, and
letting BREATH saw fails AE1f/AE1g.

Proof: docs/phase710-pins.png — sixteen PINNED skies (DIRECT ones
excluded, so the change is visible).

## Phase 7.11 — LIGHTNESS KEEPS ITS WORD (2026-08-21)

Eddie, having accepted more pinned skies but rejected five: the ones
he dislikes have an intermediate entry too dark for its neighbours,
and the ones he likes have "the lightness between the entries in
order (even if not linearly stepped)" with "the chroma and hue"
carrying the shift.

Measured, ALL FIVE reversed lightness:
  r27  0.426 -> 0.705 -> 0.555 -> 0.98 -> 0.956   2 reversals
  r26  0.521 -> 0.821 -> 0.635 -> 0.913           1
  r18  0.220 -> 0.623 -> 0.379 -> 0.745           1
  r16  0.495 -> 0.360 -> 0.742 -> 0.615           2
  r15  0.520 -> 0.920 -> 0.516 -> 0.963           1

### A FLAG THAT DESCRIBED AN INTENTION WITHOUT ENFORCING IT

EASE and JUMP both carried `reverse: false`. Nothing enforced it.
Measured, EASE reversed its own direction 44% of the time and JUMP
97% — JUMP displaces its first pin DOWNWARD by design (the low half
of the pair) and EASE picks a downward sign a third of the time. One
of the five rejected rolls was a SHIFT sky, which can only draw
DIRECT, EASE or JUMP — never a cut path at all.

That is the same fault as a check that cannot fail: a declaration
nobody consults. Each pin is now clamped between its neighbours
unless the path DECLARES reversal.

THE BEND SURVIVES AS UNEVEN SPACING, which is what the references
actually do: Africa_Stage1 is strictly MONOTONE and its famous 54x
step ratio is spacing, not reversal. Measured after, a monotone JUMP
reaches 106x — the signature intact, the dark bar gone.

### AND THE DEVIATION MOVED TO CHROMA AND HUE

Eddie's own diagnosis, and the references agree: asia-lime climbs L
0.82 to 0.87 while its HUE travels 67 degrees. A path could only move
L, so the only tool it had was the one that produces a dark bar. EASE
and JUMP now carry `dC` and `dh` — a band slightly more saturated or
a degree or two off-hue reads as depth where a darker band reads as
an interruption. Measured: +0.050 chroma, 14 degrees.

CUT and SAW keep their reversals, because america-violet genuinely
reverses and is a real reference sky. They remain CUT-family-only and
rare.

### TWO FAULTS IN THE CHECKING, both the familiar shape

SAW DID NOT DECLARE ITSELF. It carried `saw: true` but not
`reverse: true`, so a check asking the table which paths reverse got
the wrong answer from the path that reverses most. The data has to
describe itself before a rule can be written against it.

AND THE CHROMA CHECK SURVIVED ITS OWN MUTATION. Measured as an
ABSOLUTE deviation from the line, it passed even with the chroma bend
deleted — because clamping a moved pin back into the sRGB gamut also
shifts C off the line. Gamut clipping can only ever REDUCE chroma, so
the check now looks for a pin sitting ABOVE the line, which is
something only the deliberate bend can produce.

Reachability held at 0.132 and generation at 477 of 500.

Suite: verify-px-render AE1h-AE1k. Mutation-tested — removing the
monotone clamp fails AE1h, deleting the chroma bend fails AE1j, and
removing the lightness bend fails AE1i/AE1k.

Proof: docs/phase711-monotone.png — sixteen pinned skies.

## Phase 7.12 — ONE DIP RULE, NO EXEMPTIONS (2026-08-21)

### The number came from Eddie's own hand

Shown rolls he disliked, he dragged the offending pin upward until he
would pass it. Same seeds, same paths, ONE number changed each time:

  r26  rejected 0.521 0.821 0.635 0.913  dip 0.186
       accepted 0.521 0.821 0.790 0.913  dip 0.031
  r18  rejected 0.220 0.623 0.379 0.745  dip 0.244
       accepted 0.220 0.623 0.600 0.745  dip 0.023

An order of magnitude, with nothing in between. The cap is 0.04 —
that measurement rounded up, not a number chosen by eye. Rolled, r26
now lands at 0.781 against his 0.790, and r18 at 0.583 against his
0.600.

### The exemption went

CUT and SAW were exempt because america-violet genuinely reverses,
and the exemption produced EVERY output he rejected — seven of seven.
An exemption whose only fruit is the thing it was meant to permit,
disliked, is not earning its place. They keep their identity through
pin PLACEMENT — adjacent pairs, several pins — rather than through
amplitude, and a 0.04 tooth is still a tooth.

The FINAL node gets twice the tolerance (0.08), held loosely by
Eddie's ruling: a darker band at the very bottom is the horizon and
reads as a bright band above a settled horizon rather than as an
interruption. He accepted 0.128 there.

### And clamping flat was too much

The previous rule pressed a dipping pin level with its neighbour,
which he rated "between inoffensive and good" — safe but dull.
Allowing the dip and LIMITING it keeps the interest and loses the
dark bar. AE1i asserts the dip is at least 0.02, so a future
"simplification" to a flat clamp fails.

### THE COST, reported rather than absorbed

america-violet is now UNREACHABLE BY A ROLL. Its interior dip is
0.280, six times the cap; measured, it sits at 0.171 against a 0.15
threshold. Moving the threshold to 0.18 would have quietly
re-permitted every dip between 0.04 and 0.28 for every other sky, so
the EXCEPTION IS NAMED instead: NOT_ROLLABLE lists it, AA1 excludes
it explicitly, and AA1c checks that an excluded sky is still
AUTHORABLE — so the exception cannot hide a capability loss. The
library entry is untouched and the model still expresses it.

### A RETRACTION, caught by the check that had just been improved

I removed the descending branch of the dip limiter as DEAD CODE,
having measured 0 of 1917 rolls descending. That sample used ONE
GROUND KIT. Every lift range is positive, so the LIFT never descends
— but the GROUND CLEARANCE can, because it pushes the horizon away
from the lit ground, and over a bright kit like snow that push is
DOWNWARD. Sampled across all six kits, 19 of 1680 rolls descend on
clean code.

The branch was reachable; my evidence was narrow. Both directions are
guarded again, and AE1i2 now samples every kit and asserts the law
that actually holds: a dip is a move AGAINST THE SKY'S OWN DIRECTION,
and it is capped whichever way the sky runs. It requires descending
skies to EXIST (they do, 3 of 552) so the branch can never quietly
become dead again.

Suite: verify-px-render AE1h, AE1i, AE1i2, AA1c. Mutation-tested —
loosening the cap fails AE1h, exempting the pinned paths fails AE1h,
flattening instead of limiting fails AE1i/AE3, and removing the
descending guard fails AE1i2.

Proof: docs/phase712-dips.png — sixteen pinned skies with their dips
labelled.

### Phase 7.13 — the band gate could not see a checkerboard (2026-08-21)

Eddie, of a rolled sky the bench marked RE-ROLLED: why?

Because the gate thought its typical band was THIRTEEN PIXELS when it
is one. A checkered row carries the base colour in `hex` and its
partner as metadata, so a row-based walk saw nine consecutive
checkered rows as a single thirteen-pixel slab — and rejected the sky
for being coarse BECAUSE it was dithered.

THE BLIND SPOT WAS ALREADY DOCUMENTED, in the ripper, which states in
as many words that a row-based measure "measures vertical structure
exactly and cannot see horizontal structure at all", reports dithered
rows separately so a perfect residual cannot imply a perfect rip, and
refuses to merge a dithered band into a solid one sharing its modal
colour.

Checkerboards were then added to the GENERATOR and this measure was
never revisited. The tool told the truth in one half and not the
other, and the two halves are now keyed the same way.

Measured: that sky's median went 13px -> 5.5px, and the fallback rate
across 500 rolls went 23 -> 9. It also explains something noted at
the time without chasing — FADE and WEAVE fell back more often than
the other budgets, being the two that dither heavily and therefore
the two most often mis-measured.

THE SKY STILL FAILS, MARGINALLY AND HONESTLY: 5.5px against a 5px
budget. Ripped, the references measure a burst median of 1-2px
(America_Stage1B 1, Asia_Stage10 2), so 5 is already generous and
this is a real miss rather than an artefact.

Suite: verify-px-render AF1-AF3. AF2 is the invariant that stops the
two measures drifting apart again — no sky may measure a band far
thicker than its own longest checker run. Mutation-tested: keying the
walk on `hex` alone fails AF1 and AF1a.

## Phase 7.14 — INTO THE GAME (2026-08-21)

It was already wired. main.js has called the same generate() since
Phase 7, so every feature added since — budgets, paths, crossfade,
checkerboards, the rolled floor — has been flowing into races the
whole time. Measured over 200 race seeds: 133 crossfaded, 132
checkered, 78 with pinned paths. Shipping was never about getting
them in; it was about what breaks on arrival.

### 1. THE CHECKERBOARD BLIT — 5648 fillRects a frame

Painted cell by cell, a WEAVE sky measured 5648 fillRect calls per
frame against ~25 for a plain one. 225x, EVERY FRAME, because rows()
caches the SOLVE and the BLIT happens regardless — the same shape as
the Phase 6 crisis where lit() called columnFor() before its own cache
lookup.

Now one fillRect per band, using a 2x2 pattern anchored at the origin:
it repeats every two rows, so a multi-row band comes out offset per
row for free. Measured after: 5648 -> 83, a 68x reduction. Patterns
are built once and kept, keyed by pair and cell size.

A consumer with no pattern support falls back to the honest slow path
rather than painting the band flat, because losing the dither
silently is worse than being slow.

### 2. THE SPEC REGISTRY LEAKED

main.js called define() on every race so it could pass an id, and
nothing ever removed them: 11 specs became 61 over fifty races and
would have kept going for as long as a session lasted. Each entry
holds a node list and a rows() cache line.

A GENERATED SKY IS A VALUE, NOT A NAME. setSky now accepts the spec
itself; a library sky is still chosen by id, because a library sky
genuinely has a name. Fifty races now leave the registry exactly
where they found it.

### Two check faults, both familiar

THE SHIM WOULD HAVE MEASURED THE WRONG PATH. Without createPattern
the renderer falls back to per-pixel rectangles, so a cost check on a
shim lacking it would have counted work the game does not do — the
opposite of what a cost check is for. Patterns are modelled now.

A first attempt went further and made the pattern NAME the two
colours it was built from, by proxying every canvas context. That
broke the terrain and sky checks outright: the proxy swallowed
fillRect on the MAIN canvas as well as the scratch one. Which colours
a dithered band carries is already asserted at the model level, so
the shim only needs to make the fast path reachable.

AND AG1b ASSERTED THE CACHE EXISTED, NOT THAT IT WAS USED. It grepped
for `patCache` being created and written to — both still true when
the LOOKUP was stubbed out, so the mutation survived. It now COUNTS
CONSTRUCTIONS across three frames: 4 on the first, 0 on the next two.
A cache that is never read is not a cache.

Suite: verify-px-render AG1-AG2c. Mutation-tested — stubbing the
cache lookup fails AG1b, and restoring define() fails AG2c.

### STILL OPEN before this is called done

  * A DEVICE CAPTURE. Everything above is headless arithmetic, and
    the standing rule is that device captures are ground truth. A
    checkerboard especially can look right in a proof and shimmer on
    a real screen.
  * THE HOURS AS A SET, in game — a cup walks three in sequence and
    nobody has seen them lit, with terrain, in order.
  * The 90% floor against the parallax land layers, once those exist
    (Eddie: not yet, so not yet a problem).

## Phase 7.15 — AN INTEGER UPSCALE (Eddie's ruling, 2026-08-21)

From a device capture: the checkerboard cells are uneven in width.

They were. A 320-wide buffer on a 1179-wide phone is a scale of
3.684, so every buffer pixel lands on THREE OR FOUR device pixels and
some columns come out wider than others. Nearest-neighbour does not
blur it — it makes some columns fatter. Solid bands hide this
completely; a ONE-PIXEL CHECKERBOARD is the most demanding content the
buffer can hold and put it under a microscope. The terrain
stair-steps in the same capture had it all along.

### The scale is the whole number now; the buffer width follows

  device                    scale   buffer     edge lost
  iPhone 15 Pro portrait     x4     294x639    3px (0.25%)
  iPhone 15 Pro landscape    x8     319x147    4px (0.16%)
  iPad 10.9 landscape        x7     337x234    1px (0.04%)
  Pixel 7 landscape          x8     300x135    0px
  desktop 2560               x8     320x180    0px

Every buffer pixel is now exactly `scale` device pixels wide, on
every device. The alternative — letterboxing a locked 320 — measured
19% OF THE WIDTH LOST on a phone in portrait. This loses at most
scale-1 pixels, centred rather than banded to one side.

### WHAT IT DOES NOT COST, which was Eddie's condition

NO WORLD VIEW. The camera law is `zoom = width / (VIEW_W_M * 100)`,
so the buffer width CANCELS: the metres on screen are fixed at 16.2
and the buffer only decides the resolution they are drawn at.
Verified across four device sizes — 16.0 m before, 16.0 m after.

AND NOT THE SKY. I claimed earlier that "every burstPx and rhythm is
stated in 320-space" and that a variable buffer would break them.
THAT WAS WRONG, and the retraction matters because it nearly ruled
out the right answer: every one of those measurements is VERTICAL, a
count of ROWS, and rows() never receives a width at all. A narrower
buffer does not change a single band.

The dev override (FF.PIXELATE_W) still forces a width with a
fractional scale, because comparing chunk tiers side by side is worth
more than crisp edges while you are doing it.

### THE SUITE KNEW 320 BY HEART, in nine places

The buffer had been 320 on every window since Phase 0, and nine
checks simply knew that: band filters keyed on `q.w === 320`, camera
centres written as `160`, column loops running to 320, a buffer
height derived as `round(320 * 850 / 1512)`. They now ASK — the
renderer publishes `FF._bufferSize()` and the suite reads it after
the first render, since the buffer is lazy.

The last one to fall was `cxq = 160`, which is why every column's
EDGE read as wrong while the fills themselves matched exactly. A
constant that is half of another constant is worth writing as such.

Suite: verify-px-render AH1-AH4, and nine existing checks re-derived.
Mutation-tested — a fixed 320 buffer fails AH1, and a height not
floored to the same scale fails AH1a.

STILL OPEN: a fresh device capture, to confirm the cells now read as
even. Everything above is arithmetic.

## Phase 7.16 — the chroma widened, against Out Run (2026-08-21)

Eddie, from the Out Run title screen: can we roll that blue, and how
do I make it commoner?

Measured off the screenshot it is #4245ef — L 0.511, C 0.246, h 273 —
which is EIGHTY-NINE PERCENT of everything sRGB can show at that
lightness and hue. Only NOON could reach it: MORNING was blocked by
an absolute cap of 0.22, GOLDEN by a hue arc stopping two degrees
short at 275.

### TWO LEVERS, doing different jobs

REACH is the absolute cap. Raised: MORNING 0.22 -> 0.27, GOLDEN 0.24
-> 0.28, NOON 0.28 -> 0.30, DUSK 0.30 -> 0.32, NIGHT 0.17 -> 0.20,
and GOLDEN's hue arc widened to 270-302. The Out Run blue is now
reachable at MORNING, NOON and GOLDEN — deltaE 0.004, 0.001, 0.002 —
and correctly NOT at DUSK or NIGHT, whose LIGHTNESS regions exclude
it. Widening until every hour could make every colour would retire
the hours.

FREQUENCY is the chroma share FLOOR. It sat at 0.42, so half of every
hour's rolls came out below 68% of the gamut, muted by construction.
Raised to 0.56-0.58. Measured:

  before   median share 0.66-0.71   vivid (85%+ of gamut) 16%
  after    median share 0.73-0.79   vivid 27%

The whole distribution moved rather than its tail extending, which is
the difference between "possible" and "the game feels like this".

NOTHING ELSE MOVED: reachability of the reference set holds at 0.104
worst, 491 of 500 still generate, zero nodes over-ask for chroma, and
the worst collision is 24.2% against a 25% ceiling.

This is the second widening and, like the first, it is against a
MEASURED TARGET rather than a preference — reference art sitting
where our ranges did not reach.

### THREE MUTATIONS SURVIVED, all the same fault

AI1 sampled 3000 rolls per hour and asked whether any landed within
deltaE 0.05 of the target. Putting MORNING's cap back to 0.22 leaves
a roll 0.026 SHORT IN CHROMA — inside the tolerance — so the mutation
survived. THIRD TIME this pattern has appeared in this project, and
the fix is the same each time: a sampled check and an ANALYTIC one
fail in different ways, so both are needed. AI1b now asserts the
ranges themselves.

AI2 pooled all five hours, so one hour reverting hid behind four that
had not. Now measured PER HOUR.

And even per-hour it could not catch the floor reverting, because the
OLD floor already produced 22% vivid at MORNING — comfortably above
any bar loose enough not to be flaky. AI2b therefore asserts the
NUMBER, as a BAND with both ends stated: below 0.55 the hour is muted
by construction, above 0.62 every sky shouts and the generator has no
dynamic range. Mutation-tested in both directions.

Suite: verify-px-render AI1-AI3b.

Proof: docs/phase716-chroma.png — 32 rolls after the widening.

## Phase 7.17 — THE FOUR CARDINAL HOURS (Eddie's ruling, 2026-08-21)

MORNING / NOON / GOLDEN / DUSK / NIGHT became
MORNING / NOON / DUSK / MIDNIGHT.

### Why the five were wrong

THE SUN BARELY MOVED. The bearings spanned 236 to 300 — SIXTY-FOUR
DEGREES across an entire day, with overhead at ~270. NIGHT sat at
262, eight degrees from noon, lighting every melon from above.

THE TWO TABLES DISAGREED. By bearing, MORNING (-32) mirrored DUSK
(+32). By sky lightness, MORNING overlapped GOLDEN by 0.91 and DUSK
by 0.17. Two files, opposite opinions about what MORNING is, drifting
unnoticed because nothing related them. When asked which was
morning's twin I answered GOLDEN with DUSK printed at +32 on the next
line of my own output — Eddie caught it.

AND THREE HOURS WERE NEAR-DUPLICATES. MORNING/NOON overlapped 1.00 on
lightness and 1.00 on lift; MORNING/GOLDEN 0.91 and 0.83. Hue was
doing almost all the work, which is exactly why opening the hue arcs
had to wait for this.

GOLDEN was never a time of day — it is a QUALITY of light that
happens twice — and naming it as a slot is what hid the duplication.

### The structure is the point

  MORNING   sun low, one side      overhead - 50   TRANSITION
  NOON      overhead               overhead        EXTREME
  DUSK      sun low, other side    overhead + 50   TRANSITION
  MIDNIGHT  skylight, from above   overhead        EXTREME

Extremes are flat (lift 0.14-0.28 and 0.08-0.20); transitions climb
(0.34-0.52, shared, because they are mirrors). THE LIFT WAS
BACKWARDS BEFORE — noon and morning climbed MORE than golden and dusk
did. You barely see a gradient looking up at midday; a sunset is
enormous contrast top to bottom. That signature survives hue
rotation, which is what makes the queued hue widening possible.

BEARINGS ARE DERIVED FROM ONE ANCHOR and sky.js READS palette.js
rather than keeping a copy. There were also two SUN_OVERHEAD
constants, 268 and 270 — the same fault in miniature.

### TWO CORRECTIONS TO THE LITERAL ASTRONOMY, both caught by checks

MIDNIGHT IS NOT "THE SUN BELOW". At overhead+180 every melon is lit
FROM UNDERNEATH — the fault Eddie caught on device at 5.3. At
midnight there is no sun: the light is moonlight and skylight, both
from above. sunDeg is the direction light ARRIVES from.

THE TRANSITIONS STOP SHORT OF THE HORIZON. At +/-90 the vertical
component is 0.03 — grazing, terminator down the middle, degenerate.
Measured against the real shading law, 72 gives -0.195, 60 gives
-0.332, and 50 is the first to clear the -0.4 the law demands while
staying strongly sidelit (-0.557 horizontal). A LOW sun, not a sun ON
the horizon.

### What the rename exposed

SHIFT WAS IN THE WRONG POOL. It exists to travel SIDEWAYS in hue
while HOLDING chroma. Measured across all four hours: it held 52% at
NOON and 40% at MIDNIGHT, 2% at MORNING and ZERO at DUSK. A family
that fails its own definition four times in five is misfiled. Moved
to the extremes; the hold rate went 20% -> 41%.

AFRICA-PALE IS UNREACHABLE BY HUE (zenith 190, cyan) and is NAMED in
NOT_ROLLABLE beside america-violet rather than absorbed by widening a
bar. asia-lime's 175 is the same story. Every zenith the generator
can roll lies in 235-320 because the arcs were generalised from a
reference set of blue title screens — which is the next job.

It was also RE-FILED BY ITS OWN NUMBERS: zenith L 0.86 with a lift of
0.12 is bright and almost flat, which is NOON now that MORNING means
a low sun. And NOON's lower bound moved 0.50 -> 0.46 because
flat-cobalt, the Out Run title sky, measures 0.47 — a reference
sitting outside its own hour is the fault AA1 exists to catch.

### And what it exposed in the CHECKS

FIVE HARD-CODED THE SIZE OF THE DAY. Four checks said "of 500" (five
hours x 100) and one said `=== 5`, so a PERFECTLY EVEN four-way split
of 750 each failed H7, and 398 of 400 failed U2. A literal that
encodes the size of the thing being measured fails the moment that
thing is changed on purpose. All derived now.

TWO HAD GONE VACUOUS. AI1a tested for 'NIGHT', which no longer
exists, so it passed by asking about nothing — and named DUSK as
excluded when DUSK now reaches the target. K2d3 asserted on a `null`
that means "this hour could not be measured".

AND A BLANKET RENAME IS NOT A REFACTOR. Replacing GOLDEN with DUSK
left DUSK duplicated in five lists, so G7a silently tested three
hours while reporting four.

A CHECK THAT WAS RIGHT WHILE ITS PROBE WAS WRONG: N1 found ONE shadow
column and looked like a rake regression. The law was fine — measured,
morning rakes 1.28x to the right and dusk 1.11x to the left, mirrored,
against noon's 0.03. The probe's caster sat 900 above ground, sized
for a day that never left the zenith, and threw its edge clean off
the sampled span.

Suite: verify-px-render H0-H0e, plus a dozen re-derived. Mutation-tested
— midnight below the horizon fails H0b, transitions at 20 degrees fail
H0a, a backwards lift fails H0d, and sky.js keeping its own bearing
fails H0c.

Proof: docs/phase717-hours.png — one row per hour.

### NEXT, in order (agreed)

  1. OPEN THE HUE ARCS full-circle with a per-hour centre and spread,
     now that the hours are separated on structure rather than hue.
     Targets measured off Super Hang-On: a RED zenith at 33 degrees
     (America 8), gold horizons at 89 and 105, cyan zeniths at 176.
  2. The HORIZON BAND as a proper layer — ground / sea / sea-then-
     ground. It is 34% of every frame and currently a placeholder.
  3. LAYER ARCHITECTURE with z, driving parallax rate AND atmospheric
     haze from one number.
  4. DISTANT HILLS — a 1D heightfield, the first real test of z.
  5. CLOUDS — its own project; none of the sky's vocabulary transfers.

  Also parked: the floor/burst share wants an orientation-aware
  ruling (a burst is 25% of a landscape frame and 6% of a portrait
  one), alongside the camera zoom law.

## Phase 7.18 — THE HUE ARCS OPEN FULL-CIRCLE (2026-08-21)

Eddie: the generator makes almost nothing but blues and purples.

He was right, and measured: every zenith it could roll lay between
235 and 320 degrees — blue through violet to magenta — and over 2000
rolls there were ZERO warm zeniths. Warmth appeared only at the
horizon, 8% of the time, and only when a WARM family happened to wrap
past 360.

THAT WAS SAMPLE BIAS, NOT LAW. The arcs were generalised from a
reference set of blue title screens, and I then defended them with a
physical argument about atmosphere — reasoning backwards from a
conclusion. Eddie's answer stands: this is a game with exaggerated
palettes, and unreal skies are meant to be possible.

Super Hang-On disagreed too. America Stage 8 has a RED zenith at hue
33 fading to gold at 89; Stage G is redder at 28; the ending art runs
lilac 316 to yellow 105; Asia Stage 6 is cyan at 176. FIVE OF SIX sat
outside our arcs — and so did TWO OF OUR OWN reference skies,
asia-lime's zenith at 175 and africa-pale's at 190, which AA1 had
been passing by approaching from somewhere else entirely.

### A centre and a reach, not a window

`h: { c, reach, k }` — hue = c +/- reach * u^k for uniform u. The
whole circle is available at every hour; `k` above 1 keeps most rolls
near the centre while the tail reaches everywhere. What distinguishes
an hour is now which hues are LIKELY, not which exist.

  MORNING   c 350   rose and gold, cooler than sunset
  NOON      c 264   blue
  DUSK      c  28   red and orange (America Stage 8 measures 33)
  MIDNIGHT  c 274   indigo

That only works because Phase 7.17 separated the hours on LIFT and
structure first. Opening the hue before that would have collapsed
morning, noon and golden into one hour with three names.

Measured: warm zeniths 0% -> 33%. All eight eighths of the circle
reached. Generation held at 495 of 500. asia-lime went 0.104 ->
0.055 and africa-pale 0.271 -> 0.046, so AFRICA-PALE CAME OUT OF
NOT_ROLLABLE — an exception that was honest to name is better still
to remove, and the list shrinking is the evidence the widening did
what it claimed.

### A FAMILY THAT SAYS IT LOSES CHROMA MUST LOSE IT IN THE COLOUR

`mC` is a share of the ACHIEVABLE MAXIMUM, and that maximum varies
enormously with hue — about 0.108 at a cyan, 0.139 a few degrees
away. While every zenith was blue this never mattered. With the
circle open the two ends can sit in very differently sized gamuts,
and a WASH declaring mC 0.30-0.60 handed back a horizon MORE
saturated than its zenith. U5a caught it at +0.0006.

The horizon chroma is now clamped in ABSOLUTE terms as well as
fractional: 0 of 375 washes gain chroma, worst change -0.033.

### AND A CHECK THAT COULD NOT SEE THE POINT OF THE CHANGE

Centring NOON on RED instead of blue SURVIVED the first version of
this section. Everything asserted was about REACH — warm zeniths
happen, the circle is covered, the references are reachable — and all
of that stays true when an hour is pointed at the wrong colour. The
hours being CHARACTERISED was the entire justification for opening
the arcs, and nothing measured it.

AJ2 now measures the circular mean of 600 rolls per hour against the
centre that hour declares. It also catches the clustering being
removed, which would make every hour uniform and identical.

Suite: verify-px-render AJ1-AJ4. Mutation-tested — a narrowed reach
fails AA1/AI1, an un-clamped wash fails U5a/AJ4, a mis-centred hour
fails AJ2a, uniform hue fails AJ2, and a sunrise warmer than sunset
fails AJ2b.

Proof: docs/phase718-hue.png — SKYBOX ONLY (Eddie: proof sheets
should not include the floor), one row per hour.
