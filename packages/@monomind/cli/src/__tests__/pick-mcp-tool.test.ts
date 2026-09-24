/**
 * The `pick` MCP tool (mcp__monomind__pick) and the agent-pick helper every
 * routing wrapper uses: both go through rankForTask over agentCatalog +
 * taskSkillCatalog, and every agent they return is a spawnable name.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rankForTask = vi.fn();
const agentCatalog = vi.fn();
const taskSkillCatalog = vi.fn();

vi.mock('../decision/picks.js', () => ({ rankForTask }));
vi.mock('../decision/catalogs.js', () => ({ agentCatalog, taskSkillCatalog }));

const { pickTool, pickTools } = await import('../mcp-tools/pick-tools.js');
const { pickAgents, pickForTask, pickSummary } = await import('../routing/agent-pick.js');

const AGENTS = [
  { id: 'engineering-security-engineer', name: 'Security Engineer', category: 'engineering' },
  { id: 'coder', name: 'coder', category: 'core' },
  { id: 'cro', name: 'CRO Specialist', category: 'marketing' },
];
const SKILLS = [{ id: 'mastermind-review', invoke: 'Skill("mastermind-review")' }];

function ranking(over: Record<string, unknown> = {}) {
  return {
    agents: {
      method: 'keyword',
      ranked: [
        { id: 'engineering-security-engineer', name: 'Security Engineer', score: 7 },
        { id: 'no-name-agent', score: 3 },
      ],
    },
    skills: {
      method: 'keyword',
      ranked: [{ id: 'mastermind-review', invoke: 'Skill("mastermind-review")', score: 4 }],
    },
    ...over,
  };
}

async function call(input: Record<string, unknown>) {
  return (await pickTool.handler(input)) as Record<string, any>;
}

beforeEach(() => {
  rankForTask.mockReset().mockResolvedValue(ranking());
  agentCatalog.mockReset().mockReturnValue(AGENTS);
  taskSkillCatalog.mockReset().mockReturnValue(SKILLS);
});

describe('pick MCP tool — contract', () => {
  it('is registered as `pick` with a task-required schema', () => {
    expect(pickTools.map((t) => t.name)).toEqual(['pick']);
    expect(pickTool.inputSchema.required).toEqual(['task']);
    const props = pickTool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(Object.keys(props).sort()).toEqual(['categories', 'kind', 'task', 'top']);
    expect(props.kind.enum).toEqual(['agents', 'skills', 'both']);
  });

  it('returns the TaskRanking JSON with a spawnable name on every agent and a summary', async () => {
    const body = await call({ task: 'audit the API for injection risks' });
    expect(body.error).toBeUndefined();
    expect(body.agents.method).toBe('keyword');
    expect(body.agents.ranked.map((a: { name: string }) => a.name)).toEqual([
      'Security Engineer',
      'no-name-agent',
    ]);
    expect(body.skills.ranked[0].id).toBe('mastermind-review');
    expect(body.summary).toBe('agent: Security Engineer · skill: Skill("mastermind-review")');
  });

  it('calls rankForTask with both catalogs and top=5 by default', async () => {
    await call({ task: 'x' });
    expect(rankForTask).toHaveBeenCalledTimes(1);
    const [task, catalogs, top] = rankForTask.mock.calls[0];
    expect(task).toBe('x');
    expect(catalogs.agents).toEqual(AGENTS);
    expect(catalogs.skills).toEqual(SKILLS);
    expect(top).toBe(5);
  });

  it('kind=agents sends no skills; kind=skills sends no agents', async () => {
    await call({ task: 'x', kind: 'agents' });
    expect(rankForTask.mock.calls[0][1].skills).toEqual([]);
    await call({ task: 'x', kind: 'skills' });
    expect(rankForTask.mock.calls[1][1].agents).toEqual([]);
  });

  it('filters agents by categories and honours top', async () => {
    await call({ task: 'x', categories: ['marketing'], top: 2 });
    const [, catalogs, top] = rankForTask.mock.calls[0];
    expect(catalogs.agents.map((a: { name: string }) => a.name)).toEqual(['CRO Specialist']);
    expect(top).toBe(2);
  });

  it.each([
    [{}],
    [{ task: '' }],
    [{ task: 42 }],
    [{ task: 'x', kind: 'teams' }],
    [{ task: 'x', top: 0 }],
    [{ task: 'x', top: 21 }],
    [{ task: 'x', top: 2.5 }],
    [{ task: 'x', categories: 'marketing' }],
    [{ task: 'x'.repeat(17 * 1024) }],
  ])('rejects invalid input %j without ranking', async (input) => {
    const body = await call(input);
    expect(body.error).toMatch(/invalid input/i);
    expect(rankForTask).not.toHaveBeenCalled();
  });

  it('summary says so when nothing matched', async () => {
    rankForTask.mockResolvedValue({
      agents: { method: 'keyword', ranked: [] },
      skills: { method: 'keyword', ranked: [] },
    });
    const body = await call({ task: 'x' });
    expect(body.summary).toBe('no match');
  });
});

describe('pick MCP tool — registration', () => {
  it('is reachable by name through the MCP tool registry', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    const body = (await callMCPTool('pick', { task: 'x', kind: 'agents' })) as {
      agents: { ranked: { name: string }[] };
    };
    expect(body.agents.ranked[0].name).toBe('Security Engineer');
  });
});

describe('pickSummary', () => {
  it('omits the kind that was not ranked', () => {
    const r = ranking();
    expect(pickSummary(r as never, 'agents')).toBe('agent: Security Engineer');
    expect(pickSummary(r as never, 'skills')).toBe('skill: Skill("mastermind-review")');
  });
});

describe('pickForTask', () => {
  it('uses the project root it is given', async () => {
    await pickForTask({ task: 'x', root: '/proj' });
    expect(agentCatalog).toHaveBeenCalledWith('/proj');
    expect(taskSkillCatalog).toHaveBeenCalledWith('/proj');
  });
});

describe('pickAgents — the shape routing wrappers consume', () => {
  it('maps ranked agents to spawnable types with confidences', async () => {
    const pick = await pickAgents('secure the login flow', 3, '/proj');
    expect(rankForTask.mock.calls[0][1].skills).toEqual([]);
    expect(pick.method).toBe('keyword');
    expect(pick.agents.map((a) => a.type)).toEqual(['Security Engineer', 'no-name-agent']);
    for (const a of pick.agents) {
      expect(a.confidence).toBeGreaterThan(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
    }
    expect(pick.agents[0].confidence).toBeGreaterThan(pick.agents[1].confidence);
  });

  it('uses the decision-model probability when present', async () => {
    rankForTask.mockResolvedValue(
      ranking({
        provider: 'custom',
        agents: {
          method: 'jev',
          ranked: [
            { id: 'engineering-security-engineer', name: 'Security Engineer', probability: 0.91 },
          ],
        },
      }),
    );
    const pick = await pickAgents('x');
    expect(pick.method).toBe('jev');
    expect(pick.provider).toBe('custom');
    expect(pick.agents[0]).toMatchObject({ type: 'Security Engineer', confidence: 0.91 });
  });

  it('falls back to the coder agent when nothing ranks', async () => {
    rankForTask.mockResolvedValue({
      agents: { method: 'keyword', ranked: [] },
      skills: { method: 'keyword', ranked: [] },
    });
    const pick = await pickAgents('zzz');
    expect(pick.method).toBe('fallback');
    expect(pick.agents).toEqual([expect.objectContaining({ type: 'coder' })]);
  });
});
