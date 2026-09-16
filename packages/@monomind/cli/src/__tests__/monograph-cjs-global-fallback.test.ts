import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Regression for issue #237: _requireMonograph() in the hook-side helper
// (.claude/helpers/utils/monograph.cjs) never checked a global npm install
// of @monoes/monograph, unlike graphify-freshen.cjs's resolveMonographEntry()
// which does. graph-status and inline hook suggestions reported "not found"
// even against a valid, freshly-built monograph.db when the package was only
// installed globally (`npm install -g @monoes/monograph`).

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOGRAPH_CJS = join(__dirname, '..', '..', '.claude', 'helpers', 'utils', 'monograph.cjs');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'monomind-monograph-global-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Writes a fake `npm` executable on PATH whose `root -g` prints `globalRoot`. */
function installFakeNpm(binDir: string, globalRoot: string): void {
  mkdirSync(binDir, { recursive: true });
  const npmShim = join(binDir, 'npm');
  writeFileSync(
    npmShim,
    `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then echo "${globalRoot}"; fi\n`,
  );
  chmodSync(npmShim, 0o755);
}

/** Writes a minimal, requireable @monoes/monograph package under `globalRoot`. */
function installFakeGlobalMonograph(globalRoot: string): void {
  const pkgDir = join(globalRoot, '@monoes', 'monograph');
  mkdirSync(join(pkgDir, 'dist', 'src'), { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@monoes/monograph',
      exports: { '.': { import: './dist/src/index.js' } },
    }),
  );
  writeFileSync(
    join(pkgDir, 'dist', 'src', 'index.js'),
    'module.exports = { marker: "GLOBAL_FALLBACK_OK" };',
  );
}

function requireMonographInSubprocess(projectDir: string, pathWithFakeNpm: string): string {
  const script = `const mod = require(${JSON.stringify(MONOGRAPH_CJS)}); console.log(JSON.stringify(mod._requireMonograph()));`;
  return execFileSync('node', ['-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PATH: pathWithFakeNpm },
  }).trim();
}

describe('_requireMonograph() global npm fallback', () => {
  it('resolves @monoes/monograph via `npm root -g` when absent locally and in every ancestor', () => {
    const projectDir = join(tmp, 'project');
    mkdirSync(projectDir, { recursive: true });

    const globalRoot = join(tmp, 'fake-global-node-modules');
    installFakeGlobalMonograph(globalRoot);

    const fakeBin = join(tmp, 'bin');
    installFakeNpm(fakeBin, globalRoot);

    const stdout = requireMonographInSubprocess(projectDir, `${fakeBin}:${process.env.PATH}`);

    expect(JSON.parse(stdout)).toEqual({ marker: 'GLOBAL_FALLBACK_OK' });
  });

  it('still returns null (not a crash) when there is no local, ancestor, or global install', () => {
    const projectDir = join(tmp, 'project');
    mkdirSync(projectDir, { recursive: true });

    // A real `npm root -g` that points at a directory with no @monoes/monograph.
    const emptyGlobalRoot = join(tmp, 'empty-global-node-modules');
    mkdirSync(emptyGlobalRoot, { recursive: true });
    const fakeBin = join(tmp, 'bin');
    installFakeNpm(fakeBin, emptyGlobalRoot);

    const stdout = requireMonographInSubprocess(projectDir, `${fakeBin}:${process.env.PATH}`);

    expect(JSON.parse(stdout)).toBeNull();
  });
});
