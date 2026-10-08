// Black & white SVG output.
import { area, bbox, close, contains, difference, offset, signedArea, union } from './geom/clip.js';
import { shapeToCurveData, shapeToPathData, simplify, smoothRing } from './geom/path.js';
import { skeleton } from './geom/skeleton.js';
import { meetLines } from './geom/features.js';
import { hashSeed } from './rng.js';
import { smoothLine } from './structure.js';

const DEFAULTS = {
  mode: 'stack', // 'stack' | 'merge'
  order: 'ltr', // which letter is on top: 'ltr' | 'rtl' | 'center' | 'edges' | 'random'
  stroke: 0.14, // line thickness, in stems
  outline: 0, // outer outline band around the whole piece, in stems
  invert: false,
  background: null,
  padding: 0.6, // in stems
  // Draw outlines as smooth curves through few points instead of polylines.
  // `curves` is the simplification tolerance in stems; 0 (default) draws raw polygons.
  // `fair` irons out lumps up to this size (stems) before fitting the curves.
  curves: 0,
  fair: 0,
  corners: 56, // points turning more than this (degrees) stay sharp in the curves
  // Gaps inside a letter narrower than 2× this (stems): two outlines running side by
  // side. 'line' (default) closes the gap and draws one line along its middle, the
  // outline's width; 'ink' fills it solid. `ink: 0` leaves gaps alone.
  ink: 0, // off: narrow gaps stay open (try 0.4)
  gaps: 'line',
  // Inner lines on structured letters: minimum length in stems; 0 turns them off.
  inner: 0.5,
  // How inner and gap lines are drawn: smooth curves, or snapped to `angles`
  // directions (8 = 0/45/90°); `cap` 'round' | 'square' | 'butt'.
  lines: { angles: null, cap: 'round' },
};

// Centre lines of a gap region, as smooth polylines reaching the gap's ends.
function gapLines(region, cell, minLength) {
  const out = [];
  const len = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
  let all = skeleton(region, { cell, prune: 1.5 });
  // One gap, one line: keep its main open line; loops only when there is nothing else.
  const open = all.filter((t) => !t.closed);
  if (open.length) all = open;
  const longest = Math.max(0, ...all.map((st) => len(st.points)));
  for (const st of all.filter((t) => len(t.points) >= Math.max(longest * 0.8, minLength))) {
    let pts = smoothLine(st.points, st.closed, 4);
    if (!st.closed && pts.length > 1) {
      // Reach the gap's tips: extend free ends by the local half-width.
      const ext = (p, q) => {
        const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
        return { x: p.x + ((p.x - q.x) / len) * p.r, y: p.y + ((p.y - q.y) / len) * p.r, r: p.r };
      };
      const n = pts.length;
      if (st.free[0]) pts = [ext(pts[0], pts[Math.min(3, n - 1)]), ...pts];
      if (st.free[1]) pts = [...pts, ext(pts[pts.length - 1], pts[Math.max(0, pts.length - 4)])];
    }
    pts = simplify(pts, cell * 0.5);
    if (pts.length > 1) out.push({ pts, closed: st.closed });
  }
  return out;
}

const fmt = (n) => Math.round(n * 100) / 100;

