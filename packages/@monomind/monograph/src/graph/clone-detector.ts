import type { MonographDb } from '../storage/db.js';
import { insertEdge } from '../storage/edge-store.js';
import { makeId } from '../types.js';

export interface ClonePair {
  fileA: string;
  fileB: string;
  similarity: number;    // 0-1
  cloneType: 'exact' | 'renamed' | 'structural';
  tokenCount: number;    // shared token run length
}

export interface CloneDetectionResult {
  pairs: ClonePair[];
  totalFiles: number;
  cloneRatio: number;    // fraction of files involved in at least one clone pair
}

/** Tokenize a file path into lowercase alphanumeric tokens. */
function tokenizePath(filePath: string): string[] {
  return filePath
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0);
}

/** Extract the base filename (without directory) from a path. */
function baseName(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, '');
}

/** Compute Jaccard similarity between two multisets (represented as token arrays). */
function jaccardSimilarity(a: string[], b: string[]): number {
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const t of a) countA.set(t, (countA.get(t) ?? 0) + 1);
  for (const t of b) countB.set(t, (countB.get(t) ?? 0) + 1);

  let intersection = 0;
  for (const [token, ca] of countA) {
    const cb = countB.get(token) ?? 0;
    intersection += Math.min(ca, cb);
  }

  const union = a.length + b.length - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Count tokens shared between two multisets. */
function sharedTokenCount(a: string[], b: string[]): number {
  const countA = new Map<string, number>();
  for (const t of a) countA.set(t, (countA.get(t) ?? 0) + 1);

  let shared = 0;
  const seen = new Map<string, number>();
  for (const t of b) {
    const limit = countA.get(t) ?? 0;
    const used = seen.get(t) ?? 0;
    if (used < limit) {
      shared++;
      seen.set(t, used + 1);
    }
  }
  return shared;
}

export function detectClones(
  db: MonographDb,
  minSimilarity = 0.8,
  minTokens = 50,
): CloneDetectionResult {
  // Query all File nodes with file_path
  const rows = db
    .prepare(`SELECT id, file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`)
    .all() as { id: string; file_path: string }[];

  const totalFiles = rows.length;
  const pairs: ClonePair[] = [];
  const involvedFiles = new Set<string>();

  // Pre-compute tokens for each file
  const tokenMap = new Map<string, string[]>();
  for (const row of rows) {
    tokenMap.set(row.file_path, tokenizePath(row.file_path));
  }

  // Compare all pairs
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const pathA = rows[i].file_path;
      const pathB = rows[j].file_path;
      const tokensA = tokenMap.get(pathA)!;
      const tokensB = tokenMap.get(pathB)!;

      const sim = jaccardSimilarity(tokensA, tokensB);
      const shared = sharedTokenCount(tokensA, tokensB);

      if (sim < minSimilarity || shared < minTokens) {
        // Also check near-duplicate file names (same name, different dir)
        const nameA = baseName(pathA);
        const nameB = baseName(pathB);
        const nameTokensA = tokenizePath(nameA);
        const nameTokensB = tokenizePath(nameB);
        const nameSim = jaccardSimilarity(nameTokensA, nameTokensB);
        const nameShared = sharedTokenCount(nameTokensA, nameTokensB);

        if (nameSim >= minSimilarity && nameShared >= Math.min(minTokens, nameTokensA.length)) {
          // Same-name files in different directories → structural similarity
          const pair: ClonePair = {
            fileA: pathA,
            fileB: pathB,
            similarity: nameSim,
            cloneType: 'structural',
            tokenCount: nameShared,
          };
          pairs.push(pair);
          involvedFiles.add(pathA);
          involvedFiles.add(pathB);

          // Emit edge
          const edgeId = makeId('structurally_similar', rows[i].id, rows[j].id);
          try {
            insertEdge(db, {
              id: edgeId,
              sourceId: rows[i].id,
              targetId: rows[j].id,
              relation: 'STRUCTURALLY_SIMILAR',
              confidence: 'INFERRED',
              confidenceScore: nameSim,
              weight: nameSim,
            });
          } catch { /* ignore duplicate edge errors */ }
        }
        continue;
      }

      // Determine clone type
      let cloneType: ClonePair['cloneType'];
      if (sim >= 0.99) {
        cloneType = 'exact';
      } else if (baseName(pathA) === baseName(pathB)) {
        cloneType = 'renamed';
      } else {
        cloneType = 'structural';
      }

      const pair: ClonePair = {
        fileA: pathA,
        fileB: pathB,
        similarity: sim,
        cloneType,
        tokenCount: shared,
      };
      pairs.push(pair);
      involvedFiles.add(pathA);
      involvedFiles.add(pathB);

      // Emit STRUCTURALLY_SIMILAR edge into the edges table
      const edgeId = makeId('structurally_similar', rows[i].id, rows[j].id);
      try {
        insertEdge(db, {
          id: edgeId,
          sourceId: rows[i].id,
          targetId: rows[j].id,
          relation: 'STRUCTURALLY_SIMILAR',
          confidence: 'INFERRED',
          confidenceScore: sim,
          weight: sim,
        });
      } catch { /* ignore duplicate edge errors */ }
    }
  }

  const cloneRatio = totalFiles === 0 ? 0 : involvedFiles.size / totalFiles;

  return { pairs, totalFiles, cloneRatio };
}
