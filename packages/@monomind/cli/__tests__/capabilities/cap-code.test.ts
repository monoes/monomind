import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { codeCapability } from '../../src/capabilities/cap-code.js';
import type { DirectoryScan } from '../../src/capabilities/types.js';

const ftsSearch = vi.fn();
vi.mock('@monoes/monograph', () => ({
  openDb: vi.fn(() => ({})),
  closeDb: vi.fn(),
  ftsSearch: (...args: unknown[]) => ftsSearch(...args),
}));

/** A project dir whose monograph DB exists (content is irrelevant — monograph is mocked). */
function makeIndexedDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-cap-code-'));
  fs.mkdirSync(path.join(dir, '.monomind'));
  fs.writeFileSync(path.join(dir, '.monomind', 'monograph.db'), '');
  return dir;
}

function makeScan(overrides: Partial<DirectoryScan['capabilities']['code']> = {}): DirectoryScan {
  return {
    root: '/tmp/test',
    totalFiles: 100,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [], ...overrides },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: {},
  };
}

describe('codeCapability', () => {
  it('has name "code"', () => {
    expect(codeCapability.name).toBe('code');
  });

  it('returns high confidence for code project', () => {
    const scan = makeScan({ confidence: 0.7, files: 50, signals: ['package.json', '.ts'] });
    expect(codeCapability.detect(scan)).toBe(0.7);
  });

  it('returns low confidence for non-code', () => {
    const scan = makeScan({ confidence: 0.02, files: 1, signals: [] });
    expect(codeCapability.detect(scan)).toBe(0.02);
  });

  it('activate does not throw', async () => {
    await expect(codeCapability.activate('/tmp/test')).resolves.not.toThrow();
  });

  it('provides health checks', async () => {
    expect(codeCapability.healthChecks).toBeDefined();
  });

  describe('with a monograph index', () => {
    let dir: string;
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('is detected even when the fingerprint saw no code files (e.g. taken at init)', () => {
      dir = makeIndexedDir();
      const scan = { ...makeScan({ confidence: 0, files: 0 }), root: dir };
      expect(codeCapability.detect(scan)).toBeGreaterThanOrEqual(0.1);
    });

    it('scores hits by rank position on the same 0..1 scale as other capabilities', async () => {
      dir = makeIndexedDir();
      // Real FTS5 bm25 ranks on a small index are ~-1e-6, far below every
      // other capability's 0.5..1 scores.
      ftsSearch.mockReturnValue([
        { name: 'QaSym', label: 'Function', filePath: 'a.js', startLine: 1, rank: -1.2e-6 },
        { name: 'QaSym', label: 'Process', filePath: 'a.js', rank: -1.1e-6 },
      ]);
      await codeCapability.activate(dir);
      const results = await codeCapability.search?.('QaSym', 20);
      expect(results?.map((r) => r.score)).toEqual([1, 0.5]);
      expect(results?.[0].snippet).toBe('Function QaSym (line 1)');
    });
  });
});
