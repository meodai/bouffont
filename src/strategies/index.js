// Strategy registry and the shared neighbour/envelope constraint.
// A strategy is `(letters, ctx, opts) => letters` and works on all letters at once.
// All lengths in opts are in stems (the font's measured stroke thickness).
import { constrain } from './constrain.js';
import { inflate, block, chamfer, soften, smooth } from './shape.js';
import { angular } from './angular.js';
import { wobble, stretch, bounce } from './distort.js';
import { grow } from './grow.js';
import { repel } from './repel.js';
import { knit } from './knit.js';
import { pack } from './pack.js';
import { overgrow } from './overgrow.js';
import { coral, dla } from './simulate.js';

export { constrain };

export const strategies = { inflate, block, chamfer, soften, smooth, angular, wobble, stretch, bounce, grow, repel, knit, pack, coral, dla, overgrow };

export function registerStrategy(name, fn) {
  strategies[name] = fn;
}

const normalizeSpec = (spec) => {
  if (typeof spec === 'string') return [spec, {}];
  if (typeof spec === 'function') return [spec, {}];
  if (Array.isArray(spec)) return [spec[0], spec[1] ?? {}];
  const { type, ...opts } = spec;
  return [type, opts];
};

// Optional per-letter targeting: `letters: [0, 2]` or `chance: 0.5`.
const pickTargets = (letters, opts, rng) =>
  letters.map((l) => {
    if (opts.letters) return opts.letters.includes(l.index);
    if (opts.chance != null) return rng.chance(opts.chance);
    return true;
  });

export function runStrategies(letters, specs = [], ctx) {
  // Remember each letter's starting shape: `repel` uses it to split contested areas.
  const start = letters.map((l) => (l.core ? l : { ...l, core: l.shape }));
  return specs.reduce((current, spec, i) => {
    const [type, opts] = normalizeSpec(spec);
    const fn = typeof type === 'function' ? type : strategies[type];
    if (!fn) throw new Error(`bouffont: unknown strategy "${type}"`);
    const rng = ctx.rng.fork(`strategy:${i}:${typeof type === 'string' ? type : 'fn'}`);
    const targets = pickTargets(current, opts, rng);
    const result = fn(current, { ...ctx, rng, targets }, opts);
    const merged = result.map((l, k) => (targets[k] ? l : current[k]));
    // `grow` handles neighbours step by step itself.
    return fn.selfConstrained ? merged : constrain(merged, current, ctx, opts);
  }, start);
}
