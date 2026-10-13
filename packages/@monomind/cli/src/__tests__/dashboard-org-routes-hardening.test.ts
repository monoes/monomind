/**
 * Dashboard org routes: abort-safe bounded body reads, the human-only gate on
 * definition writes, honest running status, 409 on running orgs, signature
 * state in responses, cost honesty and bounded run reads.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeOperatorCredential } from '../orgrt/broker.js';
import * as rt from '../ui/org-runtime.mjs';
import { handleOrgRoutes } from '../ui/routes-org.mjs';
import { _isHumanRoute } from '../ui/server-auth.mjs';
import { _accumulateAgentUsage } from '../ui/server-mastermind-usage.mjs';

const ORG = 'acme';
const RUN = 'run-20260921090000-abcd';
let root: string;
let operatorDir: string;
const saved: Record<string, string | undefined> = {};

const orgsDir = () => join(root, '.monomind', 'orgs');
const orgDir = () => join(orgsDir(), ORG);
const goodDef = (extra: Record<string, unknown> = {}) => ({
  name: ORG,
  goal: 'ship it',
  schedule: null,
  run_config: {},
  roles: [{ id: 'lead', title: 'Lead' }],
  ...extra,
});
const writeDef = (d: unknown) => writeFileSync(join(orgsDir(), `${ORG}.json`), JSON.stringify(d));
const writeRuntime = (r: Record<string, unknown>) =>
  writeFileSync(join(orgDir(), 'runtime.json'), JSON.stringify(r));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dash-hardening-'));
  operatorDir = join(root, 'operator');
  for (const k of ['MONOMIND_ORGRT_BROKER_DIR', 'MONOMIND_ORGRT_OPERATOR_DIR'])
    saved[k] = process.env[k];
  process.env.MONOMIND_ORGRT_BROKER_DIR = join(root, 'broker');
  process.env.MONOMIND_ORGRT_OPERATOR_DIR = operatorDir;
  mkdirSync(orgDir(), { recursive: true });
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

type Chunk = string | Error;
const call = async (
  method: string,
  url: string,
  body?: unknown,
  chunks?: Chunk[],
  extra: Record<string, unknown> = {},
) => {
  const res: any = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    headersSent: false,
    writeHead(c: number, h?: Record<string, string>) {
      res.statusCode = c;
      res.headers = h ?? {};
      res.headersSent = true;
    },
    end(c?: string) {
      if (c) res.body += c;
    },
  };
  const parts: Chunk[] = chunks ?? (body === undefined ? [] : [JSON.stringify(body)]);
  const req: any = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const p of parts) {
        if (p instanceof Error) throw p;
        yield Buffer.from(p);
      }
    },
  };
  const ctx = {
    projectDir: root,
    activeOrgRuns: new Map(),
    _resolveOrgProjectDir: () => root,
    _readRunState: () => null,
    _getGitMonomindDir: () => null,
    _getActiveRunId: () => null,
    appendToFile: async () => {},
    broadcastMm: () => {},
    ...extra,
  };
  const handled = await handleOrgRoutes(req, res, url.split('?')[0], null, ctx);
  let json: any = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* non-JSON body */
  }
  return { handled, status: res.statusCode, text: res.body, json, headers: res.headers };
};

describe('body reads are abort-safe and bounded', () => {
  const aborted: Chunk[] = ['{"text":', new Error('aborted')];
  const cases: Array<[string, string, string, number]> = [
    ['chat', 'POST', `/api/orgs/${ORG}/chat`, 65536],
    ['copy', 'POST', `/api/orgs/${ORG}/copy`, 2097152],
    ['goals', 'POST', `/api/org/${ORG}/goals`, 2097152],
    ['routines', 'POST', `/api/org/${ORG}/routines`, 2097152],
    ['avatar', 'POST', `/api/org/${ORG}/agent/lead/avatar`, 8388608],
  ];
  for (const [name, method, url, max] of cases) {
    it(`${name}: an aborted upload answers 400 instead of throwing`, async () => {
      const r = await call(method, url, undefined, aborted);
      expect(r.handled).toBe(true);
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/not received/);
    });
    it(`${name}: an oversized body answers 413`, async () => {
      const r = await call(method, url, undefined, ['x'.repeat(max + 1)]);
      expect(r.status).toBe(413);
    });
  }
});

