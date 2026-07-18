// packages/@monomind/cli/__tests__/orgrt/reporting.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeRun, formatEvent, readRunEvents, readHistory, listRunDirs } from '../../src/orgrt/reporting.js';
import { ORG_TEMPLATES, buildFromTemplate } from '../../src/orgrt/templates.js';
import { OrgDefSchema, ORG_DIR, type BusEvent } from '../../src/orgrt/types.js';
import { orgCommand } from '../../src/commands/org.js';

const ev = (partial: Partial<BusEvent>): BusEvent =>
  ({ id: 'x', ts: 1000, org: 'alpha', run: 'run-1', type: 'status', ...partial }) as BusEvent;

describe('summarizeRun', () => {
  it('aggregates messages, tools, usage, assets, crashes, and outcome per role', () => {
    const s = summarizeRun([
      ev({ ts: 1000, type: 'status', msg: 'org started' }),
      ev({ type: 'message', from: 'boss', to: 'coder', subject: 'task' }),
      ev({ type: 'message', from: 'coder', to: 'boss', subject: 'done' }),
      ev({ type: 'xorg', from: 'alpha:boss', to: 'beta:lead', subject: 'sync' }),
      ev({ type: 'tool', from: 'coder', tool: 'Write', decision: 'allow' }),
      ev({ type: 'tool', from: 'coder', tool: 'Bash', decision: 'deny', reason: 'denied' }),
      ev({ type: 'asset', from: 'coder', path: 'out/report.md' }),
      ev({ type: 'asset', from: 'coder', path: 'out/report.md' }), // dedup
      ev({ type: 'usage', from: 'coder', data: { tokens: 500, cost_usd: 0.01 } }),
      ev({ type: 'usage', from: 'boss', data: { tokens: 300 } }),
      ev({ type: 'audit', from: 'tester', reason: 'agent-session-crash', msg: 'crashed' }),
      ev({ type: 'status', from: 'boss', reason: 'org-complete', data: { outcome: 'achieved', summary: 'shipped it' } }),
      ev({ ts: 61_000, type: 'status', msg: 'org stopped' }),
    ]);
    expect(s.messages).toBe(2);
    expect(s.xorgMessages).toBe(1);
    expect(s.assets).toEqual(['out/report.md']);
    expect(s.crashes).toEqual(['tester']);
    expect(s.roles['tester'].crashed).toBe(true);
    expect(s.roles['coder']).toMatchObject({ messagesSent: 1, toolsAllowed: 1, toolsDenied: 1, tokens: 500 });
    expect(s.totalTokens).toBe(800);
    expect(s.totalCostUsd).toBeCloseTo(0.01);
    expect(s.outcome).toEqual({ status: 'achieved', summary: 'shipped it', by: 'boss' });
    expect(s.durationMs).toBe(60_000);
  });

  it('handles an empty event list', () => {
    const s = summarizeRun([]);
    expect(s.events).toBe(0);
    expect(s.outcome).toBeNull();
    expect(s.durationMs).toBeNull();
  });
});

describe('formatEvent', () => {
  it('renders each event type as a single line', () => {
    for (const e of [
      ev({ type: 'message', from: 'a', to: 'b', subject: 's', msg: 'hi' }),
      ev({ type: 'chat', from: 'a', msg: 'thinking\nhard' }),
      ev({ type: 'tool', from: 'a', tool: 'Write', decision: 'deny', reason: 'nope' }),
      ev({ type: 'asset', from: 'a', path: 'x.md' }),
      ev({ type: 'usage', from: 'a', data: { tokens: 5 } }),
    ]) {
      const line = formatEvent(e);
      expect(line).toBeTruthy();
      expect(line).not.toContain('\n');
    }
  });
});

describe('templates', () => {
  it('every template builds a config that passes OrgDefSchema with one root role', () => {
    for (const name of Object.keys(ORG_TEMPLATES)) {
      const def = buildFromTemplate(name, 'my-org')!;
      expect(def).not.toBeNull();
      expect(() => OrgDefSchema.parse(def)).not.toThrow();
      expect(def.roles.filter(r => r.reports_to === null)).toHaveLength(1);
      expect(def.name).toBe('my-org');
    }
  });
  it('returns null for an unknown template', () => {
    expect(buildFromTemplate('nope', 'x')).toBeNull();
  });
});

