// packages/@monomind/cli/src/orgrt/approvals.ts
// Extracted from daemon.ts — approval checking and setting for org tool calls.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import type { OrgDaemon } from './daemon.js';
import { summarizeToolInput } from './policy.js';
import { ORG_DIR } from './types.js';

/** M5: `apr-<ms>-<8 hex>` — one per approval request. */
export function newApprovalRequestId(): string {
  return `apr-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/** M5: default resolver when none is named. */
export const DEFAULT_RESOLVER = 'human';

/** M5: a resolver name from the CLI/API — trimmed, 1..128 chars, no control
 *  characters. Returns undefined for anything else (callers fall back to the
 *  default or reject). */
export function normalizeResolver(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v || v.length > 128 || /[\u0000-\u001f\u007f]/.test(v)) return undefined;
  return v;
}

export interface ApprovalResolveOpts {
  /** Who resolved it — stored as resolvedBy and put on the audit event. */
  resolvedBy?: string;
  /** Resolve only this request; absent = every pending (role, action) entry. */
  requestId?: string;
}

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

/** Deterministic string form of a value, with object keys sorted at every
 *  depth so the same input always fingerprints the same way regardless of
 *  key insertion order. Used as the fallback fingerprint (below) for actions
 *  with no single well-known argument field. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Fingerprints the MEANINGFUL part of a tool call's arguments, so
 *  checkApproval's pending-cache key can tell a materially different call
 *  apart from one already approved/pending for the same (role, action) —
 *  see the CRITICAL bug this fixes in checkApproval's doc comment below.
 *  Falls back to a stable-stringify of the whole input for actions with no
 *  single well-known field (org_complete) or a call whose expected field is
 *  missing/non-string for some reason — never silently treats "unknown
 *  shape" as "same as before". */
function fingerprintAction(action: string, input: Record<string, unknown>): string {
  if (action === 'Bash' && typeof input.command === 'string') return input.command;
  if (action === 'WebFetch' || action === 'WebSearch') {
    if (typeof input.url === 'string') return input.url;
    if (typeof input.query === 'string') return input.query;
  }
  return stableStringify(input);
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
 *  CRITICAL fix: the pending cache used to key ONLY on (role, action) — the tool's
 *  bare name (e.g. "Bash"), never its actual arguments. Once a human approved ONE
 *  call, `existing.approved !== null` short-circuited below and returned true for
 *  EVERY future call to that tool by that role for the rest of the run, regardless
 *  of what the new call's command/url/content actually was: approve role
 *  "builder"'s `npm test`, and its very next Bash call — `rm -rf $HOME`, say —
 *  was auto-approved with zero further human involvement. Same issue for repeated
 *  WebFetch/WebSearch (exfiltration/SSRF) and org_complete. `input` (the tool's
 *  actual call arguments, now threaded through from gatedCanUseTool/daemon.ts) is
 *  fingerprinted (fingerprintAction, above) and folded into the cache key so a
 *  materially different call always queues its OWN pending entry requiring fresh
 *  human approval — only a literally identical repeat call may reuse a prior
 *  decision, which is reasonable UX, not the bug.
 *
 *  R5: serialized per-org via withApprovalLock() — concurrent checkApproval and
 *  setApproval calls previously raced on this.approvals + approvals.json. */
export function checkApproval(
  daemon: OrgDaemon,
  org: string,
  role: string,
  rawAction: string,
  input: Record<string, unknown> = {},
): Promise<boolean | null> {
  const action = normalizeToolAction(rawAction);
  const fingerprint = fingerprintAction(action, input);
  return withApprovalLock(daemon, org, async () => {
    const pending = daemon.approvals.get(org) ?? [];
    const existing = pending.find(
      (a) => a.roleId === role && a.action === action && a.fingerprint === fingerprint,
    );

    // If already approved/denied, return that decision
    if (existing && existing.approved !== null) return existing.approved;

    // A role's policy.autoApproveTools can name specific sensitive actions it's
    // pre-trusted for, skipping the human-approval pause entirely for those.
    const roleDef = daemon.orgs.get(org)?.def.roles.find((r) => r.id === role);
    if (roleDef?.policy?.autoApproveTools?.includes(action)) return true;
    // #345: `org run --auto-approve <tools>` pre-approves the named actions for
    // every role, for this run only.
    if (daemon.runAutoApprove?.get(org)?.includes(action)) return true;

    // Require human approval for sensitive actions: the built-in list plus the
    // role's own policy.approvalTools (bare names, e.g. a provider tool
    // `monoagent__automation_publish`). autoApproveTools above still wins.
    const sensitiveActions = ['Bash', 'WebFetch', 'WebSearch', 'org_complete'];
    if (sensitiveActions.includes(action) || roleDef?.policy?.approvalTools?.includes(action)) {
      // Queue for approval
      const summary = summarizeToolInput(input);
      let entry = existing;
      if (!entry) {
        entry = {
          roleId: role,
          action,
          fingerprint,
          question: `Approve ${action} tool call?`,
          ts: Date.now(),
          approved: null,
          requestId: newApprovalRequestId(),
          input: summary,
        };
        pending.push(entry);
        daemon.approvals.set(org, pending);
      } else if (!entry.requestId) {
        entry.requestId = newApprovalRequestId();
        entry.input = summary;
      }
      // Persist to approvals.json (C4: atomic write)
      const approvalsPath = join(daemon.root, ORG_DIR, org, 'approvals.json');
      mkdirSync(join(daemon.root, ORG_DIR, org), { recursive: true });
      writeJsonFileAtomic(approvalsPath, { approvals: pending });

      // Emit a question event for the dashboard
      const running = daemon.orgs.get(org);
      running?.bus.emit({
        type: 'question',
        from: role,
        data: {
          question: `Approval required for ${action}`,
          action,
          requestId: entry.requestId,
          input: entry.input ?? summary,
        },
      });
      return null; // Pending human approval
    }

    return true; // Auto-approved for non-sensitive actions
  });
}

/** #345: `org run --auto-approve a,b` — the bare action names to pre-approve
 *  for the run (a `mcp__org__` prefix is dropped, as checkApproval does). */
export function parseAutoApproveFlag(raw: unknown): { tools: string[] } | { error: string } {
  if (raw === undefined) return { tools: [] };
  if (typeof raw !== 'string')
    return { error: '--auto-approve takes a comma-separated list of tool names' };
  const tools = raw
    .split(',')
    .map((t) => normalizeToolAction(t.trim()))
    .filter(Boolean);
  const bad = tools.find((t) => !/^[A-Za-z0-9_.:-]+$/.test(t));
  if (bad) return { error: `--auto-approve: "${bad}" is not a tool name` };
  return { tools };
}

/** #345: the line `org run` prints for the approval request a `question`
 *  event carries (checkApproval emits one per queued request), naming the
 *  commands that resolve it; null for any other event. Without it the
 *  request only reached approvals.json and the dashboard, and a foreground
 *  run waiting on it looked hung. */
export function approvalPendingNotice(
  org: string,
  e: { type: string; from?: string; data?: unknown },
): string | null {
  const data = e.data as { action?: unknown; requestId?: unknown } | undefined;
  if (e.type !== 'question' || !e.from || typeof data?.action !== 'string' || !data.requestId)
    return null;
  const args = `${org} ${e.from} ${data.action}`;
  return (
    `approval pending (${data.requestId}): role "${e.from}" is waiting to run ${data.action} — ` +
    `resolve with "monomind org approve ${args}" or "monomind org deny ${args}"` +
    ` (to pre-approve it for a run, start it with --auto-approve ${data.action})`
  );
}

/** Approve or deny a pending action (called by dashboard or CLI).
 *  R5: serialized per-org via withApprovalLock().
 *
 *  Now that checkApproval fingerprints each call, more than one distinct
 *  pending entry can exist under the same (role, action) at once (e.g. two
 *  different Bash commands both awaiting approval). The CLI/dashboard only
 *  identify a request by (role, action), not by which specific command — so
 *  resolve every currently-UNRESOLVED entry for that (role, action) rather
 *  than picking one arbitrarily via .find(). This still means what it always
 *  meant ("yes, let the queued Bash/WebFetch/... call(s) through"): a NEW,
 *  still-different future call queues its own fresh pending entry and is
 *  unaffected by this decision. */
export async function setApproval(
  daemon: OrgDaemon,
  org: string,
  role: string,
  action: string,
  approved: boolean,
  opts: ApprovalResolveOpts = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolver = opts.resolvedBy ?? DEFAULT_RESOLVER;
  return withApprovalLock(daemon, org, async () => {
    const pending = daemon.approvals.get(org) ?? [];
    // M5: --request <id> resolves only that request; without it, every pending
    // entry for the (role, action) pair (the pre-M5 behaviour).
    const items = pending.filter(
      (a) =>
        a.roleId === role &&
        a.action === action &&
        a.approved === null &&
        (opts.requestId === undefined || a.requestId === opts.requestId),
    );

    if (items.length === 0)
      return {
        ok: false,
        error: opts.requestId
          ? `No pending approval ${opts.requestId} found for ${role} action ${action}`
          : `No pending approval found for ${role} action ${action}`,
      };

    const now = Date.now();
    for (const item of items) {
      item.approved = approved;
      item.ts = now;
      item.resolvedBy = resolver;
      item.resolvedAt = now;
      if (!item.requestId) item.requestId = newApprovalRequestId();
    }

    // Persist updated approval state (C4: atomic write)
    const approvalsPath = join(daemon.root, ORG_DIR, org, 'approvals.json');
    writeJsonFileAtomic(approvalsPath, { approvals: pending });

    // Notify the waiting agent via its mailbox
    const running = daemon.orgs.get(org);
    const agent = running?.agents.get(role);
    if (agent && !agent.mailbox.isClosed) {
      agent.mailbox.push(`[approval] ${action}: ${approved ? 'APPROVED' : 'DENIED'}`);
    }

    running?.bus.emit({
      type: 'status',
      from: role,
      msg: `Approval ${approved ? 'granted' : 'denied'} for ${action}`,
    });
    // M5: one attribution event per resolved request.
    for (const item of items) {
      running?.bus.emit({
        type: 'audit',
        reason: 'decision-resolved',
        from: role,
        data: {
          kind: 'approval',
          ref: item.requestId,
          resolver,
          verdict: approved ? 'approved' : 'denied',
        },
      });
    }

    // ORG-1: an approval resolving (approve or reject) is a natural decision
    // point — record it so `org decisions` shows real traces.
    daemon.recordDecision(org, role, {
      type: 'approval',
      kind: 'approval-resolved',
      context: `approval request: ${action}`,
      reasoning: approved ? `approved by ${resolver}` : `rejected by ${resolver}`,
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
  daemon.approvalLocks.set(
    org,
    next.catch(() => {
      /* slot stays usable for the next caller */
    }),
  );
  return next;
}
