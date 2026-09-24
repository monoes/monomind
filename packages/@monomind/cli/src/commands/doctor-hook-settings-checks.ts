/**
 * Doctor — are the monomind hooks in .claude/settings.json current?
 *
 * `init upgrade` used to merge only the auto-memory hooks, so an upgraded
 * install could lack the hooks agent picking depends on (the prompt route
 * hook, the Task|Agent pre-agent adherence hook, the SubagentStart/Stop
 * capture hooks) and keep timeouts written in milliseconds, which Claude
 * Code reads as seconds. Both are fixed by `monomind init upgrade --settings`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type HooksByEvent, missingMonomindHooks, msTimeoutHooks } from '../init/hook-settings.js';
import { generateSettings } from '../init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Hook Settings';
const FIX = 'monomind init upgrade --settings';
const MAX_SETTINGS_BYTES = 1024 * 1024;

/** The hooks agent picking needs, as `Event: <script> <subcommand>`. */
export const PICK_HOOKS = [
  'UserPromptSubmit: hook-handler.cjs route',
  'PreToolUse: hook-handler.cjs pre-agent',
  'SubagentStart: handlers/capture-handler.cjs subagent-start',
  'SubagentStop: handlers/capture-handler.cjs subagent-stop',
];

export async function checkHookSettings(cwd: string = process.cwd()): Promise<HealthCheck> {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  if (!existsSync(settingsPath))
    return { name: NAME, status: 'warn', message: '.claude/settings.json not found', fix: FIX };
  let hooks: HooksByEvent;
  try {
    if (statSync(settingsPath).size > MAX_SETTINGS_BYTES)
      return { name: NAME, status: 'warn', message: 'settings.json too large to parse' };
    hooks = JSON.parse(readFileSync(settingsPath, 'utf-8'))?.hooks ?? {};
  } catch {
    return { name: NAME, status: 'warn', message: 'Could not parse .claude/settings.json' };
  }

  const reference = (generateSettings(DEFAULT_INIT_OPTIONS) as { hooks: HooksByEvent }).hooks;
  const missing = missingMonomindHooks(hooks, reference).filter((h) => PICK_HOOKS.includes(h));
  const msTimeouts = msTimeoutHooks(hooks);
  const problems: string[] = [];
  if (missing.length) problems.push(`missing pick hook(s): ${missing.join(', ')}`);
  if (msTimeouts.length)
    problems.push(
      `${msTimeouts.length} monomind hook timeout(s) in milliseconds (Claude Code reads seconds), e.g. ${msTimeouts[0]}`,
    );
  return problems.length
    ? { name: NAME, status: 'warn', message: problems.join('; '), fix: FIX }
    : { name: NAME, status: 'pass', message: 'pick hooks present, timeouts in seconds' };
}
