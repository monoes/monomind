/**
 * ADR-O001 D3 x D7. With one session per role, a task whose loadout differed
 * from the one the session was built with could only be recorded as a
 * `loadout-mismatch`. In task scope a session exists per task, so each one is
 * built with ITS task's loadout, and a retry resumes under the identical
 * prompt.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { DISPATCH_COALESCE_MS, dispatchReadyTasks } from '../../src/orgrt/decisions.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { SessionLedger } from '../../src/orgrt/session-ledger.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

function promptText(options: any): string {
  const sp = options?.systemPrompt;
  return typeof sp === 'string' ? sp : JSON.stringify(sp);
}

describe('D3 x D7: a task-scoped session is built with its own task loadout', () => {
  it('uses each task loadout, and resumes a retry under the identical prompt', async () => {
    const calls: { resume?: string; prompt: string }[] = [];
    let n = 0;
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        calls.push({ resume: options?.resume, prompt: promptText(options) });
        const sid = options?.resume ?? `sid-${++n}`;
        yield { type: 'system', subtype: 'init', session_id: sid };
        for await (const _m of prompt) {
          yield { type: 'result', subtype: 'success', session_id: sid, usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const loadouts: Record<string, { name: string; guidance: string }> = {
      'task-1': { name: 'implement', guidance: '## Loadout: implement\nWRITE-CODE' },
      'task-2': { name: 'docs', guidance: '## Loadout: docs\nWRITE-DOCS' },
    };
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'd3d7-')));
    const mailbox = new Mailbox();
    mailbox.push('[task:task-1] [loadout:implement] a');
    mailbox.push('[task:task-2] [loadout:docs] b');
    mailbox.push('[task:task-1] [loadout:implement] NOT CLOSED — retry');
    const done = runAgentSession({
      org: 'o',
      role: { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss', responsibilities: [] } as any,
      bus,
      policy: new PolicyEngine('dev', {}, bus, '/work'),
      mailbox,
      cwd: '/work',
      deliver: async () => 'ok',
      queryFn: queryFn as any,
      def: { name: 'o', goal: 'g', roles: [{ id: 'boss' }, { id: 'dev', reports_to: 'boss' }], run_config: { session_scope: 'task' } } as any,
      sessionLedger: new SessionLedger(),
      // The incarnation's own loadout must NOT leak into a task that chose another.
      loadout: { name: 'implement', guidance: '## Loadout: implement\nWRITE-CODE' },
      loadoutFor: (taskId: string) => loadouts[taskId],
    } as any);
    await tick(60);
    mailbox.close();
    await done;

    expect(calls).toHaveLength(3);
    expect(calls[0].prompt).toContain('WRITE-CODE');
    expect(calls[1].prompt).toContain('WRITE-DOCS');
    expect(calls[1].prompt).not.toContain('WRITE-CODE');
    expect(calls[2].resume).toBe('sid-1');
    expect(calls[2].prompt).toBe(calls[0].prompt);
  });

  it('does not report a loadout-mismatch for a task-scoped assignee', () => {
    vi.useFakeTimers();
    try {
      const def = OrgDefSchema.parse({
        name: 'o',
        goal: 'g',
        run_config: { session_scope: 'task' },
        loadouts: { implement: { prompt: 'x' }, docs: { prompt: 'y' } },
        roles: [
          { id: 'boss', title: 'B', type: 'b' },
          { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
        ],
      });
      const taskDag = new TaskDag();
      taskDag.add('write docs', 'dev', [], 'docs');
      const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'd3d7-mm-')));
      const reasons: string[] = [];
      bus.subscribe((e) => {
        if (e.reason) reasons.push(e.reason);
      });
      const running = {
        def,
        taskDag,
        bus,
        agents: new Map([['dev', { mailbox: new Mailbox(), loadout: 'implement' }]]),
        pendingRoles: new Map(),
        bossRoleId: 'boss',
      } as any;
      dispatchReadyTasks({} as any, 'o', running);
      vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
      expect(reasons).toContain('task-dispatched');
      expect(reasons).not.toContain('loadout-mismatch');
    } finally {
      vi.useRealTimers();
    }
  });
});
