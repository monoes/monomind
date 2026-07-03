import path from 'path';
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult } from './types.js';

interface GraphNode {
  path: string;
  extension: string;
  directory: string;
  modified: Date;
  neighbors: Set<string>; // paths of related files
}

const nodes = new Map<string, GraphNode>();

// Cap neighbors per node to keep memory bounded on large flat directories
const MAX_NEIGHBORS = 50;

function buildRelationships(): void {
  // Relationship 1: same directory = siblings (capped to avoid O(n²) on huge flat dirs)
  const byDir = new Map<string, string[]>();
  for (const [filePath, node] of nodes) {
    const dir = node.directory;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(filePath);
  }
  for (const siblings of byDir.values()) {
    // For large directories, only link first MAX_NEIGHBORS items to each other
    const capped = siblings.length > MAX_NEIGHBORS ? siblings.slice(0, MAX_NEIGHBORS) : siblings;
    for (const a of capped) {
      for (const b of capped) {
        if (a !== b) {
          nodes.get(a)!.neighbors.add(b);
        }
      }
    }
  }

  // Relationship 2: same date (within 1 day) = temporal neighbors
  const sorted = [...nodes.entries()].sort((a, b) => a[1].modified.getTime() - b[1].modified.getTime());
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i][1].neighbors.size >= MAX_NEIGHBORS) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const diffMs = sorted[j][1].modified.getTime() - sorted[i][1].modified.getTime();
      if (diffMs >= 86400000) break; // sorted — no further matches possible
      if (sorted[i][1].directory !== sorted[j][1].directory) {
        if (sorted[i][1].neighbors.size < MAX_NEIGHBORS) sorted[i][1].neighbors.add(sorted[j][0]);
        if (sorted[j][1].neighbors.size < MAX_NEIGHBORS) sorted[j][1].neighbors.add(sorted[i][0]);
      }
    }
  }
}

export const graphCapability: CapabilityModule = {
  name: 'graph',

  detect(_scan: DirectoryScan): number {
    return 0; // cross-cutting — activated by manager
  },

  async activate(_rootDir: string): Promise<void> {
    nodes.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    for (const file of files) {
      nodes.set(file.path, {
        path: file.path,
        extension: file.extension,
        directory: path.dirname(file.path),
        modified: file.modified,
        neighbors: new Set(),
      });
    }

    buildRelationships();

    return { indexed: files.length, skipped: 0, errors: [] };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [filePath, node] of nodes) {
      if (filePath.toLowerCase().includes(queryLower)) {
        const neighborList = [...node.neighbors].slice(0, 3);
        results.push({
          path: filePath,
          score: 1.0,
          snippet: neighborList.length > 0
            ? `Related: ${neighborList.join(', ')}`
            : `Standalone file in ${node.directory}`,
          type: 'graph',
          metadata: { neighbors: [...node.neighbors], directory: node.directory },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};
