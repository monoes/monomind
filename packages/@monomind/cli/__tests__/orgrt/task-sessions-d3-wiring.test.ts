/**
 * ADR-O001 D3 wiring: the schema opt-in, and task dispatch. A coalesced
 * dispatch message would name several tasks, so in task scope each task is
 * pushed as its own message; the default keeps #275's one-message batching.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { dispatchReadyTasks, DISPATCH_COALESCE_MS } from '../../src/orgrt/decisions.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const minimal = {
  name: 'o',
  goal: 'g',
  roles: [
    { id: 'boss', title: 'Boss', type: 'coordinator' },
    { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss' },
  ],
};

describe('D3 schema', () => {
  it('adds no session fields to an org that did not ask (default = role scope)', () => {
    const def = OrgDefSchema.parse(minimal);
    expect('session_scope' in def.run_config).toBe(false);
    expect('session_idle_exit_ms' in def.run_config).toBe(false);
    expect('session_scope' in def.roles[1]).toBe(false);
  });

  it('accepts the opt-ins and rejects nonsense', () => {
    const def = OrgDefSchema.parse({
      ...minimal,
      run_config: { session_scope: 'task', session_idle_exit_ms: 60_000 },
      roles: [minimal.roles[0], { ...minimal.roles[1], session_scope: 'role' }],
    });
    expect(def.run_config.session_scope).toBe('task');
    expect(def.run_config.session_idle_exit_ms).toBe(60_000);
    expect(def.roles[1].session_scope).toBe('role');
    expect(() => OrgDefSchema.parse({ ...minimal, run_config: { session_scope: 'turn' } })).toThrow();
  });
});

describe('D3 dispatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function running(runConfig: Record<string, unknown>) {
    const def = OrgDefSchema.parse({ ...minimal, run_config: runConfig });
    const mailbox = new Mailbox();
    const pushed: string[] = [];
    const push = mailbox.push.bind(mailbox);
    mailbox.push = (t: string) => {
      pushed.push(t);
      push(t);
    };
    const taskDag = new TaskDag();
    taskDag.add('first', 'dev');
    taskDag.add('second', 'dev');
    const r = {
      def,
      taskDag,
      bus: new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'd3-disp-'))),
      agents: new Map([['dev', { mailbox }]]),
      pendingRoles: new Map(),
      bossRoleId: 'boss',
    } as any;
    return { r, pushed };
  }

  it('default: dispatches inside one window arrive as ONE message (unchanged #275 batching)', () => {
    const { r, pushed } = running({});
    dispatchReadyTasks({} as any, 'o', r);
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(pushed).toEqual(['[task:task-1] first\n\n[task:task-2] second']);
  });

  it("task scope: each task is its own message, so each message has one session key", () => {
    const { r, pushed } = running({ session_scope: 'task' });
    dispatchReadyTasks({} as any, 'o', r);
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(pushed).toEqual(['[task:task-1] first', '[task:task-2] second']);
  });
});

describe('D3 daemon wiring', () => {
  it("records every session run in the run's own sessions.json", async () => {
    const { OrgDaemon } = await import('../../src/orgrt/daemon.js');
    const { mkdirSync, writeFileSync, readFileSync, readdirSync } = await import('node:fs');
    const root = mkdtempSync(join(tmpdir(), 'd3-daemon-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(root, '.monomind/orgs/alpha.json'),
      JSON.stringify({ name: 'alpha', goal: 'g', roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }] }),
    );
    const query = ({ prompt }: any) =>
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'boss-sid' };
        for await (const _m of prompt) {
          yield { type: 'result', subtype: 'success', session_id: 'boss-sid', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const d = new OrgDaemon(root, { queryFn: query as any, forward: false });
    await d.startOrg('alpha');
    await new Promise((r) => setTimeout(r, 50));
    await d.stopOrg('alpha');
    const runDir = readdirSync(join(root, '.monomind/orgs/alpha')).find((n) => n.startsWith('run-'))!;
    const ledger = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha', runDir, 'sessions.json'), 'utf8'));
    expect(ledger.runs[0]).toMatchObject({ role: 'boss', taskKey: '_role', sessionIdAfter: 'boss-sid' });
  });
});
