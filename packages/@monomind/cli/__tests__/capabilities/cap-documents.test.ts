import { describe, it, expect } from 'vitest';
import { documentsCapability } from '../../src/capabilities/cap-documents.js';
import type { DirectoryScan, FileEntry } from '../../src/capabilities/types.js';
import path from 'path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'documents');

function makeScan(docConfidence: number): DirectoryScan {
  return {
    root: FIXTURES,
    totalFiles: 10,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: docConfidence, files: 5, signals: ['.md', '.txt'] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: { '.md': 3, '.txt': 2 },
  };
}

describe('documentsCapability', () => {
  it('has name "documents"', () => {
    expect(documentsCapability.name).toBe('documents');
  });

  it('returns scan confidence from detect', () => {
    expect(documentsCapability.detect(makeScan(0.7))).toBe(0.7);
  });

  it('indexes markdown and text files (T0 metadata)', async () => {
    const files: FileEntry[] = [
      {
        path: 'readme.md',
        absolutePath: path.join(FIXTURES, 'readme.md'),
        extension: '.md',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
      {
        path: 'notes.txt',
        absolutePath: path.join(FIXTURES, 'notes.txt'),
        extension: '.txt',
        size: 50,
        modified: new Date(),
        created: new Date(),
      },
    ];

    const result = await documentsCapability.index(files);
    expect(result.indexed).toBe(2);
    expect(result.errors.length).toBe(0);
  });

  it('search returns results for indexed content', async () => {
    await documentsCapability.activate(FIXTURES);

    const files: FileEntry[] = [
      {
        path: 'readme.md',
        absolutePath: path.join(FIXTURES, 'readme.md'),
        extension: '.md',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];
    await documentsCapability.index(files);

    const results = await documentsCapability.search!('test document', 5);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.type).toBe('documents');
    }
  });
});
