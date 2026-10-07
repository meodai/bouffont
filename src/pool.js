// bouffont/worker: render pieces in a pool of Web Workers, so growing letters never
// blocks the page and several pieces grow at once (one per core).
//
//   import { createPool } from 'bouffont/worker';
//   const pool = createPool();
//   const { svg } = await pool.render({ text: 'hi', font: '/fonts/inter.woff', preset: 'bubble' });
//
// `font` is a URL or an ArrayBuffer (an opentype.js Font can't cross into a worker).
// Options must be plain data: built-in strategies by name, no functions.
import { toDOM } from './dom.js';

export function createPool({ size } = {}) {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
  const count = Math.max(1, Math.min(size ?? cores - 1, 8));
  const queue = [];
  const jobs = new Map();
  const idle = [];
  let nextId = 0;

  const spawn = () => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      jobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve({ ...data, dom: (doc) => toDOM(data.svg, doc) });
      idle.push(worker);
      pump();
    };
    worker.onerror = (e) => {
      // A worker that can't even start (e.g. an unsupported module worker) fails its job.
      for (const [id, job] of jobs) if (job.worker === worker) { jobs.delete(id); job.reject(new Error(e.message)); }
    };
    return worker;
  };
  const workers = Array.from({ length: count }, spawn);
  idle.push(...workers);

  function pump() {
    while (idle.length && queue.length) {
      const job = queue.shift();
      if (job.signal?.aborted) { job.reject(abortError()); continue; }
      const worker = idle.pop();
      job.worker = worker;
      jobs.set(job.id, job);
      worker.postMessage({ id: job.id, options: job.options, letters: job.letters });
    }
  }

  return {
    size: count,
    /**
     * Render a piece. Resolves to { svg, metrics, letters?, ms, dom(doc) }.
     * @param {object} options  bouffont() options; `font` is a URL or ArrayBuffer
     * @param {object} [o]
     * @param {AbortSignal} [o.signal]  drop the job if it hasn't started yet
     * @param {boolean} [o.priority]    jump the queue
     * @param {boolean} [o.letters]     also send back the letter geometry
     */
    render(options, { signal, priority = false, letters = false } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const font = typeof options.font === 'string' && globalThis.location
          ? new URL(options.font, globalThis.location.href).href // resolve against the page, not the worker
          : options.font;
        const job = { id: nextId++, options: { ...options, font }, signal, letters, resolve, reject };
        if (priority) queue.unshift(job);
        else queue.push(job);
        pump();
      });
    },
    terminate() {
      for (const w of workers) w.terminate();
      for (const job of [...queue, ...jobs.values()]) job.reject(new Error('bouffont: pool terminated'));
      queue.length = 0;
      jobs.clear();
    },
  };
}

const abortError = () => new DOMException('bouffont: render aborted', 'AbortError');
