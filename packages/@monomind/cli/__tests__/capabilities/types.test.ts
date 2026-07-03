import { describe, it, expect } from 'vitest';
import type { CapabilityModule, DirectoryScan, FileEntry, Fingerprint } from '../../src/capabilities/types.js';

describe('capability types', () => {
  it('DirectoryScan has required fields', () => {
    const scan: DirectoryScan = {
      root: '/tmp/test',
      totalFiles: 100,
      git: false,
      scannedAt: new Date().toISOString(),
      capabilities: {
        code: { confidence: 0, files: 0, signals: [] },
        documents: { confidence: 0.5, files: 50, signals: ['.pdf'] },
        media: { confidence: 0, files: 0, signals: [] },
        data: { confidence: 0, files: 0, signals: [] },
        graph: { confidence: 0, files: 0, signals: [] },
        timeline: { confidence: 0, files: 0, signals: [] },
      },
      filesByExtension: { '.pdf': 50 },
    };
    expect(scan.totalFiles).toBe(100);
    expect(scan.capabilities.documents.confidence).toBe(0.5);
  });

  it('Fingerprint extends DirectoryScan with version', () => {
    const fp: Fingerprint = {
      version: 1,
      root: '/tmp/test',
      totalFiles: 0,
      git: false,
      scannedAt: new Date().toISOString(),
      capabilities: {
        code: { confidence: 0, files: 0, signals: [] },
        documents: { confidence: 0, files: 0, signals: [] },
        media: { confidence: 0, files: 0, signals: [] },
        data: { confidence: 0, files: 0, signals: [] },
        graph: { confidence: 0, files: 0, signals: [] },
        timeline: { confidence: 0, files: 0, signals: [] },
      },
      filesByExtension: {},
    };
    expect(fp.version).toBe(1);
  });
});
