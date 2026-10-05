// packages/@monomind/cli/__tests__/orgrt/bash-deadline.test.ts
//
// Found in the hardened parallel-sweep-3 trial (2026-10-05): one role's own shell script hung for
// the whole 10-minute Bash timeout, which was most of the 720 s run, and the run ended before its
// last modules were written. A run may now declare run_config.deadline_seconds; while it does, a
// role's Bash call is capped to a fraction of the time that is left (never above the role's usual
// Bash timeout), so a hung command costs a fraction of the remaining time and the role can recover.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASH_DEADLINE_FRACTION,
  BASH_DEADLINE_MIN_MS,
  capBashTimeoutMs,
  DEFAULT_CLAUDE_BASH_TIMEOUT_MS,
} from '../../src/orgrt/bash-timeout.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runStartMs } from '../../src/orgrt/run-start.js';
import { coverEveryToolCall } from '../../src/orgrt/policy-hook.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

describe('capBashTimeoutMs', () => {
  const MAX = DEFAULT_CLAUDE_BASH_TIMEOUT_MS;
  it('takes a fraction of the time left, never above the usual Bash timeout', () => {
    expect(BASH_DEADLINE_FRACTION).toBe(0.4);
    expect(capBashTimeoutMs({ remainingMs: 650_000, maxMs: MAX })).toBe(260_000);
    expect(capBashTimeoutMs({ remainingMs: 3_600_000, maxMs: MAX })).toBe(MAX);
    expect(capBashTimeoutMs({ remainingMs: 3_600_000, maxMs: 120_000 })).toBe(120_000);
  });
  it('keeps a smaller request and lowers a larger one', () => {
    expect(capBashTimeoutMs({ remainingMs: 650_000, requestedMs: 60_000, maxMs: MAX })).toBe(60_000);
    expect(capBashTimeoutMs({ remainingMs: 650_000, requestedMs: 500_000, maxMs: MAX })).toBe(260_000);
  });
  it('never goes below a floor while time is left, and never beyond the time left', () => {
    expect(capBashTimeoutMs({ remainingMs: 50_000, maxMs: MAX })).toBe(BASH_DEADLINE_MIN_MS);
    expect(capBashTimeoutMs({ remainingMs: 10_000, maxMs: MAX })).toBe(10_000);
  });
  it('past the deadline still gives a short call, not zero', () => {
    expect(capBashTimeoutMs({ remainingMs: -5_000, maxMs: MAX })).toBe(5_000);
  });
});

describe('a run deadline in the policy', () => {
  const bus = () => new OrgBus('o', 'r', mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'bd-bus-')));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('caps a Bash call to the fraction of the time left, whatever it asked for', async () => {
    const p = new PolicyEngine('coder', {}, bus(), '/work');
    p.setRunDeadline(1_000_000 + 650_000);
    const d = await p.decide('Bash', { command: 'make' });
    expect(d).toMatchObject({ behavior: 'allow', updatedInput: { command: 'make', timeout: 260_000 } });
    const asked = await p.decide('Bash', { command: 'make', timeout: 500_000 });
    expect((asked as any).updatedInput.timeout).toBe(260_000);
    const small = await p.decide('Bash', { command: 'make', timeout: 20_000 });
    expect((small as any).updatedInput.timeout).toBe(20_000);
  });

  it('shrinks as the run goes on', async () => {
    const p = new PolicyEngine('coder', {}, bus(), '/work');
    p.setRunDeadline(1_000_000 + 650_000);
    vi.setSystemTime(1_000_000 + 600_000);
    const d = await p.decide('Bash', { command: 'make' });
    expect((d as any).updatedInput.timeout).toBe(BASH_DEADLINE_MIN_MS);
  });

  it('does not touch other tools, and does nothing without a deadline', async () => {
    const p = new PolicyEngine('coder', {}, bus(), '/work');
    const plain = await p.decide('Bash', { command: 'make' });
    expect((plain as any).updatedInput).toEqual({ command: 'make' });
    p.setRunDeadline(1_000_000 + 650_000);
    const read = await p.decide('Read', { file_path: '/work/a.ts' });
    expect((read as any).updatedInput).toEqual({ file_path: '/work/a.ts' });
  });

  it('a role with a larger bash_timeout_ms keeps it up to the cap of the time left', async () => {
    const p = new PolicyEngine('coder', {}, bus(), '/work');
    p.setRunDeadline(1_000_000 + 3_600_000, 3_000_000);
    const d = await p.decide('Bash', { command: 'make', timeout: 3_000_000 });
    expect((d as any).updatedInput.timeout).toBe(1_440_000);
  });
});

describe('the policy hook applies the changed input to calls the CLI allows by itself', () => {
  const gate = async (_t: string, input: Record<string, unknown>) => ({
    behavior: 'allow',
    updatedInput: { ...input, timeout: 30_000 },
  });
  it('asks the CLI to continue with the capped input', async () => {
    const hook = coverEveryToolCall(gate as any);
    const out = (await hook.preToolUse({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'u1',
    })) as any;
    expect(out.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      updatedInput: { command: 'ls', timeout: 30_000 },
    });
  });
  it('stays silent when the input did not change, and canUseTool answers a capped call without deciding twice', async () => {
    const same = async (_t: string, input: Record<string, unknown>) => ({ behavior: 'allow', updatedInput: input });
    const h1 = coverEveryToolCall(same as any);
    expect(await h1.preToolUse({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'u2' })).toEqual({});
    let n = 0;
    const capped = async (_t: string, input: Record<string, unknown>) => (n++, { behavior: 'allow', updatedInput: { ...input, timeout: 1000 } });
    const h2 = coverEveryToolCall(capped as any);
    await h2.preToolUse({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'u3' });
    await h2.canUseTool('Bash', { command: 'ls', timeout: 1000 }, { toolUseId: 'u3' });
    expect(n).toBe(1);
  });
});

