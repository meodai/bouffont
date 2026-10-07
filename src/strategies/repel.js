// Letters repel each other inside the growth: wherever two letters claim the same
// area, it is split fairly between them, as if both had grown into it at the same
// speed and pushed against each other. The result is a shared seam instead of one
// letter sliding under the other. Letters do not move.
//
// Each letter's `core` (its shape before growth) seeds a territory, and whichever
// territory reaches a spot first keeps it. Two methods:
// - 'grid' (default): distances on a small grid per contested patch; the seam is
//   traced where two letters are equally close, smooth without a smoothing pass.
// - 'grow': territories grow in small polygon steps (`step`), then the stair-steps on
//   the seams are smoothed (`seam`). Slower; seams run a little straighter.
//
// The split works on each letter's filled outline (counters and crease slits closed),
// then each letter's own slits are cut back out. Otherwise a neighbour would claim a
// slit as free space and poke a sliver into the letter.
import { area, bbox, close, difference, intersection, normalize, offset, signedArea, union } from '../geom/clip.js';
import { smoothRing } from '../geom/path.js';
import { blur, contour, makeGrid } from '../geom/raster.js';
import { nearestSeed, scanFill } from '../geom/grid.js';

// Grow territories into the unclaimed part of `contested`, one step at a time.
function fill(own, shapes, contested, delta, maxSteps) {
  for (let k = 0; k < maxSteps; k++) {
    const open = difference(contested, union(...own));
    if (area(open) < delta * delta * 0.25) break;
    const grabs = own.map((o, i) => intersection(intersection(offset(o, delta), shapes[i]), open));
    let grew = false;
    own = own.map((o, i) => {
      // Ties within one step go to the earlier letter.
      const gained = difference(grabs[i], union(...grabs.slice(0, i)));
      if (!gained.length) return o;
      grew = true;
      return union(o, gained);
    });
    if (!grew) break;
  }
  return own;
}

// Outer rings only (counters filled), with thin slits closed.
function filled(shape, r) {
  if (!shape.length) return shape;
  const largest = shape.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const sign = Math.sign(signedArea(largest));
  return close(union(shape.filter((ring) => Math.sign(signedArea(ring)) === sign)), r);
}

// The same split on a grid (method: 'grid'): every contested cell goes to the letter
// whose own area is nearest, as if all grew at the same speed (straight-line
// distance, not around corners). The seam is traced where two distances are equal,
// between cells, so it comes out smooth without a smoothing pass. Each contested
// patch gets its own small grid, with only the letters that reach into it.
function splitOnGrid(own, shapes, contested, cell) {
  const won = own.map(() => []);
  const boxes = shapes.map((s) => bbox(s));
  for (const patch of patches(contested)) {
    const pb = bbox(patch);
    const near = [];
    for (let i = 0; i < shapes.length; i++) {
      const b = boxes[i];
      if (b.minX <= pb.maxX && b.maxX >= pb.minX && b.minY <= pb.maxY && b.maxY >= pb.minY) near.push(i);
    }
    const g = makeGrid(patch, cell, cell * 3);
    const { cols, rows } = g;
    const size = cols * rows;
    const inPatch = scanFill(patch, g);
    const covers = new Map(), dist = new Map();
    for (const i of near) {
      const c = scanFill(shapes[i], g);
      let reaches = false;
      for (let k = 0; k < size && !reaches; k++) reaches = inPatch[k] && c[k];
      if (!reaches) continue;
      covers.set(i, c);
      const seed = scanFill(own[i], g);
      const seeds = new Int32Array(size);
      for (let k = 0; k < size; k++) seeds[k] = seed[k] ? k : -1;
      const { dist2 } = nearestSeed(seeds, cols, rows);
      const d = new Float32Array(size);
      for (let k = 0; k < size; k++) d[k] = Math.sqrt(dist2[k]);
      dist.set(i, d);
    }
    const EDGE = 2; // field values are clamped to ± this many cells
    let claimed = []; // in this patch, by earlier letters: blurred seams overlap a hair
    for (const [i, ci] of [...covers].sort((a, b) => a[0] - b[0])) {
      const di = dist.get(i), field = new Float32Array(size);
      for (let k = 0; k < size; k++) {
        if (!ci[k]) { field[k] = -EDGE; continue; }
        // How much closer this letter is than the nearest rival covering the cell.
        let best = EDGE;
        for (const [j, cj] of covers) {
          if (j === i || !cj[k]) continue;
          // Ties go to the earlier letter.
          best = Math.min(best, dist.get(j)[k] - di[k] + (j < i ? -1e-3 : 1e-3));
        }
        field[k] = Math.max(-EDGE, Math.min(EDGE, best));
      }
      // A light blur irons out the cell steps of the distances: straight seams stay straight.
      let traced = intersection(contour(blur({ ...g, data: field }, 2), 0), patch);
      if (claimed.length) traced = difference(traced, claimed);
      // Keep only pieces attached to the letter's own body: no stray specks.
      const body = offset(own[i], cell * 1.5);
      const kept = patches(traced).filter((piece) => intersection(piece, body).length).flat();
      won[i].push(...kept);
      claimed = claimed.length ? union(claimed, kept) : kept;
    }
  }
  return own.map((o, i) => (won[i].length ? union(difference(shapes[i], contested), intersection(won[i], shapes[i])) : difference(shapes[i], contested)));
}

