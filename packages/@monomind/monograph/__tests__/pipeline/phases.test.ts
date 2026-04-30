import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { scanPhase } from '../../src/pipeline/phases/scan.js';
import { structurePhase } from '../../src/pipeline/phases/structure.js';
import type { PipelineContext } from '../../src/pipeline/types.js';

const tmpRepo = join(tmpdir(), `monograph-test-repo-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(join(tmpRepo, 'src', 'index.ts'), 'export const x = 1;');
  writeFileSync(join(tmpRepo, 'src', 'util.py'), 'def helper(): pass');
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

const ctx = {
  repoPath: tmpRepo,
  onProgress: vi.fn(),
  options: { codeOnly: false, ignore: [], maxFileSizeBytes: 524288, workerPoolThreshold: 15, workerChunkBudgetBytes: 20971520 },
} as unknown as PipelineContext;

describe('scan phase', () => {
  it('finds source files', async () => {
    const outputs = new Map<string, unknown>();
    const result = await scanPhase.execute(ctx, outputs) as { filePaths: string[] };
    expect(result.filePaths.length).toBeGreaterThan(0);
    expect(result.filePaths.some(p => p.endsWith('index.ts'))).toBe(true);
  });
});

describe('structure phase', () => {
  it('creates File and Folder nodes', async () => {
    const outputs = new Map<string, unknown>();
    const scanOutput = await scanPhase.execute(ctx, outputs);
    outputs.set('scan', scanOutput);
    const result = await structurePhase.execute(ctx, outputs) as { fileNodes: unknown[] };
    expect(result.fileNodes.length).toBeGreaterThan(0);
  });
});
