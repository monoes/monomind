export function buildLcp(text: number[], sa: number[]): number[] {
  const n = sa.length;
  if (n === 0) return [];

  const rank = new Int32Array(n);
  for (let i = 0; i < n; i++) rank[sa[i]] = i;

  const lcp = new Array<number>(n).fill(0);
  let k = 0;

  for (let i = 0; i < n; i++) {
    if (rank[i] === 0) {
      k = 0;
      continue;
    }
    const j = sa[rank[i] - 1];
    while (i + k < n && j + k < n) {
      if (text[i + k] < 0 || text[j + k] < 0) break;
      if (text[i + k] !== text[j + k]) break;
      k++;
    }
    lcp[rank[i]] = k;
    k = k > 0 ? k - 1 : 0;
  }

  return lcp;
}
