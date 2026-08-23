/**
 * The org runtime's human-approval gate for sensitive tool calls (Bash,
 * WebFetch, WebSearch, org_complete) never actually fired on any real code
 * path:
 *
 *   - `canUseTool` (the SDK's real per-tool-call gate) delegated entirely to
 *     `policy.decide()`, which has no concept of "pause for a human." The
 *     `beforeTool` hook (daemon.checkApproval) was defined on SessionOpts but
 *     only ever invoked from the org_send tool's own handler — hardcoded to
 *     check the literal action name 'org_send', which isn't in
 *     checkApproval's sensitive-actions list, so that call was a permanent
 *     no-op. Bash/WebFetch/WebSearch/org_complete never consulted the gate.
 *   - `org approve`/`org deny` compared the CLI's raw action argument against
 *     the stored record's `question` field (a full sentence like "Approve
 *     Bash tool call?"), not its `action` field (the raw name, "Bash") — so a
 *     real invocation like `org approve myorg boss Bash` could never match a
 *     pending entry, even if one existed.
 *
 * These tests exercise the fixed composition directly, without spinning up a
 * real SDK session — `gatedCanUseTool` is exported from session.ts specifically
 * so this is testable in isolation.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approveAction, denyAction, gateResolveAction } from '../commands/org-observe.js';
import { checkApproval, clearApprovalsForFreshStart, setApproval } from '../orgrt/approvals.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import type { Decision, PolicyEngine } from '../orgrt/policy.js';
import { gatedCanUseTool } from '../orgrt/session.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { CommandContext } from '../types.js';

/** Minimal fake policy — just enough to drive the `decision.behavior` branch
 *  gatedCanUseTool switches on, without pulling in real PolicyEngine config. */
function fakePolicy(behavior: 'allow' | 'deny'): PolicyEngine {
  const decide = async (): Promise<Decision> =>
    behavior === 'allow'
      ? { behavior: 'allow', updatedInput: {} }
      : { behavior: 'deny', message: 'denied by policy' };
  return { decide } as unknown as PolicyEngine;
}

describe('gatedCanUseTool — approval gate composition', () => {
  it('allows a policy-allowed call when no beforeTool hook is wired', async () => {
    const canUseTool = gatedCanUseTool(fakePolicy('allow'), undefined, 'boss');
    const decision = await canUseTool('Bash', { command: 'ls' });
    expect(decision.behavior).toBe('allow');
  });

  it('never consults beforeTool when policy already denies', async () => {
    let called = false;
    const beforeTool = async () => {
      called = true;
      return true;
    };
    const canUseTool = gatedCanUseTool(fakePolicy('deny'), beforeTool, 'boss');
    const decision = await canUseTool('Bash', {});
    expect(decision.behavior).toBe('deny');
    expect(decision.behavior === 'deny' && decision.message).toBe('denied by policy');
    expect(called).toBe(false);
  });

  it('passes the REAL tool name to beforeTool — the actual regression', async () => {
    const seen: string[] = [];
    const beforeTool = async (_role: string, toolName: string) => {
      seen.push(toolName);
      return true;
    };
    const canUseTool = gatedCanUseTool(fakePolicy('allow'), beforeTool, 'boss');
    await canUseTool('WebFetch', { url: 'https://example.com' });
    await canUseTool('org_complete', { outcome: 'achieved', summary: 'done' });
    // The original bug only ever asked beforeTool about the literal string
    // 'org_send', regardless of which tool was actually being called.
    expect(seen).toEqual(['WebFetch', 'org_complete']);
  });

  it('denies with a guardrail message when beforeTool rejects', async () => {
    const canUseTool = gatedCanUseTool(fakePolicy('allow'), async () => false, 'boss');
    const decision = await canUseTool('Bash', {});
    expect(decision.behavior).toBe('deny');
    expect(decision.behavior === 'deny' && decision.message).toMatch(/denied by guardrail/);
  });

  it('denies with a pending message when beforeTool has no verdict yet', async () => {
    const canUseTool = gatedCanUseTool(fakePolicy('allow'), async () => null, 'boss');
    const decision = await canUseTool('WebSearch', {});
    expect(decision.behavior).toBe('deny');
    expect(decision.behavior === 'deny' && decision.message).toMatch(/pending human approval/);
  });

  it('allows through once beforeTool approves', async () => {
    const canUseTool = gatedCanUseTool(fakePolicy('allow'), async () => true, 'boss');
    const decision = await canUseTool('Bash', { command: 'ls' });
    expect(decision.behavior).toBe('allow');
  });
});

