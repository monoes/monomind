// packages/@monomind/cli/__tests__/orgrt/endpoint-roles.test.ts
/**
 * M2 — endpoint roles (capability `org-endpoint-roles`), tested against a
 * local HTTP server standing in for the automation endpoint.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { costsAction, flowAction, reportAction, validateAction } from '../../src/commands/org-observe.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { endpointBriefingLines } from '../../src/orgrt/endpoint-roles.js';
import { peekInbox, queueMessage } from '../../src/orgrt/inbox.js';
import { checkOrgStructure } from '../../src/orgrt/migrate.js';
import { buildRolePrompt } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import type { CommandContext } from '../../src/types.js';

interface Received {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

async function endpointServer() {
  const received: Received[] = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/org-endpoint/ep_test`;
  return {
    url,
    received,
    setStatus: (s: number) => {
      status = s;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const prompts: string[] = [];
const echoQuery = ({ prompt, options }: any) =>
  (async function* () {
    prompts.push(String(options?.systemPrompt ?? ''));
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

function orgDef(url: string, endpoint: Record<string, unknown> = {}, runConfig: Record<string, unknown> = {}) {
  return {
    name: 'growth',
    goal: 'grow',
    run_config: runConfig,
    roles: [
      { id: 'lead', title: 'Lead', type: 'boss', reports_to: null },
      {
        id: 'publisher-bot',
        title: 'Publisher',
        kind: 'endpoint',
        type: 'automation',
        reports_to: 'lead',
        endpoint: { url, input_hint: 'Send the post text as the body.', ...endpoint },
        automation: { workflow_id: 'wf-1', reply: 'last_node', alias: 'publish' },
      },
    ],
  };
}

describe('M2 — schema and org validate', () => {
  it('parses endpoint roles (passthrough) and rejects agent-only keys, root endpoints and relative credential files', () => {
    const def = OrgDefSchema.parse(orgDef('http://127.0.0.1:9322/org-endpoint/ep_x'));
    expect(def.roles[1]).toMatchObject({ kind: 'endpoint', type: 'automation', automation: { alias: 'publish' } });
    expect(checkOrgStructure(def)).toEqual([]);
    expect(() => OrgDefSchema.parse(orgDef('not a url'))).toThrow();

    const bad = OrgDefSchema.parse({
      name: 'x',
      roles: [
        { id: 'lead', reports_to: null },
        {
          id: 'bot',
          kind: 'endpoint',
          reports_to: 'lead',
          endpoint: { url: 'http://127.0.0.1:1/x', credential_file: 'relative/cred' },
          policy: {},
          runtime: 'claude',
          adapter_config: { model: 'm' },
          budget_tokens: 10,
          budget_usd: 1,
          tool_providers: [{ kind: 'mcp-stdio', name: 'p', command: 'x' }],
        },
        { id: 'root-bot', kind: 'endpoint', reports_to: null, endpoint: { url: 'http://127.0.0.1:1/y' } },
        { id: 'no-url', kind: 'endpoint', reports_to: 'lead' },
      ],
    });
    const errors = checkOrgStructure(bad);
    for (const k of ['policy', 'runtime', 'adapter_config', 'budget_tokens', 'budget_usd', 'tool_providers'])
      expect(errors).toContain(`endpoint role "bot" may not have "${k}"`);
    expect(errors).toContain('endpoint role "root-bot" may not be the root role');
    expect(errors).toContain('endpoint role "no-url" needs endpoint.url');
    expect(errors.some((e) => e.includes('credential_file must be an absolute path'))).toBe(true);
  });

  it('`org validate` fails an invalid endpoint role', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm2-validate-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    const def = orgDef('http://127.0.0.1:1/x');
    (def.roles[1] as Record<string, unknown>).policy = { denyTools: [] };
    writeFileSync(join(root, '.monomind/orgs/growth.json'), JSON.stringify(def));
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await validateAction({ args: ['growth'], flags: { _: [] }, cwd: root, interactive: false } as CommandContext);
      expect(res.success).toBe(false);
    } finally {
      spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('boss briefing: one line per endpoint role', () => {
    const def = OrgDefSchema.parse(orgDef('http://127.0.0.1:1/x'));
    const lines = endpointBriefingLines(def);
    expect(lines).toEqual([
      '- publisher-bot (Publisher) is an automation, not an agent. Message it with org_send; it replies with its result. Send the post text as the body.',
    ]);
    const prompt = buildRolePrompt(def.roles[0], def, ['lead', 'publisher-bot'], [], undefined, lines);
    expect(prompt).toContain(lines[0]);
  });
});

describe('M2 — endpoint delivery in a running org', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function setup(opts: {
    endpoint?: Record<string, unknown>;
    runConfig?: Record<string, unknown>;
    beforeStart?: (root: string) => void;
    daemonOpts?: Record<string, unknown>;
  } = {}) {
    const ep = await endpointServer();
    const root = mkdtempSync(join(tmpdir(), 'm2-org-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/growth.json'), JSON.stringify(orgDef(ep.url, opts.endpoint, opts.runConfig)));
    opts.beforeStart?.(root);
    const daemon = new OrgDaemon(root, {
      queryFn: echoQuery as any,
      forward: false,
      endpointRetryMs: [40, 40, 40],
      endpointPeriodicRetryMs: 150,
      ...opts.daemonOpts,
    });
    prompts.length = 0;
    const running = await daemon.startOrg('growth');
    cleanups.push(async () => {
      await daemon.stopAll();
      await ep.close();
      rmSync(root, { recursive: true, force: true });
    });
    return { ep, root, daemon, running };
  }

  it('POSTs the contract payload, emits the delivery event and never gives the role a session', async () => {
    const { ep, daemon, running } = await setup();
    // no session, mailbox, slot, or pending lazy spawn for the endpoint role
    expect([...running.agents.keys()]).toEqual(['lead']);
    expect(running.roleSlots.has('publisher-bot')).toBe(false);
    expect(running.pendingRoles?.has('publisher-bot')).toBe(false);
    expect(running.bossRoleId).toBe('lead');
    await waitFor(() => prompts.length > 0);
    expect(prompts[0]).toContain('- publisher-bot (Publisher) is an automation, not an agent.');

    const receipt = await daemon.deliver('growth', 'lead', 'publisher-bot', 'publish', 'hello world');
    expect(receipt).toBe('delivered to growth:publisher-bot (endpoint)');
    expect(ep.received).toHaveLength(1);
    const { headers, body } = ep.received[0];
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
    expect(body).toEqual({
      orgName: 'growth',
      run: running.run,
      from: 'lead',
      to: 'growth:publisher-bot',
      subject: 'publish',
      body: 'hello world',
      messageId: expect.stringMatching(/^msg-\d+-[0-9a-f]{8}$/),
    });
    const evt = running.busEvents().find((e) => e.type === 'message' && e.to === 'publisher-bot');
    expect(evt?.data).toEqual({ messageId: body.messageId, endpoint: true });

    // cross-org sender via receiveRemote (operator) is POSTed with its qualified name
    const remote = await daemon.receiveRemote('growth', 'publisher-bot', 'hq:ceo', 's2', 'b2', undefined, { operator: true });
    expect(remote).toEqual({ ok: true, receipt: 'delivered to growth:publisher-bot (endpoint)' });
    expect(ep.received[1].body).toMatchObject({ from: 'hq:ceo', to: 'growth:publisher-bot', subject: 's2' });
  });

  it('holds the idle watchdog until the reply arrives from <org>:<endpointRole>', async () => {
    const { daemon, running } = await setup({ runConfig: { idle_minutes: 0.004 } }); // 240 ms
    await daemon.deliver('growth', 'lead', 'publisher-bot', 'publish', 'x');
    expect(running.endpointWaits).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 900));
    expect(running.busEvents().some((e) => e.reason === 'idle-nudge')).toBe(false);
    // the automation replies (M3 operator path) → the wait clears
    const reply = await daemon.receiveRemote('growth', 'lead', 'growth:publisher-bot', 're: publish', 'posted', undefined, { operator: true });
    expect(reply.ok).toBe(true);
    expect(running.endpointWaits).toHaveLength(0);
    await waitFor(() => running.busEvents().some((e) => e.reason === 'idle-nudge'), 3000);
  });

  it('a wait expires after endpoint.timeout_ms', async () => {
    const { daemon, running } = await setup({ endpoint: { timeout_ms: 100 }, runConfig: { idle_minutes: 0.004 } });
    await daemon.deliver('growth', 'lead', 'publisher-bot', 'publish', 'x');
    await waitFor(() => running.busEvents().some((e) => e.reason === 'idle-nudge'), 3000);
  });

  it('queues on failure, retries 3×, audits endpoint-unreachable, then the periodic sweep delivers', async () => {
    const { ep, root, daemon, running } = await setup({ daemonOpts: { endpointPeriodicRetryMs: 60_000 } });
    ep.setStatus(500);
    const receipt = await daemon.deliver('growth', 'lead', 'publisher-bot', 'publish', 'retry me');
    expect(receipt).toMatch(/^queued for growth:publisher-bot \(endpoint unreachable: HTTP 500 — retrying\)$/);
    const queued = peekInbox(root, 'growth');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ toRole: 'publisher-bot', endpoint: true, fromQualified: 'lead' });
    const messageId = queued[0].messageId;

    await waitFor(() => running.busEvents().some((e) => e.reason === 'endpoint-unreachable'));
    expect(ep.received).toHaveLength(4); // first attempt + 3 retries
    const audit = running.busEvents().find((e) => e.reason === 'endpoint-unreachable');
    expect(audit?.data).toEqual({ role: 'publisher-bot', messageId, error: 'HTTP 500' });
    expect(peekInbox(root, 'growth')).toHaveLength(1); // left queued
    expect(running.busEvents().some((e) => e.type === 'message' && e.data?.endpoint)).toBe(false);

    // endpoint recovers; the org's periodic sweep (shortened) delivers it
    ep.setStatus(200);
    const { retryQueuedEndpoints } = await import('../../src/orgrt/endpoint-roles.js');
    const res = await retryQueuedEndpoints(daemon, 'growth');
    expect(res.delivered).toEqual([messageId]);
    expect(peekInbox(root, 'growth')).toHaveLength(0);
    expect(running.busEvents().find((e) => e.type === 'message' && e.data?.endpoint)?.data?.messageId).toBe(messageId);
  });

  it('periodic retry re-attempts endpoint entries and leaves other queued entries in place', async () => {
    const { ep, root, running } = await setup();
    ep.setStatus(503);
    queueMessage(root, 'growth', { fromQualified: 'hq:ceo', toRole: 'publisher-bot', subject: 's', body: 'b', ts: 1, messageId: 'msg-1-aaaaaaaa', endpoint: true });
    queueMessage(root, 'growth', { fromQualified: 'hq:ceo', toRole: 'someone-else', subject: 's', body: 'b', ts: 2, messageId: 'msg-2-bbbbbbbb' });
    await waitFor(() => ep.received.length >= 2);
    ep.setStatus(200);
    await waitFor(() =>
      running.busEvents().some((e) => e.type === 'xorg' && e.data?.messageId === 'msg-1-aaaaaaaa' && e.data?.endpoint),
    );
    await waitFor(() => peekInbox(root, 'growth').length === 1);
    expect(peekInbox(root, 'growth').map((m) => m.messageId)).toEqual(['msg-2-bbbbbbbb']);
  });

  it("startOrg's drain delivers queued endpoint entries by POST", async () => {
    const { ep, root, running } = await setup({
      beforeStart: (r) => {
        queueMessage(r, 'growth', { fromQualified: 'hq:ceo', toRole: 'publisher-bot', subject: 'early', body: 'queued before start', ts: 1, messageId: 'msg-3-cccccccc' });
      },
    });
    await waitFor(() => ep.received.length === 1);
    expect(ep.received[0].body).toMatchObject({ subject: 'early', messageId: 'msg-3-cccccccc', run: running.run, from: 'hq:ceo' });
    await waitFor(() => peekInbox(root, 'growth').length === 0);
  });

  it('bearer from credential_file (0600); an insecure file is never sent', async () => {
    const credDir = mkdtempSync(join(tmpdir(), 'm2-cred-'));
    cleanups.push(() => rmSync(credDir, { recursive: true, force: true }));
    const good = join(credDir, 'good');
    writeFileSync(good, '  s3cret-token\n');
    chmodSync(good, 0o600);
    const { ep, daemon, running, root } = await setup({ endpoint: { credential_file: good } });
    expect(await daemon.deliver('growth', 'lead', 'publisher-bot', 's', 'b')).toMatch(/\(endpoint\)$/);
    expect(ep.received[0].headers.authorization).toBe('Bearer s3cret-token');

    chmodSync(good, 0o644);
    const receipt = await daemon.deliver('growth', 'lead', 'publisher-bot', 's', 'insecure');
    expect(receipt).toMatch(/^queued for growth:publisher-bot \(endpoint credential insecure/);
    expect(ep.received).toHaveLength(1); // not POSTed
    const audit = running.busEvents().find((e) => e.reason === 'endpoint-credential-insecure');
    expect(audit?.data).toMatchObject({ role: 'publisher-bot' });
    expect(peekInbox(root, 'growth')).toHaveLength(1);
  });

  it('costs/report/flow role tables exclude endpoint roles', async () => {
    const { daemon, root } = await setup();
    await daemon.deliver('growth', 'lead', 'publisher-bot', 'publish', 'x');
    await daemon.stopOrg('growth');
    const ctx = (flags: Record<string, unknown> = {}) =>
      ({ args: ['growth'], flags: { _: [], format: 'json', ...flags }, cwd: root, interactive: false }) as CommandContext;
    const capture = async (fn: () => Promise<unknown>) => {
      const writes: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => (writes.push(String(c)), true));
      try {
        await fn();
      } finally {
        spy.mockRestore();
      }
      return JSON.parse(writes.join('').trim().split('\n').at(-1)!);
    };
    const report = await capture(() => reportAction(ctx(), 'growth'));
    expect(Object.keys(report.roles)).not.toContain('publisher-bot');
    const flow = await capture(() => flowAction(ctx(), 'growth'));
    expect(flow.roles).toContain('lead');
    expect(flow.roles).not.toContain('publisher-bot');
    expect(existsSync(join(root, '.monomind/orgs/growth/runtime.json'))).toBe(true);
    const costs = await capture(() => costsAction(ctx(), 'growth'));
    expect(costs.items.map((i: { role: string }) => i.role)).not.toContain('publisher-bot');
    expect(readFileSync(join(root, '.monomind/orgs/growth.json'), 'utf8')).toContain('publisher-bot');
  });
});
