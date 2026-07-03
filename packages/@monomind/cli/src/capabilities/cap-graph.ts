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

function buildRelationships(): void {
  // Relationship 1: same directory = siblings
  const byDir = new Map<string, string[]>();
  for (const [filePath, node] of nodes) {
    const dir = node.directory;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(filePath);
  }
  for (const siblings of byDir.values()) {
    for (const a of siblings) {
      for (const b of siblings) {
        if (a !== b) {
          nodes.get(a)!.neighbors.add(b);
        }
      }
    }
  }

  // Relationship 2: same date (within 1 day) = temporal neighbors
  const nodeList = [...nodes.entries()];
  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const [pathA, nodeA] = nodeList[i];
      const [pathB, nodeB] = nodeList[j];
      const diffMs = Math.abs(nodeA.modified.getTime() - nodeB.modified.getTime());
      if (diffMs < 86400000 && nodeA.directory !== nodeB.directory) { // same day, different dir
        nodeA.neighbors.add(pathB);
        nodeB.neighbors.add(pathA);
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
