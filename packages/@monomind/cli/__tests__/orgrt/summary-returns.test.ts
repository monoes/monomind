// packages/@monomind/cli/__tests__/orgrt/summary-returns.test.ts
//
// Org sections spec 6.4 and Phase 2: a delegated task returns a short summary
// (at most 1,000 characters) with the ids and file paths of what it produced,
// never its transcript (R20). The limit is enforced, not requested: a longer
// result is rejected with a remedy and the task stays open. Only an org on the
// opt-in surface is bound by it.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MAX_TASK_RESULT } from '../../src/orgrt/context-surface.js';
import type { OrgBus } from '../../src/orgrt/bus.js';
import type { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';

const def = (context?: unknown) =>
  OrgDefSchema.parse({
    name: 'o',
    goal: 'g',
    run_config: context === undefined ? {} : { context },
    roles: [
      { id: 'boss', title: 'B', type: 'boss' },
      { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
    ],
  });

function tools(context: unknown, completeTask = vi.fn(() => '{"ok":true}')) {
  const list = buildOrgTools({
    org: 'o', role: { id: 'dev' } as OrgRole, def: def(context), bus: {} as OrgBus, policy: {} as PolicyEngine,
    mailbox: {} as Mailbox, cwd: '/work', deliver: async () => 'ok', completeTask,
  } as SessionOpts);
  return { done: list.find((t) => t.name === 'org_task_done')!, completeTask, list };
}

describe('summary-only returns', () => {
  it('is 1,000 characters', () => expect(MAX_TASK_RESULT).toBe(1000));

  it('accepts a result of exactly the limit and passes it through untouched', async () => {
    const { done, completeTask } = tools({ notes: true });
    const result = 'r'.repeat(MAX_TASK_RESULT);
    await done.handler({ taskId: 'task-1', result });
    expect(completeTask).toHaveBeenCalledWith('dev', 'task-1', result, undefined);
  });

  it('rejects a longer result with a remedy, never truncating it, and leaves the task open', async () => {
    const { done, completeTask } = tools({ notes: true });
    const out = JSON.parse((await done.handler({ taskId: 'task-1', result: 'r'.repeat(MAX_TASK_RESULT + 1) })).text);
    expect(out.error).toMatch(/1001 characters.*1000/);
    expect(out.error).toMatch(/file/);
    expect(completeTask).not.toHaveBeenCalled();
  });

  it('allows a task closed with no result', async () => {
    const { done, completeTask } = tools({ require_brief: true });
    await done.handler({ taskId: 'task-1' });
    expect(completeTask).toHaveBeenCalled();
  });

  it('tells the model what to return, only in an org on the surface', () => {
    expect(tools({ notes: true }).done.description).toMatch(/1,000 characters/);
    expect(tools(undefined).done.description).not.toMatch(/1,000 characters/);
  });

  it('leaves an org that adopted nothing exactly as before: any result length, same tool', async () => {
    const plain = tools(undefined);
    const big = 'r'.repeat(5000);
    await plain.done.handler({ taskId: 'task-1', result: big });
    expect(plain.completeTask).toHaveBeenCalledWith('dev', 'task-1', big, undefined);
    const fp = (t: ReturnType<typeof tools>) =>
      createHash('sha256').update(JSON.stringify([t.done.description, JSON.stringify(z.toJSONSchema(z.object(t.done.schema as z.ZodRawShape)))])).digest('hex');
    expect(fp(tools({}))).toBe(fp(tools(undefined)));
    expect(fp(tools({ notes: true }))).not.toBe(fp(tools(undefined)));
  });
});
