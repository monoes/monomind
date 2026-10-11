/**
 * Dashboard org design surface: the Config tab's patch allowlist and the
 * server-side validation it surfaces, the role editor's patch, the runtime
 * list in the adapters route, and the checklist (errors vs advice) and
 * signature state in the responses.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNNER_SPECS } from '../orgrt/runner-registry.js';
import { OrgDefSchema } from '../orgrt/types.js';
import * as rt from '../ui/org-runtime.mjs';
import { handleOrgRoutes } from '../ui/routes-org.mjs';
import { _isHumanRoute } from '../ui/server-auth.mjs';

const ORG = 'acme';
let root: string;
const saved: Record<string, string | undefined> = {};
const orgsDir = () => join(root, '.monomind', 'orgs');
const file = () => join(orgsDir(), `${ORG}.json`);
const onDisk = () => JSON.parse(readFileSync(file(), 'utf8'));
const goodDef = (extra: Record<string, unknown> = {}) => ({
  name: ORG,
  goal: 'ship it',
  schedule: null,
  run_config: {},
  roles: [
    { id: 'lead', title: 'Lead' },
    { id: 'dev', title: 'Dev', reports_to: 'lead' },
  ],
  ...extra,
});
const writeDef = (d: unknown) => writeFileSync(file(), JSON.stringify(d));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dash-design-'));
  for (const k of ['MONOMIND_ORGRT_BROKER_DIR', 'MONOMIND_ORGRT_OPERATOR_DIR'])
    saved[k] = process.env[k];
  process.env.MONOMIND_ORGRT_BROKER_DIR = join(root, 'broker');
  process.env.MONOMIND_ORGRT_OPERATOR_DIR = join(root, 'operator');
  mkdirSync(orgsDir(), { recursive: true });
  writeDef(goodDef());
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

const call = async (method: string, url: string, body?: unknown) => {
  const res: any = {
    statusCode: 0,
    body: '',
    headersSent: false,
    writeHead(c: number) {
      res.statusCode = c;
      res.headersSent = true;
    },
    end(c?: string) {
      if (c) res.body += c;
    },
  };
  const req: any = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
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
  };
  await handleOrgRoutes(req, res, url.split('?')[0], null, ctx);
  let json: any = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* non-JSON */
  }
  return { status: res.statusCode, json };
};

describe('Config patch: the newest run_config fields', () => {
  it('writes each one the runtime reads, and null removes it', () => {
    rt.patchOrgConfig(root, ORG, {
      runtime: 'codex',
      run_config: {
        max_tool_rounds: 25,
        verify_writes: false,
        lead_watch: { not_started_s: 60, silent_s: 120 },
        block_recheck_minutes: 2.5,
        notify_task_creator: true,
        bash_timeout_ms: 900000,
        session_idle_exit_ms: 30000,
      },
    });
    const d = onDisk();
    expect(d.runtime).toBe('codex');
    expect(d.run_config).toMatchObject({
      max_tool_rounds: 25,
      verify_writes: false,
      lead_watch: { not_started_s: 60, silent_s: 120 },
      block_recheck_minutes: 2.5,
      notify_task_creator: true,
      bash_timeout_ms: 900000,
      session_idle_exit_ms: 30000,
    });
    rt.patchOrgConfig(root, ORG, {
      runtime: null,
      run_config: { max_tool_rounds: null, lead_watch: false, verify_writes: null },
    });
    const after = onDisk();
    expect(after.runtime).toBeUndefined();
    expect(after.run_config.max_tool_rounds).toBeUndefined();
    expect(after.run_config.verify_writes).toBeUndefined();
    expect(after.run_config.lead_watch).toBe(false);
  });

  it('accepts exactly the allowlist: human-only and deferred keys are refused', () => {
    for (const k of [
      'allow_unattended_full_access',
      'accept_full_access_taint',
      'budget_usd',
      'budget_mode',
      'experimental',
      'max_role_respawns',
      'prechecks',
    ]) {
      expect(() => rt.patchOrgConfig(root, ORG, { run_config: { [k]: true } }), k).toThrow(
        `run_config.${k} is not editable here`,
      );
    }
    expect(onDisk().run_config).toEqual({});
  });

  it("surfaces the schema's own text for each bound", () => {
    const rejects: Array<[Record<string, unknown>, RegExp]> = [
      [{ max_tool_rounds: 500 }, /run_config\.max_tool_rounds/],
      [{ max_tool_rounds: 0 }, /run_config\.max_tool_rounds/],
      [{ block_recheck_minutes: 61 }, /run_config\.block_recheck_minutes/],
      [{ bash_timeout_ms: 7_200_000 }, /run_config\.bash_timeout_ms/],
      [{ session_idle_exit_ms: -1 }, /run_config\.session_idle_exit_ms/],
      [{ lead_watch: true }, /run_config\.lead_watch/],
      [{ lead_watch: { silent_s: 0 } }, /run_config\.lead_watch\.silent_s/],
      [{ verify_writes: 'yes' }, /run_config\.verify_writes/],
    ];
    for (const [rc, msg] of rejects)
      expect(() => rt.patchOrgConfig(root, ORG, { run_config: rc }), JSON.stringify(rc)).toThrow(
        msg,
      );
    expect(onDisk().run_config).toEqual({});
  });

  it('refuses an unknown runtime with the schema error', () => {
    expect(() => rt.patchOrgConfig(root, ORG, { runtime: 'gemini-local' })).toThrow(/runtime/);
    expect(onDisk().runtime).toBeUndefined();
  });
});

