// packages/@monomind/cli/src/orgrt/coder-pin.ts
/**
 * #655: in coder mode the selected model and effort are authoritative.
 *
 * Coder mode loads the user's own settings files, whose `env` block (and the
 * ambient process env) can carry CLAUDE_CODE_EFFORT_LEVEL=max, which Claude
 * Code ranks above the `--effort` flag. Inline `settings` are a higher scope
 * than the user/project/local files, so the pin goes there as well as into the
 * spawned env. Subagents inherit the parent model only by default: a per-call
 * `Agent.model` or agent frontmatter wins over CLAUDE_CODE_SUBAGENT_MODEL, and
 * the bundled CLI (0.3.226) has no `_FORCE` switch, so a PreToolUse hook
 * refuses an Agent launch that names a different model.
 */

export interface CoderPin {
  /** Env to merge over the spawned CLI's environment. */
  env: Record<string, string>;
  /** Inline `settings` option; outranks the user, project and local files. */
  settings: { env: Record<string, string> };
  /** PreToolUse hook: denies an Agent/Task launch naming another model. */
  preToolUse: (input: { hook_event_name?: string; tool_name?: unknown; tool_input?: unknown }) => Promise<Record<string, unknown>>;
}

const ALIASES = new Set(['', 'default', 'inherit']);

/** Same model when equal, or one is the other's alias (`sonnet` ⊂ `claude-sonnet-5-5`). */
function sameModel(requested: string, pinned: string): boolean {
  const r = requested.toLowerCase();
  const p = pinned.toLowerCase();
  return r === p || p.includes(r) || r.includes(p);
}

/** undefined when there is nothing to pin (no model and no effort selected). */
export function coderPin(sel: { model?: string; effort?: string }): CoderPin | undefined {
  const model = sel.model && !ALIASES.has(sel.model.toLowerCase()) ? sel.model : undefined;
  const effort = sel.effort && sel.effort !== 'off' ? sel.effort : undefined;
  if (!model && !effort) return undefined;
  const env: Record<string, string> = {
    ...(effort ? { CLAUDE_CODE_EFFORT_LEVEL: effort } : {}),
    ...(model ? { CLAUDE_CODE_SUBAGENT_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } : {}),
  };
  return {
    env,
    settings: { env },
    async preToolUse(hook) {
      if (!model || hook.hook_event_name !== 'PreToolUse') return {};
      if (hook.tool_name !== 'Agent' && hook.tool_name !== 'Task') return {};
      const asked = (hook.tool_input as { model?: unknown } | undefined)?.model;
      if (typeof asked !== 'string' || ALIASES.has(asked.toLowerCase()) || sameModel(asked, model)) return {};
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `coder session is pinned to model "${model}"; refusing a subagent on "${asked}". Omit the model argument to use the selected one.`,
        },
      };
    },
  };
}