describe('human-session-only routes', () => {
  it('covers definition writes and destructive org routes, not reads', () => {
    for (const u of [
      '/api/orgs',
      '/api/orgs/acme',
      '/api/orgs/acme/import',
      '/api/orgs/acme/copy',
      '/api/org/acme/agent/lead/avatar',
    ])
      expect(_isHumanRoute(u), u).toBe(true);
    // stop / mark-complete stay token-only: the CLI and the stoporg skill call them.
    for (const u of [
      '/api/orgs/acme/stop',
      '/api/orgs/acme/mark-complete',
      '/api/orgs/acme/runs',
      '/api/org/acme/agents',
      '/api/org/acme/goals',
    ])
      expect(_isHumanRoute(u), u).toBe(false);
  });
});

describe('import / create', () => {
  it('import runs the full schema parse and refuses an invalid definition', async () => {
    const r = await call('POST', `/api/orgs/${ORG}/import`, goodDef({ roles: 'nope' }));
    expect(r.status).toBe(400);
    expect(existsSync(join(orgsDir(), `${ORG}.json`))).toBe(false);
  });

  it('create refuses a definition the schema rejects', async () => {
    const r = await call('POST', '/api/orgs', goodDef({ run_config: { budget_tokens: -5 } }));
    expect(r.status).toBe(400);
    expect(existsSync(join(orgsDir(), `${ORG}.json`))).toBe(false);
  });

  it('import writes atomically and reports the signature state without signing', async () => {
    const r = await call('POST', `/api/orgs/${ORG}/import`, goodDef());
    expect(r.status).toBe(200);
    expect(r.json.signature).toMatchObject({ state: 'unsigned' });
    expect(r.json.signature.notice).toContain(`monomind org sign ${ORG}`);
    expect(JSON.parse(readFileSync(join(orgsDir(), `${ORG}.json`), 'utf8')).goal).toBe('ship it');
    expect(readdirSync(orgsDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(join(operatorDir, 'org-signatures'))).toBe(false);
  });

  it('import and create refuse with 409 while the org runs', async () => {
    writeDef(goodDef());
    writeRuntime({ status: 'running', run: RUN, pid: process.pid });
    expect((await call('POST', `/api/orgs/${ORG}/import`, goodDef())).status).toBe(409);
    expect((await call('POST', '/api/orgs', goodDef())).status).toBe(409);
  });
});

describe('delete and copy', () => {
  it('delete refuses with 409 while the org runs, and removes a stale operator credential after', async () => {
    writeDef(goodDef());
    writeRuntime({ status: 'running', run: RUN, pid: process.pid });
    writeOperatorCredential(ORG, 'cred', operatorDir);
    expect((await call('DELETE', `/api/orgs/${ORG}`)).status).toBe(409);
    expect(existsSync(join(orgsDir(), `${ORG}.json`))).toBe(true);

    writeRuntime({ status: 'running', run: RUN, pid: 2 ** 22 + 12345 }); // crashed
    expect((await call('DELETE', `/api/orgs/${ORG}`)).status).toBe(200);
    expect(existsSync(join(orgsDir(), `${ORG}.json`))).toBe(false);
    expect(existsSync(join(operatorDir, `${ORG}.json`))).toBe(false);
  });

  it('copy writes atomically, answers with the destination signature state, 409 if it runs there', async () => {
    writeDef(goodDef());
    const dest = join(root, 'dest');
    const r = await call('POST', `/api/orgs/${ORG}/copy`, { destination: dest });
    expect(r.status).toBe(200);
    expect(r.json.signature.state).toBe('unsigned');
    expect(existsSync(join(dest, '.monomind', 'orgs', `${ORG}.json`))).toBe(true);
    mkdirSync(join(dest, '.monomind', 'orgs', ORG), { recursive: true });
    writeFileSync(
      join(dest, '.monomind', 'orgs', ORG, 'runtime.json'),
      JSON.stringify({ status: 'running', run: RUN, pid: process.pid }),
    );
    expect((await call('POST', `/api/orgs/${ORG}/copy`, { destination: dest })).status).toBe(409);
  });
});

describe('signature state on config writes', () => {
  it('config patch and avatar responses carry it', async () => {
    writeDef(goodDef());
    const c = await call('POST', `/api/org/${ORG}/config`, { goal: 'new goal' });
    expect(c.status).toBe(200);
    expect(c.json.signature.state).toBe('unsigned');
    const a = await call('POST', `/api/org/${ORG}/agent/lead/avatar`, {
      avatarDataUrl: 'data:image/png;base64,AAAA',
    });
    expect(a.status).toBe(200);
    expect(a.json.signature.notice).toContain(`monomind org sign ${ORG}`);
  });

  it('runtimeView surfaces it', async () => {
    writeDef(goodDef());
    const v = await rt.runtimeView(root, ORG);
    expect(v.signature).toMatchObject({ state: 'unsigned' });
  });
});

describe('running status', () => {
  const listOrg = async () => {
    const r = await call('GET', `/api/orgs?dir=${encodeURIComponent(root)}`);
    return r.json.find((o: any) => o.name === ORG);
  };

  it('a crashed run is not running even with a fresh runstate', async () => {
    writeDef(goodDef());
    writeRuntime({ status: 'running', run: RUN, pid: 2 ** 22 + 12345 });
    const fresh = { status: 'running', lastEventAt: Date.now() };
    const r = await call('GET', `/api/orgs?dir=${encodeURIComponent(root)}`, undefined, [], {
      _readRunState: () => fresh,
    });
    expect(r.json.find((o: any) => o.name === ORG).running).toBe(false);
  });

  it('a live recorded run is running without any dashboard event', async () => {
    writeDef(goodDef());
    writeRuntime({ status: 'running', run: RUN, pid: process.pid });
    expect((await listOrg()).running).toBe(true);
  });

  it('orgs without runtime.json keep the older rule', async () => {
    writeDef(goodDef());
    expect(rt.orgRunningState(root, ORG)).toBeNull();
    expect((await listOrg()).running).toBe(false);
  });
});

describe('run list status', () => {
  const bus = (run: string, events: Array<Record<string, unknown>>) => {
    mkdirSync(join(orgDir(), run), { recursive: true });
    writeFileSync(
      join(orgDir(), run, 'bus.jsonl'),
      events.map((e, i) => JSON.stringify({ id: `e${i}`, org: ORG, run, ...e })).join('\n'),
    );
  };
  const statuses = async () => {
    const r = await call('GET', `/api/org/${ORG}/runs?dir=${encodeURIComponent(root)}`);
    return Object.fromEntries(r.json.map((x: any) => [x.runId, x]));
  };

  it('a run history says was closed, or that is not the current run, is ended or stale, not running', async () => {
    writeDef(goodDef());
    const crashed = 'run-20260921090000-aaaa';
    const killed = 'run-20260921080000-bbbb';
    const live = 'run-20260921100000-cccc';
    for (const id of [crashed, killed, live]) bus(id, [{ ts: 100, type: 'status', from: 'lead' }]);
    writeFileSync(
      join(orgDir(), 'history.jsonl'),
      `${JSON.stringify({ run: killed, closedBy: 'stop-file' })}\n`,
    );
    writeRuntime({ status: 'running', run: live, pid: process.pid });
    const s = await statuses();
    expect(s[killed]).toMatchObject({ status: 'ended', closedBy: 'stop-file' });
    expect(s[crashed].status).toBe('stale');
    expect(s[live].status).toBe('running');
  });

  it('a crashed current run is stale', async () => {
    writeDef(goodDef());
    bus(RUN, [{ ts: 100, type: 'status', from: 'lead' }]);
    writeRuntime({ status: 'running', run: RUN, pid: 2 ** 22 + 12345 });
    const s = await statuses();
    expect(s[RUN].status).toBe('stale');
  });

  it('run detail is capped to a window and reports the total', async () => {
    writeDef(goodDef());
    bus(
      RUN,
      Array.from({ length: 10 }, (_, i) => ({
        ts: 100 + i,
        type: 'status',
        from: 'lead',
        msg: `m${i}`,
      })),
    );
    const r = await call(
      'GET',
      `/api/org/${ORG}/runs/${RUN}?dir=${encodeURIComponent(root)}&limit=3`,
    );
    expect(r.status).toBe(200);
    expect(r.headers['X-Total-Events']).toBe('10');
    expect(r.headers['X-Events-Offset']).toBe('7');
    const paged = await call(
      'GET',
      `/api/org/${ORG}/runs/${RUN}?dir=${encodeURIComponent(root)}&limit=2&offset=0`,
    );
    expect(paged.headers['X-Events-Offset']).toBe('0');
  });
});

describe('cost honesty', () => {
  const usage = (ts: number, from: string, cost: number | null) => ({
    ts,
    type: 'usage',
    from,
    data: {
      tokens: 10,
      tokens_in: 6,
      tokens_out: 4,
      cache_read: 0,
      cache_creation: 0,
      cost_usd: cost,
    },
  });
  const bus = (events: Array<Record<string, unknown>>) => {
    mkdirSync(join(orgDir(), RUN), { recursive: true });
    writeFileSync(
      join(orgDir(), RUN, 'bus.jsonl'),
      events.map((e, i) => JSON.stringify({ id: `e${i}`, org: ORG, run: RUN, ...e })).join('\n'),
    );
  };

  it('marks a role incomplete when any usage event had no cost, and the totals a lower bound', async () => {
    writeDef(goodDef({ roles: [{ id: 'lead' }, { id: 'dev', reports_to: 'lead' }] }));
    writeRuntime({ status: 'stopped', run: RUN });
    bus([usage(1, 'lead', 0.5), usage(2, 'lead', null), usage(3, 'dev', 0.25)]);
    const v = await rt.runtimeView(root, ORG);
    const lead = v.roles.find((r: any) => r.id === 'lead');
    const dev = v.roles.find((r: any) => r.id === 'dev');
    expect(lead.usage).toMatchObject({ cost_usd: 0.5, costComplete: false });
    expect(dev.usage.costComplete).toBe(true);
    expect(v.totals).toMatchObject({ cost_usd: 0.75, costComplete: false, costLowerBound: true });
  });

  it('a role that never reported a cost stays null, not 0', async () => {
    writeDef(goodDef());
    writeRuntime({ status: 'stopped', run: RUN });
    bus([usage(1, 'lead', null)]);
    const v = await rt.runtimeView(root, ORG);
    expect(v.totals.cost_usd).toBeNull();
    expect(v.totals.costLowerBound).toBe(false);
  });

  it('history passes costComplete through', () => {
    writeFileSync(
      join(orgDir(), 'history.jsonl'),
      `${JSON.stringify({ run: RUN, totalCostUsd: 1, costComplete: false })}\n`,
    );
    expect(rt.readRecentHistory(root, ORG)[0]).toMatchObject({
      totalCostUsd: 1,
      costComplete: false,
    });
  });

  it('the budgets payload keeps unknown cost null and flags a lower bound', async () => {
    writeDef(goodDef());
    mkdirSync(join(orgDir(), 'runs'), { recursive: true });
    writeFileSync(
      join(orgDir(), 'runs', 'r1.jsonl'),
      [
        { type: 'org:usage', from: 'lead', data: { tokens: 5, cost_usd: 0.5 } },
        { type: 'org:usage', from: 'lead', data: { tokens: 5, cost_usd: null } },
        { type: 'org:usage', from: 'dev', data: { tokens: 5 } },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n'),
    );
    writeFileSync(
      join(orgsDir(), `${ORG}-state.json`),
      JSON.stringify({ agents: { lead: { tokens_in: 0, tokens_out: 0 } } }),
    );
    const r = await call('GET', `/api/org/${ORG}/budgets?dir=${encodeURIComponent(root)}`);
    const byId = Object.fromEntries(r.json.agents.map((a: any) => [a.id, a]));
    expect(byId.lead).toMatchObject({ total_cost_usd: 0.5, cost_complete: false });
    expect(byId.dev.total_cost_usd).toBeNull();
    expect(r.json.cost_lower_bound).toBe(true);
  });
});

describe('server-mastermind-usage', () => {
  it('keeps a copy of an unparseable state file instead of silently resetting it', () => {
    const stateFile = join(orgsDir(), `${ORG}-state.json`);
    writeFileSync(stateFile, '{"agents": {"lead": {"tokens_in": 99');
    _accumulateAgentUsage(
      { type: 'agent:usage', role: 'lead', tokens_in: 1, tokens_out: 1, ts: 1 },
      root,
      ORG,
    );
    const backups = readdirSync(orgsDir()).filter((f) => f.includes('-state.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(orgsDir(), backups[0]), 'utf8')).toContain('"tokens_in": 99');
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).agents.lead.tokens_in).toBe(1);
    expect(readdirSync(orgsDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('adapters list', () => {
  it('lists the runtimes the registry has', async () => {
    writeDef(goodDef());
    const r = await call('GET', `/api/org/${ORG}/adapters?dir=${encodeURIComponent(root)}`);
    const types = r.json.adapters.map((a: any) => a.type);
    for (const t of ['freebuff', 'kilo', 'qwen-rpc', 'pi-rpc', 'hermes', 'cline', 'aider', 'dsh'])
      expect(types).toContain(t);
  });
});
