/**
 * The dashboard's human-in-the-loop path (ui/org-hil.mjs + its routes): a
 * decision reaches a running org's daemon with the OPERATOR credential (the
 * daemon 401s/403s anything else), and an org that is not running gets it
 * recorded in its own v2 files — approvals.json, gates.json, questions.json,
 * inbox.jsonl — never the v1 `<org>-approvals.json` sidecar nothing reads.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerOrg, unregisterOrg, writeOperatorCredential } from '../orgrt/broker.js';
import * as hil from '../ui/org-hil.mjs';
import { handleOrgRoutes } from '../ui/routes-org.mjs';

const ORG = 'acme';
let root: string;
let brokerDir: string;
let operatorDir: string;
const prevEnv = {
  broker: process.env.MONOMIND_ORGRT_BROKER_DIR,
  operator: process.env.MONOMIND_ORGRT_OPERATOR_DIR,
};

const orgDir = () => join(root, '.monomind', 'orgs', ORG);
const readOrgFile = (f: string) => JSON.parse(readFileSync(join(orgDir(), f), 'utf8'));
const writeOrgFile = (f: string, data: unknown) => {
  mkdirSync(orgDir(), { recursive: true });
  writeFileSync(join(orgDir(), f), JSON.stringify(data));
};

const pendingApproval = {
  roleId: 'coder',
  action: 'Bash',
  fingerprint: 'fp',
  question: 'Approve Bash tool call?',
  ts: 1000,
  approved: null,
  requestId: 'apr-1',
  input: { command: 'rm -rf dist' },
};
const pendingGate = {
  id: 'gate-1',
  name: 'Publish 2.14.0',
  description: 'go/no-go',
  roleId: 'boss',
  status: 'pending',
  createdAt: 2000,
};
const pendingQuestion = {
  questionId: 'q-1',
  role: 'boss',
  question: 'X or Y?',
  ts: 3000,
  answer: null,
  answeredAt: null,
  blocking: false,
};

/** A stand-in for the org daemon's server.ts: records each call and answers
 *  with `reply` (default ok). */
async function fakeDaemon(
  reply: { status: number; body: unknown } = { status: 200, body: { ok: true } },
  daemonRoot?: string,
) {
  const calls: Array<{ url: string; cred: string | undefined; body: any }> = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
    });
    req.on('end', () => {
      calls.push({
        url: req.url ?? '',
        cred: req.headers['x-monomind-cred'] as string,
        body: JSON.parse(b || '{}'),
      });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  registerOrg(ORG, url, brokerDir, 'agent-cred', daemonRoot);
  return { calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'org-hil-'));
  brokerDir = join(root, 'broker');
  operatorDir = join(root, 'operator');
  process.env.MONOMIND_ORGRT_BROKER_DIR = brokerDir;
  process.env.MONOMIND_ORGRT_OPERATOR_DIR = operatorDir;
});

