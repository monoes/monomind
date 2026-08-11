#!/usr/bin/env node
/**
 * Publish guard for @monoes/monomindcli itself (issue #130).
 *
 * `npm publish` does not understand pnpm's `workspace:*` protocol — it copies
 * package.json verbatim, so a plain `npm publish` here ships a tarball whose
 * `@monoes/monograph` dependency is the literal string "workspace:*", which
 * no consumer can resolve. `pnpm publish` rewrites it to the real version
 * instead. This mirrors the same check the root package already has
 * (../../../scripts/check-publish-versions.mjs), scoped to this package.
 *
 * Runs from this package's prepublishOnly. Exits non-zero with the fix if a
 * workspace:* dependency would leak through a non-pnpm publish.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const workspaceDeps = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
  .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
  .map(([name]) => name);

if (workspaceDeps.length === 0) {
  process.exit(0);
}

const publishing = process.env.npm_lifecycle_event === 'prepublishOnly';
const agent = process.env.npm_config_user_agent ?? '';
const viaPnpm = agent.includes('pnpm');

if (publishing && !viaPnpm && process.env.MONOMIND_ALLOW_NPM_PUBLISH !== '1') {
  console.error('\n✗ publish blocked:\n');
  console.error(
    `    this package must be published with \`pnpm publish\`, not npm (user agent: ${agent || 'unknown'}). ` +
    `npm copies workspace:* into the tarball verbatim and the published package becomes uninstallable.\n` +
    `    affected dependencies: ${workspaceDeps.join(', ')}\n`,
  );
  console.error('  Fix:\n    pnpm publish --tag alpha --no-git-checks   (from this directory)\n');
  process.exit(1);
}

console.log(`✓ publish checks ok — workspace:* deps (${workspaceDeps.join(', ')}) will be resolved by pnpm`);
