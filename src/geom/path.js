// Polyline helpers: bezier flattening, resampling, simplification, SVG output.

const lerp = (a, b, t) => a + (b - a) * t;

// opentype.js path commands -> array of closed polygons.
export function commandsToPolygons(commands, steps = 10) {
  const polys = [];
  let cur = [];
  let last = { x: 0, y: 0 };
  for (const c of commands) {
    if (c.type === 'M') {
      if (cur.length > 2) polys.push(cur);
      cur = [{ x: c.x, y: c.y }];
    } else if (c.type === 'L') {
      cur.push({ x: c.x, y: c.y });
    } else if (c.type === 'Q') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push({ x: u * u * last.x + 2 * u * t * c.x1 + t * t * c.x,
          y: u * u * last.y + 2 * u * t * c.y1 + t * t * c.y });
      }
    } else if (c.type === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push({
          x: u * u * u * last.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          y: u * u * u * last.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        });
      }
    } else if (c.type === 'Z') {
      if (cur.length > 2) polys.push(cur);
      cur = [];
      continue;
    }
    last = { x: c.x, y: c.y };
  }
  if (cur.length > 2) polys.push(cur);
  return polys;
}

export const perimeter = (poly) => {
  let len = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
};

// Evenly resample a closed polygon so vertices are ~`spacing` apart.
export function resample(poly, spacing) {
  const total = perimeter(poly);
  const n = Math.max(8, Math.round(total / spacing));
  const step = total / n;
  const out = [];
  let i = 0, acc = 0;
  let a = poly[0], b = poly[1 % poly.length];
  let seg = Math.hypot(b.x - a.x, b.y - a.y);
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (acc + seg < target && i < poly.length) {
      acc += seg;
      i++;
      a = poly[i % poly.length];
      b = poly[(i + 1) % poly.length];
      seg = Math.hypot(b.x - a.x, b.y - a.y);
    }
    const t = seg ? (target - acc) / seg : 0;
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  }
  return out;
}

const pointLineDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

function rdp(points, eps) {
  if (points.length < 3) return points;
  let max = 0, idx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDist(points[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...rdp(points.slice(0, idx + 1), eps).slice(0, -1), ...rdp(points.slice(idx), eps)];
}

// Ramer–Douglas–Peucker for a closed polygon (split at the farthest pair).
export function simplify(poly, eps) {
  if (poly.length < 4) return poly;
  let far = 0, fi = 0;
  for (let i = 1; i < poly.length; i++) {
    const d = Math.hypot(poly[i].x - poly[0].x, poly[i].y - poly[0].y);
    if (d > far) { far = d; fi = i; }
  }
  const first = rdp(poly.slice(0, fi + 1), eps);
  const second = rdp([...poly.slice(fi), poly[0]], eps);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

export const shapeToPathData = (shape) =>
  shape
    .filter((p) => p.length > 2)
    .map((poly) => `M${poly.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}Z`)
    .join('');

// Normal per vertex pointing away from the filled material. Relies on clipper's
// orientation (outer rings and holes wind oppositely), so pass normalised shapes.
export function vertexNormals(poly) {
  const n = poly.length;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    return { x: ty, y: -tx };
  });
}

// Chaikin corner cutting on a closed polygon.
export function chaikin(poly, iterations = 2) {
  let pts = poly;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

const turnAngle = (a, b, c) => {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
};

/**
 * Taubin smoothing of a closed polygon: removes wiggles below `radius` without the
 * shrinking plain averaging causes. Vertices whose turn exceeds `corner` (radians) on a
 * coarse version of the ring stay pinned, so intended corners stay sharp.
 */
export function smoothRing(ring, { radius, spacing = radius / 4, corner = Math.PI / 3, coarse = radius * 0.6 }) {
  // `coarse`: detail level at which corners are detected (callers pass a fixed scale,
  // so a bigger radius smooths more without turning more points into corners).
  const pts = resample(ring, spacing);
  const n = pts.length;
  const pinned = new Uint8Array(n);
  if (corner < Math.PI) {
    const simple = simplify(ring, coarse);
    simple.forEach((p, i) => {
      const prev = simple[(i - 1 + simple.length) % simple.length];
      const next = simple[(i + 1) % simple.length];
      if (turnAngle(prev, p, next) < corner) return;
      let best = 0, bd = Infinity;
      pts.forEach((q, k) => {
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < bd) { bd = d; best = k; }
      });
      pts[best] = { x: p.x, y: p.y };
      pinned[best] = 1;
    });
  }
  // Gaussian-like smoothing at the scale of `radius`: each pass averages a point with
  // its neighbours (variance 0.5 samples²), so sigma = radius needs 2·(radius/spacing)²
  // passes. Plain averaging shrinks the ring; the area is restored afterwards.
  const iterations = Math.max(1, Math.round(2 * (radius / spacing) ** 2));
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    cur = cur.map((p, i) => {
      if (pinned[i]) return p;
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
  return restoreArea(cur, Math.abs(ringArea(pts)));
}

const ringArea = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return a / 2;
};

// Push a ring along its normals (away from its centre) until it encloses `target`.
function restoreArea(ring, target) {
  const n = ring.length;
  if (n < 3) return ring;
  const per = perimeter(ring);
  const d = (target - Math.abs(ringArea(ring))) / (per || 1);
  if (Math.abs(d) < 1e-3) return ring;
  const c = ring.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  const normals = ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
    const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
    return { x: ty / len, y: -tx / len };
  });
  // Orient the normals outward from the ring's centre.
  const out = normals.reduce((s, nn, i) => s + nn.x * (ring[i].x - c.x) + nn.y * (ring[i].y - c.y), 0) > 0 ? 1 : -1;
  return ring.map((p, i) => ({ x: p.x + normals[i].x * d * out, y: p.y + normals[i].y * d * out }));
}

/**
 * Closed rings as smooth SVG curves: wiggles below `smooth` are ironed out, the ring
 * is reduced to few points (`tolerance`), and centripetal Catmull–Rom curves are
 * drawn through them. Points turning more than `corner` (radians) stay sharp.
 */
export function shapeToCurveData(shape, { tolerance, smooth = tolerance * 2, corner = Math.PI / 3.2 }) {
  return shape
    .filter((p) => p.length > 2)
    .map((ring) => {
      // Big outlines take the full smoothing; slits and counters only a fraction
      // of their own size, so they keep their shape.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of ring) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const size = Math.min(maxX - minX, maxY - minY);
      const radius = Math.min(smooth, size * 0.15);
      const tol = Math.min(tolerance, size * 0.1);
      let pts = radius > 0.5 ? smoothRing(ring, { radius, corner, coarse: Math.min(radius * 0.6, tolerance * 2) }) : ring;
      pts = simplify(pts, tol);
      const n = pts.length;
      if (n < 3) return '';
      const sharp = pts.map((p, i) => turnAngle(pts[(i - 1 + n) % n], p, pts[(i + 1) % n]) > corner);
      let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        // Centripetal Catmull–Rom → cubic bezier (Yuksel et al.); sharp points get no tangent.
        const len = (a, b) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-6;
        const d1 = len(p0, p1), d2 = len(p1, p2), d3 = len(p2, p3);
        const c1 = sharp[i] ? p1 : {
          x: (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) / (3 * d1 * (d1 + d2)),
          y: (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) / (3 * d1 * (d1 + d2)),
        };
        const c2 = sharp[(i + 1) % n] ? p2 : {
          x: (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) / (3 * d3 * (d3 + d2)),
          y: (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) / (3 * d3 * (d3 + d2)),
        };
        d += `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
      }
      return `${d}Z`;
    })
    .join('');
}