describe('org command — observe surface', () => {
  const sub = (n: string) => orgCommand.subcommands!.find(c => c.name === n)!;
  const run = (n: string, cwd: string, args: string[], flags: Record<string, unknown> = {}) =>
    sub(n).action!({ args, flags, cwd, interactive: false } as any);

  const seedRun = (cwd: string, org: string, runId: string, events: BusEvent[]): void => {
    const dir = join(cwd, ORG_DIR, org, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bus.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(join(cwd, ORG_DIR, `${org}.json`), JSON.stringify({ name: org, roles: [{ id: 'boss' }] }));
  };

  it('create scaffolds a valid org config from a template', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-create-'));
    try {
      const res = await run('create', cwd, ['blog'], { template: 'content-team', goal: '3 posts/week' });
      expect(res?.success).toBe(true);
      const def = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'blog.json'), 'utf8'));
      expect(def.goal).toBe('3 posts/week');
      expect(() => OrgDefSchema.parse(def)).not.toThrow();
      // refuses to clobber without --force
      const again = await run('create', cwd, ['blog'], { template: 'content-team' });
      expect(again?.success).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('create rejects an unknown template', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-create-'));
    try {
      const res = await run('create', cwd, ['x'], { template: 'bogus' });
      expect(res?.success).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('report summarizes the latest run', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-'));
    try {
      seedRun(cwd, 'alpha', 'run-20260101000000-aaaa', [
        ev({ type: 'message', from: 'boss', to: 'coder', subject: 't' }),
        ev({ type: 'usage', from: 'boss', data: { tokens: 100 } }),
        ev({ type: 'status', from: 'boss', reason: 'org-complete', data: { outcome: 'achieved', summary: 'done' } }),
      ]);
      const res = await run('report', cwd, ['alpha']);
      expect(res?.success).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('report --all reads history.jsonl', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-'));
    try {
      seedRun(cwd, 'alpha', 'run-1', [ev({})]);
      const summary = summarizeRun([ev({ type: 'message', from: 'boss', to: 'x', subject: 's' })]);
      writeFileSync(join(cwd, ORG_DIR, 'alpha', 'history.jsonl'), JSON.stringify(summary) + '\n');
      const res = await run('report', cwd, ['alpha'], { all: true });
      expect(res?.success).toBe(true);
      expect(readHistory(cwd, 'alpha')).toHaveLength(1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('logs prints the formatted event log of the latest run', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-logs-'));
    try {
      seedRun(cwd, 'alpha', 'run-2', [ev({ type: 'chat', from: 'boss', msg: 'hello world' })]);
      const res = await run('logs', cwd, ['alpha']);
      expect(res?.success).toBe(true);
      // and errors cleanly when no runs exist
      writeFileSync(join(cwd, ORG_DIR, 'beta.json'), JSON.stringify({ name: 'beta', roles: [{ id: 'b' }] }));
      const none = await run('logs', cwd, ['beta']);
      expect(none?.success).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('run --dry-run prints role briefings without starting sessions', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-dry-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'alpha.json'), JSON.stringify({
        name: 'alpha', goal: 'ship', roles: [
          { id: 'boss', reports_to: null, responsibilities: ['lead'] },
          { id: 'coder', reports_to: 'boss' },
        ],
      }));
      const res = await run('run', cwd, ['alpha'], { dryRun: true });
      expect(res?.success).toBe(true);
      expect(res?.message).toMatch(/dry run/);
      expect(existsSync(join(cwd, ORG_DIR, 'alpha', 'runtime.json'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('listRunDirs/readRunEvents round-trip', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-runs-'));
    try {
      seedRun(cwd, 'alpha', 'run-20260101000000-aaaa', [ev({})]);
      seedRun(cwd, 'alpha', 'run-20260102000000-bbbb', [ev({}), ev({})]);
      const runs = listRunDirs(cwd, 'alpha');
      expect(runs[0]).toBe('run-20260102000000-bbbb'); // newest first
      expect(readRunEvents(cwd, 'alpha', runs[0])).toHaveLength(2);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('org command — questions/answer (HIL)', () => {
  const sub = (n: string) => orgCommand.subcommands!.find(c => c.name === n)!;
  const run = (n: string, cwd: string, args: string[], flags: Record<string, unknown> = {}) =>
    sub(n).action!({ args, flags, cwd, interactive: false } as any);

  const seedQuestions = (cwd: string, org: string): void => {
    mkdirSync(join(cwd, ORG_DIR, org), { recursive: true });
    writeFileSync(join(cwd, ORG_DIR, `${org}.json`), JSON.stringify({ name: org, roles: [{ id: 'boss' }] }));
    writeFileSync(join(cwd, ORG_DIR, org, 'questions.json'), JSON.stringify({
      questions: [
        { questionId: 'q-1', role: 'boss', question: 'ship it?', ts: 1784500000000, answer: null, answeredAt: null },
        { questionId: 'q-0', role: 'boss', question: 'old one', ts: 1784400000000, answer: 'done', answeredAt: 1784400001000 },
      ],
    }));
  };

  it('questions lists only pending by default', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-q-'));
    try {
      seedQuestions(cwd, 'alpha');
      const res = await run('questions', cwd, ['alpha']);
      expect(res?.success).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('answer records an offline answer and queues delivery for the next run', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-a-'));
    try {
      seedQuestions(cwd, 'alpha');
      const res = await run('answer', cwd, ['alpha', 'q-1', 'yes', 'ship', 'it']);
      expect(res?.success).toBe(true);
      const saved = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'alpha', 'questions.json'), 'utf8'));
      expect(saved.questions.find((q: any) => q.questionId === 'q-1').answer).toBe('yes ship it');
      const inbox = readFileSync(join(cwd, ORG_DIR, 'alpha', 'inbox.jsonl'), 'utf8').trim();
      expect(JSON.parse(inbox)).toMatchObject({ toRole: 'boss', subject: 'answer:q-1' });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('answer rejects unknown ids, already-answered questions, and missing text', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-a-'));
    try {
      seedQuestions(cwd, 'alpha');
      expect((await run('answer', cwd, ['alpha', 'q-9', 'x']))?.success).toBe(false);
      expect((await run('answer', cwd, ['alpha', 'q-0', 'x']))?.success).toBe(false);
      expect((await run('answer', cwd, ['alpha', 'q-1']))?.success).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
