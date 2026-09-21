/**
 * Guard for lint-coverage gap S2: every package-level test tree must be inside
 * biome's scope.
 *
 * `biome.json` used to include only `packages/{*,@monomind/*,@monoes/*}/src/**`,
 * so the package-root test trees (`packages/@monomind/cli/__tests__`,
 * `packages/@monomind/monograph/__tests__`, `packages/@monoes/monodesign/tests`,
 * ...) were silently outside it. A root `pnpm run lint` walked right past them
 * and exited 0, and naming one explicitly answered
 * "These paths were provided but ignored" — biome refusing to look, not a pass.
 *
 * This test discovers the test trees from the real repo layout (so a new
 * package's `__tests__` is covered without editing this file) and runs the real
 * `biome check` from the repo root on one test file per tree, asserting biome
 * actually processed it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require_ = createRequire(import.meta.url);

function biomeBin(): string {
  const pkgJson = require_.resolve('@biomejs/biome/package.json');
  const { bin } = require_(pkgJson) as { bin: string | Record<string, string> };
  return join(dirname(pkgJson), typeof bin === 'string' ? bin : bin.biome);
}

/** Package roots: `packages/<pkg>` and `packages/@scope/<pkg>`. */
function packageRoots(): string[] {
  const pkgsDir = join(REPO_ROOT, 'packages');
  const roots: string[] = [];
  for (const name of readdirSync(pkgsDir)) {
    const full = join(pkgsDir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith('@')) {
      for (const sub of readdirSync(full)) {
        if (statSync(join(full, sub)).isDirectory()) roots.push(join(full, sub));
      }
    } else {
      roots.push(full);
    }
  }
  return roots;
}

/** First `*.test.{ts,mts,mjs,js,tsx}` file found under `dir`, skipping fixtures. */
function firstTestFile(dir: string): string | undefined {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'fixtures' || entry === 'node_modules' || entry.startsWith('._')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = firstTestFile(full);
      if (found) return found;
    } else if (/\.test\.(ts|mts|mjs|js|tsx)$/.test(entry)) {
      return full;
    }
  }
  return undefined;
}

/** One probe file per package-root test tree (`__tests__/` or `tests/`). */
function testTreeProbes(): string[] {
  const probes: string[] = [];
  for (const root of packageRoots()) {
    for (const tree of ['__tests__', 'tests']) {
      const dir = join(root, tree);
      if (!existsSync(dir)) continue;
      const file = firstTestFile(dir);
      if (file) probes.push(relative(REPO_ROOT, file).split('\\').join('/'));
    }
  }
  return probes;
}

function biomeCheck(file: string): string {
  try {
    return execFileSync(process.execPath, [biomeBin(), 'check', file], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

describe('biome.json covers package test trees (lint gap S2)', () => {
  const probes = testTreeProbes();

  it('discovers the package test trees', () => {
    // cli, monograph, hooks, mcp, monofence-ai, monodesign at the time of writing.
    expect(probes.length).toBeGreaterThanOrEqual(6);
    expect(probes).toContain('packages/@monomind/cli/__tests__/api-contracts.test.ts');
  });

  it.each(probes)('biome processes %s', (file) => {
    const out = biomeCheck(file);
    expect(out).not.toMatch(/These paths were provided but ignored/);
    expect(out).not.toMatch(/No files were processed/);
    expect(out).toMatch(/Checked 1 file/);
  });
});

// monodesign ships no `src/`; its code lives in cli/, skill/ and scripts/,
// which the src/** globs never reached. One probe each.
const MONODESIGN_CODE = [
  'packages/@monoes/monodesign/cli/engine/rules/checks.mjs',
  'packages/@monoes/monodesign/skill/scripts/context.mjs',
  'packages/@monoes/monodesign/scripts/sync-skill.mjs',
];

describe('biome.json covers monodesign code outside src/', () => {
  it.each(MONODESIGN_CODE)('biome processes %s', (file) => {
    expect(existsSync(join(REPO_ROOT, file))).toBe(true);
    const out = biomeCheck(file);
    expect(out).not.toMatch(/These paths were provided but ignored/);
    expect(out).toMatch(/Checked 1 file/);
  });
});
