// Strategies that reshape the outline with offsets.
import { close, normalize, offset, open } from '../geom/clip.js';
import { smoothRing } from '../geom/path.js';
import { variableOffset } from '../geom/thickness.js';
import { carveFeatures } from '../geom/features.js';

const each = (letters, fn) => letters.map((l) => ({ ...l, shape: fn(l.shape, l) }));

// `keep` (stems): counters and notches survive growth as slits at least this wide.
// Set it to false to let them fill in.
// Legibility after growth. Letters grown from the font outline get creases carved
// from their growth fronts (carveFeatures). Structured letters keep their shape: their
// inner lines are found at render time from the final shape (render.js / meetLines),
// so later strategies can't leave them stale.
export function keepFeatures(original, grown, ctx, amount, keep) {
  if (keep === false || keep == null || ctx.structured) return { shape: grown };
  return { shape: carveFeatures(original, grown, { shrink: amount * ctx.stem, keep: keep * ctx.stem, details: ctx.details }) };
}

const withFeatures = (letter, res) => ({ ...letter, shape: res.shape, ...(res.inner ? { inner: res.inner } : {}) });

// Bubble / throw-up swell. `smooth` closes concave corners for rounder blobs.
// `follow` lets the swell follow the font's own stroke thickness at each point:
// 0 = even, 1 = thick parts swell more (keeps/boosts contrast), -1 = thin parts
// swell more (evens contrast out). Growth is amount × (thickness / stem) ^ follow.
export function inflate(letters, ctx, { amount = 0.5, smooth = 0.5, keep = 0.12, follow = 0 } = {}) {
  const stem = ctx.stem;
  // `letter.growth` (see density.js) scales each letter's swell.
  const grow = (shape, a) => {
    if (!follow) return offset(shape, a * stem, { join: 'round' });
    const radius = (t) => Math.min(a * 3, a * (t / stem) ** follow) * stem;
    return variableOffset(shape, radius, { spacing: stem / 5, min: stem * 0.15, max: stem * 2.5 });
  };
  return letters.map((letter) => {
    const a = amount * (letter.growth ?? 1);
    let s = grow(letter.shape, a);
    if (smooth) s = close(s, smooth * stem, 'round');
    return withFeatures(letter, keepFeatures(letter.shape, s, ctx, a + smooth, keep, letter));
  });
}

// Heavy block letters: sharp miter offset.
export function block(letters, ctx, { amount = 0.35, miterLimit = 4, keep = 0.12 } = {}) {
  return letters.map((letter) => {
    const a = amount * (letter.growth ?? 1);
    return withFeatures(letter,
      keepFeatures(letter.shape, offset(letter.shape, a * ctx.stem, { join: 'miter', miterLimit }), ctx, a, keep, letter));
  });
}

// Bevel convex corners (and optionally concave ones with `inner`).
export function chamfer(letters, ctx, { size = 0.35, inner = false } = {}) {
  const r = size * ctx.stem;
  return each(letters, (shape) => {
    let s = offset(offset(shape, -r, { join: 'miter', miterLimit: 10 }), r, { join: 'square' });
    if (inner) s = offset(offset(s, r, { join: 'miter', miterLimit: 10 }), -r, { join: 'square' });
    return s;
  });
}

// Round off corners: closing fills inner corners, opening rounds outer ones.
export function soften(letters, ctx, { radius = 0.3, inner = true, outer = true } = {}) {
  const r = radius * ctx.stem;
  return each(letters, (shape) => {
    let s = shape;
    if (inner) s = close(s, r);
    if (outer) s = open(s, r);
    return s;
  });
}

// Smoothing pass: irons out wiggles (seams, creases, offsets) smaller than `amount`.
// Corners turning more than `corners` degrees stay sharp; `corners: 180` rounds everything.
export function smooth(letters, ctx, { amount = 0.4, corners = 60 } = {}) {
  const radius = amount * ctx.stem;
  if (!radius) return letters;
  const corner = (corners * Math.PI) / 180;
  return each(letters, (shape) => normalize(shape.map((ring) => smoothRing(ring, { radius, corner, coarse: Math.min(radius * 0.6, ctx.stem * 0.15) }))));
}

export { withFeatures };
