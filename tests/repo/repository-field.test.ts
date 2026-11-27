/**
 * Every publishable package must declare repository.url = this GitHub repo,
 * or `npm publish --provenance` fails with E422 (2.29.5).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-repository-field.mjs');
const URL = 'git+https://github.com/monoes/monomind.git';

const temps: string[] = [];
const run = (root: string) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

function workspace(pkgs: Record<string, unknown>[]): string {
  const root = mkdtempSync(join(tmpdir(), 'repo-field-'));
  temps.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'umbrella', repository: { type: 'git', url: URL } }),
  );
  for (const [i, pkg] of pkgs.entries()) {
    const dir = join(root, 'packages', '@scope', `p${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  }
  return root;
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop() as string, { recursive: true, force: true });
});

describe('publishable packages declare the GitHub repository', () => {
  it('this repository passes', () => {
    const r = run(REPO_ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('flags a package with no repository, naming it', () => {
    const r = run(workspace([{ name: '@scope/bare', version: '1.0.0' }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('@scope/bare');
  });

  it('flags an empty or foreign repository url', () => {
    const empty = run(workspace([{ name: '@scope/a', repository: { type: 'git', url: '' } }]));
    expect(empty.status).toBe(1);
    const foreign = run(
      workspace([
        {
          name: '@scope/b',
          repository: {
            type: 'git',
            url: 'git+https://github.com/Monoes/monomind.git',
            directory: 'packages/@scope/p0',
          },
        },
      ]),
    );
    expect(foreign.status).toBe(1);
  });

  it('flags a wrong directory', () => {
    const r = run(
      workspace([
        { name: '@scope/c', repository: { type: 'git', url: URL, directory: 'packages/other' } },
      ]),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('directory');
  });

  it('accepts a correct package and ignores private ones', () => {
    const r = run(
      workspace([
        {
          name: '@scope/ok',
          repository: { type: 'git', url: URL, directory: 'packages/@scope/p0' },
        },
        { name: '@scope/priv', private: true },
      ]),
    );
    expect(r.status).toBe(0);
  });
});
