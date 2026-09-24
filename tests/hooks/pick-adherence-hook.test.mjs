/**
 * PreToolUse Task|Agent → `hook-handler.cjs pre-agent`: records whether the
 * spawned subagent followed the session's pick, and never blocks the tool.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLER = path.resolve(__dirname, '../../.claude/helpers/hook-handler.cjs');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-adh-'));
  fs.mkdirSync(path.join(tmp, '.monomind', 'routes'), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(input) {
  return spawnSync(process.execPath, [HANDLER, 'pre-agent'], {
    cwd: tmp,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, MONOMIND_HOOK_QUIET: '1' },
    encoding: 'utf-8',
    timeout: 10000,
  });
}

const adherence = () =>
  fs
    .readFileSync(path.join(tmp, '.monomind', 'pick-adherence.jsonl'), 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

describe('pre-agent hook', () => {
  it('appends an adherence record for the session route and stays silent', () => {
    fs.writeFileSync(
      path.join(tmp, '.monomind', 'routes', 's1.json'),
      JSON.stringify({
        routeId: 'r-1',
        sessionId: 's1',
        agent: 'Security Engineer',
        agentSlug: 'x',
      }),
    );
    const r = run({
      session_id: 's1',
      hook_event_name: 'PreToolUse',
      tool_name: 'Task',
      tool_input: {
        subagent_type: 'Security Engineer',
        description: 'audit',
        prompt: 'audit auth',
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(adherence()).toEqual([
      expect.objectContaining({
        routeId: 'r-1',
        sessionId: 's1',
        recommended: 'Security Engineer',
        actual: 'Security Engineer',
        followed: true,
      }),
    ]);
  });

  it('never blocks, even on garbage input', () => {
    const r = run('not json');
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('"decision":"block"');
  });
});

// SubagentStart runs `hook-handler.cjs status`, SubagentStop `post-task`:
// under MONOMIND_HOOK_QUIET neither may print an [OK] banner.
describe('SubagentStart/SubagentStop hooks under MONOMIND_HOOK_QUIET', () => {
  it.each(['status', 'post-task'])('%s prints nothing', (cmd) => {
    const r = spawnSync(process.execPath, [HANDLER, cmd], {
      cwd: tmp,
      input: JSON.stringify({ session_id: 's1', agent_type: 'coder' }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, MONOMIND_HOOK_QUIET: '1' },
      encoding: 'utf-8',
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});
