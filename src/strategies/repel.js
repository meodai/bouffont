// Letters repel each other inside the growth: wherever two letters claim the same
// area, it is split fairly between them, as if both had grown into it at the same
// speed and pushed against each other. The result is a shared seam instead of one
// letter sliding under the other. Letters do not move.
//
// Each letter's `core` (its shape before growth) seeds a territory; territories grow
// in small steps through the contested area only, and whichever reaches a spot first
// keeps it. Stepping leaves stair-steps on the seams, so the seams are smoothed
// afterwards (only inside the contested area, the rest of the outline is untouched).
//
// The split works on each letter's filled outline (counters and crease slits closed),
// then each letter's own slits are cut back out. Otherwise a neighbour would claim a
// slit as free space and poke a sliver into the letter.
import { area, close, difference, intersection, normalize, offset, signedArea, union } from '../geom/clip.js';
import { smoothRing } from '../geom/path.js';

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

export function repel(letters, ctx, { step = 0.1, seam = 0.35, maxSteps = 40, slit = 0.3 } = {}) {
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
