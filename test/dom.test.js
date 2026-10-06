// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graffiti, loadFont } from '../src/index.js';

const font = await loadFont(
  // happy-dom replaces import.meta.url, so resolve from the project root.
  readFileSync(resolve(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'))
);

describe('piece.dom()', () => {
  it('returns the svg element and references to fills, outlines and lines', () => {
    const piece = graffiti({ text: 'gef', font, preset: 'throwup', seed: 1, render: { order: 'rtl' } });
    const dom = piece.dom();
    expect(dom.svg.tagName.toLowerCase()).toBe('svg');
    expect(dom.fills).toHaveLength(3);
    expect(dom.outlines).toHaveLength(3);
    expect(dom.strokes.length).toBe(dom.outlines.length + dom.lines.length);
    // Text order, even when drawn right to left.
    expect(dom.letters.map((l) => l.char)).toEqual(['g', 'e', 'f']);
    const [g] = dom.letters;
    expect(g.fill.getAttribute('data-part')).toBe('fill');
    expect(g.outline.getAttribute('stroke')).toBe('#000');
    expect(g.group.contains(g.fill)).toBe(true);
    // References are live: styling them changes the element in the svg.
    g.fill.setAttribute('fill', 'hotpink');
    expect(dom.svg.querySelector('[data-part="fill"][fill="hotpink"]')).toBe(g.fill);
  });

  it('includes the outer outline band in outlines and strokes', () => {
    const dom = graffiti({ text: 'ab', font, preset: 'bubble' }).dom();
    expect(dom.band).toBeTruthy();
    expect(dom.outlines[0]).toBe(dom.band);
    expect(dom.strokes).toContain(dom.band);
    expect(dom.band.getAttribute('stroke')).toBe('#000');
  });

  it('works for merged pieces and empty text', () => {
    const merged = graffiti({ text: 'ab', font, preset: 'throwup', render: { mode: 'merge' } }).dom();
    expect(merged.letters).toHaveLength(1);
    expect(merged.letters[0].index).toBe('all');
    expect(graffiti({ text: '', font }).dom().fills).toHaveLength(0);
  });
});
