// Thin wrapper around clipper-lib. Public shapes are arrays of polygons,
// a polygon is an array of {x, y}. Clipper works on scaled integers internally.
import ClipperLib from 'clipper-lib';

const SCALE = 100;
const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } =
  ClipperLib;

const JOINS = { round: JoinType.jtRound, miter: JoinType.jtMiter, square: JoinType.jtSquare };

const toClip = (shape) =>
  shape.map((poly) => poly.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));

// Drop near-duplicate vertices (px) after every operation, so repeated
// offsets/booleans don't snowball in vertex count.
const CLEAN = 0.3 * SCALE;

const fromClip = (paths) =>
  Clipper.CleanPolygons(paths, CLEAN)
    .filter((p) => p.length > 2)
    .map((poly) => poly.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })));

function boolean(type, subject, clip = [], fill = PolyFillType.pftNonZero) {
  const c = new Clipper();
  c.AddPaths(toClip(subject), PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(toClip(clip), PolyType.ptClip, true);
  const out = [];
  c.Execute(type, out, fill, fill);
  return fromClip(out);
}

export const union = (...shapes) => boolean(ClipType.ctUnion, shapes.flat());
export const difference = (a, b) => (b.length ? boolean(ClipType.ctDifference, a, b) : a);
export const intersection = (a, b) => boolean(ClipType.ctIntersection, a, b);

// Normalise arbitrary input (font contours, self-intersections) into clean even-odd polygons.
export const normalize = (shape, fill = 'nonzero') =>
  boolean(
    ClipType.ctUnion,
    shape,
    [],
    fill === 'evenodd' ? PolyFillType.pftEvenOdd : PolyFillType.pftNonZero
  );

export function offset(shape, delta, { join = 'round', miterLimit = 2, arcTolerance = 0.25 } = {}) {
  if (!delta) return shape;
  const co = new ClipperOffset(miterLimit, arcTolerance * SCALE);
  co.AddPaths(toClip(shape), JOINS[join], EndType.etClosedPolygon);
  const out = [];
  co.Execute(out, delta * SCALE);
  return fromClip(out);
}

// Offset a polyline (open, or closed with `closed`) into a stroke outline.
export function strokeLine(points, width, { join = 'round', cap = 'round', closed = false } = {}) {
  const co = new ClipperOffset(2, 0.25 * SCALE);
  const end = closed
    ? EndType.etClosedLine
    : { round: EndType.etOpenRound, square: EndType.etOpenSquare, butt: EndType.etOpenButt }[cap];
  co.AddPaths(toClip([points]), JOINS[join], end);
  const out = [];
  co.Execute(out, (width / 2) * SCALE);
  return fromClip(out);
}

// Morphological opening (rounds/cuts convex corners) and closing (fills concave corners).
export const open = (shape, r, join = 'round') => offset(offset(shape, -r, { join }), r, { join });
export const close = (shape, r, join = 'round') => offset(offset(shape, r, { join }), -r, { join });

export const signedArea = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
};

export const area = (shape) => Math.abs(shape.reduce((s, p) => s + signedArea(p), 0));

export function bbox(shape) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of shape) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// Even–odd point-in-shape test in plain JS (shapes are normalised, so even–odd
// matches clipper's fill).
export function contains(shape, pt) {
  const { x, y } = pt;
  let inside = false;
  for (const ring of shape) {
    for (let a = ring.length - 1, b = 0; b < ring.length; a = b++) {
      const p = ring[a], q = ring[b];
      if ((p.y > y) !== (q.y > y) && x < p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x)) inside = !inside;
    }
  }
  return inside;
}

export const mapPoints = (shape, fn) => shape.map((poly) => poly.map(fn));
