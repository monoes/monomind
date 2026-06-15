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

const MINHASH_PRIME = BigInt(4294967311); // first prime > 2^32

/**
 * Compute a MinHash signature for a set of shingles using
 * numHashes linear hash functions: h_i(x) = (a_i * x + b_i) % prime.
 *
 * @param seedsA  Precomputed BigInt a-coefficients (length numHashes)
 * @param seedsB  Precomputed BigInt b-constants   (length numHashes)
 */
function minHashSignature(
  shingles: string[],
  numHashes: number,
  seedsA: BigInt64Array,
  seedsB: BigInt64Array,
): Uint32Array {
  const sig = new Uint32Array(numHashes).fill(0xffffffff);

  for (const shingle of shingles) {
    const x = BigInt(hashString(shingle));
    for (let i = 0; i < numHashes; i++) {
      // Precomputed seeds avoid recomputing the same (a, b) per shingle per call.
      const hashVal = Number((seedsA[i]! * x + seedsB[i]!) % MINHASH_PRIME) >>> 0;
      if (hashVal < sig[i]!) sig[i] = hashVal;
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

  // Precompute MinHash seeds once per filter instance to avoid recomputing
  // (a, b) inside the hot inner loop of minHashSignature().
  const seedsA = new BigInt64Array(numHashes);
  const seedsB = new BigInt64Array(numHashes);
  for (let i = 0; i < numHashes; i++) {
    seedsA[i] = BigInt(((i * 2654435761 + 0x9e3779b9) >>> 0));
    seedsB[i] = BigInt(((i * 2246822519 + 0x85ebca6b) >>> 0));
  }

  function getBandKey(band: number, sig: Uint32Array): string {
    const parts: number[] = [];
    for (let r = 0; r < numRows; r++) {
      const idx = band * numRows + r;
      if (idx < numHashes) parts.push(sig[idx]!);
    }
    return `b${band}:${parts.join(',')}`;
  }

  // Band bucket → list of candidate IDs
  const bandBuckets = new Map<string, string[]>();

  return {
    add(id: string, tokens: string[]): void {
      const shingles = kShingles(tokens, k);
      const sig = minHashSignature(shingles, numHashes, seedsA, seedsB);
      index.set(id, sig);

      // Insert into LSH band buckets
      for (let band = 0; band < numBands; band++) {
        const key = getBandKey(band, sig);
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
      const querySig = minHashSignature(shingles, numHashes, seedsA, seedsB);

      // Collect candidate IDs via LSH band matching.
      // Use getBandKey() consistently — eliminates the duplicate inline computation.
      const candidateScores = new Map<string, number>();

      for (let band = 0; band < numBands; band++) {
        const queryKey = getBandKey(band, querySig);
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
