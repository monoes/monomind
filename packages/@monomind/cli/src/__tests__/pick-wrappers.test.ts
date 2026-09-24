/**
 * hooks_route, hooks_pre-task, hooks_explain, `route task` and the monovector
 * keyword router are thin wrappers over the central picker (pickAgents →
 * rankForTask): whatever it ranks first is what each of them returns.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pickAgents = vi.fn();
const recordRoute = vi.fn(async () => {});
const agentCatalog = vi.fn();

vi.mock('../routing/agent-pick.js', () => ({ pickAgents }));
vi.mock('../monovector/route-outcomes.js', async (orig) => ({
  ...(await orig<typeof import('../monovector/route-outcomes.js')>()),
  recordRoute,
}));
vi.mock('../decision/catalogs.js', () => ({ agentCatalog }));
vi.mock('../mcp-tools/hooks-embedding.js', async (orig) => ({
  ...(await orig<typeof import('../mcp-tools/hooks-embedding.js')>()),
  getRealSearchFunction: async () => null,
}));

const { hooksExplain, hooksPreEdit, hooksPreTask, hooksRoute } = await import(
  '../mcp-tools/hooks-routing.js'
);
const { AGENT_PATTERNS, suggestAgentsForFile } = await import('../mcp-tools/hooks-embedding.js');
const { suggestAgentsForFile: coverageAgentsForFile } = await import(
  '../commands/hooks-coverage-utils.js'
);
const { createKeywordRouter } = await import('../monovector/index.js');
const { assignAgent } = await import('../monovector/coverage-router.js');
const { routeCommand } = await import('../commands/route.js');

const PICK = {
  method: 'keyword',
  agents: [
    { type: 'Security Engineer', confidence: 0.75, reason: 'r1' },
    { type: 'coder', confidence: 0.55, reason: 'r2' },
    { type: 'Code Reviewer', confidence: 0.45, reason: 'r3' },
  ],
};

beforeEach(() => {
  pickAgents.mockReset().mockResolvedValue(PICK);
  recordRoute.mockClear();
  agentCatalog.mockReset().mockReturnValue([
    { id: 'engineering-security-engineer', name: 'Security Engineer', category: 'engineering' },
    { id: 'coder', name: 'coder', category: 'core' },
  ]);
});

describe('hooks_route', () => {
  it('returns the central pick as primary + alternatives and records it', async () => {
    const r = (await hooksRoute.handler({ task: 'audit auth for injection', topK: 3 })) as {
      primaryAgent: { type: string; confidence: number };
      alternativeAgents: { type: string }[];
      routing: { method: string };
      swarmRecommendation: { agents: string[] } | null;
    };
    expect(pickAgents).toHaveBeenCalledWith('audit auth for injection', 3);
    expect(r.primaryAgent).toMatchObject({ type: 'Security Engineer', confidence: 0.75 });
    expect(r.alternativeAgents.map((a) => a.type)).toEqual(['coder', 'Code Reviewer']);
    expect(r.routing.method).toBe('keyword');
    expect(r.swarmRecommendation?.agents).toEqual(['Security Engineer', 'coder', 'Code Reviewer']);
    expect(recordRoute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ recommendedAgent: 'Security Engineer', routingMethod: 'keyword' }),
    );
  });

  it('defaults topK to 3 and clamps it to 1-20', async () => {
    await hooksRoute.handler({ task: 'x' });
    await hooksRoute.handler({ task: 'x', topK: 99 });
    expect(pickAgents.mock.calls.map((c) => c[1])).toEqual([3, 20]);
  });
});

describe('hooks_pre-task', () => {
  it('suggests the central pick', async () => {
    const r = (await hooksPreTask.handler({ taskId: 't1', description: 'secure the login' })) as {
      suggestedAgents: { type: string }[];
      recommendations: string[];
    };
    expect(pickAgents).toHaveBeenCalledWith('secure the login', 3);
    expect(r.suggestedAgents.map((a) => a.type)).toEqual([
      'Security Engineer',
      'coder',
      'Code Reviewer',
    ]);
    expect(r.recommendations[0]).toBe('Use Security Engineer as primary agent');
  });
});

describe('hooks_explain', () => {
  it('explains the same decision hooks_route makes', async () => {
    const r = (await hooksExplain.handler({ task: 'secure the login' })) as {
      decision: { agent: string; confidence: number; reasoning: string[] };
      explanation: string;
    };
    expect(r.decision).toMatchObject({ agent: 'Security Engineer', confidence: 0.75 });
    expect(r.explanation).toContain('"Security Engineer" ranked first');
    expect(r.decision.reasoning.join('\n')).toContain('Alternatives: coder, Code Reviewer');
  });

  it('lists the ranked agents as its matched patterns', async () => {
    const r = (await hooksExplain.handler({ task: 'secure the login' })) as {
      patterns: { pattern: string; matchScore: number; examples: string[] }[];
    };
    expect(r.patterns).toEqual([
      { pattern: 'Security Engineer', matchScore: 0.75, examples: ['r1'] },
      { pattern: 'coder', matchScore: 0.55, examples: ['r2'] },
      { pattern: 'Code Reviewer', matchScore: 0.45, examples: ['r3'] },
    ]);
  });
});

describe('monovector createKeywordRouter().route', () => {
  it('delegates to the central picker', async () => {
    const d = await createKeywordRouter().route('secure the login');
    expect(d).toMatchObject({ route: 'Security Engineer', agentType: 'Security Engineer' });
    expect(d.alternatives?.map((a) => a.route)).toEqual(['coder', 'Code Reviewer']);
  });
});

describe('monomind route task', () => {
  const task = routeCommand.subcommands?.find((c) => c.name === 'task');

  it('routes to the central pick', async () => {
    const res = await task?.action?.({
      args: ['secure the login'],
      flags: { json: true },
      cwd: process.cwd(),
      interactive: false,
    } as never);
    expect(res?.success).toBe(true);
    expect((res?.data as { agentId: string }).agentId).toBe('Security Engineer');
  });

  it('--agent accepts a registry slug and answers with the spawnable name', async () => {
    const res = await task?.action?.({
      args: ['x'],
      flags: { agent: 'engineering-security-engineer', json: true },
      cwd: process.cwd(),
      interactive: false,
    } as never);
    expect(res?.data).toEqual({ agentId: 'Security Engineer', agentName: 'Security Engineer' });
  });

  it('--agent rejects an agent that is not in the registry', async () => {
    const res = await task?.action?.({
      args: ['x'],
      flags: { agent: 'architect', json: true },
      cwd: process.cwd(),
      interactive: false,
    } as never);
    expect(res?.success).toBe(false);
  });
});

describe('file-type agent maps name only real agents', () => {
  const agentsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'agents');
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.md')) {
        const fm = readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/);
        const n = fm?.[1].match(/^name:\s*(.+)$/m)?.[1].trim();
        if (n) names.add(n);
      }
    }
  };
  walk(agentsDir);

  it('hooks_pre-edit AGENT_PATTERNS and its default', async () => {
    const all = [...Object.values(AGENT_PATTERNS).flat(), ...suggestAgentsForFile('x.unknown')];
    expect(all.filter((a) => !names.has(a))).toEqual([]);
    const r = (await hooksPreEdit.handler({ filePath: 'src/app.tsx' })) as {
      context: { suggestedAgents: string[] };
    };
    expect(r.context.suggestedAgents.every((a) => names.has(a))).toBe(true);
  });

  it('coverage-gap suggestions', () => {
    const paths = ['a.test.ts', 'src/auth/login.ts', 'src/api/x.ts', 'src/model.ts', 'src/x.ts'];
    const all = paths.flatMap(coverageAgentsForFile);
    expect(all.filter((a) => !names.has(a))).toEqual([]);
  });

  it('coverage-route gap assignment', () => {
    const paths = [
      'src/auth/token.ts',
      'src/api/x.ts',
      'src/ui/Page.tsx',
      'src/db/m.ts',
      'lib/u.ts',
      'x.ts',
    ];
    expect(paths.map(assignAgent).filter((a) => !names.has(a))).toEqual([]);
  });
});
