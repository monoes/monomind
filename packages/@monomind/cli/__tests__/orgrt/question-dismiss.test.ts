// packages/@monomind/cli/__tests__/orgrt/question-dismiss.test.ts
/**
 * #572: an open ask_human question could not be dismissed, so a blocking one
 * held org_complete (#564) until a human invented an answer. And a question
 * whose role was removed from the org definition could never be closed: the
 * answer failed with "role not found". Dismissal closes a question without an
 * answer; answering or dismissing a removed role's question records it and
 * skips delivery with an audit note.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { pendingBlockingQuestions, readQuestions, writeQuestions } from '../../src/orgrt/questions.js';
import { buildRoleSessionOpts } from '../../src/orgrt/role-session-opts.js';

const DEF = {
  name: 'alpha',
  goal: 'g',
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
    { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
  ],
};

const daemons: OrgDaemon[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const d of daemons.splice(0)) await d.stopAll();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'q-dismiss-572-'));
  roots.push(root);
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify(DEF));
  return root;
}

function makeDaemon(root: string) {
  const idle = () => (async function* () { await new Promise(() => {}); })();
  const d = new OrgDaemon(root, { queryFn: idle as any, forward: false, stopWaitMs: 200 });
  daemons.push(d);
  return d;
}

async function startOrg() {
  const root = makeRoot();
  const d = makeDaemon(root);
  const running = await d.startOrg('alpha');
  const boss = running.def.roles.find((r) => r.id === 'boss')!;
  const rt = running.agents.get('boss')!;
  const opts = buildRoleSessionOpts(
    d, 'alpha', running, boss, root, rt, new AbortController(), undefined, rt.policy, rt.mailbox, undefined,
  );
  const complete = () => opts.onComplete!('boss', 'achieved', 'done', undefined, undefined);
  const audits = () =>
    running.busEvents().filter((e) => e.type === 'audit' && e.reason === 'decision-resolved');
  return { root, d, running, complete, audits };
}

/** Plant an open question from a role that is not in the org definition. */
function plantGhostQuestion(root: string, id = 'q-ghost') {
  const data = readQuestions(root, 'alpha');
  data.questions.push({
    questionId: id,
    role: 'ghost',
    question: 'still need me?',
    ts: 1,
    answer: null,
    answeredAt: null,
    blocking: true,
  });
  writeQuestions(root, 'alpha', data);
}

describe('dismissQuestion — running org', () => {
  it('releases the org_complete gate and records the dismissal', async () => {
    const { root, d, running, complete, audits } = await startOrg();
    await d.askHuman('alpha', 'boss', 'which region?', true);
    const id = readQuestions(root, 'alpha').questions[0].questionId;
    expect(complete()).toMatch(/blocking ask_human/);

    const pushed = vi.spyOn(running.agents.get('boss')!.mailbox, 'push');
    const r = await d.dismissQuestion('alpha', id, 'not needed any more');
    expect(r).toEqual({ ok: true, role: 'boss', delivery: 'live' });

    const q = readQuestions(root, 'alpha').questions[0];
    expect(q).toMatchObject({ state: 'dismissed', dismissReason: 'not needed any more', answer: null });
    expect(typeof q.dismissedAt).toBe('number');
    expect(pendingBlockingQuestions(root, 'alpha')).toEqual([]);
    expect(complete()).toBeNull();

    expect(pushed).toHaveBeenCalledTimes(1);
    expect(String(pushed.mock.calls[0][0])).toMatch(/dismissed/i);
    expect(String(pushed.mock.calls[0][0])).toContain('not needed any more');
    expect(audits().at(-1)?.data).toMatchObject({
      kind: 'question',
      ref: id,
      verdict: 'dismissed',
      reason: 'not needed any more',
    });
  });

  it("dismisses a removed role's question: recorded, no delivery, audit note", async () => {
    const { root, d, audits } = await startOrg();
    plantGhostQuestion(root);
    const r = await d.dismissQuestion('alpha', 'q-ghost');
    expect(r).toEqual({ ok: true, role: 'ghost', delivery: 'skipped' });
    expect(readQuestions(root, 'alpha').questions[0].state).toBe('dismissed');
    expect(audits().at(-1)?.data).toMatchObject({ verdict: 'dismissed', delivery: 'skipped' });
    expect(String((audits().at(-1)?.data as { note?: string }).note)).toMatch(/ghost/);
  });

  it("answers a removed role's question: recorded instead of 'role not found'", async () => {
    const { root, d, audits } = await startOrg();
    plantGhostQuestion(root);
    await d.askHuman('alpha', 'boss', 'x?', true);
    const bossQ = readQuestions(root, 'alpha').questions[1].questionId;
    // Naming some other unknown role for a live role's question still fails.
    expect(await d.answerQuestion('alpha', 'nobody', bossQ, 'y')).toEqual({
      ok: false,
      error: 'role "nobody" not found in org "alpha"',
    });
    const r = await d.answerQuestion('alpha', 'ghost', 'q-ghost', 'yes');
    expect(r).toEqual({ ok: true, delivery: 'skipped' });
    expect(readQuestions(root, 'alpha').questions[0]).toMatchObject({ answer: 'yes' });
    expect(audits().at(-1)?.data).toMatchObject({ verdict: 'answered', delivery: 'skipped' });
  });

  it('a role the saved definition still has is not "removed" when the running one lacks it', async () => {
    const { root, d } = await startOrg();
    // The saved definition gains `writer` (no reload): it runs on the next
    // start, so its answer must not be recorded as delivered-to-nobody.
    writeFileSync(
      join(root, '.monomind/orgs/alpha.json'),
      JSON.stringify({ ...DEF, roles: [...DEF.roles, { id: 'writer', title: 'W', type: 'specialist', reports_to: 'boss' }] }),
    );
    const data = readQuestions(root, 'alpha');
    data.questions.push({ questionId: 'q-w', role: 'writer', question: 'tone?', ts: 1, answer: null, answeredAt: null, blocking: true });
    writeQuestions(root, 'alpha', data);
    expect(await d.answerQuestion('alpha', 'writer', 'q-w', 'dry')).toEqual({
      ok: false,
      error: 'role "writer" not found in org "alpha"',
    });
    expect(readQuestions(root, 'alpha').questions[0].answer).toBeNull();
  });

  it('refuses an unknown id and an already answered question', async () => {
    const { root, d } = await startOrg();
    await d.askHuman('alpha', 'boss', 'x?', true);
    const id = readQuestions(root, 'alpha').questions[0].questionId;
    expect(await d.dismissQuestion('alpha', 'q-nope')).toEqual({
      ok: false,
      error: 'question "q-nope" not found for org "alpha"',
    });
    await d.answerQuestion('alpha', 'boss', id, 'y');
    expect(await d.dismissQuestion('alpha', id)).toEqual({
      ok: false,
      error: `question "${id}" was already answered`,
    });
  });

  it('refuses to answer a dismissed question', async () => {
    const { root, d } = await startOrg();
    await d.askHuman('alpha', 'boss', 'x?', true);
    const id = readQuestions(root, 'alpha').questions[0].questionId;
    await d.dismissQuestion('alpha', id);
    expect(await d.answerQuestion('alpha', 'boss', id, 'late')).toEqual({
      ok: false,
      error: `question "${id}" was already dismissed`,
    });
    expect(await d.dismissQuestion('alpha', id)).toMatchObject({ ok: false });
  });
});

