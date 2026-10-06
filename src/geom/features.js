// Keep letters legible while they grow.
// - Counters (holes) are shrunk by the growth but never closed below `keep`.
// - Creases: where the growth fronts of two different parts of a letter meet
//   (between the arms of an E, the openings of an S), a thin line is carved.
//   That is the inner line of a throw-up. Found with a grid: each cell in the
//   added region looks up its nearest point on the original outline; a crease
//   lies where neighbouring cells map to outline points far apart along it.
import { area, bbox, contains, difference, intersection, offset, signedArea, union, close, strokeLine } from './clip.js';
import { chaikin, perimeter, resample, simplify } from './path.js';
import { skeleton } from './skeleton.js';
import { nearestSeed, scanFill } from './grid.js';

function inradius(shape, hi) {
  let lo = 0;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (offset(shape, -mid).length) lo = mid;
    else hi = mid;
  }
  return lo;
}

function splitRings(shape) {
  const largest = shape.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const sign = Math.sign(signedArea(largest));
  return {
    outer: shape.filter((r) => Math.sign(signedArea(r)) === sign),
    holes: shape.filter((r) => Math.sign(signedArea(r)) !== sign),
  };
}

// Holes shrink with growth, but stay at least `keep` wide.
export function counters(original, shrink, keep) {
  const { outer, holes } = splitRings(original);
  const cuts = [];
  for (const ring of holes) {
    const f = difference(union([ring.slice().reverse()]), []);
    if (!f.length) continue;
    const size = bbox(f);
    const r = inradius(f, Math.min(size.width, size.height) / 2 + 1);
    if (r * 2 < keep * 0.5) continue;
    const cut = offset(f, -Math.min(shrink, Math.max(0, r - keep / 2)));
    cuts.push(...cut);
  }
  return { cuts, outer };
}

/**
 * Crease lines between growth fronts, as polygons about `keep` wide.
 * 1. Every grid cell in the added region (plus a margin past the grown edge) looks up
 *    its nearest outline point. Where neighbouring cells jump to points far apart
 *    along the outline, the fronts meet: a ridge cell.
 * 2. Ridge cells are grouped into connected lines. A line is kept if somewhere along
 *    it the jump is large relative to the distance (`ratio`): it starts in a real
 *    notch, not at a plain inside corner. Kept lines run to the edge and past it,
 *    so the notch stays open instead of reconnecting.
 */
