import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  pickRoleForTask,
  rankForTask,
  rankOrgSkills,
  suggestTaskSkills,
} from '../../src/decision/picks.js';

const localEnv = { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' };

function answering(answers: Record<string, unknown>) {
  return vi.fn(
    async () => new Response(JSON.stringify({ model: 'x', answers }), { status: 200 }),
  ) as unknown as typeof fetch;
}
const failing = (async () => {
  throw new TypeError('ECONNREFUSED');
}) as unknown as typeof fetch;

const agents = [
  { id: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
  { id: 'tester', name: 'tester', category: 'core', description: 'Writes unit tests and coverage' },
  { id: 'security-engineer', name: 'Security Engineer', category: 'security', description: 'Security audits' },
];
const skills = [
  { id: 'security-review', invoke: 'Skill("security-review")', description: 'Security review of changes' },
  { id: 'monodesign', invoke: '/monodesign', description: 'Frontend design' },
];

describe('rankForTask', () => {
  it('ranks by keywords when no decision model is configured', async () => {
    const r = await rankForTask('write tests for the parser', { agents, skills }, 3, { env: {} });
    expect(r.provider).toBeUndefined();
    expect(r.agents.method).toBe('keyword');
    expect(r.agents.ranked[0].id).toBe('tester');
  });

  it('ranks by Jev probabilities when it answers, never listing "none"', async () => {
    const fetchImpl = answering({
      agent: {
        type: 'choice',
        choice: 'security-engineer',
        confidence: 0.8,
        probabilities: { 'security-engineer': 0.8, coder: 0.15, tester: 0.05 },
      },
      skill: {
        type: 'choice',
        choice: 'security-review',
        confidence: 0.7,
        probabilities: { 'security-review': 0.7, __none__: 0.2, monodesign: 0.1 },
      },
    });
    const r = await rankForTask('check for sql injection', { agents, skills }, 5, { env: localEnv, fetchImpl });
    expect(r.provider).toBe('custom');
    expect(r.agents.method).toBe('jev');
    expect(r.agents.ranked[0]).toMatchObject({
      id: 'security-engineer',
      name: 'Security Engineer',
      category: 'security',
      probability: 0.8,
    });
    expect(r.skills.ranked.map((s) => s.id)).toEqual(['security-review', 'monodesign']);
  });

  it('keeps keyword ranking when Jev is below the confidence floor', async () => {
    const fetchImpl = answering({
      agent: { type: 'choice', choice: 'security-engineer', confidence: 0.4, probabilities: { 'security-engineer': 0.4 } },
      skill: { type: 'choice', choice: 'monodesign', confidence: 0.3, probabilities: { monodesign: 0.3 } },
    });
    const r = await rankForTask('write tests for the parser', { agents, skills }, 3, { env: localEnv, fetchImpl });
    expect(r.provider).toBeUndefined();
    expect(r.agents.method).toBe('keyword');
    expect(r.skills.method).toBe('keyword');
    expect(r.agents.ranked[0].id).toBe('tester');
  });

  it('falls back to keywords when the decision model fails', async () => {
    const r = await rankForTask('write tests for the parser', { agents, skills }, 3, {
      env: localEnv,
      fetchImpl: failing,
    });
    expect(r.agents.method).toBe('keyword');
  });
});

describe('suggestTaskSkills', () => {
  const pool = ['api-design', 'api-designer'];

  it('names the pool skills Jev picks (max two)', async () => {
    const fetchImpl = answering({
      skill: {
        type: 'choice',
        choice: 'api-design',
        confidence: 0.8,
        probabilities: { 'api-design': 0.7, 'api-designer': 0.2, __none__: 0.1 },
      },
    });
    expect(await suggestTaskSkills('design the REST endpoints', pool, tmpdir(), { env: localEnv, fetchImpl })).toEqual([
      'api-design',
      'api-designer',
    ]);
  });

  it('suggests nothing when Jev says none fits', async () => {
    const fetchImpl = answering({
      skill: { type: 'choice', choice: '__none__', confidence: 0.9, probabilities: { __none__: 0.9 } },
    });
    expect(await suggestTaskSkills('book a flight', pool, tmpdir(), { env: localEnv, fetchImpl })).toEqual([]);
  });

  it('suggests nothing without a decision model', async () => {
    expect(await suggestTaskSkills('design the REST endpoints', pool, tmpdir(), { env: {} })).toEqual([]);
  });
});

describe('pickRoleForTask', () => {
  const roles = [
    { id: 'boss', title: 'Boss', responsibilities: ['coordinate the team'] },
    { id: 'qa', title: 'QA Engineer', responsibilities: ['write tests', 'run the suite'] },
    { id: 'dev', title: 'Developer', responsibilities: ['implement features'] },
  ];

  it('uses the role Jev picks', async () => {
    const fetchImpl = answering({
      agent: { type: 'choice', choice: 'dev', confidence: 0.9, probabilities: { dev: 0.9 } },
    });
    expect(await pickRoleForTask('add the login form', roles, { env: localEnv, fetchImpl })).toBe('dev');
  });

  it('falls back to a keyword match over titles and responsibilities', async () => {
    expect(await pickRoleForTask('write tests for login', roles, { env: localEnv, fetchImpl: failing })).toBe('qa');
  });

  it('returns null when nothing matches and no model answers', async () => {
    expect(await pickRoleForTask('zzz', roles, { env: {} })).toBeNull();
  });

  it('returns the only role without asking', async () => {
    const fetchImpl = answering({});
    expect(await pickRoleForTask('anything', [roles[0]], { env: localEnv, fetchImpl })).toBe('boss');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('rankOrgSkills', () => {
  const found = [
    { name: 'a-skill', description: 'first', tags: [], score: 5 },
    { name: 'b-skill', description: 'second', tags: [], score: 3 },
    { name: 'c-skill', description: 'third', tags: [], score: 1 },
  ];

  it('re-ranks by Jev and keeps unranked keyword hits after', async () => {
    const fetchImpl = answering({
      skill: {
        type: 'choice',
        choice: 'c-skill',
        confidence: 0.7,
        probabilities: { 'c-skill': 0.7, 'a-skill': 0.2, __none__: 0.1 },
      },
    });
    const r = await rankOrgSkills('q', found, 3, { env: localEnv, fetchImpl });
    expect(r.method).toBe('jev');
    expect(r.hits.map((h) => h.name)).toEqual(['c-skill', 'a-skill', 'b-skill']);
    expect(r.hits[0].probability).toBe(0.7);
    expect(r.hits[2].probability).toBeUndefined();
  });

  it('keeps keyword order when Jev is not confident', async () => {
    const fetchImpl = answering({
      skill: { type: 'choice', choice: 'c-skill', confidence: 0.2, probabilities: { 'c-skill': 0.2 } },
    });
    const r = await rankOrgSkills('q', found, 3, { env: localEnv, fetchImpl });
    expect(r).toEqual({ method: 'keyword', hits: found });
  });

  it('keeps keyword order without a decision model', async () => {
    const r = await rankOrgSkills('q', found, 2, { env: {} });
    expect(r).toEqual({ method: 'keyword', hits: found.slice(0, 2) });
  });
});
