/**
 * guidance_capabilities / guidance_workflow only recommend agents that exist,
 * and guidance_recommend's agents come from the central picker: every name is
 * a bundled agent's frontmatter `name`, the spawnable Task subagent_type.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guidanceTools } from '../mcp-tools/guidance-tools.js';

function agentNames(dir: string, out = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) agentNames(f, out);
    else if (e.name.endsWith('.md')) {
      const n = readFileSync(f, 'utf8')
        .match(/^---\n([\s\S]*?)\n---/)?.[1]
        .match(/^name:\s*(.+)$/m)?.[1]
        .trim();
      if (n) out.add(n);
    }
  }
  return out;
}
const NAMES = agentNames(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'agents'),
);

const tool = (name: string) => {
  const t = guidanceTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing ${name}`);
  return t;
};
async function json(name: string, input: Record<string, unknown>) {
  const res = (await tool(name).handler(input)) as { content: { text: string }[] };
  return JSON.parse(res.content[0].text);
}

describe('guidance recommends real agents only', () => {
  it('every capability area', async () => {
    const catalog = (await json('guidance_capabilities', { format: 'detailed' })) as Record<
      string,
      { agents: string[] }
    >;
    const agents = Object.values(catalog).flatMap((a) => a.agents);
    expect(agents.length).toBeGreaterThan(10);
    expect(agents.filter((a) => !NAMES.has(a))).toEqual([]);
  });

  it('every workflow template', async () => {
    const schema = tool('guidance_workflow').inputSchema.properties.type as { enum: string[] };
    const unknown: string[] = [];
    for (const type of schema.enum) {
      const wf = (await json('guidance_workflow', { type })) as { agents?: string[] };
      unknown.push(...(wf.agents ?? []).filter((a) => !NAMES.has(a)));
    }
    expect(unknown).toEqual([]);
  });
});

describe('guidance_recommend picks agents with the central picker', () => {
  // The keyword ranking decides; no decision model in tests.
  beforeEach(() => vi.stubEnv('MONOMIND_JEV', 'off'));
  afterEach(() => vi.unstubAllEnvs());

  it('ranks registry agents for the task, beside the capability guidance', async () => {
    const res = await json('guidance_recommend', {
      task: 'fix a security vulnerability in the login handler',
    });
    expect(res.recommendations.length).toBeGreaterThan(0);
    expect(res.recommendations.every((r: object) => !('agents' in r))).toBe(true);
    expect(res.agents.length).toBeGreaterThan(0);
    expect(res.agents.map((a: { name: string }) => a.name).filter((n: string) => !NAMES.has(n))).toEqual(
      [],
    );
  });

  it('still names an agent when no capability pattern matches', async () => {
    const res = await json('guidance_recommend', { task: 'set up a zettelkasten for my notes' });
    expect(res.suggestions).toBeDefined();
    expect(res.agents[0]).toMatchObject({ name: 'ZK Steward' });
  });
});
