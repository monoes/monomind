/**
 * Offline regression for the keyword ranker (.claude/helpers/pick-rank.cjs):
 * a frozen catalog excerpt and tasks with the entries a person would expect
 * near the top. No network — this pins `shortlist` / `keywordRank` only.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keywordRank } from '../../src/decision/jev.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr: any = require('../../.claude/helpers/pick-rank.cjs');

interface Item {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  text?: string;
  pick?: string;
}
const catalog: { agents: Item[]; skills: Item[] } = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'pick-rank-catalog.json'), 'utf-8'),
);

const top = (query: string, items: Item[], n = 3): string[] =>
  keywordRank(query, items, n).map((i) => i.id);

// [task, an id expected in the top 3 (first = expected top 1), ids that must not lead]
const AGENT_CASES: Array<[string, string[], string[]?]> = [
  ['Write unit tests for the payment parser and raise coverage', ['tester']],
  ['Testing the checkout API endpoints', ['testing-api-tester']],
  ['Write the README and a getting-started tutorial', ['engineering-technical-writer'], ['goal-planner']],
  ['Optimize slow PostgreSQL queries with better indexes', ['engineering-database-optimizer']],
  ['Rebase the feature branch and tidy the commit history', ['engineering-git-workflow-master']],
  ['Set up a CI/CD pipeline with infrastructure as code', ['engineering-devops-automator']],
  ['Write a drip email sequence for new trial users', ['marketing-email-specialist']],
  ['Audit the authentication code for OWASP vulnerabilities', ['engineering-security-engineer']],
  ['Benchmark request latency and improve performance', ['testing-performance-benchmarker']],
  ['Cut a release and bump versions across all packages', ['release-manager']],
  ['Build a responsive web component with CSS for the frontend', ['engineering-frontend-developer']],
  ['Define SLOs and error budgets with better observability', ['engineering-sre']],
  ['Improve conversion on the pricing landing page', ['marketing-cro-specialist']],
  ['Design a REST API for orders backed by a database', ['engineering-backend-architect'], ['design-monodesign']],
];

const SKILL_CASES: Array<[string, string[], string[]?]> = [
  ['Build a responsive React settings page', ['react-patterns', 'responsive-design']],
  ['Debug a failing test and find the root cause', ['mastermind:debug', 'systematic-debugging']],
  ['Write landing page copy for the homepage', ['copywriting', 'page-cro'], ['mastermind-invite-landing']],
  ['Find the performance bottleneck', ['analysis:performance-bottlenecks', 'analysis:bottleneck-detect']],
  ['Tune PostgreSQL query indexes', ['postgres-patterns']],
  ['Coordinate multi-agent work with a monoswarm', ['monoswarm']],
];

describe('keyword ranking on a frozen catalog', () => {
  for (const [kind, cases] of [
    ['agents', AGENT_CASES],
    ['skills', SKILL_CASES],
  ] as const) {
    for (const [task, want, notFirst = []] of cases) {
      it(`${kind}: ${task}`, () => {
        const got = top(task, catalog[kind]);
        expect(got.some((id) => want.includes(id)), `top 3 was ${got.join(', ')}`).toBe(true);
        expect(notFirst).not.toContain(got[0]);
      });
    }
  }

  it('puts the best agent first on most tasks', () => {
    const hits = AGENT_CASES.filter(([task, want]) => top(task, catalog.agents, 1)[0] === want[0]);
    expect(hits.length).toBeGreaterThanOrEqual(AGENT_CASES.length - 2);
  });
});

describe('pick-rank tokens', () => {
  it('lets a word’s forms meet', () => {
    const stems = ['test', 'tests', 'testing', 'tester', 'testers', 'tested'].map(pr.stem);
    expect(new Set(stems).size).toBe(1);
    expect(new Set(['optimize', 'optimization', 'optimizing', 'optimizer'].map(pr.stem)).size).toBe(1);
    expect(new Set(['plan', 'planning', 'planner'].map(pr.stem)).size).toBe(1);
  });

  it('drops stopwords, so function words match nothing', () => {
    expect(pr.tokens('for the and with our')).toEqual([]);
    expect(top('for the and with our', catalog.agents)).toEqual([]);
  });

  it('does not reward a long description for its length', () => {
    // goal-planner's description is ~1,300 chars and says "planning" often.
    expect(top('Write the README and a getting-started tutorial', catalog.agents)).not.toContain(
      'goal-planner',
    );
  });

  it('breaks ties by catalog order and keeps forced ids first', () => {
    const items = [
      { id: 'b-one', description: 'widget' },
      { id: 'a-two', description: 'widget' },
      { id: 'c-three', description: 'other' },
    ];
    expect(pr.shortlist('widget', items, 3).map((i: Item) => i.id)).toEqual(['b-one', 'a-two', 'c-three']);
    expect(pr.shortlist('widget', items, 2, ['c-three']).map((i: Item) => i.id)).toEqual(['c-three', 'b-one']);
  });

  it('ranks a pick: low item below an equally matching one, but still returns it', () => {
    const items = [
      { id: 'org-admin', description: 'Review', pick: 'low' },
      { id: 'auditor', description: 'Review code changes' },
    ];
    expect(pr.shortlist('review', items, 2).map((i: Item) => i.id)).toEqual(['auditor', 'org-admin']);
    expect(pr.shortlist('review', items, 2)[1].score).toBeGreaterThan(0);
    expect(top('org admin', items, 1)).toEqual(['org-admin']);
  });

  it('scores a name or id word above the same word in a description', () => {
    const items = [
      { id: 'writer', description: 'Produces docs' },
      { id: 'other', description: 'A writer of docs' },
    ];
    expect(pr.shortlist('writer', items, 2).map((i: Item) => i.id)).toEqual(['writer', 'other']);
  });

  it('ignores a category prefix shared by many ids', () => {
    const items = [
      { id: 'design-alpha', description: 'Brand work' },
      { id: 'design-beta', description: 'Motion' },
      { id: 'design-gamma', description: 'Icons' },
      { id: 'api-architect', description: 'Can design REST APIs' },
    ];
    expect(pr.shortlist('design a REST API', items, 1)[0].id).toBe('api-architect');
  });
});

describe('pick-rank tokens beyond ASCII', () => {
  it('folds accents so an accented word meets its plain form', () => {
    expect(pr.tokens('Café résumé naïve')).toEqual(pr.tokens('cafe resume naive'));
    expect(pr.tokens('Café résumé naïve').length).toBe(3);
  });

  it('keeps Cyrillic and Greek words', () => {
    expect(pr.tokens('проверить безопасность API')).toEqual(['проверить', 'безопасность', 'api']);
    expect(pr.tokens('ασφάλεια')).toEqual(['ασφαλεια']);
  });

  it('splits CJK runs into character bigrams', () => {
    expect(pr.tokens('安全审计')).toEqual(['安全', '全审', '审计']);
    expect(pr.tokens('テスト')).toEqual(['テス', 'スト']);
  });

  it('ranks a matching non-Latin description above zero', () => {
    const items = [
      { id: 'sec', description: '代码安全审计与漏洞评估' },
      { id: 'docs', description: '编写文档' },
      { id: 'ru', description: 'Проверка безопасности кода' },
    ];
    const zh = pr.shortlist('请做一次安全审计', items, 3);
    expect(zh[0]).toMatchObject({ id: 'sec' });
    expect(zh[0].score).toBeGreaterThan(0);
    const ru = pr.shortlist('проверка безопасности', items, 3);
    expect(ru[0]).toMatchObject({ id: 'ru' });
    expect(ru[0].score).toBeGreaterThan(0);
  });

  it('leaves English tokens as they were', () => {
    expect(pr.tokens('Testing the optimizer for our CI/CD pipelines')).toEqual([
      'test',
      'optimiz',
      'ci',
      'cd',
      'pipelin',
    ]);
  });
});
