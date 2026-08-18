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
