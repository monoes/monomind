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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decisionsAction } from '../commands/org-observe.js';
import { OrgBus } from '../orgrt/bus.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../orgrt/daemon.js';
import { Mailbox } from '../orgrt/mailbox.js';
import type { Decision, PolicyEngine } from '../orgrt/policy.js';
import { readRunEvents } from '../orgrt/reporting.js';
import { gatedCanUseTool } from '../orgrt/session.js';
import { type DecisionKind, ORG_DIR, type OrgDef } from '../orgrt/types.js';

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
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('records a decision trace when an approval request resolves', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-approval-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const running: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
    };
    daemon.orgs.set('alpha', running);
    daemon.approvals.set('alpha', [
      { roleId: 'dev', action: 'Bash', question: 'Approve Bash?', ts: Date.now(), approved: null },
    ]);

    const result = await daemon.setApproval('alpha', 'dev', 'Bash', true);
    expect(result.ok).toBe(true);
    await bus.flush();

    const events = readRunEvents(tmp, 'alpha', 'run-1');
    const trace = events.find((e) => e.type === 'audit' && e.reason === 'decision-trace');
    expect(trace).toBeTruthy();
    expect((trace?.data as any).decisionType).toBe('approval');
    expect((trace?.data as any).outcome).toBe('approved');

    const cliResult = await decisionsAction(
      { cwd: tmp, args: ['alpha'], flags: {} } as any,
      'alpha',
    );
    expect(cliResult.success).toBe(true);
    expect(cliResult.message).toContain('1 decision traces');
  });

  it('records a decision trace when a cross-org deliver() handoff succeeds', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-handoff-'));
    const daemon = new OrgDaemon(tmp);

    const alphaBus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const alpha: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus: alphaBus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
    };
    const betaBus = new OrgBus('beta', 'run-1', join(tmp, ORG_DIR, 'beta', 'run-1'));
    const beta: RunningOrg = {
      def: minimalDef('beta'),
      run: 'run-1',
      bus: betaBus,
      agents: new Map([['worker', makeAgent()]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
    };
    daemon.orgs.set('alpha', alpha);
    daemon.orgs.set('beta', beta);

    const receipt = await daemon.deliver(
      'alpha',
      'dev',
      'beta:worker',
      'status update',
      'work is done',
    );
    expect(receipt).toBe('delivered to beta:worker');
    await alphaBus.flush();

    const events = readRunEvents(tmp, 'alpha', 'run-1');
    const trace = events.find((e) => e.type === 'audit' && e.reason === 'decision-trace');
    expect(trace).toBeTruthy();
    expect((trace?.data as any).decisionType).toBe('handoff');
    expect((trace?.data as any).outcome).toBe('delivered');

    const cliResult = await decisionsAction(
      { cwd: tmp, args: ['alpha'], flags: {} } as any,
      'alpha',
    );
    expect(cliResult.success).toBe(true);
    expect(cliResult.message).toContain('1 decision traces');
  });

  it('records a decision trace when gatedCanUseTool denies a tool call (the wiring daemon.ts uses)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-deny-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const running: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
    };
    daemon.orgs.set('alpha', running);

    const denyingPolicy = {
      decide: async (): Promise<Decision> => ({
        behavior: 'deny',
        message: 'Bash is not allowed for this role',
      }),
    } as unknown as PolicyEngine;

    // Mirrors daemon.ts's sessionOpts.onDecision wiring exactly.
    const onDecision = (role: string, toolName: string, message: string, kind: DecisionKind) => {
      daemon.recordDecision('alpha', role, {
        type: 'tool',
        kind,
        context: `tool call: ${toolName}`,
        reasoning: message,
        outcome: 'denied',
      });
    };
    const canUseTool = gatedCanUseTool(
      denyingPolicy,
      undefined,
      'dev',
      undefined,
      (toolName, _input, decision, kind) =>
        onDecision('dev', toolName, decision.message ?? 'denied', kind),
    );

    const decision = await canUseTool('Bash', { command: 'rm -rf /' });
    expect(decision.behavior).toBe('deny');
    await bus.flush();

    const events = readRunEvents(tmp, 'alpha', 'run-1');
    const trace = events.find((e) => e.type === 'audit' && e.reason === 'decision-trace');
    expect(trace).toBeTruthy();
    expect((trace?.data as any).decisionType).toBe('tool');
    expect((trace?.data as any).outcome).toBe('denied');
    expect((trace?.data as any).context).toContain('Bash');

    const cliResult = await decisionsAction(
      { cwd: tmp, args: ['alpha'], flags: {} } as any,
      'alpha',
    );
    expect(cliResult.success).toBe(true);
    expect(cliResult.message).toContain('1 decision traces');
  });
});

