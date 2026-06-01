import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

// Mock the db and search modules so tests don't require a real indexed repo
vi.mock('../../src/storage/db.js', () => ({
  openDb: vi.fn(),
  closeDb: vi.fn(),
}));

vi.mock('../../src/search/hybrid-query.js', () => ({
  hybridQuery: vi.fn(),
}));

import { openDb, closeDb } from '../../src/storage/db.js';
import { hybridQuery } from '../../src/search/hybrid-query.js';
import { augmentContext } from '../../src/cli/augment.js';
import type { HybridResult } from '../../src/search/hybrid-query.js';

const mockDb = {} as ReturnType<typeof openDb>;

const sampleResults: HybridResult[] = [
  {
    id: 'n1',
    label: 'Function',
    name: 'parseFile',
    normLabel: 'parsefile',
    filePath: 'src/pipeline/phases/parse.ts',
    score: 0.95,
  },
  {
    id: 'n2',
    label: 'Class',
    name: 'ExtractionCache',
    normLabel: 'extractioncache',
    filePath: 'src/cache/extraction-cache.ts',
    score: 0.82,
  },
];

beforeEach(() => {
  vi.mocked(openDb).mockReturnValue(mockDb);
  vi.mocked(closeDb).mockImplementation(() => {});
  vi.mocked(hybridQuery).mockResolvedValue(sampleResults);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('augmentContext', () => {
  const repoPath = join(tmpdir(), 'augment-test-repo');

  it('returns a non-empty string for a simple query', async () => {
    const result = await augmentContext({ query: 'parse file', repoPath });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('markdown output contains a heading and node names', async () => {
    const result = await augmentContext({ query: 'parse file', repoPath, format: 'markdown' });
    expect(result).toContain('## Relevant Code Context');
    expect(result).toContain('parseFile');
    expect(result).toContain('ExtractionCache');
  });

  it('markdown output contains file paths', async () => {
    const result = await augmentContext({ query: 'parse file', repoPath, format: 'markdown' });
    expect(result).toContain('src/pipeline/phases/parse.ts');
    expect(result).toContain('src/cache/extraction-cache.ts');
  });

  it('format: json returns valid JSON', async () => {
    const result = await augmentContext({ query: 'parse file', repoPath, format: 'json' });
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(result); }).not.toThrow();
    const obj = parsed as Record<string, unknown>;
    expect(obj).toHaveProperty('query', 'parse file');
    expect(Array.isArray(obj['results'])).toBe(true);
  });

  it('format: json includes result fields', async () => {
    const result = await augmentContext({ query: 'cache', repoPath, format: 'json' });
    const obj = JSON.parse(result) as { results: unknown[] };
    expect(obj.results.length).toBe(2);
    const first = obj.results[0] as Record<string, unknown>;
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('filePath');
    expect(first).toHaveProperty('score');
  });

  it('topK: 0 returns empty context without calling hybridQuery', async () => {
    const result = await augmentContext({ query: 'anything', repoPath, topK: 0 });
    expect(result).toBe('');
    expect(hybridQuery).not.toHaveBeenCalled();
  });

  it('topK: 0 with json format returns valid JSON with empty results', async () => {
    const result = await augmentContext({ query: 'anything', repoPath, topK: 0, format: 'json' });
    const obj = JSON.parse(result) as { results: unknown[] };
    expect(obj.results).toHaveLength(0);
  });

  it('empty query returns empty string', async () => {
    const result = await augmentContext({ query: '', repoPath });
    expect(result).toBe('');
    expect(hybridQuery).not.toHaveBeenCalled();
  });

  it('passes topK as limit to hybridQuery', async () => {
    await augmentContext({ query: 'test', repoPath, topK: 5 });
    expect(hybridQuery).toHaveBeenCalledWith(mockDb, 'test', { limit: 5 });
  });

  it('when hybridQuery returns empty results, returns no-results message', async () => {
    vi.mocked(hybridQuery).mockResolvedValueOnce([]);
    const result = await augmentContext({ query: 'unknown_xyz', repoPath, format: 'markdown' });
    expect(result).toContain('No relevant code context found');
  });

  it('opens and closes the DB even when hybridQuery throws', async () => {
    vi.mocked(hybridQuery).mockRejectedValueOnce(new Error('db error'));
    await expect(augmentContext({ query: 'test', repoPath })).rejects.toThrow('db error');
    expect(closeDb).toHaveBeenCalledWith(mockDb);
  });
});
