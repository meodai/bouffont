import { createRng } from './rng.js';
import { layout } from './font.js';
import { applyEnvelope } from './envelope.js';
import { applyStructure } from './structure.js';
import { alignBarrier } from './align.js';
import { runStrategies } from './strategies/index.js';
import { runDecorations } from './decorations.js';
import { render } from './render.js';
import { presets } from './presets.js';
import { toDOM } from './dom.js';

export { loadFont, measureFont, layout } from './font.js';
export { envelopes } from './envelope.js';
export { strategies, registerStrategy, constrain } from './strategies/index.js';
export { decorations, registerDecoration } from './decorations.js';
export { presets };
export { createRng } from './rng.js';
export { toDOM } from './dom.js';
export * as geom from './geom/clip.js';

// Crease clean-up: drop stubs and crowded lines, optionally snap them to a few angles.
// Default palette: 6 directions, 30° apart, so every cut moves 15° at most.
const DETAILS = { min: 0.8, depth: 1.5, spacing: 0.5, keep: 2, angles: 6, angle: 0, clean: true };
function resolveDetails(details, stem) {
  if (details === false) return {};
  const d = { ...DETAILS, ...details };
  const rad = (deg) => (deg * Math.PI) / 180;
  const angles = d.angles == null ? null
    : Array.isArray(d.angles) ? d.angles.map(rad)
    : Array.from({ length: d.angles }, (_, i) => rad(d.angle + (180 / d.angles) * i));
  return {
    minLength: d.min * stem, minDepth: d.depth * stem, spacing: d.spacing * stem,
    minCount: d.keep, angles, clean: d.clean,
  };
}

// `generations`: [type, scaled, fixed] or a list of them. Numbers in `scaled` are the
// values at overgrow 1 and scale with the amount (`steps` stays a whole number).
function generations(spec, amount) {
  if (!spec) return [['overgrow', { amount }]];
  const list = typeof spec[0] === 'string' ? [spec] : spec;
  return list.map(([type, scaled = {}, fixed = {}]) => {
    const o = { ...fixed };
    for (const [k, v] of Object.entries(scaled)) {
      o[k] = typeof v === 'number' ? (k === 'steps' ? Math.max(1, Math.round(v * amount)) : v * amount) : v;
    }
    return [type, o];
  });
}

/**
 * Generate a piece.
 * @param {object} o
 * @param {string} o.text
 * @param {object} o.font        opentype.js Font (see loadFont)
 * @param {number|string} [o.seed]
 * @param {string} [o.preset]    name from `presets`, merged under the other options
 * @param {number} [o.size]      font size in px
 * @param {string} [o.text]    may contain newlines: several centred lines
 * @param {number} [o.lineHeight]  distance between baselines, × size (default 1)
 * @param {number} [o.tracking]  extra letter spacing, in stems (negative = overlap)
 * @param {string|object} [o.envelope]  outer shape: 'none' | 'rect' | 'triangle' | …
 * @param {string} [o.align]     'middle' | 'bottom' | 'top' | 'both': lines growth can't cross
 * @param {Array} [o.strategies] growth strategies, applied in order
 * @param {number} [o.knit]     close gaps between letters narrower than 2× this (stems; off by default)
 * @param {number} [o.overgrow] keep growing after letters meet: more generations of the preset's
 *                               own growth (`generations`), or an outward swell (stems)
 * @param {boolean} [o.repel]  letters repel each other's growth: shared seams instead of overlaps
 * @param {number|object} [o.smooth]  final smoothing pass after the strategies (stems, or smooth options)
 * @param {Array} [o.decorations]
 * @param {object|false} [o.details]  which crease lines get painted:
 *   { min, depth, spacing (stems), angles (count or degrees[]), angle (offset°), clean }
 *   Each letter keeps its `keep` deepest creases; others need `min` length or `depth`.
 * @param {object} [o.render]    { mode, order, stroke, outline, invert, background }
 *                               order: 'ltr' | 'rtl' | 'center' | 'edges' | 'random'
 */
export function graffiti(o) {
  const base = o.preset ? presets[o.preset] : {};
  if (o.preset && !base) throw new Error(`bouffont: unknown preset "${o.preset}"`);
  const opts = { size: 200, tracking: 0, seed: 1, knit: 0, ...base, ...o, render: { ...base.render, ...o.render } };
  if (!opts.font) throw new Error('bouffont: `font` is required (use loadFont)');

  const rng = createRng(opts.seed);
  // With structure, spacing is re-applied to the redrawn letters (tracking in pens).
  const { letters: laid, metrics } = layout(opts.font, opts.text ?? '', {
    size: opts.size,
    tracking: opts.structure ? 0 : opts.tracking,
    lineHeight: opts.lineHeight ?? 1,
  });
  const ctx = { stem: metrics.stem, metrics, size: opts.size, rng, envelope: null };
  if (!laid.length) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    return { svg, letters: [], metrics, dom: (doc) => toDOM(svg, doc) };
  }

  // Experimental: redraw every letter from its structure with one pen; the pen width
  // then becomes the unit for everything after.
  let letters0 = laid;
  if (opts.structure) {
    const res = applyStructure(laid, ctx, opts.structure === true ? {} : opts.structure, opts.tracking);
    letters0 = res.letters;
    ctx.stem = res.stem;
    ctx.metrics = { ...metrics, stem: res.stem };
    ctx.structured = true;
    ctx.redraw = res.redraw;
  }

  const { letters: warped, polygon, edges } = applyEnvelope(letters0, opts.envelope, ctx);
  ctx.envelope = polygon;
  ctx.details = resolveDetails(opts.details, ctx.stem);
  ctx.barrier = alignBarrier(opts.align, edges, warped, {
    capHeight: metrics.capHeight, size: opts.size,
    lastBaseline: (Math.max(0, ...laid.map((l) => l.line ?? 0))) * (opts.lineHeight ?? 1) * opts.size,
  });

  const strategies = [...(opts.strategies ?? [])];
  // Keep growing outward after meeting the neighbours (stems); contacts stay.
  // A preset can say what "keep growing" means for it: `generations` are more rounds
  // of its own growth; otherwise letters swell outward (overgrow).
  if (opts.overgrow) strategies.push(...generations(opts.generations, opts.overgrow));
  if (opts.smooth) strategies.push(['smooth', typeof opts.smooth === 'number' ? { amount: opts.smooth } : opts.smooth]);
  // Close slivers and V-notches between letters (stems; 0 turns it off).
  if (opts.knit) strategies.push(['knit', { gap: opts.knit }]);
  // Repel last: it splits overlaps into seams and smooths those seams itself.
  if (opts.repel) strategies.push(['repel', opts.repel === true ? {} : opts.repel]);
  const grown = runStrategies(warped, strategies, ctx);
  const decorated = runDecorations(grown, opts.decorations, ctx);
  const out = render(decorated, opts.render, ctx);

  return {
    ...out,
    letters: decorated,
    metrics: ctx.metrics,
    envelope: polygon,
    // SVG element + references to its fills, outlines and lines (per letter too).
    dom: (doc) => toDOM(out.svg, doc),
  };
}
