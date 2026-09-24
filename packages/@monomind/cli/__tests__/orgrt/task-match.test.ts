// packages/@monomind/cli/__tests__/orgrt/task-match.test.ts
//
// `org_task` with `assignee: "auto"` misrouted on real org configs: the old
// keyword fallback had no stopwords, gave every word the same weight however
// many roles mention it, and broke ties by declaration order — so the boss,
// declared first and mentioning everything, won. "Publish to npm" went to the
// release captain instead of the publisher, "Implement the retry flag" to the
// architect. The fixtures below are trimmed from the release and
// monomind-dev org configs.
import { describe, expect, it } from 'vitest';
import {
  keywordRole,
  keywordSkills,
  matchTokens,
  outcomeFactor,
  pickTaskRole,
  roleOutcomePrior,
  skillOutcomePrior,
  type TaskOutcome,
} from '../../src/orgrt/task-match.js';
import type { OrgRole } from '../../src/orgrt/types.js';

const RULES = 'The release-rules skill in your prompt applies to every command you run. Work in the worktree named in the brief.';

const release = [
  {
    id: 'release-captain',
    title: 'Release Captain',
    reports_to: null,
    responsibilities: [
      `${RULES} You are the operator of this org: run PREFLIGHT, then dispatch the builder, the QA roles, the auditor and the publisher.`,
      'After the auditor passes, have the publisher publish to npm; verify the npm publish landed and the GitHub release exists.',
    ],
  },
  {
    id: 'builder',
    title: 'Build, Pack & Test Engineer',
    reports_to: 'release-captain',
    responsibilities: [`${RULES} Build and pack the tarballs, run the unit tests on the packed artifacts.`],
  },
  {
    id: 'docs-writer',
    title: 'Release Docs Writer',
    reports_to: 'release-captain',
    responsibilities: [`${RULES} Update the docs for every user-visible change; CHANGELOG belongs to publisher.`],
  },
  {
    id: 'publisher',
    title: 'Release Publisher',
    reports_to: 'release-captain',
    responsibilities: [
      `${RULES} PREP: version bump and CHANGELOG. PUBLISH: npm publish every package in order, push the tag, create the GitHub release.`,
    ],
  },
  {
    id: 'release-auditor',
    title: 'Release Evidence Auditor',
    reports_to: 'release-captain',
    responsibilities: [`${RULES} Audit the evidence of every gate before anything is published.`],
  },
] as OrgRole[];

const DEV_RULES = 'The dev-rules skill applies to every command you run (REPO, RUN, WT, git, evidence).';
const developer = (id: string): OrgRole =>
  ({
    id,
    title: `Developer ${id.slice(-1)}`,
    reports_to: 'dev-lead',
    responsibilities: [`${DEV_RULES} Write the failing test first; implement the smallest change that makes it pass.`],
  }) as OrgRole;

const dev = [
  { id: 'dev-lead', title: 'Development Lead', reports_to: null, responsibilities: [`${DEV_RULES} You are the coordinator.`] },
  {
    id: 'architect',
    title: 'Technical Architect / Planner',
    reports_to: 'dev-lead',
    responsibilities: [`${DEV_RULES} Write the plan: no speculative features, flags or abstractions.`],
  },
  developer('developer-1'),
  developer('developer-2'),
] as OrgRole[];

const noModel = { env: {} };

