// packages/@monomind/cli/__tests__/orgrt/federation.test.ts
/**
 * M4 — federation (capability `org-federation`): allow_to / allow_from across
 * project roots, broker root, root mismatch, same-root and operator exemptions.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lookupOrg, normalizeRoot } from '../../src/orgrt/broker.js';
import { federationAllows } from '../../src/orgrt/cross-org.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const echoQuery = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

function writeOrg(root: string, name: string, federation?: Record<string, unknown>) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs', `${name}.json`),
    JSON.stringify({
      name,
      goal: 'g',
      ...(federation ? { federation } : {}),
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
    }),
  );
}

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('M4 — federation', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  const brokerDir = () => mkdtempSync(join(tmpdir(), 'm4-broker-'));

  /** One daemon process (own root unless `root` is given) hosting `name`. */
  async function host(broker: string, name: string, federation?: Record<string, unknown>, root?: string) {
    const r = root ?? mkdtempSync(join(tmpdir(), `m4-${name}-`));
    writeOrg(r, name, federation);
    const daemon = new OrgDaemon(r, {
      queryFn: echoQuery as any,
      forward: false,
      crossProcess: true,
      brokerDir: broker,
      operatorDir: mkdtempSync(join(tmpdir(), 'm4-op-')),
    });
    const srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
    const running = await daemon.startOrg(name);
    cleanups.push(async () => {
      await daemon.stopAll();
      srv.close();
      if (!root) rmSync(r, { recursive: true, force: true });
    });
    return { root: r, daemon, srv, running };
  }

  it('schema passthrough and allowlist semantics', () => {
    const def = OrgDefSchema.parse({
      name: 'a',
      federation: { allow_from: ['hq'], allow_to: ['*'], note: 'x' },
      roles: [{ id: 'boss', reports_to: null }],
    });
    expect(def.federation).toEqual({ allow_from: ['hq'], allow_to: ['*'], note: 'x' });
    expect(federationAllows(undefined, 'x')).toBe(true);
    expect(federationAllows([], 'x')).toBe(false);
    expect(federationAllows(['*'], 'x')).toBe(true);
    expect(federationAllows(['x'], 'x')).toBe(true);
    expect(federationAllows(['y'], 'x')).toBe(false);
  });

  it('the broker entry carries the hosting root', async () => {
    const broker = brokerDir();
    const A = await host(broker, 'alpha');
    expect(lookupOrg('alpha', broker)?.root).toBe(normalizeRoot(A.root));
  });

  it('allow_to: a cross-root delivery to an unlisted org is refused with an audit event', async () => {
    const broker = brokerDir();
    const A = await host(broker, 'alpha', { allow_to: ['gamma'] });
    const B = await host(broker, 'beta');
    const receipt = await A.daemon.deliver('alpha', 'boss', 'beta:boss', 'hi', 'nope');
    expect(receipt).toBe('ERROR: federation: alpha:boss may not send to beta:boss');
    const audit = A.running.busEvents().find((e) => e.reason === 'federation-denied');
    expect(audit).toBeDefined();
    expect(B.running.busEvents().some((e) => e.type === 'xorg')).toBe(false);
  });

  it('allow_to listing the target (or *) lets the cross-root delivery through', async () => {
    const broker = brokerDir();
    const A = await host(broker, 'alpha', { allow_to: ['beta'] });
    const B = await host(broker, 'beta');
    expect(await A.daemon.deliver('alpha', 'boss', 'beta:boss', 'hi', 'ok')).toMatch(/delivered to beta:boss \(remote\)/);
    await waitFor(() => B.running.busEvents().some((e) => e.type === 'xorg' && e.from === 'alpha:boss'));
  });

  it('allow_from: the receiver rejects a cross-root sender it does not list', async () => {
    const broker = brokerDir();
    const A = await host(broker, 'alpha');
    const B = await host(broker, 'beta', { allow_from: ['gamma'] });
    const receipt = await A.daemon.deliver('alpha', 'boss', 'beta:boss', 'hi', 'rejected');
    expect(receipt).toMatch(/^ERROR: remote org "beta:boss" rejected delivery: federation: sender not allowed$/);
    expect(B.running.busEvents().some((e) => e.reason === 'federation-denied')).toBe(true);
    expect(B.running.busEvents().some((e) => e.type === 'xorg')).toBe(false);

    const C = await host(broker, 'gamma');
    expect(await C.daemon.deliver('gamma', 'boss', 'beta:boss', 'hi', 'listed')).toMatch(/delivered/);
  });

  it('same root is one trust domain: restrictions never apply', async () => {
    const broker = brokerDir();
    const shared = mkdtempSync(join(tmpdir(), 'm4-shared-'));
    cleanups.push(() => rmSync(shared, { recursive: true, force: true }));
    // two separate daemons (as two `org run` processes) under ONE project root
    const A = await host(broker, 'alpha', { allow_to: [] }, shared);
    const B = await host(broker, 'beta', { allow_from: [] }, shared);
    expect(lookupOrg('beta', broker)?.root).toBe(lookupOrg('alpha', broker)?.root);
    expect(await A.daemon.deliver('alpha', 'boss', 'beta:boss', 'hi', 'same root')).toMatch(/delivered/);
    await waitFor(() => B.running.busEvents().some((e) => e.type === 'xorg' && e.from === 'alpha:boss'));
  });

  it('root mismatch: a sender claiming a root other than its broker entry is rejected', async () => {
    const broker = brokerDir();
    const A = await host(broker, 'alpha');
    const B = await host(broker, 'beta');
    const post = (body: Record<string, unknown>, cred: string) =>
      fetch(`http://127.0.0.1:${B.srv.port}/api/xdeliver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-monomind-cred': cred },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, data: (await r.json()) as Record<string, unknown> }));
    const base = {
      fromOrg: 'alpha',
      fromRole: 'boss',
      fromCredential: A.running.credential,
      toOrg: 'beta',
      toRole: 'boss',
      subject: 's',
      body: 'b',
    };
    const mismatch = await post({ ...base, fromRoot: '/somewhere/else' }, B.running.credential!);
    expect(mismatch.status).toBe(404);
    expect(mismatch.data.error).toBe('federation: root mismatch');
    const honest = await post({ ...base, fromRoot: A.root }, B.running.credential!);
    expect(honest.status).toBe(200);
    // no stated root (older sender) is not a mismatch — it counts as another root
    const unstated = await post(base, B.running.credential!);
    expect(unstated.status).toBe(200);
  });

  it('a sender that states no root is treated as cross-root by allow_from', async () => {
    const broker = brokerDir();
    const A = await host(broker, 'alpha');
    const B = await host(broker, 'beta', { allow_from: ['gamma'] }, A.root);
    const res = await fetch(`http://127.0.0.1:${B.srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-monomind-cred': B.running.credential! },
      body: JSON.stringify({ fromOrg: 'alpha', fromRole: 'boss', fromCredential: A.running.credential, toOrg: 'beta', toRole: 'boss', subject: 's', body: 'b' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('federation: sender not allowed');
  });

  it('operator-authenticated deliveries are exempt', async () => {
    const broker = brokerDir();
    const B = await host(broker, 'beta', { allow_from: ['gamma'] });
    const res = await fetch(`http://127.0.0.1:${B.srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-monomind-cred': B.srv.operatorCredential },
      body: JSON.stringify({ fromOrg: 'alpha', fromRole: 'boss', toOrg: 'beta', toRole: 'boss', subject: 's', body: 'b', fromRoot: '/elsewhere' }),
    });
    expect(res.status).toBe(200);
  });
});
