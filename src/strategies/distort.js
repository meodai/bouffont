// Strategies that move points: hand-made wobble, stretched terminals, bouncing letters.
import { bbox, mapPoints, normalize } from '../geom/clip.js';
import { perimeter, resample, vertexNormals } from '../geom/path.js';

// Seamless periodic noise along a ring: sum of sines with integer frequencies.
function ringNoise(rng, length, wavelength, octaves = 3) {
  const base = Math.max(1, Math.round(length / wavelength));
  const waves = Array.from({ length: octaves }, (_, o) => ({
    k: base * 2 ** o,
    phase: rng() * Math.PI * 2,
    amp: 1 / 2 ** o,
  }));
  const norm = waves.reduce((s, w) => s + w.amp, 0);
  return (t) => waves.reduce((s, w) => s + w.amp * Math.sin(w.k * t * Math.PI * 2 + w.phase), 0) / norm;
}

export function wobble(letters, ctx, { amount = 0.12, wavelength = 2.5 } = {}) {
  return letters.map((letter) => {
    const rings = letter.shape.map((ring) => {
      const pts = resample(ring, ctx.stem / 4);
      const noise = ringNoise(ctx.rng, perimeter(pts), wavelength * ctx.stem);
      const normals = vertexNormals(pts);
      return pts.map((p, i) => {
        const d = noise(i / pts.length) * amount * ctx.stem;
        return { x: p.x + normals[i].x * d, y: p.y + normals[i].y * d };
      });
    });
    return { ...letter, shape: normalize(rings) };
  });
}

const DIRECTIONS = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  'up-left': [-1, -1], 'up-right': [1, -1], 'down-left': [-1, 1], 'down-right': [1, 1],
};

const smoothstep = (t) => t * t * (3 - 2 * t);

// Pull the part of a letter beyond `threshold` (0–1 along the direction) outward.
export function stretch(letters, ctx, { amount = 1, threshold = 0.65, directions = Object.keys(DIRECTIONS) } = {}) {
  return letters.map((letter) => {
    const name = Array.isArray(directions) ? ctx.rng.pick(directions) : directions;
    const [dx, dy] = DIRECTIONS[name];
    const len = Math.hypot(dx, dy);
    const d = { x: dx / len, y: dy / len };
    const pts = letter.shape.map((ring) => resample(ring, ctx.stem / 4));
    const proj = pts.flat().map((p) => p.x * d.x + p.y * d.y);
    const min = Math.min(...proj), max = Math.max(...proj);
    const cut = min + threshold * (max - min);
    const shift = amount * ctx.stem;
    const shape = mapPoints(pts, (p) => {
      const t = (p.x * d.x + p.y * d.y - cut) / (max - cut || 1);
      if (t <= 0) return p;
      const k = smoothstep(Math.min(1, t)) * shift;
      return { x: p.x + d.x * k, y: p.y + d.y * k };
    });
    return { ...letter, shape: normalize(shape), stretched: name };
  });
}

// Per-letter jitter in position, rotation (degrees) and scale.
export function bounce(letters, ctx, { y = 0.6, x = 0, rotate = 6, scale = 0.08 } = {}) {
  return letters.map((letter) => {
    const b = bbox(letter.shape);
    const ty = ctx.rng.range(-y, y) * ctx.stem;
    const tx = ctx.rng.range(-x, x) * ctx.stem;
    const a = (ctx.rng.range(-rotate, rotate) * Math.PI) / 180;
    const s = 1 + ctx.rng.range(-scale, scale);
    const cos = Math.cos(a) * s, sin = Math.sin(a) * s;
    const move = (p) => {
      const px = p.x - b.cx, py = p.y - b.cy;
      return { x: b.cx + px * cos - py * sin + tx, y: b.cy + px * sin + py * cos + ty };
    };
    const core = letter.core && mapPoints(letter.core, move);
    const structure = letter.structure?.map((st) => ({ ...st, points: st.points.map((p) => ({ ...move(p), r: p.r })) }));
    return { ...letter, shape: mapPoints(letter.shape, move), core, structure };
  });
}
