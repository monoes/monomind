/**
 * Publish guard: a `workspace:*` pin must resolve to a version that is on npm.
 *
 * ## The failure this pins
 *
 * 2.11.10 and 2.11.11 both shipped depending on `@monoes/monograph@1.6.6`,
 * which did not exist on the registry — monograph was bumped in the repo for
 * the #298 hooksPath fix and never published. Both releases were
 * uninstallable; every consumer died at resolution with
 * `No matching version found for @monoes/monograph@1.6.6`.
 *
 * It is the exact mirror of check-package-bumps.mjs: that guard proves a
 * changed package WAS bumped, and the bump is what strands the pin until
 * someone publishes it. They only work as a pair.
 *
 * These cases are offline by construction. The registry lookup is exercised
 * through the escape hatch and through a manifest that has no workspace pins,
 * so the suite neither needs the network nor pays the guard's propagation
 * backoff — the lookup path itself is covered by the release flow, which
 * cannot publish without it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-published-pins.mjs');

const run = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('node', [GUARD, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...env },
  });

const temps: string[] = [];
function scratchPackage(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'published-pins-'));
  temps.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop() as string, { recursive: true, force: true });
});

describe('workspace:* pins must be resolvable on npm', () => {
  it('is wired into both publish paths, or it never runs', () => {
    const root = JSON.parse(
      execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }),
    );
    const cli = JSON.parse(
      execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], {
        cwd: join(REPO_ROOT, 'packages', '@monomind', 'cli'),
        encoding: 'utf8',
      }),
    );
    expect(root.scripts.prepublishOnly).toContain('check-published-pins.mjs');
    expect(cli.scripts.prepublishOnly).toContain('check-published-pins.mjs');
  });

  it('passes a package with no workspace:* dependencies without touching the registry', () => {
    const dir = scratchPackage({
      name: 'no-workspace-pins',
      version: '1.0.0',
      dependencies: { vitest: '^4.0.0' },
    });
    expect(run([dir])).toContain('no workspace:* dependencies');
  });

  it('honours the escape hatch, for publishing to an unreachable registry', () => {
    const out = run([join(REPO_ROOT, 'packages', '@monomind', 'cli')], {
      MONOMIND_ALLOW_UNPUBLISHED_PINS: '1',
    });
    expect(out).toContain('skipped');
    expect(out).toContain('@monoes/monograph@');
  });

  it('refuses a workspace: pin naming a package no workspace declares', () => {
    const dir = scratchPackage({
      name: 'dangling-pin',
      version: '1.0.0',
      dependencies: { '@monoes/does-not-exist': 'workspace:*' },
    });
    expect(() => run([dir])).toThrow();
    try {
      run([dir]);
    } catch (err) {
      const text = `${(err as { stdout?: string }).stdout ?? ''}${(err as { stderr?: string }).stderr ?? ''}`;
      expect(text).toContain('no workspace package declares that name');
    }
  });
});