describe('checkApproval / setApproval — end-to-end state machine', () => {
  let cwd: string;
  let daemon: OrgDaemon;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-approval-'));
    daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('auto-approves a non-sensitive action with no queueing', async () => {
    const result = await checkApproval(daemon, 'myorg', 'boss', 'Read');
    expect(result).toBe(true);
    expect(daemon.approvals.get('myorg')).toBeUndefined();
  });

  it('queues a sensitive action as pending and persists approvals.json', async () => {
    const result = await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    expect(result).toBeNull();
    const pending = daemon.approvals.get('myorg');
    expect(pending).toHaveLength(1);
    expect(pending?.[0]).toMatchObject({ roleId: 'boss', action: 'Bash', approved: null });

    const onDisk = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'myorg', 'approvals.json'), 'utf8'));
    expect(onDisk.approvals[0]).toMatchObject({ roleId: 'boss', action: 'Bash' });
  });

  it('setApproval(true) makes the next checkApproval for the same role+action resolve true', async () => {
    await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    const set = await setApproval(daemon, 'myorg', 'boss', 'Bash', true);
    expect(set).toEqual({ ok: true });

    const result = await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    expect(result).toBe(true);
  });

  it('setApproval(false) makes the next checkApproval resolve false', async () => {
    await checkApproval(daemon, 'myorg', 'boss', 'WebFetch');
    await setApproval(daemon, 'myorg', 'boss', 'WebFetch', false);

    const result = await checkApproval(daemon, 'myorg', 'boss', 'WebFetch');
    expect(result).toBe(false);
  });

  it('setApproval on a nonexistent pending entry reports an error instead of silently succeeding', async () => {
    const result = await setApproval(daemon, 'myorg', 'nobody', 'Bash', true);
    expect(result).toEqual({
      ok: false,
      error: 'No pending approval found for nobody action Bash',
    });
  });
});

describe('checkApproval — org_complete arrives namespaced as mcp__org__org_complete and must still be gated', () => {
  let cwd: string;
  let daemon: OrgDaemon;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-mcp-prefix-'));
    daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('queues mcp__org__org_complete as pending, not auto-approved', async () => {
    // This is the exact string the SDK's canUseTool passes for a custom MCP
    // tool from the 'org' server (createSdkMcpServer({ name: 'org', ... })) —
    // NOT the bare 'org_complete' sensitiveActions was written against.
    const result = await checkApproval(daemon, 'myorg', 'eng-director', 'mcp__org__org_complete');
    expect(result).toBeNull(); // pending human approval — NOT auto-approved (was: true, unconditionally)
    const pending = daemon.approvals.get('myorg');
    expect(pending).toHaveLength(1);
    // Stored under the clean name, so a human can resolve it with
    // `monomind org approve myorg eng-director org_complete`, not the
    // internal MCP-namespaced form.
    expect(pending?.[0]).toMatchObject({
      roleId: 'eng-director',
      action: 'org_complete',
      approved: null,
    });
  });

  it('setApproval(true) for the normalized name resolves the mcp__org__-prefixed pending request', async () => {
    await checkApproval(daemon, 'myorg', 'eng-director', 'mcp__org__org_complete');
    const set = await setApproval(daemon, 'myorg', 'eng-director', 'org_complete', true);
    expect(set).toEqual({ ok: true });

    const result = await checkApproval(daemon, 'myorg', 'eng-director', 'mcp__org__org_complete');
    expect(result).toBe(true);
  });

  it('a real SDK built-in tool (Bash) is unaffected — never had the mcp__org__ prefix to begin with', async () => {
    const result = await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    expect(result).toBeNull();
    expect(daemon.approvals.get('myorg')?.[0]).toMatchObject({ action: 'Bash' });
  });

  it('role.policy.autoApproveTools also matches against the normalized name', async () => {
    const orgs = new Map([
      [
        'myorg',
        {
          def: { roles: [{ id: 'eng-director', policy: { autoApproveTools: ['org_complete'] } }] },
          bus: { emit: () => {} },
        },
      ],
    ]);
    const trustedDaemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs,
    } as unknown as OrgDaemon;

    const result = await checkApproval(
      trustedDaemon,
      'myorg',
      'eng-director',
      'mcp__org__org_complete',
    );
    expect(result).toBe(true);
    expect(trustedDaemon.approvals.get('myorg')).toBeUndefined(); // never queued at all
  });
});

