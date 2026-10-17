// packages/@monomind/cli/src/model-guard.ts
/**
 * Claude Fable and GPT Astra models are never assigned or routed.
 *
 * One decision function shared by every place that chooses, resolves, lists
 * or validates a model: org role models and tiers, `agent exec|test --model`,
 * `agent models`, MCP agent tools, subagent launches. There is deliberately no
 * override: a model that must not be routed is refused wherever it appears.
 *
 * `.claude/helpers/handlers/model-guard.cjs` carries the same two patterns for
 * the interactive PreToolUse hook, which runs outside this package; a test
 * keeps the two in step.
 */

/** A name is blocked when `fable` or `astra` is a whole word in it, so
 *  `claude-fable-5-1`, `Fable 5.1` and `gpt-6-astra` match, `contrast` does not. */
const BLOCKED = [/(^|[^a-z])fable([^a-z]|$)/i, /(^|[^a-z])astra([^a-z]|$)/i];

export class ModelBlockedError extends Error {
  constructor(model: string, where?: string) {
    super(
      `Model "${model}"${where ? ` (${where})` : ''} is blocked: Claude Fable and GPT Astra models are never assigned or routed.`,
    );
    this.name = 'ModelBlockedError';
  }
}

export function isBlockedModel(model: unknown): boolean {
  return typeof model === 'string' && BLOCKED.some((re) => re.test(model));
}

/** Throws ModelBlockedError when `model` is blocked; `where` says what asked for it. */
export function assertModelAllowed(model: unknown, where?: string): void {
  if (isBlockedModel(model)) throw new ModelBlockedError(String(model), where);
}

/** Drops listing entries whose id, alias, resolved model or label is blocked. */
export function withoutBlockedModels<T extends object>(list: readonly T[]): T[] {
  return list.filter(
    (m) =>
      !Object.values(m).some((v) =>
        Array.isArray(v) ? v.some(isBlockedModel) : isBlockedModel(v),
      ),
  );
}
