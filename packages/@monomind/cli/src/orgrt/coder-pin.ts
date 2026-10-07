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

/** Defaults for the delegation cap (#655: 76-85 launches, a third to half of them
 *  reviews, in one session). 0 turns a cap off. Override with the env keys below. */
export const MAX_AGENT_LAUNCHES = 40;
export const MAX_REVIEW_LAUNCHES = 12;
const REVIEW = /review/i;

function limit(env: NodeJS.ProcessEnv, key: string, dflt: number): number {
  const n = Number(env[key]);
  return env[key] !== undefined && Number.isInteger(n) && n >= 0 ? n : dflt;
}

export interface CoderPin {
  /** Agent/Task launches seen so far, and how many described a review. */
  launches: () => { total: number; review: number };
  /** Env to merge over the spawned CLI's environment. */
  env: Record<string, string>;
  /** Inline `settings` option; outranks the user, project and local files. */
  settings: { env: Record<string, string> };
  /** PreToolUse hook: denies an Agent/Task launch naming another model. */
  preToolUse: (input: {
    hook_event_name?: string;
    tool_name?: unknown;
    tool_input?: unknown;
  }) => Promise<Record<string, unknown>>;
}

const ALIASES = new Set(['', 'default', 'inherit']);

/** Same model when equal, or one is the other's alias (`sonnet` ⊂ `claude-sonnet-5-5`). */
function sameModel(requested: string, pinned: string): boolean {
  const r = requested.toLowerCase();
  const p = pinned.toLowerCase();
  return r === p || p.includes(r) || r.includes(p);
}

/** Coder mode always gets one: the delegation caps apply even with no model or effort selected. */
export function coderPin(
  sel: { model?: string; effort?: string },
  processEnv: NodeJS.ProcessEnv = process.env,
): CoderPin {
  const maxTotal = limit(processEnv, 'MONOMIND_CODER_MAX_AGENTS', MAX_AGENT_LAUNCHES);
  const maxReview = limit(processEnv, 'MONOMIND_CODER_MAX_REVIEW_AGENTS', MAX_REVIEW_LAUNCHES);
  const seen = { total: 0, review: 0 };
  const model = sel.model && !ALIASES.has(sel.model.toLowerCase()) ? sel.model : undefined;
  const effort = sel.effort && sel.effort !== 'off' ? sel.effort : undefined;
  const env: Record<string, string> = {
    ...(effort ? { CLAUDE_CODE_EFFORT_LEVEL: effort } : {}),
    ...(model ? { CLAUDE_CODE_SUBAGENT_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } : {}),
  };
  return {
    env,
    settings: { env },
    launches: () => ({ ...seen }),
    async preToolUse(hook) {
      if (hook.hook_event_name !== 'PreToolUse') return {};
      if (hook.tool_name !== 'Agent' && hook.tool_name !== 'Task') return {};
      const deny = (reason: string) => ({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      });
      const input = (hook.tool_input ?? {}) as {
        model?: unknown;
        description?: unknown;
        subagent_type?: unknown;
      };
      const asked = input.model;
      if (
        model &&
        typeof asked === 'string' &&
        !ALIASES.has(asked.toLowerCase()) &&
        !sameModel(asked, model)
      )
        return deny(
          `coder session is pinned to model "${model}"; refusing a subagent on "${asked}". Omit the model argument to use the selected one.`,
        );
      const isReview = REVIEW.test(`${input.description ?? ''} ${input.subagent_type ?? ''}`);
      if (maxReview > 0 && isReview && seen.review >= maxReview)
        return deny(
          `review limit reached (${maxReview} review agents this session; MONOMIND_CODER_MAX_REVIEW_AGENTS raises it). Batch the remaining changes into one scoped review, or review inline.`,
        );
      if (maxTotal > 0 && seen.total >= maxTotal)
        return deny(
          `delegation limit reached (${maxTotal} agent launches this session; MONOMIND_CODER_MAX_AGENTS raises it). Do the remaining work in this session or batch it into fewer agents.`,
        );
      seen.total++;
      if (isReview) seen.review++;
      return {};
    },
  };
}
