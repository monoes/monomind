// packages/@monomind/cli/__tests__/orgrt/server.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';
import { lookupOrg, readOperatorCredential, registerOrg } from '../../src/orgrt/broker.js';
import { checkApproval } from '../../src/orgrt/approvals.js';

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('org xdeliver server', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('accepts POST /api/xdeliver and rejects missing fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    // BUG 2 FIX: receiveRemote() now verifies the claimed fromOrg actually
    // owns the credential registered for it in the broker — register
    // "beta" here (as its own hosting process would) so the "valid
    // delivery" and "unknown org" cases below can present a matching
    // fromCredential instead of being rejected as an unverified sender.
    const brokerDir = mkdtempSync(join(tmpdir(), 'srv-broker-'));
    const betaCredential = 'beta-cred-123';
    registerOrg('beta', 'http://127.0.0.1:1', brokerDir, betaCredential);

    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false, brokerDir });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.operatorCredential };

    await daemon.startOrg('alpha');

    // no auth → 401
    const noAuth = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toOrg: 'alpha' }),
    });
    expect(noAuth.status).toBe(401);

    // wrong credential → 401
    const badAuth = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-monomind-cred': 'wrong-cred' },
      body: JSON.stringify({ toOrg: 'alpha' }),
    });
    expect(badAuth.status).toBe(401);

    // missing fields → 400
    const bad = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toOrg: 'alpha' }),
    });
    expect(bad.status).toBe(400);

    // unregistered/mismatched sender identity → 404 (rejected before recipient lookup)
    const forged = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toOrg: 'alpha', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello', fromCredential: 'not-betas-credential' }),
    });
    expect(forged.status).toBe(404);
    const forgedData = await forged.json() as { ok: boolean; error?: string };
    expect(forgedData.ok).toBe(false);

    // valid delivery with correct sender credential → 200
    const good = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toOrg: 'alpha', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello', fromCredential: betaCredential }),
    });
    expect(good.status).toBe(200);
    const data = await good.json() as { ok: boolean; receipt?: string };
    expect(data.ok).toBe(true);

    // unknown org → 404
    const miss = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toOrg: 'nope', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello', fromCredential: betaCredential }),
    });
    expect(miss.status).toBe(404);

    // unknown route → 404
    const notFound = await fetch(`http://127.0.0.1:${srv.port}/`);
    expect(notFound.status).toBe(404);

    await daemon.stopAll();
  });

  it('accepts POST /api/answer-question and delivers into the role\'s mailbox', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-answer-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.operatorCredential };
    await daemon.startOrg('alpha');
    await daemon.askHuman('alpha', 'boss', 'proceed?');
    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    const questionId = saved.questions[0].questionId;

    // no auth → 401
    const noAuth = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: 'alpha', role: 'boss', questionId, answer: 'yes' }),
    });
    expect(noAuth.status).toBe(401);

    // wrong credential → 401
    const badAuth = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-monomind-cred': 'wrong-cred' },
      body: JSON.stringify({ org: 'alpha', role: 'boss', questionId, answer: 'yes' }),
    });
    expect(badAuth.status).toBe(401);

    // missing fields → 400
    const bad = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ org: 'alpha' }),
    });
    expect(bad.status).toBe(400);

    // valid answer → 200
    const good = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ org: 'alpha', role: 'boss', questionId, answer: 'yes' }),
    });
    expect(good.status).toBe(200);
    const data = await good.json() as { ok: boolean };
    expect(data.ok).toBe(true);

    // unknown question id → 404
    const miss = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ org: 'alpha', role: 'boss', questionId: 'nope', answer: 'yes' }),
    });
    expect(miss.status).toBe(404);

    await daemon.stopAll();
  });

  it('accepts POST /api/human-message and delivers into the role\'s mailbox', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-human-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.operatorCredential };
    await daemon.startOrg('alpha');

    // no auth → 401
    const noAuth = await fetch(`http://127.0.0.1:${srv.port}/api/human-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: 'alpha', role: 'boss', text: 'hi' }),
    });
    expect(noAuth.status).toBe(401);

    // wrong credential → 401
    const badAuth = await fetch(`http://127.0.0.1:${srv.port}/api/human-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-monomind-cred': 'wrong-cred' },
      body: JSON.stringify({ org: 'alpha', role: 'boss', text: 'hi' }),
    });
    expect(badAuth.status).toBe(401);

    // missing fields → 400
    const bad = await fetch(`http://127.0.0.1:${srv.port}/api/human-message`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ org: 'alpha' }),
    });
    expect(bad.status).toBe(400);

    // valid message → 200, delivered
    const good = await fetch(`http://127.0.0.1:${srv.port}/api/human-message`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ org: 'alpha', role: 'boss', text: 'change of plans' }),
    });
    expect(good.status).toBe(200);
    const data = await good.json() as { ok: boolean; receipt?: string };
    expect(data.ok).toBe(true);
    expect(data.receipt).toContain('delivered');

    // unknown role → 404
    const miss = await fetch(`http://127.0.0.1:${srv.port}/api/human-message`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ org: 'alpha', role: 'nope', text: 'hi' }),
    });
    expect(miss.status).toBe(404);

    await daemon.stopAll();
  });

  it('rejects POST payloads larger than 1MB', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-size-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.operatorCredential };
    await daemon.startOrg('alpha');

    // Create payload larger than 1MB - use streaming to avoid memory issues in test
    const payloadSize = 1_100_000; // >1MB
    const largePayload = JSON.stringify({
      toOrg: 'alpha', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss',
      subject: 'large', body: 'x'.repeat(payloadSize),
    });

    // Server rejects oversized payloads - connection reset or 400 expected
    try {
      const oversized = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
        method: 'POST',
        headers: authHeaders,
        body: largePayload,
        // Disable timeout to handle slow rejection
        signal: AbortSignal.timeout(5000),
      });
      // If we get a response, it should be 400
      expect(oversized.status).toBe(400);
    } catch (err: any) {
      // Connection reset is acceptable - server closed connection to reject oversized payload
      expect(err.cause?.code).toBe('ECONNRESET');
    }

    await daemon.stopAll();
  });
});

