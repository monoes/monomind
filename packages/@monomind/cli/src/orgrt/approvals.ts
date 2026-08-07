// packages/@monomind/cli/src/orgrt/approvals.ts
// Extracted from daemon.ts — approval checking and setting for org tool calls.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { ORG_DIR } from './types.js';
import type { OrgDaemon } from './daemon.js';

/** Check if an action requires human approval (beforeTool hook for guardrails). Returns
 *  the approval decision: true = approved, false = denied, null = pending (requires human input).
 *
 *  R5: serialized per-org via withApprovalLock() — concurrent checkApproval and
 *  setApproval calls previously raced on this.approvals + approvals.json. */
export function checkApproval(daemon: OrgDaemon, org: string, role: string, action: string): Promise<boolean | null> {
  return withApprovalLock(daemon, org, async () => {
    const pending = daemon.approvals.get(org) ?? [];
    const existing = pending.find(a => a.roleId === role && a.action === action);

    // If already approved/denied, return that decision
    if (existing && existing.approved !== null) return existing.approved;

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