// An open/closed smooth curve through points (uniform Catmull–Rom as cubic beziers).
function curveData(pts, closed) {
  const n = pts.length;
  if (n < 3) return `M${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}${closed ? 'Z' : ''}`;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${fmt(p1.x + (p2.x - p0.x) / 6)} ${fmt(p1.y + (p2.y - p0.y) / 6)} ${fmt(p2.x - (p3.x - p1.x) / 6)} ${fmt(p2.y - (p3.y - p1.y) / 6)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return closed ? `${d}Z` : d;
}

// Snap a polyline to `angles` directions (over 360°): every segment becomes an elbow
// of the two nearest allowed directions, so it keeps its endpoints.
function snapData(pts, closed, angles, minLeg) {
  const step = (Math.PI * 2) / angles;
  const src = closed ? [...pts, pts[0]] : pts;
  const out = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const a = out[out.length - 1], b = src[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const ang = Math.atan2(dy, dx);
    const lo = Math.floor(ang / step) * step, hi = lo + step;
    const d1 = { x: Math.cos(lo), y: Math.sin(lo) }, d2 = { x: Math.cos(hi), y: Math.sin(hi) };
    const det = d1.x * d2.y - d1.y * d2.x;
    const t = Math.abs(det) < 1e-9 ? 0 : (dx * d2.y - dy * d2.x) / det;
    // The longer leg first reads as one dominant direction with a short kick.
    const s2 = Math.abs(det) < 1e-9 ? 0 : (d1.x * dy - d1.y * dx) / det;
    const mid = t >= s2 ? { x: a.x + d1.x * t, y: a.y + d1.y * t } : { x: a.x + d2.x * s2, y: a.y + d2.y * s2 };
    if (Math.min(t, s2) < minLeg) {
      // A tiny kick reads as jitter: go straight along the nearest direction instead.
      const dir = t >= s2 ? d1 : d2;
      const len = dx * dir.x + dy * dir.y;
      out.push({ x: a.x + dir.x * len, y: a.y + dir.y * len });
      continue;
    }
    out.push(mid, b);
  }
  return `M${out.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}${closed ? 'Z' : ''}`;
}

// Lines follow the piece's drawing rules: smooth curves by default; snapped to an
// angle palette for angular styles (`render.lines.angles`).
const lineData = ({ pts, closed }, style, sw, step = sw) => {
  if (style.angles) return snapData(simplify(pts, sw * 1.5), closed, style.angles, sw * 3);
  // Even out the line's own path (no kinks), keeping its curvature.
  const dense = [];
  const src = closed ? [...pts, pts[0]] : pts;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, r: 0 });
  }
  dense.push(src[src.length - 1]);
  const smooth = smoothLine(dense, closed, 6);
  return curveData(simplify(smooth, sw * 0.25), closed);
};

// Thin gaps of a shape: its counters and slits narrower than 2r.
function thinGaps(shape, r) {
  if (!r || !shape.length) return [];
  const largest = shape.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const sign = Math.sign(signedArea(largest));
  const outer = union(shape.filter((ring) => Math.sign(signedArea(ring)) === sign));
  const holes = difference(outer, shape);
  // Real counters stay open: holes that mostly survive shrinking by r. A hole that is
  // mostly thin (a sliver with one wide spot) collapses into a line as a whole.
  const counters = [];
  for (const ring of holes) {
    const hole = union([ring]);
    const kept = offset(offset(hole, -r), r);
    if (area(kept) >= area(hole) * 0.5) counters.push(...hole);
  }
  return difference(difference(close(outer, r), shape), counters);
}

