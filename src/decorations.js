// Per-letter decorations. Each returns { add?, cut?, extra? }:
// `add` is unioned into the letter, `cut` subtracted from it, `extra` drawn as its own shape.
// Sizes are in stems.
import { bbox, difference, normalize, union } from './geom/clip.js';
import { vertexNormals } from './geom/path.js';

const ANGLES = { right: 0, 'down-right': 45, down: 90, 'down-left': 135, left: 180, 'up-left': 225, up: 270, 'up-right': 315 };

const rotate = (pts, origin, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => ({ x: origin.x + x * c - y * s, y: origin.y + x * s + y * c }));
};

// The outline point that sticks out furthest in a direction, with its outward normal.
function terminal(shape, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const d = { x: Math.cos(a), y: Math.sin(a) };
  let best = null;
  for (const ring of shape) {
    const normals = vertexNormals(ring);
    ring.forEach((p, i) => {
      const score = p.x * d.x + p.y * d.y;
      if (!best || score > best.score) best = { score, point: p, normal: normals[i] };
    });
  }
  // Blend the local normal with the requested direction so arrows read clearly.
  const nx = best.normal.x + d.x, ny = best.normal.y + d.y;
  const len = Math.hypot(nx, ny) || 1;
  return { point: best.point, angle: Math.atan2(ny / len, nx / len) };
}

const directionAngle = (rng, direction) => {
  if (typeof direction === 'number') return direction;
  if (direction && ANGLES[direction] != null) return ANGLES[direction];
  return rng.pick(Object.values(ANGLES));
};

// Points on the outer outline facing outward, picked at random.
function outlinePoints(shape, rng, count) {
  const ring = shape.reduce((a, b) => (b.length > a.length ? b : a), shape[0]);
  const normals = vertexNormals(ring);
  return Array.from({ length: count }, () => {
    const i = Math.floor(rng() * ring.length);
    return { point: ring[i], angle: Math.atan2(normals[i].y, normals[i].x) };
  });
}

export const decorations = {
  arrow(letter, ctx, { direction, length = 1.4, width = 0.45, head = 1.3 } = {}) {
    const s = ctx.stem;
    const { point, angle } = terminal(letter.shape, directionAngle(ctx.rng, direction));
    const L = length * s, w = (width * s) / 2, h = (head * s) / 2, hl = head * s * 0.8;
    const arrow = rotate([
      [-s * 0.6, -w], [L, -w], [L, -h], [L + hl, 0], [L, h], [L, w], [-s * 0.6, w],
    ], point, angle);
    return { add: [arrow] };
  },

  spike(letter, ctx, { count = 2, length = 1, width = 0.6, tilt = 30 } = {}) {
    const s = ctx.stem;
    const spikes = outlinePoints(letter.shape, ctx.rng, count).map(({ point, angle }) => {
      const a = angle + (ctx.rng.range(-tilt, tilt) * Math.PI) / 180;
      return rotate([[-s * 0.3, -(width * s) / 2], [length * s, 0], [-s * 0.3, (width * s) / 2]], point, a);
    });
    return { add: spikes };
  },

  ball(letter, ctx, { direction, radius = 0.55 } = {}) {
    const r = radius * ctx.stem;
    const { point, angle } = terminal(letter.shape, directionAngle(ctx.rng, direction));
    const c = { x: point.x + Math.cos(angle) * r * 0.5, y: point.y + Math.sin(angle) * r * 0.5 };
    const circle = Array.from({ length: 32 }, (_, i) => {
      const t = (i / 32) * Math.PI * 2;
      return { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r };
    });
    return { add: [circle] };
  },

  // A wedge sliced into the letter from its outline.
  cut(letter, ctx, { count = 1, depth = 0.9, width = 0.25 } = {}) {
    const s = ctx.stem;
    const cuts = outlinePoints(letter.shape, ctx.rng, count).map(({ point, angle }) =>
      rotate([[s * 0.2, -(width * s) / 2], [-depth * s, 0], [s * 0.2, (width * s) / 2]], point,
        angle + ctx.rng.range(-0.4, 0.4)));
    return { cut: cuts };
  },

  // Four-point star floating near a top corner.
  sparkle(letter, ctx, { size = 0.9, distance = 0.6 } = {}) {
    const b = bbox(letter.shape);
    const r = size * ctx.stem;
    const side = ctx.rng.sign();
    const c = { x: b.cx + side * (b.width / 2 + distance * ctx.stem * 0.5), y: b.minY - distance * ctx.stem };
    const star = [];
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.18 : r;
      star.push({ x: c.x + Math.cos(t) * rr, y: c.y + Math.sin(t) * rr });
    }
    return { extra: [star] };
  },
};

export function registerDecoration(name, fn) {
  decorations[name] = fn;
}

/**
 * specs: [{ type: 'arrow', chance: .5, letters?: [0], ...opts }]
 * `letters` may also be 'first' | 'last'.
 */
export function runDecorations(letters, specs = [], ctx) {
  const out = letters.map((l) => ({ ...l, extras: [...(l.extras ?? [])] }));
  specs.forEach((raw, i) => {
    const spec = typeof raw === 'string' ? { type: raw } : raw;
    const { type, chance = 1, letters: which, ...opts } = spec;
    const fn = typeof type === 'function' ? type : decorations[type];
    if (!fn) throw new Error(`bouffont: unknown decoration "${type}"`);
    const rng = ctx.rng.fork(`decoration:${i}:${typeof type === 'string' ? type : 'fn'}`);
    const last = out.length - 1;
    const wanted = which === 'first' ? [0] : which === 'last' ? [last] : which;
    const word = bbox(out.flatMap((l) => l.shape));
    out.forEach((letter, k) => {
      const hit = wanted ? wanted.includes(k) : rng.chance(chance);
      if (!hit || !letter.shape.length) return;
      const res = fn(letter, { ...ctx, rng: rng.fork(k), word, letters: out }, opts);
      let shape = letter.shape;
      if (res.add) shape = union(shape, normalize(res.add));
      if (res.cut) shape = difference(shape, normalize(res.cut));
      letter.shape = shape;
      if (res.extra) letter.extras.push(normalize(res.extra));
    });
  });
  return out;
}
