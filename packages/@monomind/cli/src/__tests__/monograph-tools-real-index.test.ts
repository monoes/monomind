/**
 * monograph_* tools exercised against a REAL built index.
 *
 * Why this file exists: `monograph-tools.ts` measured 13.4% statements but
 * only **5.66% branches**. Every existing test either checked tool shape or
 * ran against a missing database, so the only branch ever taken was the
 * `Monograph index not built yet` early return. The result-shaping code — the
 * part that actually answers a query — was untested.
 *
 * These tests build a small real repository, index it with tree-sitter, and
 * assert on real results. That is the only way to reach those branches.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MCPTool } from '../mcp-tools/types.js';

let repo: string;
let prevCwd: string | undefined;
let tools: MCPTool[];

const tool = (name: string): MCPTool => {
  const t = tools.find(x => x.name === name);
  if (!t) throw new Error(`tool not registered: ${name}`);
  return t;
};

/** Handlers return an MCP envelope; pull the text out of it. */
const textOf = async (name: string, input: Record<string, unknown> = {}): Promise<string> => {
  const r = (await tool(name).handler(input, undefined)) as { content?: Array<{ text?: string }> };
  return r?.content?.[0]?.text ?? JSON.stringify(r);
};

beforeAll(async () => {
  prevCwd = process.env.MONOMIND_CWD;
  repo = mkdtempSync(join(tmpdir(), 'mg-index-'));
  mkdirSync(join(repo, 'src'), { recursive: true });

  writeFileSync(join(repo, 'src/util.ts'), `export function helper(n: string): string { return \`hi \${n}\`; }\n`);
  writeFileSync(
    join(repo, 'src/service.ts'),
    `import { helper } from './util.js';\n` +
      `export class UserService {\n` +
      `  constructor(private readonly name: string) {}\n` +
      `  greet(): string { return helper(this.name); }\n` +
      `}\n` +
      `export function neverCalledAnywhere(): number { return 42; }\n`,
  );
  writeFileSync(
    join(repo, 'src/main.ts'),
    `import { UserService } from './service.js';\nconst s = new UserService('a');\nconsole.log(s.greet());\n`,
  );

  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');

  process.env.MONOMIND_CWD = repo;
  process.env.MONOGRAPH_MCP_ADVANCED = '1';
  ({ allMonographTools: tools } = await import('../mcp-tools/monograph-tools.js'));

  await tool('monograph_build').handler({ path: repo, codeOnly: true, force: true }, undefined);
}, 180_000);

afterAll(() => {
  if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = prevCwd;
  rmSync(repo, { recursive: true, force: true });
});

describe('monograph tools against a real index', () => {
  it('builds an index with nodes and edges', async () => {
    const out = await textOf('monograph_stats');
    const nodes = Number(/nodes:\s*(\d+)/.exec(out)?.[1] ?? 0);
    const edges = Number(/edges:\s*(\d+)/.exec(out)?.[1] ?? 0);
    expect(nodes).toBeGreaterThan(0);
    expect(edges).toBeGreaterThan(0);
  });

  it('query returns the symbol with its file and line', async () => {
    const out = await textOf('monograph_query', { query: 'UserService' });
    expect(out).toContain('UserService');
    expect(out).toMatch(/src\/service\.ts:\d+/);
  });

  it('get_node looks a symbol up by name via its `id` parameter', async () => {
    // The parameter is `id` and accepts either a node id or a name — passing
    // `name` here would silently look up `undefined`, which is what the
    // required-param guard in callMCPTool now rejects at the boundary.
    const out = await textOf('monograph_get_node', { id: 'UserService' });
    expect(out).toContain('UserService');
    expect(out).not.toContain('Node not found');
  });

  it('neighbors reports connected symbols', async () => {
    const out = await textOf('monograph_neighbors', { name: 'UserService' });
    expect(out).toMatch(/Neighbors:\s*[1-9]/);
  });

  it('impact reports a blast radius and a risk score', async () => {
    const out = await textOf('monograph_impact', { name: 'helper' });
    expect(out).toMatch(/Blast radius:\s*\d+/);
    expect(out).toMatch(/Risk score:/);
  });

  it('context resolves a symbol by its `name` parameter', async () => {
    const out = await textOf('monograph_context', { name: 'UserService' });
    expect(out).not.toContain('No symbol found');
  });

  it('god_nodes ranks by degree', async () => {
    const out = await textOf('monograph_god_nodes');
    expect(out).toMatch(/degree=\d+/);
  });

  it('health reports the index as fresh right after a build', async () => {
    expect(await textOf('monograph_health')).toContain('FRESH');
  });

  it('staleness reports zero commits behind right after a build', async () => {
    const out = JSON.parse(await textOf('monograph_staleness')) as { commitsBehind: number; status: string };
    expect(out.commitsBehind).toBe(0);
    expect(out.status).toBe('fresh');
  });

  it('dead_code returns all three categories', async () => {
    const out = JSON.parse(await textOf('monograph_dead_code')) as Record<string, { count: number }>;
    for (const cat of ['dead-functions', 'orphan-files', 'stale-dist']) {
      expect(out[cat]).toBeDefined();
      expect(typeof out[cat].count).toBe('number');
    }
  });
});

describe('CALLS edge attribution (L18)', () => {
  // The substantive assertions live in @monoes/monograph's own suite
  // (__tests__/integration/call-attribution.test.ts), because the behaviour is
  // the indexer's and this package resolves monograph from the registry rather
  // than the workspace — tests here would lag a publish.
  //
  // What is worth pinning at this level is that the CLI surfaces whatever the
  // installed indexer produces, without asserting which version that is.
  it('dead_code reports a numeric count for dead-functions', async () => {
    const out = JSON.parse(await textOf('monograph_dead_code')) as {
      'dead-functions': { count: number; candidates: Array<{ name: string }> };
    };
    expect(typeof out['dead-functions'].count).toBe('number');
    expect(Array.isArray(out['dead-functions'].candidates)).toBe(true);
    expect(out['dead-functions'].count).toBe(out['dead-functions'].candidates.length);
  });
});
