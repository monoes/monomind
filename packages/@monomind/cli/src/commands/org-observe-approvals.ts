// packages/@monomind/cli/src/commands/org-observe-approvals.ts
//
// `monomind org approvals | approve | deny` — pending tool/action approval
// requests and their live-or-offline resolution.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAgentContextMarker } from '../orgrt/agent-context.js';
import { utcDateMinute } from '../orgrt/reporting.js';
import { ORG_DIR } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import { hostingDaemonFor, orgJson, printOrgJson, resolverFlag } from './org-observe-shared.js';

const log = (text: string): void => {
  console.log(text);
};

interface OrgApproval {
  roleId: string;
  action: string;
  question: string;
  ts: number;
  approved: boolean | null;
  /** M5 */
  requestId?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  input?: Record<string, unknown>;
}

/** Read approvals.json — the tool/action-approval queue checked by
 *  checkApproval for Bash/WebFetch/WebSearch/org_complete (session.ts).
 *  Distinct from questions.json/gates.json: approving those does NOT touch
 *  this file or grant anything here. A MISSING file legitimately means "no
 *  pending approvals" → []. Any other failure THROWS, same rationale as
 *  readQuestions above — approveAction/denyAction rewrite this file from
 *  what this returns. */
const readApprovals = (cwd: string, name: string): OrgApproval[] => {
  const path = join(cwd, ORG_DIR, name, 'approvals.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: { approvals?: OrgApproval[] };
  try {
    parsed = JSON.parse(raw) as { approvals?: OrgApproval[] };
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (parsed?.approvals === undefined || parsed.approvals === null) return [];
  if (!Array.isArray(parsed.approvals)) throw new Error(`${path}: "approvals" is not an array`);
  return parsed.approvals;
};

/** `org approvals <name> [--all]` — list pending (or all) tool/action approval requests. */
export const approvalsAction = async (
  ctx: CommandContext,
  name: string,
): Promise<CommandResult> => {
  let all: OrgApproval[];
  try {
    all = readApprovals(ctx.cwd, name);
  } catch (err) {
    log(
      output.error(
        `Cannot read approvals for org ${name}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { success: false, message: 'approvals.json unreadable' };
  }
  const shown = ctx.flags.all === true ? all : all.filter((a) => a.approved === null);
  if (orgJson(ctx))
    return printOrgJson({
      v: 1,
      org: name,
      // M5: requestId / resolvedBy / input are always present (null for
      // entries recorded before they existed).
      items: shown.map((a) => ({
        ...a,
        requestId: a.requestId ?? null,
        resolvedBy: a.resolvedBy ?? null,
        input: a.input ?? null,
      })),
    });
  if (!shown.length) {
    log(
      output.info(
        all.length
          ? `No pending approvals for org ${name} (${all.length} resolved — use --all).`
          : `No approval requests recorded for org ${name}.`,
      ),
    );
    return { success: true };
  }
  for (const a of shown) {
    const when = utcDateMinute(a.ts);
    const mark = a.approved === null ? '❓' : a.approved ? '✓' : '✗';
    const ref = a.requestId ? ` [${a.requestId}]` : '';
    const by = a.resolvedBy ? ` (by ${a.resolvedBy})` : '';
    log(output.info(`${mark} ${when}  ${a.roleId}: ${a.action}${ref}${by}`));
  }
  if (shown.some((a) => a.approved === null))
    log(
      output.info(
        `\nApprove with: monomind org approve ${name} <role> <action> [--request <id>] [--by <resolver>]\nDeny with: monomind org deny ${name} <role> <action> [--request <id>] [--by <resolver>]`,
      ),
    );
  return { success: true };
};

/** `org approve <org> <role> <action>` — approve a pending tool/action approval */
/** Shared by approveAction/denyAction: try the live daemon first (updates its
 *  in-memory state and notifies the waiting agent's mailbox immediately), and
 *  fall back to writing approvals.json directly only when no daemon hosts this
 *  project's org or it is unreachable. A refusal from the daemon fails with
 *  nothing recorded (see hostingDaemonFor). */
async function resolveApproval(
  ctx: CommandContext,
  name: string,
  role: string,
  action: string,
  approved: boolean,
): Promise<CommandResult> {
  const verb = approved ? 'approved' : 'denied';
  // #677: an automation call may send a message to a person; only a human
  // (no agent-context marker in the environment) may release it.
  if (approved && action.startsWith('monoagent__automation_')) {
    const marker = detectAgentContextMarker();
    if (marker) {
      log(
        output.error(
          `Refusing: this looks like an agent/automated context (${marker} is set) — ` +
            'approving an automation call must be done by a human. Run this yourself in a terminal.',
        ),
      );
      return { success: false, message: `refused: agent context detected (${marker})` };
    }
  }
  // M5: attribution and request scoping.
  const byFlag = await resolverFlag(ctx);
  if (!byFlag.ok) return { success: false, message: byFlag.message };
  const resolvedBy = byFlag.by;
  const requestId =
    typeof ctx.flags.request === 'string' && ctx.flags.request ? ctx.flags.request : undefined;
  if (ctx.flags.request !== undefined && !requestId)
    return { success: false, message: '--request needs an approval request id (apr-…)' };

  // SEC: approvals carry human authority — the operator credential, never the
  // broker entry's agent credential (which any agent subprocess can read).
  const { readOperatorCredential } = await import('../orgrt/broker.js');
  const remote = await hostingDaemonFor(ctx.cwd, name);
  if (remote) {
    const cred = readOperatorCredential(name);
    try {
      const res = await fetch(`${remote.url}/api/set-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cred ? { 'x-monomind-cred': cred } : {}),
        },
        body: JSON.stringify({
          org: name,
          role,
          action,
          approved,
          resolvedBy,
          ...(requestId ? { requestId } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        if (orgJson(ctx))
          return printOrgJson({
            v: 1,
            org: name,
            role,
            action,
            approved,
            delivery: 'live',
            resolvedBy,
            requestId: requestId ?? null,
          });
        log(
          approved
            ? output.success(`Approved: ${role} may execute ${action} (live, by ${resolvedBy}).`)
            : output.info(`Denied: ${role} may NOT execute ${action} (live, by ${resolvedBy}).`),
        );
        return { success: true, message: `${verb} ${action} for ${role}` };
      }
      // SEC: a refusal (403 without the operator credential included) must
      // not fall through to writing approvals.json — that approved a call
      // without the operator check or the audit event.
      log(output.error(`Live ${verb} rejected (${data.error ?? res.status}) — nothing recorded.`));
      return { success: false, message: `approval rejected: ${data.error ?? res.status}` };
    } catch (err) {
      log(
        output.warning(
          `Hosting daemon unreachable (${err instanceof Error ? err.message : 'error'}) — falling back to offline queue.`,
        ),
      );
    }
  }

  // Offline path: org isn't live (or the live call failed) — write approvals.json directly.
  const approvalsPath = join(ctx.cwd, ORG_DIR, name, 'approvals.json');
  if (!existsSync(approvalsPath)) {
    return { success: false, message: `no pending approvals for org ${name}` };
  }
  const data = JSON.parse(readFileSync(approvalsPath, 'utf8'));
  const pending: OrgApproval[] = data.approvals ?? [];
  // Same selection as the daemon's setApproval: the one request named by
  // --request, else every still-pending entry for the (role, action) pair.
  const items = pending.filter(
    (a) =>
      a.roleId === role &&
      a.action === action &&
      a.approved === null &&
      (requestId === undefined || a.requestId === requestId),
  );

  if (items.length === 0) {
    return {
      success: false,
      message: requestId
        ? `no pending approval ${requestId} found for role ${role} action ${action}`
        : `no pending approval found for role ${role} action ${action}`,
    };
  }

  const now = Date.now();
  for (const item of items) {
    item.approved = approved;
    item.ts = now;
    item.resolvedBy = resolvedBy;
    item.resolvedAt = now;
  }
  writeFileSync(approvalsPath, JSON.stringify({ approvals: pending }, null, 2));

  if (orgJson(ctx))
    return printOrgJson({
      v: 1,
      org: name,
      role,
      action,
      approved,
      delivery: 'recorded',
      resolvedBy,
      requestId: requestId ?? null,
    });
  log(
    approved
      ? output.success(`Approved: ${role} may execute ${action} (by ${resolvedBy})`)
      : output.info(`Denied: ${role} may NOT execute ${action} (by ${resolvedBy})`),
  );
  return { success: true, message: `${verb} ${action} for ${role}` };
}

/** `org approve <org> <role> <action> [--request <id>] [--by <resolver>]` — approve a pending tool/action approval */
export const approveAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const role = ctx.args[1];
  const action = ctx.args[2];
  if (!role || !action) {
    return { success: false, message: 'usage: org approve <org> <role> <action>' };
  }
  return resolveApproval(ctx, name, role, action, true);
};

/** `org deny <org> <role> <action> [--request <id>] [--by <resolver>]` — deny a pending tool/action approval */
export const denyAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const role = ctx.args[1];
  const action = ctx.args[2];
  if (!role || !action) {
    return { success: false, message: 'usage: org deny <org> <role> <action>' };
  }
  return resolveApproval(ctx, name, role, action, false);
};
