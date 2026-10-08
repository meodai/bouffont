import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bouffont, bouffontLive, loadFont, measureFont, layout, geom, presets } from '../src/index.js';
import { runStrategies } from '../src/strategies/index.js';
import { createRng } from '../src/rng.js';
import { variableOffset } from '../src/geom/thickness.js';

const font = await loadFont(
  readFileSync(new URL('../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff', import.meta.url))
);

const ctxFor = (size = 200) => {
  const { metrics } = layout(font, 'O', { size });
  return { stem: metrics.stem, metrics, size, rng: createRng(1), envelope: null };
};

describe('effects', () => {
  it('puts a shine inside each letter, between its fill and its outline', () => {
    const piece = bouffont({ text: 'ob', font, seed: 1, preset: 'throwup', effects: [['shine', {}]] });
    for (const l of piece.letters) {
      const shine = l.effects.filter((e) => e.part === 'shine').flatMap((e) => e.shape);
      expect(shine.length).toBeGreaterThan(0);
      expect(geom.area(geom.difference(shine, l.shape))).toBeLessThan(1);
    }
    expect(piece.svg).toMatch(/data-part="fill"[^>]*\/><path data-part="shine"[^>]*\/>(<path data-part="shine"[^>]*\/>)*<path data-part="outline"/);
    expect(() => bouffont({ text: 'a', font, effects: ['nope'] })).toThrow(/unknown effect/);
  });

  it('draws shade and inline inside the letters, depth behind all of them', () => {
    const effects = [['depth', {}], ['shade', {}], ['inline', {}]];
    const piece = bouffont({ text: 'ob', font, seed: 1, preset: 'throwup', effects });
    for (const l of piece.letters) {
      for (const e of l.effects.filter((x) => x.layer !== 'behind')) {
        expect(geom.area(geom.difference(e.shape, l.shape))).toBeLessThan(1);
      }
    }
    // One merged block of depth, before (behind) every letter; the drawing grows to fit it.
    expect(piece.svg.match(/data-part="depth"/g)).toHaveLength(1);
    expect(piece.svg.indexOf('data-part="depth"')).toBeLessThan(piece.svg.indexOf('data-part="letter"'));
    expect(piece.svg).toMatch(/data-part="shade"[^>]*fill="#000"/);
    const plain = bouffont({ text: 'ob', font, seed: 1, preset: 'throwup' });
    expect(piece.width).toBeGreaterThan(plain.width);
  });

  it('can give every letter its own depth, stacked with it', () => {
    const piece = bouffont({ text: 'ob', font, seed: 1, preset: 'throwup', effects: [['depth', { merge: false }]] });
    // One side per letter, inside the letter's group, before its fill.
    expect(piece.svg.match(/data-part="depth"/g)).toHaveLength(2);
    expect(piece.svg).toMatch(/data-part="letter"[^>]*><path data-part="depth"[^>]*\/><path data-part="fill"/);
  });
});

describe('live growth', () => {
  it('ends exactly where bouffont() does, for every preset', () => {
    for (const preset of Object.keys(presets)) {
      const opts = { text: 'ab', font, seed: 4, preset };
      const live = bouffontLive(opts);
      let frames = 0;
      while (live.step()) {
        expect(live.svg).toMatch(/^<svg/);
        frames++;
      }
      expect(frames).toBeGreaterThan(1);
      expect(live.step()).toBe(false);
      expect(live.final().svg).toBe(bouffont(opts).svg);
    }
  });

  it('can finish at any point', () => {
    const opts = { text: 'ab', font, seed: 4, preset: 'coral' };
    const live = bouffontLive(opts);
    live.step();
    expect(live.final().svg).toBe(bouffont(opts).svg);
  });
});

describe('measureFont', () => {
  it('measures the stem as a sensible fraction of the cap height', () => {
    const m = measureFont(font, 200);
    expect(m.stem).toBeGreaterThan(20);
    expect(m.stem).toBeLessThan(m.capHeight / 2);
    expect(m.contrast).toBeGreaterThan(0);
    expect(m.contrast).toBeLessThanOrEqual(1);
  });
});

