import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

/**
 * The `monomind` umbrella is a shim that pins the real CLI exactly.
 *
 * It did not used to be. Root's `files` globs shipped
 * packages/@monomind/cli/dist/**, bin/** and the whole .claude tree — the same
 * payload @monoes/monomindcli publishes on its own. Two packages, 11.7 MB and
 * 15.2 MB of identical bytes, and two versions that had to be bumped in
 * lockstep or silently diverge.
 *
 * This file used to guard THAT arrangement, by requiring root to re-declare
 * every CLI dependency: npm does not install dependencies from a nested
 * package.json inside a tarball, so anything the CLI declared and the umbrella
 * did not was simply absent at runtime. That drift shipped in v2.7.3 as
 * "Cannot find package '@monoes/hooks'".
 *
 * The duplication is gone, so that rule goes with it — a superset check against
 * a one-dependency shim can only ever fail. What replaces it are the invariants
 * the new shape actually depends on:
 *
 *   1. the pin exists, is EXACT, and matches the CLI version — an inexact or
 *      stale pin means `npm i monomind` resolves to a different CLI than the
 *      one this release was cut and tested against
 *   2. root and CLI versions agree
 *   3. the umbrella does not start re-shipping the CLI payload again
 *
 * scripts/check-publish-versions.mjs enforces 1 and 2 at prepublishOnly. They
 * are asserted here as well, because a guard that only runs during `npm publish`
 * reports drift at the worst possible moment — mid-release, by which point the
 * CLI has usually already been published.
 */
function readPkg(...segments: string[]) {
  return JSON.parse(readFileSync(join(REPO_ROOT, ...segments), 'utf-8'));
}

describe('monomind umbrella pins the CLI instead of duplicating it', () => {
  const umbrella = readPkg('package.json');
  const cli = readPkg('packages', '@monomind', 'cli', 'package.json');
  const pin = umbrella.dependencies?.['@monoes/monomindcli'];

  it('declares @monoes/monomindcli', () => {
    expect(pin, 'the umbrella must depend on the CLI package it wraps').toBeTruthy();
  });

  it('pins it exactly, with no range operator', () => {
    // A caret here would let `npm i monomind` pull a CLI newer than the one
    // this release was cut against.
    expect(pin).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });

  it('pins the version the CLI package actually is', () => {
    expect(pin, 'a stale pin ships an old CLI under a new umbrella version').toBe(cli.version);
  });

  it('carries the same version as the CLI', () => {
    expect(umbrella.version).toBe(cli.version);
  });

  it('does not re-ship the CLI payload', () => {
    // The regression this replaces: publishing the same megabytes twice, and
    // reintroducing the dependency-drift class the old guard existed for.
    const files: string[] = umbrella.files ?? [];
    const duplicated = files.filter(
      (f) => !f.startsWith('!') && /packages\/@monomind\/cli\//.test(f),
    );
    expect(
      duplicated,
      'the umbrella is a shim — it must not bundle the CLI package it already depends on',
    ).toEqual([]);
  });

  it('declares no runtime dependencies beyond the CLI pin', () => {
    // Anything else is either dead weight or a second source of truth for a
    // version the CLI already owns.
    expect(Object.keys(umbrella.dependencies ?? {})).toEqual(['@monoes/monomindcli']);
  });
});
