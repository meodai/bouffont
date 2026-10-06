# bouffont

Generative puffy lettering as SVG. Pick a font, write some text, and let growth
strategies swell, block, snap and stretch each letter until the letters meet each
other and an outer shape. Black & white, seeded, runs in the browser and Node.

```js
import { graffiti, loadFont } from 'bouffont';

const font = await loadFont('/fonts/inter.woff'); // URL, ArrayBuffer or opentype.js Font
const piece = graffiti({ text: 'bouffont', font, seed: 7, preset: 'throwup' });

document.body.innerHTML = piece.svg;
piece.letters; // the geometry: [{ char, shape: [[{x, y}, …], …] }, …]
```

Any font opentype.js can read works (TTF, OTF, WOFF). The idea is that the
algorithm carries the style, not the font, so start from plain serif and sans
fonts. The playground lists every `@fontsource/*` package installed as a dev
dependency.

```sh
npm run dev       # playground (demo/)
npm run gallery   # contact sheet of presets → gallery/sheet.png
npm test
```

## How it works

```
text + font → layout → structure → envelope → strategies → decorations → svg
```

**Structure** is what makes a style: the font only contributes where each letter's
strokes go. Every glyph is thinned to its centre lines (serifs, stroke contrast and
terminal shapes are dropped; crossbars and arms are kept) and redrawn with one pen,
the same width, ends and joints for every letter, whatever the font. The letters
are then re-spaced by their new shapes. All presets do this, so Inter, Playfair and
Bricolage come out in the same hand. Regular weights skeletonise best; very heavy
or high-contrast cuts can break.

```js
structure: { pen: 0.15, spacing: 0.3, cap: 'round', join: 'round' } // pen: × cap height
structure: false // grow the font outline itself instead
```

Every length option is in **stems**: the pen width when `structure` is on,
otherwise the font's own stroke thickness, measured from its "O" (the idea comes
from Florian Schulz's *The Anatomy of a Thousand Typefaces*).

On structured letters, inner lines follow **one rule**: a line is drawn where the
swell coming from two parts of a letter's centre lines meets, but only where those
parts face each other across a gap (a notch, the opening of a G), not at plain
corners where strokes join. Lines run through the edge, so openings stay open.
Inner lines don't snap to the `details.angles` palette; that only applies to letters
grown from the font outline (`structure: false`).

### Options

| option        | default | |
|---------------|---------|---|
| `text`        |         | |
| `font`        |         | opentype.js Font, see `loadFont` |
| `seed`        | `1`     | number or string |
| `preset`      |         | `throwup`, `bubbles`, `bubble`, `block`, `simple`, and the slower simulations `coral`, `frost`; other options merge over it |
| `size`        | `200`   | px |
| `lineHeight`  | `1`     | text may contain newlines; lines are centred, baselines this × `size` apart |
| `structure`   | on in presets | redraw letters from their centre lines with one pen, see above |
| `tracking`    | `0`     | letter spacing in stems, applied before growth; negative pushes letters into each other |
| `envelope`    | none    | outer shape, see below |
| `details`     | see below | which crease lines get painted, at which angles |
| `knit`        | `0`     | closes gaps between letters narrower than 2× this (stems); try `0.25` |
| `align`       | `'middle'` | `'bottom'` / `'top'` / `'both'`: lines growth can't cross |
| `strategies`  | `[]`    | applied in order |
| `overgrow`    | `0`     | keep growing after letters meet. If the preset has `generations`, that many more rounds of its own growth (1 = one full round); otherwise letters swell outward by this many stems, contacts stay |
| `generations` |         | what keep growing means for a preset: `[type, scaled, fixed]` or a list; numbers in `scaled` are the values at `overgrow: 1` and scale with it, e.g. `['dla', { reach: 1.2, particles: 0.8 }]` |
| `repel`       | `false` | letters repel each other's growth: contested areas are split fairly into shared seams, no letter slides under another |
| `smooth`      | `0`     | final smoothing pass, in stems (e.g. `0.4`) or `{ amount, corners }` |
| `decorations` | `[]`    | per letter |
| `render`      |         | `{ mode, order, stroke, outline, invert, background }` |

### Envelopes (outer shape)

`rect`, `triangle`, `triangle-down`, `rhombus`, `circle`, `arch`, `bulge`, `pinch`,
`wave`, `parallelogram`, or a function `(u, opts) => [top, bottom]`.

