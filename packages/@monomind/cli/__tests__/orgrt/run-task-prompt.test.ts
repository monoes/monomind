// The run's task text (`org run --task`, or startOrg's second argument) reaches every role's system prompt.
// Before, only the coordinator was sent it (a mailbox message); a worker's prompt carried the org goal alone, so a
// short goal with the details in the task left workers asking the lead for it or digging it out of the run's bus.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { buildRolePrompt } from '../../src/orgrt/session-prompt.js';
import { Scripted } from './documents/e2e/scripted.js';

const role = (id: string, reports_to?: string) =>
  ({ id, type: 'worker', title: id, reports_to, responsibilities: [] }) as any;
const def = { name: 'acme', goal: 'Do the sweep.' };
const TASK = 'TASK-TEXT-7f3a: write out/<m>/answers.json as {"module":..,"answers":[..]} within 600 s';

describe('buildRolePrompt with a run task', () => {
  it('adds the task text after the goal, for a worker and for the coordinator', () => {
    for (const r of [role('boss'), role('dev', 'boss')]) {
      const p = buildRolePrompt(r, def, ['boss', 'dev'], undefined, undefined, undefined, TASK);
      expect(p).toContain(TASK);
      expect(p.indexOf(TASK)).toBeGreaterThan(p.indexOf('Org goal: Do the sweep.'));
    }
  });
  it('is byte for byte the old prompt with no task, or a task equal to the goal', () => {
    const r = role('dev', 'boss');
    const old = buildRolePrompt(r, def, ['boss', 'dev']);
    expect(buildRolePrompt(r, def, ['boss', 'dev'], undefined, undefined, undefined, undefined)).toBe(old);
    expect(buildRolePrompt(r, def, ['boss', 'dev'], undefined, undefined, undefined, def.goal)).toBe(old);
    expect(buildRolePrompt(r, def, ['boss', 'dev'], undefined, undefined, undefined, '')).toBe(old);
  });
});

describe('a started org', () => {
  let root = '';
  const daemons: OrgDaemon[] = [];
  beforeEach(() => {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'run-task-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(root, '.monomind/orgs/acme.json'),
      JSON.stringify({
        name: 'acme',
        goal: 'Do the sweep.',
        roles: [
          { id: 'boss', type: 'coordinator', title: 'Boss', responsibilities: [] },
          { id: 'dev', type: 'worker', title: 'Dev', reports_to: 'boss', responsibilities: [] },
        ],
      }),
    );
  });
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
    rmSync(root, { recursive: true, force: true });
  });

  const start = async (task?: string) => {
    const runner = new Scripted();
    const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    await d.startOrg('acme', task, {});
    await runner.toolsOf(d, 'acme', 'dev');
    await runner.toolsOf(d, 'acme', 'boss');
    return runner;
  };

  it('gives the worker and the coordinator the run task in their system prompts', async () => {
    const runner = await start(TASK);
    expect(runner.systemPrompts.get('dev')).toContain(TASK);
    expect(runner.systemPrompts.get('boss')).toContain(TASK);
  });
  it('leaves the prompts as they were when no task is given', async () => {
    const runner = await start(undefined);
    expect(runner.systemPrompts.get('dev')).not.toContain('TASK-TEXT');
    // the same prompt the pure builder gives with no task (the title is the role's own)
    expect(runner.systemPrompts.get('dev')).toBe(
      buildRolePrompt({ ...role('dev', 'boss'), title: 'Dev' }, def, ['boss', 'dev']),
    );
  });
});
