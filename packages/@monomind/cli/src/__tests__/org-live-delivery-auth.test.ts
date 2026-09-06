/**
 * `org approve`/`org deny`/`org answer`/`org gate-approve` all have a "live"
 * delivery path: if the org is currently hosted by a running daemon (found
 * via the broker registry), they POST straight to that daemon's HTTP inbox
 * instead of writing approvals.json/questions.json/gates.json and waiting
 * for the daemon to notice the file changed on its next poll.
 *
 * That inbox server (orgrt/server.ts) requires an `x-monomind-cred` header
 * on every POST endpoint. The `/api/xdeliver` call site attached it
 * correctly, but `/api/answer-question`, `/api/set-approval`, and
 * `/api/resolve-gate` never did — so every live delivery attempt 401'd and
 * silently fell back to the offline file-write path. Slower (bounded by the
 * daemon's poll interval, not instant), but easy to miss because the
 * fallback always "worked" and only printed a warning.
 *
 * SEC: those three routes act with HUMAN authority, so they must present the
 * OPERATOR credential — not the per-org agent credential published in the
 * broker registry entry, which only unlocks delivery/status routes (and which
 * any agent subprocess on the machine can read).
 *
 * These tests spin up a bare HTTP server standing in for the daemon's inbox,
 * register it in a temp broker registry with an agent credential, publish a
 * separate operator credential, and assert the client sends the OPERATOR
 * credential on each of the three fixed paths.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import {
  registerOrg,
  removeOperatorCredential,
  unregisterOrg,
  writeOperatorCredential,
} from '../orgrt/broker.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';

const CRED = 'test-credential-abc123';
const OPERATOR_CRED = 'test-operator-credential-xyz789';

describe('org approve/deny/answer/gate — live delivery sends the auth credential', () => {
  let cwd: string;
  let brokerDir: string;
  let server: http.Server;
  let baseUrl: string;
  let receivedHeaders: Record<string, string | string[] | undefined>[];
  let operatorDir: string;
  let prevBrokerDirEnv: string | undefined;
  let prevOperatorDirEnv: string | undefined;

  function ctx(args: string[]): CommandContext {
    return { args, flags: { _: [] }, cwd, interactive: false };
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'org-live-cwd-'));
    brokerDir = mkdtempSync(join(tmpdir(), 'org-live-broker-'));
    prevBrokerDirEnv = process.env.MONOMIND_ORGRT_BROKER_DIR;
    process.env.MONOMIND_ORGRT_BROKER_DIR = brokerDir;
    operatorDir = mkdtempSync(join(tmpdir(), 'org-live-operator-'));
    prevOperatorDirEnv = process.env.MONOMIND_ORGRT_OPERATOR_DIR;
    process.env.MONOMIND_ORGRT_OPERATOR_DIR = operatorDir;
    receivedHeaders = [];

    server = http.createServer((req, res) => {
      receivedHeaders.push({ ...req.headers, url: req.url });
      let _body = '';
      req.on('data', (c) => {
        _body += c;
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
    writeOperatorCredential('myorg', OPERATOR_CRED, operatorDir);
  });

  afterEach(async () => {
    unregisterOrg('myorg', brokerDir);
    removeOperatorCredential('myorg', operatorDir);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
    rmSync(brokerDir, { recursive: true, force: true });
    rmSync(operatorDir, { recursive: true, force: true });
    if (prevBrokerDirEnv === undefined) delete process.env.MONOMIND_ORGRT_BROKER_DIR;
    else process.env.MONOMIND_ORGRT_BROKER_DIR = prevBrokerDirEnv;
    if (prevOperatorDirEnv === undefined) delete process.env.MONOMIND_ORGRT_OPERATOR_DIR;
    else process.env.MONOMIND_ORGRT_OPERATOR_DIR = prevOperatorDirEnv;
  });

  it('org approve sends the operator credential to /api/set-approval', async () => {
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
    expect(hit?.['x-monomind-cred']).toBe(OPERATOR_CRED);
  });

  it('org deny sends the operator credential to /api/set-approval', async () => {
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
    expect(hit?.['x-monomind-cred']).toBe(OPERATOR_CRED);
  });

  it('org answer sends the operator credential to /api/answer-question', async () => {
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
    expect(hit?.['x-monomind-cred']).toBe(OPERATOR_CRED);
  });

  it('org gate-approve sends the operator credential to /api/resolve-gate', async () => {
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
    expect(hit?.['x-monomind-cred']).toBe(OPERATOR_CRED);
  });
});
