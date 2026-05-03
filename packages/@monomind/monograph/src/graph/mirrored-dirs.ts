import type { MonographDb } from '../storage/db.js';

export interface MirroredDirPair {
  dirA: string;
  dirB: string;
  similarity: number;         // 0-1, file name overlap ratio
  sharedFileNames: string[];  // basenames that appear in both
  uniqueToA: number;
  uniqueToB: number;
}

export interface MirroredDirsReport {
  pairs: MirroredDirPair[];
  totalDirsAnalyzed: number;
}

/**
 * Detect directory subtrees that are structural mirrors of each other.
 * Uses Jaccard similarity of file basenames within each directory.
 *
 * @param db - monograph database
 * @param minSimilarity - minimum Jaccard similarity threshold (default 0.7)
 */
export function detectMirroredDirs(db: MonographDb, minSimilarity = 0.7): MirroredDirsReport {
  // Query all File nodes with a file_path
  const rows = db.prepare(
    `SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`,
  ).all() as { file_path: string }[];

  // Build map: dirPath → Set<basename>
  const dirMap = new Map<string, Set<string>>();
  for (const { file_path } of rows) {
    const lastSlash = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'));
    if (lastSlash === -1) continue;
    const dir = file_path.slice(0, lastSlash);
    const base = file_path.slice(lastSlash + 1);
    if (!dirMap.has(dir)) dirMap.set(dir, new Set());
    dirMap.get(dir)!.add(base);
  }

  const dirs = [...dirMap.keys()];
  const pairs: MirroredDirPair[] = [];

  // Compare each pair of directories
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const dirA = dirs[i];
      const dirB = dirs[j];
      const setA = dirMap.get(dirA)!;
      const setB = dirMap.get(dirB)!;

      // Only compare directories that share a parent OR one is a suffix of the other
      const parentA = dirA.slice(0, Math.max(dirA.lastIndexOf('/'), dirA.lastIndexOf('\\')));
      const parentB = dirB.slice(0, Math.max(dirB.lastIndexOf('/'), dirB.lastIndexOf('\\')));
      const relatedDirs = parentA === parentB
        || dirA.endsWith(dirB)
        || dirB.endsWith(dirA)
        || dirA.includes(dirB)
        || dirB.includes(dirA);
      if (!relatedDirs) continue;

      // Compute Jaccard similarity
      const shared: string[] = [];
      for (const name of setA) {
        if (setB.has(name)) shared.push(name);
      }
      const union = setA.size + setB.size - shared.length;
      if (union === 0) continue;
      const similarity = shared.length / union;

      if (similarity >= minSimilarity) {
        pairs.push({
          dirA,
          dirB,
          similarity,
          sharedFileNames: shared.sort(),
          uniqueToA: setA.size - shared.length,
          uniqueToB: setB.size - shared.length,
        });
      }
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => b.similarity - a.similarity);

  return {
    pairs,
    totalDirsAnalyzed: dirs.length,
  };
}
