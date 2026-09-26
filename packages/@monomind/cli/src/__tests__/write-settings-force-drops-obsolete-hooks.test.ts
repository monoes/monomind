/**
 * mergeHooksPreservingUnknown (write-settings.ts) matches existing hook entries
 * to the freshly generated ones by exact command string. That's correct for a
 * genuinely user-added hook, but it means a hook this product itself renamed
 * (graphify-freshen.cjs -> monograph-freshen.cjs) looked "unknown" too: the
 * old command survived every `init --force` as a duplicate SessionStart
 * entry, running side by side with the new one — and once `init --force`
 * also started deleting the old, now-unbundled file (see writeHelpers), that
 * duplicate entry pointed at a file that no longer exists.
 *
 * stripObsoleteHookCommands() removes known-renamed commands from the
 * existing hooks before the merge runs, so `--force` actually retires them
 * instead of leaving a broken duplicate. This is not the same failure mode
 * the sibling write-settings-force-preserves-hooks.test.ts guards — that one
 * asserts genuinely unknown (hand-added) hooks survive; this one asserts a
 * *known-obsolete* one specifically does not.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeSettings } from '../init/write-settings.js';

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
): string[] {
  const commands: string[] = [];
  for (const groups of Object.values(hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (typeof hook.command === 'string') commands.push(hook.command);
      }
    }
  }
  return commands;
}

const OLD_COMMAND =
  'sh -c \'p="$CLAUDE_PROJECT_DIR"; exec node "$p/.claude/helpers/graphify-freshen.cjs"\'';
const CUSTOM_COMMAND = 'sh -c \'exec node "$CLAUDE_PROJECT_DIR/.claude/helpers/my-own-hook.cjs"\'';

describe('writeSettings --force retires a renamed hook instead of duplicating it', () => {
  let tmp: string;
  let projectDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-write-settings-obsolete-'));
    projectDir = join(tmp, 'project');
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    settingsPath = join(projectDir, '.claude', 'settings.json');
    // Simulates a project initialized before the graphify -> monograph
    // rename: the SessionStart group mixes the old hook command with a
    // hand-added custom one, matching how settings-generator.ts emits every
    // SessionStart hook into a single unmatchered group.
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: 'command', command: OLD_COMMAND, timeout: 5000 },
                  { type: 'command', command: CUSTOM_COMMAND, timeout: 5000 },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('drops the old graphify-freshen.cjs command and adds the new monograph-freshen.cjs one exactly once', async () => {
    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components, monograph: true },
    };
    await writeSettings(projectDir, options, freshResult());

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const afterCommands = allHookCommands(after.hooks);

    expect(afterCommands.filter((c) => c.includes('graphify-freshen.cjs'))).toEqual([]);
    expect(afterCommands.filter((c) => c.includes('monograph-freshen.cjs'))).toHaveLength(1);
  });

  it('still preserves the hand-added custom hook sharing that same group', async () => {
    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components, monograph: true },
    };
    await writeSettings(projectDir, options, freshResult());

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const afterCommands = allHookCommands(after.hooks);

    expect(afterCommands).toContain(CUSTOM_COMMAND);
  });
});
