/**
 * A role can end its turn with its own task still open, and nothing notices.
 *
 * On the 2.15.6 release run the publisher reported its results with `org_send`
 * and ended its turn without ever calling `org_task_done`. The coordinator was
 * waiting on a completion that never came, so the run sat still for ~10 minutes
 * until a human nudged it — the only automatic backstop is the org-wide idle
 * watchdog, whose window is `run_config.idle_minutes` (45 in that org).
 *
 * The runtime now nudges the role itself at the end of its turn: one short
 * system message naming the open task and what closing it takes, plus an audit
 * event. It is deliberately narrow — the assignee's own turn end, nothing else
 * queued for it, one nudge per dispatch, and never for a time-blocked task —
 * and it does not change what the idle watchdog does.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunner } from '../orgrt/agent-runner.js';
import { OrgBus } from '../orgrt/bus.js';
import type { AgentRuntime, RunningOrg } from '../orgrt/daemon.js';
import { nudgeOpenTasksAtTurnEnd } from '../orgrt/decisions.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession } from '../orgrt/session.js';
import { TaskDag } from '../orgrt/task-dag.js';
import type { BusEvent, OrgRole } from '../orgrt/types.js';
import { ORG_DIR, type OrgDef } from '../orgrt/types.js';

const openBuses: OrgBus[] = [];
async function sealBuses(): Promise<void> {
  await Promise.all(openBuses.splice(0).map((bus) => bus.seal()));
}

function makeAgent(): AgentRuntime {
  return {
    mailbox: new Mailbox(),
    policy: {} as unknown as PolicyEngine,
    done: Promise.resolve(),
    status: 'running',
    metrics: { tokens: 0, costUsd: 0 },
    scrollback: { push: () => {}, all: () => [], snapshot: () => [] } as any,
  };
}

/** The nudge is queued through the same coalescing window as a dispatch. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));

describe('open-task nudge at turn end', () => {
  let tmp = '';
  afterEach(async () => {
    await sealBuses();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setup(completionEvidence = false) {
    tmp = mkdtempSync(join(tmpdir(), 'org-open-nudge-'));
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    openBuses.push(bus);
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const publisher = makeAgent();
    const taskDag = new TaskDag();
    const task = taskDag.add('publish 2.15.6 to npm', 'publisher', []);
    taskDag.markRunning(task.id);
    const running: RunningOrg = {
      def: {
        name: 'alpha',
        goal: 'test',
        roles: [{ id: 'captain' }, { id: 'publisher', reports_to: 'captain' }],
        run_config: {
          idle_minutes: 45,
          ...(completionEvidence ? { completion_evidence: true } : {}),
        },
      } as unknown as OrgDef,
      run: 'run-1',
      bus,
      agents: new Map([['publisher', publisher]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: 'captain',
      glossary: [],
      respawning: new Set(),
      taskDag,
    };
    return { running, taskDag, task, publisher, events };
  }

  it('nudges the assignee about a task it left open, naming the task', async () => {
    const { running, task, publisher, events } = setup();

    nudgeOpenTasksAtTurnEnd(running, 'publisher');

    const audit = events.find((e) => e.reason === 'task-open-at-turn-end');
    expect(audit).toBeTruthy();
    expect(audit?.type).toBe('audit');
    expect((audit?.data as any).taskId).toBe(task.id);

    await settle();
    const delivered = publisher.mailbox.serialize().queue.join('\n');
    expect(delivered).toContain(`[task:${task.id}]`);
    expect(delivered).toContain('org_task_done');
    expect(delivered).toContain(task.title);
  });

  it('says evidence is required when run_config.completion_evidence is on', async () => {
    const { running, publisher } = setup(true);

    nudgeOpenTasksAtTurnEnd(running, 'publisher');

    await settle();
    expect(publisher.mailbox.serialize().queue.join('\n')).toMatch(/evidence/i);
  });

  it('does not nudge after the task was properly closed', async () => {
    const { running, taskDag, task, publisher, events } = setup();
    taskDag.complete(task.id, 'published');

    nudgeOpenTasksAtTurnEnd(running, 'publisher');

    expect(events.find((e) => e.reason === 'task-open-at-turn-end')).toBeUndefined();
    await settle();
    expect(publisher.mailbox.serialize().queue).toHaveLength(0);
  });

  it('does not nudge a task blocked on a real-world time', async () => {
    const { running, taskDag, task, publisher, events } = setup();
    taskDag.block(task.id, Date.now() + 60_000, 'waiting on the npm registry');

    nudgeOpenTasksAtTurnEnd(running, 'publisher');

    expect(events.find((e) => e.reason === 'task-open-at-turn-end')).toBeUndefined();
    await settle();
    expect(publisher.mailbox.serialize().queue).toHaveLength(0);
  });

  it('nudges at most once per task per dispatch, however many turns end', async () => {
    const { running, publisher, events } = setup();

    nudgeOpenTasksAtTurnEnd(running, 'publisher');
    await settle();
    nudgeOpenTasksAtTurnEnd(running, 'publisher');
    await settle();
    nudgeOpenTasksAtTurnEnd(running, 'publisher');
    await settle();

    expect(events.filter((e) => e.reason === 'task-open-at-turn-end')).toHaveLength(1);
    expect(publisher.mailbox.serialize().queue).toHaveLength(1);
  });

  // The check above is only worth anything if something actually calls it when
  // the role's turn ends: session.ts fires onTurnEnd on the runner's `result`.
  it('is reached from a real session when its turn ends', async () => {
    const { running, task, publisher, events } = setup();
    const fakeRunner: AgentRunner = {
      async *run(): AsyncIterable<AgentMessage> {
        yield { type: 'result', subtype: 'success', session_id: 's1' } as AgentMessage;
        publisher.mailbox.close();
      },
    };
    await runAgentSession({
      org: 'alpha',
      role: { id: 'publisher', reports_to: 'captain' } as unknown as OrgRole,
      bus: running.bus,
      policy: new PolicyEngine('publisher', {} as any, running.bus, tmp),
      mailbox: publisher.mailbox,
      cwd: tmp,
      deliver: async () => 'ok',
      runner: fakeRunner,
      maxTurns: 5,
      onTurnEnd: () => nudgeOpenTasksAtTurnEnd(running, 'publisher'),
    });

    const audit = events.find((e) => e.reason === 'task-open-at-turn-end');
    expect(audit).toBeTruthy();
    expect((audit?.data as any).taskId).toBe(task.id);
  });

  it('does not nudge while the assignee still has mail to work through', async () => {
    const { running, publisher, events } = setup();
    publisher.mailbox.push('[message from captain] subject: one more thing');

    nudgeOpenTasksAtTurnEnd(running, 'publisher');

    expect(events.find((e) => e.reason === 'task-open-at-turn-end')).toBeUndefined();
    await settle();
    expect(publisher.mailbox.serialize().queue).toHaveLength(1);
  });
});
