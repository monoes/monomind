/**
 * ADR-O001 D6 — reviewer sessions are cold and artifact-only.
 *
 * Measured: 223 verdicts still shipped five controls that could not fail; in
 * three cases the verifier failed a sha the reviewer had approved. A reviewer
 * that watched the work absorbs the doer's framing, so it gets the diff, the
 * acceptance commands with their output, and the issue text — never the
 * thread, the doer's reasoning, prior rounds, or the attempt count.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { buildOrgTools, runAgentSession } from '../../src/orgrt/session.js';
import { SessionLedger, resolveSessionScope } from '../../src/orgrt/session-ledger.js';
import { buildReviewPacket, reviewDiff } from '../../src/orgrt/review-packet.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe('D6 cold scope', () => {
  it('an artifact-only role is cold regardless of the org scope', () => {
    const rev = { id: 'rev', reports_to: 'boss', review_input: 'artifact-only' } as any;
    expect(resolveSessionScope(rev, { run_config: {} } as any)).toBe('cold');
    expect(resolveSessionScope(rev, { run_config: { session_scope: 'task' } } as any)).toBe('cold');
    expect(resolveSessionScope({ ...rev, review_input: undefined }, { run_config: {} } as any)).toBe('role');
  });

  it('serves every message from a NEW model session and never resumes', async () => {
    const calls: { resume?: string; seen: string[] }[] = [];
    let n = 0;
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        const call = { resume: options?.resume, seen: [] as string[] };
        calls.push(call);
        const sid = options?.resume ?? `sid-${++n}`;
        yield { type: 'system', subtype: 'init', session_id: sid };
        for await (const m of prompt) {
          call.seen.push(m.message.content);
          yield { type: 'result', subtype: 'success', session_id: sid, usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const bus = new OrgBus('o', 'r', tmp('d6-'));
    const mailbox = new Mailbox();
    const ledger = new SessionLedger();
    mailbox.push('[review:task-1] packet one');
    mailbox.push('[review:task-1] packet two (a second round)');
    const done = runAgentSession({
      org: 'o',
      role: { id: 'rev', title: 'Rev', type: 'reviewer', reports_to: 'boss', review_input: 'artifact-only' } as any,
      bus,
      policy: new PolicyEngine('rev', {}, bus, '/work'),
      mailbox,
      cwd: '/work',
      deliver: async () => 'ok',
      queryFn: queryFn as any,
      sessionLedger: ledger,
      resumeSessionId: 'checkpointed-sid',
    });
    await tick(40);
    mailbox.close();
    await done;
    expect(calls.map((c) => c.seen)).toEqual([
      ['[review:task-1] packet one'],
      ['[review:task-1] packet two (a second round)'],
    ]);
    expect(calls.map((c) => c.resume)).toEqual([undefined, undefined]);
    expect(ledger.runs().map((r) => r.reason)).toEqual(['fresh-cold', 'fresh-cold']);
  });
});

describe('D6 review packet', () => {
  function repo(): { dir: string; sha: string } {
    const dir = tmp('d6-git-');
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feat');
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 2;\n');
    git('commit', '-qam', 'change a');
    return { dir, sha: git('rev-parse', 'HEAD') };
  }

  it("contains the issue, the runtime's diff, and every command with exit code and output", () => {
    const { dir, sha } = repo();
    const diff = reviewDiff(dir, 'main', sha);
    const packet = buildReviewPacket({
      taskId: 'task-7',
      issue: 'Make a equal 2',
      evidence: { headSha: sha, checks: [{ command: 'pnpm test', exitCode: 0, output: '12 passed' }] },
      diff,
      replyTo: 'dev-lead',
    });
    expect(packet.startsWith('[review:task-7]')).toBe(true);
    expect(packet).toContain('Make a equal 2');
    expect(packet).toContain('-export const a = 1;');
    expect(packet).toContain('+export const a = 2;');
    expect(packet).toContain('$ pnpm test');
    expect(packet).toContain('exit 0');
    expect(packet).toContain('12 passed');
    expect(packet).toContain(sha);
    expect(packet).toContain('dev-lead');
  });

  it('says plainly when the diff cannot be produced instead of inventing one', () => {
    const diff = reviewDiff(tmp('d6-nogit-'), 'main', 'deadbeef');
    expect(diff.ok).toBe(false);
    const packet = buildReviewPacket({
      taskId: 't',
      issue: 'x',
      evidence: { headSha: 'deadbeef', checks: [] },
      diff,
      replyTo: 'b',
    });
    expect(packet).toMatch(/diff unavailable/i);
  });

  // A check whose correct outcome is non-zero must not read as a failure to
  // the reviewer — and the task row must keep what was expected.
  it('shows a declared expectExit next to the exit code, and the task row keeps it', () => {
    const packet = buildReviewPacket({
      taskId: 't',
      issue: 'x',
      evidence: {
        headSha: 'abc1234',
        checks: [{ command: 'git config --get x.unset', exitCode: 1, expectExit: 1 }],
      },
      diff: { ok: true, text: '' },
      replyTo: 'b',
    });
    expect(packet).toContain('→ exit 1 (expected 1)');

    const dag = new TaskDag();
    const t = dag.add('t', 'dev');
    dag.recordEvidence(t.id, {
      headSha: 'abc1234',
      checks: [{ command: 'git config --get x.unset', exitCode: 1, expectExit: 1 }],
    });
    expect(dag.get(t.id)?.lastEvidence?.checks[0]?.expectExit).toBe(1);
  });

  it('caps a huge command output and a huge diff', () => {
    const big = 'x'.repeat(200_000);
    const packet = buildReviewPacket({
      taskId: 't',
      issue: 'x',
      evidence: { headSha: 'abc1234', checks: [{ command: 'c', exitCode: 1, output: big }] },
      diff: { ok: true, text: big },
      replyTo: 'b',
    });
    expect(packet.length).toBeLessThan(80_000);
    expect(packet).toMatch(/truncated/);
  });

  it('the task row keeps only the LATEST submitted evidence, with outputs capped', () => {
    const dag = new TaskDag();
    const t = dag.add('t', 'dev');
    dag.recordEvidence(t.id, { headSha: 'aaaaaaa', checks: [{ command: 'old', exitCode: 1 }] });
    dag.recordEvidence(t.id, { headSha: 'bbbbbbb', checks: [{ command: 'new', exitCode: 0, output: 'y'.repeat(50_000) }] });
    const ev = dag.get(t.id)!.lastEvidence!;
    expect(ev.headSha).toBe('bbbbbbb');
    expect(ev.checks.map((c) => c.command)).toEqual(['new']);
    expect(ev.checks[0].output!.length).toBeLessThan(10_000);
  });
});

describe('D6 default off', () => {
  it('adds no org_review tool unless the org has an artifact-only role', () => {
    const bus = new OrgBus('o', 'r', tmp('d6-tools-'));
    const base = {
      org: 'o',
      role: { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss' } as any,
      bus,
      policy: new PolicyEngine('dev', {}, bus, '/w'),
      mailbox: new Mailbox(),
      cwd: '/w',
      deliver: async () => 'ok',
    };
    expect(buildOrgTools(base as any).map((t) => t.name)).not.toContain('org_review');
    const withReview = buildOrgTools({ ...base, requestReview: () => 'ok' } as any);
    expect(withReview.map((t) => t.name)).toContain('org_review');
  });

  it('the schema accepts review_input and adds nothing when absent', () => {
    const minimal = { name: 'o', goal: 'g', roles: [{ id: 'boss', title: 'B', type: 'b' }] };
    expect('review_input' in OrgDefSchema.parse(minimal).roles[0]).toBe(false);
    const def = OrgDefSchema.parse({
      ...minimal,
      roles: [...minimal.roles, { id: 'rev', title: 'R', type: 'r', reports_to: 'boss', review_input: 'artifact-only' }],
    });
    expect(def.roles[1].review_input).toBe('artifact-only');
    expect(() =>
      OrgDefSchema.parse({ ...minimal, roles: [{ ...minimal.roles[0], review_input: 'everything' }] }),
    ).toThrow();
  });
});
