export interface ShingleFilter {
  add(id: string, tokens: string[]): void;
  candidates(tokens: string[], topK?: number): string[];   // fast pre-filter
}

/**
 * Generate k-shingles (k-grams) from a token array.
 * Each shingle is the concatenation of k consecutive tokens joined by a space.
 */
function kShingles(tokens: string[], k: number): string[] {
  if (tokens.length < k) return [tokens.join(' ')];
  const shingles: string[] = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    shingles.push(tokens.slice(i, i + k).join(' '));
  }
  return shingles;
}

/**
 * Simple string hash that produces a non-negative 32-bit integer.
 * Uses a djb2-style hash.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h;
}

/**
 * Compute a MinHash signature for a set of shingles using
 * numHashes linear hash functions: h_i(x) = (a_i * x + b_i) % prime
 */
function minHashSignature(shingles: string[], numHashes: number): Uint32Array {
  const PRIME = 4294967311; // first prime > 2^32
  const sig = new Uint32Array(numHashes).fill(0xffffffff);

  // Deterministic seeds derived from hash index
  for (const shingle of shingles) {
    const x = hashString(shingle);
    for (let i = 0; i < numHashes; i++) {
      // Deterministic a, b per hash function — use index-based seeds
      const a = ((i * 2654435761 + 0x9e3779b9) >>> 0);
      const b = ((i * 2246822519 + 0x85ebca6b) >>> 0);
      // Linear hash modulo prime (BigInt for correctness)
      const hashVal = Number((BigInt(a) * BigInt(x) + BigInt(b)) % BigInt(PRIME)) >>> 0;
      if (hashVal < sig[i]) {
        sig[i] = hashVal;
      }
    }
  }
  return sig;
}

export function createShingleFilter(k = 5, numHashes = 128): ShingleFilter {
  // Each entry: { sig: Uint32Array }
  const index = new Map<string, Uint32Array>();

  // LSH: split numHashes into bands of rows
  // Standard LSH: numBands * numRows = numHashes, threshold ≈ (1/numBands)^(1/numRows)
  // We target threshold ~0.5: solve (1/b)^(1/r) = 0.5 with b*r = numHashes
  // A reasonable split is sqrt(numHashes) bands of sqrt(numHashes) rows each.
  const numBands = Math.round(Math.sqrt(numHashes));
  const numRows = Math.floor(numHashes / numBands);

  function getBandKey(id: string, band: number, sig: Uint32Array): string {
    const parts: number[] = [];
    for (let r = 0; r < numRows; r++) {
      const idx = band * numRows + r;
      if (idx < numHashes) parts.push(sig[idx]);
    }
    return `b${band}:${parts.join(',')}`;
  }

  // Band bucket → list of candidate IDs
  const bandBuckets = new Map<string, string[]>();

  return {
    add(id: string, tokens: string[]): void {
      const shingles = kShingles(tokens, k);
      const sig = minHashSignature(shingles, numHashes);
      index.set(id, sig);

      // Insert into LSH band buckets
      for (let band = 0; band < numBands; band++) {
        const key = getBandKey(id, band, sig);
        const bucket = bandBuckets.get(key);
        if (bucket) {
          bucket.push(id);
        } else {
          bandBuckets.set(key, [id]);
        }
      }
    },

    candidates(tokens: string[], topK = 10): string[] {
      const shingles = kShingles(tokens, k);
      const querySig = minHashSignature(shingles, numHashes);

      // Collect candidate IDs via LSH band matching
      const candidateScores = new Map<string, number>();

      for (let band = 0; band < numBands; band++) {
        const key = getBandKey('__query__', band, querySig);
        // Manually compute the key for the query signature
        const parts: number[] = [];
        for (let r = 0; r < numRows; r++) {
          const idx = band * numRows + r;
          if (idx < numHashes) parts.push(querySig[idx]);
        }
        const queryKey = `b${band}:${parts.join(',')}`;
        const bucket = bandBuckets.get(queryKey);
        if (bucket) {
          for (const id of bucket) {
            candidateScores.set(id, (candidateScores.get(id) ?? 0) + 1);
          }
        }
      }

      if (candidateScores.size === 0) return [];

      // Compute Jaccard estimate from signature agreement for ranked results
      const ranked = [...candidateScores.keys()].map(id => {
        const sig = index.get(id)!;
        let matches = 0;
        for (let i = 0; i < numHashes; i++) {
          if (sig[i] === querySig[i]) matches++;
        }
        const jaccardEst = matches / numHashes;
        return { id, jaccardEst };
      });

      // Filter by estimated Jaccard > 0.5 and return topK
      return ranked
        .filter(r => r.jaccardEst > 0.5)
        .sort((a, b) => b.jaccardEst - a.jaccardEst)
        .slice(0, topK)
        .map(r => r.id);
    },
  };
}