describe('bouffont', () => {
  it('is deterministic per seed', () => {
    const a = bouffont({ text: 'SANE', font, seed: 3, preset: 'throwup' });
    const b = bouffont({ text: 'SANE', font, seed: 3, preset: 'throwup' });
    const c = bouffont({ text: 'SANE', font, seed: 4, preset: 'throwup' });
    expect(a.svg).toBe(b.svg);
    expect(a.svg).not.toBe(c.svg);
  });

  it('renders every preset to an svg with one path per letter', () => {
    for (const preset of ['throwup', 'bubbles', 'bubble', 'block', 'simple']) {
      const piece = bouffont({ text: 'KMOG', font, seed: 1, preset });
      expect(piece.svg.startsWith('<svg')).toBe(true);
      expect(piece.svg.match(/data-char=/g)).toHaveLength(4);
      expect(piece.letters.every((l) => l.shape.length > 0)).toBe(true);
    }
  });

  it('skips spaces and handles empty text', () => {
    expect(bouffont({ text: 'A B', font }).letters).toHaveLength(2);
    expect(bouffont({ text: '', font }).letters).toHaveLength(0);
  });

  it('throws on unknown strategies', () => {
    expect(() => bouffont({ text: 'A', font, strategies: ['nope'] })).toThrow(/unknown strategy/);
  });
});

describe('neighbour awareness', () => {
  const overlap = (letters) => {
    let total = 0;
    for (let i = 0; i < letters.length; i++)
      for (let j = i + 1; j < letters.length; j++)
        total += geom.area(geom.intersection(letters[i].shape, letters[j].shape));
    return total;
  };

  it("'avoid' growth makes letters meet without overlapping", () => {
    const ctx = ctxFor();
    const { letters } = layout(font, 'SANE', { size: 200, tracking: 0.5 });
    const free = runStrategies(letters, [['inflate', { amount: 1.2, smooth: 0 }]], ctx);
    const avoid = runStrategies(letters, [['grow', { amount: 1.2, steps: 6, smooth: 0 }]], ctx);
    expect(overlap(free)).toBeGreaterThan(1000);
    expect(overlap(avoid)).toBeLessThan(50);
    const area = (ls) => ls.reduce((s, l) => s + geom.area(l.shape), 0);
    expect(area(avoid)).toBeGreaterThan(area(letters) * 1.3);
  });
});

describe('repel', () => {
  it('splits overlaps into shared seams without moving letters', () => {
    const overlapArea = (letters) => {
      let total = 0;
      for (let i = 0; i < letters.length; i++)
        for (let j = i + 1; j < letters.length; j++)
          total += geom.area(geom.intersection(letters[i].shape, letters[j].shape));
      return total;
    };
    const stacked = bouffont({ text: 'genGraff', font, preset: 'throwup', seed: 7 });
    const repelled = bouffont({ text: 'genGraff', font, preset: 'throwup', seed: 7, repel: true });
    expect(overlapArea(stacked.letters)).toBeGreaterThan(1000);
    expect(overlapArea(repelled.letters)).toBeLessThan(50);
    // Same overall footprint: nothing moved apart.
    const w = (p) => geom.bbox(p.letters.flatMap((l) => l.shape)).width;
    expect(Math.abs(w(repelled) - w(stacked))).toBeLessThan(5);
  });

  it("never lets a letter fill another letter's counters or crease slits", () => {
    const outerOnly = (shape) => {
      const big = shape.reduce((a, b) => (Math.abs(geom.signedArea(b)) > Math.abs(geom.signedArea(a)) ? b : a));
      const sign = Math.sign(geom.signedArea(big));
      return geom.union(shape.filter((r) => Math.sign(geom.signedArea(r)) === sign));
    };
    for (const seed of [1, 2, 7]) {
      const { letters } = bouffont({ text: 'genGraff', font, preset: 'throwup', seed, tracking: -1, repel: true });
      const gaps = letters.map((l) => geom.difference(geom.close(outerOnly(l.shape), 4), l.shape));
      let intrusion = 0;
      letters.forEach((l, i) => gaps.forEach((g, j) => {
        if (i !== j) intrusion += geom.area(geom.intersection(l.shape, g));
      }));
      // Seams register a little on their own (~120–180); with the sliver bug it was 220–490.
      expect(intrusion).toBeLessThan(200);
    }
  });
});

describe('thickness-driven growth', () => {
  it('grows thick strokes more than thin ones when growth follows thickness', () => {
    const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    // A thick bar (40 high) joined to a thin bar (10 high).
    const shape = geom.union([rect(0, 0, 100, 40)], [rect(100, 15, 300, 25)]);
    const grown = variableOffset(shape, (t) => t / 2, { spacing: 4, min: 2, max: 80 });
    const topIn = (x0, x1) => geom.bbox(geom.intersection(grown, [rect(x0, -100, x1, 200)])).minY;
    expect(topIn(30, 70)).toBeLessThan(-15); // thick bar grew by ~20
    expect(topIn(170, 230)).toBeGreaterThan(8); // thin bar grew by ~5
  });
});

