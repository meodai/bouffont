// Render a contact sheet of presets × envelopes to gallery/sheet.svg (+ PNG if rsvg-convert exists).
// usage: node scripts/gallery.js [TEXT] [seed]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { graffiti, loadFont, presets } from '../src/index.js';

const text = process.argv[2] ?? 'bouffont';
const seed = process.argv[3] ?? 7;
const fontFile = new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url);
const font = await loadFont(await readFile(fontFile));

const rows = [
  ...Object.keys(presets).map((preset) => ({ label: preset, opts: { preset } })),
  ...['triangle', 'rhombus', 'circle', 'arch', 'wave'].map((type) => ({
    label: `throwup + ${type}`,
    opts: { preset: 'throwup', envelope: { type } },
  })),
];
const seeds = [seed, `${seed}b`, `${seed}c`];

const cellW = 520, cellH = 260, labelW = 170;
const cells = [];
const t0 = performance.now();
rows.forEach((row, r) => {
  cells.push(`<text x="10" y="${r * cellH + cellH / 2}" font-family="monospace" font-size="16">${row.label}</text>`);
  seeds.forEach((s, c) => {
    const piece = graffiti({ text, font, seed: s, ...row.opts });
    const inner = piece.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const [x, y, w, h] = piece.viewBox;
    const scale = Math.min((cellW - 20) / w, (cellH - 20) / h);
    cells.push(`<g transform="translate(${labelW + c * cellW + 10} ${r * cellH + 10}) scale(${scale}) translate(${-x} ${-y})">${inner}</g>`);
  });
});
const ms = performance.now() - t0;

const W = labelW + seeds.length * cellW, H = rows.length * cellH;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/>${cells.join('')}</svg>`;
await mkdir(new URL('../gallery/', import.meta.url), { recursive: true });
const out = new URL('../gallery/sheet.svg', import.meta.url);
await writeFile(out, sheet);
console.log(`${rows.length * seeds.length} pieces in ${ms.toFixed(0)}ms → gallery/sheet.svg`);
try {
  execFileSync('rsvg-convert', ['-w', '1400', '-o', out.pathname.replace('.svg', '.png'), out.pathname]);
  console.log('→ gallery/sheet.png');
} catch {}