describe('POST /api/dismiss-question (daemon server)', () => {
  it('needs the operator credential, validates input and dismisses', async () => {
    const { startOrgServer } = await import('../../src/orgrt/server.js');
    const { root, d } = await startOrg();
    const srv = await startOrgServer(d, 0);
    try {
      await d.askHuman('alpha', 'boss', 'x?', true);
      const id = readQuestions(root, 'alpha').questions[0].questionId;
      const post = (cred: string | undefined, body: unknown) =>
        fetch(`http://127.0.0.1:${srv.port}/api/dismiss-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cred ? { 'x-monomind-cred': cred } : {}) },
          body: JSON.stringify(body),
        });
      expect((await post(undefined, { org: 'alpha', questionId: id })).status).toBe(401);
      expect((await post(srv.operatorCredential, { org: 'alpha' })).status).toBe(400);
      expect((await post(srv.operatorCredential, { org: 'alpha', questionId: id, reason: 7 })).status).toBe(400);
      const ok = await post(srv.operatorCredential, { org: 'alpha', questionId: id, reason: 'moot', resolvedBy: 'ops' });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, role: 'boss', delivery: 'live' });
      expect(readQuestions(root, 'alpha').questions[0]).toMatchObject({ state: 'dismissed', resolvedBy: 'ops' });
      expect((await post(srv.operatorCredential, { org: 'alpha', questionId: id })).status).toBe(404);
    } finally {
      srv.close();
    }
  });
});

describe('dismissQuestion — org not running', () => {
  it('queues a note for a role that still exists and does not wake the org', async () => {
    const root = makeRoot();
    const d = makeDaemon(root);
    writeQuestions(root, 'alpha', {
      questions: [
        { questionId: 'q-1', role: 'coder', question: 'db?', ts: 1, answer: null, answeredAt: null },
      ],
    });
    const wake = vi.spyOn(d, 'autoWake');
    expect(await d.dismissQuestion('alpha', 'q-1', 'moot')).toEqual({
      ok: true,
      role: 'coder',
      delivery: 'queued',
    });
    expect(wake).not.toHaveBeenCalled();
    const inbox = readFileSync(join(root, '.monomind/orgs/alpha/inbox.jsonl'), 'utf8');
    expect(inbox).toContain('dismissed:q-1');
    expect(readQuestions(root, 'alpha').questions[0].state).toBe('dismissed');
  });

  it("records a removed role's answer without queueing it", async () => {
    const root = makeRoot();
    const d = makeDaemon(root);
    plantGhostQuestion(root);
    expect(await d.answerQuestion('alpha', 'ghost', 'q-ghost', 'yes')).toEqual({
      ok: true,
      delivery: 'skipped',
    });
    expect(readQuestions(root, 'alpha').questions[0].answer).toBe('yes');
    expect(() => readFileSync(join(root, '.monomind/orgs/alpha/inbox.jsonl'), 'utf8')).toThrow();
  });
});
