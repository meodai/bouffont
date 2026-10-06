// Simulation-based growth (after nshelton.github.io/home/growth): differential line
// growth and diffusion-limited aggregation, each run
// per letter and seeded by its current shape. All lengths in stems. Seeded by ctx.rng.
import { difference, normalize, offset, signedArea, union } from '../geom/clip.js';
import { resample, vertexNormals } from '../geom/path.js';
import { blur, contour, makeGrid, rasterize } from '../geom/raster.js';
import { scanFill } from '../geom/grid.js';

// ── Differential line growth ─────────────────────────────────────────────────────
// Every outline becomes a chain of nodes: neighbours pull together (smooth), nearby
// nodes push apart (no self-overlap), edges split when long, and every node creeps
// outward. The line has to fold to fit: coral-like, wrinkled letters.
export function coral(letters, ctx, {
  steps = 110, spacing = 0.18, repel = 0.6, attract = 0.4, push = 0.035, jitter = 0.02, maxNodes = 1600,
  reach = 1.1, // never further than this from the letter's pen drawing
  from = 'core', // 'shape': measure reach from the current shape (more generations)
} = {}) {
  const stem = ctx.stem;
  const d = spacing * stem, R = repel * stem;
  return letters.map((letter) => {
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
    let rings = letter.shape.filter((r) => Math.sign(signedArea(r)) === sign)
      .map((ring) => resample(ring, d).map((p) => ({ x: p.x, y: p.y })));
    for (let it = 0; it < steps; it++) {
      // Spatial hash of all nodes of this letter.
      const hash = new Map();
      const hk = (cx, cy) => cx * 73856093 + cy * 19349663; // numeric cell key
      rings.forEach((ring, ri) => ring.forEach((p, i) => {
        const k = hk(Math.floor(p.x / R), Math.floor(p.y / R));
        const list = hash.get(k);
        if (list) list.push(ri, i); else hash.set(k, [ri, i]);
      }));
      rings = rings.map((ring, ri) => {
        const n = ring.length;
        const normals = vertexNormals(ring);
        const next = ring.map((p, i) => {
          const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
          let fx = ((a.x + b.x) / 2 - p.x) * attract, fy = ((a.y + b.y) / 2 - p.y) * attract;
          const cx = Math.floor(p.x / R), cy = Math.floor(p.y / R);
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            for (let gy = cy - 1; gy <= cy + 1; gy++) {
              const list = hash.get(hk(gx, gy));
              if (!list) continue;
              for (let t = 0; t < list.length; t += 2) {
                const rj = list[t], j = list[t + 1];
                if (rj === ri && Math.abs(j - i) <= 1) continue;
                const q = rings[rj][j];
                const dx = p.x - q.x, dy = p.y - q.y, dist = Math.hypot(dx, dy);
                if (dist > 0 && dist < R) {
                  const f = ((R - dist) / R) * 0.5;
                  fx += (dx / dist) * f * d; fy += (dy / dist) * f * d;
                }
              }
            }
          }
          fx += normals[i].x * push * stem + ctx.rng.range(-jitter, jitter) * stem;
          fy += normals[i].y * push * stem + ctx.rng.range(-jitter, jitter) * stem;
          const moved = { x: p.x + fx, y: p.y + fy };
          // Nodes stop at the reach limit instead of being cut off later.
          return insideLimit(moved) ? moved : p;
        });
        // Split long edges.
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
    }
    // Folds leave little enclosed pockets: fill them, only real counters stay open.
    const n0 = normalize(rings);
    const big = n0.length ? n0.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a)) : null;
    const grown = big ? union(n0.filter((r) => Math.sign(signedArea(r)) === Math.sign(signedArea(big)))) : n0;
    return { ...letter, shape: holes.length ? difference(grown, normalize(holes.map((h) => [...h].reverse()))) : grown };
  });
}

// ── Diffusion-limited aggregation ────────────────────────────────────────────────
// Walkers wander at random and stick when they touch the letter: branching, frosty
// growth. `crystal` > 0 only lets them stick along `arms` directions: dendrites.
export function dla(letters, ctx, {
  reach = 1.6, cell = 0.18, particles = 1.2, stick = 0.9, crystal = 0, arms = 6, walk = 1500, smooth = 1,
} = {}) {
  const stem = ctx.stem;
  return letters.map((letter) => {
    const g = rasterize(makeGrid(letter.shape, cell * stem, reach * stem), letter.shape);
    const { cols, rows, data } = g;
    const filled = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && data[j * cols + i] > 0.5;
    // Particle count: proportional to the letter's outline length.
    let edge = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (filled(i, j) && !filled(i + 1, j)) edge++;
    const total = Math.round(edge * particles * 4);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const armAngle = (Math.PI * 2) / arms;
    let stuck = 0;
    for (let n = 0; n < total * 3 && stuck < total; n++) {
      // Spawn on an empty cell near the cluster.
      let i = ctx.rng.int(0, cols - 1), j = ctx.rng.int(0, rows - 1);
      if (filled(i, j)) continue;
      for (let s = 0; s < walk; s++) {
        const [di, dj] = N4[Math.floor(ctx.rng() * 4)];
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) break;
        if (filled(ni, nj)) {
          let ok = ctx.rng() < stick;
          if (ok && crystal) {
            // Direction from the cell it touches: only near one of the arms.
            const a = Math.atan2(j - nj, i - ni);
            const off = Math.abs(((a % armAngle) + armAngle) % armAngle - armAngle / 2);
            ok = ctx.rng() < 1 - crystal * (1 - off / (armAngle / 2));
          }
          if (ok) { data[j * cols + i] = 1; stuck++; }
          break;
        }
        i = ni; j = nj;
      }
    }
    const shape = contour(blur(g, smooth), 0.5);
    return { ...letter, shape: union(shape, letter.shape) };
  });
}
