// Grow letters in small steps so they spread into free space and meet each other
// (and the envelope, with `clip`) instead of simply piling on top.
import { offset, open } from '../geom/clip.js';
import { constrain } from './constrain.js';
import { keepFeatures, withFeatures } from './shape.js';

export function grow(letters, ctx, {
  amount = 1, steps = 6, join = 'round', neighbors = 'avoid', gap = 0, clip = false, smooth = 0.3, keep = 0.12,
} = {}) {
  const delta = (amount * ctx.stem) / steps;
  let current = letters;
  for (let i = 0; i < steps; i++) {
    const next = current.map((l, k) =>
      ctx.targets?.[k] === false ? l : { ...l, shape: offset(l.shape, delta * (l.growth ?? 1), { join, miterLimit: 4 }) });
    current = constrain(next, current, ctx, { neighbors, gap, clip });
  }
  if (smooth) {
    // Remove slivers left where growth fronts met.
    current = current.map((l) => ({ ...l, shape: open(l.shape, smooth * ctx.stem, join) }));
  }
  return current.map((l, k) => withFeatures(l, keepFeatures(letters[k].shape, l.shape, ctx, amount + smooth, keep, l)));
}
grow.selfConstrained = true;
