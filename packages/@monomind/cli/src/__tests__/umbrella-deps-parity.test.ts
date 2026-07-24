import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

// The umbrella `monomind` package ships the CLI's built dist inline (see its
// `files` globs) rather than depending on @monoes/monomindcli. npm does NOT
// install dependencies declared in a nested package.json inside a tarball, so
// anything the CLI declares but the umbrella doesn't is simply absent at
// runtime. That drift shipped in v2.7.3 as "Cannot find package
// '@monoes/hooks'" from `hooks worker run map|audit`. This test fails the
// moment the two dependency lists disagree again.
function readPkg(...segments: string[]) {
  return JSON.parse(readFileSync(join(REPO_ROOT, ...segments), 'utf-8'));
}

describe('umbrella monomind package declares every CLI runtime dependency', () => {
  const umbrella = readPkg('package.json');
  const cli = readPkg('packages', '@monomind', 'cli', 'package.json');

  // The umbrella may declare extras of its own (e.g. semver for the bin
  // shim); it may never declare fewer.
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    it(`${field} are a superset of the CLI's`, () => {
      const cliDeps: Record<string, string> = cli[field] ?? {};
      const umbrellaDeps: Record<string, string> = umbrella[field] ?? {};
      const missing = Object.keys(cliDeps).filter((name) => !(name in umbrellaDeps));
      expect(missing, `missing from root package.json ${field}`).toEqual([]);
    });

    it(`${field} version ranges match the CLI's`, () => {
      const cliDeps: Record<string, string> = cli[field] ?? {};
      const umbrellaDeps: Record<string, string> = umbrella[field] ?? {};
      const mismatched = Object.entries(cliDeps)
        .filter(([name, range]) => name in umbrellaDeps && umbrellaDeps[name] !== range)
        .map(([name, range]) => `${name}: cli=${range} umbrella=${umbrellaDeps[name]}`);
      expect(mismatched).toEqual([]);
    });
  }
});
