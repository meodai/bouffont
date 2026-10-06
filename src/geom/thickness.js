// Local stroke thickness and thickness-driven (variable) growth.
// Same idea as measuring stroke contrast in "The Anatomy of a Thousand Typefaces",
// but per outline point: how far is it across the stroke to the opposite edge?
import { union } from './clip.js';
import { resample, vertexNormals } from './path.js';

// Distance from p along direction d to the nearest crossing with any ring segment.
function rayDistance(p, d, segments, skip) {
  let best = Infinity;
  for (const [a, b] of segments) {
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den; // along the ray
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den; // along the segment
    if (t > skip && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/**
 * Sample the outline every `spacing` px and measure the stroke thickness at each
 * sample (clamped to [min, max], smoothed along the outline over `window` samples).
 * Returns [{ x, y, nx, ny, t }] per ring.
 */
export function measureThickness(shape, { spacing, min, max, window = 3 }) {
  const segments = shape.flatMap((ring) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]));
  return shape.map((ring) => {
    const pts = resample(ring, spacing);
    const normals = vertexNormals(pts);
    const raw = pts.map((p, i) => {
      const inward = { x: -normals[i].x, y: -normals[i].y };
      const t = rayDistance(p, inward, segments, spacing * 0.01);
      return Math.min(max, Math.max(min, Number.isFinite(t) ? t : max));
    });
    // Smooth in log space so a single thin reading doesn't dominate.
    const n = raw.length;
    const logs = raw.map(Math.log);
    const t = logs.map((_, i) => {
      let s = 0;
      for (let k = -window; k <= window; k++) s += logs[(i + k + n) % n];
      return Math.exp(s / (window * 2 + 1));
    });
    return pts.map((p, i) => ({ x: p.x, y: p.y, nx: normals[i].x, ny: normals[i].y, t: t[i] }));
  });
}

const circle = (c, r, segments) =>
  Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });

/**
 * Grow a shape by a different amount at every outline point: `radius(t)` maps the
 * local thickness to a growth distance. Built as the union of the shape with one
 * circle per sample, which can't self-intersect like moving points would.
 */
export function variableOffset(shape, radius, { spacing, min, max }) {
  const rings = measureThickness(shape, { spacing, min, max });
  const discs = [];
  for (const ring of rings) {
    for (const s of ring) {
      const r = radius(s.t);
      if (r > 0.5) discs.push(circle(s, r, Math.max(12, Math.min(32, Math.round(r / 2)))));
    }
  }
  return union(shape, discs);
}
