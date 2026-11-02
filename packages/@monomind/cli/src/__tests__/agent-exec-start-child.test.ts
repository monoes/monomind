/**
 * #724: the `start` event reports the runtime child's pid, process group id
 * and the turn's MONOMIND_EXEC_TREE token (`child_pid`, `pgid`, `exec_tree`),
 * so a host can record them at launch. Full access only (the only mode that
 * spawns a group leader under a token); otherwise the fields are omitted.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type AgentExecOptions, runAgentExec } from '../orgrt/agent-exec.js';
import { type AgentMessage, type AgentRunner, ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { loadClaudeSdk } from '../orgrt/agent-runner-claude.js';

type Ev = Record<string, unknown>;

async function exec(runner: AgentRunner, over: Partial<AgentExecOptions> = {}) {
  const events: Ev[] = [];
  await runAgentExec({
    runtime: 'claude',
    prompt: 'go',
    maxTurns: 2,
    toolTimeoutMs: 1000,
    emit: (ev) => events.push(ev),
    runnerOverride: runner,
    ...over,
  } as AgentExecOptions);
  return events;
}

const done: AgentMessage = { type: 'result', subtype: 'success' };

describe('#724: start reports child_pid / pgid / exec_tree', () => {
  it('full access: start is emitted after the child is known and carries the three fields', async () => {
    const runner: AgentRunner = {
      async *run(args) {
        args.onProcessSpawned?.({
          pid: 4321,
          pgid: 4321,
          execTree: 'tok-123',
          getBackgroundSurvivors: () => ({ pids: [], supported: true }),
        });
        yield { type: 'assistant', text: 'hi' };
        yield done;
      },
    };
    const events = await exec(runner, { access: 'full', cwd: process.cwd() });
    expect(events[0]).toMatchObject({
      type: 'start',
      pid: process.pid,
      child_pid: 4321,
      pgid: 4321,
      exec_tree: 'tok-123',
    });
    expect(events[1].type).toBe('assistant');
  });

  it('full access: pgid is omitted when the runner reports none (no lying)', async () => {
    const runner: AgentRunner = {
      async *run(args) {
        args.onProcessSpawned?.({
          pid: 7,
          execTree: 't',
          getBackgroundSurvivors: () => ({ pids: [], supported: false }),
        });
        yield done;
      },
    };
    const start = (await exec(runner, { access: 'full', cwd: process.cwd() }))[0];
    expect(start).toMatchObject({ child_pid: 7, exec_tree: 't' });
    expect('pgid' in start).toBe(false);
  });

  it('full access, runner never spawns: start is still first, without the fields', async () => {
    const runner: AgentRunner = {
      async *run() {
        yield { type: 'assistant', text: 'in-process' };
        yield done;
      },
    };
    const events = await exec(runner, { access: 'full', cwd: process.cwd() });
    expect(events[0].type).toBe('start');
    for (const k of ['child_pid', 'pgid', 'exec_tree']) expect(k in events[0]).toBe(false);
    expect(events[1].type).toBe('assistant');
  });

  it('full access, runner fails before spawning: start precedes the error', async () => {
    const runner: AgentRunner = {
      // biome-ignore lint/correctness/useYield: throws before yielding
      async *run() {
        throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      },
    };
    const events = await exec(runner, { access: 'full', cwd: process.cwd() });
    expect(events[0].type).toBe('start');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('scoped access: fields are omitted and start is unchanged', async () => {
    const runner: AgentRunner = {
      async *run() {
        yield done;
      },
    };
    const events = await exec(runner, { access: 'scoped' });
    expect(events[0].type).toBe('start');
    for (const k of ['child_pid', 'pgid', 'exec_tree']) expect(k in events[0]).toBe(false);
  });

  describe.runIf(process.platform === 'linux')('through the real claude full-access spawn', () => {
    beforeAll(async () => {
      await loadClaudeSdk();
    }, 60_000);

    it('exec_tree is the token the spawned process really carries; pgid is its group', async () => {
      let envSeen = '';
      let spawned = 0;
      const queryFn = (a: any) =>
        (async function* () {
          const child = a.options.spawnClaudeCodeProcess({
            command: 'sleep',
            args: ['5'],
            cwd: undefined,
            env: process.env,
          });
          spawned = child.pid;
          envSeen = readFileSync(`/proc/${child.pid}/environ`, 'utf8');
          child.kill('SIGKILL');
          yield { type: 'result', session_id: 's', subtype: 'success', is_error: false };
        })();
      const events = await exec(new ClaudeAgentRunner(queryFn as any), { access: 'full', cwd: process.cwd() });
      const start = events[0];
      expect(start.type).toBe('start');
      expect(start.child_pid).toBe(spawned);
      expect(start.pgid).toBe(spawned);
      expect(envSeen.split('\0')).toContain(`MONOMIND_EXEC_TREE=${start.exec_tree}`);
    });
  });
});
