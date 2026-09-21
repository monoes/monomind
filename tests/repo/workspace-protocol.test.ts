/**
 * Publish guard: a dependency on a sibling workspace package must use the
 * `workspace:` protocol, never a registry range.
 *
 * ## The failure this pins
 *
 * check-package-bumps.mjs and check-published-pins.mjs are a matched pair, and
 * both rest on one premise, stated in the first of them: "every sibling package
 * is pinned as `workspace:*`, which pnpm rewrites at pack time to the version
 * that package currently declares." That is what makes a missing bump visible
 * (the pin would resolve to the old tarball) and a stranded bump visible (the
 * pin would name a version not on npm).
 *
 * A sibling pinned by registry range instead — `"@monoes/monobrowse": "^1.0.6"`
 * — silently opts out of both. pnpm leaves the range alone at pack time, so the
 * published CLI resolves whatever the registry currently offers, and the
 * workspace copy never reaches a consumer at all. Neither guard can see it:
 * check-package-bumps asks only whether the version was bumped, which it may
 * well have been, and check-published-pins iterates `workspace:` pins, which
 * this is not.
 *
 * Found live on 2026-09-21: `@monoes/monodesign` was 1.2.10 in the workspace
 * and 1.2.9 on npm, while the CLI's `^1.2.2` resolved to the published 1.2.9.
 * That delta happened to be a single test file, so nothing shipped wrong — but
 * it is the 2.11.4 monograph incident's exact shape, and it reached a published
 * release (2.14.0) with every existing guard green.
 *
 * Running it in the suite, not only at prepublishOnly, is the point: by release
 * time the wrong dependency edge has already been published.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-workspace-protocol.mjs');

const run = (args: string[] = [], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('node', [GUARD, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, MONOMIND_ALLOW_REGISTRY_SIBLINGS: '', ...env },
  });

const temps: string[] = [];

/** A throwaway workspace: a root manifest plus packages/<scope>/<name>/. */
function scratchWorkspace(pkgs: Array<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'workspace-protocol-'));
  temps.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'umbrella', version: '1.0.0', private: true }, null, 2),
  );
  for (const pkg of pkgs) {
    const dir = join(root, 'packages', '@scope', String(pkg.name).replace(/^@scope\//, ''));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  }
  return root;
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop() as string, { recursive: true, force: true });
});

describe('sibling workspace packages are depended on by workspace: protocol', () => {
  it('this repository passes', () => {
    expect(() => run()).not.toThrow();
  });

  it('flags a registry range pointing at a sibling, and names the edge', () => {
    const root = scratchWorkspace([
      { name: '@scope/lib', version: '1.0.12', dependencies: {} },
      { name: '@scope/app', version: '2.0.0', dependencies: { '@scope/lib': '^1.0.6' } },
    ]);
    try {
      run([root]);
      throw new Error('guard passed a registry-ranged sibling dependency');
    } catch (err) {
      const out = String((err as { stderr?: string }).stderr ?? (err as Error).message);
      expect(out).toContain('@scope/app');
      expect(out).toContain('@scope/lib');
      expect(out).toContain('^1.0.6');
      expect(out).toContain('workspace:*');
    }
  });

  it('accepts the workspace protocol in every form', () => {
    const root = scratchWorkspace([
      { name: '@scope/lib', version: '1.0.12' },
      {
        name: '@scope/app',
        version: '2.0.0',
        dependencies: { '@scope/lib': 'workspace:*' },
        devDependencies: { '@scope/lib': 'workspace:^' },
      },
    ]);
    expect(() => run([root])).not.toThrow();
  });

  it('checks optionalDependencies too — an optional sibling goes stale the same way', () => {
    const root = scratchWorkspace([
      { name: '@scope/lib', version: '1.0.12' },
      { name: '@scope/app', version: '2.0.0', optionalDependencies: { '@scope/lib': '^1.0.2' } },
    ]);
    expect(() => run([root])).toThrow();
  });

  it('ignores a third-party dependency that merely resembles a sibling', () => {
    const root = scratchWorkspace([
      { name: '@scope/lib', version: '1.0.12' },
      {
        name: '@scope/app',
        version: '2.0.0',
        dependencies: { '@other/lib': '^1.0.6', vitest: '^3.0.0' },
      },
    ]);
    expect(() => run([root])).not.toThrow();
  });

  it('ignores a private sibling — it is never published, so nothing can go stale', () => {
    const root = scratchWorkspace([
      { name: '@scope/lib', version: '1.0.12', private: true },
      { name: '@scope/app', version: '2.0.0', dependencies: { '@scope/lib': '^1.0.6' } },
    ]);
    expect(() => run([root])).not.toThrow();
  });

  it('honours the escape hatch, so a deliberate exception is not a hard block', () => {
    const root = scratchWorkspace([
      { name: '@scope/lib', version: '1.0.12' },
      { name: '@scope/app', version: '2.0.0', dependencies: { '@scope/lib': '^1.0.6' } },
    ]);
    const out = run([root], { MONOMIND_ALLOW_REGISTRY_SIBLINGS: '1' });
    expect(out).toContain('skipped');
  });
});