// SEC: one credential used to authorize EVERY route, and it was published to
// the broker registry — a file any org process (and any agent subprocess with
// Bash) on the machine can read. So a role could approve its own gates, and
// one org could present the shared credential as a sibling's identity. Now the
// broker carries a per-org AGENT credential that only unlocks delivery/status
// routes, and human decisions need the separate operator credential, which
// never appears in the broker entry.
describe('credential separation: agent (delivery) vs operator (approvals/gates)', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  async function boot() {
    const root = mkdtempSync(join(tmpdir(), 'srv-sep-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    for (const name of ['alpha', 'beta']) {
      writeFileSync(join(root, `.monomind/orgs/${name}.json`), JSON.stringify({
        name, goal: 'g',
        roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
      }));
    }
    const brokerDir = mkdtempSync(join(tmpdir(), 'srv-sep-broker-'));
    const operatorDir = mkdtempSync(join(tmpdir(), 'srv-sep-operator-'));
    const daemon = new OrgDaemon(root, {
      queryFn: echoQuery as any, forward: false, crossProcess: true, brokerDir, operatorDir,
    });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
    await daemon.startOrg('alpha');
    await daemon.startOrg('beta');
    const base = `http://127.0.0.1:${srv.port}`;
    const post = (route: string, cred: string | undefined, body: unknown) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cred ? { 'x-monomind-cred': cred } : {}) },
        body: JSON.stringify(body),
      });
    return { daemon, srv, brokerDir, operatorDir, base, post };
  }

  it('publishes a distinct agent credential per org, and keeps the operator credential out of the broker', async () => {
    const { daemon, srv, brokerDir, operatorDir } = await boot();
    const alpha = lookupOrg('alpha', brokerDir)!;
    const beta = lookupOrg('beta', brokerDir)!;
    expect(alpha.credential).toBeTruthy();
    expect(beta.credential).toBeTruthy();
    expect(alpha.credential).not.toBe(beta.credential);
    expect(alpha.credential).not.toBe(srv.operatorCredential);
    expect(beta.credential).not.toBe(srv.operatorCredential);
    expect(readOperatorCredential('alpha', operatorDir)).toBe(srv.operatorCredential);
    expect(readFileSync(join(brokerDir, 'alpha.json'), 'utf8')).not.toContain(srv.operatorCredential);
    await daemon.stopAll();
  });

  it('an org agent credential cannot approve or resolve gates; the operator credential can', async () => {
    const { daemon, srv, brokerDir, post } = await boot();
    const agentCred = lookupOrg('alpha', brokerDir)!.credential!;
    await checkApproval(daemon, 'alpha', 'boss', 'Bash', { command: 'rm -rf /' });

    const selfApprove = await post('/api/set-approval', agentCred, { org: 'alpha', role: 'boss', action: 'Bash', approved: true });
    expect(selfApprove.status).toBe(403);
    expect(daemon.approvals.get('alpha')![0].approved).toBeNull(); // still pending

    const gate = await post('/api/resolve-gate', agentCred, { org: 'alpha', gateId: 'g1', approved: true });
    expect(gate.status).toBe(403);

    const answer = await post('/api/answer-question', agentCred, { org: 'alpha', role: 'boss', questionId: 'q', answer: 'yes' });
    expect(answer.status).toBe(403);

    const human = await post('/api/human-message', agentCred, { org: 'alpha', role: 'boss', text: 'hi' });
    expect(human.status).toBe(403);

    const approve = await post('/api/set-approval', srv.operatorCredential, { org: 'alpha', role: 'boss', action: 'Bash', approved: true });
    expect(approve.status).toBe(200);
    expect(daemon.approvals.get('alpha')![0].approved).toBe(true);
    await daemon.stopAll();
  });

  it('an org agent credential still unlocks delivery and status routes', async () => {
    const { daemon, brokerDir, base, post } = await boot();
    const alphaCred = lookupOrg('alpha', brokerDir)!.credential!;
    const betaCred = lookupOrg('beta', brokerDir)!.credential!;

    // alpha (hosted here) delivering to beta (hosted here) over the wire, as a
    // separate process would: header = target's credential, body = own credential.
    const good = await post('/api/xdeliver', betaCred, {
      toOrg: 'beta', toRole: 'boss', fromOrg: 'alpha', fromRole: 'boss',
      subject: 'hi', body: 'hello', fromCredential: alphaCred,
    });
    expect(good.status).toBe(200);

    // beta presenting alpha's identity with its OWN credential is rejected —
    // the credentials are per-org now, not one shared secret.
    const forged = await post('/api/xdeliver', betaCred, {
      toOrg: 'beta', toRole: 'boss', fromOrg: 'alpha', fromRole: 'boss',
      subject: 'forged', body: 'not alpha', fromCredential: betaCred,
    });
    expect(forged.status).toBe(404);

    const status = await fetch(`${base}/api/status`, { headers: { 'x-monomind-cred': alphaCred } });
    expect(status.status).toBe(200);

    const unknown = await fetch(`${base}/api/status`, { headers: { 'x-monomind-cred': 'nope' } });
    expect(unknown.status).toBe(401);
    await daemon.stopAll();
  });
});
