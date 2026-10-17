// packages/@monomind/cli/src/orgrt/model-guard-hook.ts
/**
 * PreToolUse hook for every Claude org session: an Agent/Task launch that names
 * a blocked model (Claude Fable, GPT Astra) is refused. Without it a role could
 * pick such a model for a subagent itself; the coder pin only constrains a
 * launch to the pinned model when coder mode set one.
 */
import { isBlockedModel } from '../model-guard.js';

export async function modelGuardPreToolUse(hook: {
  hook_event_name?: string;
  tool_name?: unknown;
  tool_input?: unknown;
}): Promise<Record<string, unknown>> {
  if (hook.hook_event_name !== 'PreToolUse') return {};
  if (hook.tool_name !== 'Agent' && hook.tool_name !== 'Task') return {};
  const model = (hook.tool_input as { model?: unknown } | undefined)?.model;
  if (!isBlockedModel(model)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Model "${String(model)}" is blocked: Claude Fable and GPT Astra models are never assigned or routed. Launch the subagent on its role's own model, or leave "model" out.`,
    },
  };
}
