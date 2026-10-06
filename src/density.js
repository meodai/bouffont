// Even typographic colour: letters carry different amounts of ink (an i has far less
// than an m), so the same swell leaves some thin and others blobby. Each letter gets a
// growth factor from its ink, measured on the pen drawing: less ink, more growth.
// strength 0 = even growth, 1 = full balancing. Factors are clamped to [0.5, 2].
import { area } from './geom/clip.js';

export function balanceDensity(letters, strength, ctx) {
  if (!strength) return letters;
  const unit = ctx.metrics.capHeight ** 2;
  const mass = letters.map((l) => Math.max(1e-6, area(l.shape) / unit));
  const inked = mass.filter((m) => m > 1e-6);
  if (!inked.length) return letters;
  // Geometric mean: the typical letter keeps its growth.
  const mean = Math.exp(inked.reduce((s, m) => s + Math.log(m), 0) / inked.length);
  return letters.map((l, i) => ({
    ...l,
    growth: Math.min(2, Math.max(0.5, (mean / mass[i]) ** (0.6 * strength))),
  }));
}
