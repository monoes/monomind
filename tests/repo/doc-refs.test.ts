/**
 * #272 follow-up: docs cited source locations as `file.ts:L123`, which is
 * correct only for the commit it was written at. By the 2026-09-18 audit,
 * 97 of the 200 line references in doc/concepts and doc/commands pointed at
 * the wrong code — `OrgDaemon` documented at daemon.ts L178 had moved to 438,
 * `stopOrg` L793 to 2293, `ScrollbackBuffer` L98-107 to 302-317 — and two
 * pointed at files that no longer existed. Hand-patching them (as the #272 fix
 * did for one section) only restarts the clock.
 *
 * References now carry a symbol anchor (`daemon.ts#startOrg`) instead of a
 * line number. scripts/check-doc-refs.mjs resolves every anchor against the
 * source file and rejects both a symbol that no longer exists and any
 * reintroduced `#L<n>` anchor, so drift fails here instead of misleading a
 * reader.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-doc-refs.mjs');

function run(args: string[] = []): string {
  return execFileSync('node', [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('doc source references resolve to symbols that still exist', () => {
  it('scripts/check-doc-refs.mjs exits 0', () => {
    expect(() => run()).not.toThrow();
  });

  it('every symbol anchor resolves to a definition line', () => {
    const listed = run(['--list'])
      .split('\n')
      .filter((line) => line.includes('#'));
    expect(listed.length).toBeGreaterThan(100);
    for (const line of listed) {
      expect(line, `unresolved reference: ${line}`).toMatch(/→ L\d+/);
    }
  });

  it('rejects a line-number anchor, a vanished symbol, and a missing file', () => {
    const fixtures = mkdtempSync(join(tmpdir(), 'doc-refs-'));
    const target = 'scripts/check-doc-refs.mjs';
    writeFileSync(
      join(fixtures, 'bad.md'),
      [
        // the file and the line both exist — the anchor style is the failure
        `[a](${target}#L1)`,
        `[b](${target}#noSuchSymbolAnywhere)`,
        '[c](packages/@monomind/cli/src/does-not-exist.ts#definitionLines)',
        // a resolvable reference, so the fixture proves the others are what fail
        `[d](${target}#definitionLines)`,
      ].join('\n\n'),
    );

    let stderr = '';
    expect(() => {
      try {
        run([fixtures]);
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr ?? '');
        throw error;
      }
    }).toThrow();

    expect(stderr).toMatch(/3 of 4 broken/);
    expect(stderr).toMatch(/line-number anchor/);
    expect(stderr).toMatch(/no definition of `noSuchSymbolAnywhere`/);
    expect(stderr).toMatch(/missing file/);
  });
});
