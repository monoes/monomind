/**
 * The dashboard's Runtime pane, health grid and Config tab (ui/org-runtime.mjs)
 * read Org Runtime v2's own sources — the run bus, runtime.json, history.jsonl,
 * the live daemon's /api/status, cost tiers — and write the org definition
 * only when it passes the schema `org run` enforces.
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
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
import { registerOrg } from '../orgrt/broker.js';
import * as rt from '../ui/org-runtime.mjs';
import { handleOrgRoutes } from '../ui/routes-org.mjs';

const ORG = 'acme';
const RUN = 'run-20260921090000-abcd';
let root: string;
const prevBroker = process.env.MONOMIND_ORGRT_BROKER_DIR;

const orgsDir = () => join(root, '.monomind', 'orgs');
const orgDir = () => join(orgsDir(), ORG);
const def = (extra: Record<string, unknown> = {}) => ({
  name: ORG,
  goal: 'ship it',
  schedule: null,
  run_config: {
    budget_tokens: 1000,
    idle_minutes: 30,
    completion_evidence: true,
    legacy_key: 'kept',
  },
  cost_tiers: { default: 'economy', roles: { lead: 'exempt' } },
  roles: [
    { id: 'lead', title: 'Lead', adapter_config: { model: 'claude-opus-5' } },
    { id: 'dev', title: 'Dev', reports_to: 'lead' },
  ],
  ...extra,
});
const writeDef = (d: unknown) => writeFileSync(join(orgsDir(), `${ORG}.json`), JSON.stringify(d));
const bus = (events: Array<Record<string, unknown>>) => {
  mkdirSync(join(orgDir(), RUN), { recursive: true });
  writeFileSync(
    join(orgDir(), RUN, 'bus.jsonl'),
    events.map((e, i) => JSON.stringify({ id: `e${i}`, org: ORG, run: RUN, ...e })).join('\n'),
  );
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'org-runtime-'));
  mkdirSync(orgDir(), { recursive: true });
  process.env.MONOMIND_ORGRT_BROKER_DIR = join(root, 'broker');
  writeDef(def());
  writeFileSync(
    join(orgDir(), 'runtime.json'),
    JSON.stringify({
      status: 'stopped',
      run: RUN,
      checkpoint: {
        tasks: [
          {
            id: 't1',
            title: 'fix it',
            assignee: 'dev',
            status: 'failed',
            evidenceFailures: 3,
            deps: [],
            createdAt: 1,
          },
        ],
      },
    }),
  );
  bus([
    { ts: 100, type: 'status', from: 'lead', msg: 'session starting' },
    {
      ts: 200,
      type: 'usage',
      from: 'dev',
      data: {
        tokens: 1100,
        tokens_in: 100,
        tokens_out: 50,
        cache_read: 900,
        cache_creation: 50,
        cost_usd: 0.5,
      },
    },
    {
      ts: 300,
      type: 'usage',
      from: 'dev',
      data: {
        tokens: 100,
        tokens_in: 60,
        tokens_out: 40,
        cache_read: 0,
        cache_creation: 0,
        cost_usd: 0.1,
      },
    },
    {
      ts: 400,
      type: 'audit',
      from: 'dev',
      reason: 'task-evidence-refused',
      msg: 'task t1 not closed',
      data: { taskId: 't1', refusal: 'exit 1' },
    },
    {
      ts: 500,
      type: 'audit',
      from: 'dev',
      reason: 'task-evidence-escalated',
      msg: 'escalated',
      data: { taskId: 't1', attempts: 3, cap: 3 },
    },
    { ts: 600, type: 'audit', from: 'lead', reason: 'decision-trace', msg: 'not listed' },
  ]);
  writeFileSync(
    join(orgDir(), 'history.jsonl'),
    [
      {
        run: 'run-a',
        endedAt: Date.now() - 1000,
        closedBy: 'idle-stop',
        outcome: null,
        runnableTasksAtStop: 2,
      },
      {
        run: 'run-b',
        endedAt: Date.now(),
        closedBy: 'org-complete',
        outcome: { status: 'achieved', summary: 'done', by: 'lead' },
        runnableTasksAtStop: 0,
      },
    ]
      .map((h) => JSON.stringify(h))
      .join('\n'),
  );
});

afterEach(() => {
  if (prevBroker === undefined) delete process.env.MONOMIND_ORGRT_BROKER_DIR;
  else process.env.MONOMIND_ORGRT_BROKER_DIR = prevBroker;
  rmSync(root, { recursive: true, force: true });
});

describe('runtimeView — org not running', () => {
  it('reports per-role usage with cache tokens, the budget on its basis, tasks, audit and history', async () => {
    const v = await rt.runtimeView(root, ORG);
    expect(v).toMatchObject({ live: false, run: RUN, status: 'stopped', valid: true });
    const dev = v.roles.find((r: any) => r.id === 'dev');
    expect(dev.usage).toEqual({
      tokens: 1200,
      tokens_in: 160,
      tokens_out: 90,
      cache_read: 900,
      cache_creation: 50,
      cost_usd: 0.6,
      turns: 2,
      legacy_tokens: 0,
    });
    // uncached basis (default) = in + out, not the billable total
    expect(v.budget).toEqual({ tokens: 1000, basis: 'uncached', used: 250 });
    expect(v.settings).toMatchObject({
      completion_evidence: true,
      max_evidence_attempts: 3,
      idle_minutes: 30,
    });
    expect(v.tasks).toEqual([expect.objectContaining({ id: 't1', evidenceFailures: 3 })]);
    // newest first, and only the reasons the pane lists
    expect(v.audit.map((a: any) => a.reason)).toEqual([
      'task-evidence-escalated',
      'task-evidence-refused',
    ]);
    expect(v.history.map((h: any) => [h.run, h.closedBy])).toEqual([
      ['run-b', 'org-complete'],
      ['run-a', 'idle-stop'],
    ]);
  });

  it('resolves each role model the way session.ts does: adapter_config beats the tier, exempt means untiered', async () => {
    const v = await rt.runtimeView(root, ORG);
    const byId = Object.fromEntries(v.roles.map((r: any) => [r.id, r]));
    expect(byId.lead).toMatchObject({
      model: 'claude-opus-5',
      modelSource: 'adapter_config',
      tier: null,
    });
    expect(byId.dev).toMatchObject({
      model: 'claude-sonnet-5',
      modelSource: 'tier',
      tier: 'economy',
      effort: 'medium',
      runtime: 'claude',
    });
  });

  it('counts pre-D1 usage (input+output only) toward uncached, and calls billable unknown', async () => {
    bus([{ ts: 1, type: 'usage', from: 'dev', data: { tokens: 5000, cost_usd: 1 } }]);
    const v = await rt.runtimeView(root, ORG);
    expect(v.budget.used).toBe(5000);
    expect(v.roles.find((r: any) => r.id === 'dev').usage).toMatchObject({
      tokens: 0,
      legacy_tokens: 5000,
      cost_usd: 1,
    });
    writeDef(def({ run_config: { budget_tokens: 1000, budget_tokens_basis: 'billable' } }));
    expect((await rt.runtimeView(root, ORG)).budget.used).toBeNull();
  });

  it('lists the runtime failures it emits as status events, and session crashes', async () => {
    bus([
      { ts: 1, type: 'status', from: 'dev', reason: 'budget-exhausted', msg: 'role budget' },
      { ts: 2, type: 'status', from: 'lead', reason: 'org-budget-exhausted', msg: 'org budget' },
      { ts: 3, type: 'status', from: 'dev', reason: 'agent-fatal', msg: 'fatal' },
      { ts: 4, type: 'audit', from: 'dev', reason: 'agent-session-crash', msg: 'crashed' },
      { ts: 5, type: 'audit', from: 'dev', reason: 'agent-context-limit', msg: 'context full' },
      { ts: 5.5, type: 'audit', from: 'lead', reason: 'boss-context-limit', msg: 'restart' },
      { ts: 6, type: 'status', from: 'lead', msg: 'session starting' },
    ]);
    expect((await rt.runtimeView(root, ORG)).audit.map((a: any) => a.reason)).toEqual([
      'boss-context-limit',
      'agent-context-limit',
      'agent-session-crash',
      'agent-fatal',
      'org-budget-exhausted',
      'budget-exhausted',
    ]);
  });

  it('still renders an invalid definition, listing why org run would refuse it', async () => {
    writeDef(def({ run_config: { budget_tokens: 0 } }));
    const v = await rt.runtimeView(root, ORG);
    expect(v.valid).toBe(false);
    expect(v.problems.join()).toContain('run_config.budget_tokens');
  });
});

describe('runtimeView — org running', () => {
  it("reads the live daemon's roles and task DAG with the org's agent credential", async () => {
    const seen: Array<string | undefined> = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers['x-monomind-cred'] as string);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          orgs: [
            {
              name: ORG,
              run: RUN,
              roles: [{ id: 'dev', status: 'running' }],
              pendingRoles: ['lead'],
              tasks: [{ id: 't2', status: 'running' }],
            },
          ],
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    registerOrg(
      ORG,
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      process.env.MONOMIND_ORGRT_BROKER_DIR,
      'agent-cred',
    );
    try {
      const v = await rt.runtimeView(root, ORG);
      expect(seen).toEqual(['agent-cred']);
      expect(v).toMatchObject({ live: true, status: 'running', tasks: [{ id: 't2' }] });
      expect(Object.fromEntries(v.roles.map((r: any) => [r.id, r.status]))).toEqual({
        lead: 'not started',
        dev: 'running',
      });
      // no watchdog record yet → reported as unknown, not guessed
      expect(v.idle).toMatchObject({ idle_hold: 'unknown' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('runtimeView — a same-named org running in another project', () => {
  it("is not taken for this project's org", async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orgs: [{ name: ORG, run: 'run-other', roles: [], tasks: [] }] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const other = mkdtempSync(join(tmpdir(), 'org-runtime-other-'));
    registerOrg(
      ORG,
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      process.env.MONOMIND_ORGRT_BROKER_DIR,
      'agent-cred',
      other,
    );
    try {
      const v = await rt.runtimeView(root, ORG);
      expect(v).toMatchObject({ live: false, run: RUN });
      expect(seen).toEqual([]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('patchOrgConfig', () => {
  const onDisk = () => JSON.parse(readFileSync(join(orgsDir(), `${ORG}.json`), 'utf8'));

  it('never writes through a link planted where its temp file goes', () => {
    const victim = join(root, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, join(orgsDir(), `${ORG}.json.${process.pid}.tmp`));
    rt.patchOrgConfig(root, ORG, { goal: 'g3' });
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(onDisk().goal).toBe('g3');
  });

  it('refuses a goal that is not a string instead of writing "null"', () => {
    expect(() => rt.patchOrgConfig(root, ORG, { goal: null })).toThrow(rt.ConfigRejected);
    expect(onDisk().goal).toBe('ship it');
  });

  it('merges only the edited fields and keeps everything else in the file', () => {
    rt.patchOrgConfig(root, ORG, {
      goal: 'new goal',
      run_config: { max_evidence_attempts: 5, budget_tokens_basis: 'billable', idle_minutes: null },
      cost_tiers_default: 'budget',
    });
    const d = onDisk();
    expect(d.goal).toBe('new goal');
    expect(d.run_config).toEqual({
      budget_tokens: 1000,
      completion_evidence: true,
      legacy_key: 'kept',
      max_evidence_attempts: 5,
      budget_tokens_basis: 'billable',
    });
    expect(d.cost_tiers).toEqual({ default: 'budget', roles: { lead: 'exempt' } });
    expect(d.roles).toHaveLength(2);
  });

  it('refuses what org run would refuse, and leaves the file untouched', () => {
    const before = readFileSync(join(orgsDir(), `${ORG}.json`), 'utf8');
    for (const patch of [
      { run_config: { budget_tokens: 0 } }, // the old Config tab's "0 = unlimited"
      { run_config: { completion: 'sometimes' } },
      { cost_tiers_default: 'platinum' },
      { run_config: { spawn_all_roles: true } }, // a v1 field
    ]) {
      expect(() => rt.patchOrgConfig(root, ORG, patch), JSON.stringify(patch)).toThrow(
        rt.ConfigRejected,
      );
    }
    expect(readFileSync(join(orgsDir(), `${ORG}.json`), 'utf8')).toBe(before);
  });
});

describe('routes', () => {
  const call = async (method: string, url: string, body?: unknown) => {
    const res: any = {
      statusCode: 0,
      body: '',
      writeHead(c: number) {
        res.statusCode = c;
      },
      end(c?: string) {
        if (c) res.body += c;
      },
    };
    const req: any = {
      method,
      url,
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield JSON.stringify(body);
      },
    };
    expect(await handleOrgRoutes(req, res, url, null, { projectDir: root })).toBe(true);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  it('GET /runtime and /health read the runtime view', async () => {
    expect((await call('GET', `/api/org/${ORG}/runtime`)).body).toMatchObject({
      run: RUN,
      live: false,
    });
    expect((await call('GET', `/api/org/${ORG}/health`)).body).toMatchObject({
      budget_used_tokens: 250,
      budget_max_tokens: 1000,
      budget_used_pct: 25,
      total_runs_7d: 2,
      run_success_rate_7d: 50,
      tasks_pending: 0,
      errors: [],
    });
    expect((await call('GET', '/api/org/nope/runtime')).status).toBe(404);
  });

  it('/health counts a resumed run once, by how it finally ended', async () => {
    // run-a stopped idle, was resumed under the same run id, then achieved
    appendFileSync(
      join(orgDir(), 'history.jsonl'),
      `\n${JSON.stringify({
        run: 'run-a',
        endedAt: Date.now() + 1000,
        closedBy: 'org-complete',
        outcome: { status: 'achieved', summary: 'done', by: 'lead' },
      })}`,
    );
    expect((await call('GET', `/api/org/${ORG}/health`)).body).toMatchObject({
      total_runs_7d: 2,
      run_success_rate_7d: 100,
    });
  });

  it('GET /agents reports the runtime and resolved model, not the role kind', async () => {
    const { body } = await call('GET', `/api/org/${ORG}/agents`);
    expect(body.agents.find((a: any) => a.id === 'dev')).toMatchObject({
      adapterType: 'claude',
      adapterModel: 'claude-sonnet-5',
      tier: 'economy',
    });
  });

  it('POST /config answers 400 with the schema problem', async () => {
    const r = await call('POST', `/api/org/${ORG}/config`, { run_config: { budget_tokens: 0 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('run_config.budget_tokens');
    expect((await call('POST', `/api/org/${ORG}/config`, { goal: 'g2' })).body).toMatchObject({
      ok: true,
      def: { goal: 'g2' },
    });
  });
});
