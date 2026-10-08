// Simulation-based growth (after nshelton.github.io/home/growth): differential line
// growth and diffusion-limited aggregation, each run
// per letter and seeded by its current shape. All lengths in stems. Seeded by ctx.rng.
import { difference, normalize, offset, signedArea, union } from '../geom/clip.js';
import { resample, vertexNormals } from '../geom/path.js';
import { blur, contour, makeGrid, rasterize } from '../geom/raster.js';
import { scanFill } from '../geom/grid.js';
import { stepwise } from './steps.js';

function* coralSteps(letters, ctx, {
  steps = 110, spacing = 0.18, repel = 0.6, attract = 0.4, push = 0.035, jitter = 0.02, maxNodes = 1600,
  reach = 1.1, // never further than this from the letter's pen drawing
  from = 'core', // 'shape': measure reach from the current shape (more generations)
} = {}) {
  const stem = ctx.stem;
  const d = spacing * stem, R = repel * stem, R2 = R * R;
  // Every letter grows at the same time (one step each per frame), each from its own
  // random stream, so the letters don't depend on each other or on the stepping.
  const sims = letters.map((letter, k) => {
    if (!letter.shape.length) return null;
    const rng = ctx.rng.fork(`letter:${k}`);
    // Only the outer outline grows; counters stay as they are.
    const largest = letter.shape.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
    const sign = Math.sign(signedArea(largest));
    const holes = letter.shape.filter((r) => Math.sign(signedArea(r)) !== sign);
    const limit = offset(from === 'shape' ? letter.shape : (letter.core ?? letter.shape), reach * stem);
    // The limit as a lookup grid: an O(1) test per node and step.
    const lg = makeGrid(limit, d / 2, d);
    const inLimit = scanFill(limit, lg);
    const insideLimit = (p) => {
      const i = Math.round((p.x - lg.x0) / lg.cell), j = Math.round((p.y - lg.y0) / lg.cell);
      return i >= 0 && j >= 0 && i < lg.cols && j < lg.rows && inLimit[j * lg.cols + i] === 1;
    };
    // The neighbour grid covers the limit (plus a cell of margin).
    const hx0 = lg.x0 - R, hy0 = lg.y0 - R;
    const hcols = Math.ceil((lg.cols * lg.cell) / R) + 3, hrows = Math.ceil((lg.rows * lg.cell) / R) + 3;
    const hx = (p) => Math.min(hcols - 1, Math.max(0, Math.floor((p.x - hx0) / R)));
    const hy = (p) => Math.min(hrows - 1, Math.max(0, Math.floor((p.y - hy0) / R)));
    const hcell = (p) => hy(p) * hcols + hx(p);
    let rings = letter.shape.filter((r) => Math.sign(signedArea(r)) === sign)
      .map((ring) => resample(ring, d).map((p) => ({ x: p.x, y: p.y })));
    const step = () => {
      // All nodes of this letter, bucketed into cells of size R (a counting sort into
      // flat arrays; nodes never leave the limit, so the grid never grows).
      let total = 0;
      for (const ring of rings) total += ring.length;
      const cellOf = new Int32Array(total);
      const start = new Int32Array(hcols * hrows + 1);
      let k = 0;
      for (const ring of rings) for (const p of ring) start[(cellOf[k++] = hcell(p)) + 1]++;
      for (let c = 0; c < hcols * hrows; c++) start[c + 1] += start[c];
      const fillAt = start.slice(0, -1);
      const entries = new Int32Array(total * 2);
      k = 0;
      rings.forEach((ring, ri) => ring.forEach((_, i) => {
        const at = fillAt[cellOf[k++]]++ * 2;
        entries[at] = ri; entries[at + 1] = i;
      }));
      rings = rings.map((ring, ri) => {
        const n = ring.length;
        const normals = vertexNormals(ring);
        const next = ring.map((p, i) => {
          const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
          let fx = ((a.x + b.x) / 2 - p.x) * attract, fy = ((a.y + b.y) / 2 - p.y) * attract;
          const cx = hx(p), cy = hy(p);
          for (let gx = Math.max(0, cx - 1); gx <= Math.min(hcols - 1, cx + 1); gx++) {
            for (let gy = Math.max(0, cy - 1); gy <= Math.min(hrows - 1, cy + 1); gy++) {
              const c = gy * hcols + gx;
              for (let t = start[c] * 2, end = start[c + 1] * 2; t < end; t += 2) {
                const rj = entries[t], j = entries[t + 1];
                if (rj === ri && Math.abs(j - i) <= 1) continue;
                const q = rings[rj][j];
                const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
                if (d2 > 0 && d2 < R2) { // most neighbours are out of reach: skip the root
                  const dist = Math.hypot(dx, dy);
                  const f = ((R - dist) / R) * 0.5;
                  fx += (dx / dist) * f * d; fy += (dy / dist) * f * d;
                }
              }
            }
          }
          fx += normals[i].x * push * stem + rng.range(-jitter, jitter) * stem;
          fy += normals[i].y * push * stem + rng.range(-jitter, jitter) * stem;
          const moved = { x: p.x + fx, y: p.y + fy };
          // Nodes stop at the reach limit instead of being cut off later.
          return insideLimit(moved) ? moved : p;
        });
        const split = [];
        for (let i = 0; i < next.length; i++) {
          const p = next[i], q = next[(i + 1) % next.length];
          split.push(p);
          if (Math.hypot(q.x - p.x, q.y - p.y) > d * 1.6 && split.length < maxNodes) {
            split.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
          }
        }
        return split;
      });
    };
    // A frame: the raw outline as it grows (no clean-up), with the counters.
    const draft = () => ({ ...letter, shape: [...rings, ...holes] });
    const finish = () => {
      // Folds leave little enclosed pockets: fill them, only real counters stay open.
      const n0 = normalize(rings);
      const big = n0.length ? n0.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a)) : null;
      const grown = big ? union(n0.filter((r) => Math.sign(signedArea(r)) === Math.sign(signedArea(big)))) : n0;
      return { ...letter, shape: holes.length ? difference(grown, normalize(holes.map((h) => [...h].reverse()))) : grown };
    };
    return { step, draft, finish };
  });
  for (let it = 0; it < steps; it++) {
    for (const sim of sims) sim?.step();
    yield sims.map((sim, k) => sim?.draft() ?? letters[k]);
  }
  return sims.map((sim, k) => sim?.finish() ?? letters[k]);
}

