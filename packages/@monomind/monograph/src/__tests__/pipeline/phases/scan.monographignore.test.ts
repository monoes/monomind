import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanPhase } from '../../../pipeline/phases/scan.js';

function makeCtx(repoPath: string, ignore: string[] = []): any {
  return { repoPath, options: { ignore, codeOnly: false }, onProgress: undefined };
}

describe('scanPhase .monographignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scan-ignore-test-'));
    writeFileSync(join(tmpDir, 'app.ts'), 'export const x = 1;');
    mkdirSync(join(tmpDir, 'generated'));
    writeFileSync(join(tmpDir, 'generated', 'schema.ts'), 'export type T = string;');
    writeFileSync(join(tmpDir, 'generated', 'types.ts'), 'export type U = number;');
    mkdirSync(join(tmpDir, 'dist'));
    writeFileSync(join(tmpDir, 'dist', 'index.js'), 'module.exports = {};');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('respects .monographignore glob patterns for directories', async () => {
    writeFileSync(join(tmpDir, '.monographignore'), 'generated/\n');
    const out = await scanPhase.execute(makeCtx(tmpDir), new Map());
    const names = out.filePaths.map((p: string) => p.replace(tmpDir, ''));
    expect(names.some((n: string) => n.includes('generated'))).toBe(false);
    expect(names.some((n: string) => n.includes('app.ts'))).toBe(true);
  });

  it('works fine when .monographignore does not exist', async () => {
    const out = await scanPhase.execute(makeCtx(tmpDir), new Map());
    expect(out.filePaths.length).toBeGreaterThan(0);
  });

  it('handles empty .monographignore', async () => {
    writeFileSync(join(tmpDir, '.monographignore'), '');
    const out = await scanPhase.execute(makeCtx(tmpDir), new Map());
    expect(out.filePaths.some((p: string) => p.includes('generated'))).toBe(true);
  });

  it('ignores comment lines in .monographignore', async () => {
    writeFileSync(join(tmpDir, '.monographignore'), '# This is a comment\ngenerated/\n');
    const out = await scanPhase.execute(makeCtx(tmpDir), new Map());
    const names = out.filePaths.map((p: string) => p.replace(tmpDir, ''));
    expect(names.some((n: string) => n.includes('generated'))).toBe(false);
  });
});
