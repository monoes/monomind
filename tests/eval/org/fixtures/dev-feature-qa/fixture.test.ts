// The approved dev-feature-qa fixture: it builds
// reproducibly to the pinned commit, its own tests pass, the hidden acceptance
// tests fail on it (so they measure the feature, not nothing), and a reference
// solution passes both (so the task is solvable and the tests fair).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const build = (): string => {
  const out = join(mkdtempSync(join(tmpdir(), 'fixture-')), 'repo');
  execFileSync('node', [join(here, 'build-fixture.mjs'), out], { encoding: 'utf8' });
  return out;
};
const nodeTest = (cwd: string) =>
  spawnSync('node', ['--test', 'test/*.check.mjs'], { cwd, encoding: 'utf8' });
const proposed = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));

describe('dev-feature-qa fixture (approved)', () => {
  it('builds to the pinned commit every time', () => {
    const head = (repo: string) =>
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(head(build())).toBe(proposed.fixture.pinned_commit);
    expect(head(build())).toBe(proposed.fixture.pinned_commit);
  });

  it('passes its own tests, and fails the hidden acceptance tests until the feature exists', () => {
    const repo = build();
    expect(nodeTest(repo).status).toBe(0);
    copyFileSync(
      join(here, 'hidden/acceptance.check.mjs'),
      join(repo, 'test/acceptance.check.mjs'),
    );
    expect(nodeTest(repo).status).not.toBe(0);
  });

  it('passes both once the reference solution is in', () => {
    const repo = build();
    copyFileSync(join(here, 'hidden/reference/duration.mjs'), join(repo, 'src/duration.mjs'));
    copyFileSync(
      join(here, 'hidden/acceptance.check.mjs'),
      join(repo, 'test/acceptance.check.mjs'),
    );
    const r = nodeTest(repo);
    expect(r.stdout + r.stderr).not.toMatch(/not ok/);
    expect(r.status).toBe(0);
  });
});
