/**
 * `monobrowse --version` crashed instead of printing a version. (#320)
 *
 * `src/cli.ts` read the manifest with `_require('../package.json')`. That path
 * is right for the SOURCE file — `src/cli.ts` sits one level under the package
 * root — and wrong for the only file that ever runs it. The package compiles
 * with `rootDir: "."`, so `src/cli.ts` emits to `dist/src/cli.js`, and
 * `createRequire(import.meta.url)` resolves relative to THAT file: `../` is
 * `dist/`, which holds no package.json. Every invocation of the standalone
 * binary died with `Cannot find module '../package.json'`, in the repo and
 * from a clean install alike.
 *
 * WHY THIS IS A SUBPROCESS TEST. The bug lives entirely in the emitted file's
 * position on disk. Importing anything from `src/` re-resolves the path from
 * the source tree, where the broken version was already correct — an in-process
 * test would have passed against the bug. Only spawning the built `dist/src/
 * cli.js`, the exact file `bin.monobrowse` points at, can observe it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..', '..');
const distCli = join(pkgRoot, 'dist', 'src', 'cli.js');
const hasBuild = existsSync(distCli);

describe.skipIf(!hasBuild)('the built monobrowse binary reports its version', () => {
  const declared = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
    .version as string;

  for (const flag of ['--version', '-V']) {
    it(`\`monobrowse ${flag}\` exits 0 and prints the package version`, () => {
      // THE BUG: this threw — exit 1, `✗ Cannot find module '../package.json'`.
      const out = execFileSync('node', [distCli, flag], { encoding: 'utf8', stdio: 'pipe' });

      expect(out.trim()).toBe(declared);
      expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }, 15_000);
  }
});

describe.skipIf(hasBuild)('monobrowse --version subprocess test', () => {
  it('is skipped because dist/ is not built (run `npm run build`)', () => {
    expect(hasBuild).toBe(false);
  });
});
