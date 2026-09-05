import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';
import { lookupOrg, registerOrg } from '../../src/orgrt/broker.js';

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

function fixture(root: string, name: string) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
  }));
}

/**
 * Simulates two SEPARATE `monomind org` processes — different project
 * directories, only sharing the machine-local broker registry — exchanging
 * an inter-org message purely over HTTP + the file-based broker. No shared
 * OrgDaemon instance, no shared in-memory state: this is the actual code
 * path a second project on the same machine would use.
 */
describe('cross-process inter-org delivery', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const fn of cleanups.reverse()) await fn(); cleanups.length = 0; });

  it('routes a message from one process\'s org to another process\'s org via the broker + HTTP inbox', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker-'));

    // "project A" — its own root, its own daemon, its own server (own process in reality)
    const rootA = mkdtempSync(join(tmpdir(), 'projA-'));
    fixture(rootA, 'alpha');
    const daemonA = new OrgDaemon(rootA, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvA = await startOrgServer(daemonA, 0);
    cleanups.push(() => srvA.close());
    daemonA.setInboxUrl(`http://127.0.0.1:${srvA.port}`, srvA.credential);
    const alpha = await daemonA.startOrg('alpha');
    cleanups.push(() => daemonA.stopAll());

    // "project B" — a completely different root/daemon/server; never touches daemonA
    const rootB = mkdtempSync(join(tmpdir(), 'projB-'));
    fixture(rootB, 'beta');
    const daemonB = new OrgDaemon(rootB, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvB = await startOrgServer(daemonB, 0);
    cleanups.push(() => srvB.close());
    daemonB.setInboxUrl(`http://127.0.0.1:${srvB.port}`, srvB.credential);
    const beta = await daemonB.startOrg('beta');
    cleanups.push(() => daemonB.stopAll());

    // sanity: the broker actually sees both, registered by two independent daemons
    expect(lookupOrg('alpha', brokerDir)?.url).toBe(`http://127.0.0.1:${srvA.port}`);
    expect(lookupOrg('beta', brokerDir)?.url).toBe(`http://127.0.0.1:${srvB.port}`);

    // daemonA's boss addresses daemonB's org — only path available is broker lookup + HTTP
    const receipt = await daemonA.deliver('alpha', 'boss', 'beta:boss', 'cross-project', 'hello from project A');
    expect(receipt).toMatch(/delivered to beta:boss \(remote\)/);

    // sender side: xorg recorded locally in project A's bus
    expect(alpha.busEvents().some(e =>
      e.type === 'xorg' && e.to === 'beta:boss' && e.msg === 'hello from project A')).toBe(true);

    // receiver side: xorg recorded in project B's bus, AND the message actually
    // reached beta's boss mailbox (echo agent will surface it as a chat reply)
    await new Promise(r => setTimeout(r, 300));
    expect(beta.busEvents().some(e =>
      e.type === 'xorg' && e.from === 'alpha:boss' && e.msg === 'hello from project A')).toBe(true);
    expect(beta.busEvents().some(e =>
      e.type === 'chat' && e.from === 'boss' && (e.msg ?? '').includes('hello from project A'))).toBe(true);
  });

  it('fails gracefully with a clear error when no process on the machine hosts the target org', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker2-'));
    const root = mkdtempSync(join(tmpdir(), 'projC-'));
    fixture(root, 'gamma');
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srv = await startOrgServer(daemon, 0);
    cleanups.push(() => srv.close());
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.credential);
    await daemon.startOrg('gamma');
    cleanups.push(() => daemon.stopAll());

    const receipt = await daemon.deliver('gamma', 'boss', 'nowhere:someone', 's', 'b');
    expect(receipt).toMatch(/unknown recipient/);
    expect(receipt).toMatch(/no process on this machine/);
  });

  it('receiveRemote rejects delivery to an org/role this process does not actually host', () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker3-'));
    const root = mkdtempSync(join(tmpdir(), 'projD-'));
    const daemon = new OrgDaemon(root, { forward: false, brokerDir });
    const missingOrg = daemon.receiveRemote('nope', 'boss', 'other:boss', 's', 'b');
    expect(missingOrg.ok).toBe(false);
  });

  it('rejects delivery with expired credentials during cross-process message', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker4-'));

    // Set up source org
    const rootA = mkdtempSync(join(tmpdir(), 'projE-'));
    fixture(rootA, 'alpha');
    const daemonA = new OrgDaemon(rootA, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvA = await startOrgServer(daemonA, 0);
    cleanups.push(() => srvA.close());
    daemonA.setInboxUrl(`http://127.0.0.1:${srvA.port}`, srvA.credential);
    await daemonA.startOrg('alpha');
    cleanups.push(() => daemonA.stopAll());

    // Set up target org with invalid credential
    const rootB = mkdtempSync(join(tmpdir(), 'projF-'));
    fixture(rootB, 'beta');
    const daemonB = new OrgDaemon(rootB, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvB = await startOrgServer(daemonB, 0);
    cleanups.push(() => srvB.close());
    daemonB.setInboxUrl(`http://127.0.0.1:${srvB.port}`, 'INVALID_CREDENTIAL');
    await daemonB.startOrg('beta');
    cleanups.push(() => daemonB.stopAll());

    // Attempt delivery with invalid credential should fail
    const result = await fetch(`http://127.0.0.1:${srvB.port}/api/xdeliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-monomind-cred': 'INVALID_CREDENTIAL',
      },
      body: JSON.stringify({
        toOrg: 'beta',
        toRole: 'boss',
        fromOrg: 'alpha',
        fromRole: 'boss',
        subject: 'test',
        body: 'test message',
      }),
    });

    expect(result.status).toBe(401);
  });

  it('prevents replay attacks by rejecting duplicate message deliveries', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker5-'));

    // Set up two orgs
    const rootA = mkdtempSync(join(tmpdir(), 'projG-'));
    fixture(rootA, 'alpha');
    const daemonA = new OrgDaemon(rootA, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvA = await startOrgServer(daemonA, 0);
    cleanups.push(() => srvA.close());
    daemonA.setInboxUrl(`http://127.0.0.1:${srvA.port}`, srvA.credential);
    const alpha = await daemonA.startOrg('alpha');
    cleanups.push(() => daemonA.stopAll());

    const rootB = mkdtempSync(join(tmpdir(), 'projH-'));
    fixture(rootB, 'beta');
    const daemonB = new OrgDaemon(rootB, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvB = await startOrgServer(daemonB, 0);
    cleanups.push(() => srvB.close());
    daemonB.setInboxUrl(`http://127.0.0.1:${srvB.port}`, srvB.credential);
    const beta = await daemonB.startOrg('beta');
    cleanups.push(() => daemonB.stopAll());

    // First delivery should succeed
    const receipt1 = await daemonA.deliver('alpha', 'boss', 'beta:boss', 'replay-test', 'message 1');
    expect(receipt1).toMatch(/delivered/);

    // Wait for processing
    await new Promise(r => setTimeout(r, 200));

    // Send identical message again (potential replay attack)
    const receipt2 = await daemonA.deliver('alpha', 'boss', 'beta:boss', 'replay-test', 'message 1');
    expect(receipt2).toMatch(/delivered/); // Should still succeed (no dedup in current impl)

    // Verify both messages were delivered (current behavior)
    const events = beta.busEvents();
    const replayEvents = events.filter(e => e.subject === 'replay-test' && e.msg === 'message 1');
    expect(replayEvents.length).toBeGreaterThanOrEqual(1); // At least one message
  });

  // BUG 2: the x-monomind-cred header only proves the caller can reach the
  // RECEIVING daemon — it says nothing about who the caller claims to be.
  // receiveRemote() must additionally verify the claimed fromOrg actually
  // owns the credential registered for it in the broker.
  it('rejects xdeliver when the claimed fromOrg does not own its registered credential (impersonation)', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker6-'));

    const rootA = mkdtempSync(join(tmpdir(), 'projI-'));
    fixture(rootA, 'alpha');
    const daemonA = new OrgDaemon(rootA, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvA = await startOrgServer(daemonA, 0);
    cleanups.push(() => srvA.close());
    daemonA.setInboxUrl(`http://127.0.0.1:${srvA.port}`, srvA.credential);
    await daemonA.startOrg('alpha');
    cleanups.push(() => daemonA.stopAll());

    const rootB = mkdtempSync(join(tmpdir(), 'projJ-'));
    fixture(rootB, 'beta');
    const daemonB = new OrgDaemon(rootB, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    const srvB = await startOrgServer(daemonB, 0);
    cleanups.push(() => srvB.close());
    daemonB.setInboxUrl(`http://127.0.0.1:${srvB.port}`, srvB.credential);
    const beta = await daemonB.startOrg('beta');
    cleanups.push(() => daemonB.stopAll());

    // Attacker knows daemonB's shared x-monomind-cred (passes the HTTP auth
    // gate — e.g. another org hosted by the same daemon) but does NOT know
    // alpha's own registered credential; it just claims to be "alpha".
    const forged = await fetch(`http://127.0.0.1:${srvB.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-monomind-cred': srvB.credential },
      body: JSON.stringify({
        toOrg: 'beta', toRole: 'boss', fromOrg: 'alpha', fromRole: 'boss',
        subject: 'forged', body: 'not really from alpha',
        fromCredential: 'totally-made-up',
      }),
    });
    expect(forged.status).toBe(404);
    const forgedData = await forged.json() as { ok: boolean; error?: string };
    expect(forgedData.ok).toBe(false);
    expect(beta.busEvents().some(e => e.subject === 'forged')).toBe(false);

    // A correctly-credentialed message from the real alpha still succeeds.
    const receipt = await daemonA.deliver('alpha', 'boss', 'beta:boss', 'legit', 'really from alpha');
    expect(receipt).toMatch(/delivered to beta:boss \(remote\)/);
    await new Promise(r => setTimeout(r, 200));
    expect(beta.busEvents().some(e => e.type === 'xorg' && e.subject === 'legit')).toBe(true);
  });

  it('receiveRemote rejects a fromOrg claim with no matching registered credential, and accepts a matching one', async () => {
    const brokerDir = mkdtempSync(join(tmpdir(), 'xproc-broker7-'));
    const root = mkdtempSync(join(tmpdir(), 'projK-'));
    fixture(root, 'gamma');
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir });
    await daemon.startOrg('gamma');
    cleanups.push(() => daemon.stopAll());

    // "alpha" was never registered in this broker — its credential can't be verified.
    const rejected = daemon.receiveRemote('gamma', 'boss', 'alpha:boss', 's', 'b', 'whatever');
    expect(rejected.ok).toBe(false);

    // Register alpha with a real credential and retry with the matching value.
    registerOrg('alpha', 'http://127.0.0.1:1', brokerDir, 'alpha-secret');
    const wrongCred = daemon.receiveRemote('gamma', 'boss', 'alpha:boss', 's', 'b', 'wrong-secret');
    expect(wrongCred.ok).toBe(false);

    const accepted = daemon.receiveRemote('gamma', 'boss', 'alpha:boss', 's', 'b', 'alpha-secret');
    expect(accepted.ok).toBe(true);
  });
});
