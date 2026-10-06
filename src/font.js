// Font loading, measurement and text layout.
import { parse } from 'opentype.js/dist/opentype.mjs';
import { commandsToPolygons } from './geom/path.js';
import { normalize, bbox } from './geom/clip.js';

export async function loadFont(source) {
  if (source && typeof source.forEachGlyph === 'function') return source;
  let buffer = source;
  if (typeof source === 'string' || source instanceof URL) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`bouffont: could not load font ${source} (${res.status})`);
    buffer = await res.arrayBuffer();
  }
  if (ArrayBuffer.isView(buffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return parse(buffer);
}

const glyphShape = (glyph, size) =>
  normalize(commandsToPolygons(glyph.getPath(0, 0, size).commands));

/**
 * Measure a font the way "The Anatomy of a Thousand Typefaces" does: from the glyphs,
 * normalised by size. `stem` (stroke thickness) is the unit every strategy scales by,
 * so the same settings behave alike on thin and heavy fonts.
 */
export function measureFont(font, size = 1) {
  const glyph = ['O', 'o', '0'].map((c) => font.charToGlyph(c)).find((g) => g && g.unicode);
  const capGlyph = font.charToGlyph('H');
  const capHeight = capGlyph?.unicode ? bbox(glyphShape(capGlyph, size)).height : size * 0.7;
  let stem = size * 0.12, contrast = 1;

  if (glyph) {
    const rings = glyphShape(glyph, size).sort((a, b) => bbox([b]).width - bbox([a]).width);
    if (rings.length >= 2) {
      const [outer, inner] = rings;
      const d = outer.map((p) => Math.min(...inner.map((q) => Math.hypot(p.x - q.x, p.y - q.y))));
      const sorted = d.sort((a, b) => a - b);
      // Ignore the extreme 10% on each side: flattening artefacts and overshoots.
      const lo = sorted[Math.floor(sorted.length * 0.1)];
      const hi = sorted[Math.floor(sorted.length * 0.9)];
      stem = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      contrast = hi ? lo / hi : 1;
    }
  }
  return { stem, contrast, capHeight, weight: stem / capHeight };
}

/**
 * Lay text out into letters. Each letter has its own closed shape (polygons in
 * px, y down, first baseline at y=0). Lines (split on newlines) are stacked
 * `lineHeight` × size apart and centred; each letter knows its `line`.
 */
export function layout(font, text, { size = 200, tracking = 0, lineHeight = 1 } = {}) {
  const letters = [];
  const metrics = measureFont(font, size);
  const scale = size / font.unitsPerEm;
  let index = 0;
  const widths = [];
  String(text).split(/\r?\n/).forEach((lineText, line) => {
    let x = 0, spaces = 0;
    const y = line * lineHeight * size;
    const chars = [...lineText];
    let glyphs;
    try {
      glyphs = font.stringToGlyphs(lineText);
    } catch {
      // opentype.js can't apply some substitution tables (e.g. Bangers):
      // fall back to plain one-glyph-per-character mapping.
      glyphs = chars.map((c) => font.charToGlyph(c));
    }
    glyphs.forEach((glyph, i) => {
      const shape = glyphShape(glyph, size).map((poly) => poly.map((p) => ({ x: p.x + x, y: p.y + y })));
      const advance = glyph.advanceWidth * scale;
      if (shape.length) {
        letters.push({ char: chars[i] ?? String.fromCodePoint(glyph.unicode ?? 63), index: index++,
          shape, x, advance, spaces, line });
        spaces = 0;
      } else if (letters.some((l) => l.line === line)) {
        spaces++; // a word space before the next letter
      }
      const next = glyphs[i + 1];
      const kern = next ? font.getKerningValue(glyph, next) * scale : 0;
      x += advance + kern + tracking * metrics.stem;
    });
    widths[line] = x;
  });
  centerLines(letters);
  return { letters, metrics, size, lines: widths.length };
}

// Centre every line horizontally on the widest one (by the letters' actual extent).
export function centerLines(letters) {
  const lines = new Map();
  for (const l of letters) (lines.get(l.line ?? 0) ?? lines.set(l.line ?? 0, []).get(l.line ?? 0)).push(l);
  if (lines.size < 2) return letters;
  const ext = new Map([...lines].map(([k, ls]) => [k, bbox(ls.flatMap((l) => l.shape))]));
  const mid = (Math.min(...[...ext.values()].map((b) => b.minX)) + Math.max(...[...ext.values()].map((b) => b.maxX))) / 2;
  for (const [k, ls] of lines) {
    const dx = mid - ext.get(k).cx;
    if (!dx) continue;
    for (const l of ls) {
      l.shape = l.shape.map((poly) => poly.map((p) => ({ x: p.x + dx, y: p.y })));
      if (l.structure) l.structure = l.structure.map((st) => ({ ...st, points: st.points.map((p) => ({ ...p, x: p.x + dx })) }));
      l.x += dx;
    }
  }
  return letters;
}
