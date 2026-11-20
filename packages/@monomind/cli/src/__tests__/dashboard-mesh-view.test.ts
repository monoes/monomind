/**
 * Mesh view: the agents on this host's Monomind Mesh, read-only
 * (routes-mesh.mjs + dashboard.html's Mesh view).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MeshOfflineError } from '../mesh/client.js';
import { handleMeshRoutes } from '../ui/routes-mesh.mjs';
import { dashboardScript, loadPageFunctions, UI_DIR } from './dashboard-script.js';

const HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
const ROUTE_SRC = readFileSync(join(UI_DIR, 'routes-mesh.mjs'), 'utf-8');

function call(reqUrl: string, meshCall: (r: Record<string, unknown>) => Promise<unknown>) {
  const out: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    writeHead: (s: number) => {
      out.status = s;
    },
    end: (b: string) => {
      out.body = JSON.parse(b);
    },
  };
  const deps = { meshCall, MeshOfflineError, projectIdFor: (p: string) => `id(${p})` };
  return handleMeshRoutes(
    { method: 'GET', url: reqUrl } as never,
    res as never,
    '/api/mesh/agents',
    '',
    { projectDir: '/served' },
    deps,
  ).then(() => out);
}

describe('GET /api/mesh/agents', () => {
  it('asks the hub who is on the mesh for the served project', async () => {
    const seen: Record<string, unknown>[] = [];
    const out = await call('/api/mesh/agents', async (r) => {
      seen.push(r);
      return { ok: true, agents: [{ addr: 'h/p/s', status: 'active' }], truncated: false };
    });
    expect(seen).toEqual([{ op: 'who', id: expect.any(String), project: 'id(/served)' }]);
    expect(out.body).toMatchObject({ online: true, scope: 'project', agents: [{ addr: 'h/p/s' }] });
  });

  it('scope=all lists every project', async () => {
    const seen: Record<string, unknown>[] = [];
    await call('/api/mesh/agents?scope=all', async (r) => {
      seen.push(r);
      return { ok: true, agents: [] };
    });
    expect(seen[0]).not.toHaveProperty('project');
  });

  it('reports a hub that is not running instead of starting one', async () => {
    const out = await call('/api/mesh/agents', async () => {
      throw new MeshOfflineError();
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ online: false, scope: 'project', agents: [] });
  });

  it('never joins, sends, reads an inbox or spawns a hub', () => {
    expect(ROUTE_SRC).not.toMatch(/callWithHub|joinManaged|spawn|'hello'|'send'|'inbox'/);
  });
});

describe('Mesh view', () => {
  it('has a nav item, a view and a render branch', () => {
    expect(HTML).toContain('<div class="nav-item" data-view="mesh"');
    expect(HTML).toContain('<div class="view" id="view-mesh">');
    expect(dashboardScript).toContain("if (v === 'mesh') loadMeshView();");
    expect(dashboardScript).toContain('meshSetScope: _meshSetScope,');
  });

  function page(scope = 'project') {
    const els: Record<string, Record<string, unknown>> = {
      'mesh-content': { innerHTML: '' },
      'bdg-mesh': { textContent: '' },
    };
    const ctx = loadPageFunctions(
      dashboardScript,
      ['renderMesh', 'meshRowHtml', 'esc', '_hiPill', 'relTime'],
      {
        _meshScope: scope,
        MESH_STATUS_COLOR: {},
        document: { getElementById: (id: string) => els[id] },
      },
    );
    return { ctx, els };
  }

  it('explains an offline hub', () => {
    const { ctx, els } = page();
    ctx.renderMesh({ online: false, agents: [] });
    expect(String(els['mesh-content'].innerHTML)).toContain('No mesh hub is running');
  });

  it('lists agents with escaped fields and counts the active ones', () => {
    const { ctx, els } = page('all');
    ctx.renderMesh({
      online: true,
      agents: [
        {
          addr: 'h/p/s1',
          alias: '<coder>',
          tier: 'session',
          status: 'active',
          runtime: 'claude',
          projectPath: '/a',
          task: 'x & y',
          lastSeen: Date.now(),
        },
        { addr: 'h/p/s2', tier: 'external', status: 'stale', runtime: 'cli', projectPath: '/b' },
      ],
    });
    const html = String(els['mesh-content'].innerHTML);
    expect(html).toContain('&lt;coder&gt;');
    expect(html).toContain('x &amp; y');
    expect(html).toContain('<th>Project</th>');
    expect(els['bdg-mesh'].textContent).toBe(1);
  });

  it('shows the project column only for all projects', () => {
    const { ctx, els } = page('project');
    ctx.renderMesh({ online: true, agents: [{ addr: 'a', status: 'active' }] });
    expect(String(els['mesh-content'].innerHTML)).not.toContain('<th>Project</th>');
  });
});