describe('details', () => {
  it('paints fewer crease lines when cleaning up, and snaps them to the palette', () => {
    const count = (details) => {
      // Crease clean-up applies to letters grown from the font outline (no structure).
      const { letters } = bouffont({
        text: 'genGraff', font, seed: 7, details, tracking: 0.2,
        strategies: [['block', { amount: 0.3 }], ['grow', { amount: 0.6, steps: 4, join: 'miter', gap: -0.1, smooth: 0 }]],
      });
      return letters.reduce((n, l) => n + l.shape.length, 0);
    };
    expect(count({})).toBeLessThan(count(false));
  });
});

const inter = await loadFont(
  readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url))
);
const playfair = await loadFont(
  readFileSync(new URL('../node_modules/@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff', import.meta.url))
);

describe('structure', () => {
  const strokes = (f, text) => bouffont({ text, font: f, structure: true, strategies: [] }).letters[0].structure;

  it('keeps crossbars and arms but drops serifs', () => {
    expect(strokes(inter, 'f').length).toBe(2); // stem + crossbar
    expect(strokes(inter, 'K').length).toBeGreaterThanOrEqual(2);
    expect(strokes(playfair, 'I').length).toBe(1); // serifs gone
  });

  it('draws every font with the same pen: equal stroke width relative to cap height', () => {
    const widthOf = (f) => {
      const p = bouffont({ text: 'I', font: f, structure: true, strategies: [] });
      return geom.bbox(p.letters[0].shape).width / p.metrics.capHeight;
    };
    expect(Math.abs(widthOf(inter) - widthOf(playfair))).toBeLessThan(0.03);
  });

  it('keeps word spaces when re-spacing', () => {
    const p = bouffont({ text: 'AB CD', font: inter, structure: true, strategies: [] });
    const [a, b, c] = p.letters.map((l) => geom.bbox(l.shape));
    expect(c.minX - b.maxX).toBeGreaterThan((b.minX - a.maxX) * 2);
  });
});

describe('pack', () => {
  it('is seeded and swells letters beyond the pen drawing', () => {
    const a = bouffont({ text: 'SANE', font: inter, preset: 'bubbles', seed: 1 });
    const b = bouffont({ text: 'SANE', font: inter, preset: 'bubbles', seed: 1 });
    const pen = bouffont({ text: 'SANE', font: inter, structure: { spacing: 0.6 }, strategies: [] });
    expect(a.svg).toBe(b.svg);
    const area = (p) => p.letters.reduce((s, l) => s + geom.area(l.shape), 0);
    expect(area(a)).toBeGreaterThan(area(pen) * 1.5);
  });
});

describe('simulations', () => {
  it('coral and frost are seeded and produce one shape per letter', () => {
    for (const preset of ['coral', 'frost']) {
      const a = bouffont({ text: 'AB', font: inter, preset, seed: 2 });
      const b = bouffont({ text: 'AB', font: inter, preset, seed: 2 });
      expect(a.svg).toBe(b.svg);
      expect(a.letters.every((l) => l.shape.length > 0)).toBe(true);
    }
  }, 30000);
});

describe('multiline', () => {
  it('stacks lines lineHeight apart and centres them', () => {
    for (const structure of [false, true]) {
      const p = bouffont({ text: 'AB\nCDEF', font: inter, structure, strategies: [], lineHeight: 1.2 });
      const lines = [0, 1].map((n) => geom.bbox(p.letters.filter((l) => l.line === n).flatMap((l) => l.shape)));
      expect(p.letters.map((l) => l.line)).toEqual([0, 0, 1, 1, 1, 1]);
      expect(lines[1].minY - lines[0].minY).toBeCloseTo(240, -1);
      expect(Math.abs(lines[0].cx - lines[1].cx)).toBeLessThan(2);
    }
  });
});

describe('overgrow', () => {
  it('swells free edges outward but keeps the contact between letters', () => {
    const base = { text: 'AB', font: inter, preset: 'throwup', seed: 3 };
    const overlap = (p) => geom.area(geom.intersection(p.letters[0].shape, p.letters[1].shape));
    const a = bouffont(base), b = bouffont({ ...base, overgrow: 1 });
    // A's far left edge moves out by about the amount…
    expect(geom.bbox(a.letters[0].shape).minX - geom.bbox(b.letters[0].shape).minX).toBeGreaterThan(5);
    // …but letters don't push further into each other.
    expect(overlap(b)).toBeLessThan(overlap(a) + 50);
  });
});

