/**
 * scripts/install-hooks.mjs registers the CHANGELOG.md merge driver that
 * .gitattributes assigns, idempotently, so it no longer needs a manual
 * `pnpm run setup:merge-drivers`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const { registerChangelogMergeDriver, CHANGELOG_DRIVER } = await import(
  path.join(REPO_ROOT, 'scripts/install-hooks.mjs')
);

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'install-hooks-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const get = (dir, key) =>
  execFileSync('git', ['config', '--get', `merge.monomind-changelog.${key}`], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();

describe('registerChangelogMergeDriver', () => {
  it('sets name and driver, then is a no-op on the second run', () => {
    const dir = scratchRepo();
    expect(registerChangelogMergeDriver(dir)).toEqual(['name', 'driver']);
    expect(get(dir, 'driver')).toBe(CHANGELOG_DRIVER.driver);
    expect(registerChangelogMergeDriver(dir)).toEqual([]);
  });

  it('matches the manual setup:merge-drivers script', () => {
    const pkg = JSON.parse(
      execFileSync('cat', [path.join(REPO_ROOT, 'package.json')], { encoding: 'utf8' }),
    );
    const manual = pkg.scripts['setup:merge-drivers'];
    expect(manual).toContain(CHANGELOG_DRIVER.name);
    expect(manual).toContain(CHANGELOG_DRIVER.driver);
  });
});
