// Structure: take only the letter structure from the font and redraw every letter
// with the same pen. The centre lines come from the glyph (geom/skeleton.js); serifs,
// stroke contrast and terminal shapes are dropped. Every letter then shares one
// stroke width, one kind of end and one kind of joint, the starting point for a
// consistent style. Afterwards the pen width is the unit (`stem`) for all strategies.
import { bbox, close, mapPoints, union, strokeLine } from './geom/clip.js';
import { skeleton } from './geom/skeleton.js';
import { centerLines } from './font.js';
import { simplify } from './geom/path.js';

// Moving-average smoothing; open strokes keep their ends.
export function smoothLine(pts, closed, passes) {
  let out = pts;
  const n = pts.length;
  for (let k = 0; k < passes; k++) {
    out = out.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      const a = out[(i - 1 + n) % n], b = out[(i + 1) % n];
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4, r: (a.r + 2 * p.r + b.r) / 4 };
    });
  }
  return out;
}

// Push a free end outward along its direction.
function extend(pts, atStart, by) {
  if (by <= 0 || pts.length < 3) return pts;
  const [p, q] = atStart ? [pts[0], pts[Math.min(3, pts.length - 1)]] : [pts.at(-1), pts.at(-Math.min(4, pts.length))];
  const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  const e = { x: p.x + ((p.x - q.x) / len) * by, y: p.y + ((p.y - q.y) / len) * by, r: p.r };
  return atStart ? [e, ...pts] : [...pts, e];
}

const circle = (p, r, n = 20) =>
  Array.from({ length: n }, (_, i) => ({ x: p.x + Math.cos((i / n) * Math.PI * 2) * r, y: p.y + Math.sin((i / n) * Math.PI * 2) * r }));

// Convex hull (monotone chain): the hull of two circles is a tapered segment.
function hull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/**
 * Draw centre lines with one pen. With `follow` > 0 the pen's width follows the
 * original glyph's local stroke thickness (each point's `r`), relative to the
 * letter's average: 1 keeps the font's contrast, 2 exaggerates it.
 */
export function drawStructure(lines, width, { cap = 'round', join = 'round', follow = 0 } = {}) {
  if (!follow) {
    const pieces = lines.map((l) => strokeLine(l.points, width, { closed: l.closed, cap, join }));
    return pieces.length ? union(...pieces) : null;
  }
  const all = lines.flatMap((l) => l.points).filter((p) => p.r > 0);
  const mean = all.reduce((s, p) => s + p.r, 0) / (all.length || 1) || 1;
  const rad = (p) => (width / 2) * Math.min(2.5, Math.max(0.35, ((p.r ?? mean) / mean) ** follow));
  const pieces = [];
  for (const l of lines) {
    const pts = l.points;
    const n = pts.length;
    if (n === 1) pieces.push(circle(pts[0], rad(pts[0])));
    for (let i = 0; i < (l.closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      pieces.push(hull([...circle(a, rad(a)), ...circle(b, rad(b))]));
    }
  }
  return pieces.length ? union(pieces) : null;
}

// Horizontal extent of a shape per horizontal band (y bin): [minX, maxX] or null.
function profile(shape, y0, bin, bins) {
  const out = Array.from({ length: bins }, () => null);
  for (const ring of shape) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.ceil(Math.abs(b.y - a.y) / (bin / 2)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const j = Math.floor((y - y0) / bin);
        if (j < 0 || j >= bins) continue;
        const cur = out[j];
        out[j] = cur ? [Math.min(cur[0], x), Math.max(cur[1], x)] : [x, x];
      }
    }
  }
  return out;
}

// Re-space letters by their new shapes: the closest horizontal approach between
// neighbours (band by band) becomes `gap`, the same for every pair.
function respace(letters, gap, bin, word) {
  const all = bbox(letters.flatMap((l) => l.shape));
  const bins = Math.ceil(all.height / bin) + 1;
  const out = [];
  let prevProfile = null, prevBox = null, shift = 0;
  for (const l of letters) {
    if (!l.shape.length) { out.push(l); continue; }
    const prof = profile(l.shape, all.minY, bin, bins);
    const box = bbox(l.shape);
    if (prevProfile) {
      let d = Infinity;
      for (let j = 0; j < bins; j++) {
        if (prof[j] && prevProfile[j]) d = Math.min(d, prof[j][0] - prevProfile[j][1]);
      }
      if (!Number.isFinite(d)) d = box.minX - prevBox.maxX; // no overlap in height
      shift = gap + (l.spaces ?? 0) * word - d;
    }
    const moved = shift ? mapPoints(l.shape, (p) => ({ x: p.x + shift, y: p.y })) : l.shape;
    const structure = shift && l.structure
      ? l.structure.map((st) => ({ ...st, points: st.points.map((p) => ({ ...p, x: p.x + shift })) }))
      : l.structure;
    const ml = { ...l, shape: moved, structure, x: l.x + shift };
    out.push(ml);
    prevProfile = profile(moved, all.minY, bin, bins);
    prevBox = bbox(moved);
    shift = 0;
  }
  return out;
}

