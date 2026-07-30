// packages/@monomind/cli/__tests__/orgrt/server.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';

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
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.credential };

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

    // valid delivery → 200
    const good = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toOrg: 'alpha', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello' }),
    });
    expect(good.status).toBe(200);
    const data = await good.json() as { ok: boolean; receipt?: string };
    expect(data.ok).toBe(true);

    // unknown org → 404
    const miss = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toOrg: 'nope', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello' }),
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
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.credential };
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
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.credential };
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
    const authHeaders = { 'Content-Type': 'application/json', 'x-monomind-cred': srv.credential };
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
