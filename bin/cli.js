#!/usr/bin/env node
/**
 * monomind — umbrella entry point.
 *
 * This package ships NO code of its own. It is a thin shim that depends on
 * @monoes/monomindcli (the real CLI) and hands off to its bin. Publishing the
 * CLI payload from both packages is what caused the ~27MB double-publish and
 * the two-file lockstep version bump; do not reintroduce it.
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

const CLI_PKG = '@monoes/monomindcli';

/**
 * Locate the CLI's bin on disk.
 *
 * Deliberately does NOT use require.resolve() on the package: the CLI declares
 * an `exports` map, which gates every specifier. Published 2.7.12 exports "."
 * with only an `import` condition, so CJS require.resolve() fails with
 * ERR_PACKAGE_PATH_NOT_EXPORTED, and `./bin/cli.js` isn't exported at all
 * before 2.7.13. A shim that breaks against an older CLI is a shim that breaks
 * on every partial upgrade, so resolve by filesystem instead.
 *
 * require.resolve.paths() still gives us Node's exact node_modules search
 * order, which is what makes this correct for nested, hoisted, global and
 * pnpm layouts alike — we just do the final lookup ourselves.
 */
function resolveCliBin() {
  for (const dir of require.resolve.paths(CLI_PKG) ?? []) {
    const bin = join(dir, ...CLI_PKG.split('/'), 'bin', 'cli.js');
    if (existsSync(bin)) return bin;
  }

  // Monorepo checkout before install / pnpm link edge case.
  const local = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'packages',
    '@monomind',
    'cli',
    'bin',
    'cli.js',
  );
  return existsSync(local) ? local : null;
}

const cliPath = resolveCliBin();
if (!cliPath) {
  console.error(
    '[monomind] Could not locate @monoes/monomindcli.\n' +
      '  This is an install problem, not a crash.\n' +
      '  Try: npm i -g monomind@latest',
  );
  process.exit(1);
}

await import(pathToFileURL(cliPath).href);
