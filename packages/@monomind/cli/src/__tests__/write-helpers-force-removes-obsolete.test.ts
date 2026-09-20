/**
 * writeHelpers() copies every helper the current bundle ships, but never
 * deleted a helper the bundle *used* to ship under a name it no longer uses
 * (e.g. graphify-freshen.cjs, renamed to monograph-freshen.cjs) — the old
 * file just sat there forever, unreferenced once `init --force` also
 * refreshes settings.json to stop pointing at it (see
 * write-settings-force-drops-obsolete-hooks.test.ts).
 *
 * Only `--force` removes it: a plain `init` never deletes anything writeHelpers
 * touches, and settings.json's hook commands are only rewritten under --force
 * too, so deleting the file on a non-force run would leave a still-referenced
 * hook pointing at nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeHelpers } from '../init/write-claude.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

let tmp: string;
let projectDir: string;
let obsoletePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'monomind-write-helpers-obsolete-'));
  projectDir = join(tmp, 'project');
  mkdirSync(join(projectDir, '.claude', 'helpers'), { recursive: true });
  obsoletePath = join(projectDir, '.claude', 'helpers', 'graphify-freshen.cjs');
  writeFileSync(obsoletePath, '// stub from before the monograph rename\n');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('writeHelpers', () => {
  it('removes a helper renamed upstream when run with --force', async () => {
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: true };
    await writeHelpers(projectDir, options, freshResult());

    expect(existsSync(obsoletePath)).toBe(false);
    expect(existsSync(join(projectDir, '.claude', 'helpers', 'monograph-freshen.cjs'))).toBe(true);
  });

  it('leaves the obsolete file alone on a non-force run', async () => {
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: false };
    await writeHelpers(projectDir, options, freshResult());

    expect(existsSync(obsoletePath)).toBe(true);
  });
});
