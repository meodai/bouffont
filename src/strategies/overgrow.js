// Keep growing after meeting the others: every letter swells by `amount` (stems).
// The new space two letters both reach is split fairly between them (as if both grew
// into it at the same speed, see repel) with smoothed seams, so contacts stay single,
// calm lines and the free edges keep swelling outward. Existing shapes are kept.
import { difference, offset } from '../geom/clip.js';
import { counters } from '../geom/features.js';
import { repel } from './repel.js';

export function overgrow(letters, ctx, { amount = 0.5, seam = 0.4, keep = 0.25 } = {}) {
  const d = amount * ctx.stem;
  if (!d) return letters;
  // Each letter's current shape is the seed its share of the new space grows from.
  const swollen = letters.map((l, i) =>
    ctx.targets?.[i] === false || !l.shape.length ? l : { ...l, core: l.shape, shape: offset(l.shape, d, { join: 'round' }) });
  const split = repel(swollen, ctx, { seam });
  return split.map((l, i) => {
    // Counters shrink with the swell but stay open, at least `keep` wide.
    const { cuts } = letters[i].shape.length ? counters(letters[i].shape, d, keep * ctx.stem) : { cuts: [] };
    return { ...l, shape: cuts.length ? difference(l.shape, cuts) : l.shape, core: letters[i].core };
  });
}
overgrow.selfConstrained = true;
