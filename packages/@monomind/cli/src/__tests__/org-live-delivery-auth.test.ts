/**
 * `org approve`/`org deny`/`org answer`/`org gate-approve` all have a "live"
 * delivery path: if the org is currently hosted by a running daemon (found
 * via the broker registry), they POST straight to that daemon's HTTP inbox
 * instead of writing approvals.json/questions.json/gates.json and waiting
 * for the daemon to notice the file changed on its next poll.
 *
 * That inbox server (orgrt/server.ts) requires an `x-monomind-cred` header
 * on every POST endpoint, timing-safe-compared against a per-process
 * credential shared through the broker registry entry. The `/api/xdeliver`
 * call site attached it correctly, but `/api/answer-question`,
 * `/api/set-approval`, and `/api/resolve-gate` never did — so every live
 * delivery attempt 401'd and silently fell back to the offline file-write
 * path. Slower (bounded by the daemon's poll interval, not instant), but
 * easy to miss because the fallback always "worked" and only printed a
 * warning.
 *
 * These tests spin up a bare HTTP server standing in for the daemon's inbox,
 * register it in a temp broker registry with a credential, and assert the
 * client actually sends that credential on each of the three fixed paths.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  answerAction,
  approveAction,
  denyAction,
  gateResolveAction,
} from '../commands/org-observe.js';
import { checkApproval } from '../orgrt/approvals.js';
import { registerOrg, unregisterOrg } from '../orgrt/broker.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';

const CRED = 'test-credential-abc123';

describe('org approve/deny/answer/gate — live delivery sends the auth credential', () => {
  let cwd: string;
  let brokerDir: string;
  let server: http.Server;
  let baseUrl: string;
  let receivedHeaders: Record<string, string | string[] | undefined>[];
  let prevBrokerDirEnv: string | undefined;

  function ctx(args: string[]): CommandContext {
    return { args, flags: { _: [] }, cwd, interactive: false };
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'org-live-cwd-'));
    brokerDir = mkdtempSync(join(tmpdir(), 'org-live-broker-'));
    prevBrokerDirEnv = process.env.MONOMIND_ORGRT_BROKER_DIR;
    process.env.MONOMIND_ORGRT_BROKER_DIR = brokerDir;
    receivedHeaders = [];

    server = http.createServer((req, res) => {
      receivedHeaders.push({ ...req.headers, url: req.url });
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    registerOrg('myorg', baseUrl, brokerDir, CRED);
  });

  afterEach(async () => {
    unregisterOrg('myorg', brokerDir);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
    rmSync(brokerDir, { recursive: true, force: true });
    if (prevBrokerDirEnv === undefined) delete process.env.MONOMIND_ORGRT_BROKER_DIR;
    else process.env.MONOMIND_ORGRT_BROKER_DIR = prevBrokerDirEnv;
  });

  it('org approve sends x-monomind-cred to /api/set-approval', async () => {
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      orgs: new Map(),
    } as unknown as OrgDaemon;
    await checkApproval(daemon, 'myorg', 'boss', 'Bash');

    await approveAction(ctx(['myorg', 'boss', 'Bash']), 'myorg');

    const hit = receivedHeaders.find((h) => h.url === '/api/set-approval');
    expect(hit).toBeDefined();
    expect(hit?.['x-monomind-cred']).toBe(CRED);
  });

  it('org deny sends x-monomind-cred to /api/set-approval', async () => {
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      orgs: new Map(),
    } as unknown as OrgDaemon;
    await checkApproval(daemon, 'myorg', 'boss', 'WebFetch');

    await denyAction(ctx(['myorg', 'boss', 'WebFetch']), 'myorg');

    const hit = receivedHeaders.find((h) => h.url === '/api/set-approval');
    expect(hit).toBeDefined();
    expect(hit?.['x-monomind-cred']).toBe(CRED);
  });

  it('org answer sends x-monomind-cred to /api/answer-question', async () => {
    const orgDir = join(cwd, ORG_DIR, 'myorg');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(
      join(orgDir, 'questions.json'),
      JSON.stringify({
        questions: [
          {
            questionId: 'q1',
            role: 'boss',
            question: 'ok?',
            answer: null,
            ts: Date.now(),
            answeredAt: null,
          },
        ],
      }),
    );

    await answerAction(ctx(['myorg', 'q1', 'yes']), 'myorg');

    const hit = receivedHeaders.find((h) => h.url === '/api/answer-question');
    expect(hit).toBeDefined();
    expect(hit?.['x-monomind-cred']).toBe(CRED);
  });

  it('org gate-approve sends x-monomind-cred to /api/resolve-gate', async () => {
    const orgDir = join(cwd, ORG_DIR, 'myorg');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(
      join(orgDir, 'gates.json'),
      JSON.stringify({
        gates: [
          {
            id: 'g1',
            name: 'test gate',
            description: 'test',
            roleId: 'boss',
            status: 'pending',
            createdAt: Date.now(),
          },
        ],
      }),
    );

    await gateResolveAction(ctx(['myorg', 'g1']), 'myorg', true);

    const hit = receivedHeaders.find((h) => h.url === '/api/resolve-gate');
    expect(hit).toBeDefined();
    expect(hit?.['x-monomind-cred']).toBe(CRED);
  });
});
