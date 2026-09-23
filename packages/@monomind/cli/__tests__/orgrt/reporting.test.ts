// packages/@monomind/cli/__tests__/orgrt/reporting.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  summarizeRun,
  formatEvent,
  readRunEvents,
  readHistory,
  listRunDirs,
  describeRunOutcome,
  type RunSummary,
} from '../../src/orgrt/reporting.js';
import { ORG_TEMPLATES, buildFromTemplate } from '../../src/orgrt/templates.js';
import { OrgDefSchema, ORG_DIR, type BusEvent } from '../../src/orgrt/types.js';
import { DEFAULT_CLAUDE_MODEL } from '../../src/orgrt/vercel-providers.js';
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
    expect(s.roles.tester.crashed).toBe(true);
    expect(s.roles.coder).toMatchObject({ messagesSent: 1, toolsAllowed: 1, toolsDenied: 1, tokens: 500 });
    expect(s.totalTokens).toBe(800);
    expect(s.totalCostUsd).toBeCloseTo(0.01);
    expect(s.outcome).toEqual({ status: 'achieved', summary: 'shipped it', by: 'boss' });
    expect(s.durationMs).toBe(60_000);
  });

  it('splits a role\'s tokens into the uncached (input+output) basis and cache tokens', () => {
    const s = summarizeRun([
      ev({ type: 'usage', from: 'boss', data: { tokens: 1_100, tokens_in: 60, tokens_out: 40, cache_read: 900, cache_creation: 100 } }),
      // a pre-breakdown event: no split recorded, so it all counts as uncached
      ev({ type: 'usage', from: 'boss', data: { tokens: 50 } }),
    ]);
    expect(s.roles.boss).toMatchObject({ tokens: 1_150, uncachedTokens: 150 });
  });

  it('handles an empty event list', () => {
    const s = summarizeRun([]);
    expect(s.events).toBe(0);
    expect(s.outcome).toBeNull();
    expect(s.durationMs).toBeNull();
    expect(s.runnableTasksAtStop).toBe(0);
    expect(s.closedBy).toBeUndefined();
  });

  // #302 (review finding 1): blocker/blockerDetail are recorded TOP-LEVEL,
  // NOT nested inside `outcome` — a sibling of `outcome`, matching
  // `crashes`/`cutShort`'s own pattern. `outcome` is null on every stop path
  // that isn't a genuinely allowed org_complete call, so a field nested
  // inside it would be structurally unreachable on any other path; a
  // top-level field can be read (or, for a future path, populated)
  // independently of whether `outcome` itself ever gets set.
  it('records blocker and blockerDetail TOP-LEVEL, not nested inside outcome', () => {
    const s = summarizeRun([
      ev({
        type: 'status',
        from: 'boss',
        reason: 'org-complete',
        data: {
          outcome: 'partial',
          summary: 'stopped here',
          blocker: 'external',
          blockerDetail: 'waiting on the vendor API key',
        },
      }),
    ]);
    expect(s.outcome).toEqual({ status: 'partial', summary: 'stopped here', by: 'boss' });
    expect(s.blocker).toBe('external');
    expect(s.blockerDetail).toBe('waiting on the vendor API key');
  });

  // #302 truth gate: the 'org-stopped' event finishStop always emits carries
  // how the run actually ended, independent of whether a genuine `outcome`
  // exists — an idle-stopped run with a full backlog has NO outcome (no
  // org_complete was ever allowed) but must still record its real cause.
  it("captures closedBy and runnableTasksAtStop from the 'org-stopped' event", () => {
    const s = summarizeRun([
      ev({ type: 'status', reason: 'org-stopped', data: { closedBy: 'idle-stop', runnableTasks: 3 } }),
    ]);
    expect(s.outcome).toBeNull();
    expect(s.closedBy).toBe('idle-stop');
    expect(s.runnableTasksAtStop).toBe(3);
  });
});