describe('run_config.deadline_seconds', () => {
  const def = (rc: Record<string, unknown>) =>
    OrgDefSchema.safeParse({ name: 'o', roles: [{ id: 'boss' }], run_config: { idle_minutes: 0, ...rc } });
  it('is an optional positive integer', () => {
    expect(def({}).success).toBe(true);
    expect(def({ deadline_seconds: 720 }).success).toBe(true);
    expect(def({ deadline_seconds: 0 }).success).toBe(false);
    expect(def({ deadline_seconds: 1.5 }).success).toBe(false);
  });
});

describe('a real daemon with a deadline', () => {
  let root: string;
  const daemons: OrgDaemon[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'bd-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  });
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const gateOf = async (rc: Record<string, unknown>) => {
    const raw = { name: 'dl-org', goal: 'g', roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null, policy: { sandbox: { mode: 'off' } } }], run_config: { idle_minutes: 0, ...rc } };
    writeFileSync(join(root, '.monomind/orgs/dl-org.json'), JSON.stringify(raw));
    const seen: any[] = [];
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        seen.push(options);
        for await (const m of prompt) {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo ${m.message.content}` }] } };
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    await d.startOrg('dl-org', undefined, { autoApprove: ['Bash'] });
    for (let i = 0; i < 200 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    return seen[0];
  };

  it('a role of an org with deadline_seconds gets its Bash calls capped', async () => {
    const options = await gateOf({ deadline_seconds: 720 });
    const d = await options.canUseTool('Bash', { command: 'make' }, { toolUseID: 'x1' });
    expect(d.behavior).toBe('allow');
    expect(d.updatedInput.timeout).toBeLessThanOrEqual(Math.floor(720_000 * 0.4));
    expect(d.updatedInput.timeout).toBeGreaterThan(200_000);
  });

  it('an org without one is untouched', async () => {
    const options = await gateOf({});
    const d = await options.canUseTool('Bash', { command: 'make' }, { toolUseID: 'x2' });
    expect(d.updatedInput).toEqual({ command: 'make' });
  });
});

describe('the run start the deadline counts from', () => {
  it('is read from the run id (UTC), and absent for anything else', () => {
    expect(runStartMs('run-20261005022354-zokh')).toBe(Date.UTC(2026, 9, 5, 2, 23, 54));
    expect(runStartMs('not-a-run')).toBeUndefined();
    expect(runStartMs('run-20269999999999-zzzz')).toBeUndefined();
  });
});

describe('the real start and resume paths fix the run start', () => {
  let root: string;
  const daemons: OrgDaemon[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'bd-start-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    const raw = { name: 'st-org', goal: 'g', roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null, policy: { sandbox: { mode: 'off' } } }], run_config: { idle_minutes: 0, deadline_seconds: 720 } };
    writeFileSync(join(root, '.monomind/orgs/st-org.json'), JSON.stringify(raw));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const mk = (seen: any[]) => {
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        seen.push(options);
        for await (const m of prompt) {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo ${m.message.content}` }] } };
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    return d;
  };
  const waitSeen = async (seen: any[], n: number) => {
    for (let i = 0; i < 200 && seen.length < n; i++) await new Promise((r) => setTimeout(r, 25));
  };

  it('a fresh start sets startedAtMs to the run id time', async () => {
    const seen: any[] = [];
    const running = await mk(seen).startOrg('st-org', undefined, { autoApprove: ['Bash'] });
    expect(running.startedAtMs).toBeDefined();
    expect(running.startedAtMs).toBe(runStartMs(running.run));
    expect(Math.abs((running.startedAtMs as number) - Date.now())).toBeLessThan(2_500);
  });

  it('a resume keeps the ORIGINAL start, so the deadline does not restart with it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 5, 10, 0, 0));
    const first: any[] = [];
    const d1 = mk(first);
    const run1 = await d1.startOrg('st-org', undefined, { autoApprove: ['Bash'] });
    const started = run1.startedAtMs as number;
    expect(started).toBe(Date.UTC(2026, 9, 5, 10, 0, 0));
    await d1.stopOrg('st-org');
    vi.setSystemTime(Date.UTC(2026, 9, 5, 10, 30, 0)); // 30 minutes later
    const second: any[] = [];
    const d2 = mk(second);
    const run2 = await d2.startOrg('st-org', undefined, { resume: true, autoApprove: ['Bash'] });
    expect(run2.run).toBe(run1.run);
    expect(run2.startedAtMs).toBe(started);
    await waitSeen(second, 1);
    const d = await second[0].canUseTool('Bash', { command: 'make' }, { toolUseID: 'r1' });
    expect(d.updatedInput.timeout).toBe(5_000); // the 720 s deadline passed long ago
  });
});