export function render(letters, opts = {}, ctx) {
  const o = { ...DEFAULTS, ...opts };
  const ink = o.invert ? '#fff' : '#000';
  const paper = o.invert ? '#000' : '#fff';
  const sw = Math.max(0, o.stroke * ctx.stem);
  // Sampling step along lines: never 0, even with a hairline or no stroke.
  const step = Math.max(sw, ctx.stem * 0.05);
  // A draft (frames of live growth) is fills and outlines only: straight segments, no
  // inner or gap lines.
  const draft = !!o.draft;
  const tolerance = draft ? 0 : o.curves * ctx.stem;
  const fair = draft ? 0 : o.fair * ctx.stem;
  const corner = (o.corners * Math.PI) / 180;
  const pathData = (shape) => {
    if (tolerance) return shapeToCurveData(shape, { tolerance, smooth: fair, corner });
    // Straight drawing: fairing evens the edges, corners stay sharp.
    if (!fair) return shapeToPathData(shape);
    return shapeToPathData(shape.map((ring) => {
      const b = bbox([ring]);
      const radius = Math.min(fair, Math.min(b.width, b.height) * 0.15);
      return radius > 0.5 ? simplify(smoothRing(ring, { radius, corner, coarse: ctx.stem * 0.15 }), ctx.stem * 0.04) : ring;
    }));
  };
  // Fills and outlines are separate paths (data-part="fill" / "outline"), so they can be
  // styled or animated on their own; see `piece.dom()`.
  const fillStyle = `fill="${paper}" fill-rule="evenodd"`;
  const outlineStyle = `fill="none" stroke="${ink}" stroke-width="${round(sw)}" stroke-linejoin="round"`;
  const fillAndOutline = (d) => `<path data-part="fill" d="${d}" ${fillStyle}/><path data-part="outline" d="${d}" ${outlineStyle}/>`;
  const inkR = draft ? 0 : o.ink * ctx.stem;
  // A letter: its fill and outline, then the narrow gaps (one line each, or solid
  // ink), then its inner lines on top (clipped to the letter).
  const lines0 = { angles: null, cap: 'round', ...(o.lines ?? {}) };
  const lineStyle = `fill="none" stroke="${ink}" stroke-width="${round(sw)}" stroke-linecap="${lines0.cap}" stroke-linejoin="${lines0.angles ? 'miter' : 'round'}"`;
  // Inner lines of structured letters, from the final shape: where the swell from two
  // parts of the letter's centre lines meets across a gap.
  const innerOf = (l) => {
    if (draft || !o.inner || !l.structure?.length || !l.shape.length) return [];
    return meetLines(l.structure, l.core ?? l.shape, l.shape, {
      keep: sw, cell: ctx.stem / 5, minLength: o.inner * ctx.stem,
    });
  };
  // Clip ids must be unique across every piece on a page, yet the same piece must give
  // the same SVG: a placeholder, replaced by a hash of the finished markup below.
  const uid = '__UID__';
  let clipId = 0;
  // Effects (shine…) sit between the fill and the outline: inside the letter, under its line.
  // Effects (see effects.js): `kind` says how a shape is drawn.
  const thin = round(sw * 0.6);
  const effectPath = (e) => {
    const d = pathData(e.shape);
    if (e.kind === 'ink') return `<path data-part="${e.part}" d="${d}" fill="${ink}" fill-rule="evenodd"/>`;
    if (e.kind === 'line') return `<path data-part="${e.part}" d="${d}" fill="none" stroke="${ink}" stroke-width="${thin}" stroke-linejoin="round"/>`;
    return `<path data-part="${e.part}" d="${d}" fill="${paper}" stroke="${ink}" stroke-width="${thin}" stroke-linejoin="round"/>`;
  };
  const effectPaths = (list = []) => list.filter((e) => !e.layer || e.layer === 'over').map(effectPath).join('');
  const underPaths = (list = []) => list.filter((e) => e.layer === 'under').map(effectPath).join('');
  const topPaths = (list = []) => list.filter((e) => e.layer === 'top').map(effectPath).join('');
  // Effects behind every letter (extrusions): drawn first, so a side never covers the
  // front of the letter before it.
  const behindPaths = (list = []) => list.filter((e) => e.layer === 'behind').map(effectPath).join('');
  const letterPaths = (shape, inner = null, fx = []) => {
    let gaps = thinGaps(shape, inkR);
    let body = shape, extra = '';
    let gapPolys = [];
    if (gaps.length && o.gaps === 'line') {
      body = union(shape, gaps);
      gapPolys = gaps.flatMap((ring) => gapLines(union([ring]), ctx.stem / 10, Math.max(sw * 2, o.inner * ctx.stem)));
    } else if (gaps.length) {
      extra = `<path data-part="ink" d="${pathData(gaps)}" fill="${ink}" fill-rule="evenodd"/>`;
    }
    // Inner lines (polylines) are drawn with the same pen. Drop the ones that would
    // double a line already there: mostly on a gap line, or mostly running along the
    // outline (near the edge for most of their length).
    // Built only when there are inner lines to test.
    let inside, nearGap;
    const regions = () => {
      inside ??= offset(body, -sw * 1.2);
      nearGap ??= gaps.length ? offset(gaps, sw * 2) : [];
    };
    // A line crossing a neck (a G's mouth) touches the edge only at its ends; one
    // doubling an outline stays near it all along, so only the middle half is tested.
    const keepLine = (pts) => {
      const mid = pts.slice(Math.floor(pts.length * 0.25), Math.ceil(pts.length * 0.75));
      if (!mid.length) return true;
      regions();
      let edge = 0, gap = 0;
      for (const p of mid) {
        if (!contains(inside, p)) edge++;
        if (nearGap.length && contains(nearGap, p)) gap++;
      }
      return edge < mid.length * 0.7 && gap < mid.length * 0.5;
    };
    const dense = (pts) => {
      const out = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
        for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
      }
      out.push(pts[pts.length - 1]);
      return out;
    };
    const innerPolys = (inner ?? []).filter((pts) => pts.length > 1 && keepLine(dense(pts))).map((pts) => ({ pts, closed: false }));
    const lines = [...gapPolys, ...innerPolys];
    if (lines.length) {
      // Clip to the letter so lines meet its outline exactly.
      const id = `${uid}-${++clipId}`;
      extra += `<clipPath id="${id}"><path d="${pathData(body)}"/></clipPath>` +
        `<path data-part="lines" clip-path="url(#${id})" d="${lines.map((l) => lineData(l, lines0, sw, step)).join('')}" ${lineStyle}/>`;
    }
    const d = pathData(body);
    return `${underPaths(fx)}<path data-part="fill" d="${d}" ${fillStyle}/>${effectPaths(fx)}<path data-part="outline" d="${d}" ${outlineStyle}/>${topPaths(fx)}${extra}`;
  };

  let ordered = letters.filter((l) => l.shape.length);
  if (o.order === 'rtl') ordered = [...ordered].reverse();
  if (o.order === 'center' || o.order === 'edges') {
    // Distance from the middle; drawn far-to-near for 'center' (middle on top).
    const mid = (ordered.length - 1) / 2;
    const dist = (l, i) => Math.abs(i - mid);
    const ranked = ordered.map((l, i) => [dist(l, i), i, l]);
    ranked.sort((a, b) => (o.order === 'center' ? b[0] - a[0] : a[0] - b[0]) || a[1] - b[1]);
    ordered = ranked.map(([, , l]) => l);
  }
  if (o.order === 'random') {
    const rng = ctx.rng.fork('render-order');
    ordered = ordered.map((l) => [rng(), l]).sort((a, b) => a[0] - b[0]).map(([, l]) => l);
  }

  const body = [];
  const all = union(...ordered.map((l) => l.shape));
  // Extrusions reach past the letters: they count for the bounds and the outline band.
  const behindShapes = ordered.flatMap((l) => (l.effects ?? []).filter((e) => e.layer === 'behind' || e.layer === 'under').flatMap((e) => e.shape));
  const silhouette = behindShapes.length ? union(all, behindShapes) : all;
  let bounds = all;

  if (o.outline) {
    const reach = o.outline * ctx.stem + sw / 2;
    bounds = offset(silhouette, reach, { join: 'round' });
    // The outer outline: the silhouette stroked as wide as the band (so it can be
    // restyled like the letter outlines) and filled, so gaps between letters are ink too.
    body.push(`<path data-part="band" d="${pathData(silhouette)}" fill="${ink}" fill-rule="nonzero" stroke="${ink}" stroke-width="${round(reach * 2)}" stroke-linejoin="round"/>`);
  }

  // All letters' extrusions as one block per kind: sides that meet merge, no crossings.
  const merged = new Map();
  for (const e of ordered.flatMap((l) => (l.effects ?? []).filter((x) => x.layer === 'behind'))) {
    const key = `${e.part}|${e.kind}`;
    merged.set(key, merged.has(key) ? { ...e, shape: union(merged.get(key).shape, e.shape) } : e);
  }
  const behind = behindPaths([...merged.values()]);
  // Obstructions: what the letters grew around.
  if (ctx.obstacles?.length) {
    body.push(`<g data-part="obstructions"><path data-part="obstruction" d="${pathData(ctx.obstacles)}" fill="${paper}" stroke="${ink}" stroke-width="${round(sw)}" stroke-linejoin="round"/></g>`);
  }
  if (behind) body.push(`<g data-part="behind">${behind}</g>`);

  if (o.mode === 'merge') {
    body.push(`<g data-part="letter" data-index="all">${letterPaths(all, ordered.flatMap(innerOf), ordered.flatMap((l) => l.effects ?? []))}</g>`);
  } else {
    for (const l of ordered) {
      body.push(`<g data-part="letter" data-index="${l.index}" data-char="${escape(l.char)}">${letterPaths(l.shape, innerOf(l), l.effects)}</g>`);
    }
  }

  const extras = ordered.flatMap((l) => l.extras ?? []);
  for (const e of extras) body.push(`<g data-part="extra">${fillAndOutline(pathData(e))}</g>`);

  const b = bbox([...bounds, ...extras.flat(), ...behindShapes, ...(ctx.obstacles ?? [])]);
  const pad = o.padding * ctx.stem + sw;
  const vb = [b.minX - pad, b.minY - pad, b.width + pad * 2, b.height + pad * 2].map(round);
  const bg = o.background ? `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${o.background}"/>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">${bg}${body.join('')}</svg>`;
  return { svg: svg.replaceAll(uid, `bf${hashSeed(svg).toString(36)}`), width: vb[2], height: vb[3], viewBox: vb };
}

const round = (n) => Math.round(n * 100) / 100;
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
