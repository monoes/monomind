/**
 * dagBlockTask (decisions.ts) is the daemon-facing wiring behind the
 * org_task_block tool — see task-dag-block.test.ts for the underlying
 * TaskDag.block() behavior this delegates to. These tests exercise the
 * full daemon-facing shape: bus event emission, error JSON on bad input,
 * and the "org not running" guard shared by every other dagXxx function.
 */
import { describe, expect, it } from 'vitest';
import type { OrgDaemon, RunningOrg } from '../orgrt/daemon.js';
import { dagBlockTask } from '../orgrt/decisions.js';
import { TaskDag } from '../orgrt/task-dag.js';
import type { BusEvent } from '../orgrt/types.js';

function fakeDaemon(taskDag?: TaskDag): { daemon: OrgDaemon; events: BusEvent[] } {
  const events: BusEvent[] = [];
  const running = taskDag
    ? ({ taskDag, bus: { emit: (e: BusEvent) => events.push(e) } } as unknown as RunningOrg)
    : undefined;
  const orgs = new Map(running ? [['myorg', running]] : []);
  const daemon = { orgs } as unknown as OrgDaemon;
  return { daemon, events };
}

describe('dagBlockTask', () => {
  it('blocks a running task and emits a task-blocked bus event', () => {
    const dag = new TaskDag();
    const t = dag.add('Analyze soak evidence', 'performance-engineer');
    dag.markRunning(t.id);
    const { daemon, events } = fakeDaemon(dag);

    const result = JSON.parse(
      dagBlockTask(
        daemon,
        'myorg',
        'performance-engineer',
        t.id,
        '2026-08-19T09:00:00Z',
        'Waiting on soak test',
      ),
    );

    expect(result.blocked).toBe(t.id);
    expect(result.status).toBe('blocked');
    expect(dag.get(t.id)?.status).toBe('blocked');
    expect(dag.get(t.id)?.blockedReason).toBe('Waiting on soak test');

    const ev = events.find((e) => e.reason === 'task-blocked');
    expect(ev).toBeDefined();
    expect((ev?.data as { taskId?: string })?.taskId).toBe(t.id);
  });

  it('returns an error JSON, not a throw, for an invalid ISO date', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'a');
    dag.markRunning(t.id);
    const { daemon } = fakeDaemon(dag);

    const result = JSON.parse(dagBlockTask(daemon, 'myorg', 'a', t.id, 'not-a-date'));
    expect(result.error).toMatch(/not a valid ISO date/);
    expect(dag.get(t.id)?.status).toBe('running'); // unchanged
  });

  it('returns an error JSON for a task that is not running', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'a'); // status: 'ready', never marked running
    const { daemon } = fakeDaemon(dag);

    const result = JSON.parse(dagBlockTask(daemon, 'myorg', 'a', t.id, '2026-08-19T09:00:00Z'));
    expect(result.error).toMatch(/must be 'running' to block/);
  });

  it('returns "org not running" when the org has no live taskDag', () => {
    const { daemon } = fakeDaemon(undefined);
    const result = JSON.parse(
      dagBlockTask(daemon, 'ghost-org', 'a', 'task-1', '2026-08-19T09:00:00Z'),
    );
    expect(result.error).toBe('org not running');
  });
});