describe('Config patch: schedule', () => {
  it('accepts an interval or minutes and refuses cron, which the scheduler cannot run', () => {
    rt.patchOrgConfig(root, ORG, { schedule: '15m' });
    expect(onDisk().schedule).toBe('15m');
    rt.patchOrgConfig(root, ORG, { schedule: 30 });
    expect(onDisk().schedule).toBe(30);
    expect(() => rt.patchOrgConfig(root, ORG, { schedule: '*/5 * * * *' })).toThrow(
      /cron is not supported/,
    );
    expect(() => rt.patchOrgConfig(root, ORG, { schedule: 0 })).toThrow(/interval/);
    expect(onDisk().schedule).toBe(30);
  });

  it('does not fail an unrelated save on a schedule already on disk', () => {
    writeDef(goodDef({ schedule: '0 * * * *' }));
    rt.patchOrgConfig(root, ORG, { schedule: '0 * * * *', goal: 'g' });
    expect(onDisk().goal).toBe('g');
  });
});

describe('Config route: checklist and signature', () => {
  it('returns advice warnings without blocking, and the signature notice', async () => {
    const r = await call('POST', `/api/org/${ORG}/config`, { run_config: { max_tool_rounds: 12 } });
    expect(r.status).toBe(200);
    expect(r.json.warnings.some((w: string) => w.startsWith('#4'))).toBe(true);
    expect(r.json.signature.notice).toContain(`monomind org sign ${ORG}`);
    expect(onDisk().run_config.max_tool_rounds).toBe(12);
  });

  it('refuses a deferred feature with the checklist wording and writes nothing', async () => {
    writeDef(goodDef({ loops: [] }));
    const r = await call('POST', `/api/org/${ORG}/config`, { goal: 'x' });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('"loops"');
    expect(onDisk().goal).toBe('ship it');
  });

  it('a deferred run_config key cannot be set through the editor', async () => {
    const r = await call('POST', `/api/org/${ORG}/config`, { run_config: { budget_usd: 5 } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('run_config.budget_usd is not editable here');
  });

  it('runtimeView carries the checklist for the Config tab', async () => {
    writeDef(goodDef({ documents: {} }));
    const v = await rt.runtimeView(root, ORG);
    expect(v.checklist.errors.join(' ')).toContain('"documents" is not yet supported');
    expect(v.checklist.warnings.length).toBeGreaterThan(0);
  });
});

describe('import / create responses', () => {
  it('carry the advice warnings and the signature state', async () => {
    const r = await call('POST', `/api/orgs/${ORG}/import`, goodDef());
    expect(r.status).toBe(200);
    expect(r.json.warnings.some((w: string) => w.startsWith('#4'))).toBe(true);
    expect(r.json.signature.state).toBe('unsigned');
  });

  it('refuse a definition carrying a deferred feature, in the checklist wording', async () => {
    const r = await call('POST', '/api/orgs', goodDef({ name: 'other', requires: { x: 1 } }));
    // `requires` alone does not enable sections, so it stays deferred.
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('"requires" is not yet supported');
  });
});

describe('Role editor patch', () => {
  it('writes the runtime fields of one role and leaves the rest alone', async () => {
    const r = await call('POST', `/api/org/${ORG}/agent/dev/config`, {
      runtime: 'claude',
      model: 'claude-sonnet-5',
      max_tool_rounds: 30,
      max_turns_per_message: 50,
      budget_tokens: 200000,
      budget_usd: 1.5,
      session_scope: 'task',
      cost_tier: 'economy',
    });
    expect(r.status).toBe(200);
    expect(r.json.role).toMatchObject({ id: 'dev', runtime: 'claude', budget_usd: 1.5 });
    expect(r.json.signature.notice).toContain('org sign');
    const d = onDisk();
    expect(d.roles[1]).toMatchObject({
      reports_to: 'lead',
      adapter_config: { model: 'claude-sonnet-5' },
      max_tool_rounds: 30,
      session_scope: 'task',
    });
    expect(d.roles[0]).toEqual({ id: 'lead', title: 'Lead' });
    expect(d.cost_tiers.roles.dev).toBe('economy');
  });

  it('surfaces the cost-tier check when the tier has no model for the runtime', async () => {
    const r = await call('POST', `/api/org/${ORG}/agent/dev/config`, {
      runtime: 'opencode',
      cost_tier: 'economy',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('cost tier "economy" has no model for provider "opencode"');
    expect(onDisk().roles[1].runtime).toBeUndefined();
  });

  it('null removes a field, the model object and an emptied cost tier', async () => {
    await call('POST', `/api/org/${ORG}/agent/dev/config`, { model: 'm', cost_tier: 'economy' });
    const r = await call('POST', `/api/org/${ORG}/agent/dev/config`, {
      model: null,
      cost_tier: null,
    });
    expect(r.status).toBe(200);
    const d = onDisk();
    expect(d.roles[1].adapter_config).toBeUndefined();
    expect(d.cost_tiers).toBeUndefined();
  });

  it('keeps the effort override of an object cost-tier entry', () => {
    writeDef(goodDef({ cost_tiers: { roles: { dev: { tier: 'economy', effort: 'low' } } } }));
    rt.patchOrgRole(root, ORG, 'dev', { cost_tier: 'budget' });
    expect(onDisk().cost_tiers.roles.dev).toEqual({ tier: 'budget', effort: 'low' });
  });

  it('refuses fields the editor does not own, and names them', async () => {
    for (const k of ['policy', 'tool_providers', 'skills', 'provider', 'endpoint', 'id']) {
      const r = await call('POST', `/api/org/${ORG}/agent/dev/config`, { [k]: {} });
      expect(r.status, k).toBe(400);
      expect(r.json.error).toBe(`role field ${k} is not editable here`);
    }
    expect(onDisk().roles[1]).toEqual({ id: 'dev', title: 'Dev', reports_to: 'lead' });
  });

  it("surfaces the schema's text for a bad value and for a conflicting pair", async () => {
    let r = await call('POST', `/api/org/${ORG}/agent/dev/config`, { max_tool_rounds: 999 });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/max_tool_rounds/);
    r = await call('POST', `/api/org/${ORG}/agent/dev/config`, { runtime: 'nope' });
    expect(r.status).toBe(400);
    r = await call('POST', `/api/org/${ORG}/agent/dev/config`, {
      deliberative: true,
      review_input: 'artifact-only',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('is deliberative, so it cannot be an artifact-only reviewer');
    expect(onDisk().roles[1].deliberative).toBeUndefined();
  });

  it('refuses a session setting on an endpoint role, and an unknown role', async () => {
    writeDef(
      goodDef({
        roles: [
          { id: 'lead', title: 'Lead' },
          { id: 'hook', kind: 'endpoint', endpoint: { url: 'https://example.com/x' } },
        ],
      }),
    );
    let r = await call('POST', `/api/org/${ORG}/agent/hook/config`, { runtime: 'claude' });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('endpoint role "hook"');
    r = await call('POST', `/api/org/${ORG}/agent/ghost/config`, { max_tool_rounds: 3 });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('role "ghost" not found');
  });

  it('is a human-session route, like the other definition writes', () => {
    expect(_isHumanRoute(`/api/org/${ORG}/agent/dev/config`)).toBe(true);
    expect(_isHumanRoute(`/api/org/${ORG}/agent/dev`)).toBe(false);
  });
});

describe('adapters list', () => {
  it('has one entry per registry runtime, each a valid role runtime, freebuff disabled', async () => {
    const r = await call('GET', `/api/org/${ORG}/adapters?dir=${encodeURIComponent(root)}`);
    const types = r.json.adapters.map((a: any) => a.type);
    expect(types).toEqual(RUNNER_SPECS.map((s) => s.id));
    const probe = OrgDefSchema.shape.runtime;
    for (const t of types) expect(probe.safeParse(t).success, t).toBe(true);
    const freebuff = r.json.adapters.find((a: any) => a.type === 'freebuff');
    expect(freebuff.disabled).toBe(true);
    expect(freebuff.disabledReason).toBeTruthy();
    expect(r.json.adapters.find((a: any) => a.type === 'claude').disabled).toBe(false);
  });
});

describe('org design review follow-ups', () => {
  const ui = (f: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ui', f), 'utf-8');

  it('a fractional-minute schedule survives the config form, and odd types give 400 not 500', async () => {
    expect(ui('dashboard.html')).toContain('/^\\d+(\\.\\d+)?$/.test(v) ? Number(v) : v');
    expect(ui('org-config-patch.mjs')).toMatch(/typeof v !== 'string' && typeof v !== 'number'/);
  });

  it('runtime selects never post a blank placeholder before the adapter list loads', () => {
    const html = ui('dashboard.html');
    expect(html).toContain('<option value="${esc(role.runtime || \'\')}">');
    expect(html).toContain('<option value="${esc(d.runtime || \'\')}">');
  });

  it('a saved role replaces the cached role instead of merging stale keys', () => {
    expect(ui('dashboard.html')).toContain('roles[i] = json.role;');
  });

  it('the adapters file branch serves the registry list, not the file entries', () => {
    expect(ui('routes-org-agents.mjs')).toContain('adapters: _runtimeAdapters()');
  });
});
