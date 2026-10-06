// Circle packing along the letter structure, then grow, then merge: lumpy,
// hand-swollen letters. Circles of seeded, varying size are packed along each
// centre line so neighbours just touch; each grows, and the union is rounded
// at the joints (`merge`) so the circles fuse into one shape. All sizes in stems.
import { close, union } from '../geom/clip.js';
import { keepFeatures, withFeatures } from './shape.js';

const circle = (c, r, n = 28) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });

// Walk a polyline, returning the point at arc length `s` (clamped).
function walker(pts, closed) {
  const src = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < src.length; i++) cum.push(cum[i - 1] + Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y));
  const total = cum[cum.length - 1];
  const at = (s) => {
    s = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: src[i - 1].x + (src[i].x - src[i - 1].x) * t, y: src[i - 1].y + (src[i].y - src[i - 1].y) * t };
  };
  return { at, total };
}

export function pack(letters, ctx, {
  size = 0.9, // mean circle radius
  vary = 0.4, // 0..1 spread of radii around the mean
  overlap = 0.15, // how much neighbours overlap when packed (0 = just touching)
  grow = 1.15, // radius multiplier after packing
  merge = 0.5, // rounding where circles meet
  keep = 0.25, // inner line width (see keepFeatures)
} = {}) {
  const stem = ctx.stem;
  return letters.map((letter) => {
    const lines = letter.structure;
    if (!lines?.length) return letter; // needs structure: centre lines to pack along
    const discs = [];
    for (const st of lines) {
      const { at, total } = walker(st.points, st.closed);
      const radius = () => size * stem * (letter.growth ?? 1) * (1 + ctx.rng.range(-vary, vary));
      let r = radius();
      let s = st.closed ? 0 : Math.min(total / 2, r * 0.4);
      const end = st.closed ? total - r : total - Math.min(total / 2, r * 0.4);
      discs.push({ c: at(s), r });
      while (s < end) {
        const next = radius();
        s += (r + next) * (1 - overlap) * 0.5;
        r = next;
        discs.push({ c: at(Math.min(s, end)), r });
      }
    }
    const shape = union(discs.map((d) => circle(d.c, d.r * grow)));
    const merged = merge ? close(shape, merge * stem, 'round') : shape;
    return withFeatures(letter, keepFeatures(letter.shape, merged, ctx, size * grow, keep, letter));
  });
}
