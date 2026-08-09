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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gatedCanUseTool } from '../orgrt/session.js';
import type { PolicyEngine, Decision } from '../orgrt/policy.js';
import { checkApproval, setApproval } from '../orgrt/approvals.js';
import { approveAction, denyAction } from '../commands/org-observe.js';
import { ORG_DIR } from '../orgrt/types.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import type { CommandContext } from '../types.js';

/** Minimal fake policy — just enough to drive the `decision.behavior` branch
 *  gatedCanUseTool switches on, without pulling in real PolicyEngine config. */
function fakePolicy(behavior: 'allow' | 'deny'): PolicyEngine {
  const decide = async (): Promise<Decision> =>
    behavior === 'allow' ? { behavior: 'allow', updatedInput: {} } : { behavior: 'deny', message: 'denied by policy' };
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
    const beforeTool = async () => { called = true; return true; };
    const canUseTool = gatedCanUseTool(fakePolicy('deny'), beforeTool, 'boss');
    const decision = await canUseTool('Bash', {});
    expect(decision.behavior).toBe('deny');
    expect(decision.behavior === 'deny' && decision.message).toBe('denied by policy');
    expect(called).toBe(false);
  });

  it('passes the REAL tool name to beforeTool — the actual regression', async () => {
    const seen: string[] = [];
    const beforeTool = async (_role: string, toolName: string) => { seen.push(toolName); return true; };
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
    expect(result).toEqual({ ok: false, error: 'No pending approval found for nobody action Bash' });
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
    const daemon = { root: cwd, approvals: new Map(), approvalLocks: new Map(), orgs: new Map() } as unknown as OrgDaemon;
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
