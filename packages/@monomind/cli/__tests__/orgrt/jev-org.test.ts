import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../../src/orgrt/daemon.js';
import { DISPATCH_COALESCE_MS, dagCreateTask } from '../../src/orgrt/decisions.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';
import { AUTO_ASSIGNEE, buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { ORG_DIR, OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, DISPATCH_COALESCE_MS + 200));

function makeAgent(): AgentRuntime {
  return {
    mailbox: new Mailbox(),
    policy: {} as unknown as PolicyEngine,
    done: Promise.resolve(),
    status: 'running',
    metrics: { tokens: 0, costUsd: 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scrollback: { push: () => {}, all: () => [], snapshot: () => [] } as any,
  };
}

describe('per-task skill suggestions at dispatch', () => {
  let tmp = '';
  // OrgBus appends to bus.jsonl in the background; seal before deleting tmp or
  // rmSync races the write (ENOTEMPTY) — same fix as decisions.test.ts (661e3624b).
  const openBuses: OrgBus[] = [];
  const track = (bus: OrgBus): OrgBus => {
    openBuses.push(bus);
    return bus;
  };
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await Promise.all(openBuses.splice(0).map((bus) => bus.seal()));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), 'jev-org-'));
    mkdirSync(join(tmp, 'repo'));
    const daemon = new OrgDaemon(tmp);
    const dev = makeAgent();
    const running: RunningOrg = {
      def: OrgDefSchema.parse({
        name: 'acme',
        goal: 'ship',
        roles: [
          { id: 'boss', title: 'Boss', type: 'coordinator' },
          { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss', skill_pool: ['api-design', 'api-designer'] },
        ],
      }),
      run: 'run-1',
      bus: track(new OrgBus('acme', 'run-1', join(tmp, ORG_DIR, 'acme', 'run-1'))),
      agents: new Map([
        ['dev', dev],
        ['boss', makeAgent()],
      ]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: 'boss',
      glossary: [],
      respawning: new Set(),
      taskDag: new TaskDag(),
      workdir: join(tmp, 'repo'),
    };
    daemon.orgs.set('acme', running);
    return { daemon, running, dev };
  }

  it('names the skills Jev picks in the dispatch message', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answers: {
              skill: { type: 'choice', choice: 'api-design', confidence: 0.8, probabilities: { 'api-design': 0.7, 'api-designer': 0.2, __none__: 0.1 } },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const { daemon, running, dev } = setup();
    const task = JSON.parse(dagCreateTask(daemon, 'acme', 'boss', 'design the REST endpoints', 'dev', []));
    running.pendingDispatch?.get('dev')?.lines.push('briefing: use the v2 schema');
    await settle();
    const delivered = dev.mailbox.serialize().queue.join('\n');
    expect(delivered).toContain(`[task:${task.id}] design the REST endpoints`);
    expect(delivered).toContain('Skills that fit this task (load with org_skill_load): api-design, api-designer');
    expect(delivered.indexOf('design the REST endpoints')).toBeLessThan(delivered.indexOf('briefing: use the v2 schema'));
    daemon.orgs.delete('acme');
  });

  it('keeps the task brief alongside the skills Jev picks', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answers: {
            skill: { type: 'choice', choice: 'api-design', confidence: 0.8, probabilities: { 'api-design': 0.9, __none__: 0.1 } },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { daemon, dev } = setup();
    const task = JSON.parse(
      dagCreateTask(daemon, 'acme', 'boss', 'design the REST endpoints', 'dev', [], undefined, 'Use the v2 schema; no breaking changes.'),
    );
    await settle();
    const delivered = dev.mailbox.serialize().queue.join('\n');
    expect(delivered).toContain(`[task:${task.id}] design the REST endpoints`);
    expect(delivered).toContain('Use the v2 schema; no breaking changes.');
    expect(delivered).toContain('Skills that fit this task (load with org_skill_load): api-design');
    expect(JSON.stringify(fetchSpy.mock.calls)).toContain('design the REST endpoints');
    daemon.orgs.delete('acme');
  });

  it('suggests pool skills by keyword when no decision model is configured', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { daemon, running, dev } = setup();
    const task = JSON.parse(dagCreateTask(daemon, 'acme', 'boss', 'design the REST endpoints', 'dev', []));
    await settle();
    const delivered = dev.mailbox.serialize().queue.join('\n');
    expect(delivered).toContain(`[task:${task.id}] design the REST endpoints`);
    expect(delivered).toMatch(/Skills that fit this task \(load with org_skill_load\): api-design/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(running.taskDag?.get(task.id)?.suggestedSkills).toContain('api-design');
    daemon.orgs.delete('acme');
  });

  it('dispatches the plain line when no pool skill fits the task', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const { daemon, running, dev } = setup();
    const task = JSON.parse(dagCreateTask(daemon, 'acme', 'boss', 'book a flight', 'dev', []));
    await settle();
    expect(dev.mailbox.serialize().queue.join('\n')).not.toContain('Skills that fit');
    expect(running.taskDag?.get(task.id)?.suggestedSkills).toBeUndefined();
    daemon.orgs.delete('acme');
  });
});

describe('org_task assignee "auto"', () => {
  function tools(extra: Partial<SessionOpts>) {
    return buildOrgTools({
      org: 'acme',
      role: { id: 'boss' } as OrgRole,
      bus: {} as OrgBus,
      policy: {} as PolicyEngine,
      mailbox: {} as Mailbox,
      cwd: '/work',
      deliver: async () => 'ok',
      ...extra,
    } as SessionOpts);
  }

  it('resolves "auto" through pickAssignee', async () => {
    const createTask = vi.fn(() => '{"id":"task-1"}');
    const pickAssignee = vi.fn(async () => ({
      role: 'dev',
      method: 'keyword' as const,
      score: 4,
      candidates: [{ id: 'dev', score: 4 }],
    }));
    const orgTask = tools({ createTask, pickAssignee }).find((t) => t.name === 'org_task');
    expect(orgTask?.description).toContain('"auto"');
    await orgTask?.handler({ title: 'add parser', assignee: AUTO_ASSIGNEE, deps: [], brief: 'in src/parse' });
    expect(pickAssignee).toHaveBeenCalledWith('add parser', 'in src/parse', 'boss');
    expect(createTask).toHaveBeenCalledWith('boss', 'add parser', 'dev', [], undefined, 'in src/parse', {
      method: 'keyword',
      score: 4,
      candidates: [{ id: 'dev', score: 4 }],
    });
  });

  it('refuses "auto" when no role fits, without creating a task', async () => {
    const createTask = vi.fn(() => '{}');
    const orgTask = tools({
      createTask,
      pickAssignee: async () => ({ role: null, method: 'none' as const, candidates: [], reason: 'no-match' as const }),
    }).find((t) => t.name === 'org_task');
    const out = await orgTask?.handler({ title: 'zzz', assignee: AUTO_ASSIGNEE, deps: [] });
    expect(JSON.stringify(out)).toContain('no role fits');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('does not mention "auto" when auto-assignment is unavailable', () => {
    const orgTask = tools({ createTask: () => 'ok' }).find((t) => t.name === 'org_task');
    expect(orgTask?.description).not.toContain('"auto"');
  });
});