export function creases(original, grown, { cell, keep, ratio = 2.3, details = {} }) {
  const { minLength = 0, minDepth = Infinity, spacing = 0, angles = null, clean = false, minCount = 0 } = details;
  // Outline samples carry ring index + arc position, to measure distance along the outline.
  const samples = [];
  const lengths = [];
  original.forEach((ring, ri) => {
    const pts = resample(ring, cell);
    const len = perimeter(pts);
    lengths.push(len);
    const step = len / pts.length;
    pts.forEach((p, i) => samples.push({ x: p.x, y: p.y, ring: ri, s: i * step }));
  });
  const arcGap = (a, b) => {
    if (a.ring !== b.ring) return Infinity;
    const d = Math.abs(a.s - b.s);
    return Math.min(d, lengths[a.ring] - d);
  };

  // Ridge cells as a smooth shape about `keep` wide (thinning the staircase).
  const band = (cells) => {
    const half = cell / 2;
    const squares = cells.map((p) => [
      { x: p.x - half, y: p.y - half }, { x: p.x + half, y: p.y - half },
      { x: p.x + half, y: p.y + half }, { x: p.x - half, y: p.y + half },
    ]);
    const rings = close(union(squares), cell).map((ring) => chaikin(simplify(ring, cell * 0.6), 3));
    return offset(union(rings), keep / 2 - cell * 0.75, { join: 'round' });
  };

  const margin = cell * 2;
  const region = offset(grown, margin);
  const b = bbox(region);
  const cols = Math.ceil(b.width / cell) + 1;
  const rows = Math.ceil(b.height / cell) + 1;
  const grid = new Array(cols * rows).fill(null);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { x: b.minX + i * cell, y: b.minY + j * cell };
      if (!contains(region, p) || contains(original, p)) continue;
      let best = null, bd = Infinity;
      for (const s of samples) {
        const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      grid[j * cols + i] = { p, near: best, d: Math.sqrt(bd), ridge: false, seed: false };
    }
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = grid[j * cols + i];
      if (!c) continue;
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni >= cols || nj < 0 || nj >= rows) continue;
        const n = grid[nj * cols + ni];
        if (!n) continue;
        const gap = arcGap(c.near, n.near);
        const d = Math.max(c.d, n.d, cell);
        if (gap > Math.max(cell * 3, d * 0.8)) {
          c.ridge = n.ridge = true;
          // How much outline wraps around this spot: deep notches score high.
          const depth = Number.isFinite(gap) ? gap : d * 10;
          c.depth = Math.max(c.depth ?? 0, depth);
          n.depth = Math.max(n.depth ?? 0, depth);
          if (gap > ratio * d) c.seed = n.seed = true;
        }
      }
    }
  }

  // Keep connected ridge lines that contain a seed.
  const marks = [];
  const lines = [];
  const candidates = [];
  const seen = new Uint8Array(cols * rows);
  for (let k = 0; k < grid.length; k++) {
    if (!grid[k]?.ridge || seen[k]) continue;
    const line = [];
    let seeded = false;
    let depth = 0;
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop();
      const c = grid[q];
      line.push(c.p);
      seeded ||= c.seed;
      depth = Math.max(depth, c.depth ?? 0);
      const qi = q % cols, qj = (q - qi) / cols;
      // 5×5 neighbourhood: bridges one-cell gaps so a crease isn't split into fragments.
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ni = qi + di, nj = qj + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nk = nj * cols + ni;
          if (!seen[nk] && grid[nk]?.ridge) {
            seen[nk] = 1;
            stack.push(nk);
          }
        }
      }
    }
    // Unseeded lines start at plain corners; tiny fragments read as specks, not lines.
    if (!seeded || line.length < 8) continue;
    const stroke = centerline(line, cell);
    if (stroke) candidates.push({ pts: stroke, depth });
    // Blobs (not line-like) are open counters, like the inside of a G: they stay
    // shapes, drawn as a band of cells, and compete with the lines when cleaning up.
    else if (clean) candidates.push({ pts: axisLine(line), depth, blob: band(line) });
    else marks.push(...line);
  }

  // Details a painter would actually paint: long enough, not crowding each other,
  // and (optionally) cut at a handful of angles.
  // A straightened cut may leave its notch, so it only ever cuts what growth added.
  // If straightening would lose most of the crease (a curved one, like a G's opening),
  // that crease keeps its own curve.
  const allowed = angles ? difference(region, original) : null;
  const cut = (pts) => strokeLine(pts, keep, { cap: 'round' });
  const snap = (c) => {
    if (c.blob) return { ...c, poly: c.blob };
    if (!angles) return { ...c, poly: cut(c.pts) };
    const straight = straighten(c.pts, angles);
    const poly = intersection(cut(straight), allowed);
    const curved = intersection(cut(c.pts), allowed);
    return area(poly) >= area(curved) * 0.5 ? { ...c, pts: straight, poly } : { ...c, poly: curved };
  };
  // Every letter keeps its `minCount` most important creases (they make it legible);
  // beyond that, short *and* shallow ones are stubs, and crowding ones are dropped.
  const ranked = candidates
    .map(snap)
    .map((c) => ({ ...c, len: polylineLength(c.pts) }))
    .sort((a, b) => b.depth - a.depth || b.len - a.len);
  const kept = [];
  for (const c of ranked) {
    const guaranteed = kept.length < minCount;
    const worth = c.len >= minLength || c.depth >= minDepth;
    const roomy = !spacing || kept.every((a) => polylineDistance(a.pts, c.pts) >= spacing * (guaranteed ? 0.5 : 1));
    if ((guaranteed || worth) && roomy) kept.push(c);
  }
  lines.push(...union(...kept.map((c) => c.poly)));
  if (!marks.length) return lines;
  return union(band(marks), lines);
}

const polylineLength = (pts) =>
  pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Closest approach of two polylines (vertex-to-segment, both ways).
function polylineDistance(A, B) {
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const p of P) {
      for (let i = 1; i < Q.length; i++) best = Math.min(best, pointSegmentDistance(p, Q[i - 1], Q[i]));
    }
  }
  return best;
}

