/**
 * #328: doctor reports what the hooks see — whether they can find
 * @monoes/monograph and load its better-sqlite3, and whether the graph has
 * gone past the 50-commit limit where the grep gate and hints switch off.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkHookMonograph } from '../commands/doctor-hook-monograph-checks.js';

const NOWHERE = { globalRoot: null, npxCacheDir: '/nonexistent-npx-cache', pathEnv: '' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doctor-hook-mg-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function graphBehind(extra: number): void {
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'c0');
  const first = git('rev-parse', 'HEAD');
  for (let i = 0; i < extra; i++) git('commit', '-q', '--allow-empty', '-m', `c${i + 1}`);
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  mkdirSync(join(dir, '.monomind'), { recursive: true });
  const db = new DatabaseSync(join(dir, '.monomind', 'monograph.db'));
  db.exec('CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare("INSERT INTO index_meta VALUES ('last_commit_hash', ?)").run(first);
  db.close();
}

// A fake global @monoes/monograph with no better-sqlite3 next to it — what a
// global install on current npm leaves behind when allowScripts skips the build.
function globalWithoutNativeAddon(): string {
  const root = join(dir, 'global');
  const pkg = join(root, '@monoes', 'monograph');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: '@monoes/monograph', version: '1.6.9', main: 'dist/index.js' }),
  );
  writeFileSync(join(pkg, 'dist', 'index.js'), 'export {};\n');
  return root;
}

describe('checkHookMonograph', () => {
  it('fails when the graph is past 50 commits and the hooks cannot find the package', async () => {
    graphBehind(51);
    const check = await checkHookMonograph(dir, NOWHERE);
    expect(check.status).toBe('fail');
    expect(check.message).toContain('51 commits behind');
    expect(check.message).toContain('@monoes/monograph not found by the hooks');
    expect(check.fix).toBe('npm i -g --allow-scripts=better-sqlite3 @monoes/monograph');
  }, 30000);

  it('warns when the package is not resolvable even if the graph is fresh', async () => {
    graphBehind(0);
    const check = await checkHookMonograph(dir, NOWHERE);
    expect(check.status).toBe('warn');
    expect(check.message).toContain('@monoes/monograph not found by the hooks');
  });

  it('reports an unbuilt better-sqlite3 with the allow-scripts fix', async () => {
    graphBehind(0);
    const check = await checkHookMonograph(dir, {
      ...NOWHERE,
      globalRoot: globalWithoutNativeAddon(),
    });
    expect(check.status).toBe('warn');
    expect(check.message).toContain('better-sqlite3');
    expect(check.fix).toBe('npm i -g --allow-scripts=better-sqlite3 @monoes/monograph');
  });

  it('passes when the hooks can rebuild through the monomind CLI and the graph is fresh', async () => {
    graphBehind(0);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'monomind'), '#!/bin/sh\n');
    const check = await checkHookMonograph(dir, { ...NOWHERE, pathEnv: join(dir, 'bin') });
    expect(check.status).toBe('pass');
    expect(check.message).toContain('monomind monograph build');
  });

  it('warns that the gate is off when the graph is past 50 commits but can rebuild', async () => {
    graphBehind(51);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'monomind'), '#!/bin/sh\n');
    const check = await checkHookMonograph(dir, { ...NOWHERE, pathEnv: join(dir, 'bin') });
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(/51 commits behind HEAD \(limit 50\).*gate/);
  }, 30000);
});
