/**
 * Real-use pick eval: labelled examples from hook log fixtures (current and
 * older record shapes, notification prompts, missing files) and the
 * `scripts/pick-eval.mjs --logs` report built on them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isSystemPreview,
  keywordRealPicks,
  readRealUse,
  realUseEvalTasks,
  realUseLine,
  scoreRealUse,
} from '../../packages/@monomind/cli/src/decision/pick-real.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'tests', 'pick-eval', 'fixtures', 'real-logs');

const AGENTS = [
  { id: 'tester', name: 'tester', description: 'Writes unit tests and test suites' },
  { id: 'coder', name: 'coder', description: 'Implements features and fixes bugs' },
  { id: 'researcher', name: 'researcher', description: 'Researches tools and reports findings' },
  {
    id: 'code-reviewer',
    name: 'reviewer',
    description: 'Reviews code for security bugs and quality',
  },
];

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'pick-real-'));

describe('isSystemPreview', () => {
  it('flags notifications and harness messages, not user prompts', () => {
    expect(isSystemPreview('<task-notification> <task-id>x')).toBe(true);
    expect(isSystemPreview(' <system-reminder>hi')).toBe(true);
    expect(isSystemPreview('Caveat: The messages below')).toBe(true);
    expect(isSystemPreview('[Request interrupted by user]')).toBe(true);
    expect(isSystemPreview('write a <div> wrapper')).toBe(false);
  });
});

describe('readRealUse on current-shape logs', () => {
  const logs = readRealUse(join(FIX, 'new'));

  it('counts spawns, follow rates and skipped spawns', () => {
    expect(logs.hasAdherence).toBe(true);
    expect(logs).toMatchObject({
      spawns: 8,
      recommendedSpawns: 7,
      followed: 5,
      shownSpawns: 4,
      shownFollowed: 2,
      skipped: { system: 1, short: 1, noPrompt: 2 },
    });
  });

  it('keeps one example per prompt and spawned agent', () => {
    expect(logs.examples.map((e) => [e.routeId, e.actual, e.spawns])).toEqual([
      ['r1', 'tester', 2],
      ['r2', 'general-purpose', 1],
      ['r5', 'reviewer', 1],
    ]);
    expect(logs.examples[2]).toMatchObject({ recommended: 'coder', followed: false, shown: true });
  });

  it('summarises the routes', () => {
    expect(logs.routes).toEqual({
      routes: 5,
      shown: 3,
      system: 1,
      methods: { keyword: 4, jev: 1 },
      topRecommended: [
        { name: 'coder', count: 2 },
        { name: 'tester', count: 1 },
        { name: 'researcher', count: 1 },
      ],
    });
  });
});

describe('readRealUse on older logs', () => {
  const logs = readRealUse(join(FIX, 'old'));

  it('takes spawns from agentActuallyUsed when there is no adherence file', () => {
    expect(logs.hasAdherence).toBe(false);
    expect(logs).toMatchObject({
      spawns: 3,
      recommendedSpawns: 3,
      followed: 2,
      shownSpawns: 0,
      skipped: { system: 0, short: 1, noPrompt: 0 },
    });
    expect(logs.examples.map((e) => [e.routeId, e.actual, e.followed, e.shown])).toEqual([
      ['o1', 'tester', false, null],
      ['o4', 'coder', true, null],
    ]);
    expect(logs.routes.methods).toEqual({ keyword: 4, 'memory-sqlite': 1 });
    expect(logs.routes.system).toBe(1);
  });

  it('counts recommended agents case-insensitively', () => {
    const dir = tempDir();
    const rows = ['Tester', 'tester', 'coder'].map((a, i) => ({
      routeId: `c${i}`,
      task: 'write some unit tests',
      recommendedAgent: a,
    }));
    writeFileSync(
      join(dir, 'route-outcomes.jsonl'),
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );
    expect(readRealUse(dir).routes.topRecommended).toEqual([
      { name: 'Tester', count: 2 },
      { name: 'coder', count: 1 },
    ]);
  });

  it('redacts and shortens the task text of older records', () => {
    const dir = tempDir();
    const token = `ghp_${'a1B2'.repeat(9)}`;
    const task = `fix the login bug, the token is ${token} ${'and more words '.repeat(40)}`;
    writeFileSync(
      join(dir, 'route-outcomes.jsonl'),
      `${JSON.stringify({ routeId: 'x', ts: 1, task, recommendedAgent: 'coder', agentActuallyUsed: 'coder' })}\n`,
    );
    const preview = readRealUse(dir).examples[0].preview;
    expect(preview).not.toContain(token);
    expect(preview.startsWith('fix the login bug')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(120);
  });
});

describe('readRealUse without spawns', () => {
  it('reports route stats only when nothing was spawned', () => {
    const logs = readRealUse(join(FIX, 'routes-only'));
    expect(logs).toMatchObject({ hasAdherence: false, spawns: 0, examples: [] });
    expect(logs.routes).toMatchObject({
      routes: 3,
      shown: 2,
      methods: { keyword: 1, none: 1, jev: 1 },
      topRecommended: [{ name: 'tester', count: 2 }],
    });
  });

  it('is empty for a directory without logs', () => {
    const logs = readRealUse(tempDir());
    expect(logs).toMatchObject({ hasAdherence: false, spawns: 0, examples: [] });
    expect(logs.routes.routes).toBe(0);
  });
});

describe('scoreRealUse', () => {
  const { examples } = readRealUse(join(FIX, 'new'));

  it('scores in-catalog spawns and sets the others apart', () => {
    const s = scoreRealUse(examples, AGENTS, [
      ['tester', 'coder'],
      ['researcher'],
      ['coder', 'tester', 'researcher', 'code-reviewer'],
    ]);
    expect(s).toMatchObject({ n: 2, top1: 1, top3: 1 });
    expect(s.outOfCatalog).toEqual([{ name: 'general-purpose', count: 1 }]);
    expect(s.disagreements).toEqual([
      {
        preview: 'review the auth module for security bugs and code quality',
        actual: 'code-reviewer',
        got: ['coder', 'tester', 'researcher'],
        spawns: 1,
      },
    ]);
  });

  it('ranks previews with the keyword ranker', () => {
    const picks = keywordRealPicks(examples, AGENTS);
    expect(picks).toHaveLength(3);
    expect(picks[0][0]).toBe('tester');
  });
});

describe('realUseEvalTasks', () => {
  it('exports in-catalog examples in the dataset shape', () => {
    const { examples } = readRealUse(join(FIX, 'new'));
    expect(realUseEvalTasks(examples, AGENTS)).toEqual([
      {
        id: 1001,
        domain: 'real-use',
        task: 'write unit tests for the parser module',
        agents: ['tester'],
        skills: [],
      },
      {
        id: 1002,
        domain: 'real-use',
        task: 'review the auth module for security bugs and code quality',
        agents: ['code-reviewer'],
        skills: [],
      },
    ]);
  });
});

describe('realUseLine', () => {
  it('waits for enough spawns', () => {
    expect(realUseLine(tempDir(), AGENTS)).toBe('real use: not enough spawns yet (0)');
  });
});

const BUILT = existsSync(
  join(ROOT, 'packages', '@monomind', 'cli', 'dist', 'src', 'decision', 'pick-real.js'),
);

describe.skipIf(!BUILT)('scripts/pick-eval.mjs --logs', () => {
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'pick-eval.mjs'), ...args], {
      encoding: 'utf-8',
    });

  it('reports follow rate, ranker agreement and disagreements', () => {
    const out = run('--logs', join(FIX, 'new'), '--catalog', 'frozen');
    expect(out).toMatch(/8 spawns/);
    expect(out).toMatch(/followed the shown pick 2\/4 \(50%\)/);
    expect(out).toMatch(/top-1 \d\/2, top-3 \d\/2/);
    expect(out).toMatch(/general-purpose ×1/);
    expect(out).not.toMatch(/task-notification/);
  });

  it('says so when no spawns are recorded and prints route stats', () => {
    const out = run('--logs', join(FIX, 'routes-only'), '--catalog', 'frozen');
    expect(out).toMatch(/no spawns recorded yet/);
    expect(out).toMatch(/3 routes, 2 shown \(67%\)/);
    expect(out).toMatch(/tester ×2/);
  });

  it('exports the labelled examples as an eval set', () => {
    const file = join(tempDir(), 'real.json');
    const out = run('--logs', join(FIX, 'new'), '--catalog', 'frozen', '--export', file);
    expect(out).toMatch(/review the previews for private text/);
    const tasks = JSON.parse(readFileSync(file, 'utf-8'));
    expect(tasks.map((t: { agents: string[] }) => t.agents)).toEqual([['tester'], ['reviewer']]);
  });
});
