// Effects: drawn on the finished letters without changing their shape. Each effect
// returns shapes per letter, `{ part, shape, kind?, layer? }` (data-part = part):
//   kind  'paper' (default): white with a thin outline · 'ink': solid black ·
//         'line': an outline only
//   layer 'over' (default): between the letter's fill and its outline ·
//         'under': before the letter's fill, inside its group (stacked with it) ·
//         'behind': behind every letter (extrusions)
// Light-based effects take `angle`: where the light comes from, in degrees (225 = top
// left; 0 = right, 90 = down). Sizes in stems.
import { bbox, difference, intersection, offset, open, signedArea, union } from './geom/clip.js';

const lightDir = (angle) => {
  const a = (angle * Math.PI) / 180;
  return { lx: Math.cos(a), ly: Math.sin(a) };
};
const moveShape = (shape, dx, dy) => shape.map((ring) => ring.map((p) => ({ x: p.x + dx, y: p.y + dy })));

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
  const { lx, ly } = lightDir(angle);
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

/**
 * Shade: the shine's opposite, a solid crescent just inside the edges that face away
 * from the light. Counters stay clear.
 */
export function shade(letter, ctx, { angle = 225, inset = 0.16, width = 0.7 } = {}) {
  const stem = ctx.stem;
  if (!letter.shape.length) return [];
  const { lx, ly } = lightDir(angle);
  const inner = offset(outer(letter.shape), -inset * stem);
  if (!inner.length) return [];
  // The inner shape minus itself moved towards the light: the far side's crescent.
  let band = difference(inner, moveShape(inner, lx * width * stem, ly * width * stem));
  band = intersection(open(band, width * stem * 0.2), letter.shape)
    .filter((r) => Math.abs(signedArea(r)) > (width * stem) ** 2 * 0.3);
  if (!band.length) return [];
  return [{ part: 'shade', shape: band, kind: 'ink' }];
}

/**
 * Depth: the letter extruded away from the light, a side behind it (3D block letters).
 * `merge` (default): the sides of all letters as one block behind them all; `false`:
 * each letter's side stacked with that letter. `fill`:
 * 'paper' (white, outlined) or 'ink' (solid; disappears into an outline band).
 */
export function depth(letter, ctx, { angle = 225, length = 0.8, fill = 'paper', merge = true } = {}) {
  const stem = ctx.stem;
  if (!letter.shape.length) return [];
  const { lx, ly } = lightDir(angle);
  // Sweep: copies stepped along the way, close enough to leave no gaps.
  const d = length * stem, steps = Math.max(2, Math.ceil(d / (stem * 0.12)));
  const copies = Array.from({ length: steps }, (_, k) => moveShape(letter.shape, -lx * d * (k + 1) / steps, -ly * d * (k + 1) / steps));
  const side = union(letter.shape, ...copies);
  // merge: one block behind every letter; otherwise each letter's own side, stacked
  // with it (drawn just before its front, over the letter beneath).
  return [{ part: 'depth', shape: side, kind: fill === 'paper' ? 'paper' : 'ink', layer: merge ? 'behind' : 'under' }];
}

/** Inline: a thin line `inset` inside every edge (counters too): the double-line look. */
export function inline(letter, ctx, { inset = 0.3 } = {}) {
  if (!letter.shape.length) return [];
  const ring = offset(letter.shape, -inset * ctx.stem);
  return ring.length ? [{ part: 'inline', shape: ring, kind: 'line' }] : [];
}

export const effects = { shine, shade, depth, inline };

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
