/**
 * ORG-9 regression: org_gate is documented (doc/concepts/org-runtime.md,
 * session.ts tool description) as creating a "hard-blocking human-approval
 * checkpoint" — but nothing actually stopped tool use while a gate sat
 * pending. Contrast with approvals, which DO hard-deny tool calls while
 * pending via gatedCanUseTool's beforeTool hook. This verifies gatedCanUseTool
 * now denies tool calls while a gate is pending, and allows them again once
 * the gate resolves — matching what approvals already do.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatedCanUseTool } from '../orgrt/session.js';
import type { PolicyEngine, Decision } from '../orgrt/policy.js';
import { OrgDaemon, type RunningOrg, type AgentRuntime } from '../orgrt/daemon.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { ORG_DIR, type OrgDef } from '../orgrt/types.js';

function fakeAllowPolicy(): PolicyEngine {
  const decide = async (): Promise<Decision> => ({ behavior: 'allow', updatedInput: {} });
  return { decide } as unknown as PolicyEngine;
}

describe('gatedCanUseTool — pending gate hard-blocks tool use', () => {
  it('denies a tool call while hasPendingGate() reports true', async () => {
    const canUseTool = gatedCanUseTool(fakeAllowPolicy(), undefined, 'boss', undefined, undefined, () => true);
    const decision = await canUseTool('Write', { file_path: 'x.md', content: 'hi' });
    expect(decision.behavior).toBe('deny');
    expect((decision as Extract<Decision, { behavior: 'deny' }>).message).toMatch(/gate/i);
  });

  it('allows the call once hasPendingGate() reports false', async () => {
    const canUseTool = gatedCanUseTool(fakeAllowPolicy(), undefined, 'boss', undefined, undefined, () => false);
    const decision = await canUseTool('Write', { file_path: 'x.md', content: 'hi' });
    expect(decision.behavior).toBe('allow');
  });

  it('deny takes precedence over an allow-everything policy — gates hard-block regardless of policy', async () => {
    // Even a policy that would allow the call must not override a pending gate.
    const canUseTool = gatedCanUseTool(fakeAllowPolicy(), undefined, 'boss', undefined, undefined, () => true);
    const decision = await canUseTool('Bash', { command: 'echo hi' });
    expect(decision.behavior).toBe('deny');
  });
});

function minimalDef(name: string): OrgDef {
  return { name, goal: 'test', roles: [{ id: 'boss' }], run_config: {} } as unknown as OrgDef;
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

describe('ORG-9: daemon.listGates()-backed hasPendingGate wiring', () => {
  let tmp = '';
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('a role with a pending gate is denied; resolving the gate allows tool calls again', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-gate-hard-block-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const running: RunningOrg = {
      def: minimalDef('alpha'), run: 'run-1', bus,
      agents: new Map([['boss', makeAgent()]]),
      busEvents: () => [],
    };
    daemon.orgs.set('alpha', running);

    // Mirrors daemon.ts's sessionOpts.hasPendingGate wiring exactly.
    const hasPendingGate = () => daemon.listGates('alpha', 'pending').some(g => g.roleId === 'boss');
    const canUseTool = gatedCanUseTool(fakeAllowPolicy(), undefined, 'boss', undefined, undefined, hasPendingGate);

    // No gate yet — allowed.
    expect((await canUseTool('Write', {})).behavior).toBe('allow');

    const gateId = await daemon.createGate('alpha', 'boss', 'ship it', 'go/no-go on deploy')
      .then(msg => /id ([a-zA-Z0-9-]+)\)/.exec(msg)?.[1]);
    expect(gateId).toBeTruthy();

    // Gate now pending — hard-blocked, even though policy would allow.
    const blocked = await canUseTool('Write', {});
    expect(blocked.behavior).toBe('deny');

    await daemon.resolveGate('alpha', gateId!, true, 'approved, proceed');

    // Gate resolved — allowed again.
    expect((await canUseTool('Write', {})).behavior).toBe('allow');
  });
});