/**
 * Issue #290: a prompt-injection fence block and a routine "waiting for a human
 * to approve this tool" produced byte-identical structured fields
 * (`decisionType: 'tool'`, `outcome: 'denied'`) — only the free text differed.
 * A consumer that wanted to tell "blocked by the security fence" from "waiting
 * for you" had to regex English out of data.context/data.reasoning, and the Org
 * Arena demo got it wrong: a routine Bash approval raised a firewall alarm.
 */
describe('#290: decision traces carry a structured cause', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function daemonWithOrg(prefix: string) {
    tmp = mkdtempSync(join(tmpdir(), prefix));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    daemon.orgs.set('alpha', {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map([['dev', makeAgent()]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
    } as RunningOrg);
    return { daemon, bus };
  }

  /** Mirrors daemon.ts's sessionOpts.onDecision wiring exactly. */
  const wire = (daemon: OrgDaemon) => (kind: DecisionKind, toolName: string, message: string) =>
    daemon.recordDecision('alpha', 'dev', {
      type: 'tool',
      kind,
      context: `tool call: ${toolName}`,
      reasoning: message,
      outcome: 'denied',
    });

  const kinds = async (bus: OrgBus, root: string): Promise<string[]> => {
    await bus.flush();
    return readRunEvents(root, 'alpha', 'run-1')
      .filter((e) => e.type === 'audit' && e.reason === 'decision-trace')
      .map((e) => String((e.data as any).kind));
  };

  const allowAll = {
    decide: async (): Promise<Decision> => ({ behavior: 'allow', updatedInput: {} }),
  } as unknown as PolicyEngine;

  it('distinguishes a fence block from a pending human approval without reading prose', async () => {
    const { daemon, bus } = daemonWithOrg('org-decisions-kind-');
    const onDecision = wire(daemon);

    // A fence block: scanInput denies before the policy engine is consulted.
    const fence = {
      instance: {
        detect: async () => ({
          safe: false,
          overallRisk: 1,
          threats: [{ type: 'prompt-injection' }],
        }),
        getContextState: () => ({}),
      },
      abortThreshold: 0.5,
      scanMessages: true,
    } as any;
    const fenced = gatedCanUseTool(allowAll, undefined, 'dev', fence, (t, _i, d, kind) =>
      onDecision(kind, t, d.message ?? 'denied'),
    );
    expect((await fenced('Bash', { command: 'ls' })).behavior).toBe('deny');

    // A routine approval that is merely waiting on a human (beforeTool -> null).
    const pending = gatedCanUseTool(
      allowAll,
      async () => null,
      'dev',
      undefined,
      (t, _i, d, kind) => onDecision(kind, t, d.message ?? 'denied'),
    );
    expect((await pending('Bash', { command: 'ls' })).behavior).toBe('deny');

    expect(await kinds(bus, tmp)).toEqual(['fence-block', 'approval-pending']);
  });

  it('labels a policy denial, a human rejection and a pending gate distinctly', async () => {
    const { daemon, bus } = daemonWithOrg('org-decisions-kind2-');
    const onDecision = wire(daemon);
    const denyingPolicy = {
      decide: async (): Promise<Decision> => ({ behavior: 'deny', message: 'not allowed' }),
    } as unknown as PolicyEngine;
    const hook = (t: string, _i: unknown, d: { message?: string }, kind: DecisionKind) =>
      onDecision(kind, t, d.message ?? 'denied');

    await gatedCanUseTool(denyingPolicy, undefined, 'dev', undefined, hook as any)('Bash', {});
    await gatedCanUseTool(allowAll, async () => false, 'dev', undefined, hook as any)('Bash', {});
    await gatedCanUseTool(
      allowAll,
      undefined,
      'dev',
      undefined,
      hook as any,
      () => true,
    )('Bash', {});

    expect(await kinds(bus, tmp)).toEqual(['policy-deny', 'approval-denied', 'gate-pending']);
  });

  it('labels the non-tool emitters too, so the field is never absent', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-decisions-kind3-'));
    const daemon = new OrgDaemon(tmp);
    const alphaBus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const betaBus = new OrgBus('beta', 'run-1', join(tmp, ORG_DIR, 'beta', 'run-1'));
    const mk = (name: string, bus: OrgBus, roleId: string): RunningOrg => ({
      def: minimalDef(name),
      run: 'run-1',
      bus,
      agents: new Map([[roleId, makeAgent()]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
    });
    daemon.orgs.set('alpha', mk('alpha', alphaBus, 'dev'));
    daemon.orgs.set('beta', mk('beta', betaBus, 'worker'));
    daemon.approvals.set('alpha', [
      { roleId: 'dev', action: 'Bash', question: 'Approve Bash?', ts: Date.now(), approved: null },
    ]);

    await daemon.setApproval('alpha', 'dev', 'Bash', true);
    await daemon.deliver('alpha', 'dev', 'beta:worker', 's', 'b');

    expect(await kinds(alphaBus, tmp)).toEqual(['approval-resolved', 'cross-org-handoff']);
  });
});