describe('pickTaskRole keyword fallback on real org shapes', () => {
  it('routes "Publish to npm" to the publisher, not the boss declared first', async () => {
    const pick = await pickTaskRole({ title: 'Publish to npm' }, release, noModel);
    expect(pick).toMatchObject({ role: 'publisher', method: 'keyword' });
    expect(pick.candidates[0].id).toBe('publisher');
  });

  it('never assigns a task to the role creating it', async () => {
    const pick = await pickTaskRole({ title: 'Publish to npm' }, release, { ...noModel, caller: 'publisher' });
    expect(pick.role).not.toBe('publisher');
    expect(pick.candidates.map((c) => c.id)).not.toContain('publisher');
  });

  it('never picks an endpoint role', async () => {
    const hook = { id: 'npm-publish-hook', title: 'npm publish webhook', reports_to: 'release-captain', kind: 'endpoint', responsibilities: [] } as unknown as OrgRole;
    const pick = await pickTaskRole({ title: 'Publish to npm' }, [...release, hook], noModel);
    expect(pick.role).toBe('publisher');
  });

  it('reads the brief when the title says little', async () => {
    const pick = await pickTaskRole({ title: 'Handle item 7', brief: 'Build and pack the tarballs for 1.2.0' }, release, noModel);
    expect(pick.role).toBe('builder');
  });

  it('refuses to guess between interchangeable roles instead of taking the first', async () => {
    const pick = await pickTaskRole({ title: 'Implement the retry flag' }, dev, noModel);
    expect(pick).toMatchObject({ role: null, reason: 'ambiguous' });
    expect(pick.candidates.slice(0, 2).map((c) => c.id).sort()).toEqual(['developer-1', 'developer-2']);
  });

  it('breaks a tie between interchangeable roles by open work', async () => {
    const load = (id: string) => (id === 'developer-1' ? 2 : 0);
    const pick = await pickTaskRole({ title: 'Implement the retry flag' }, dev, { ...noModel, load });
    expect(pick.role).toBe('developer-2');
  });

  it('does not depend on the order roles are declared in', async () => {
    for (const title of ['Publish to npm', 'Audit the evidence', 'Update the docs']) {
      const a = await pickTaskRole({ title }, release, noModel);
      const b = await pickTaskRole({ title }, [...release].reverse(), noModel);
      expect(b.role).toBe(a.role);
    }
  });

  it('prefers the more specific role on an equal score', () => {
    const roles = [
      { id: 'lead', title: 'Lead', reports_to: null, responsibilities: ['deploy'] },
      { id: 'ops', title: 'Ops', reports_to: 'lead', responsibilities: ['deploy'] },
      { id: 'qa', title: 'QA', reports_to: 'lead', responsibilities: ['test'] },
    ] as OrgRole[];
    expect(keywordRole({ title: 'deploy it' }, roles).role).toBe('ops');
  });

  it('assigns nothing below the minimum score', async () => {
    const pick = await pickTaskRole({ title: 'zzz', brief: 'the command' }, release, noModel);
    expect(pick).toMatchObject({ role: null, reason: 'no-match' });
  });

  it('returns the only candidate without scoring, and nothing without candidates', async () => {
    expect(await pickTaskRole({ title: 'x' }, release.slice(0, 2), { ...noModel, caller: 'release-captain' })).toMatchObject({
      role: 'builder',
      method: 'only',
    });
    expect(await pickTaskRole({ title: 'x' }, release.slice(0, 1), { ...noModel, caller: 'release-captain' })).toMatchObject({
      role: null,
      reason: 'no-candidates',
    });
  });

  it('records Jev confidence when the decision model answers', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          model: 'x',
          answers: { agent: { type: 'choice', choice: 'publisher', confidence: 0.9, probabilities: { publisher: 0.9 } } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const pick = await pickTaskRole({ title: 'ship it' }, release, {
      env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' },
      fetchImpl,
    });
    expect(pick).toMatchObject({ role: 'publisher', method: 'jev', confidence: 0.9 });
  });
});

