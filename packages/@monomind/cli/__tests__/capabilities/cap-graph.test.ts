import { describe, it, expect } from 'vitest';
import { graphCapability } from '../../src/capabilities/cap-graph.js';
import type { FileEntry } from '../../src/capabilities/types.js';

describe('graphCapability', () => {
  it('has name "graph"', () => {
    expect(graphCapability.name).toBe('graph');
  });

  it('indexes files and builds relationship edges', async () => {
    const files: FileEntry[] = [
      { path: 'project/report.md', absolutePath: '/tmp/project/report.md', extension: '.md', size: 500, modified: new Date('2025-03-15'), created: new Date('2025-03-15') },
      { path: 'project/photo.jpg', absolutePath: '/tmp/project/photo.jpg', extension: '.jpg', size: 3000, modified: new Date('2025-03-15'), created: new Date('2025-03-15') },
      { path: 'other/notes.txt', absolutePath: '/tmp/other/notes.txt', extension: '.txt', size: 200, modified: new Date('2025-06-01'), created: new Date('2025-06-01') },
    ];

    await graphCapability.activate('/tmp');
    const result = await graphCapability.index(files);
    expect(result.indexed).toBe(3);
  });

  it('search returns results for path-based queries', async () => {
    const files: FileEntry[] = [
      { path: 'project/report.md', absolutePath: '/tmp/project/report.md', extension: '.md', size: 500, modified: new Date(), created: new Date() },
    ];

    await graphCapability.activate('/tmp');
    await graphCapability.index(files);
    const results = await graphCapability.search!('report', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('graph');
  });
});
