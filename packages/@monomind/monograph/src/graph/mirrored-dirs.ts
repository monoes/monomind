import type { MonographDb } from '../storage/db.js';
import type { CloneFamily } from '../graph/clone-families.js';

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

export interface MirroredDirResult {
  mirrored: MirroredDirPair[];
  remaining: CloneFamily[];
}

export function detectMirroredFamilies(
  families: CloneFamily[],
  root: string,
): MirroredDirResult {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');

  function dirOf(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const rel = normalized.startsWith(normalizedRoot + '/')
      ? normalized.slice(normalizedRoot.length + 1)
      : normalized;
    const lastSlash = rel.lastIndexOf('/');
    return lastSlash === -1 ? '' : rel.slice(0, lastSlash);
  }

  function baseName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  const mirrored: MirroredDirPair[] = [];
  const remainingIndices = new Set<number>(families.map((_, i) => i));

  for (let i = 0; i < families.length; i++) {
    for (let j = i + 1; j < families.length; j++) {
      if (!remainingIndices.has(i) || !remainingIndices.has(j)) continue;

      const fa = families[i];
      const fb = families[j];

      const dirsA = new Set(fa.files.map(dirOf));
      const dirsB = new Set(fb.files.map(dirOf));

      if (dirsA.size !== 1 || dirsB.size !== 1) continue;

      const [dirA] = dirsA;
      const [dirB] = dirsB;

      if (dirA === dirB) continue;

      const namesA = new Set(fa.files.map(baseName));
      const namesB = new Set(fb.files.map(baseName));

      const shared: string[] = [];
      for (const n of namesA) {
        if (namesB.has(n)) shared.push(n);
      }
      const union = namesA.size + namesB.size - shared.length;
      if (union === 0) continue;
      const similarity = shared.length / union;

      if (similarity >= 0.5) {
        mirrored.push({
          dirA,
          dirB,
          similarity,
          sharedFileNames: shared.sort(),
          uniqueToA: namesA.size - shared.length,
          uniqueToB: namesB.size - shared.length,
        });
        remainingIndices.delete(i);
        remainingIndices.delete(j);
      }
    }
  }

  mirrored.sort((a, b) => b.similarity - a.similarity);

  return {
    mirrored,
    remaining: [...remainingIndices].map(i => families[i]),
  };
}
