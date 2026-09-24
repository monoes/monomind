/**
 * `init upgrade --settings` on a settings.json written by 2.16.2: the fixture
 * is that version's generator output (DEFAULT_INIT_OPTIONS). It lacks the
 * PreToolUse Task|Agent pre-agent hook and writes every timeout in
 * milliseconds, which Claude Code reads as seconds.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type HooksByEvent,
  mergeMonomindHooks,
  missingMonomindHooks,
  monomindHookId,
  msTimeoutHooks,
} from '../src/init/hook-settings.js';
import { generateSettings } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
import { executeUpgrade } from '../src/init/upgrade.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'settings',
  'settings-2.16.2.json',
);
const USER_HOOK = { type: 'command', command: 'npx prettier --check .', timeout: 9000 };
const reference = () =>
  (generateSettings(DEFAULT_INIT_OPTIONS) as { hooks: HooksByEvent }).hooks;

function oldSettings(): { hooks: HooksByEvent } & Record<string, unknown> {
  const s = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
  s.hooks.PreToolUse[0].hooks.push({ ...USER_HOOK });
  s.hooks.PostToolUse.push({ matcher: 'Read', hooks: [{ type: 'command', command: 'echo read' }] });
  return s;
}

function allEntries(hooks: HooksByEvent) {
  return Object.values(hooks).flatMap((groups) => groups.flatMap((g) => g.hooks ?? []));
}

describe('monomindHookId', () => {
  it('gives the same id to one hook written by different versions', () => {
    expect(monomindHookId('node .claude/helpers/hook-handler.cjs route')).toBe(
      'hook-handler.cjs route',
    );
    expect(
      monomindHookId(
        `sh -c 'p="$CLAUDE_PROJECT_DIR"; exec node "$p/.claude/helpers/hook-handler.cjs" route'`,
      ),
    ).toBe('hook-handler.cjs route');
    expect(
      monomindHookId(
        `node -e "var f=p.join(r,'.claude/helpers/auto-memory-hook.mjs');import(u.pathToFileURL(f).href)" sync`,
      ),
    ).toBe('auto-memory-hook.mjs sync');
    expect(
      monomindHookId(`sh -c 'exec node "$p/.claude/helpers/monolean-tracker.cjs"'`),
    ).toBe('monolean-tracker.cjs');
    expect(
      monomindHookId(
        'node "$(echo "$p")/.claude/helpers/handlers/capture-handler.cjs" subagent-start',
      ),
    ).toBe('handlers/capture-handler.cjs subagent-start');
  });

  it('does not claim user hooks', () => {
    expect(monomindHookId('npx prettier --check .')).toBeUndefined();
    expect(monomindHookId(undefined)).toBeUndefined();
  });
});

describe('mergeMonomindHooks on 2.16.2 settings', () => {
  it('the fixture really is the old shape', () => {
    const old = oldSettings();
    expect(missingMonomindHooks(old.hooks, reference())).toEqual([
      'PreToolUse: hook-handler.cjs pre-agent',
    ]);
    expect(msTimeoutHooks(old.hooks).length).toBeGreaterThan(20);
  });

  it('adds the pre-agent hook and converts ms timeouts to seconds', () => {
    const { hooks, added, timeoutsFixed } = mergeMonomindHooks(oldSettings().hooks, reference());
    expect(added).toEqual(['PreToolUse: hook-handler.cjs pre-agent']);
    const agentGroup = hooks.PreToolUse.find((g) => g.matcher === 'Task|Agent');
    expect(agentGroup?.hooks?.map((h) => monomindHookId(h.command))).toEqual([
      'hook-handler.cjs pre-agent',
    ]);
    expect(timeoutsFixed).toBeGreaterThan(20);
    expect(msTimeoutHooks(hooks)).toEqual([]);
    const route = hooks.UserPromptSubmit[0].hooks?.find(
      (h) => monomindHookId(h.command) === 'hook-handler.cjs route',
    );
    expect(route?.timeout).toBe(10); // 10000 ms → 10 s
    expect(missingMonomindHooks(hooks, reference())).toEqual([]);
  });

  it('leaves user hooks alone, timeouts included', () => {
    const { hooks } = mergeMonomindHooks(oldSettings().hooks, reference());
    expect(allEntries(hooks)).toContainEqual(USER_HOOK);
    expect(hooks.PostToolUse.find((g) => g.matcher === 'Read')?.hooks).toEqual([
      { type: 'command', command: 'echo read' },
    ]);
  });

  it('is idempotent', () => {
    const once = mergeMonomindHooks(oldSettings().hooks, reference());
    const twice = mergeMonomindHooks(once.hooks, reference());
    expect(twice.added).toEqual([]);
    expect(twice.timeoutsFixed).toBe(0);
    expect(twice.hooks).toEqual(once.hooks);
  });

  it('adds SubagentStart/SubagentStop capture hooks to installs that predate them', () => {
    const old = oldSettings();
    delete old.hooks.SubagentStart;
    delete old.hooks.SubagentStop;
    const { hooks, added } = mergeMonomindHooks(old.hooks, reference());
    expect(added).toContain('SubagentStart: handlers/capture-handler.cjs subagent-start');
    expect(added).toContain('SubagentStop: handlers/capture-handler.cjs subagent-stop');
    expect(hooks.SubagentStart).toHaveLength(1);
  });
});

describe('executeUpgrade(dir, true) merges hooks into settings.json', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upgrade-settings-hooks-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(oldSettings(), null, 2));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the merged hooks and reports them', async () => {
    const result = await executeUpgrade(dir, true);
    expect(result.errors).toEqual([]);
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(missingMonomindHooks(settings.hooks, reference())).toEqual([]);
    expect(msTimeoutHooks(settings.hooks)).toEqual([]);
    expect(allEntries(settings.hooks)).toContainEqual(USER_HOOK);
    expect(result.settingsUpdated).toContain('hooks.PreToolUse: hook-handler.cjs pre-agent');
    expect(result.settingsUpdated?.some((s) => /timeout\(s\) converted/.test(s))).toBe(true);

    const again = await executeUpgrade(dir, true);
    const settings2 = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings2.hooks).toEqual(settings.hooks);
    expect(again.settingsUpdated?.some((s) => s.startsWith('hooks.PreToolUse'))).toBe(false);
  });
});
