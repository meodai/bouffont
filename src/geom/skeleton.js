// Centre lines of a glyph, with the local half-thickness at every point.
//
// 1. Rasterise the shape on a grid and measure each inside cell's distance to the
//    outline (that distance is half the stroke thickness when the cell is central).
// 2. Thin the grid to one-cell-wide lines (Zhang–Suen).
// 3. Turn the pixels into a graph, prune short spurs (serifs, corners), and join
//    branches that continue smoothly through junctions into long strokes.
//
// Returns strokes as [{ points: [{ x, y, r }], closed, free: [startFree, endFree] }].
import { bbox } from './clip.js';
import { distanceToOutside, scanFill } from './grid.js';

const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function zhangSuen(img, cols, rows) {
  const at = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : img[j * cols + i]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (!img[j * cols + i]) continue;
          // p2..p9 clockwise from north
          const p = [at(i, j - 1), at(i + 1, j - 1), at(i + 1, j), at(i + 1, j + 1),
            at(i, j + 1), at(i - 1, j + 1), at(i - 1, j), at(i - 1, j - 1)];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          remove.push(j * cols + i);
        }
      }
      for (const k of remove) img[k] = 0;
      if (remove.length) changed = true;
    }
  }
}

const lengthOf = (pts) =>
  pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

export function skeleton(shape, { cell, prune = 1.1, minArm = null, keepLength = Infinity }) {
  if (!shape?.length) return [];
  const b = bbox(shape);
  const cols = Math.ceil(b.width / cell) + 3;
  const rows = Math.ceil(b.height / cell) + 3;
  const x0 = b.minX - cell, y0 = b.minY - cell;
  const pos = (k) => ({ x: x0 + (k % cols) * cell, y: y0 + Math.floor(k / cols) * cell });

  // Inside cells (scanline fill) and their distance to the outline (exact distance
  // transform; the outline lies half a cell beyond the nearest outside cell centre).
  const img = scanFill(shape, { x0, y0, cell, cols, rows });
  const d2 = distanceToOutside(img, cols, rows);
  const dist = new Float32Array(cols * rows);
  for (let k = 0; k < img.length; k++) if (img[k]) dist[k] = Math.max(cell * 0.5, (Math.sqrt(d2[k]) - 0.5) * cell);
  zhangSuen(img, cols, rows);

  const on = (k) => img[k] === 1;
  const neighbours = (k) => {
    const i = k % cols, j = (k - i) / cols, out = [];
    for (const [di, dj] of N8) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < cols && nj < rows && on(nj * cols + ni)) out.push(nj * cols + ni);
    }
    return out;
  };

  // Nodes: endpoints (1 neighbour) and junction pixels (3+), junction clusters merged.
  const pixels = [];
  for (let k = 0; k < img.length; k++) if (on(k)) pixels.push(k);
  const degree = new Map(pixels.map((k) => [k, neighbours(k).length]));
  const nodeOf = new Map();
  let nodeCount = 0;
  for (const k of pixels) {
    const d = degree.get(k);
    if (d === 2 || nodeOf.has(k)) continue;
    const id = nodeCount++;
    const stack = [k];
    nodeOf.set(k, id);
    while (stack.length && d !== 1) {
      const q = stack.pop();
      for (const n of neighbours(q)) {
        if (!nodeOf.has(n) && degree.get(n) >= 3) { nodeOf.set(n, id); stack.push(n); }
      }
    }
  }

  // Edges: walk from each node pixel along degree-2 pixels to the next node.
  const edges = [];
  const used = new Set();
  const key = (a, c) => (a < c ? `${a}:${c}` : `${c}:${a}`);
  for (const start of pixels) {
    if (!nodeOf.has(start)) continue;
    for (const first of neighbours(start)) {
      if (used.has(key(start, first)) || nodeOf.get(first) === nodeOf.get(start)) continue;
      const path = [start];
      let prev = start, cur = first;
      used.add(key(prev, cur));
      while (!nodeOf.has(cur)) {
        path.push(cur);
        const options = neighbours(cur).filter((n) => n !== prev && !path.includes(n) && !used.has(key(cur, n)));
        // Reaching any junction pixel ends the branch (junction clusters can be wide,
        // so the next pixel along may already belong to one); never step back into
        // the node it started from right away.
        const node = options.find((n) => nodeOf.has(n) && (path.length > 2 || nodeOf.get(n) !== nodeOf.get(start)));
        const next = node ?? options.find((n) => !nodeOf.has(n));
        if (next == null) break;
        used.add(key(cur, next));
        prev = cur;
        cur = next;
      }
      path.push(cur);
      if (nodeOf.has(cur)) edges.push({ a: nodeOf.get(start), b: nodeOf.get(cur), path });
    }
  }
  // Loops without any node (an O): pixels never visited.
  const visited = new Set(edges.flatMap((e) => e.path));
  const loops = [];
  for (const k of pixels) {
    if (visited.has(k) || nodeOf.has(k)) continue;
    const path = [k];
    visited.add(k);
    let cur = k;
    for (;;) {
      const next = neighbours(cur).find((n) => !visited.has(n));
      if (next == null) break;
      visited.add(next);
      path.push(next);
      cur = next;
    }
    if (path.length > 4) loops.push(path);
  }

  const toPoints = (path) => path.map((k) => ({ ...pos(k), r: dist[k] }));
  let strokes = edges.map((e) => ({ a: e.a, b: e.b, points: toPoints(e.path) }));

  const degrees = () => {
    const deg = new Map();
    for (const s of strokes) { deg.set(s.a, (deg.get(s.a) ?? 0) + 1); deg.set(s.b, (deg.get(s.b) ?? 0) + 1); }
    return deg;
  };

  // Prune spurs (branches with one free end). With `minArm` the decision looks at the
  // junction a spur hangs on:
  // - where a stroke *ends* and forks into a similar pair of short spurs, the pair is a
  //   serif or the corners of a square terminal: drop it;
  // - where a stroke runs *through* (f's crossbar), short spurs are real parts: keep
  //   them unless they barely stick out;
  // - otherwise (an r's arm) keep a spur if it sticks out at least `minArm`.
  // Nodes where exactly two strokes meet are not junctions (thinning leaves those
  // along strokes): join them into one, so a spur is always a whole branch.
  const mergeChains = () => {
    for (let changed = true; changed;) {
      changed = false;
      const deg = degrees();
      for (const [node, d] of deg) {
        if (d !== 2) continue;
        const two = strokes.filter((st) => st.a === node || st.b === node);
        if (two.length !== 2) continue; // a loop through itself
        const [A, B] = two;
        const aPts = A.b === node ? A.points : [...A.points].reverse();
        const bPts = B.a === node ? B.points : [...B.points].reverse();
        const joined = { a: A.b === node ? A.a : A.b, b: B.a === node ? B.b : B.a, points: [...aPts, ...bPts.slice(1)] };
        strokes = strokes.filter((st) => st !== A && st !== B);
        strokes.push(joined);
        changed = true;
        break;
      }
    }
  };

  for (let round = 0; round < 4; round++) {
    mergeChains();
    const deg = degrees();
    const isSpur = (st) => (deg.get(st.a) === 1) !== (deg.get(st.b) === 1);
    const info = (st) => {
      const freeA = deg.get(st.a) === 1;
      const attach = freeA ? st.points[st.points.length - 1] : st.points[0];
      const tip = freeA ? st.points[0] : st.points[st.points.length - 1];
      const len = lengthOf(st.points);
      return { node: freeA ? st.b : st.a, len, protrude: len + tip.r - attach.r, attachR: attach.r, tipR: tip.r };
    };
    if (minArm == null) {
      strokes = strokes.filter((st) => !isSpur(st) || info(st).len > prune * info(st).attachR);
      continue;
    }
    const byNode = new Map();
    strokes.forEach((st) => {
      for (const n of [st.a, st.b]) (byNode.get(n) ?? byNode.set(n, []).get(n)).push(st);
    });
    const drop = new Set();
    for (const [node, list] of byNode) {
      if (deg.get(node) < 2) continue;
      let spurs = list.filter((st) => isSpur(st) && info(st).node === node && info(st).len < keepLength);
      let main = list.length - spurs.length;
      // A spur that continues a main stroke straight (the stub of a t above its
      // crossbar) makes this a through-junction: count it as main.
      const away = (st) => {
        const pts = st.a === node ? st.points : [...st.points].reverse();
        const q = pts[Math.min(pts.length - 1, 5)], p = pts[0];
        const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
      };
      const mains = list.filter((st) => !spurs.includes(st));
      const through = spurs.filter((sp) => mains.some((m) => {
        const a = away(sp), b = away(m);
        return a.x * b.x + a.y * b.y < -0.85;
      }));
      if (through.length) { spurs = spurs.filter((st) => !through.includes(st)); main += through.length; }
      if (!spurs.length) continue;
      if (main === 1 && spurs.length >= 2) {
        const lens = spurs.map((st) => info(st).len).sort((x, y) => x - y);
        // A serif / square-terminal fork is short compared with the stroke's width and
        // tapers to thin tips; a t's crossbar arms keep their thickness to the end.
        const short = spurs.every((st) => {
          const f = info(st);
          return f.len < 2.5 * f.attachR && f.tipR < 0.6 * f.attachR;
        });
        if (short && lens.at(-1) < lens[0] * 2.5) { spurs.forEach((st) => drop.add(st)); continue; }
      }
      const need = main >= 2 ? minArm * 0.4 : minArm;
      for (const st of spurs) if (info(st).protrude < need) drop.add(st);
    }
    if (!drop.size) break;
    strokes = strokes.filter((st) => !drop.has(st));
  }

  // Join strokes through junctions where they continue most straight.
  const dirAt = (s, atStart) => {
    const pts = s.points, n = Math.min(pts.length - 1, 4);
    const [p, q] = atStart ? [pts[0], pts[n]] : [pts[pts.length - 1], pts[pts.length - 1 - n]];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / len, y: (q.y - p.y) / len }; // pointing away from the node
  };
  let merged = true;
  while (merged) {
    merged = false;
    const ends = new Map();
    strokes.forEach((s, i) => {
      if (s.a === s.b) return;
      (ends.get(s.a) ?? ends.set(s.a, []).get(s.a)).push([i, true]);
      (ends.get(s.b) ?? ends.set(s.b, []).get(s.b)).push([i, false]);
    });
    for (const [, list] of ends) {
      if (list.length < 2) continue;
      let best = null;
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const [i, si] = list[x], [j, sj] = list[y];
          if (i === j) continue;
          const di = dirAt(strokes[i], si), dj = dirAt(strokes[j], sj);
          const straight = -(di.x * dj.x + di.y * dj.y); // 1 = perfectly straight through
          if (!best || straight > best.straight) best = { straight, i, si, j, sj };
        }
      }
      // Two branches always join; at real junctions only fairly straight pairs.
      if (!best || (list.length > 2 && best.straight < 0.5)) continue;
      const A = strokes[best.i], B = strokes[best.j];
      const aPts = best.si ? [...A.points].reverse() : A.points; // ends at node
      const bPts = best.sj ? B.points : [...B.points].reverse(); // starts at node
      const joined = { a: best.si ? A.b : A.a, b: best.sj ? B.b : B.a, points: [...aPts, ...bPts.slice(1)] };
      strokes = strokes.filter((_, k) => k !== best.i && k !== best.j);
      strokes.push(joined);
      merged = true;
      break;
    }
  }

  const deg = degrees();
  // Tiny closed loops are thinning leftovers, not counters.
  const realLoop = (pts) => lengthOf(pts) > Math.PI * (pts.reduce((m, p) => m + p.r, 0) / pts.length);
  strokes = strokes.filter((st) => st.a !== st.b || realLoop(st.points));
  return [
    ...strokes.map((s) => ({
      points: s.points,
      closed: s.a === s.b && deg.get(s.a) === 2,
      free: [deg.get(s.a) === 1, deg.get(s.b) === 1],
    })),
    ...loops.filter((path) => realLoop(toPoints(path))).map((path) => ({ points: toPoints(path), closed: true, free: [false, false] })),
  ];
}
