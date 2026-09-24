import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeSettings } from '../init/write-claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ROOT_SETTINGS = join(REPO_ROOT, '.claude', 'settings.json');

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

/** Every `hooks[].command` string anywhere in a settings.json `hooks` object. */
function allHookCommands(
  hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined,
): Set<string> {
  const commands = new Set<string>();
  for (const groups of Object.values(hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (typeof hook.command === 'string') commands.add(hook.command);
      }
    }
  }
  return commands;
}

describe('writeSettings --force preserves hooks the generator does not produce', () => {
  let tmp: string;
  let projectDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-write-settings-force-'));
    projectDir = join(tmp, 'project');
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    settingsPath = join(projectDir, '.claude', 'settings.json');
    // Seed with the REAL repo settings.json, which dogfoods hand-added custom
    // hooks (event-logger.cjs, loop-tracker.cjs, mastermind-activate.cjs,
    // control-stop.cjs, and PreToolUse/PostToolUse capture-handler.cjs
    // entries) that the generator does not itself produce.
    writeFileSync(settingsPath, readFileSync(ROOT_SETTINGS, 'utf-8'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps every pre-existing hook command after `init --force`', async () => {
    const before = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const beforeCommands = allHookCommands(before.hooks);
    // Sanity: the fixture actually has hooks the generator wouldn't emit
    // (this is what makes the test meaningful — not just "file exists").
    expect(beforeCommands.size).toBeGreaterThan(10);

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };
    await writeSettings(projectDir, options, freshResult());

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const afterCommands = allHookCommands(after.hooks);

    const dropped = [...beforeCommands].filter((command) => !afterCommands.has(command));
    expect(dropped).toEqual([]);
  });

  it('still refreshes a generator-owned hook entry, not just leaves the file alone', async () => {
    // Mutate a generator-owned entry (PreToolUse/Bash's timeout) to an
    // obviously-stale value first. Preservation alone would leave it stale;
    // only an actual refresh restores it to what generateSettingsJson emits.
    const seeded = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const preBashGroup = seeded.hooks.PreToolUse.find(
      (g: { matcher?: string }) => g.matcher === 'Bash',
    );
    preBashGroup.hooks[0].timeout = 1;
    writeFileSync(settingsPath, JSON.stringify(seeded, null, 2));

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };
    await writeSettings(projectDir, options, freshResult());

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const afterPreBash = after.hooks.PreToolUse.find(
      (g: { matcher?: string }) => g.matcher === 'Bash',
    );
    expect(afterPreBash.hooks[0].timeout).toBe(Math.ceil(DEFAULT_INIT_OPTIONS.hooks.timeout / 1000));
  });
});
