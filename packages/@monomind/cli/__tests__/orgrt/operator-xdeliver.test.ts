// packages/@monomind/cli/__tests__/orgrt/operator-xdeliver.test.ts
/**
 * M3 — operator-authenticated sender + messageId on every bus copy.
 *
 * C-21 regression: `org inbox` to a RUNNING org used to POST /api/xdeliver
 * with the target's agent credential and no fromCredential, so receiveRemote
 * rejected the sender and the CLI silently queued the message until the next
 * org start. It must now deliver live.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxAction } from '../../src/commands/org-observe.js';
import { lookupOrg, readOperatorCredential } from '../../src/orgrt/broker.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { queueMessage } from '../../src/orgrt/inbox.js';
import { startOrgServer } from '../../src/orgrt/server.js';
import type { CommandContext } from '../../src/types.js';

const echoQuery = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

const MSG_ID = /^msg-\d+-[0-9a-f]{8}$/;

function fixture(root: string, name: string, roles = [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }]) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({ name, goal: 'g', roles }));
}

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Run inboxAction in JSON mode and parse the one stdout line it prints. */
async function inboxJson(ctx: CommandContext, name: string) {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    const result = await inboxAction(ctx, name);
    const line = writes.join('').trim().split('\n').filter(Boolean).at(-1) ?? '{}';
    return { result, out: JSON.parse(line) as Record<string, unknown>, raw: writes.join('') };
  } finally {
    spy.mockRestore();
  }
}

describe('M3 — operator-authenticated /api/xdeliver and live org inbox', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  let brokerDir: string;
  let operatorDir: string;
  let prevBroker: string | undefined;
  let prevOperator: string | undefined;

  beforeEach(() => {
    brokerDir = mkdtempSync(join(tmpdir(), 'm3-broker-'));
    operatorDir = mkdtempSync(join(tmpdir(), 'm3-operator-'));
    prevBroker = process.env.MONOMIND_ORGRT_BROKER_DIR;
    prevOperator = process.env.MONOMIND_ORGRT_OPERATOR_DIR;
    process.env.MONOMIND_ORGRT_BROKER_DIR = brokerDir;
    process.env.MONOMIND_ORGRT_OPERATOR_DIR = operatorDir;
  });
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
    if (prevBroker === undefined) delete process.env.MONOMIND_ORGRT_BROKER_DIR;
    else process.env.MONOMIND_ORGRT_BROKER_DIR = prevBroker;
    if (prevOperator === undefined) delete process.env.MONOMIND_ORGRT_OPERATOR_DIR;
    else process.env.MONOMIND_ORGRT_OPERATOR_DIR = prevOperator;
  });

  async function hostOrg(name: string, roles?: Parameters<typeof fixture>[2]) {
    const root = mkdtempSync(join(tmpdir(), `m3-${name}-`));
    fixture(root, name, roles);
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false, crossProcess: true });
    const srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
    const running = await daemon.startOrg(name);
    cleanups.push(async () => {
      await daemon.stopAll();
      srv.close();
      rmSync(root, { recursive: true, force: true });
    });
    return { root, daemon, srv, running };
  }

  it('C-21: `org inbox --format json` to a RUNNING org delivers live (not queued)', async () => {
    const { root, running } = await hostOrg('growth');
    expect(lookupOrg('growth')).not.toBeNull();
    expect(readOperatorCredential('growth')).toBeTruthy();

    const { result, out } = await inboxJson(
      {
        args: ['growth'],
        flags: { _: [], format: 'json', from: 'workflow:exec-1', to: 'boss', subject: 're: go', body: 'result text' },
        cwd: root,
        interactive: false,
      },
      'growth',
    );
    expect(result.success).toBe(true);
    expect(out).toMatchObject({
      v: 1,
      org: 'growth',
      to: 'growth:boss',
      from: 'workflow:exec-1',
      delivery: 'live',
    });
    expect(out.receipt).toMatch(/delivered to growth:boss/);
    expect(out.messageId).toMatch(MSG_ID);
    expect(existsSync(join(root, '.monomind/orgs/growth/inbox.jsonl'))).toBe(false);

    // the receiver's bus copy carries the same messageId, and the role got it
    const evt = running.busEvents().find((e) => e.type === 'xorg' && e.from === 'workflow:exec-1');
    expect(evt?.data?.messageId).toBe(out.messageId);
    await waitFor(() =>
      running.busEvents().some((e) => e.type === 'chat' && (e.msg ?? '').includes('[message from workflow:exec-1]')),
    );
  }, 20_000);

  it('/api/xdeliver: operator credential trusts an unregistered sender; an agent credential does not', async () => {
    const { srv, running } = await hostOrg('growth');
    const post = (cred: string, body: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-monomind-cred': cred },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, data: (await r.json()) as Record<string, unknown> }));
    const msg = { fromOrg: 'growth', fromRole: 'publisher-bot', toOrg: 'growth', toRole: 'boss', subject: 's', body: 'b' };

    const asAgent = await post(running.credential!, msg);
    expect(asAgent.status).toBe(404);
    expect(String(asAgent.data.error)).toMatch(/failed identity verification/);

    const asOperator = await post(srv.operatorCredential, { ...msg, messageId: 'msg-1-deadbeef' });
    expect(asOperator.status).toBe(200);
    expect(asOperator.data.ok).toBe(true);
    const evt = running.busEvents().find((e) => e.type === 'xorg' && e.from === 'growth:publisher-bot');
    expect(evt?.data?.messageId).toBe('msg-1-deadbeef');
  }, 20_000);

  it('queues with a messageId when the org is not running, and re-uses it on drain', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm3-offline-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    fixture(root, 'sales');
    const { result, out } = await inboxJson(
      { args: ['sales'], flags: { _: [], format: 'json', from: 'hq:ceo', subject: 's', body: 'queued body' }, cwd: root, interactive: false },
      'sales',
    );
    expect(result.success).toBe(true);
    expect(out).toMatchObject({ delivery: 'queued', to: 'sales:boss', from: 'hq:ceo' });
    expect(out.messageId).toMatch(MSG_ID);
    const line = JSON.parse(readFileSync(join(root, '.monomind/orgs/sales/inbox.jsonl'), 'utf8').trim());
    expect(line.messageId).toBe(out.messageId);

    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await daemon.startOrg('sales');
    cleanups.push(() => daemon.stopAll());
    const drained = running.busEvents().find((e) => e.type === 'xorg' && e.from === 'hq:ceo');
    expect(drained?.data?.messageId).toBe(out.messageId);
  }, 20_000);

  it('unknown org and invalid input exit non-zero with a JSON error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm3-unknown-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const unknown = await inboxJson(
      { args: ['ghost'], flags: { _: [], format: 'json', from: 'a:b', to: 'boss', body: 'x' }, cwd: root, interactive: false },
      'ghost',
    );
    expect(unknown.result.success).toBe(false);
    expect(String(unknown.out.error)).toMatch(/Org not found/);
    fixture(root, 'known');
    const missingBody = await inboxJson(
      { args: ['known'], flags: { _: [], format: 'json', from: 'a:b' }, cwd: root, interactive: false },
      'known',
    );
    expect(missingBody.result.success).toBe(false);
    expect(missingBody.out.error).toBeTruthy();
  });
});

