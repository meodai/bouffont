// Outer shapes ("envelopes"). Each is a profile over u ∈ [0,1] (left → right) that
// returns the top and bottom edge as v ∈ [0,1] (top → bottom). Letters are warped
// point-by-point so their vertical span fills the profile at their x.
import { bbox, mapPoints, normalize } from './geom/clip.js';
import { resample } from './geom/path.js';

const tent = (u) => Math.abs(2 * u - 1); // 1 at the edges, 0 in the middle

// The cloud's puffs, worked out once per envelope (the profile is asked for every point).
// With a seeded `rng` (as applyEnvelope gives it) they move, lift and widen per seed.
const puffCache = new WeakMap();
function cloudPuffs(opts) {
  if (puffCache.has(opts)) return puffCache.get(opts);
  const { minHeight, bumps: n = 5, overlap = 0.8, vary = 0.6, rng } = opts;
  const r = rng ?? (() => 0.5);
  const jitter = (amount) => (r() * 2 - 1) * amount;
  const peak = 0.4 + jitter(0.25 * vary); // where the tallest puff is
  const puffs = Array.from({ length: n }, (_, i) => {
    const c = (i + 0.5) / n + jitter((0.35 / n) * vary);
    const w = (0.5 / n) * (1 + overlap * 1.5) * (1 + jitter(0.3 * vary));
    const tall = minHeight + (1 - minHeight) * Math.exp(-(((c - peak) / 0.38) ** 2));
    return { c, w, lift: Math.min(1, Math.max(minHeight * 0.7, tall * (1 + jitter(0.25 * vary)))) };
  });
  puffCache.set(opts, puffs);
  return puffs;
}

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
  // A cloud: a straight bottom and a top made of overlapping round puffs (each a dome
  // rising from the bottom), the tallest a little left of the middle, lower towards the
  // ends. `bumps` puffs; `overlap` how much neighbours overlap (more: shallower dips);
  // `minHeight` how high the end puffs reach; `vary` (0–1) how much the seed moves,
  // lifts and widens them (where the peaks and valleys are).
  cloud: (u, opts) => {
    let top = 1;
    for (const { c, w, lift } of cloudPuffs(opts)) {
      const t = (u - c) / w;
      if (Math.abs(t) < 1) top = Math.min(top, 1 - lift * Math.sqrt(1 - t * t));
    }
    // Both ends curve down into the straight bottom (a quarter circle), like the outer
    // puffs of a drawn cloud.
    const d = Math.min(u, 1 - u), e = 0.09;
    if (d < e) top = 1 - (1 - top) * Math.sqrt(Math.max(0, 1 - (1 - d / e) ** 2));
    return [Math.min(top, 0.95), 1];
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
  // Envelopes may vary with the seed (the cloud does): they get their own random stream.
  const opts = { ...DEFAULTS, rng: ctx.rng.fork('envelope'), ...(typeof envelope === 'string' ? { type: envelope } : envelope) };
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
