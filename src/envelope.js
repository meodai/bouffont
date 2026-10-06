// Outer shapes ("envelopes"). Each is a profile over u ∈ [0,1] (left → right) that
// returns the top and bottom edge as v ∈ [0,1] (top → bottom). Letters are warped
// point-by-point so their vertical span fills the profile at their x.
import { bbox, mapPoints, normalize } from './geom/clip.js';
import { resample } from './geom/path.js';

const tent = (u) => Math.abs(2 * u - 1); // 1 at the edges, 0 in the middle

export const envelopes = {
  rect: () => [0, 1],
  triangle: (u, { minHeight }) => [(1 - minHeight) * tent(u), 1],
  'triangle-down': (u, { minHeight }) => [0, 1 - (1 - minHeight) * tent(u)],
  rhombus: (u, { minHeight }) => {
    const k = ((1 - minHeight) / 2) * tent(u);
    return [k, 1 - k];
  },
  circle: (u, { minHeight }) => {
    const half = Math.max(minHeight, Math.sqrt(Math.max(0, 1 - tent(u) ** 2))) / 2;
    return [0.5 - half, 0.5 + half];
  },
  arch: (u, { minHeight }) => [(1 - minHeight) * tent(u) ** 2, 1],
  bulge: (u, { minHeight }) => {
    const k = ((1 - minHeight) / 2) * tent(u) ** 2;
    return [k, 1 - k];
  },
  pinch: (u, { minHeight }) => {
    const k = ((1 - minHeight) / 2) * (1 - tent(u));
    return [k, 1 - k];
  },
  wave: (u, { amplitude = 0.3, frequency = 1, phase = 0 }) => {
    const s = Math.sin((u * frequency + phase) * Math.PI * 2);
    return [(amplitude / 2) * (1 + s), 1 - (amplitude / 2) * (1 - s)];
  },
  // Slanted rect: the profile is flat, the skew happens in `warp`.
  parallelogram: () => [0, 1],
};

const DEFAULTS = { minHeight: 0.4, height: 1.25, skew: 0, samples: 64 };

/**
 * Warp letters into an envelope. Returns the warped letters and the envelope
 * polygon (in output coordinates) for later clipping.
 */
export function applyEnvelope(letters, envelope, ctx) {
  if (!envelope || envelope === 'none' || envelope.type === 'none') return { letters, polygon: null };
  const opts = { ...DEFAULTS, ...(typeof envelope === 'string' ? { type: envelope } : envelope) };
  if (opts.type === 'parallelogram' && !opts.skew) opts.skew = 0.35;
  const profile = typeof opts.type === 'function' ? opts.type : envelopes[opts.type];
  if (!profile) throw new Error(`bouffont: unknown envelope "${opts.type}"`);

  const all = bbox(letters.flatMap((l) => l.shape));
  const h = all.height * opts.height;
  const top = all.cy - h / 2;
  const spacing = ctx.stem / 4;

  const warpPoint = (p) => {
    const u = (p.x - all.minX) / all.width;
    const v = (p.y - all.minY) / all.height;
    const [t, b] = profile(Math.min(1, Math.max(0, u)), opts);
    return { x: p.x + (1 - v) * opts.skew * h, y: top + (t + v * (b - t)) * h };
  };

  // Structured letters: warp the centre lines and redraw them with the same pen, so
  // the stroke weight stays even across the shape.
  const warpLine = (pts, closed) => {
    const dense = [];
    const src = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < src.length - 1; i++) {
      const a = src[i], b = src[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: (a.r ?? 0) + ((b.r ?? 0) - (a.r ?? 0)) * t });
      }
    }
    if (!closed) dense.push(src[src.length - 1]);
    return dense.map((p) => ({ ...warpPoint(p), r: p.r }));
  };
  const warped = letters.map((l) => {
    if (l.structure && ctx.redraw) {
      const structure = l.structure.map((st) => ({ ...st, points: warpLine(st.points, st.closed) }));
      return { ...l, structure, shape: ctx.redraw(structure) ?? l.shape };
    }
    return { ...l, shape: normalize(mapPoints(l.shape.map((poly) => resample(poly, spacing)), warpPoint)) };
  });

  const edge = (y) =>
    Array.from({ length: opts.samples + 1 }, (_, i) => warpPoint({ x: all.minX + (all.width * i) / opts.samples, y }));
  const edges = { top: edge(all.minY), bottom: edge(all.maxY) };
  const polygon = normalize([[...edges.top, ...edges.bottom.slice().reverse()]]);

  return { letters: warped, polygon, edges };
}
