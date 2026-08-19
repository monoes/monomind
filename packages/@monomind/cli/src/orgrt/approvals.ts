// packages/@monomind/cli/src/orgrt/approvals.ts
// Extracted from daemon.ts — approval checking and setting for org tool calls.
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { ORG_DIR } from './types.js';
import type { OrgDaemon } from './daemon.js';

/** Custom org-runtime tools (org_complete, org_send, org_task, ...) are
 *  registered as an SDK MCP server named 'org' (createSdkMcpServer({ name:
 *  'org', ... }) in agent-runner.ts), so the SDK always presents them to
 *  canUseTool/policy.decide under the namespaced form `mcp__org__<name>` —
 *  unlike genuine SDK built-ins (Bash/WebFetch/WebSearch), which always
 *  arrive as their bare name. checkApproval's sensitiveActions list (and any
 *  role's policy.autoApproveTools) is written against the bare, human-facing
 *  name — 'org_complete', not 'mcp__org__org_complete' — so without this,
 *  'org_complete' NEVER matched and silently fell through to auto-approve
 *  unconditionally on every single call. Of the four originally-intended
 *  sensitive actions, the one whose approval mattered most (org_complete ends
 *  the entire run) was the one that was never actually gated. */
function normalizeToolAction(rawAction: string): string {
  const prefix = 'mcp__org__';
  return rawAction.startsWith(prefix) ? rawAction.slice(prefix.length) : rawAction;
}

/** Discard every approval — pending or resolved — left over from a previous
 *  run. Call on a fresh (non-resume) startOrg.
 *
 *  approvals.json is keyed per-org, not per-run, and daemon.approvals is an
 *  in-memory Map that starts empty in every fresh CLI process. A pending
 *  approval queued by a role in a PREVIOUS run — never resolved before that
 *  run ended — otherwise survives on disk forever: it looks "pending" to
 *  anything reading the file directly (dashboard, status checks, even
 *  `org approve`'s own live-delivery-then-fallback path), but the role that
 *  requested it is gone and no live daemon will ever have a matching
 *  in-memory record for it, so `org approve`'s live path always 404s with
 *  "No pending approval found" and silently falls back to patching a ghost
 *  entry nobody is listening for. A fresh start means every previous
 *  approval is moot for this run. */
export function clearApprovalsForFreshStart(daemon: OrgDaemon, org: string): void {
  daemon.approvals.delete(org);
  const approvalsPath = join(daemon.root, ORG_DIR, org, 'approvals.json');
  if (existsSync(approvalsPath)) writeJsonFileAtomic(approvalsPath, { approvals: [] });
}

/** Check if an action requires human approval (beforeTool hook for guardrails). Returns
 *  the approval decision: true = approved, false = denied, null = pending (requires human input).
 *
 *  R5: serialized per-org via withApprovalLock() — concurrent checkApproval and
 *  setApproval calls previously raced on this.approvals + approvals.json. */
export function checkApproval(daemon: OrgDaemon, org: string, role: string, rawAction: string): Promise<boolean | null> {
  const action = normalizeToolAction(rawAction);
  return withApprovalLock(daemon, org, async () => {
    const pending = daemon.approvals.get(org) ?? [];
    const existing = pending.find(a => a.roleId === role && a.action === action);

    // If already approved/denied, return that decision
    if (existing && existing.approved !== null) return existing.approved;

    // A role's policy.autoApproveTools can name specific sensitive actions it's
    // pre-trusted for, skipping the human-approval pause entirely for those.
    const roleDef = daemon.orgs.get(org)?.def.roles.find(r => r.id === role);
    if (roleDef?.policy?.autoApproveTools?.includes(action)) return true;

    // Require human approval for sensitive actions
    const sensitiveActions = ['Bash', 'WebFetch', 'WebSearch', 'org_complete'];
    if (sensitiveActions.includes(action)) {
      // Queue for approval
      if (!existing) {
        pending.push({ roleId: role, action, question: `Approve ${action} tool call?`, ts: Date.now(), approved: null });
        daemon.approvals.set(org, pending);
      }
      // Persist to approvals.json (C4: atomic write)
      const approvalsPath = join(daemon.root, ORG_DIR, org, 'approvals.json');
      mkdirSync(join(daemon.root, ORG_DIR, org), { recursive: true });
      writeJsonFileAtomic(approvalsPath, { approvals: pending });

      // Emit a question event for the dashboard
      const running = daemon.orgs.get(org);
      running?.bus.emit({ type: 'question', from: role, data: { question: `Approval required for ${action}`, action } });
      return null; // Pending human approval
    }

    return true; // Auto-approved for non-sensitive actions
  });
}

/** Approve or deny a pending action (called by dashboard or CLI).
 *  R5: serialized per-org via withApprovalLock(). */
export async function setApproval(daemon: OrgDaemon, org: string, role: string, action: string, approved: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  return withApprovalLock(daemon, org, async () => {
    const pending = daemon.approvals.get(org) ?? [];
    const item = pending.find(a => a.roleId === role && a.action === action);

    if (!item) return { ok: false, error: `No pending approval found for ${role} action ${action}` };

    item.approved = approved;
    item.ts = Date.now();

    // Persist updated approval state (C4: atomic write)
    const approvalsPath = join(daemon.root, ORG_DIR, org, 'approvals.json');
    writeJsonFileAtomic(approvalsPath, { approvals: pending });

    // Notify the waiting agent via its mailbox
    const running = daemon.orgs.get(org);
    const agent = running?.agents.get(role);
    if (agent && !agent.mailbox.isClosed) {
      agent.mailbox.push(`[approval] ${action}: ${approved ? 'APPROVED' : 'DENIED'}`);
    }

    running?.bus.emit({ type: 'status', from: role, msg: `Approval ${approved ? 'granted' : 'denied'} for ${action}` });

    // ORG-1: an approval resolving (approve or reject) is a natural decision
    // point — record it so `org decisions` shows real traces.
    daemon.recordDecision(org, role, {
      type: 'approval',
      context: `approval request: ${action}`,
      reasoning: approved ? 'approved by human' : 'rejected by human',
      outcome: approved ? 'approved' : 'rejected',
    });

    return { ok: true };
  });
}

/** R5: serialize approval mutations per org. Chains a Promise so concurrent
 *  callers run strictly in arrival order without blocking the daemon's
 *  event loop on unrelated orgs. Errors unwind the chain but don't poison
 *  future callers (the slot is reset to a resolved promise). */
function withApprovalLock<T>(daemon: OrgDaemon, org: string, fn: () => Promise<T>): Promise<T> {
  const prev = daemon.approvalLocks.get(org) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  daemon.approvalLocks.set(org, next.catch(() => { /* slot stays usable for the next caller */ }));
  return next;
}
