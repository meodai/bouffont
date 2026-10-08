// Obstructions: shapes in the space around the letters that growth can't enter, so the
// letters grow around them (an envelope gives the outer shape; obstructions sit inside).
// They join the alignment barrier that every strategy is constrained by. Sizes in stems.
import { bbox, contains, intersection, offset, strokeLine, union } from './geom/clip.js';

// A blob: a circle whose radius varies smoothly (a few seeded low harmonics), so its
// edge is as soft and uneven as the letters' own, as if it pushed back like one.
function blob(c, r, rng, wobble = 0.15, n = 64) {
  const waves = [2, 3, 4, 5].map((k) => ({ k, phase: rng() * Math.PI * 2, amp: (wobble * r * rng.range(0.5, 1)) / k }));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r + waves.reduce((s, w) => s + w.amp * Math.sin(w.k * a + w.phase), 0);
    return { x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr };
  });
}

/**
 * Dots: `count` blobs of radius `size` (± `vary`), seeded, where the letters grow: their
 * centres within `front` stems of a letter's drawing (on it too, unless `onLetters`
 * is false). Growth gives way around them; a letter's own drawing stays, so a dot on a
 * letter shows its skeleton inside.
 */
function dots(letters, ctx, { count = 6, size = 1.1, vary = 0.3, clear = 0.15, front = 0.85, wobble = 0.15, onLetters = true } = {}) {
  const stem = ctx.stem, rng = ctx.rng;
  const bodies = union(...letters.map((l) => l.core ?? l.shape));
  if (!bodies.length) return [];
  const b = bbox(bodies), zone = offset(bodies, front * stem);
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 150; tries++) {
    const r = size * stem * (1 + rng.range(-vary, vary));
    const c = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
    if (!contains(zone, c)) continue;
    if (!onLetters && contains(offset(bodies, r + clear * stem), c)) continue;
    if (out.some((o) => Math.hypot(o.c.x - c.x, o.c.y - c.y) < o.r + r + clear * stem)) continue;
    out.push({ c, r });
  }
  return out.map(({ c, r }) => blob(c, r, rng, wobble));
}

/**
 * Hole: one big blob the letters grow around, at `x`, `y` (0–1 across the piece) with a
 * radius of `size` × the piece's smaller side. It may sit on the letters: their own
 * drawings stay whole, only the growth gives way.
 */
function hole(letters, ctx, { size = 0.35, x = 0.5, y = 0.5, wobble = 0.15 } = {}) {
  const bodies = union(...letters.map((l) => l.core ?? l.shape));
  if (!bodies.length) return [];
  const b = bbox(bodies);
  const c = { x: b.minX + b.width * x, y: b.minY + b.height * y };
  return [blob(c, size * Math.min(b.width, b.height), ctx.rng, wobble)];
}

/**
 * Holes: `count` big blobs at seeded random spots across the piece, each `size` × the
 * piece's smaller side (± `vary`), not overlapping. Like `hole`, they may sit on the
 * letters: the drawings stay, only the growth gives way.
 */
function holes(letters, ctx, { count = 3, size = 0.25, vary = 0.25, wobble = 0.15 } = {}) {
  const rng = ctx.rng;
  const bodies = union(...letters.map((l) => l.core ?? l.shape));
  if (!bodies.length) return [];
  const b = bbox(bodies), side = Math.min(b.width, b.height);
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 100; tries++) {
    const r = size * side * (1 + rng.range(-vary, vary));
    const c = { x: rng.range(b.minX + r * 0.5, b.maxX - r * 0.5), y: rng.range(b.minY + r * 0.5, b.maxY - r * 0.5) };
    if (out.some((o) => Math.hypot(o.c.x - c.x, o.c.y - c.y) < (o.r + r) * 1.1)) continue;
    out.push({ c, r });
  }
  return out.map(({ c, r }) => blob(c, r, rng, wobble));
}

/**
 * Walls: `count` thin walls across the piece (`angle`: 0 = horizontal, 90 = vertical),
 * evenly spaced, slightly wavy (`wobble`, stems), `width` thick. Growth can't cross them,
 * so the piece is split into rooms, like an envelope with inner walls. They run through
 * the letters: there only the skeleton shows (the drawing stays, the growth gives way).
 */
function walls(letters, ctx, { count = 1, angle = 0, width = 1.4, wobble = 0.15 } = {}) {
  const stem = ctx.stem, rng = ctx.rng;
  const bodies = union(...letters.map((l) => l.core ?? l.shape));
  if (!bodies.length || count < 1) return [];
  const b = bbox(bodies), a = (angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx; // along, across
  // Spread across the piece, measured on the axis across the walls.
  const pad = stem * 1.5, half = Math.hypot(b.width, b.height) / 2 + pad;
  const across = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]].map(([x, y]) => (x - b.cx) * nx + (y - b.cy) * ny);
  const lo = Math.min(...across), hi = Math.max(...across);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const t = lo + ((hi - lo) * i) / (count + 1);
    const phase = rng() * Math.PI * 2, freq = rng.range(1.5, 3);
    const pts = [];
    for (let k = 0; k <= 48; k++) {
      const s = -half + (2 * half * k) / 48;
      const w = wobble * stem * Math.sin((s / half) * Math.PI * freq + phase);
      pts.push({ x: b.cx + dx * s + nx * (t + w), y: b.cy + dy * s + ny * (t + w) });
    }
    out.push(...strokeLine(pts, width * stem, { cap: 'butt' }));
  }
  // Only as far as the letters can grow: the piece plus `pad`, so the drawing keeps its size.
  const room = [[{ x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.maxY + pad }, { x: b.minX - pad, y: b.maxY + pad }]];
  return intersection(union(out), room);
}

export const obstructions = { dots, hole, holes, walls };

/**
 * The obstruction shapes for a piece: a name ('dots'), { type, ...options }, a function
 * (letters, ctx, opts) => polygons, or polygons as they are. Options every type takes:
 * `gap` (stems the growth keeps clear of them) and `show` (false: only the dents).
 */
export function makeObstructions(spec, letters, ctx) {
  if (!spec || spec === 'none' || spec.type === 'none') return [];
  if (Array.isArray(spec)) return spec;
  const { type, ...opts } = typeof spec === 'string' ? { type: spec } : spec;
  const fn = typeof type === 'function' ? type : obstructions[type];
  if (!fn) throw new Error(`bouffont: unknown obstruction "${type}"`);
  return union(fn(letters, { ...ctx, rng: ctx.rng.fork('obstructions') }, opts));
}

/** The space growth stays out of: the obstructions plus a `gap` (stems) around them. */
export const obstructionBarrier = (shapes, spec, ctx) =>
  shapes.length ? offset(shapes, (spec?.gap ?? 0.22) * ctx.stem) : [];
