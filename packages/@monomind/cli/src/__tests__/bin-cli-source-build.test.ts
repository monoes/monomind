import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSourceBuildFresh, writeSourceBuildMarker } from '../../bin/source-build.js';
import { mkdtempSync } from './tmp-track.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'cli-source-build-'));
  mkdirSync(join(root, 'src', 'orgrt'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export {};\n');
  writeFileSync(join(root, 'src', 'orgrt', 'skill-tools.ts'), 'export {};\n');
  return root;
}

describe('source-checkout build freshness', () => {
  it('rejects a source checkout with no completed-build marker', () => {
    const root = fixture();
    expect(() => assertSourceBuildFresh(root)).toThrow('pnpm --filter @monoes/monomindcli build');
  });

  it('accepts a completed build and rejects a later source edit', () => {
    const root = fixture();
    writeSourceBuildMarker(root);
    expect(() => assertSourceBuildFresh(root)).not.toThrow();

    const future = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'src', 'orgrt', 'skill-tools.ts'), future, future);
    expect(() => assertSourceBuildFresh(root)).toThrow('stale or missing CLI build');
  });

  it('does not require source files in a published package', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-published-'));
    expect(() => assertSourceBuildFresh(root)).not.toThrow();
  });

  it('is enforced by the CLI entrypoint', () => {
    const bin = readFileSync(join(import.meta.dirname, '../../bin/cli.js'), 'utf8');
    expect(bin).toContain("import { assertSourceBuildFresh } from './source-build.js'");
    expect(bin).toContain("assertSourceBuildFresh(fileURLToPath(new URL('..', import.meta.url)))");
  });
});
