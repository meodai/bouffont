// Grids for simulation-based growth: rasterise a shape, blur, and trace contours
// back into polygons (marching squares).
import { bbox, normalize } from './clip.js';
import { scanFill } from './grid.js';

export function makeGrid(shape, cell, pad) {
  const b = bbox(shape);
  const x0 = b.minX - pad, y0 = b.minY - pad;
  const cols = Math.ceil((b.width + pad * 2) / cell) + 1;
  const rows = Math.ceil((b.height + pad * 2) / cell) + 1;
  return { cols, rows, x0, y0, cell, data: new Float32Array(cols * rows) };
}


// `value` inside the shape (scanline fill), cells outside untouched.
export function rasterize(g, shape, value = 1) {
  const m = scanFill(shape, g);
  for (let k = 0; k < m.length; k++) if (m[k]) g.data[k] = value;
  return g;
}

export function blur(g, passes = 1) {
  const { cols, rows } = g;
  let src = g.data;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(src.length);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
            const w = di && dj ? 1 : di || dj ? 2 : 4;
            s += src[nj * cols + ni] * w; n += w;
          }
        }
        out[j * cols + i] = s / n;
      }
    }
    src = out;
  }
  return { ...g, data: src };
}

// Marching squares: polygons where the field crosses `level` (inside = above).
export function contour(g, level = 0.5) {
  const { cols, rows, data } = g;
  const v = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : data[j * cols + i]);
  const lerp = (a, b) => (level - a) / (b - a || 1e-9);
  const segs = new Map(); // start key -> end point
  const key = (p) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const add = (a, b) => segs.set(key(a), { a, b });
  for (let j = -1; j < rows; j++) {
    for (let i = -1; i < cols; i++) {
      const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1);
      const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = { x: i + lerp(tl, tr), y: j }, right = { x: i + 1, y: j + lerp(tr, br) };
      const bottom = { x: i + lerp(bl, br), y: j + 1 }, left = { x: i, y: j + lerp(tl, bl) };
      // Segments oriented with the inside on the right.
      switch (idx) {
        case 1: add(bottom, left); break;
        case 2: add(right, bottom); break;
        case 3: add(right, left); break;
        case 4: add(top, right); break;
        case 5: add(top, left); add(bottom, right); break;
        case 6: add(top, bottom); break;
        case 7: add(top, left); break;
        case 8: add(left, top); break;
        case 9: add(bottom, top); break;
        case 10: add(left, bottom); add(right, top); break;
        case 11: add(right, top); break;
        case 12: add(left, right); break;
        case 13: add(bottom, right); break;
        case 14: add(left, bottom); break;
      }
    }
  }
  const rings = [];
  const used = new Set();
  for (const [k, s] of segs) {
    if (used.has(k)) continue;
    const ring = [];
    let cur = s, ck = k;
    while (cur && !used.has(ck)) {
      used.add(ck);
      ring.push(cur.a);
      ck = key(cur.b);
      cur = segs.get(ck);
    }
    if (ring.length > 2) rings.push(ring.map((p) => ({ x: g.x0 + p.x * g.cell, y: g.y0 + p.y * g.cell })));
  }
  return normalize(rings, 'evenodd');
}