describe('checkApproval — role.policy.autoApproveTools bypasses the human-approval pause', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-auto-approve-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function daemonWithRole(policy: Record<string, unknown> | undefined): OrgDaemon {
    const orgs = new Map([
      ['myorg', { def: { roles: [{ id: 'boss', policy }] }, bus: { emit: () => {} } }],
    ]);
    return {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs,
    } as unknown as OrgDaemon;
  }

  it('skips the pending queue for a sensitive action named in autoApproveTools', async () => {
    const daemon = daemonWithRole({ autoApproveTools: ['Bash'] });
    const result = await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    expect(result).toBe(true);
    expect(daemon.approvals.get('myorg')).toBeUndefined();
    expect(existsSync(join(cwd, ORG_DIR, 'myorg', 'approvals.json'))).toBe(false);
  });

  it('only bypasses the named action — a different sensitive action still queues', async () => {
    const daemon = daemonWithRole({ autoApproveTools: ['Bash'] });
    const result = await checkApproval(daemon, 'myorg', 'boss', 'WebFetch');
    expect(result).toBeNull();
    expect(daemon.approvals.get('myorg')).toHaveLength(1);
  });

  it('a role with no autoApproveTools still requires approval as before', async () => {
    const daemon = daemonWithRole(undefined);
    const result = await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    expect(result).toBeNull();
  });

  it('only applies to the named role — a different role in the same org still queues', async () => {
    const daemon = daemonWithRole({ autoApproveTools: ['Bash'] });
    const result = await checkApproval(daemon, 'myorg', 'someone-else', 'Bash');
    expect(result).toBeNull();
  });
});

describe('clearApprovalsForFreshStart — stale approvals from a previous run never resurface', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-clear-approvals-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('wipes the in-memory Map entry for the org', () => {
    const daemon = {
      root: cwd,
      approvals: new Map([
        ['myorg', [{ roleId: 'boss', action: 'Bash', question: 'q', ts: 1, approved: null }]],
      ]),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;
    clearApprovalsForFreshStart(daemon, 'myorg');
    expect(daemon.approvals.get('myorg')).toBeUndefined();
  });

  it('resets an existing approvals.json to an empty array instead of leaving a stale pending entry', () => {
    const orgDir = join(cwd, ORG_DIR, 'myorg');
    mkdirSync(orgDir, { recursive: true });
    const approvalsPath = join(orgDir, 'approvals.json');
    writeFileSync(
      approvalsPath,
      JSON.stringify({
        approvals: [
          {
            roleId: 'ghost-role',
            action: 'Bash',
            question: 'Approve Bash tool call?',
            ts: 1,
            approved: null,
          },
        ],
      }),
    );
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;

    clearApprovalsForFreshStart(daemon, 'myorg');

    const onDisk = JSON.parse(readFileSync(approvalsPath, 'utf8'));
    expect(onDisk.approvals).toEqual([]);
  });

  it('is a no-op when no approvals.json exists yet — does not create one', () => {
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;
    clearApprovalsForFreshStart(daemon, 'myorg');
    expect(existsSync(join(cwd, ORG_DIR, 'myorg', 'approvals.json'))).toBe(false);
  });

  it('a role that legitimately needs the same action approved in the new run gets a fresh, resolvable pending entry', async () => {
    const orgDir = join(cwd, ORG_DIR, 'myorg');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(
      join(orgDir, 'approvals.json'),
      JSON.stringify({
        approvals: [
          {
            roleId: 'boss',
            action: 'Bash',
            question: 'Approve Bash tool call?',
            ts: 1,
            approved: null,
          },
        ],
      }),
    );
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;
    clearApprovalsForFreshStart(daemon, 'myorg');

    // Simulates the new run's boss calling Bash again — must queue a fresh
    // entry, not silently resolve against the wiped stale one.
    const result = await checkApproval(daemon, 'myorg', 'boss', 'Bash');
    expect(result).toBeNull();
    expect(daemon.approvals.get('myorg')).toHaveLength(1);

    const set = await setApproval(daemon, 'myorg', 'boss', 'Bash', true);
    expect(set).toEqual({ ok: true }); // live delivery now finds it — no more "No pending approval found"
  });
});

