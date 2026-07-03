import { describe, it, expect } from 'vitest';
import { timelineCapability } from '../../src/capabilities/cap-timeline.js';
import type { FileEntry } from '../../src/capabilities/types.js';

describe('timelineCapability', () => {
  it('has name "timeline"', () => {
    expect(timelineCapability.name).toBe('timeline');
  });

  it('indexes files by their dates', async () => {
    const files: FileEntry[] = [
      {
        path: 'report-2025-03.pdf',
        absolutePath: '/tmp/test/report-2025-03.pdf',
        extension: '.pdf',
        size: 1000,
        modified: new Date('2025-03-15'),
        created: new Date('2025-03-10'),
      },
      {
        path: 'photo-summer.jpg',
        absolutePath: '/tmp/test/photo-summer.jpg',
        extension: '.jpg',
        size: 5000,
        modified: new Date('2025-07-20'),
        created: new Date('2025-07-20'),
      },
    ];

    await timelineCapability.activate('/tmp/test');
    const result = await timelineCapability.index(files);
    expect(result.indexed).toBe(2);
  });

  it('search with date terms returns timeline results', async () => {
    const files: FileEntry[] = [
      {
        path: 'notes-march.md',
        absolutePath: '/tmp/test/notes-march.md',
        extension: '.md',
        size: 200,
        modified: new Date('2025-03-15'),
        created: new Date('2025-03-15'),
      },
    ];

    await timelineCapability.activate('/tmp/test');
    await timelineCapability.index(files);
    const results = await timelineCapability.search!('march 2025', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('timeline');
  });
});
