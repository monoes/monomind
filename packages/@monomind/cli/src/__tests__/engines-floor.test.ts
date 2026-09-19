import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

/**
 * i-090: every PUBLISHED workspace package must require the same Node floor
 * as its own dependencies already do (puppeteer 25.3.0 and ai 7.0.59 both
 * declare `>=22.12.0` today; the root `.npmrc` sets `engine-strict=true`).
 * Before this item, engines.node was `>=20.0.0` in some manifests, `>=18.0.0`
 * in others, and absent in four published packages entirely — a floor a
 * package's own tooling already didn't honour.
 *
 * Scope is published workspace packages only: `packages/<scope>/<name>/` and
 * `packages/<name>/` two levels deep, the same shape
 * scripts/pack-workspace-closure.mjs uses to find publishable packages, which
 * — unlike an unbounded packages/**glob — does not reach into a package's own
 * __tests__/fixtures (e.g. the CLI's
 * __tests__/capabilities/fixtures/code-project/package.json, a fixture named
 * "test" with no `private` flag, which must never be treated as published).
 */
function publishedWorkspacePackages(): Array<{ dir: string; pkg: any }> {
  const out: Array<{ dir: string; pkg: any }> = [];
  const scopesDir = join(REPO_ROOT, 'packages');
  for (const scope of readdirSync(scopesDir, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(scopesDir, scope.name);
    const directManifest = join(scopeDir, 'package.json');
    const candidateDirs = existsSync(directManifest)
      ? [scopeDir]
      : readdirSync(scopeDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(scopeDir, e.name));
    for (const dir of candidateDirs) {
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.private === true) continue;
      out.push({ dir, pkg });
    }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

describe('every published package declares the Node >=22.12.0 floor', () => {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const packages = publishedWorkspacePackages();

  it('finds the ten published manifests this item covers (root + 9 workspace packages)', () => {
    // A change in this count means a package was added or removed — report it
    // to dev-lead before adjusting the number, per the plan's classification
    // rule; do not silently accept an eleventh manifest here.
    expect(packages.length).toBe(9);
  });

  it('declares engines.node ">=22.12.0" on the root umbrella', () => {
    expect(root.engines?.node).toBe('>=22.12.0');
  });

  it.each(publishedWorkspacePackages().map(({ dir, pkg }) => [pkg.name, dir, pkg]))(
    'declares engines.node ">=22.12.0" on %s',
    (_name, _dir, pkg: any) => {
      expect(pkg.engines?.node).toBe('>=22.12.0');
    },
  );
});