describe('M3 — one messageId on every bus copy', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  it('in-process cross-org delivery stamps the same messageId on sender and receiver copies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm3-inproc-'));
    fixture(root, 'alpha');
    fixture(root, 'beta', [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss' } as any,
    ]);
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const alpha = await daemon.startOrg('alpha');
    const beta = await daemon.startOrg('beta');
    cleanups.push(async () => {
      await daemon.stopAll();
      rmSync(root, { recursive: true, force: true });
    });
    expect(await daemon.deliver('alpha', 'boss', 'beta:boss', 'hi', 'body')).toMatch(/delivered/);
    const a = alpha.busEvents().find((e) => e.type === 'xorg' && e.to === 'beta:boss');
    const b = beta.busEvents().find((e) => e.type === 'xorg' && e.from === 'alpha:boss');
    expect(a?.data?.messageId).toMatch(MSG_ID);
    expect(b?.data?.messageId).toBe(a?.data?.messageId);
    expect(a?.id).not.toBe(b?.id);

    // intra-org message events carry one too
    await daemon.deliver('beta', 'boss', 'dev', 'task', 'do it');
    const m = beta.busEvents().find((e) => e.type === 'message' && e.to === 'dev');
    expect(m?.data?.messageId).toMatch(MSG_ID);
  }, 20_000);

  it('cross-process delivery sends messageId so both buses share it; queued entries keep theirs', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'm3-xproc-broker-'));
    const operatorDir = mkdtempSync(join(tmpdir(), 'm3-xproc-op-'));
    const make = async (name: string) => {
      const root = mkdtempSync(join(tmpdir(), `m3-xproc-${name}-`));
      fixture(root, name);
      const daemon = new OrgDaemon(root, {
        queryFn: echoQuery as any,
        forward: false,
        crossProcess: true,
        brokerDir,
        operatorDir,
      });
      const srv = await startOrgServer(daemon, 0);
      daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
      const running = await daemon.startOrg(name);
      cleanups.push(async () => {
        await daemon.stopAll();
        srv.close();
        rmSync(root, { recursive: true, force: true });
      });
      return { daemon, running, root };
    };
    const A = await make('alpha');
    const B = await make('beta');
    expect(await A.daemon.deliver('alpha', 'boss', 'beta:boss', 'x', 'over http')).toMatch(/remote/);
    const sent = A.running.busEvents().find((e) => e.type === 'xorg' && e.to === 'beta:boss');
    await waitFor(() => B.running.busEvents().some((e) => e.type === 'xorg' && e.from === 'alpha:boss'));
    const got = B.running.busEvents().find((e) => e.type === 'xorg' && e.from === 'alpha:boss');
    expect(sent?.data?.messageId).toMatch(MSG_ID);
    expect(got?.data?.messageId).toBe(sent?.data?.messageId);

    // a queued entry written with a messageId keeps it through the drain
    expect(queueMessage(A.root, 'gamma', { fromQualified: 'alpha:boss', toRole: 'boss', subject: 's', body: 'b', ts: 1, messageId: 'msg-9-cafebabe' })).toBe(true);
    const line = JSON.parse(readFileSync(join(A.root, '.monomind/orgs/gamma/inbox.jsonl'), 'utf8').trim());
    expect(line.messageId).toBe('msg-9-cafebabe');
  }, 30_000);
});
