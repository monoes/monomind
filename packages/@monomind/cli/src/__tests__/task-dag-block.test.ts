/**
 * The org task model had no way to represent "this task can't proceed until a
 * specific real-world time" — only dependency-based blocking (deps not done
 * yet). Observed live on a real, long-running org: a role explicitly said in
 * chat "task-4 status='running' represents standby/blocked state (no
 * 'blocked' status in org task model)" while waiting on a scheduled 24h soak
 * test. With no way to express that, the idle watchdog nudged the boss every
 * ~10-20 minutes for hours, each nudge a real LLM turn spent re-confirming
 * "still waiting, nothing changed" — pure wasted cost for zero new
 * information, only reset the idle-nudge counter without ever actually
 * enabling anyone to skip the exchange.
 *
 * `org_task_block` (this file) adds a real 'blocked' status with a
 * blockedUntil timestamp; the idle watchdog (daemon.ts) treats an active
 * block the same as a pending decision gate — skip nudging entirely — and
 * auto-resumes (re-dispatches) the task the moment the time passes.
 */
import { describe, expect, it } from 'vitest';
import { TaskDag } from '../orgrt/task-dag.js';

describe('TaskDag — block/unblockExpired/hasActiveBlock', () => {
  it('blocks a running task with a future blockedUntil and reason', () => {
    const dag = new TaskDag();
    const t = dag.add('Analyze soak test evidence', 'performance-engineer');
    dag.markRunning(t.id);

    const future = Date.now() + 60_000;
    const blocked = dag.block(t.id, future, 'Waiting on 24h soak test, due Friday');

    expect(blocked.status).toBe('blocked');
    expect(blocked.blockedUntil).toBe(future);
    expect(blocked.blockedReason).toBe('Waiting on 24h soak test, due Friday');
  });

  it('refuses to block a task that is not currently running', () => {
    const dag = new TaskDag();
    const t = dag.add('Design phase 2', 'principal-architect'); // status: 'ready'
    expect(() => dag.block(t.id, Date.now() + 60_000)).toThrow(/must be 'running' to block/);
  });

  it('refuses a blockedUntil that is not in the future', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'a');
    dag.markRunning(t.id);
    expect(() => dag.block(t.id, Date.now() - 1000)).toThrow(/must be in the future/);
  });

  it('refuses to block a nonexistent task', () => {
    const dag = new TaskDag();
    expect(() => dag.block('task-999', Date.now() + 60_000)).toThrow(/not found/);
  });

  it('hasActiveBlock is true while blockedUntil is in the future, false once passed', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'a');
    dag.markRunning(t.id);
    dag.block(t.id, Date.now() + 60_000);

    expect(dag.hasActiveBlock(Date.now())).toBe(true);
    expect(dag.hasActiveBlock(Date.now() + 120_000)).toBe(false); // as-of a later "now", the block has lapsed
  });

  it('hasActiveBlock is false when nothing is blocked', () => {
    const dag = new TaskDag();
    dag.add('x', 'a');
    expect(dag.hasActiveBlock(Date.now())).toBe(false);
  });

  it('hasActiveBlock is false when one task is blocked far in the future but another is still running', () => {
    // Regression: a single long-lived block (e.g. a feature deferred for
    // weeks) must not silence the idle watchdog for the whole org while
    // unrelated work is genuinely outstanding.
    const dag = new TaskDag();
    const deferred = dag.add('deferred feature', 'a');
    dag.markRunning(deferred.id);
    dag.block(deferred.id, Date.now() + 14 * 24 * 60 * 60 * 1000, 'deferred for weeks');

    const active = dag.add('unrelated in-progress work', 'b');
    dag.markRunning(active.id);

    expect(dag.hasActiveBlock(Date.now())).toBe(false);
  });

  it('hasActiveBlock is true when every non-terminal task is blocked on a future time', () => {
    const dag = new TaskDag();
    const t1 = dag.add('x', 'a');
    dag.markRunning(t1.id);
    dag.block(t1.id, Date.now() + 60_000);

    const t2 = dag.add('y', 'b');
    dag.markRunning(t2.id);
    dag.block(t2.id, Date.now() + 90_000);

    expect(dag.hasActiveBlock(Date.now())).toBe(true);
  });

  it('unblockExpired transitions an expired block back to running and clears blockedUntil/reason', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'a');
    dag.markRunning(t.id);
    dag.block(t.id, Date.now() + 1, 'brief wait');

    const unblocked = dag.unblockExpired(Date.now() + 100); // "now" is past the block time
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe(t.id);
    expect(unblocked[0].status).toBe('running');
    expect(unblocked[0].blockedUntil).toBeUndefined();
    expect(unblocked[0].blockedReason).toBeUndefined();
  });

  it('unblockExpired leaves a still-future block untouched', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'a');
    dag.markRunning(t.id);
    dag.block(t.id, Date.now() + 60_000);

    const unblocked = dag.unblockExpired(Date.now());
    expect(unblocked).toHaveLength(0);
    expect(dag.get(t.id)?.status).toBe('blocked');
  });

  it('unblockExpired is a no-op when nothing is blocked', () => {
    const dag = new TaskDag();
    dag.add('x', 'a');
    expect(dag.unblockExpired(Date.now())).toEqual([]);
  });

  it('downstream tasks depending on a blocked task stay pending — blocked is not satisfied', () => {
    const dag = new TaskDag();
    const parent = dag.add('parent', 'a');
    dag.markRunning(parent.id);
    dag.block(parent.id, Date.now() + 60_000);
    const child = dag.add('child', 'b', [parent.id]);

    expect(child.status).toBe('pending'); // NOT 'ready' — blocked ≠ satisfied
  });
});
