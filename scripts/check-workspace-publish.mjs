#!/usr/bin/env node
/**
 * Publish guard: a package with `workspace:` dependencies must be published
 * with pnpm, never npm.
 *
 * ## The failure this pins
 *
 * `npm publish` does not understand pnpm's `workspace:` protocol. It copies
 * package.json verbatim, so the tarball ships a dependency whose version is
 * the literal string "workspace:*". Every consumer then dies at resolution:
 *
 *     npm error code EUNSUPPORTEDPROTOCOL
 *     npm error Unsupported URL Type "workspace:": workspace:*
 *
 * `pnpm publish` rewrites it to the version the sibling declares.
 *
 * This happened on 2026-09-21. `@monoes/monodesign@1.2.12` was published with
 * npm and shipped `"@monoes/monobrowse": "workspace:*"`. Because the CLI's
 * dependency on monodesign was a `^1.2.x` range in the releases current at the
 * time, the broken version was picked up immediately and **2.13.0 and 2.14.0
 * both became uninstallable** — releases that had been fine for days, broken
 * by a sibling publish that touched none of their code.
 *
 * The CLI already had this guard (packages/@monomind/cli/scripts/
 * check-workspace-deps.mjs, issue #130) and was never affected. monodesign and
 * hooks acquired `workspace:` dependencies later, when the five registry-range
 * edges were converted, and nothing extended the guard to them — so the
 * conversion that closed one publish hole opened exposure to this one.
 *
 * ## Escape hatch
 *
 * MONOMIND_ALLOW_NPM_PUBLISH=1, matching the CLI's guard. It exists for a
 * deliberate npm publish of a package whose workspace deps you have already
 * rewritten by hand; there is rarely a good reason.
 *
 * Usage: check-workspace-publish.mjs [packageDir]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.argv[2] ?? process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const workspaceDeps = Object.entries({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.peerDependencies,
  ...pkg.optionalDependencies,
})
  .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
  .map(([name]) => name);

if (workspaceDeps.length === 0) {
  console.log(`✓ publish checks ok — ${pkg.name} has no workspace: dependencies`);
  process.exit(0);
}

const publishing = process.env.npm_lifecycle_event === 'prepublishOnly';
const viaPnpm = (process.env.npm_config_user_agent ?? '').includes('pnpm');

if (publishing && !viaPnpm && process.env.MONOMIND_ALLOW_NPM_PUBLISH !== '1') {
  const agent = process.env.npm_config_user_agent || 'unknown';
  console.error('\n✗ publish blocked: this package must be published with pnpm, not npm\n');
  console.error(`    ${pkg.name} (user agent: ${agent})`);
  console.error(`    workspace: dependencies — ${workspaceDeps.join(', ')}\n`);
  console.error(
    '  npm copies workspace: into the tarball verbatim and every consumer install then fails\n' +
      '  with EUNSUPPORTEDPROTOCOL. This is what broke @monoes/monodesign@1.2.12, and with it\n' +
      '  every already-published release that resolved monodesign by range.\n\n' +
      `  Fix:\n    (cd ${pkgDir} && pnpm publish --no-git-checks)\n`,
  );
  process.exit(1);
}

console.log(
  `✓ publish checks ok — ${pkg.name}'s workspace: deps (${workspaceDeps.join(', ')}) will be resolved by pnpm`,
);
