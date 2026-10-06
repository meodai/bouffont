// Alignment lines that growth cannot cross. 'bottom' stands the letters on a common
// line (the baseline, or the envelope's bottom edge), 'top' hangs them from one,
// 'both' does both, 'middle' (default) lets them grow freely.
import { bbox, normalize, union } from './geom/clip.js';

// Region beyond a left-to-right polyline, on the side of `dir` (1 = below, -1 = above).
function beyond(line, dir, far) {
  const first = line[0], last = line[line.length - 1];
  return normalize([[
    { x: first.x - far, y: first.y },
    ...line,
    { x: last.x + far, y: last.y },
    { x: last.x + far, y: last.y + dir * far },
    { x: first.x - far, y: first.y + dir * far },
  ]]);
}

/**
 * @param {string} align   'middle' | 'bottom' | 'top' | 'both'
 * @param {object} edges   { top, bottom } polylines from the envelope, or null
 * @param {Array} letters  laid-out letters (used when there is no envelope)
 */
export function alignBarrier(align = 'middle', edges, letters, { capHeight, size, lastBaseline = 0 }) {
  if (align === 'middle' || !letters.length) return null;
  let lines = edges;
  if (!lines) {
    // No envelope: the last line's baseline and the first line's cap height.
    const b = bbox(letters.flatMap((l) => l.shape));
    lines = {
      top: [{ x: b.minX, y: -capHeight }, { x: b.maxX, y: -capHeight }],
      bottom: [{ x: b.minX, y: lastBaseline }, { x: b.maxX, y: lastBaseline }],
    };
  }
  const far = size * 20;
  const parts = [];
  if (align === 'bottom' || align === 'both') parts.push(beyond(lines.bottom, 1, far));
  if (align === 'top' || align === 'both') parts.push(beyond(lines.top, -1, far));
  if (!parts.length) throw new Error(`bouffont: unknown align "${align}"`);
  return union(...parts);
}
