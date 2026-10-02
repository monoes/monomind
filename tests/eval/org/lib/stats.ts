// tests/eval/org/lib/stats.ts
//
// Interval helpers for the org eval (spec section 10). Small samples are the
// norm here (a paid run costs real money), so every figure carries its
// interval, and fewer than two runs carry none.

export interface Interval {
  mean: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
}

/** Wilson score interval for `successes` of `n` runs, at z (default 95%). */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (successes > n || successes < 0 || n < 0) throw new Error(`invalid counts ${successes}/${n}`);
  if (n === 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** mulberry32: a small seeded generator so intervals are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Mean with a percentile-bootstrap interval. */
export function meanInterval(
  xs: number[],
  opts: { confidence?: number; resamples?: number; seed?: number } = {},
): Interval {
  const n = xs.length;
  if (n === 0) return { mean: null, lo: null, hi: null, n };
  if (n === 1) return { mean: xs[0], lo: null, hi: null, n };
  const { confidence = 0.95, resamples = 4000, seed = 1 } = opts;
  const rand = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[Math.floor(rand() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return {
    mean: mean(xs),
    lo: means[Math.floor(tail * resamples)],
    hi: means[Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1)],
    n,
  };
}

/** Mean of the per-pair differences a[i] - b[i], with its bootstrap interval. */
export function pairedDifference(
  a: number[],
  b: number[],
  opts: { confidence?: number; resamples?: number; seed?: number } = {},
): Interval {
  if (a.length !== b.length)
    throw new Error(`paired series differ in length (${a.length} vs ${b.length})`);
  return meanInterval(
    a.map((x, i) => x - b[i]),
    opts,
  );
}
