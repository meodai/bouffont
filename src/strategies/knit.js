// Close the narrow gaps a painter would never leave between letters: slivers between
// neighbours and V-notches where two letters meet at the silhouette. Only gaps that
// touch two or more letters count; a letter's own crease slits stay open. Each gap
// is given to the letters next to it (overlaps are settled by stacking or `repel`).
import { area, close, difference, intersection, offset, union } from '../geom/clip.js';

export function knit(letters, ctx, { gap = 0.25 } = {}) {
  const r = gap * ctx.stem;
  if (!r || letters.length < 2) return letters;
  const all = union(...letters.map((l) => l.shape));
  const gaps = difference(close(all, r), all);
  if (!gaps.length) return letters;
  const reach = letters.map((l) => offset(l.shape, r * 1.2));
  const adds = letters.map(() => []);
  for (const ring of gaps) {
    const piece = [ring];
    const size = area(piece);
    const shares = reach.map((z) => intersection(piece, z));
    const touching = shares.map((sh, i) => [i, area(sh)]).filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1]);
    // Between letters only if the second letter borders a real part of the gap; a
    // letter's own slit that merely ends near a neighbour stays open.
    if (touching.length < 2 || touching[1][1] < size * 0.3) continue;
    for (const [i] of touching) adds[i].push(...shares[i]);
  }
  return letters.map((l, i) => (adds[i].length ? { ...l, shape: union(l.shape, adds[i]) } : l));
}
