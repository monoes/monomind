// `init` copies the helper tree into `.gemini/helpers` as well as
// `.claude/helpers` (writeHelpers in init/write-claude.ts), and Antigravity's
// status bar runs `.gemini/helpers/statusline.sh` -> `.gemini/helpers/statusline.cjs`
// (which requires ./utils/). `init upgrade` used to refresh only
// `.claude/helpers`, so the Gemini copy kept whatever the first `init` wrote.
// It must now get the same refresh, and only where that copy was installed.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findSourceHelpersDir } from '../init/shared.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { executeUpgrade } from '../init/upgrade.js';
import { writeHelpers } from '../init/write-claude.js';

const TMP: string[] = [];
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMP.push(d);
  return d;
}

afterAll(() => {
  for (const d of TMP) rmSync(d, { recursive: true, force: true });
});

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

const STALE = '// stale copy from an older install\n';

describe('init upgrade refreshes the Gemini helper copy', () => {
  it('overwrites stale force-synced helpers and utils/, keeps user files', async () => {
    const source = findSourceHelpersDir() as string;
    expect(source, 'bundled helpers dir must resolve in-repo').toBeTruthy();

    const target = scratch('mm-upgrade-gemini-');
    mkdirSync(join(target, '.claude'), { recursive: true });
    writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    await writeHelpers(target, { ...DEFAULT_INIT_OPTIONS, targetDir: target }, freshResult());

    const gemini = join(target, '.gemini', 'helpers');
    expect(existsSync(join(gemini, 'statusline.cjs'))).toBe(true);

    // Simulate an install made by an older release.
    writeFileSync(join(gemini, 'statusline.cjs'), STALE);
    writeFileSync(join(gemini, 'hook-handler.cjs'), STALE);
    writeFileSync(join(gemini, 'utils', 'fs-helpers.cjs'), STALE);
    rmSync(join(gemini, 'router.cjs'));
    rmSync(join(gemini, 'audit-log-writer.cjs'));
    // A user-editable scaffold and a file of the user's own must survive.
    writeFileSync(join(gemini, 'memory.cjs'), '// user edit\n');
    writeFileSync(join(gemini, 'my-own.cjs'), '// mine\n');
    // The Antigravity wrapper is generated, not bundled; it must be kept.
    writeFileSync(join(gemini, 'statusline.sh'), '#!/bin/sh\n# custom\n');

    const result = await executeUpgrade(target);
    expect(result.errors).toEqual([]);

    const bundled = (rel: string) => readFileSync(join(source, rel), 'utf8');
    const installed = (rel: string) => readFileSync(join(gemini, rel), 'utf8');
    expect(installed('statusline.cjs')).toBe(bundled('statusline.cjs'));
    expect(installed('hook-handler.cjs')).toBe(bundled('hook-handler.cjs'));
    expect(installed('utils/fs-helpers.cjs')).toBe(bundled('utils/fs-helpers.cjs'));
    expect(installed('router.cjs')).toBe(bundled('router.cjs'));
    expect(existsSync(join(gemini, 'audit-log-writer.cjs'))).toBe(true);
    expect(installed('memory.cjs')).toBe('// user edit\n');
    expect(installed('my-own.cjs')).toBe('// mine\n');
    expect(installed('statusline.sh')).toBe('#!/bin/sh\n# custom\n');
    expect(result.updated).toContain('.gemini/helpers/statusline.cjs');
  }, 120_000);

  it('does not create a Gemini helper copy where none was installed', async () => {
    const source = findSourceHelpersDir() as string;
    const target = scratch('mm-upgrade-no-gemini-');
    mkdirSync(join(target, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    copyFileSync(
      join(source, 'statusline.cjs'),
      join(target, '.claude', 'helpers', 'statusline.cjs'),
    );

    const result = await executeUpgrade(target);

    expect(existsSync(join(target, '.gemini'))).toBe(false);
    expect(result.updated.some((p) => p.startsWith('.gemini/'))).toBe(false);
  }, 120_000);
});
