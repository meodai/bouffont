// Rebuild outlines from straight edges at fixed angles (0/45/90° by default):
// the "simples" / TUSK look. Every simplified edge becomes an elbow of two snapped
// segments; which side the elbow bulges to decides if the letter grows or shrinks.
import { contains, normalize } from '../geom/clip.js';
import { simplify } from '../geom/path.js';

function elbow(a, b, step) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ang = Math.atan2(dy, dx);
  const lo = Math.floor(ang / step) * step;
  const hi = lo + step;
  // Solve a + s*d1 + t*d2 = b for the two neighbouring snapped directions.
  const d1 = { x: Math.cos(lo), y: Math.sin(lo) };
  const d2 = { x: Math.cos(hi), y: Math.sin(hi) };
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const s = (dx * d2.y - dy * d2.x) / det;
  return [
    { x: a.x + s * d1.x, y: a.y + s * d1.y }, // go along d1 first
    { x: b.x - s * d1.x, y: b.y - s * d1.y }, // or along d2 first
  ];
}

export function angular(letters, ctx, { detail = 0.5, angles = 8, bulge = 'out', tolerance = 4 } = {}) {
  const step = (Math.PI * 2) / angles;
  const tol = (tolerance * Math.PI) / 180;
  return letters.map((letter) => {
    const rings = letter.shape.map((ring) => {
      const simple = simplify(ring, detail * ctx.stem);
      const out = [];
      simple.forEach((a, i) => {
        const b = simple[(i + 1) % simple.length];
        out.push(a);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const off = Math.abs(ang / step - Math.round(ang / step)) * step;
        if (off < tol) return; // already on-grid
        const options = elbow(a, b, step);
        if (!options) return;
        let pick;
        if (bulge === 'random') pick = options[ctx.rng() < 0.5 ? 0 : 1];
        else {
          const outside = options.map((p) => !contains(letter.shape, p));
          const want = bulge === 'out';
          pick = outside[0] === want ? options[0] : outside[1] === want ? options[1] : options[0];
        }
        out.push(pick);
      });
      return out;
    });
    return { ...letter, shape: normalize(rings) };
  });
}
