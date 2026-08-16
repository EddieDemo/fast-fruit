# Decal drop — what to add to the project

**Decals are now WIRED IN and visible in the game** (build 2026-08-14q).

```
js/decals.js       NEW      the module
renderer.js        CHANGED  decal raster + draws it inside the body clip
flow.js            CHANGED  portrait wears them; FF._dress() dev hook
main.js            CHANGED  race body dressed from the melon spec
state.js           CHANGED  body carries `decals`
config.js          CHANGED  build stamp
index.html         CHANGED  loads decals.js (and roster.js — see below)

tools/verify-decals.js   dev only, worth keeping: the geometry suite
tools/march.js           dev only, recession measurement
tools/dressed.js         dev only, contact sheets
```

## Seeing it

There is no customise screen yet, so dress a melon from the console:

```js
FF._dress('eye-googly', 'flag-fr', 'mark-heart', 'num-varsity-2')
FF._dress()      // strip it back to bare
```

The start-screen portrait repaints immediately; race bodies pick it up
on the next race build.

## index.html — CHECK THIS, it is not about decals

`index.html` is included in this drop, but **not because of decals**.
Decals are deliberately not loaded (see below).

It is here because of the ROSTER work earlier in the session: the file
needs

```html
<script src="js/roster.js"></script>
```

right after `names.js`. Without it `FF.roster` is undefined, `main.js`
silently falls back to the old seeded name deal, and you get random
rivals instead of the permanent twelve. No error, no crash — the
feature just quietly is not there.

Open your `index.html` and search for `roster.js`. If it is missing, use
the copy in this drop.

## Deliberately NOT loaded

| Module | Why not yet |
|---|---|
| `decals.js` | waiting on renderer integration |
| `tuning.js` | waiting on the audio voice port |
| `fm.js` | waiting on the audio voice port |

All three are inert: they define their namespace and nothing calls them.
Adding script tags now is harmless but pointless; the tags land when the
modules are actually wired.

## Nothing else changed

No existing game file was modified by the decal work.

## What `decals.js` contains

- the design laws, as comments (presentation only, decals rotate with
  the body, they live on the melon, bots wear at most one, rarity is
  arithmetic, eyes granted singly)
- the placement model: `spec.decals = [{ id, u, v, rot, s }]`
- the surface maths: `sampleAt()` returns pixels of arc along the
  surface (Riemannian normal coordinates), verified against the exact
  exponential map to 0.12px
- 16 procedural art routines + 5x7 glyph bitmaps
- a 25-item catalogue in 4 sets — a placeholder for the SHAPE, not a
  considered content list
- `signature()` for the raster cache key

## The dev tools

They expect to sit in `tools/` with the game modules one level up
(`../decals.js`, `../melon.js`, and so on). Adjust the `L()` path in
each if your layout differs.

```
node tools/verify-decals.js    # the geometry suite — run after ANY edit
node tools/march.js            # recession measurement + /tmp/march-data.json
node tools/dressed.js          # dressed-melon tiles + /tmp/dressed.json
```

`verify-decals.js` is the important one. Seven sections, each naming the
bug it guards against — six bugs were found during this work, and two of
them shipped once while looking like they worked. Run it after any
change to the geometry or the art.

`march.js` and `dressed.js` write JSON buffers; the PNGs were composed
from those with small PIL scripts. The measurement output on stdout is
useful on its own.

## Not started

Renderer integration, ownership and awards, the customise screen,
drag-to-place, and a properly authored catalogue (flags, letters and
lipstick are not in yet).

**One constraint to carry into the integration:** `patternRaster`
produces an alpha MASK that is tinted per shading band, so decals cannot
join it — a red heart would come out green. They need their own
full-colour raster, drawn after the bands, clipped to the body, rotated
with it, with band luminance multiplied over.