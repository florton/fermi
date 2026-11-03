/**
 * Seeded randomness. Every run is reproducible from `params.seed`, which is what
 * makes a parameter sweep an experiment rather than an anecdote.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal, Box–Muller. */
export function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Waiting time of a Poisson process with the given rate. */
export function exponential(rng: Rng, rate: number): number {
  return -Math.log(1 - rng()) / rate;
}

/** Knuth below 30, normal approximation above — the counts here are only ever rough. */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean < 30) {
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(rng)));
}

/** Index into a cumulative weight array, by binary search. */
export function pickCumulative(cum: Float64Array, rng: Rng): number {
  const x = rng() * cum[cum.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