afterEach(() => {
  for (const [k, v] of [
    ['MONOMIND_ORGRT_BROKER_DIR', prevEnv.broker],
    ['MONOMIND_ORGRT_OPERATOR_DIR', prevEnv.operator],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('org-hil listing (v2 files)', () => {
  it('maps approvals.json records to id/status and lists everything waiting across orgs', () => {
    writeOrgFile('approvals.json', {
      approvals: [
        pendingApproval,
        { ...pendingApproval, requestId: 'apr-0', approved: false, ts: 10 },
      ],
    });
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeOrgFile('questions.json', {
      questions: [pendingQuestion, { ...pendingQuestion, questionId: 'q-0', blocking: undefined }],
    });

    expect(hil.listApprovals(root, ORG)).toEqual([
      expect.objectContaining({
        id: 'apr-1',
        roleId: 'coder',
        action: 'Bash',
        // no daemon hosts the org: the role that asked ended with its run
        status: 'expired',
        input: { command: 'rm -rf dist' },
      }),
      expect.objectContaining({ id: 'apr-0', status: 'denied' }),
    ]);
    const all = hil.pendingForProject(root);
    expect(all.approvals).toHaveLength(2);
    expect(all.gates).toEqual([expect.objectContaining({ org: ORG, id: 'gate-1' })]);
    // blocking survives; a pre-D4 record (no flag) reads as blocking
    expect(all.questions.map((q: any) => [q.questionId, q.blocking])).toEqual([
      ['q-1', false],
      ['q-0', true],
    ]);
    expect(all.errors).toEqual([]);
  });

  it("a corrupt questions.json does not hide the same org's gates", () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeFileSync(join(orgDir(), 'questions.json'), '{not json');
    const all = hil.pendingForProject(root);
    expect(all.gates).toEqual([expect.objectContaining({ org: ORG, id: 'gate-1' })]);
    expect(all.errors).toEqual([
      expect.objectContaining({ org: ORG, error: expect.stringContaining('questions.json') }),
    ]);
  });

  it('reports a corrupt file instead of showing the org as having nothing pending', () => {
    mkdirSync(orgDir(), { recursive: true });
    writeFileSync(join(orgDir(), 'gates.json'), '{not json');
    expect(hil.pendingForProject(root).errors).toEqual([
      expect.objectContaining({ org: ORG, error: expect.stringContaining('not valid JSON') }),
    ]);
  });
});

describe('org-hil with a running org (daemon registered in the broker)', () => {
  it('sends an approval to /api/set-approval with the operator credential, not the agent one', async () => {
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    const d = await fakeDaemon();
    try {
      await expect(hil.resolveApproval(root, ORG, 'apr-1', true)).resolves.toEqual({
        delivery: 'live',
      });
      expect(d.calls).toEqual([
        {
          url: '/api/set-approval',
          cred: 'op-cred',
          body: {
            org: ORG,
            role: 'coder',
            action: 'Bash',
            approved: true,
            resolvedBy: hil.DASHBOARD_RESOLVER,
            requestId: 'apr-1',
          },
        },
      ]);
      // the daemon owns the file while it runs
      expect(readOrgFile('approvals.json').approvals[0].approved).toBeNull();
    } finally {
      await d.close();
    }
  });

  it('resolves a gate and answers a question through the operator routes', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeOrgFile('questions.json', { questions: [pendingQuestion] });
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    const d = await fakeDaemon();
    try {
      await hil.resolveGate(root, ORG, 'gate-1', false, 'not yet');
      await hil.answerQuestion(root, ORG, 'q-1', 'Y');
      await hil.sendHumanMessage(root, ORG, 'boss', 'status?');
      expect(d.calls.map((c) => [c.url, c.cred])).toEqual([
        ['/api/resolve-gate', 'op-cred'],
        ['/api/answer-question', 'op-cred'],
        ['/api/human-message', 'op-cred'],
      ]);
      expect(d.calls[0].body).toMatchObject({
        gateId: 'gate-1',
        approved: false,
        resolution: 'not yet',
      });
      expect(d.calls[1].body).toMatchObject({ role: 'boss', questionId: 'q-1', answer: 'Y' });
    } finally {
      await d.close();
    }
  });

  it('refuses (503) without the operator credential and writes nothing', async () => {
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    const d = await fakeDaemon();
    try {
      const err = await hil.resolveApproval(root, ORG, 'apr-1', true).catch((e: Error) => e);
      expect(hil.hilErrorStatus(err)).toMatchObject({
        status: 503,
        error: expect.stringContaining('operator credential'),
      });
      expect(d.calls).toEqual([]);
      expect(readOrgFile('approvals.json').approvals[0].approved).toBeNull();
    } finally {
      await d.close();
    }
  });

  it('ignores a same-named org hosted by a daemon in another project', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    const other = mkdtempSync(join(tmpdir(), 'org-hil-other-'));
    const d = await fakeDaemon(undefined, other);
    try {
      await expect(hil.sendHumanMessage(root, ORG, 'boss', 'hi')).resolves.toEqual({
        delivery: 'queued',
      });
      await expect(hil.resolveGate(root, ORG, 'gate-1', true)).resolves.toEqual({
        delivery: 'recorded',
      });
      expect(d.calls).toEqual([]);
    } finally {
      await d.close();
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('uses the daemon registered for this project root', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    const d = await fakeDaemon(undefined, root);
    try {
      expect(hil.listApprovals(root, ORG)[0].status).toBe('pending');
      await expect(hil.resolveGate(root, ORG, 'gate-1', true)).resolves.toEqual({
        delivery: 'live',
      });
      expect(d.calls).toHaveLength(1);
    } finally {
      await d.close();
    }
  });

  it('reports an approval the live daemon no longer holds as ended with its run (409), not 404', async () => {
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    // e.g. left over from before a --resume in a new process
    const d = await fakeDaemon({
      status: 404,
      body: { ok: false, error: 'No pending approval apr-1 found for coder action Bash' },
    });
    try {
      const err = await hil.resolveApproval(root, ORG, 'apr-1', true).catch((e: Error) => e);
      expect(hil.hilErrorStatus(err)).toMatchObject({
        status: 409,
        error: expect.stringContaining('ended with the run'),
      });
    } finally {
      await d.close();
    }
  });

  it("reports the daemon's receipt when it refuses a chat message", async () => {
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    const d = await fakeDaemon({
      status: 404,
      body: { ok: false, receipt: 'ERROR: unknown recipient "ghost"' },
    });
    try {
      const err = await hil.sendHumanMessage(root, ORG, 'ghost', 'hi').catch((e: Error) => e);
      expect(hil.hilErrorStatus(err).error).toContain('unknown recipient');
    } finally {
      await d.close();
    }
  });

  it("surfaces the daemon's rejection instead of writing a file the daemon would overwrite", async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeOperatorCredential(ORG, 'stale-cred', operatorDir);
    const d = await fakeDaemon({
      status: 403,
      body: { ok: false, error: 'forbidden: operator credential required' },
    });
    try {
      const err = await hil.resolveGate(root, ORG, 'gate-1', true).catch((e: Error) => e);
      expect(hil.hilErrorStatus(err)).toEqual({
        status: 403,
        error: 'forbidden: operator credential required',
      });
      expect(readOrgFile('gates.json').gates[0].status).toBe('pending');
    } finally {
      await d.close();
    }
  });
});

describe('org-hil with no running org', () => {
  it('refuses an approval (409): nothing reads approvals.json back, the request ended with its run', async () => {
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    const err = await hil.resolveApproval(root, ORG, 'apr-1', false).catch((e: Error) => e);
    expect(hil.hilErrorStatus(err)).toMatchObject({
      status: 409,
      error: expect.stringContaining('no running daemon'),
    });
    expect(readOrgFile('approvals.json').approvals[0].approved).toBeNull();
  });

  it('leaves no temp file behind when the write fails', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    // a directory where the file goes makes the rename fail
    rmSync(join(orgDir(), 'gates.json'));
    mkdirSync(join(orgDir(), 'gates.json', 'x'), { recursive: true });
    expect(() => hil.writeFileAtomic(join(orgDir(), 'gates.json'), '{}')).toThrow();
    expect(readdirSync(orgDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never writes through a link planted where its temp file goes', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    const victim = join(root, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, join(orgDir(), `gates.json.${process.pid}.tmp`));
    await hil.resolveGate(root, ORG, 'gate-1', true);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(readOrgFile('gates.json').gates[0].status).toBe('approved');
    expect(existsSync(join(orgDir(), 'gates.json'))).toBe(true);
  });

  it('records a gate resolution in gates.json', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    await hil.resolveGate(root, ORG, 'gate-1', true, 'ship it');
    expect(readOrgFile('gates.json').gates[0]).toMatchObject({
      status: 'approved',
      resolution: 'ship it',
      resolvedBy: hil.DASHBOARD_RESOLVER,
    });
  });

  it('queues an answer in the inbox, then marks the question answered', async () => {
    writeOrgFile('questions.json', { questions: [pendingQuestion] });
    await expect(hil.answerQuestion(root, ORG, 'q-1', 'Y')).resolves.toEqual({
      delivery: 'queued',
      role: 'boss',
    });
    const inbox = readFileSync(join(orgDir(), 'inbox.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(inbox).toEqual([
      expect.objectContaining({ fromQualified: 'human', toRole: 'boss', subject: 'answer:q-1' }),
    ]);
    expect(readOrgFile('questions.json').questions[0]).toMatchObject({
      answer: 'Y',
      resolvedBy: hil.DASHBOARD_RESOLVER,
    });
  });

  it('never rewrites a corrupt questions.json', async () => {
    mkdirSync(orgDir(), { recursive: true });
    writeFileSync(join(orgDir(), 'questions.json'), '{"questions": [truncated');
    const err = await hil.answerQuestion(root, ORG, 'q-1', 'Y').catch((e: Error) => e);
    expect(hil.hilErrorStatus(err).status).toBe(500);
    expect(readFileSync(join(orgDir(), 'questions.json'), 'utf8')).toBe('{"questions": [truncated');
  });

  it('queues a chat message for the role in the inbox the daemon drains on start', async () => {
    await expect(hil.sendHumanMessage(root, ORG, 'boss', 'hello')).resolves.toEqual({
      delivery: 'queued',
    });
    const [msg] = readFileSync(join(orgDir(), 'inbox.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(msg).toMatchObject({ fromQualified: 'human', toRole: 'boss', body: 'hello' });
  });
});

describe('HIL routes', () => {
  function makeRes() {
    const res: any = {
      statusCode: 0,
      body: '',
      writeHead(code: number) {
        res.statusCode = code;
      },
      end(chunk?: string) {
        if (chunk) res.body += chunk;
      },
    };
    return res;
  }
  const events: any[] = [];
  const ctx = () => ({
    projectDir: root,
    appendToFile: async () => {},
    broadcastMm: (e: any) => events.push(e),
  });
  async function post(url: string, body: unknown) {
    const payload = JSON.stringify(body);
    const req: any = {
      method: 'POST',
      url,
      async *[Symbol.asyncIterator]() {
        yield payload;
      },
    };
    const res = makeRes();
    expect(await handleOrgRoutes(req, res, url.split('?')[0], null, ctx())).toBe(true);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  }

  it('GET /api/org/:name/approvals reads the v2 approvals.json', async () => {
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    // the dead v1 sidecar must not be what the dashboard shows
    writeFileSync(
      join(root, '.monomind', 'orgs', `${ORG}-approvals.json`),
      JSON.stringify({ approvals: [] }),
    );
    const res = makeRes();
    await handleOrgRoutes(
      { method: 'GET', url: `/api/org/${ORG}/approvals` } as any,
      res,
      `/api/org/${ORG}/approvals`,
      null,
      ctx(),
    );
    // no daemon hosts the org, so nothing is waiting on it any more
    expect(JSON.parse(res.body)).toMatchObject({
      pending: 0,
      approvals: [{ id: 'apr-1', status: 'expired' }],
    });
  });

  it('POST approvals/:id and gates/:id resolve and announce the decision', async () => {
    writeOrgFile('approvals.json', { approvals: [pendingApproval] });
    writeOrgFile('gates.json', { gates: [pendingGate] });
    writeOperatorCredential(ORG, 'op-cred', operatorDir);
    const d = await fakeDaemon(undefined, root);
    events.length = 0;
    try {
      expect(await post(`/api/org/${ORG}/approvals/apr-1`, { action: 'approve' })).toEqual({
        status: 200,
        body: { ok: true, status: 'approved', delivery: 'live' },
      });
    } finally {
      await d.close();
      unregisterOrg(ORG, brokerDir);
    }
    expect(
      await post(`/api/org/${ORG}/gates/gate-1`, { approved: false, resolution: 'no' }),
    ).toMatchObject({
      status: 200,
      body: { ok: true, status: 'rejected' },
    });
    expect(events.map((e) => e.type)).toEqual(['org:approval:resolved', 'org:gate:resolved']);
    expect(await post(`/api/org/${ORG}/gates/gate-1`, { approved: 'yes' })).toMatchObject({
      status: 400,
    });
    expect(await post(`/api/org/${ORG}/approvals/nope`, { action: 'approve' })).toMatchObject({
      status: 404,
    });
  });

  async function rawPost(url: string, chunks: Array<string | Buffer>, abort = false) {
    const req: any = {
      method: 'POST',
      url,
      destroy() {},
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
        if (abort) throw Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
      },
    };
    const res = makeRes();
    expect(await handleOrgRoutes(req, res, url.split('?')[0], null, ctx())).toBe(true);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }

  it('answers 400 for a malformed id instead of throwing out of the handler', async () => {
    for (const u of [`/api/org/${ORG}/gates/%E0%A4%A`, `/api/org/${ORG}/approvals/%ZZ`])
      expect(await post(u, { approved: true, action: 'approve' })).toMatchObject({ status: 400 });
  });

  it('answers 400 when the client aborts mid-body, and 413 for an oversized body', async () => {
    expect(await rawPost(`/api/org/${ORG}/gates/gate-1`, ['{"appr'], true)).toMatchObject({
      status: 400,
    });
    expect(
      await rawPost(`/api/org/${ORG}/gates/gate-1`, ['{"resolution":"', 'x'.repeat(70000), '"}']),
    ).toMatchObject({ status: 413 });
  });

  it('keeps a multi-byte character split across chunks intact', async () => {
    writeOrgFile('gates.json', { gates: [pendingGate] });
    const buf = Buffer.from(JSON.stringify({ approved: true, resolution: 'ok \u2713 ship' }));
    const cut = buf.indexOf(Buffer.from('\u2713')) + 1;
    expect(
      await rawPost(`/api/org/${ORG}/gates/gate-1`, [buf.subarray(0, cut), buf.subarray(cut)]),
    ).toMatchObject({ status: 200 });
    expect(readOrgFile('gates.json').gates[0].resolution).toBe('ok \u2713 ship');
  });
});
