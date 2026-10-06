// Fast grid helpers: scanline fill of a shape, and exact Euclidean distance /
// nearest-seed transforms (Felzenszwalb & Huttenlocher). Cell (i, j) sits at
// (x0 + i·cell, y0 + j·cell).

// 1 where the cell centre is inside the shape (even–odd), 0 elsewhere.
export function scanFill(shape, { x0, y0, cell, cols, rows }) {
  const out = new Uint8Array(cols * rows);
  const xs = [];
  for (let j = 0; j < rows; j++) {
    const y = y0 + j * cell;
    xs.length = 0;
    for (const ring of shape) {
      for (let a = ring.length - 1, b = 0; b < ring.length; a = b++) {
        const p = ring[a], q = ring[b];
        if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell));
      const i1 = Math.min(cols - 1, Math.floor((xs[k + 1] - x0) / cell));
      for (let i = i0; i <= i1; i++) out[j * cols + i] = 1;
    }
  }
  return out;
}

const INF = 1e20;

// 1D squared distance transform of f with argmin tracking (lower envelope of parabolas).
function dt1(f, n, arg, d, idx, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    idx[q] = d[q] >= INF / 2 ? -1 : arg[v[k]];
  }
}

/**
 * Exact nearest-seed transform. seeds: Int32Array, −1 for "not a seed", otherwise any
 * id. Returns { dist2 (squared, in cells), nearest (seed id) } per cell.
 */
export function nearestSeed(seeds, cols, rows) {
  const n = Math.max(cols, rows);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const arg = new Int32Array(n), idx = new Int32Array(n);
  const D = new Float64Array(cols * rows), A = new Int32Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) { const s = seeds[j * cols + i]; f[j] = s >= 0 ? 0 : INF; arg[j] = s; }
    dt1(f, rows, arg, d, idx, v, z);
    for (let j = 0; j < rows; j++) { D[j * cols + i] = d[j]; A[j * cols + i] = idx[j]; }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) { f[i] = D[j * cols + i]; arg[i] = A[j * cols + i]; }
    dt1(f, cols, arg, d, idx, v, z);
    for (let i = 0; i < cols; i++) { D[j * cols + i] = d[i]; A[j * cols + i] = idx[i]; }
  }
  return { dist2: D, nearest: A };
}

// Distance (in cells) from every cell to the nearest cell where mask === 0.
export function distanceToOutside(mask, cols, rows) {
  const seeds = new Int32Array(cols * rows);
  for (let k = 0; k < seeds.length; k++) seeds[k] = mask[k] ? -1 : k;
  return nearestSeed(seeds, cols, rows).dist2;
}
