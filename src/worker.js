// The worker side of `bouffont/worker` (see pool.js): renders pieces off the main
// thread. Fonts arrive as URLs or ArrayBuffers and are loaded once per worker.
import { bouffont, loadFont } from './index.js';

const fonts = new Map();
const getFont = (src) => {
  if (typeof src !== 'string') return loadFont(src);
  if (!fonts.has(src)) fonts.set(src, loadFont(src));
  return fonts.get(src);
};

self.onmessage = async ({ data: { id, options, letters } }) => {
  try {
    const t = performance.now();
    const piece = bouffont({ ...options, font: await getFont(options.font) });
    self.postMessage({
      id,
      svg: piece.svg,
      metrics: piece.metrics,
      letters: letters ? piece.letters : undefined,
      ms: performance.now() - t,
    });
  } catch (e) {
    fonts.delete(options.font); // a failed load shouldn't stick
    self.postMessage({ id, error: e.message });
  }
};