describe('describeRunOutcome', () => {
  const base: RunSummary = {
    org: 'alpha',
    run: 'run-1',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    events: 0,
    messages: 0,
    xorgMessages: 0,
    assets: [],
    crashes: [],
    cutShort: [],
    outcome: null,
    runnableTasksAtStop: 0,
    roles: {},
    totalTokens: 0,
    totalCostUsd: 0,
  };

  it('reports the genuine outcome status when one exists', () => {
    expect(
      describeRunOutcome({ ...base, outcome: { status: 'partial', summary: '', by: 'boss' } }),
    ).toBe('partial');
  });

  it('reports "crashed" when there is a real crash and no genuine outcome', () => {
    expect(describeRunOutcome({ ...base, crashes: ['coder'] })).toBe('crashed');
  });

  // The exact bug #302 closes: before this item, a null outcome with no
  // crashes always rendered as "completed" — indistinguishable from a boss
  // that actually finished cleanly.
  it('reports the real closedBy cause, not "completed", for an automated stop with no genuine outcome', () => {
    expect(describeRunOutcome({ ...base, closedBy: 'idle-stop' })).toBe('idle-stop');
  });

  it('includes the runnable task count when work was left outstanding', () => {
    expect(describeRunOutcome({ ...base, closedBy: 'idle-stop', runnableTasksAtStop: 4 })).toBe(
      'idle-stop (4 task(s) left)',
    );
  });

  // #302 review: `org mark-complete` writes closedBy: 'mark-complete'
  // straight to runtime.json (never through finishStop), so this truth gate
  // never tags it and runnableTasksAtStop is never populated for it either.
  // In practice that run has no history.jsonl entry at all — but if a
  // RunSummary-shaped object ever DID carry an untagged closedBy with no
  // count, this must not claim a false "0 task(s) left"; it must simply
  // name the cause and say nothing about count, the same as any other
  // closedBy this gate didn't itself produce.
  it('names an untagged closedBy (e.g. mark-complete) without inventing a task count', () => {
    expect(describeRunOutcome({ ...base, closedBy: 'mark-complete' })).toBe('mark-complete');
  });

  it('falls back to "completed" only for a bare manual stop — no outcome, no crash, no automated closedBy', () => {
    expect(describeRunOutcome({ ...base })).toBe('completed');
  });

  it('does not treat closedBy: "org-complete" as an automated-stop cause to print', () => {
    // A genuine org-complete always carries `outcome` too in real data, but
    // this pins the describeRunOutcome logic itself: closedBy === 'org-complete'
    // must never fall into the "(N task(s) left)" branch even if outcome is
    // somehow missing.
    expect(describeRunOutcome({ ...base, closedBy: 'org-complete', runnableTasksAtStop: 2 })).toBe(
      'completed',
    );
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

  it('marks the rendered time as UTC with a trailing Z (#253)', () => {
    const ts = Date.parse('2026-08-25T08:03:18Z');
    for (const e of [
      ev({ ts, type: 'message', from: 'a', to: 'b', subject: 's', msg: 'hi' }),
      ev({ ts, type: 'chat', from: 'a', msg: 'hi' }),
      ev({ ts, type: 'audit', from: 'a', msg: 'crashed' }),
      ev({ ts, type: 'status', from: 'a', msg: 'up' }),
    ]) {
      expect(formatEvent(e).startsWith('08:03:18Z ')).toBe(true);
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
    writeFileSync(join(dir, 'bus.jsonl'), `${events.map(e => JSON.stringify(e)).join('\n')}\n`);
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
      // every role is written with an explicit model — none left to a runtime default
      for (const role of def.roles) {
        expect(role.adapter_config?.model, role.id).toBeTruthy();
      }
      expect(def.roles.find((r: { id: string }) => r.id === 'writer').adapter_config.model).toBe(
        DEFAULT_CLAUDE_MODEL,
      );
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

  // Improvement 11: the per-role budget % must be computed on the basis the
  // policy enforces (input+output by default), not the billable total that
  // includes cache reads — otherwise every well-cached role reads EXHAUSTED.
  it('report compares the budget on the enforced (uncached) basis and labels cache tokens', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-'));
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    try {
      seedRun(cwd, 'alpha', 'run-20260101000000-bbbb', [
        ev({ type: 'usage', from: 'boss', data: { tokens: 41_955_000, tokens_in: 5_000, tokens_out: 60_000, cache_read: 41_000_000, cache_creation: 890_000 } }),
      ]);
      writeFileSync(join(cwd, ORG_DIR, 'alpha.json'), JSON.stringify({ name: 'alpha', run_config: { budget_tokens: 500_000 }, roles: [{ id: 'boss' }] }));
      expect((await run('report', cwd, ['alpha']))?.success).toBe(true);
      const bossLine = lines.find(l => l.includes('boss:'))!;
      expect(bossLine).toContain('13% of 500000 in+out');
      expect(bossLine).toContain('41890000 cache');
      expect(bossLine).not.toContain('EXHAUSTED');
    } finally { spy.mockRestore(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('report compares on the billable total when the org opts into budget_tokens_basis billable', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-'));
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    try {
      seedRun(cwd, 'alpha', 'run-20260101000000-cccc', [
        ev({ type: 'usage', from: 'boss', data: { tokens: 600_000, tokens_in: 50_000, tokens_out: 50_000, cache_read: 500_000, cache_creation: 0 } }),
      ]);
      writeFileSync(join(cwd, ORG_DIR, 'alpha.json'), JSON.stringify({ name: 'alpha', run_config: { budget_tokens: 500_000, budget_tokens_basis: 'billable' }, roles: [{ id: 'boss' }] }));
      expect((await run('report', cwd, ['alpha']))?.success).toBe(true);
      const bossLine = lines.find(l => l.includes('boss:'))!;
      expect(bossLine).toContain('120% of 500000 billable');
      expect(bossLine).toContain('EXHAUSTED');
    } finally { spy.mockRestore(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('report --all reads history.jsonl', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-'));
    try {
      seedRun(cwd, 'alpha', 'run-1', [ev({})]);
      const summary = summarizeRun([ev({ type: 'message', from: 'boss', to: 'x', subject: 's' })]);
      writeFileSync(join(cwd, ORG_DIR, 'alpha', 'history.jsonl'), `${JSON.stringify(summary)}\n`);
      const res = await run('report', cwd, ['alpha'], { all: true });
      expect(res?.success).toBe(true);
      expect(readHistory(cwd, 'alpha')).toHaveLength(1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  const captureLog = (): { lines: string[]; restore: () => void } => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    return { lines, restore: () => spy.mockRestore() };
  };

  it('logs marks event times as UTC (#253)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-logs-'));
    const out = captureLog();
    try {
      seedRun(cwd, 'alpha', 'run-2', [ev({ ts: Date.parse('2026-08-25T08:03:18Z'), type: 'chat', from: 'boss', msg: 'hello' })]);
      expect((await run('logs', cwd, ['alpha']))?.success).toBe(true);
      expect(out.lines).toContain('08:03:18Z 💬 boss: hello');
    } finally { out.restore(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('status marks "quiet since" as UTC (#253)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-status-'));
    const out = captureLog();
    try {
      seedRun(cwd, 'alpha', 'run-3', [ev({ ts: Date.parse('2026-08-25T08:03:18Z'), type: 'chat', from: 'boss', msg: 'x' })]);
      writeFileSync(join(cwd, ORG_DIR, 'alpha', 'runtime.json'), JSON.stringify({ status: 'running', run: 'run-3', pid: process.pid }));
      expect((await run('status', cwd, ['alpha']))?.success).toBe(true);
      expect(out.lines.some(l => l.includes('quiet since: 08:03:18Z ('))).toBe(true);
    } finally { out.restore(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('approvals marks request times as UTC (#253)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-appr-'));
    const out = captureLog();
    try {
      mkdirSync(join(cwd, ORG_DIR, 'alpha'), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'alpha.json'), JSON.stringify({ name: 'alpha', roles: [{ id: 'boss' }] }));
      writeFileSync(join(cwd, ORG_DIR, 'alpha', 'approvals.json'), JSON.stringify({
        approvals: [{ roleId: 'boss', action: 'deploy', question: 'ok?', ts: Date.parse('2026-08-25T08:03:18Z'), approved: null }],
      }));
      expect((await run('approvals', cwd, ['alpha']))?.success).toBe(true);
      expect(out.lines.some(l => l.includes('2026-08-25 08:03Z  boss: deploy'))).toBe(true);
    } finally { out.restore(); rmSync(cwd, { recursive: true, force: true }); }
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

  it('questions marks ask times as UTC (#253)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-q-'));
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    try {
      seedQuestions(cwd, 'alpha');
      expect((await run('questions', cwd, ['alpha']))?.success).toBe(true);
      expect(lines.some(l => l.includes('[q-1] 2026-07-19 22:26Z  boss: ship it?'))).toBe(true);
    } finally { spy.mockRestore(); rmSync(cwd, { recursive: true, force: true }); }
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
