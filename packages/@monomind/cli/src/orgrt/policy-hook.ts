// packages/@monomind/cli/src/orgrt/policy-hook.ts
/**
 * Every tool call of a Claude role through the org permission gate.
 *
 * The Claude Code CLI calls `canUseTool` only for a call its own rules would
 * ask about. Read-only Bash (`cat`, `ls`, `git status`, `git log`), Read inside
 * the cwd, Agent, ToolSearch and ListAgents are allowed without it, so they
 * skipped the PolicyEngine entirely: no `tool` audit event, and denyTools,
 * allowTools, fileRead scopes, budget exhaustion, a pending gate, the fence
 * and approvals never applied to them. The 2.16.7 release run had 959 Bash
 * results against 655 Bash decisions.
 *
 * The PreToolUse hook fires for every call — main thread and subagents —
 * before the CLI's permission rules. It runs the gate and denies there; an
 * allowed call continues through the CLI's normal flow (deny rules, the OS
 * sandbox). When the CLI then asks `canUseTool` about the same call, the
 * hook's decision is returned instead of deciding (and auditing) twice.
 */

type Gate = (
  toolName: string,
  input: Record<string, unknown>,
  meta?: { toolUseId?: string },
) => Promise<unknown>;

/** Decisions the hook made that canUseTool may still ask about. Most calls
 *  are never asked about (the CLI allowed them itself), so the oldest go. */
const REMEMBERED = 256;

/** Hook timeout in seconds. The CLI lets a call proceed when its hook times
 *  out, so this stays far above what the gate takes (approvals return a
 *  pending decision at once rather than waiting for the human). */
export const POLICY_HOOK_TIMEOUT_S = 600;

export function coverEveryToolCall(gate: Gate): {
  canUseTool: Gate;
  preToolUse: (input: {
    hook_event_name?: string;
    tool_name?: unknown;
    tool_input?: unknown;
    tool_use_id?: unknown;
  }) => Promise<Record<string, unknown>>;
} {
  const decided = new Map<string, { input: string; decision: Promise<unknown> }>();
  return {
    async preToolUse(hook) {
      if (hook.hook_event_name !== 'PreToolUse') return {};
      const input = (hook.tool_input ?? {}) as Record<string, unknown>;
      const id = typeof hook.tool_use_id === 'string' ? hook.tool_use_id : undefined;
      const decision = gate(String(hook.tool_name ?? ''), input, { toolUseId: id });
      if (id) {
        decided.set(id, { input: JSON.stringify(input), decision });
        if (decided.size > REMEMBERED) decided.delete(decided.keys().next().value as string);
      }
      const d = (await decision) as { behavior?: string; message?: string };
      if (d?.behavior !== 'deny') return {};
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: d.message ?? 'denied by org policy',
        },
      };
    },
    canUseTool(toolName, input, meta) {
      const id = meta?.toolUseId;
      const prior = id ? decided.get(id) : undefined;
      if (id) decided.delete(id);
      if (prior && prior.input === JSON.stringify(input)) return prior.decision;
      return gate(toolName, input, meta);
    },
  };
}
