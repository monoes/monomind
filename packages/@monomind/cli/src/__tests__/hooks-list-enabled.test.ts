/**
 * Regression tests for issue #270 — `hooks list` showed all 24 registered
 * hooks as "Enabled: No", including right after `init` reported wiring hooks
 * into settings.json.
 *
 * The two stores do not disagree; one of them simply has no such field. The
 * `hooks_list` tool returns a static registry of monomind's own hook
 * subcommands as `{ name, type, status: 'active' }` — there is no per-hook
 * enable/disable store anywhere in the CLI. The table in `hooks list` renders
 * a column keyed `enabled`, which was `undefined` on every row and formatted
 * as "No". The column was reporting on a field the tool never sent.
 *
 * What `init` writes is a different subsystem: Claude Code *event* wiring in
 * `.claude/settings.json` (PreToolUse/PostToolUse/SessionStart/... entries that
 * invoke `.claude/helpers/hook-handler.cjs`), keyed by event and handler
 * script, not by these subcommand names.
 *
 * So the tool now reports both truthfully and separately: each registry entry
 * carries its real enabled state, and the Claude Code wiring is reported as its
 * own thing rather than folded into the same column.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hooksList } from '../mcp-tools/hooks-routing.js';

interface HooksListResult {
  hooks: Array<{ name: string; type: string; status: string; enabled: boolean }>;
  total: number;
  claudeCode: { configured: boolean; settingsPath: string; wired: number; events: string[] };
}

let dir: string;
let originalCwdEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monomind-hooks-list-'));
  originalCwdEnv = process.env.MONOMIND_CWD;
  process.env.MONOMIND_CWD = dir;
});

afterEach(() => {
  if (originalCwdEnv === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = originalCwdEnv;
  rmSync(dir, { force: true, recursive: true });
});

function writeSettings(settings: unknown): void {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
}

async function run(): Promise<HooksListResult> {
  return (await hooksList.handler({})) as unknown as HooksListResult;
}

describe('hooks_list enablement reporting', () => {
  it('gives every registered hook a real enabled state instead of leaving it undefined', async () => {
    const result = await run();

    expect(result.hooks.length).toBeGreaterThan(0);
    for (const hook of result.hooks) {
      // `undefined` here is what the CLI's Enabled column rendered as "No".
      expect(typeof hook.enabled).toBe('boolean');
      expect(hook.enabled).toBe(hook.status === 'active');
    }
  });

  it('reports the Claude Code settings.json wiring as its own, separate fact', async () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'sh -c \'exec node "$p/.claude/helpers/hook-handler.cjs" pre-bash\'',
              },
            ],
          },
        ],
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'sh -c \'exec node "$p/.claude/helpers/hook-handler.cjs" session-restore\'',
              },
            ],
          },
        ],
      },
    });

    const result = await run();

    expect(result.claudeCode.configured).toBe(true);
    expect(result.claudeCode.wired).toBe(2);
    expect(result.claudeCode.events).toEqual(['PreToolUse', 'SessionStart']);
    expect(result.claudeCode.settingsPath).toBe(join(dir, '.claude', 'settings.json'));
  });

  it('says so plainly when no hooks are wired into settings.json', async () => {
    const result = await run();

    expect(result.claudeCode.configured).toBe(false);
    expect(result.claudeCode.wired).toBe(0);
    expect(result.claudeCode.events).toEqual([]);
    // The registry is still fully populated — the two are independent.
    expect(result.hooks.every((h) => h.enabled)).toBe(true);
  });

  it('ignores third-party hook entries that are not monomind handlers', async () => {
    writeSettings({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    });

    const result = await run();

    expect(result.claudeCode.configured).toBe(false);
    expect(result.claudeCode.wired).toBe(0);
  });
});
