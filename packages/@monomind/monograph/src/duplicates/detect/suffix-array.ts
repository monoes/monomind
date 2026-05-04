export function buildSuffixArray(text: number[], _maxRank: number): number[] {
  const n = text.length;
  if (n === 0) return [];

  const minVal = text.reduce((m, v) => (v < m ? v : m), text[0]);

  let rank = new Int32Array(n);
  for (let i = 0; i < n; i++) rank[i] = text[i] - minVal;

  let sa = new Int32Array(n);
  for (let i = 0; i < n; i++) sa[i] = i;

  let tmp = new Int32Array(n);
  const saTmp = new Int32Array(n);
  let counts = new Int32Array(0);

  let curMaxRank = 0;
  for (let i = 0; i < n; i++) {
    if (rank[i] > curMaxRank) curMaxRank = rank[i];
  }

  let k = 1;

  while (k < n) {
    const bucketCount = curMaxRank + 2;
    if (counts.length < bucketCount + 1) {
      counts = new Int32Array(bucketCount + 1);
    } else {
      counts.fill(0, 0, bucketCount + 1);
    }

    for (let idx = 0; idx < n; idx++) {
      const i = sa[idx];
      const r2 = i + k < n ? rank[i + k] + 1 : 0;
      counts[r2]++;
    }
    let sum = 0;
    for (let c = 0; c <= bucketCount; c++) {
      const v = counts[c];
      counts[c] = sum;
      sum += v;
    }
    for (let idx = 0; idx < n; idx++) {
      const i = sa[idx];
      const r2 = i + k < n ? rank[i + k] + 1 : 0;
      saTmp[counts[r2]++] = i;
    }

    counts.fill(0, 0, bucketCount + 1);
    for (let idx = 0; idx < n; idx++) {
      const i = saTmp[idx];
      counts[rank[i]]++;
    }
    sum = 0;
    for (let c = 0; c <= bucketCount; c++) {
      const v = counts[c];
      counts[c] = sum;
      sum += v;
    }
    for (let idx = 0; idx < n; idx++) {
      const i = saTmp[idx];
      sa[counts[rank[i]]++] = i;
    }

    tmp[sa[0]] = 0;
    for (let i = 1; i < n; i++) {
      const prev = sa[i - 1];
      const curr = sa[i];
      const rp2 = prev + k < n ? rank[prev + k] : -1;
      const rc2 = curr + k < n ? rank[curr + k] : -1;
      const same = rank[prev] === rank[curr] && rp2 === rc2;
      tmp[curr] = tmp[prev] + (same ? 0 : 1);
    }

    const newMaxRank = tmp[sa[n - 1]];
    const swapRank = rank;
    rank = tmp;
    tmp = swapRank;

    if (newMaxRank === n - 1) break;
    curMaxRank = newMaxRank;
    k *= 2;
  }

  const result: number[] = new Array(n);
  for (let i = 0; i < n; i++) result[i] = sa[i];
  return result;
}
