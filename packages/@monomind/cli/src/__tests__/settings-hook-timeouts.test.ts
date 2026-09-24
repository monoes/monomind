import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateSettings } from '../init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

type Hook = { command: string; timeout?: number };
type Group = { matcher?: string; hooks: Hook[] };
type Hooks = Record<string, Group[]>;

// Claude Code reads a hook's `timeout` in SECONDS. A value like 5000 is not
// 5 s but ~83 minutes: a hung hook would stall the session for that long.
function allHooks(hooks: Hooks): Hook[] {
  return Object.values(hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
}

function assertSeconds(hooks: Hooks): void {
  const timeouts = allHooks(hooks)
    .map((h) => h.timeout)
    .filter((t): t is number => t !== undefined);
  expect(timeouts.length).toBeGreaterThan(0);
  for (const t of timeouts) {
    expect(Number.isInteger(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(1);
    expect(t).toBeLessThanOrEqual(60);
  }
}

function assertPreAgentHook(hooks: Hooks): void {
  const group = hooks.PreToolUse.find((g) => g.matcher === 'Task|Agent');
  expect(group).toBeDefined();
  expect(group?.hooks.some((h) => /hook-handler\.cjs" pre-agent/.test(h.command))).toBe(true);
}

describe('hook timeouts are seconds', () => {
  const generated = (generateSettings(DEFAULT_INIT_OPTIONS) as { hooks: Hooks }).hooks;

  it('the generator writes seconds', () => assertSeconds(generated));

  it('the generator converts the millisecond hooks.timeout option', () => {
    const bash = generated.PreToolUse.find((g) => g.matcher === 'Bash');
    expect(bash?.hooks[0].timeout).toBe(Math.ceil(DEFAULT_INIT_OPTIONS.hooks.timeout / 1000));
  });

  it('the generator adds the Task|Agent pick-adherence hook', () => assertPreAgentHook(generated));

  for (const rel of ['.claude/settings.json', 'packages/@monomind/cli/.claude/settings.json']) {
    it(`${rel} uses seconds and has the pick-adherence hook`, () => {
      const hooks = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf-8')).hooks as Hooks;
      assertSeconds(hooks);
      assertPreAgentHook(hooks);
    });
  }
});
