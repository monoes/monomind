/**
 * MCP knowledge surface parity with the CLI.
 *
 * Agents are the Second Brain's primary consumer, but the MCP surface was
 * add-only and store-blind:
 *
 * 1. No `knowledge_remove` — an agent could ingest a wrong document and never
 *    retract it, while `monomind doc remove` could.
 * 2. `knowledge_search` had no `store` param, so an agent could not say
 *    "only my personal brain" / "only this project" the way
 *    `doc search --store project|global|all` has since the global brain landed.
 *
 * Runs against a throwaway store: chdir into a temp dir plus
 * MONOMIND_GLOBAL_BRAIN_DIR, so the user's real Second Brain is never touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import type { MCPTool, MCPToolResult } from '../mcp-tools/types.js';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;
const ORIGINAL_MM_CWD = process.env.MONOMIND_CWD;
let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-kn-parity-'));
  fs.mkdirSync(join(ROOT, '.monomind'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  delete process.env.MONOMIND_CWD;
  process.chdir(ROOT);
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  if (ORIGINAL_MM_CWD !== undefined) process.env.MONOMIND_CWD = ORIGINAL_MM_CWD;
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

const tool = async (name: string): Promise<MCPTool> => {
  const { knowledgeTools } = await import('../mcp-tools/knowledge-tools.js');
  const t = knowledgeTools.find(x => x.name === name);
  if (!t) throw new Error(`${name} is not registered in knowledgeTools`);
  return t;
};

const call = async (name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const result = await (await tool(name)).handler(input) as MCPToolResult;
  return JSON.parse(String(result.content[0].text));
};

describe('knowledge_search store selection', () => {
  it('advertises the store parameter', async () => {
    const props = (await tool('knowledge_search')).inputSchema.properties as Record<string, { description?: string }>;
    expect(props.store).toBeDefined();
    expect(String(props.store.description)).toMatch(/global/);
  });

  it('echoes the resolved store back in routing', async () => {
    const res = await call('knowledge_search', { query: 'widget calibration', store: 'global' });
    expect(res.success).toBe(true);
    expect((res.routing as { store: string }).store).toBe('global');
  });

  it('falls back to all for an unrecognised store instead of erroring', async () => {
    const res = await call('knowledge_search', { query: 'widget calibration', store: 'nonsense' });
    expect(res.success).toBe(true);
    expect((res.routing as { store: string }).store).toBe('all');
  });

  it('defaults to all when store is omitted', async () => {
    const res = await call('knowledge_search', { query: 'widget calibration' });
    expect((res.routing as { store: string }).store).toBe('all');
  });
});

describe('knowledge_remove', () => {
  const doc = () => join(ROOT, 'removable.md');

  it('is registered alongside ingest and search', async () => {
    const { knowledgeTools } = await import('../mcp-tools/knowledge-tools.js');
    expect(knowledgeTools.map(t => t.name).sort())
      .toEqual(['knowledge_ingest', 'knowledge_remove', 'knowledge_search']);
  });

  it('errors on a path that is not indexed, rather than reporting success', async () => {
    const res = await call('knowledge_remove', { path: join(ROOT, 'never-there.md') });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/Not indexed/);
  });

  it('forgets a document that knowledge_ingest added', async () => {
    const { listDocuments } = await import('../knowledge/document-pipeline.js');
    fs.writeFileSync(doc(), 'Sprocket tolerance table, revision four.\n');

    const ingested = await call('knowledge_ingest', { path: doc() });
    expect(ingested.success).toBe(true);
    expect(listDocuments(ROOT, 'shared').map(d => d.filePath)).toContain(doc());

    const removed = await call('knowledge_remove', { path: doc() });
    expect(removed.success).toBe(true);
    expect(removed.store).toBe('project');
    expect(listDocuments(ROOT, 'shared').map(d => d.filePath)).not.toContain(doc());
  });

  it('reports the scope it searched when the path is indexed under a different one', async () => {
    fs.writeFileSync(doc(), 'Sprocket tolerance table, revision five.\n');
    await call('knowledge_ingest', { path: doc() });
    const res = await call('knowledge_remove', { path: doc(), scope: 'other-scope' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/other-scope/);
  });
});
