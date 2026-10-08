// Step-by-step growth. A strategy that simulates (grow, coral, dla) is written as a
// generator: it yields the letters after every step (frames for live growth, see
// `live()`) and returns the finished letters. Run to the end, it is the plain strategy.

/** Run a step generator to the end and return its result. */
export function drain(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/**
 * In-between frames for a strategy that swells in one go: the letters offset by a
 * growing share of `amount(letter)` (px). Only for watching; the result is the real one.
 */
export function swell(amount, join = 'round') {
  return function* (letters, ctx, opts, offset, frames = 12) {
    for (let f = 1; f < frames; f++) {
      yield letters.map((l, k) => (ctx.targets?.[k] === false || !l.shape.length ? l
        : { ...l, shape: offset(l.shape, amount(l, ctx, opts) * (f / frames), { join, miterLimit: 4 }) }));
    }
  };
}

/** A strategy from its step generator: the plain function, with `.stepwise` attached. */
export function stepwise(steps, props = {}) {
  const fn = (letters, ctx, opts) => drain(steps(letters, ctx, opts));
  return Object.assign(fn, { stepwise: steps }, props);
}
