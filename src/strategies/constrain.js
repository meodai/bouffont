// Shared neighbour/envelope constraint used after every strategy.
import { bbox, difference, intersection, offset, union } from '../geom/clip.js';

/**
 * Limit new shapes so they respect other letters and/or the envelope.
 * - neighbors 'ignore': free overlap
 * - neighbors 'avoid': a letter only gains space no other letter occupies
 *   (`gap` in stems; negative gap allows that much overlap)
 * - clip: keep inside the envelope
 * Alignment lines (ctx.barrier, from `align`) always apply.
 */
export function constrain(next, prev, ctx, { neighbors = 'ignore', gap = 0, clip = false } = {}) {
  let out = next;
  if (neighbors === 'avoid') {
    out = [];
    const pad = Math.abs(gap) * ctx.stem + 1;
    const near = (a, b) => a.minX - pad < b.maxX && b.minX - pad < a.maxX && a.minY - pad < b.maxY && b.minY - pad < a.maxY;
    next.forEach((letter, i) => {
      // Only letters whose boxes come near this one can block it.
      const box = bbox(letter.shape);
      const others = [...out.slice(0, i), ...prev.slice(i + 1)]
        .map((l) => l.shape)
        .filter((sh) => sh.length && near(box, bbox(sh)))
        .flat();
      if (!others.length) { out.push(letter); return; }
      const blocked = gap ? offset(others, gap * ctx.stem) : others;
      const gained = difference(letter.shape, blocked);
      out.push({ ...letter, shape: union(gained, prev[i].shape) });
    });
  }
  if (clip && ctx.envelope) {
    const bounds = offset(ctx.envelope, (clip === true ? 0 : clip) * ctx.stem);
    out = out.map((l) => ({ ...l, shape: intersection(l.shape, bounds) }));
  }
  if (ctx.barrier) {
    out = out.map((l) => ({ ...l, shape: difference(l.shape, ctx.barrier) }));
  }
  return out;
}