describe('matchTokens / keywordSkills', () => {
  it('drops stopwords and lets word forms meet', () => {
    expect(matchTokens('Publish to the npm registry')).toEqual(['publish', 'npm', 'registry']);
    expect(matchTokens('publisher releases')).toEqual(matchTokens('publish release'));
  });

  it('suggests at most two pool skills above the minimum score', () => {
    const pool = [
      { id: 'api-design', description: 'Design REST and GraphQL APIs', text: 'api backend' },
      { id: 'api-docs', description: 'Document an API', text: 'api docs' },
      { id: 'sql-tuning', description: 'Tune slow SQL queries', text: 'database' },
    ];
    expect(keywordSkills({ title: 'design the REST api' }, pool)).toEqual(['api-design', 'api-docs']);
    expect(keywordSkills({ title: 'book a flight' }, pool)).toEqual([]);
  });
});

describe('outcome prior (org task history)', () => {
  const roles = [
    { id: 'alpha', title: 'Alpha Engineer', responsibilities: ['Fix parser bugs'] },
    { id: 'beta', title: 'Beta Engineer', responsibilities: ['Fix parser bugs'] },
    { id: 'gamma', title: 'Gamma Parser Engineer', responsibilities: ['Fix parser bugs and lexer bugs'] },
  ];
  const done = (assignee: string, title = 'fix the parser crash'): TaskOutcome => ({ title, assignee, status: 'done' });
  const failed = (assignee: string, title = 'fix the parser crash'): TaskOutcome => ({ title, assignee, status: 'failed' });

  it('outcomeFactor is neutral below 3 outcomes and bounded to [0.85, 1.15]', () => {
    expect(outcomeFactor(2, 0)).toBe(1);
    expect(outcomeFactor(1e6, 0)).toBeLessThanOrEqual(1.15);
    expect(outcomeFactor(1e6, 0)).toBeGreaterThan(1.14);
    expect(outcomeFactor(0, 1e6)).toBeGreaterThanOrEqual(0.85);
    expect(outcomeFactor(3, 3)).toBe(1);
  });

  it('counts only similar finished tasks, per role', () => {
    const prior = roleOutcomePrior({ title: 'fix a parser crash on empty input' }, [
      done('beta'),
      done('beta'),
      done('beta'),
      failed('alpha'),
      failed('alpha'),
      failed('alpha'),
      done('alpha', 'write the quarterly marketing newsletter'),
      { title: 'fix the parser crash', assignee: 'alpha', status: 'running' },
    ]);
    expect(prior('beta')).toBeGreaterThan(1);
    expect(prior('alpha')).toBeLessThan(1);
    expect(prior('gamma')).toBe(1);
  });

  it('breaks an otherwise ambiguous tie toward the role that finished similar tasks', async () => {
    const tied = [roles[0], roles[1]];
    expect(keywordRole({ title: 'fix parser bugs' }, tied).reason).toBe('ambiguous');
    const pick = await pickTaskRole({ title: 'fix parser bugs' }, tied, {
      env: {},
      history: [done('beta', 'fix parser bugs'), done('beta', 'fix parser bugs'), done('beta', 'fix parser bugs')],
    });
    expect(pick).toMatchObject({ role: 'beta', method: 'keyword' });
  });

  it('cannot flip a strong relevance gap', () => {
    const task = { title: 'fix parser lexer bugs' };
    const plain = keywordRole(task, roles);
    expect(plain.role).toBe('gamma');
    const prior = (id: string) => (id === 'gamma' ? 0.85 : 1.15);
    expect(keywordRole(task, roles, roles, undefined, prior).role).toBe('gamma');
  });

  it('re-orders skill suggestions by the outcomes of tasks that loaded them', () => {
    const pool = [
      { id: 'api-design', description: 'Design a REST api' },
      { id: 'api-docs', description: 'Document a REST api' },
    ];
    const history: TaskOutcome[] = [1, 2, 3].map(() => ({
      title: 'x',
      assignee: 'a',
      status: 'done',
      loadedSkills: ['api-docs'],
    }));
    expect(keywordSkills({ title: 'the REST api' }, pool, 1)).toEqual(['api-design']);
    expect(keywordSkills({ title: 'the REST api' }, pool, 1, skillOutcomePrior(history))).toEqual(['api-docs']);
  });
});