describe('org approve / deny — offline field-matching fix', () => {
  let cwd: string;

  function ctx(args: string[]): CommandContext {
    return { args, flags: { _: [] }, cwd, interactive: false };
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'org-approve-cli-'));
    // Seed a pending approval the same shape checkApproval writes: roleId/action/question/ts/approved.
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      orgs: new Map(),
    } as unknown as OrgDaemon;
    await checkApproval(daemon, 'myorg', 'boss', 'Bash');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('org approve <org> <role> <action> matches on the raw action name and approves it', async () => {
    // This is exactly how a user invokes it — the raw tool name, not the stored
    // question sentence ("Approve Bash tool call?"). Before the fix this never matched.
    const result = await approveAction(ctx(['myorg', 'boss', 'Bash']), 'myorg');
    expect(result.success).toBe(true);

    const onDisk = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'myorg', 'approvals.json'), 'utf8'));
    expect(onDisk.approvals[0].approved).toBe(true);
  });

  it('org deny <org> <role> <action> matches on the raw action name and denies it', async () => {
    const result = await denyAction(ctx(['myorg', 'boss', 'Bash']), 'myorg');
    expect(result.success).toBe(true);

    const onDisk = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'myorg', 'approvals.json'), 'utf8'));
    expect(onDisk.approvals[0].approved).toBe(false);
  });

  it('reports failure for an action with no matching pending entry', async () => {
    const result = await approveAction(ctx(['myorg', 'boss', 'WebFetch']), 'myorg');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no pending approval found/);
  });

  it('reports failure when approvals.json does not exist for the org', async () => {
    const result = await approveAction(ctx(['ghost-org', 'boss', 'Bash']), 'ghost-org');
    expect(result.success).toBe(false);
    expect(existsSync(join(cwd, ORG_DIR, 'ghost-org', 'approvals.json'))).toBe(false);
  });
});

// GitHub #213: `org gate-approve`/`org gate-reject` had no offline-queue
// fallback (unlike org approve/deny/answer) — when the org isn't hosted by a
// live daemon (no broker registration for this name), the command just
// hard-failed instead of resolving gates.json directly, permanently blocking
// the gate for any org run without a reachable live-delivery channel.
describe('org gate-approve / gate-reject — offline fallback', () => {
  let cwd: string;
  let brokerDir: string;
  let prevBrokerDirEnv: string | undefined;

  function ctx(args: string[]): CommandContext {
    return { args, flags: { _: [] }, cwd, interactive: false };
  }

  function seedGate(org: string, gateId: string) {
    const orgDir = join(cwd, ORG_DIR, org);
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(
      join(orgDir, 'gates.json'),
      JSON.stringify({
        gates: [
          {
            id: gateId,
            name: 'ship it',
            description: 'launch decision',
            roleId: 'boss',
            status: 'pending',
            createdAt: Date.now(),
          },
        ],
      }),
    );
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-gate-offline-'));
    // Isolate from any real ~/.monomind/orgrt-broker/ entries (same pattern as
    // org-live-delivery-auth.test.ts) — these tests assert the OFFLINE path,
    // which only runs when lookupOrg() finds nothing for 'myorg'.
    brokerDir = mkdtempSync(join(tmpdir(), 'org-gate-offline-broker-'));
    prevBrokerDirEnv = process.env.MONOMIND_ORGRT_BROKER_DIR;
    process.env.MONOMIND_ORGRT_BROKER_DIR = brokerDir;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(brokerDir, { recursive: true, force: true });
    if (prevBrokerDirEnv === undefined) delete process.env.MONOMIND_ORGRT_BROKER_DIR;
    else process.env.MONOMIND_ORGRT_BROKER_DIR = prevBrokerDirEnv;
  });

  it('org gate-approve resolves the gate directly in gates.json when no live daemon hosts the org', async () => {
    seedGate('myorg', 'gate-1');

    const result = await gateResolveAction(
      ctx(['myorg', 'gate-1', 'approved via offline path']),
      'myorg',
      true,
    );
    expect(result.success).toBe(true);

    const onDisk = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'myorg', 'gates.json'), 'utf8'));
    expect(onDisk.gates[0]).toMatchObject({
      status: 'approved',
      resolution: 'approved via offline path',
    });
  });

  it('org gate-reject resolves the gate as rejected offline', async () => {
    seedGate('myorg', 'gate-2');

    const result = await gateResolveAction(ctx(['myorg', 'gate-2', 'not ready']), 'myorg', false);
    expect(result.success).toBe(true);

    const onDisk = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'myorg', 'gates.json'), 'utf8'));
    expect(onDisk.gates[0]).toMatchObject({ status: 'rejected', resolution: 'not ready' });
  });

  it('reports failure for a gate id with no pending entry', async () => {
    const result = await gateResolveAction(ctx(['myorg', 'no-such-gate']), 'myorg', true);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/);
  });

  it('reports failure for a gate already resolved offline', async () => {
    seedGate('myorg', 'gate-3');
    await gateResolveAction(ctx(['myorg', 'gate-3', 'first']), 'myorg', true);

    const result = await gateResolveAction(ctx(['myorg', 'gate-3', 'second']), 'myorg', false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already resolved/);
  });
});
