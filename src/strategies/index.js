// Strategy registry and the shared neighbour/envelope constraint.
// A strategy is `(letters, ctx, opts) => letters` and works on all letters at once.
// All lengths in opts are in stems (the font's measured stroke thickness).
import { constrain, keepOut } from './constrain.js';
import { inflate, block, chamfer, soften, smooth } from './shape.js';
import { angular } from './angular.js';
import { wobble, stretch, bounce } from './distort.js';
import { grow } from './grow.js';
import { repel } from './repel.js';
import { knit } from './knit.js';
import { pack } from './pack.js';
import { overgrow } from './overgrow.js';
import { coral, dla } from './simulate.js';
import { drain, swell } from './steps.js';
import { offset } from '../geom/clip.js';

export { constrain };

export const strategies = { inflate, block, chamfer, soften, smooth, angular, wobble, stretch, bounce, grow, repel, knit, pack, coral, dla, overgrow };

// Swells: how far each letter grows (px), for the in-between frames of live growth.
inflate.tween = swell((l, ctx, o) => (o.amount ?? 0.5) * (l.growth ?? 1) * ctx.stem);
block.tween = swell((l, ctx, o) => (o.amount ?? 0.35) * (l.growth ?? 1) * ctx.stem, 'miter');
pack.tween = swell((l, ctx, o) => (o.size ?? 0.9) * (o.grow ?? 1.15) * (l.growth ?? 1) * ctx.stem);
overgrow.tween = swell((l, ctx, o) => (o.amount ?? 0.5) * (l.growth ?? 1) * ctx.stem);

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

/**
 * The strategies, step by step: yields the letters after every step of a simulating
 * strategy and after every other strategy (frames for `live()`), returns the result.
 */
export function* stepStrategies(letters, specs = [], ctx, { live = false } = {}) {
  // Remember each letter's starting shape: `repel` uses it to split contested areas.
  let current = letters.map((l) => (l.core ? l : { ...l, core: l.shape }));
  for (const [i, spec] of specs.entries()) {
    const [type, opts] = normalizeSpec(spec);
    const fn = typeof type === 'function' ? type : strategies[type];
    if (!fn) throw new Error(`bouffont: unknown strategy "${type}"`);
    const rng = ctx.rng.fork(`strategy:${i}:${typeof type === 'string' ? type : 'fn'}`);
    const targets = pickTargets(current, opts, rng);
    const sctx = { ...ctx, rng, targets };
    const keepTargets = (result) => result.map((l, k) => (targets[k] ? l : current[k]));
    // Frames mid-strategy respect the barrier (alignment lines, obstructions) too.
    const framed = (result) => {
      const kept = keepTargets(result);
      return ctx.barrier ? kept.map((l) => ({ ...l, shape: keepOut(l, ctx.barrier) })) : kept;
    };
    let result;
    // Live only: strategies that swell in one go show it in in-between frames.
    if (live && fn.tween && !fn.stepwise) {
      for (const frame of fn.tween(current, sctx, opts, offset)) yield framed(frame);
    }
    if (fn.stepwise) {
      const steps = fn.stepwise(current, sctx, opts);
      let r = steps.next();
      for (; !r.done; r = steps.next()) yield framed(r.value);
      result = r.value;
    } else {
      result = fn(current, sctx, opts);
    }
    const merged = keepTargets(result);
    // `grow` and `overgrow` handle neighbours themselves; the barrier (alignment lines,
    // obstructions) still applies.
    current = fn.selfConstrained
      ? (ctx.barrier ? merged.map((l) => ({ ...l, shape: keepOut(l, ctx.barrier) })) : merged)
      : constrain(merged, current, ctx, opts);
    yield current;
  }
  return current;
}

export const runStrategies = (letters, specs, ctx) => drain(stepStrategies(letters, specs, ctx));
