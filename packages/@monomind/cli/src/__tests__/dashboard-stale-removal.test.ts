/**
 * Dashboard cleanup: unreachable UI code (the Playbook/Workflow builder, the
 * Monograph Query tab, the memory "palace" leftovers) and the server routes
 * nothing calls are gone, and the relabeled UI says what its data is.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dispatchRequest } from '../ui/server-dispatch.mjs';
import { dashboardScript, loadPageFunctions, UI_DIR } from './dashboard-script';

const html = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dash-stale-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fakeReq(method: string, url: string) {
  return { method, url, headers: { host: 'localhost' }, on() {}, socket: {} };
}
function fakeRes() {
  return {
    status: 0,
    headersSent: false,
    writeHead(code: number) {
      this.status = code;
      this.headersSent = true;
    },
    setHeader() {},
    write() {},
    end() {},
    on() {},
  };
}
async function dispatch(method: string, url: string) {
  const res = fakeRes();
  const handled = await dispatchRequest(fakeReq(method, url), res, url.split('?')[0], null, {
    projectDir: root,
    __dirname: UI_DIR,
    activeOrgRuns: new Map(),
    buildDocsState: new Map(),
  });
  return { handled, status: res.status };
}

describe('removed routes fall through to the 404 handler', () => {
  const removed: Array<[string, string]> = [
    ['GET', '/api/recent-events'],
    ['GET', '/api/palace'],
    ['POST', '/api/ua-enrich'],
    ['GET', '/api/monograph-content'],
    ['GET', '/api/monograph-fts'],
    ['GET', '/api/monograph-related'],
    ['GET', '/api/monograph-ai-context'],
    ['GET', '/api/monograph-benchmark'],
    ['GET', '/api/monograph'],
    ['GET', '/api/monograph-query'],
    ['GET', '/api/monograph-path'],
    ['GET', '/api/org/acme/search'],
    ['GET', '/api/org/acme/plugins'],
    ['GET', '/api/org/acme/threads'],
    ['GET', '/api/questions'],
    ['GET', '/api/mastermind/loops'],
    ['GET', '/api/mastermind/metrics'],
    ['GET', '/api/playbooks'],
    ['POST', '/api/playbooks'],
    ['GET', '/api/workflow-defs'],
    ['GET', '/api/workflow-runs'],
  ];
  it.each(removed)('%s %s is not dispatched', async (method, url) => {
    expect(await dispatch(method, url)).toEqual({ handled: false, status: 0 });
  });

  it('kept neighbours still dispatch', async () => {
    expect((await dispatch('GET', `/api/hil?dir=${encodeURIComponent(root)}`)).handled).toBe(true);
    expect(
      (await dispatch('GET', `/api/org-coverage?dir=${encodeURIComponent(root)}`)).status,
    ).toBe(404);
    expect(
      (await dispatch('GET', `/api/monograph-explain?dir=${encodeURIComponent(root)}`)).handled,
    ).toBe(true);
  });

  it('the monograph content route file is gone from the source and the build copy lists', () => {
    expect(existsSync(join(UI_DIR, 'routes-monograph-content.mjs'))).toBe(false);
    const pkg = readFileSync(join(UI_DIR, '..', '..', 'package.json'), 'utf-8');
    expect(pkg).not.toContain('routes-monograph-content');
  });

  it('mcp/call part 2 no longer carries the branches part 1 always answers first', () => {
    const part2 = readFileSync(join(UI_DIR, 'server-routes-mcp-tools-2.mjs'), 'utf-8');
    expect(part2).not.toContain("'monograph_reachability'");
    expect(part2).not.toContain("'monograph_vital_signs_snapshot'");
    const part1 = readFileSync(join(UI_DIR, 'server-routes-mcp-tools-1.mjs'), 'utf-8');
    expect(part1).toContain("tool === 'monograph_reachability'");
    expect(part1).toContain("tool === 'monograph_vital_signs_snapshot'");
  });
});

describe('unreachable dashboard code is gone', () => {
  it('the Playbook/Workflow builder and its styles', () => {
    for (const name of [
      '_wfSwitchTab',
      'loadWorkflowDefs',
      'pbInit',
      '_pbRun',
      'PB_NODE_DEFS',
      'PB_BROWSE_HTTP',
    ])
      expect(dashboardScript).not.toMatch(new RegExp(`\\b${name}\\b`));
    expect(html).not.toMatch(/\/api\/(playbooks|workflow-defs|workflow-runs)/);
    expect(html).not.toMatch(/^\s*[.#](wf|pb)-[\w-]+/m);
  });

  it('the Monograph Query tab', () => {
    expect(dashboardScript).not.toMatch(/_mgQuery\w+/);
    expect(html).not.toContain('mg-q-');
    expect(html).not.toMatch(/\/api\/monograph-(query|path)\b/);
  });

  it('the memory drawer/palace leftovers', () => {
    for (const name of [
      'filterMemory',
      '_filterMemoryNs',
      'activeMemNs',
      'allDrawers',
      'memMatches',
    ])
      expect(dashboardScript).not.toMatch(new RegExp(`\\b${name}\\b`));
    expect(dashboardScript).not.toContain("type: 'memory'");
    expect(html).not.toMatch(/\.(drawer-item|ns-tab|dr-key)\b/);
    expect(html).not.toContain('Knowledge palace');
    expect(html).toContain('placeholder="Search sessions, projects, orgs, skills…"');
  });
});

describe('relabeled UI', () => {
  it('names the data it shows', () => {
    expect(html).not.toContain('AgentDB');
    expect(html).toContain(
      'title="Stored in .monomind/data/auto-memory-store.json, not as a memory file"',
    );
    expect(html).not.toContain('best swarm');
    expect(html).toContain('Intent router — picks the right command, skill or org for a request');
    expect(html).not.toContain('Routing Intelligence');
    expect(html).toContain('>Agent Routing<');
    expect(html).toContain('>Last routed agent<');
  });

  it('the Chunks tab points at what writes chunks.jsonl, not a command that does not exist', () => {
    expect(html).not.toContain('/monomind:understand');
    expect(html.match(/Chunks are written at session start from CLAUDE\.md/g)).toHaveLength(2);
  });

  it('every built-in avatar id has an image', () => {
    const set =
      /const _v2AvatarKnown = new Set\(\[([\s\S]*?)\]\);/.exec(dashboardScript)?.[1] ?? '';
    const ids = [...set.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(100);
    const files = new Set(readdirSync(join(UI_DIR, 'data', 'avatars')));
    expect(ids.filter((id) => !files.has(`${id}.svg`))).toEqual([]);
  });
});

describe('Mastermind › Create Org builds only /mastermind:createorg input', () => {
  function generate(fields: Record<string, string>) {
    const out = { textContent: '', style: { display: 'none' } };
    const els: Record<string, unknown> = { 'mco-cmd-out': out };
    for (const [k, v] of Object.entries(fields)) els[`mco-${k}`] = { value: v };
    const ctx = loadPageFunctions(dashboardScript, ['_mmGenerateOrgCmd'], {
      document: { getElementById: (id: string) => els[id] ?? null },
    });
    ctx._mmGenerateOrgCmd();
    return out.textContent;
  }

  it('emits a goal with the supported flags', () => {
    expect(
      generate({
        goal: 'Weekly competitor report',
        name: 'research-pod',
        roles: 'boss, "lead" analyst',
        schedule: '2 h',
      }),
    ).toBe(
      '/mastermind:createorg --name research-pod --roles "boss, \\"lead\\" analyst" --schedule 2h Weekly competitor report',
    );
    expect(generate({ goal: 'Ship features' })).toBe('/mastermind:createorg Ship features');
  });

  it('rejects input the command would not accept', () => {
    expect(generate({ goal: '' })).toMatch(/^Enter a goal/);
    expect(generate({ goal: 'x', name: 'Bad Name' })).toMatch(/^Org name:/);
    expect(generate({ goal: 'x', schedule: 'daily' })).toMatch(/^Schedule:/);
  });

  it('no longer offers swarm-era options', () => {
    expect(html).not.toMatch(/--topology|--adapter|--max-agents|mco-topo|mco-adapter|mco-agents/);
  });
});
