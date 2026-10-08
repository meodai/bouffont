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
import { area, bbox, close, difference, intersection, normalize, offset, open, signedArea, union } from '../geom/clip.js';
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

// Where letters cross, a letter can win part of its own slit or crease (it counts as
// covering those) that is cut back out at the end, leaving a hole that a neighbour
// really covers. Give such holes back to that neighbour, unless they are as narrow
// as a slit: those stay open, so no letter pokes a sliver into another one.
// Strips thinner than `r` that run along a neighbour (where seams meet) go to that
// neighbour, if its own growth covered them anyway: drawn as outlines, they would read
// as one letter's line bleeding into the other. A letter's own drawing is never moved.
function slivers(final, actual, cores, r) {
  if (!r) return final;
  const out = final.slice();
  const boxes = actual.map((s) => (s.length ? bbox(s) : null));
  const overlaps = (b, o) => o && o.minX <= b.maxX + r && o.maxX >= b.minX - r && o.minY <= b.maxY + r && o.maxY >= b.minY - r;
  for (let i = 0; i < out.length; i++) {
    if (!out[i].length) continue;
    const thin = difference(difference(out[i], open(out[i], r)), offset(cores[i], r * 0.5));
    for (const piece of patches(thin)) {
      const a = area(piece);
      if (a < (r * r) / 8) continue;
      const pb = bbox(piece);
      const around = offset(piece, r);
      let best = -1, bestTouch = 0;
      for (let j = 0; j < out.length; j++) {
        if (j === i || !out[j].length || !overlaps(pb, boxes[j])) continue;
        // Only where the neighbour's own growth reached: no letter gains new ground.
        if (area(intersection(piece, actual[j])) < a * 0.6) continue;
        const touch = area(intersection(around, out[j]));
        if (touch > bestTouch) { best = j; bestTouch = touch; }
      }
      if (best < 0) continue;
      out[i] = difference(out[i], piece);
      out[best] = union(out[best], intersection(piece, actual[best]));
    }
  }
  return out;
}

// Each letter's seams: the strip of it, `w` wide, along where it touches another letter.
// Render keeps inner and gap lines out of it, so a line that runs out through a letter's
// edge stops at a seam instead of crossing into the neighbour.
function withSeams(letters, w) {
  if (!w) return letters;
  const boxes = letters.map((l) => (l.shape.length ? bbox(l.shape) : null));
  return letters.map((l, i) => {
    if (!boxes[i]) return l;
    const b = boxes[i];
    const near = letters.filter((o, j) => j !== i && boxes[j] && boxes[j].minX <= b.maxX + w && boxes[j].maxX >= b.minX - w && boxes[j].minY <= b.maxY + w && boxes[j].maxY >= b.minY - w);
    if (!near.length) return l;
    const seams = intersection(offset(union(...near.map((o) => o.shape)), w), l.shape);
    return seams.length ? { ...l, seams } : l;
  });
}