// Split a shape into its separate parts (each outer ring with the holes inside it).
function patches(shape) {
  if (!shape.length) return [];
  const largest = shape.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const sign = Math.sign(signedArea(largest));
  const outers = shape.filter((r) => Math.sign(signedArea(r)) === sign);
  if (outers.length === 1) return [shape];
  return outers.map((r) => intersection(shape, [r])).filter((p) => p.length);
}

export function repel(letters, ctx, { step = 0.1, seam = 0.35, maxSteps = 40, slit = 0.3, method = 'grid', cell = 0.08 } = {}) {
  if (letters.length < 2) return letters;
  const actual = letters.map((l) => l.shape);
  const shapes = actual.map((s) => filled(s, slit * ctx.stem));
  const n = shapes.length;

  // Area claimed by more than one letter.
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const both = intersection(shapes[i], shapes[j]);
      if (both.length) pairs.push(both);
    }
  }
  if (!pairs.length) return letters;
  const contested = union(...pairs);
  const delta = step * ctx.stem;

  // Start: what each letter owns alone, plus its core inside the contested area.
  const seeds = letters.map((l, i) => intersection(intersection(l.core ?? l.shape, shapes[i]), contested));
  let own = shapes.map((s, i) => {
    // Cores may overlap too (negative tracking). Splitting those would eat into the
    // letters' skeletons, so there the earlier letter keeps its core whole.
    const taken = union(...seeds.slice(0, i));
    return union(difference(s, contested), difference(seeds[i], taken));
  });
  if (method === 'grid') {
    own = splitOnGrid(own, shapes, contested, cell * ctx.stem);
    return letters.map((l, i) => ({ ...l, shape: intersection(own[i], actual[i]) }));
  }
  own = fill(own, shapes, contested, delta, maxSteps);

  if (seam) {
    // Smooth each territory, but only take the result inside the contested area.
    // No corner pinning: the stair-steps of the fill are right angles too.
    const radius = seam * ctx.stem;
    const smoothed = own.map((o) => normalize(o.map((ring) => smoothRing(ring, { radius, corner: Math.PI }))));
    own = own.map((o, i) => {
      const inside = intersection(intersection(smoothed[i], shapes[i]), contested);
      return union(difference(o, contested), inside);
    });
    // Smoothed neighbours overlap a little along each seam: earlier letter wins…
    own = own.map((o, i) => (i ? difference(o, intersection(union(...own.slice(0, i)), contested)) : o));
    // …and the thin gaps left over are filled again.
    own = fill(own, shapes, contested, delta / 2, 6);
  }
  // Cut each letter's own counters and slits back out of its territory.
  return letters.map((l, i) => ({ ...l, shape: intersection(own[i], actual[i]) }));
}