describe('generations', () => {
  it('keep growing runs more of the preset growth', () => {
    const area = (p) => p.letters.reduce((t, l) => t + geom.area(l.shape), 0);
    for (const preset of ['bubble', 'block', 'simple', 'frost']) {
      const a = bouffont({ text: 'AB', font: inter, preset, seed: 2 });
      const b = bouffont({ text: 'AB', font: inter, preset, seed: 2, overgrow: 1 });
      expect(area(b)).toBeGreaterThan(area(a) * 1.05);
    }
  }, 30000);
});

describe('render', () => {
  it('handles stroke 0 and negative strokes without hanging', () => {
    for (const stroke of [0, -1]) {
      for (const preset of ['throwup', 'simple', 'bubbles']) {
        const p = bouffont({ text: 'gef', font: inter, preset, render: { stroke } });
        expect(p.svg.startsWith('<svg')).toBe(true);
      }
    }
  });
});

describe('dom parts', () => {
  it('marks fills, outlines and lines per letter, with unique clip ids per piece', () => {
    const a = bouffont({ text: 'gef', font: inter, preset: 'throwup', seed: 1 });
    const b = bouffont({ text: 'gef', font: inter, preset: 'throwup', seed: 2 });
    expect(a.svg.match(/data-part="letter"/g)).toHaveLength(3);
    expect(a.svg.match(/data-part="fill"/g)).toHaveLength(3);
    expect(a.svg.match(/data-part="outline"/g)).toHaveLength(3);
    expect(a.svg).toMatch(/data-part="lines"/);
    const ids = (p) => [...p.svg.matchAll(/clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(a).length).toBeGreaterThan(0);
    expect(ids(a).some((id) => ids(b).includes(id))).toBe(false);
    expect(typeof a.dom).toBe('function');
  });
});

describe('density', () => {
  it('evens out the ink between light and heavy letters', () => {
    const spread = (density) => {
      const { letters } = bouffont({ text: 'lim', font: inter, preset: 'bubbles', seed: 1, density });
      const a = letters.map((l) => geom.area(l.shape));
      return Math.min(...a) / Math.max(...a);
    };
    expect(spread(1)).toBeGreaterThan(spread(0) + 0.1);
  });
});

describe('legibility', () => {
  it('keeps the counter of an O when inflating', () => {
    const ctx = ctxFor();
    const { letters } = layout(font, 'O', { size: 200 });
    const [o] = runStrategies(letters, [['inflate', { amount: 0.8, smooth: 0.5 }]], ctx);
    expect(o.shape.length).toBeGreaterThanOrEqual(2);
    const [closed] = runStrategies(letters, [['inflate', { amount: 0.8, smooth: 0.5, keep: false }]], ctx);
    expect(closed.shape.length).toBe(1);
  });
});

describe('align', () => {
  it("'bottom' stops growth at the baseline, 'middle' does not", () => {
    const grow = { text: 'BEIX', font, strategies: [['inflate', { amount: 0.8 }]] };
    const bottom = (piece) => Math.max(...piece.letters.map((l) => geom.bbox(l.shape).maxY));
    expect(bottom(bouffont({ ...grow, align: 'bottom' }))).toBeLessThanOrEqual(0.5);
    expect(bottom(bouffont({ ...grow, align: 'middle' }))).toBeGreaterThan(20);
  });

  it('keeps the notches of an X open through the edge', () => {
    const [x] = bouffont({ text: 'X', font, strategies: [['inflate', { amount: 0.8, smooth: 0.5 }]] }).letters;
    const b = geom.bbox(x.shape);
    // A point on the top centre of the outline lies inside the crease, not the fill.
    expect(geom.contains(x.shape, { x: b.cx, y: b.minY + 2 })).toBe(false);
  });
});

describe('envelope', () => {
  it('warps letters into a triangle: edges lower than the middle', () => {
    const piece = bouffont({ text: 'IIIII', font, envelope: { type: 'triangle', minHeight: 0.3 } });
    const tops = piece.letters.map((l) => geom.bbox(l.shape).minY);
    expect(tops[2]).toBeLessThan(tops[0]);
    expect(tops[2]).toBeLessThan(tops[4]);
  });
});