// ── Differential line growth ─────────────────────────────────────────────────────
// Every outline becomes a chain of nodes: neighbours pull together (smooth), nearby
// nodes push apart (no self-overlap), edges split when long, and every node creeps
// outward. The line has to fold to fit: coral-like, wrinkled letters.
export const coral = stepwise(coralSteps);

function* dlaSteps(letters, ctx, {
  reach = 1.6, cell = 0.18, particles = 1.2, stick = 0.9, crystal = 0, arms = 6, walk = 1500, smooth = 1,
  frames = 40, // live growth: the walkers are released over this many steps
} = {}) {
  const stem = ctx.stem;
  // Every letter grows at the same time, each from its own random stream.
  const sims = letters.map((letter, k) => {
    if (!letter.shape.length) return null;
    const rng = ctx.rng.fork(`letter:${k}`);
    const g = rasterize(makeGrid(letter.shape, cell * stem, reach * stem), letter.shape);
    const { cols, rows, data } = g;
    const filled = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && data[j * cols + i] > 0.5;
    // Particle count: proportional to the letter's outline length.
    let edge = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (filled(i, j) && !filled(i + 1, j)) edge++;
    const total = Math.round(edge * particles * 4);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const armAngle = (Math.PI * 2) / arms;
    const tries = total * 3, perStep = Math.ceil(tries / frames);
    let stuck = 0, n = 0;
    const step = () => {
      for (const until = Math.min(tries, n + perStep); n < until && stuck < total; n++) {
        // Spawn on an empty cell near the cluster.
        let i = rng.int(0, cols - 1), j = rng.int(0, rows - 1);
        if (filled(i, j)) continue;
        for (let s = 0; s < walk; s++) {
          const [di, dj] = N4[Math.floor(rng() * 4)];
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) break;
          if (filled(ni, nj)) {
            let ok = rng() < stick;
            if (ok && crystal) {
              // Direction from the cell it touches: only near one of the arms.
              const a = Math.atan2(j - nj, i - ni);
              const off = Math.abs(((a % armAngle) + armAngle) % armAngle - armAngle / 2);
              ok = rng() < 1 - crystal * (1 - off / (armAngle / 2));
            }
            if (ok) { data[j * cols + i] = 1; stuck++; }
            break;
          }
          i = ni; j = nj;
        }
      }
    };
    // A frame: the grid traced as it is, without the final smoothing.
    const draft = () => ({ ...letter, shape: contour(g, 0.5) });
    const finish = () => ({ ...letter, shape: union(contour(blur(g, smooth), 0.5), letter.shape) });
    return { step, draft, finish };
  });
  for (let f = 0; f < frames; f++) {
    for (const sim of sims) sim?.step();
    yield sims.map((sim, k) => sim?.draft() ?? letters[k]);
  }
  return sims.map((sim, k) => sim?.finish() ?? letters[k]);
}

// ── Diffusion-limited aggregation ────────────────────────────────────────────────
// Walkers wander at random and stick when they touch the letter: branching, frosty
// growth. `crystal` > 0 only lets them stick along `arms` directions: dendrites.
export const dla = stepwise(dlaSteps);
