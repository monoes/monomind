/**
 * ORG-1 regression: `recordDecision` existed in decisions.ts but had zero
 * callers anywhere in the codebase, so `org decisions` always reported "No
 * decision traces" even on runs with real gate denials, approvals, and
 * cross-org handoffs. This wires (and tests) the 3 natural decision points:
 *  1. gatedCanUseTool denying a tool call (session.ts's onDeny hook, wired in
 *     daemon.ts's sessionOpts.onDecision to daemon.recordDecision()).
 *  2. An approval request resolving — approvals.ts's setApproval().
 *  3. A cross-org deliver() handoff succeeding — cross-org.ts's deliver().
 *
 * Each case triggers the real code path and asserts the resulting decision
 * trace is both persisted to bus.jsonl and visible via `org decisions`
 * (org-observe.ts's decisionsAction / readRunEvents).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon, type RunningOrg, type AgentRuntime } from '../orgrt/daemon.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { gatedCanUseTool } from '../orgrt/session.js';
import type { Decision, PolicyEngine } from '../orgrt/policy.js';
import { readRunEvents } from '../orgrt/reporting.js';
import { decisionsAction } from '../commands/org-observe.js';
import { ORG_DIR, type OrgDef } from '../orgrt/types.js';

function minimalDef(name: string): OrgDef {
  return { name, goal: 'test', roles: [{ id: 'dev' }], run_config: {} } as unknown as OrgDef;
}

function makeAgent(): AgentRuntime {
  return {
    mailbox: new Mailbox(),
    policy: {} as unknown as PolicyEngine,
    done: Promise.resolve(),
    status: 'running',
    metrics: { tokens: 0, costUsd: 0 },
    scrollback: { push: () => {}, all: () => [] } as any,
  };
}

describe('ORG-1: recordDecision wired into real decision points', () => {
  let tmp = '';
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('records a decision trace when an approval request resolves', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-approval-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const running: RunningOrg = {
      def: minimalDef('alpha'), run: 'run-1', bus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
    };
    daemon.orgs.set('alpha', running);
    daemon.approvals.set('alpha', [{ roleId: 'dev', action: 'Bash', question: 'Approve Bash?', ts: Date.now(), approved: null }]);

    const result = await daemon.setApproval('alpha', 'dev', 'Bash', true);
    expect(result.ok).toBe(true);
    await bus.flush();

    const events = readRunEvents(tmp, 'alpha', 'run-1');
    const trace = events.find(e => e.type === 'audit' && e.reason === 'decision-trace');
    expect(trace).toBeTruthy();
    expect((trace!.data as any).decisionType).toBe('approval');
    expect((trace!.data as any).outcome).toBe('approved');

    const cliResult = await decisionsAction({ cwd: tmp, args: ['alpha'], flags: {} } as any, 'alpha');
    expect(cliResult.success).toBe(true);
    expect(cliResult.message).toContain('1 decision traces');
  });

  it('records a decision trace when a cross-org deliver() handoff succeeds', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-handoff-'));
    const daemon = new OrgDaemon(tmp);

    const alphaBus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const alpha: RunningOrg = {
      def: minimalDef('alpha'), run: 'run-1', bus: alphaBus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
    };
    const betaBus = new OrgBus('beta', 'run-1', join(tmp, ORG_DIR, 'beta', 'run-1'));
    const beta: RunningOrg = {
      def: minimalDef('beta'), run: 'run-1', bus: betaBus,
      agents: new Map([['worker', makeAgent()]]),
      busEvents: () => [],
    };
    daemon.orgs.set('alpha', alpha);
    daemon.orgs.set('beta', beta);

    const receipt = await daemon.deliver('alpha', 'dev', 'beta:worker', 'status update', 'work is done');
    expect(receipt).toBe('delivered to beta:worker');
    await alphaBus.flush();

    const events = readRunEvents(tmp, 'alpha', 'run-1');
    const trace = events.find(e => e.type === 'audit' && e.reason === 'decision-trace');
    expect(trace).toBeTruthy();
    expect((trace!.data as any).decisionType).toBe('handoff');
    expect((trace!.data as any).outcome).toBe('delivered');

    const cliResult = await decisionsAction({ cwd: tmp, args: ['alpha'], flags: {} } as any, 'alpha');
    expect(cliResult.success).toBe(true);
    expect(cliResult.message).toContain('1 decision traces');
  });

  it('records a decision trace when gatedCanUseTool denies a tool call (the wiring daemon.ts uses)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-deny-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const running: RunningOrg = {
      def: minimalDef('alpha'), run: 'run-1', bus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
    };
    daemon.orgs.set('alpha', running);

    const denyingPolicy = {
      decide: async (): Promise<Decision> => ({ behavior: 'deny', message: 'Bash is not allowed for this role' }),
    } as unknown as PolicyEngine;

    // Mirrors daemon.ts's sessionOpts.onDecision wiring exactly.
    const onDecision = (role: string, toolName: string, message: string) => {
      daemon.recordDecision('alpha', role, {
        type: 'tool',
        context: `tool call: ${toolName}`,
        reasoning: message,
        outcome: 'denied',
      });
    };
    const canUseTool = gatedCanUseTool(denyingPolicy, undefined, 'dev', undefined,
      (toolName, _input, decision) => onDecision('dev', toolName, decision.message ?? 'denied'));

    const decision = await canUseTool('Bash', { command: 'rm -rf /' });
    expect(decision.behavior).toBe('deny');
    await bus.flush();

    const events = readRunEvents(tmp, 'alpha', 'run-1');
    const trace = events.find(e => e.type === 'audit' && e.reason === 'decision-trace');
    expect(trace).toBeTruthy();
    expect((trace!.data as any).decisionType).toBe('tool');
    expect((trace!.data as any).outcome).toBe('denied');
    expect((trace!.data as any).context).toContain('Bash');

    const cliResult = await decisionsAction({ cwd: tmp, args: ['alpha'], flags: {} } as any, 'alpha');
    expect(cliResult.success).toBe(true);
    expect(cliResult.message).toContain('1 decision traces');
  });
});