// Grid cells as a smooth band about `keep` wide.
function cellBand(cells, cell, keep) {
  const half = cell / 2;
  const squares = cells.map((p) => [
    { x: p.x - half, y: p.y - half }, { x: p.x + half, y: p.y - half },
    { x: p.x + half, y: p.y + half }, { x: p.x - half, y: p.y + half },
  ]);
  const rings = close(union(squares), cell).map((ring) => chaikin(simplify(ring, cell * 0.6), 3));
  return offset(union(rings), keep / 2 - cell * 0.75, { join: 'round' });
}

// Main axis of a point cluster, as a segment spanning it.
function axisLine(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) { xx += (p.x - mx) ** 2; xy += (p.x - mx) * (p.y - my); yy += (p.y - my) ** 2; }
  const a = Math.atan2(2 * xy, xx - yy) / 2;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const ts = points.map((p) => (p.x - mx) * u.x + (p.y - my) * u.y);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  return [{ x: mx + u.x * t0, y: my + u.y * t0 }, { x: mx + u.x * t1, y: my + u.y * t1 }];
}

// Replace a crease by a straight cut through its middle, snapped to the nearest of
// the allowed directions (radians, taken modulo 180°), spanning the same extent.
function straighten(pts, angles) {
  const a = pts[0], b = pts[pts.length - 1];
  const raw = Math.atan2(b.y - a.y, b.x - a.x);
  const wrap = (x) => ((x % Math.PI) + Math.PI) % Math.PI;
  let best = angles[0], bd = Infinity;
  for (const ang of angles) {
    const d = Math.min(Math.abs(wrap(raw) - wrap(ang)), Math.PI - Math.abs(wrap(raw) - wrap(ang)));
    if (d < bd) { bd = d; best = ang; }
  }
  const u = { x: Math.cos(best), y: Math.sin(best) };
  const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
  const ts = pts.map((p) => (p.x - c.x) * u.x + (p.y - c.y) * u.y);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  return [{ x: c.x + u.x * t0, y: c.y + u.y * t0 }, { x: c.x + u.x * t1, y: c.y + u.y * t1 }];
}

// For an elongated cluster of ridge cells: average them into bins along the main
// axis and smooth the result, giving a clean centre line. Returns null when the
// cluster is not line-like (blobs, branches); those fall back to the cell band.
function centerline(points, cell) {
  if (points.length < 4) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) {
    xx += (p.x - mx) ** 2; xy += (p.x - mx) * (p.y - my); yy += (p.y - my) ** 2;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const ax = { x: Math.cos(angle), y: Math.sin(angle) };
  const tr = (xx + yy) / n, det = (xx * yy - xy * xy) / (n * n);
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const major = tr / 2 + disc, minor = Math.max(tr / 2 - disc, 1e-9);
  if (major / minor < 9) return null; // aspect below 3:1

  const bin = cell * 2;
  const bins = new Map();
  for (const p of points) {
    const k = Math.round(((p.x - mx) * ax.x + (p.y - my) * ax.y) / bin);
    const b = bins.get(k) ?? { x: 0, y: 0, n: 0 };
    b.x += p.x; b.y += p.y; b.n++;
    bins.set(k, b);
  }
  let line = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({ x: b.x / b.n, y: b.y / b.n }));
  for (let it = 0; it < 3; it++) {
    line = line.map((p, i) => {
      if (i === 0 || i === line.length - 1) return p;
      const a = line[i - 1], c = line[i + 1];
      return { x: (a.x + 2 * p.x + c.x) / 4, y: (a.y + 2 * p.y + c.y) / 4 };
    });
  }
  return line.length >= 2 ? line : null;
}

/**
 * Carve counters and creases of `original` into `grown`.
 * shrink: how far growth reached (px); keep: slit width (px); cell: crease grid size (px).
 * details (px / radians): { minLength, spacing, angles, clean }, see `creases`.
 */
export function carveFeatures(original, grown, { shrink, keep, cell = keep, details }) {
  if (!original.length || !grown.length) return grown;
  const { cuts } = counters(original, shrink, keep);
  const lines = creases(original, grown, { cell, keep, details });
  const all = [...cuts, ...lines];
  return all.length ? difference(grown, all) : grown;
}

/**
 * Inner lines for structured letters (returned as polylines, stroked on top of the
 * letter at render time with the outline pen, so later smoothing can't close them): where the swell coming from two different
 * parts of the letter's centre lines meets. Every cell of the grown area is given
 * to its nearest centre-line point; a line runs where neighbouring cells belong to
 * parts that face each other across a gap (a notch, the opening of a G), not where
 * strokes simply join at a corner. Lines run through the grown edge, so openings
 * stay open. Same rule for every letter.
 *
 * structure: [{ points, closed }]; keep: line width (px); cell: grid size (px)
 * face: how directly the two parts must face each other (2 = opposite, 1.41 = corner)
 */
