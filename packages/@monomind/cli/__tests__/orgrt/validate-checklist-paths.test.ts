// packages/@monomind/cli/__tests__/orgrt/validate-checklist-paths.test.ts
//
// The section 7.3 checklist runs on every path that saves or starts an org,
// with the same findings: `org validate`, daemon start, live reload, `org
// create` and the dashboard's config patch. A deferred feature is an error
// everywhere; advice is a warning that never blocks.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orgCommand } from '../../src/commands/org.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { ORG_DIR } from '../../src/orgrt/types.js';
import { EventEmitter } from 'node:events';
import { patchOrgConfig } from '../../src/ui/org-runtime.mjs';
import { handleOrgConfigRoutes } from '../../src/ui/routes-org-config.mjs';

const roles = [
  { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, responsibilities: ['Write self-contained briefs.'], adapter_config: { model: 'claude-opus-5' } },
  { id: 'w1', title: 'W1', type: 'specialist', reports_to: 'boss', adapter_config: { model: 'claude-sonnet-5' } },
  { id: 'w2', title: 'W2', type: 'specialist', reports_to: 'boss', adapter_config: { model: 'claude-sonnet-5' } },
];

function project(def: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'checklist-paths-'));
  mkdirSync(join(root, ORG_DIR), { recursive: true });
  writeFileSync(join(root, ORG_DIR, 'o.json'), JSON.stringify({ name: 'o', goal: 'g', autonomy: { level: 'full' }, roles, ...def }));
  return root;
}

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

const queryFn = (({ prompt }: any) =>
  (async function* () {
    for await (const _ of prompt) {
      /* idle */
    }
  })()) as never;

describe('org validate', () => {
  const validate = async (root: string) => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => void lines.push(String(s)));
    try {
      const res = await orgCommand.subcommands!.find((c) => c.name === 'validate')!.action!({
        args: ['o'], flags: {}, cwd: root, interactive: false,
      } as never);
      return { res, text: lines.join('\n') };
    } finally {
      spy.mockRestore();
    }
  };

  it('fails a definition that configures a deferred feature', async () => {
    const { res, text } = await validate(project({ sections: {} }));
    expect(res?.success).toBe(false);
    expect(text).toMatch(/"sections" is not yet supported/);
  });

  it('passes with a warning for advice, e.g. a role count above max_concurrent_agents', async () => {
    const { res, text } = await validate(project({ run_config: { max_concurrent_agents: 1 } }));
    expect(res?.success).toBe(true);
    expect(text).toMatch(/#3 .*max_concurrent_agents is 1 but the org has 3 roles/);
  });
});

describe('daemon start', () => {
  it('refuses an org that configures a deferred feature, before any role starts', async () => {
    const root = project({ loops: [] });
    daemon = new OrgDaemon(root, { queryFn, forward: false, stopWaitMs: 100 });
    await expect(daemon.startOrg('o')).rejects.toThrow(/"loops" is not yet supported/);
  });

  it('starts an org with advice and records the warnings on its bus', async () => {
    const root = project({ run_config: { max_concurrent_agents: 1 } });
    daemon = new OrgDaemon(root, { queryFn, forward: false, stopWaitMs: 100 });
    const running = await daemon.startOrg('o');
    const warned = running.busEvents().filter((e) => e.reason === 'checklist-warning');
    expect(warned.some((e) => /#3 /.test(String(e.msg)))).toBe(true);
  });
});

describe('live reload', () => {
  it('refuses a definition that configures a deferred feature and keeps the running one', async () => {
    const root = project({});
    daemon = new OrgDaemon(root, { queryFn, forward: false, stopWaitMs: 100 });
    const running = await daemon.startOrg('o');
    const path = join(root, ORG_DIR, 'o.json');
    const def = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...def, documents: {} }));
    expect(() => daemon!.reloadOrgDef('o')).toThrow(/"documents" is not yet supported/);
    expect((running.def as Record<string, unknown>).documents).toBeUndefined();
  });
});

describe('dashboard config patch', () => {
  it('refuses to save a definition that holds a deferred feature, even for an unrelated patch', () => {
    const root = project({ documents: {} });
    expect(() => patchOrgConfig(root, 'o', { goal: 'new goal' })).toThrow(/"documents" is not yet supported/);
  });

  it('still saves a clean definition', () => {
    const root = project({});
    expect(patchOrgConfig(root, 'o', { goal: 'new goal' }).goal).toBe('new goal');
  });
});

describe('org create', () => {
  it('runs the checklist on the definition it saves and reports its warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'checklist-create-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => void lines.push(String(s)));
    try {
      const res = await orgCommand.subcommands!.find((c) => c.name === 'create')!.action!({
        args: ['made'], flags: { template: 'dev-team' }, cwd: root, interactive: false,
      } as never);
      expect(res?.success).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(lines.join('\n')).toMatch(/#\d /);
  });
});

describe('dashboard import and create routes', () => {
  /** Drive a route handler with a fake request body and capture the response. */
  async function post(root: string, url: string, body: unknown) {
    const req = Object.assign(new EventEmitter(), { method: 'POST', url: `${url}?dir=${encodeURIComponent(root)}` });
    let status = 0;
    let out = '';
    const res = { writeHead: (s: number) => void (status = s), end: (s?: string) => void (out += s ?? '') };
    const done = handleOrgConfigRoutes(req, res, url, undefined, { projectDir: root });
    req.emit('data', JSON.stringify(body));
    req.emit('end');
    await done;
    return { status, out };
  }
  const def = { name: 'x', goal: 'g', autonomy: { level: 'full' }, roles };

  it('import refuses a definition that configures a deferred feature, and writes nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'checklist-import-'));
    const { status, out } = await post(root, '/api/orgs/imp/import', { ...def, sections: {} });
    expect(status).toBe(400);
    expect(JSON.parse(out).error).toMatch(/"sections" is not yet supported/);
    expect(() => readFileSync(join(root, ORG_DIR, 'imp.json'))).toThrow();
  });

  it('import saves a clean definition', async () => {
    const root = mkdtempSync(join(tmpdir(), 'checklist-import-'));
    const { status } = await post(root, '/api/orgs/imp/import', def);
    expect(status).toBe(200);
    expect(JSON.parse(readFileSync(join(root, ORG_DIR, 'imp.json'), 'utf8')).name).toBe('imp');
  });

  it('create refuses a definition that configures a deferred feature', async () => {
    const root = mkdtempSync(join(tmpdir(), 'checklist-create-route-'));
    const { status, out } = await post(root, '/api/orgs', { ...def, name: 'made', documents: {} });
    expect(status).toBe(400);
    expect(JSON.parse(out).error).toMatch(/"documents" is not yet supported/);
  });
});
