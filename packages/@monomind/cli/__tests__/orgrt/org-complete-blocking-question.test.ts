// packages/@monomind/cli/__tests__/orgrt/org-complete-blocking-question.test.ts
/**
 * #564: a boss called `ask_human` with `blocking: true` and then, in the same
 * turn, `org_complete` with an answer it made up — the run ended before the
 * human replied. A blocking question that is still open must stop the run
 * from being completed: `org_complete` is refused with a tool error until the
 * question is answered. The one honest way to end the run meanwhile is
 * `outcome: 'partial'` with `blocker: 'human'`, which says exactly that — so
 * the gate still cannot trap a run whose human never answers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/resource-governor.js', () => {
  const ok = { ok: true, freeMemMB: 2000, freeMemPct: 80, sdkProcesses: 0, maxSdkProcesses: 10 };
  return {
    checkResources: vi.fn(() => ok),
    waitForCapacity: vi.fn(async () => ok),
    getResourceLimits: vi.fn(() => ({ minFreeMemBytes: 0, maxSdkProcesses: 10, spawnStaggerMs: 0 })),
    configureResourceLimits: vi.fn(),
    reapOrphanedSdkProcesses: vi.fn(() => 0),
    getAvailableMemBytes: vi.fn(() => 2000 * 1024 * 1024),
  };
});

import { type CompletionFacts, checkCompletion } from '../../src/orgrt/completion-gate.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { buildRoleSessionOpts } from '../../src/orgrt/role-session-opts.js';

const FACTS: CompletionFacts = {
  outcome: 'achieved',
  mode: 'boss',
  maxBudgetFraction: 0,
  pendingHumanWaits: 1,
  hasActiveBlock: false,
  hasPendingWork: false,
  openBlockingQuestions: ['q-1'],
};

describe('checkCompletion — an open blocking ask_human (#564)', () => {
  it.each(['achieved', 'failed'] as const)('refuses %s while a blocking question is open', (outcome) => {
    const msg = checkCompletion({ ...FACTS, outcome });
    expect(msg).toMatch(/blocking ask_human/);
    expect(msg).toMatch(/blocker: 'human'/);
  });

  it("refuses 'partial' with a blocker other than 'human'", () => {
    expect(checkCompletion({ ...FACTS, outcome: 'partial', blocker: 'budget', maxBudgetFraction: 0.95 })).toMatch(
      /blocking ask_human/,
    );
  });

  it("allows 'partial' with blocker 'human' — the honest way to end the run while waiting", () => {
    expect(checkCompletion({ ...FACTS, outcome: 'partial', blocker: 'human' })).toBeNull();
  });

  it("dag mode with runnable work still allows 'partial' with blocker 'human', so some outcome is always allowed", () => {
    const dag = { ...FACTS, mode: 'dag' as const, hasPendingWork: true };
    expect(checkCompletion({ ...dag, outcome: 'achieved' })).toMatch(/blocking ask_human/);
    expect(checkCompletion({ ...dag, outcome: 'failed' })).toMatch(/blocking ask_human/);
    expect(checkCompletion({ ...dag, outcome: 'partial', blocker: 'human' })).toBeNull();
  });

  it('allows achieved once no blocking question is open', () => {
    expect(checkCompletion({ ...FACTS, openBlockingQuestions: [], pendingHumanWaits: 0 })).toBeNull();
  });
});

describe('OrgDaemon — org_complete while a blocking ask_human is open (#564)', () => {
  const daemons: OrgDaemon[] = [];
  const roots: string[] = [];
  afterEach(async () => {
    for (const d of daemons.splice(0)) await d.stopAll();
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  async function startOrg() {
    const root = mkdtempSync(join(tmpdir(), 'org-complete-564-'));
    roots.push(root);
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(root, '.monomind/orgs/alpha.json'),
      JSON.stringify({
        name: 'alpha',
        goal: 'g',
        roles: [
          { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
          { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
        ],
      }),
    );
    const idle = () => (async function* () { await new Promise(() => {}); })();
    const d = new OrgDaemon(root, { queryFn: idle as any, forward: false, stopWaitMs: 200 });
    daemons.push(d);
    const running = await d.startOrg('alpha');
    const boss = running.def.roles.find((r) => r.id === 'boss')!;
    const rt = running.agents.get('boss')!;
    const opts = buildRoleSessionOpts(
      d, 'alpha', running, boss, root, rt, new AbortController(), undefined, rt.policy, rt.mailbox, undefined,
    );
    const complete = (outcome: 'achieved' | 'partial' | 'failed', blocker?: 'human') =>
      opts.onComplete!('boss', outcome, 'the answer is 42', blocker, undefined);
    const questionIds = () =>
      running.busEvents().filter((e) => e.type === 'question').map((e) => (e.data as { questionId: string }).questionId);
    return { d, running, complete, questionIds };
  }

  it('refuses org_complete while the boss’s blocking question is open, and allows it after the answer', async () => {
    const { d, running, complete, questionIds } = await startOrg();
    const receipt = await d.askHuman('alpha', 'boss', 'which region?', true);
    expect(receipt).toMatch(/do not call org_complete/i);

    const refusal = complete('achieved');
    expect(refusal).toMatch(/blocking ask_human/);
    expect(refusal).toContain(questionIds()[0]);
    expect(running.busEvents().some((e) => e.reason === 'org-complete')).toBe(false);
    expect(running.busEvents().some((e) => e.reason === 'org-complete-refused')).toBe(true);

    expect(await d.answerQuestion('alpha', 'boss', questionIds()[0], 'eu-west')).toEqual({ ok: true });
    expect(complete('achieved')).toBeNull();
    expect(running.busEvents().some((e) => e.reason === 'org-complete')).toBe(true);
  });

  it("a worker's open blocking question also holds the boss's org_complete", async () => {
    const { d, complete } = await startOrg();
    await d.askHuman('alpha', 'coder', 'which db?', true);
    expect(complete('achieved')).toMatch(/blocking ask_human/);
    expect(complete('partial', 'human')).toBeNull();
  });

  it('a non-blocking question does not hold org_complete', async () => {
    const { d, complete } = await startOrg();
    await d.askHuman('alpha', 'boss', 'fyi: prefer blue?', false);
    expect(complete('achieved')).toBeNull();
  });
});
