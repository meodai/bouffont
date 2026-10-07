# bouffont — letter engine (v0) design

## Intent
A creative-coding JS library (ESM, browser + Node) that turns text + a font into a
bouffont-style piece as SVG. Seeded and deterministic. Black & white only. Focus is the
letters themselves — no backgrounds, fills/gradients, 3D extrusion or splitting.

## Pipeline

```
text + font ─▶ layout ─▶ envelope warp ─▶ strategies (in order) ─▶ decorations ─▶ render SVG
               letters[]   (outer shape)     (growth, neighbour-aware)  (per letter)
```

Every stage passes an array of **letters**: `{ char, index, shape: Polygon[] , ... }`,
where a shape is a list of closed polygons (outer contours + holes, even-odd).
All geometry goes through clipper-lib (integer-scaled), so any stage can offset/union/clip.

### 1. Layout (`font.js`)
opentype.js glyph outlines, kerning on, beziers flattened to polylines.
Options: `size`, `tracking` (negative tracking pushes letters into each other).

### 2. Envelope (`envelope.js`) — the outside shape
`none | rect | triangle | rhombus | circle | arch | parallelogram | wave`.
Each envelope is a top/bottom profile over the piece width. Letters are warped
point-by-point so their vertical span fills the profile at that x (letters lean and
squash with the shape). `minHeight` keeps edge letters from collapsing. The envelope
polygon is also available as a growth limit (`clip: true`).

### 3. Strategies (`strategies/`) — growth
A strategy is `(letters, ctx, opts) => letters` and runs on all letters at once.
Strategies chain in order: `[['inflate', {amount: .1}], ['angular'], …]`.

| name      | effect |
|-----------|--------|
| inflate   | round offset — bubble / throw-up swell |
| block     | miter offset — heavy block letters |
| angular   | simplify + rebuild edges at 0/45/90° — simples, TUSK-like |
| chamfer   | cut convex corners |
| soften    | morphological open/close with round joins |
| wobble    | seeded noise displacement along normals — hand-made line |
| stretch   | pull one side of a letter outward (extended terminals) |
| bounce    | per-letter random offset/rotation/scale |
| grow      | small-step growth until letters meet each other / the envelope |

**Neighbour awareness** is a common option on every strategy:
- `neighbors: 'ignore'` (default) — letters may overlap freely.
- `neighbors: 'avoid'` — a letter can only grow into space not taken by others
  (with `gap`); used step-wise by `grow` this makes letters meet and lock together.
- `clip: true` — growth is limited to the envelope.

### 4. Decorations (`decorations/`) — per letter
`{ type, chance, letters?, ...opts }`, chosen by seeded rng.
`arrow` (arrowhead on an outward terminal), `spike` (thorns), `ball` (round nub),
`cut` (sliver removed from the fill), `sparkle` (4-point star near the letter).

### 5. Render (`render.js`)
- `mode: 'stack'` — each letter filled + stroked, painted in `order`
  (`ltr | rtl | random`): throw-up overlaps.
- `mode: 'merge'` — union of all letters, one outline (`seams` optional).
- `stroke` width, optional `outline` (second, outer outline band around the whole piece),
  `invert` (black fill / white line).

## API
```js
import { bouffont, loadFont, presets } from 'bouffont';
const font = await loadFont(url | ArrayBuffer);
const piece = bouffont({ text: 'SANE', font, seed: 42, ...presets.throwup });
piece.svg      // string
piece.letters  // geometry, for further creative coding
```

## Out of scope (v0)
Colour, fills/gradients, backgrounds, 3D/shadow extrusion, splitting (IMG_4389),
centerline/skeleton fonts (later: a second layout source feeding the same pipeline).

## Testing
vitest for geometry invariants (deterministic output per seed, avoid-mode yields no
overlaps, envelope warp stays in bounds). Visual check via a gallery script rendering
presets to PNG, plus a browser playground (`demo/`).
