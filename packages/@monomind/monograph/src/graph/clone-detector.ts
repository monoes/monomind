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

/**
 * Compute both Jaccard similarity and shared token count in a single pass.
 * Avoids building the countA Map twice (previously done separately in
 * jaccardSimilarity and sharedTokenCount).
 */
function computeSimilarityAndShared(a: string[], b: string[]): { similarity: number; shared: number } {
  const countA = new Map<string, number>();
  for (const t of a) countA.set(t, (countA.get(t) ?? 0) + 1);

  let intersection = 0;
  const seen = new Map<string, number>();
  for (const t of b) {
    const limit = countA.get(t) ?? 0;
    const used = seen.get(t) ?? 0;
    if (used < limit) {
      intersection++;
      seen.set(t, used + 1);
    }
  }

  const union = a.length + b.length - intersection;
  const similarity = union === 0 ? 1 : intersection / union;
  return { similarity, shared: intersection };
}

export function detectClones(
  db: MonographDb,
  minSimilarity = 0.8,
  minTokens = 2,
): CloneDetectionResult {
  // Query all File nodes with file_path
  const rows = db
    .prepare(`SELECT id, file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`)
    .all() as { id: string; file_path: string }[];

  const totalFiles = rows.length;
  const pairs: ClonePair[] = [];
  const involvedFiles = new Set<string>();

  // Pre-compute path tokens and name tokens for each file
  const tokenMap = new Map<string, { pathTokens: string[]; nameTokens: string[] }>();
  for (const row of rows) {
    const pathTokens = tokenizePath(row.file_path);
    const nameTokens = tokenizePath(baseName(row.file_path));
    tokenMap.set(row.file_path, { pathTokens, nameTokens });
  }

  // Compare all pairs
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const pathA = rows[i].file_path;
      const pathB = rows[j].file_path;
      const entryA = tokenMap.get(pathA)!;
      const entryB = tokenMap.get(pathB)!;

      const { similarity: sim, shared } = computeSimilarityAndShared(entryA.pathTokens, entryB.pathTokens);

      if (sim < minSimilarity || shared < minTokens) {
        // Also check near-duplicate file names (same name, different dir)
        const { similarity: nameSim, shared: nameShared } = computeSimilarityAndShared(entryA.nameTokens, entryB.nameTokens);

        if (nameSim >= minSimilarity && nameShared >= Math.min(minTokens, entryA.nameTokens.length)) {
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
