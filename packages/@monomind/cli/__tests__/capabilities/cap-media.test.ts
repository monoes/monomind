import { describe, it, expect } from 'vitest';
import { mediaCapability } from '../../src/capabilities/cap-media.js';
import type { DirectoryScan, FileEntry } from '../../src/capabilities/types.js';
import path from 'path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'photos');

function makeScan(mediaConfidence: number): DirectoryScan {
  return {
    root: FIXTURES,
    totalFiles: 10,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: mediaConfidence, files: 5, signals: ['.jpg', '.png'] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: { '.png': 1 },
  };
}

describe('mediaCapability', () => {
  it('has name "media"', () => {
    expect(mediaCapability.name).toBe('media');
  });

  it('returns scan confidence from detect', () => {
    expect(mediaCapability.detect(makeScan(0.6))).toBe(0.6);
  });

  it('indexes image files with metadata', async () => {
    const files: FileEntry[] = [
      {
        path: 'sample.png',
        absolutePath: path.join(FIXTURES, 'sample.png'),
        extension: '.png',
        size: 68,
        modified: new Date(),
        created: new Date(),
      },
    ];

    const result = await mediaCapability.index(files);
    expect(result.indexed).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  it('search returns results matching filename', async () => {
    await mediaCapability.activate(FIXTURES);
    const files: FileEntry[] = [
      {
        path: 'sample.png',
        absolutePath: path.join(FIXTURES, 'sample.png'),
        extension: '.png',
        size: 68,
        modified: new Date(),
        created: new Date(),
      },
    ];
    await mediaCapability.index(files);

    const results = await mediaCapability.search!('sample', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('media');
  });
});
