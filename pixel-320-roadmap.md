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
