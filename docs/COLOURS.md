# COLOURS — the census (2026-08-26ah)

One question this document exists to answer in one lookup: **does a
canonical X exist, and who owns it?** (Written after the canonical
white was asserted absent while sitting in shading.js.)

## PIGMENTS (shading.js — the one table)

| Name  | Value     | Ruled       | Notes |
|-------|-----------|-------------|-------|
| WHITE | `#f6f6f6` | 2026-08-24  | A step under full white (highlight headroom); zero chroma (temperature comes from the LIGHT, never the pigment). Consumers: decal art whites (flags), the cloud lit face, glass light strokes, the renderer stick theme. |
| BLACK | `#000000` | 2026-08-26  | The void. Consumer: the renderer's sky slot. |

Greys were considered and left owned: the renderer's ground/grid
tones are that module's authored world art, not shared pigments.

## Owners (may hold raw literals, each for a stated reason)

- `shading.js` — PIGMENTS and the lighting rig
- `palette.js` — the semantic registry over the rig (never a second system)
- `renderer.js` — world COLORS and grid tables
- `objects.js` — species anchor/flesh bands (authored art)
- `flow.js` — the CSS chrome blob (UI domain, not world pigment)
- `sky.js` — the sky law
- `type.js` — the type/megadrive palette
- `studio.js`, `devtools.js` — dev tools

## The ledger (everything else; counts only shrink — verify-arch A11/A12)

billboards 3 · boards 14 · cloud 1 · debris 4 · editor 9 · emote 2 · flow-lib 1 · ghost 2 · hud-toggles 5 · oklab 2 · ripper 8 · ticker 7
(code-only counts — comments are stripped before the census)

## The trace law (A13)

Outside shading.js nothing may sit NEAR a canonical pigment without
being it. Exact equality is a copy (rewired to references; guarded
fallbacks counted by A14); nearness is an unauthored trace — the
`[246,248,242]` bug class, now convicted at authoring time. Hex form
checks WHITE and BLACK; array form checks WHITE only (a near-black
array law would convict every `[0,0,0]` coordinate).

**Exceptions:** none. The three pre-ruling whites (emote's
green-traced `#f2f4ee`, ghost's `#ffffff`, glass's `[255,255,255]`)
were repinned to the canonical WHITE, ruled 2026-08-27.
