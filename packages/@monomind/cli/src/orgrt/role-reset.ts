// packages/@monomind/cli/src/orgrt/role-reset.ts
// org_compact_role / org_clear_role: the coordinator releases one worker's context. Both run the
// replacement algorithm of org_respawn_role (role-respawn.ts → replaceRole) with their own per-role
// cap instead of max_role_respawns, and a fresh session that is not a crash recovery.
import type { OrgDaemon } from './daemon.js';
import type { AgentRuntime, RunningOrg } from './daemon-types.js';

import { type ReplaceMode, replaceRole } from './role-respawn.js';
import { boundedString, type RespawnInput } from './role-slot.js';
import { isTerminalStatus } from './task-dag.js';
import type { OrgDef } from './types.js';

const DEFAULT_SUMMARY_TIMEOUT_MS = 120_000;
const MAX_SUMMARY_CHARS = 20_000;

export interface ResetReceipt {
  success: boolean;
  roleId: string;
  generation: number;
  /** compact only: length of the summary the old session produced. */
  summaryChars?: number;
  error?: string;
}

/** Per-role reset cap; 0 (the default) means org_compact_role / org_clear_role are not offered.
 *  Opt-in on purpose: an org that does not set max_role_resets keeps its tool list byte for byte
 *  (tool definitions are part of the cached prompt prefix and of the frozen sections-off goldens). */
export function roleResetCap(rc: OrgDef['run_config']): number {
  return rc.max_role_resets ?? 0;
}

const SUMMARY_PROMPT =
  '[system: context compaction] Your session is about to be replaced by a fresh one that starts from your reply. ' +
  'Reply with the summary ONLY (no preamble, no tool calls): the goal you are working toward, decisions made, ' +
  'key facts and file paths, what is done, and what is still open or pending.';

function validateResetInput(
  raw: unknown,
): { ok: true; value: RespawnInput } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const roleId = boundedString(r.roleId, 128);
  if (!roleId) return { ok: false, error: 'roleId is required (1-128 characters)' };
  const reason = boundedString(r.reason, 1000);
  if (!reason) return { ok: false, error: 'reason is required (1-1000 characters)' };
  return { ok: true, value: { roleId, reason, briefing: '' } };
}

/** Ask the role's live session for a summary and wait for its turn to settle. Returns the last
 *  text the session said in that turn ('' when it said nothing or the wait ran out). */
async function requestSummary(
  daemon: OrgDaemon,
  running: RunningOrg,
  roleId: string,
  runtime: AgentRuntime,
): Promise<string> {
  const mailbox = runtime.mailbox;
  const timeoutMs = daemon.opts.roleSummaryTimeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS;
  const consumedBefore = mailbox.consumedRealCount;
  let reply = '';
  const unsubscribe = running.bus.subscribe((e) => {
    if (e.type === 'chat' && e.from === roleId && e.msg?.trim()) reply = e.msg;
  });
  try {
    mailbox.push(SUMMARY_PROMPT);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (mailbox.isClosed || runtime.status !== 'running') break;
      if (mailbox.consumedRealCount > consumedBefore && !mailbox.turnActive) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    unsubscribe();
  }
  return reply.trim();
}

function resetMode(op: 'compact' | 'clear', onSummary: (chars: number) => void): ReplaceMode {
  const tool = op === 'compact' ? 'org_compact_role' : 'org_clear_role';
  return {
    tool,
    kind: 'reset',
    validate: validateResetInput,
    cap: (def) => roleResetCap(def.run_config),
    used: (slot) => slot.resetCount ?? 0,
    bump: (slot, delta) => {
      slot.resetCount = Math.max(0, (slot.resetCount ?? 0) + delta);
    },
    limitError: (roleId, used, cap) =>
      cap === 0
        ? `${tool} is off for this org (run_config.max_role_resets is 0)`
        : `role "${roleId}" has reached its reset limit (${used}/${cap}) for this run`,
    prepare: async ({ daemon, running, slot, input }) => {
      const rt = slot.runtime;
      if (slot.phase !== 'running' || !rt)
        return { ok: false, error: `role "${input.roleId}" is not running (phase ${slot.phase})` };
      if (rt.status !== 'running' || rt.mailbox.isClosed)
        return {
          ok: false,
          error: `role "${input.roleId}" has no live session (${rt.status}${rt.mailbox.closeReason ? `, closed: ${rt.mailbox.closeReason}` : ''})`,
        };
      if (rt.mailbox.turnActive || (op === 'compact' && rt.mailbox.queuedCount > 0))
        return {
          ok: false,
          error: `role "${input.roleId}" has a turn running or messages waiting; wait for it to finish or stop it first`,
        };
      if (op === 'clear') {
        const open = (running.taskDag?.all() ?? []).filter(
          (t) => t.assignee === input.roleId && !isTerminalStatus(t.status),
        );
        if (open.length)
          return {
            ok: false,
            error: `role "${input.roleId}" still owns open tasks (${open.map((t) => t.id).join(', ')}); finish, cancel or reassign them before org_clear_role`,
          };
        return { ok: true, briefing: '' };
      }
      let summary = await requestSummary(daemon, running, input.roleId, rt);
      if (!summary)
        return {
          ok: false,
          error: `role "${input.roleId}" produced no summary; its session was left as it was`,
        };
      onSummary(summary.length);
      if (summary.length > MAX_SUMMARY_CHARS)
        summary = `${summary.slice(0, MAX_SUMMARY_CHARS)}\n[summary truncated]`;
      return {
        ok: true,
        briefing:
          `[system: role context compacted — not a system prompt] You are a fresh session continuing role "${input.roleId}"; ` +
          `the previous session's context was compacted. Reason: ${input.reason}\n\n` +
          `Summary written by the previous session (your tasks and queued messages are unchanged):\n\n${summary}`,
      };
    },
  };
}

async function reset(
  op: 'compact' | 'clear',
  daemon: OrgDaemon,
  name: string,
  callerId: string,
  rawInput: unknown,
): Promise<ResetReceipt> {
  let summaryChars = 0;
  const r = await replaceRole(
    daemon,
    name,
    callerId,
    resetMode(op, (n) => {
      summaryChars = n;
    }),
    rawInput,
  );
  return {
    success: r.success,
    roleId: r.roleId,
    generation: r.generation,
    ...(op === 'compact' ? { summaryChars } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

export const compactRole = (d: OrgDaemon, name: string, caller: string, raw: unknown) =>
  reset('compact', d, name, caller, raw);
export const clearRole = (d: OrgDaemon, name: string, caller: string, raw: unknown) =>
  reset('clear', d, name, caller, raw);