```js
envelope: { type: 'triangle', minHeight: 0.4, height: 1.25 }
envelope: { type: 'parallelogram', skew: 0.35 }
envelope: { type: 'wave', amplitude: 0.3, frequency: 1.5 }
```

Letters are warped so their height follows the shape. Growth can be kept inside it
with `clip: true`.

### Align

`align: 'bottom'` adds a line along the baseline that growth can't cross, so the
letters stand flat on it. With an envelope, the line follows the envelope's bottom
edge. `'top'` does the same at the cap height (or the envelope's top edge), and
`'both'` does both. `'middle'` (the default) lets letters grow in every direction.

### Details and gaps

Only for letters grown from the font outline (`structure: false`); structured letters
use the inner-line rule above. Growth leaves many possible crease lines; a painter
would only paint some of them. `details` decides which:

```js
details: { keep: 2, min: 0.8, depth: 1.5, spacing: 0.5, angles: 6, angle: 0 } // the default
details: false // keep every crease
```

- Every letter keeps its `keep` most important creases (the deepest notches), the
  ones that make it legible.
- Beyond those, a crease survives if it's at least `min` stems long, or its notch is
  at least `depth` stems deep: short *and* shallow ones are stubs.
- Of two creases closer than `spacing`, only the deeper one is kept.
- `angles` snaps the cuts to a handful of directions: a count (`6` = every 30°,
  rotated by `angle`) or a list of degrees; `null` leaves them free. A crease that
  would lose most of itself when straightened (a curve, like a G's opening) keeps
  its curve.

`knit` (off by default; try `0.25` stems) closes slivers and V-notches *between*
letters, the spots where two outlines run into each other. A letter's own crease
slits stay open.

### Strategies (growth)

Strategies can be given as `'inflate'`, `['inflate', { amount: 0.5 }]` or
`{ type: 'inflate', amount: 0.5 }`.

| strategy  | options | |
|-----------|---------|---|
| `inflate` | `amount`, `smooth`, `keep`, `follow` | round swell: bubbles. `follow` makes the swell follow the font's own stroke thickness at each point: growth = amount × (thickness / stem)^follow. `1` keeps the font's contrast (thick swells more), `-1` evens it out, `0` (default) is even |
| `block`   | `amount`, `miterLimit`, `keep` | sharp swell |
| `grow`    | `amount`, `steps`, `join`, `gap`, `neighbors`, `clip`, `keep` | step-wise growth into free space, until letters meet |
| `angular` | `detail`, `angles`, `bulge: 'out' \| 'in' \| 'random'` | rebuilds edges at 0/45/90° |
| `chamfer` | `size`, `inner` | cuts corners |
| `soften`  | `radius`, `inner`, `outer` | rounds corners |
| `smooth`  | `amount`, `corners` | irons out wiggles smaller than `amount`; corners sharper than `corners`° stay sharp |
| `wobble`  | `amount`, `wavelength` | hand-made line |
| `stretch` | `amount`, `threshold`, `directions` | pulls one side out: extended ends |
| `bounce`  | `x`, `y`, `rotate`, `scale` | letters dance |
| `pack`    | `size`, `vary`, `overlap`, `grow`, `merge`, `keep` | needs `structure`: packs circles of seeded, varying size (radius `size` stems ± `vary`) along each centre line, grows them by `grow`, and rounds the joints by `merge` so they fuse into one lumpy shape |
| `coral`   | `steps`, `spacing`, `repel`, `attract`, `push`, `reach` | differential line growth: the outer outline is a chain of nodes that pull together, push apart and creep outward, so it wrinkles; never further than `reach` from the pen drawing |
| `dla`     | `reach`, `cell`, `particles`, `stick`, `crystal`, `arms`, `walk` | diffusion-limited aggregation: random walkers freeze onto the letter. `crystal` (0–1) only lets them stick along `arms` directions |
| `overgrow` | `amount`, `seam`, `keep` | every letter swells by `amount`; space two letters both reach is split fairly with smooth seams, so contacts stay single lines and the outside keeps swelling. Counters stay open (also the top-level `overgrow` option) |
| `repel`   | `step`, `seam` | splits every area two letters both cover between them, as if both grew into it at the same speed. Letters don't move. `seam` (stems) smooths the seams; `0` leaves them stepped |

Options every strategy accepts:

- `neighbors: 'ignore' | 'avoid'`: with `avoid`, a letter can only grow into space no
  other letter takes. `gap` sets the spacing in stems; a negative gap allows that much
  overlap.
- `clip: true`: stay inside the envelope.
- `letters: [0, 2]` or `chance: 0.5`: affect only some letters.

**Legibility:** `inflate`, `block` and `grow` keep counters open and carve **creases**
where the growth from two parts of a letter meets, like the inner lines of swollen letters.
A crease that starts in a notch (the gaps in E or X) runs out through the edge, so the
two parts of the letter don't join back together.
`keep` sets their width in stems; `keep: false` turns this off.

Custom strategies have the form `(letters, ctx, opts) => letters`. Pass a function
directly, or use `registerStrategy(name, fn)`. `ctx` has `stem`, `rng` (seeded, with
`range`, `pick`, `chance`) and `envelope`. Polygon tools are exported as `geom`.

### Decorations

```js
decorations: [
  { type: 'arrow', letters: 'last', direction: 'right' },
  { type: 'spike', chance: 0.5, count: 2 },
  { type: 'cut', chance: 0.6 },
  { type: 'ball', chance: 0.3 },
  { type: 'sparkle', letters: [0] },
]
```


### Render

- `mode: 'stack'` (default) draws every letter outlined and stacked by `order`:
  `ltr` (each letter over the previous one), `rtl` (reverse), `center` (the middle
  letter on top, then descending outward), `edges` (the outer letters on top) or `random`. `mode: 'merge'` draws one outline
  around everything.
- `stroke` is the line thickness in stems.
- `outline` adds a band around the whole piece.
- `invert` draws a white line on black.
- `curves` (default `0`, off) draws outlines as smooth curves through few points
  instead of polygons, e.g. `0.08` stems. `fair` (default `0`, off) irons out lumps up
  to that size first, e.g. `0.35`. `corners` (default `56`°) keeps sharper turns crisp. Set
  `curves: 0` for raw polygons; the `simple` preset does this.
- `ink` (default `0.3` stems) and `gaps`: inside a letter, a gap narrower than 2× `ink`
  is two outlines running side by side. With `gaps: 'line'` (default) it is closed and
  drawn as one line along its middle, with the outline pen; `gaps: 'ink'` fills it
  solid; `ink: 0` leaves it alone.
- `lines` (default `{ angles: null, cap: 'round' }`): how inner and gap lines are
  drawn, so they follow the style: smooth curves by default; with `angles: 8` every
  segment snaps to 0/45/90° (the `simple` and `block` presets, with `cap: 'square'`).
- `inner` (default `0.5` stems, minimum length; `0` = off): inner lines of structured
  letters, computed from the final shape and drawn with the outline pen. Lines that
  would double an existing line are dropped.

## DOM references

`piece.svg` is a string. `piece.dom()` builds the SVG element and hands back
references to its parts, so fills and strokes can be styled or animated on their own,
for the whole piece or per letter:

```js
const { svg, letters, fills, outlines, lines, strokes } = piece.dom();
document.body.append(svg);

fills.forEach((f) => f.setAttribute('fill', 'gold'));      // every fill
letters[0].outline.style.strokeWidth = '6px';               // one letter's outline
letters.forEach(({ group }, i) => (group.style.animationDelay = `${i * 80}ms`));
```

- `letters[i]`: `{ char, index, group, fill, outline, lines, ink }` in text order (the
  drawing order follows `render.order`). In `mode: 'merge'` there is one entry, index `'all'`.
- `fills`, `outlines`, `lines`: all of them; `strokes` = outlines + lines (everything
  drawn with the pen). `outlines` starts with `band`, the outer outline around the
  whole piece (`render.outline`), a stroked and filled silhouette; `extras` holds decorations.
- Each call builds new elements. In Node, pass a document: `piece.dom(window.document)`
  from jsdom or happy-dom.

The same parts are marked in the string, so CSS can target them too:
`[data-part="letter"]`, `[data-part="fill"]`, `[data-part="outline"]`,
`[data-part="lines"]`, `[data-part="ink"]`, `[data-part="band"]`, with `data-index`
and `data-char` on each letter group.

## Not yet

Colour, fills, backgrounds, 3D, splitting, and letters built from a centre line
(tags and simples drawn as strokes). The pipeline works on plain polygons, so a
centre-line layout can feed in later.

## License

MIT © David Aerne
