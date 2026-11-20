/**
 * The standalone /orgs and /mastermind pages were retired: their tabs live in
 * the dashboard's Orgs view now (Roles, Activity, Health). Their page routes,
 * and the routes only those pages called (/api/data, /api/org-coverage,
 * /api/orgs/:n/history), answer 404 like any unknown URL.
 *
 * GET /api/orgs/:n/memory stays (the Health tab reads it) and now reads the
 * store the runtime writes, <root>/.monomind/org-memory (orgrt/org-memory.ts
 * orgMemoryDbPath), scoped to the one org; it used to read the shared git
 * dir's monomind/org-memory, which nothing writes, unscoped.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const kgCalls: Array<{ fn: string; opts: any }> = [];
vi.mock('../src/memory/memory-kg.js', () => ({
  kgStats: async (opts: any) => {
    kgCalls.push({ fn: 'kgStats', opts });
    return { nodes: 3, edges: 2, rules: 1 };
  },
  kgGlossary: async (opts: any) => {
    kgCalls.push({ fn: 'kgGlossary', opts });
    return ['Alpha'];
  },
  kgListRules: async (opts: any) => {
    kgCalls.push({ fn: 'kgListRules', opts });
    return [{ rule: 'ship small', key: 'r1' }];
  },
}));

// @ts-expect-error — .mjs sibling has no type declarations
import * as uiServer from '../src/ui/server.mjs';
import { loggedInPage } from './helpers/dashboard-login.js';

const { startServer } = uiServer as any;
const CRED_RE = /mm-token" content="([a-f0-9]+)"/;
const prevHome = process.env.HOME;
let httpServer: any = null;
let baseUrl = '';
let cred = '';
let cookie = '';
let projectDir = '';

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'mm-retired-pages-'));
  projectDir = join(root, 'proj');
  // A git repo: the old memory route resolved .git/monomind/org-memory here.
  mkdirSync(join(projectDir, '.git', 'monomind', 'org-memory'), { recursive: true });
  mkdirSync(join(projectDir, '.monomind', 'orgs'), { recursive: true });
  writeFileSync(join(projectDir, '.monomind', 'orgs', 'alpha.json'), JSON.stringify({ name: 'alpha', roles: [] }));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'retired-pages-home-'));
  const res = await startServer({ port: 0, projectDir, openBrowser: false });
  httpServer = res.server;
  baseUrl = `http://127.0.0.1:${res.port}`;
  const page = await loggedInPage(baseUrl);
  cookie = page.cookie;
  cred = (page.html.match(CRED_RE) || [])[1] || '';
}, 60_000);

afterAll(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  try {
    httpServer?.closeAllConnections?.();
    httpServer?.close();
  } catch {
    /* best effort */
  }
});

const get = (path: string) =>
  fetch(`${baseUrl}${path}`, { headers: { cookie, 'x-monomind-token': cred } });

describe('retired dashboard pages', () => {
  it('logs in and has the token (so a 404 below is not an auth refusal)', () => {
    expect(cred).toMatch(/^[a-f0-9]+$/);
  });

  it.each(['/orgs', '/orgs-files.js', '/mastermind'])('GET %s is 404 for a logged-in browser', async (path) => {
    const r = await get(path);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toMatch(CRED_RE);
  });

  it.each(['/orgs', '/orgs-files.js', '/mastermind'])('GET %s never serves the token without a session', async (path) => {
    const r = await fetch(`${baseUrl}${path}`);
    expect(r.status).not.toBe(200);
    expect(await r.text()).not.toMatch(CRED_RE);
  });

  it.each(['/api/data', '/api/org-coverage', '/api/orgs/alpha/history'])(
    'GET %s (only the retired pages called it) is 404',
    async (path) => {
      expect((await get(path)).status).toBe(404);
    },
  );

  it('the dashboard page still loads', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('id="org-detail-tabs"');
  });
});

describe('GET /api/orgs/:name/memory', () => {
  it('reads nothing when only the shared git dir has an org-memory store', async () => {
    kgCalls.length = 0;
    const r = await get(`/api/orgs/alpha/memory?dir=${encodeURIComponent(projectDir)}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ nodes: 0, edges: 0, rules: 0, glossary: [], ruleTexts: [] });
    expect(kgCalls).toEqual([]);
  });

  it("reads <root>/.monomind/org-memory, scoped to the requested org", async () => {
    mkdirSync(join(projectDir, '.monomind', 'org-memory'), { recursive: true });
    kgCalls.length = 0;
    const r = await get(`/api/orgs/alpha/memory?dir=${encodeURIComponent(projectDir)}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ nodes: 3, edges: 2, rules: 1, glossary: ['Alpha'], ruleTexts: ['ship small'] });
    expect(kgCalls.map((c) => c.fn).sort()).toEqual(['kgGlossary', 'kgListRules', 'kgStats']);
    for (const c of kgCalls) {
      expect(c.opts.dbPath).toBe(join(projectDir, '.monomind', 'org-memory'));
      expect(c.opts.scope).toEqual({ org: 'alpha' });
    }
  });
});