function refill(final, actual, contested, r) {
  const ink = intersection(union(...actual), contested);
  const holes = open(difference(ink, union(...final)), r);
  if (!holes.length) return final;
  const out = final.slice();
  for (const piece of patches(holes)) {
    const around = offset(piece, r);
    let best = -1, bestTouch = -1;
    for (let i = 0; i < actual.length; i++) {
      if (!intersection(piece, actual[i]).length) continue;
      const touch = area(intersection(around, out[i]));
      if (touch > bestTouch) { best = i; bestTouch = touch; }
    }
    if (best >= 0) out[best] = union(out[best], intersection(piece, actual[best]));
  }
  return out;
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
    // Each letter works in its own window of the patch grid (aligned to it): a letter
    // can only win cells it covers, so its distances, field and trace stay local.
    const windows = new Map();
    for (const i of near) {
      const b = boxes[i];
      const i0 = Math.max(0, Math.floor((b.minX - g.x0) / cell) - 2), j0 = Math.max(0, Math.floor((b.minY - g.y0) / cell) - 2);
      const i1 = Math.min(g.cols - 1, Math.ceil((b.maxX - g.x0) / cell) + 2), j1 = Math.min(g.rows - 1, Math.ceil((b.maxY - g.y0) / cell) + 2);
      if (i1 <= i0 || j1 <= j0) continue;
      const w = { i0, j0, cols: i1 - i0 + 1, rows: j1 - j0 + 1, x0: g.x0 + i0 * cell, y0: g.y0 + j0 * cell, cell };
      const inPatch = scanFill(patch, w);
      const c = scanFill(shapes[i], w);
      let reaches = false;
      for (let k = 0; k < c.length && !reaches; k++) reaches = inPatch[k] && c[k];
      if (!reaches) continue;
      const seed = scanFill(own[i], w);
      const seeds = new Int32Array(c.length);
      for (let k = 0; k < c.length; k++) seeds[k] = seed[k] ? k : -1;
      const { dist2 } = nearestSeed(seeds, w.cols, w.rows);
      const d = new Float32Array(c.length);
      for (let k = 0; k < c.length; k++) d[k] = Math.sqrt(dist2[k]);
      windows.set(i, { ...w, covers: c, dist: d });
    }
    const covers = windows; // the letters that reach into this patch
    const EDGE = 2; // field values are clamped to ± this many cells
    // Everything below only looks at the neighbourhood of the patch.
    const zone = offset(patch, cell * 3);
    const local = new Map([...covers.keys()].map((i) => [i, intersection(own[i], zone)]));
    const seedIn = new Map([...local].map(([i, o]) => [i, intersection(o, patch)]));
    const allSeeds = union(...seedIn.values());
    let claimed = []; // in this patch, by earlier letters: blurred seams overlap a hair
    for (const [i, w] of [...windows].sort((x, y) => x[0] - y[0])) {
      const field = new Float32Array(w.covers.length);
      for (let y = 0; y < w.rows; y++) {
        for (let x = 0; x < w.cols; x++) {
          const k = y * w.cols + x;
          if (!w.covers[k]) { field[k] = -EDGE; continue; }
          // How much closer this letter is than the nearest rival covering the cell.
          const gi = w.i0 + x, gj = w.j0 + y;
          let best = EDGE;
          for (const [j, r] of windows) {
            if (j === i) continue;
            const rx = gi - r.i0, ry = gj - r.j0;
            if (rx < 0 || ry < 0 || rx >= r.cols || ry >= r.rows) continue;
            const rk = ry * r.cols + rx;
            if (!r.covers[rk]) continue;
            // Ties go to the earlier letter.
            best = Math.min(best, r.dist[rk] - w.dist[k] + (j < i ? -1e-3 : 1e-3));
          }
          field[k] = Math.max(-EDGE, Math.min(EDGE, best));
        }
      }
      // A light blur irons out the cell steps of the distances: straight seams stay straight.
      // Clip everything to this letter's window first: the patch can span many letters.
      const x1 = w.x0 + (w.cols - 1) * cell, y1 = w.y0 + (w.rows - 1) * cell;
      const rect = [[{ x: w.x0, y: w.y0 }, { x: x1, y: w.y0 }, { x: x1, y: y1 }, { x: w.x0, y: y1 }]];
      const here = (shape) => (shape.length ? intersection(shape, rect) : shape);
      let traced = intersection(contour(blur({ ...w, data: field }, 2), 0), here(patch));
      // Seeds are never up for grabs: the blur can smear a thin core away, so each
      // letter keeps its own seed and never takes another's.
      const mySeed = seedIn.get(i);
      const others = here(mySeed.length ? difference(allSeeds, mySeed) : allSeeds);
      if (others.length) traced = difference(traced, others);
      if (mySeed.length) traced = union(traced, mySeed);
      const taken = here(claimed);
      if (taken.length) traced = difference(traced, taken);
      // Keep only pieces attached to the letter's own body: no stray specks.
      const body = offset(local.get(i), cell * 1.5);
      const kept = patches(traced).filter((piece) => intersection(piece, body).length).flat();
      won[i].push(...kept);
      claimed = claimed.length ? union(claimed, kept) : kept;
    }
    // Whatever no letter took (specks, blurred edges): give each leftover piece to the
    // covering letter it touches most, so repel never opens holes.
    const ids = [...covers.keys()];
    const left = claimed.length ? difference(patch, claimed) : patch;
    const mine = new Map(); // each letter's area around this patch, built when first needed
    const mineOf = (i) => mine.get(i) ?? mine.set(i, union(won[i], intersection(difference(shapes[i], contested), zone))).get(i);
    for (const piece of patches(left)) {
      const around = offset(piece, cell * 2);
      let best = -1, bestTouch = -1;
      for (const i of ids) {
        if (!intersection(piece, shapes[i]).length) continue;
        const touch = area(intersection(around, mineOf(i)));
        if (touch > bestTouch) { best = i; bestTouch = touch; }
      }
      if (best >= 0) won[best].push(...intersection(piece, shapes[best]));
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

export function repel(letters, ctx, { step = 0.1, seam = 0.35, maxSteps = 40, slit = 0.3, method = 'grid', cell = 0.08, sliver = 0.35, seamWidth = 0.3 } = {}) {
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
    const split = refill(letters.map((l, i) => intersection(own[i], actual[i])), actual, contested, slit * ctx.stem);
    const done = slivers(split, actual, letters.map((l) => l.core ?? []), sliver * ctx.stem);
    return withSeams(letters.map((l, i) => ({ ...l, shape: done[i] })), seamWidth * ctx.stem);
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
  return withSeams(letters.map((l, i) => ({ ...l, shape: intersection(own[i], actual[i]) })), seamWidth * ctx.stem);
}
