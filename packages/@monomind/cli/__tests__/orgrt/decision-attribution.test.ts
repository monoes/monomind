// packages/@monomind/cli/__tests__/orgrt/decision-attribution.test.ts
/**
 * M5 — decision attribution (capability `org-decision-attribution`):
 * `--by` / `resolvedBy`, the `decision-resolved` audit event, and
 * request-scoped approvals (`requestId`, `--request`).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvalsAction,
  approveAction,
  gateResolveAction,
} from '../../src/commands/org-observe.js';
import { checkApproval } from '../../src/orgrt/approvals.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';
import type { BusEvent } from '../../src/orgrt/types.js';
import type { CommandContext } from '../../src/types.js';

const quiet = ({ prompt }: any) =>
  (async function* () {
    for await (const _m of prompt) {
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

const REQ_ID = /^apr-\d+-[0-9a-f]{8}$/;

function fixture(root: string, name: string) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs', `${name}.json`),
    JSON.stringify({ name, goal: 'g', roles: [{ id: 'boss', type: 'boss', reports_to: null }] }),
  );
}

const resolvedEvents = (events: BusEvent[]) =>
  events.filter((e) => e.type === 'audit' && e.reason === 'decision-resolved');

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => {
    writes.push(String(c));
    return true;
  });
  try {
    const value = await fn();
    return { value, lines: writes.join('').split('\n').filter(Boolean) };
  } finally {
    spy.mockRestore();
  }
}

describe('M5 — decision attribution', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  let prevBroker: string | undefined;
  let prevOperator: string | undefined;
  beforeEach(() => {
    prevBroker = process.env.MONOMIND_ORGRT_BROKER_DIR;
    prevOperator = process.env.MONOMIND_ORGRT_OPERATOR_DIR;
    process.env.MONOMIND_ORGRT_BROKER_DIR = mkdtempSync(join(tmpdir(), 'm5-broker-'));
    process.env.MONOMIND_ORGRT_OPERATOR_DIR = mkdtempSync(join(tmpdir(), 'm5-operator-'));
  });
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
    if (prevBroker === undefined) delete process.env.MONOMIND_ORGRT_BROKER_DIR;
    else process.env.MONOMIND_ORGRT_BROKER_DIR = prevBroker;
    if (prevOperator === undefined) delete process.env.MONOMIND_ORGRT_OPERATOR_DIR;
    else process.env.MONOMIND_ORGRT_OPERATOR_DIR = prevOperator;
  });

  async function host(name = 'growth') {
    const root = mkdtempSync(join(tmpdir(), 'm5-'));
    fixture(root, name);
    const daemon = new OrgDaemon(root, { queryFn: quiet as any, forward: false, crossProcess: true });
    const srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
    const running = await daemon.startOrg(name);
    cleanups.push(async () => {
      await daemon.stopAll();
      srv.close();
      rmSync(root, { recursive: true, force: true });
    });
    const post = (route: string, body: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-monomind-cred': srv.operatorCredential },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, data: (await r.json()) as Record<string, unknown> }));
    return { root, daemon, srv, running, post };
  }

  it('each approval request gets a requestId; the question event carries requestId and the summarised input', async () => {
    const { daemon, running, root } = await host();
    expect(await checkApproval(daemon, 'growth', 'boss', 'Bash', { command: 'npm test' })).toBeNull();
    expect(
      await checkApproval(daemon, 'growth', 'boss', 'Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"' }),
    ).toBeNull();
    const entries = daemon.approvals.get('growth')!;
    expect(entries).toHaveLength(2);
    expect(entries[0].requestId).toMatch(REQ_ID);
    expect(entries[1].requestId).toMatch(REQ_ID);
    expect(entries[0].requestId).not.toBe(entries[1].requestId);
    const questions = running.busEvents().filter((e) => e.type === 'question');
    expect(questions[0].data).toMatchObject({ action: 'Bash', requestId: entries[0].requestId, input: { command: 'npm test' } });
    expect(String((questions[1].data?.input as { command: string }).command)).toContain('[REDACTED]');
    // persisted too
    const onDisk = JSON.parse(readFileSync(join(root, '.monomind/orgs/growth/approvals.json'), 'utf8'));
    expect(onDisk.approvals[1].requestId).toBe(entries[1].requestId);
  });

  it('/api/set-approval with requestId resolves only that request and records the resolver', async () => {
    const { daemon, running, post, root } = await host();
    await checkApproval(daemon, 'growth', 'boss', 'Bash', { command: 'a' });
    await checkApproval(daemon, 'growth', 'boss', 'Bash', { command: 'b' });
    const [first, second] = daemon.approvals.get('growth')!;

    const r = await post('/api/set-approval', {
      org: 'growth', role: 'boss', action: 'Bash', approved: true, requestId: first.requestId, resolvedBy: 'model:claude',
    });
    expect(r.status).toBe(200);
    expect(first).toMatchObject({ approved: true, resolvedBy: 'model:claude' });
    expect(typeof first.resolvedAt).toBe('number');
    expect(second.approved).toBeNull();
    expect(resolvedEvents(running.busEvents())).toEqual([
      expect.objectContaining({
        from: 'boss',
        data: { kind: 'approval', ref: first.requestId, resolver: 'model:claude', verdict: 'approved' },
      }),
    ]);

    // unknown request id → 404, nothing changes
    const miss = await post('/api/set-approval', { org: 'growth', role: 'boss', action: 'Bash', approved: true, requestId: 'apr-1-00000000' });
    expect(miss.status).toBe(404);
    expect(second.approved).toBeNull();

    // no requestId → every pending entry for the pair, default resolver human
    const all = await post('/api/set-approval', { org: 'growth', role: 'boss', action: 'Bash', approved: false });
    expect(all.status).toBe(200);
    expect(second).toMatchObject({ approved: false, resolvedBy: 'human' });
    expect(resolvedEvents(running.busEvents()).at(-1)?.data).toEqual({
      kind: 'approval', ref: second.requestId, resolver: 'human', verdict: 'denied',
    });

    // invalid resolver → 400
    const bad = await post('/api/set-approval', { org: 'growth', role: 'boss', action: 'Bash', approved: true, resolvedBy: 'x\ny' });
    expect(bad.status).toBe(400);

    // `org approvals --format json` items carry requestId, resolvedBy, input
    const { value, lines } = await captureStdout(() =>
      approvalsAction({ args: ['growth'], flags: { _: [], format: 'json', all: true }, cwd: root, interactive: false } as CommandContext, 'growth'),
    );
    expect(value.success).toBe(true);
    const items = JSON.parse(lines.at(-1)!).items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ requestId: first.requestId, resolvedBy: 'model:claude', input: { command: 'a' } });
    expect(items[1]).toMatchObject({ requestId: second.requestId, resolvedBy: 'human' });
  });

  it('gates and questions record resolvedBy and emit decision-resolved', async () => {
    const { daemon, running, post, root } = await host();
    await daemon.createGate('growth', 'boss', 'ship', 'deploy prod');
    const gateId = daemon.listGates('growth', 'pending')[0].id;
    const g = await post('/api/resolve-gate', { org: 'growth', gateId, approved: false, resolution: 'not yet', resolvedBy: 'parent:hq' });
    expect(g.status).toBe(200);
    const gates = JSON.parse(readFileSync(join(root, '.monomind/orgs/growth/gates.json'), 'utf8')).gates;
    expect(gates[0]).toMatchObject({ status: 'rejected', resolvedBy: 'parent:hq' });

    await daemon.askHuman('growth', 'boss', 'which channel?');
    const qs = JSON.parse(readFileSync(join(root, '.monomind/orgs/growth/questions.json'), 'utf8')).questions;
    const q = await post('/api/answer-question', { org: 'growth', role: 'boss', questionId: qs[0].questionId, answer: 'email', resolvedBy: 'boss' });
    expect(q.status).toBe(200);
    const qsAfter = JSON.parse(readFileSync(join(root, '.monomind/orgs/growth/questions.json'), 'utf8')).questions;
    expect(qsAfter[0]).toMatchObject({ answer: 'email', resolvedBy: 'boss' });

    // default resolver for a plain answer
    await daemon.askHuman('growth', 'boss', 'second?');
    const qs2 = JSON.parse(readFileSync(join(root, '.monomind/orgs/growth/questions.json'), 'utf8')).questions;
    await post('/api/answer-question', { org: 'growth', role: 'boss', questionId: qs2[1].questionId, answer: 'yes' });

    expect(resolvedEvents(running.busEvents()).map((e) => ({ from: e.from, ...e.data }))).toEqual([
      { from: 'boss', kind: 'gate', ref: gateId, resolver: 'parent:hq', verdict: 'denied' },
      { from: 'boss', kind: 'question', ref: qs[0].questionId, resolver: 'boss', verdict: 'answered' },
      { from: 'boss', kind: 'question', ref: qs2[1].questionId, resolver: 'human', verdict: 'answered' },
    ]);
  });

  it('CLI: `org approve --request --by` resolves one request live; offline gate resolution honours --by', async () => {
    const { daemon, root } = await host();
    await checkApproval(daemon, 'growth', 'boss', 'WebFetch', { url: 'https://a.example' });
    await checkApproval(daemon, 'growth', 'boss', 'WebFetch', { url: 'https://b.example' });
    const [a, b] = daemon.approvals.get('growth')!;
    const { value, lines } = await captureStdout(() =>
      approveAction(
        { args: ['growth', 'boss', 'WebFetch'], flags: { _: [], format: 'json', request: b.requestId, by: 'model:haiku' }, cwd: root, interactive: false } as CommandContext,
        'growth',
      ),
    );
    expect(value.success).toBe(true);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ delivery: 'live', resolvedBy: 'model:haiku', requestId: b.requestId });
    expect(b).toMatchObject({ approved: true, resolvedBy: 'model:haiku' });
    expect(a.approved).toBeNull();

    // offline gate path (no daemon hosts "offline") writes the named resolver
    const offRoot = mkdtempSync(join(tmpdir(), 'm5-off-'));
    cleanups.push(() => rmSync(offRoot, { recursive: true, force: true }));
    mkdirSync(join(offRoot, '.monomind/orgs/offline'), { recursive: true });
    writeFileSync(
      join(offRoot, '.monomind/orgs/offline/gates.json'),
      JSON.stringify({ gates: [{ id: 'gate-1-ab', name: 'n', description: 'd', roleId: 'boss', status: 'pending', createdAt: 1 }] }),
    );
    const gate = await captureStdout(() =>
      gateResolveAction(
        { args: ['offline', 'gate-1-ab', 'ok'], flags: { _: [], format: 'json', by: 'boss' }, cwd: offRoot, interactive: false } as CommandContext,
        'offline',
        true,
      ),
    );
    expect(gate.value.success).toBe(true);
    expect(JSON.parse(gate.lines.at(-1)!)).toMatchObject({ delivery: 'recorded', resolvedBy: 'boss' });
    const stored = JSON.parse(readFileSync(join(offRoot, '.monomind/orgs/offline/gates.json'), 'utf8')).gates[0];
    expect(stored).toMatchObject({ status: 'approved', resolvedBy: 'boss' });

    // an invalid --by is refused before anything is written
    writeFileSync(
      join(offRoot, '.monomind/orgs/offline/gates.json'),
      JSON.stringify({ gates: [{ id: 'gate-2-cd', name: 'n', description: 'd', roleId: 'boss', status: 'pending', createdAt: 1 }] }),
    );
    const bad = await gateResolveAction(
      { args: ['offline', 'gate-2-cd'], flags: { _: [], by: '   ' }, cwd: offRoot, interactive: false } as CommandContext,
      'offline',
      false,
    );
    expect(bad.success).toBe(false);
    expect(bad.message).toMatch(/--by/);
    expect(JSON.parse(readFileSync(join(offRoot, '.monomind/orgs/offline/gates.json'), 'utf8')).gates[0].status).toBe('pending');
  });
});
