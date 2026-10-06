// Small seeded PRNG (mulberry32) plus helpers. Strings are hashed into a seed.

export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (const c of String(seed)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed = 0) {
  const base = hashSeed(seed);
  let a = base;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.range = (min, max) => min + next() * (max - min);
  rng.int = (min, max) => Math.floor(rng.range(min, max + 1));
  rng.pick = (list) => list[Math.floor(next() * list.length)];
  rng.chance = (p) => next() < p;
  rng.sign = () => (next() < 0.5 ? -1 : 1);
  // Derive an independent stream, so changing one stage does not reshuffle another.
  rng.fork = (key) => createRng(hashSeed(`${base}:${key}`));
  return rng;
}