export function meetLines(structure, original, grown, { keep, cell, face = 1.75, minLength = 0 }) {
  if (!structure?.length || !grown.length) return [];
  const samples = [];
  const lengths = [];
  structure.forEach((st, li) => {
    const src = st.closed ? [...st.points, st.points[0]] : st.points;
    let s = 0;
    for (let i = 0; i < src.length - 1; i++) {
      const a = src[i], b = src[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(seg / (cell / 2)));
      for (let k = 0; k < n; k++) {
        samples.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, line: li, s: s + (seg * k) / n });
      }
      s += seg;
    }
    if (!st.closed) samples.push({ ...src[src.length - 1], line: li, s });
    lengths.push({ len: s, closed: st.closed });
  });
  const arcGap = (a, b) => {
    if (a.line !== b.line) return Infinity;
    const d = Math.abs(a.s - b.s);
    return lengths[a.line].closed ? Math.min(d, lengths[a.line].len - d) : d;
  };

  const region = offset(grown, cell * 2.5); // a little past the edge: lines cut through it
  const b = bbox(region);
  const cols = Math.ceil(b.width / cell) + 1, rows = Math.ceil(b.height / cell) + 1;
  const g = { x0: b.minX, y0: b.minY, cell, cols, rows };
  const inRegion = scanFill(region, g), inOriginal = scanFill(original, g);
  // Nearest centre-line sample per cell: exact nearest-seed transform.
  const seeds = new Int32Array(cols * rows).fill(-1);
  samples.forEach((sm, si) => {
    const i = Math.round((sm.x - b.minX) / cell), j = Math.round((sm.y - b.minY) / cell);
    if (i >= 0 && j >= 0 && i < cols && j < rows && seeds[j * cols + i] < 0) seeds[j * cols + i] = si;
  });
  const { nearest } = nearestSeed(seeds, cols, rows);
  const grid = new Array(cols * rows).fill(null);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!inRegion[k] || inOriginal[k] || nearest[k] < 0) continue;
      const p = { x: b.minX + i * cell, y: b.minY + j * cell };
      const near = samples[nearest[k]];
      grid[k] = { p, near, d: Math.hypot(near.x - p.x, near.y - p.y) };
    }
  }
  const ridge = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = grid[j * cols + i];
      if (!c) continue;
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni >= cols || nj < 0 || nj >= rows) continue;
        const n = grid[nj * cols + ni];
        if (!n) continue;
        const d = Math.max(c.d, n.d, cell);
        const apart = Math.hypot(c.near.x - n.near.x, c.near.y - n.near.y);
        if (apart > face * d && arcGap(c.near, n.near) > 2.5 * d) {
          ridge[j * cols + i] = ridge[nj * cols + ni] = 1;
        }
      }
    }
  }
  // Connected ridge lines → smooth centre lines → strokes of width `keep`.
  const seen = new Uint8Array(cols * rows);
  const cuts = [];
  for (let k = 0; k < ridge.length; k++) {
    if (!ridge[k] || seen[k]) continue;
    const pts = [];
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop();
      pts.push(grid[q].p);
      const qi = q % cols, qj = (q - qi) / cols;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ni = qi + di, nj = qj + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nk = nj * cols + ni;
          if (ridge[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
    }
    const line = centerline(pts, cell);
    if (line) {
      if (polylineLength(line) >= Math.max(minLength, keep * 2)) cuts.push(line);
    } else if (pts.length > 6) {
      // Not a single line (a bend, a fork): the centre line(s) of the cell cluster.
      const band = cellBand(pts, cell, cell * 2);
      const all = skeleton(band, { cell: cell / 2, prune: 1.5 }).filter((st) => !st.closed);
      const longest = Math.max(0, ...all.map((st) => polylineLength(st.points)));
      for (const st of all) {
        if (polylineLength(st.points) >= Math.max(longest * 0.5, minLength, keep * 2)) cuts.push(st.points);
      }
    }
  }
  // Polylines; the renderer draws them with the outline pen.
  return cuts.map((pts) => simplify(pts, cell * 0.4));
}
