// Effects: drawn on the finished letters, inside them, without changing their shape.
// Each effect returns shapes per letter, `{ part, shape }`, that render draws between the
// letter's fill and its outline (data-part = part). Sizes in stems.
import { bbox, difference, intersection, offset, open, signedArea, union } from './geom/clip.js';

const circle = (c, r, n = 24) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });

// The letter without its counters: the highlight follows the outside of the body.
const outer = (shape) => {
  const largest = shape.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const sign = Math.sign(signedArea(largest));
  return union(shape.filter((r) => Math.sign(signedArea(r)) === sign));
};

/**
 * A specular highlight: a crescent just inside the edge that faces the light, rounded
 * into a soft streak, with a small dot beside it.
 *   angle   where the light comes from, degrees (225 = top left; 0 = right, 90 = down)
 *   inset   distance from the edge
 *   width   thickness of the streak
 *   length  how far along the edge it runs, from the spot facing the light
 *   dot     size of the dot (0 = none)
 */
export function shine(letter, ctx, { angle = 225, inset = 0.26, width = 0.4, length = 1.9, dot = 0.2 } = {}) {
  const stem = ctx.stem;
  if (!letter.shape.length) return [];
  const a = (angle * Math.PI) / 180, lx = Math.cos(a), ly = Math.sin(a);
  const inner = offset(outer(letter.shape), -inset * stem);
  if (!inner.length) return [];
  // Crescent: the inner shape minus itself moved away from the light.
  const moved = inner.map((ring) => ring.map((p) => ({ x: p.x - lx * width * stem, y: p.y - ly * width * stem })));
  let band = difference(inner, moved);
  // Keep the part around the spot that faces the light most.
  let best = null, bestRing = null, bestIndex = 0;
  for (const ring of inner) {
    ring.forEach((p, i) => {
      if (!best || p.x * lx + p.y * ly > best.x * lx + best.y * ly) { best = p; bestRing = ring; bestIndex = i; }
    });
  }
  band = intersection(band, [circle(best, length * stem)]);
  // Round it off; drop slivers.
  band = open(band, width * stem * 0.3).filter((r) => Math.abs(signedArea(r)) > (width * stem) ** 2 * 0.5);
  const out = band.length ? [{ part: 'shine', shape: band }] : [];
  if (dot && band.length) {
    // The dot follows the edge: past the end of the streak along the inner outline,
    // nudged inward to sit on the streak's line.
    const n = bestRing.length, gap = length * stem + dot * stem * 2.2;
    const centroid = bbox([bestRing]);
    // Walk both ways along the outline; the end still facing the light more wins.
    const walk = (dir) => {
      let walked = 0, i = bestIndex, p = best;
      for (let k = 0; k < n && walked < gap; k++) {
        const q = bestRing[(i + dir + n) % n];
        walked += Math.hypot(q.x - p.x, q.y - p.y);
        i = (i + dir + n) % n;
        p = q;
      }
      return p;
    };
    const ends = [walk(1), walk(-1)];
    const p = ends.reduce((a, b) => (b.x * lx + b.y * ly > a.x * lx + a.y * ly ? b : a));
    const tx = centroid.cx - p.x, ty = centroid.cy - p.y, tl = Math.hypot(tx, ty) || 1;
    const c = { x: p.x + (tx / tl) * width * stem * 0.5, y: p.y + (ty / tl) * width * stem * 0.5 };
    const d = intersection([circle(c, dot * stem)], inner);
    if (d.length) out.push({ part: 'shine', shape: d });
  }
  return out;
}

export const effects = { shine };

export function registerEffect(name, fn) {
  effects[name] = fn;
}

/** Apply effects to letters: each letter gets `effects: [{ part, shape }]`. */
export function runEffects(letters, specs = [], ctx) {
  if (!specs?.length) return letters;
  const list = specs.map((spec) => {
    if (typeof spec === 'string') return [spec, {}];
    if (Array.isArray(spec)) return [spec[0], spec[1] ?? {}];
    const { type, ...opts } = spec;
    return [type, opts];
  });
  return letters.map((letter) => {
    const shapes = [];
    for (const [type, opts] of list) {
      const fn = typeof type === 'function' ? type : effects[type];
      if (!fn) throw new Error(`bouffont: unknown effect "${type}"`);
      shapes.push(...fn(letter, ctx, opts));
    }
    return shapes.length ? { ...letter, effects: [...(letter.effects ?? []), ...shapes] } : letter;
  });
}
