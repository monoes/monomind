/**
 * `init` and `init upgrade` must leave helpers with the same permissions.
 * init kept each source file's mode (plus 0755 for .sh/.mjs) while upgrade
 * chmod'ed every helper it touched to 0755. Every .cjs helper is run as
 * `node <file>`; only shell scripts, .mjs entry points and the extensionless
 * git hooks are executed directly.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { executeUpgrade } from '../init/upgrade.js';
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

let target: string;
beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), 'mm-helper-modes-'));
  mkdirSync(join(target, '.claude'), { recursive: true });
  writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
});
afterEach(() => rmSync(target, { recursive: true, force: true }));

const expected = (name: string) => (/\.(sh|mjs)$/.test(name) || !extname(name) ? 0o755 : 0o644);
const modes = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.endsWith('.json'))
      .map((e) => [e.name, statSync(join(dir, e.name)).mode & 0o777]),
  );

describe('helper file modes', () => {
  it('are the same after init and after init upgrade, executable only where run directly', async () => {
    await writeHelpers(target, { ...DEFAULT_INIT_OPTIONS, targetDir: target }, freshResult());
    const helpers = join(target, '.claude', 'helpers');
    const afterInit = modes(helpers);
    for (const [name, mode] of Object.entries(afterInit))
      expect(mode, `init ${name}`).toBe(expected(name));

    await executeUpgrade(target);
    const afterUpgrade = modes(helpers);
    for (const [name, mode] of Object.entries(afterUpgrade))
      expect(mode, `upgrade ${name}`).toBe(expected(name));
  });
});