// Skeletons are the slowest part of a plain piece and depend only on the glyph, where
// it sits and the pen, so they are kept per font: redrawing with other settings, or
// another title with the same letters in the same place, skips them. Results are
// shared, never mutated (every later step builds new letters).
const skeletons = new WeakMap();
const MAX_CACHED = 4000;
function cached(font, letter, settings, make) {
  if (!font || typeof font !== 'object') return make();
  let cache = skeletons.get(font);
  if (!cache) skeletons.set(font, (cache = new Map()));
  const first = letter.shape[0]?.[0];
  const key = `${letter.char}|${first?.x}|${first?.y}|${letter.shape.length}|${settings}`;
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size >= MAX_CACHED) cache.clear();
    const made = make();
    hit = { shape: made.shape, structure: made.structure };
    cache.set(key, hit);
  }
  return { ...letter, shape: hit.shape, structure: hit.structure };
}

/**
 * @param {number} spacing  gap between letters, in pens (plus the piece's `tracking`)
 * @param {number} words    extra gap per word space, in pens
 * @param {string} cap      pen ends: 'round' | 'square' | 'butt'
 * @param {string} join     pen corners: 'round' | 'miter' | 'square'
 * @param {number} follow   pen width follows the font's own stroke thickness (0 = even)
 * @param {number} pen    stroke width as a fraction of the cap height
 * @param {number} arm    branches sticking out less than this (× cap height) are dropped: serifs,
 *                        unless they are longer than `long` (× cap height)
 * @param {number} smooth smoothing passes on the centre lines
 */
export function applyStructure(letters, ctx, { pen = 0.17, arm = 0.12, long = 0.2, smooth = 8, clean = 0.15, spacing = 0.6, words = 3, cap = 'round', join = 'round', follow = 0 } = {}, tracking = 0) {
  const width = pen * ctx.metrics.capHeight;
  const settings = [ctx.size, ctx.stem, pen, arm, long, smooth, clean, cap, join, follow].join();
  const out = letters.map((letter) => cached(ctx.font, letter, settings, () => {
    // Only close hairline gaps; opening would delete thin hairlines (Playfair's e bar).
    const r = clean * ctx.stem;
    const src = r ? close(letter.shape, r) : letter.shape;
    const minArm = arm * ctx.metrics.capHeight;
    const strokes = skeleton(src.length ? src : letter.shape, {
      cell: ctx.stem / 8, minArm, keepLength: long * ctx.metrics.capHeight,
    });
    const lines = strokes.map((st) => {
      let pts = smoothLine(st.points, st.closed, smooth);
      // Keep the letter's extent: the glyph reached past its centre line by its
      // local half-thickness; the pen's round cap reaches width / 2.
      if (!st.closed) {
        if (st.free[0]) pts = extend(pts, true, pts[0].r - width / 2);
        if (st.free[1]) pts = extend(pts, false, pts.at(-1).r - width / 2);
      }
      return { points: simplify(pts, width * 0.04), closed: st.closed };
    });
    return { ...letter, shape: drawStructure(lines, width, { cap, join, follow }) || letter.shape, structure: lines };
  }));
  const redraw = (lines) => drawStructure(lines, width, { cap, join, follow });
  // Re-space each line on its own, then centre the lines again.
  const byLine = new Map();
  for (const l of out) (byLine.get(l.line ?? 0) ?? byLine.set(l.line ?? 0, []).get(l.line ?? 0)).push(l);
  const spaced = [...byLine.values()].flatMap((ls) => respace(ls, (spacing + tracking) * width, width / 3, words * width));
  return { letters: centerLines(spaced), stem: width, redraw };
}
