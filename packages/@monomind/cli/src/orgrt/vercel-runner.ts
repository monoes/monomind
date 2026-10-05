// packages/@monomind/cli/src/orgrt/vercel-runner.ts
/**
 * VercelAgentRunner — AgentRunner impl backed by the Vercel AI SDK.
 *
 * Architecture: unlike Claude/Kimi/Codex which spawn subprocess binaries or
 * run the whole agent loop in-process via vendor SDKs, Vercel SDK is a thin
 * HTTP client over each vendor's native API. We compose the agent loop
 * manually via streamText + stopWhen: isStepCount(N), per Vercel v7 docs.
 *
 * Critical design decisions (see plan review §1-4):
 *   1. Session resume: Vercel is stateless; we persist messages to disk via
 *      VercelSessionStore and reload on resume.
 *   2. Tool policy: every tool's execute() wraps args.canUseTool — bypassing
 *      it would defeat the per-role policy engine (denyTools, file scope, etc.)
 *   3. Cost: Vercel returns token usage but no USD; the result carries no
 *      cost_usd (unknown, reported as null — never 0). Token budgets still
 *      enforce via policy.ts.
 *   4. Mailbox consumption: Vercel's streamText takes a single prompt, not an
 *      async iterable. We loop over args.prompt, running one streamText per
 *      mailbox message and accumulating into messages[].
 *
 * Streaming: Vercel streams per-token text-delta events. The runner joins
 * them into one `assistant` message per model step (one org chat event,
 * #563) and yields the raw deltas only when extras.includePartialMessages
 * is set, like the other runners.
 */
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { RUNNER_DATA_DIR_ENV } from './documents/runtime-isolation.js';
import { toolInputSchema } from './tool-fence.js';
import { loadVercelProvider, VERCEL_PROVIDERS } from './vercel-providers.js';
import { VercelSessionStore } from './vercel-session-store.js';

export interface VercelRunnerArgs extends AgentRunArgs {
  /** Vendor slug from the provider config (e.g. 'glm', 'openai', 'deepseek'). */
  vendor?: string;
  /** Full provider config from the role definition. */
  providerConfig?: {
    kind?: string;
    vendor?: string;
    apiKeyEnv?: string;
    baseUrl?: string;
  };
}

export class VercelAgentRunner implements AgentRunner {
  async *run(args: VercelRunnerArgs): AsyncIterable<AgentMessage> {
    const vendor = args.vendor ?? args.providerConfig?.vendor ?? 'openai';
    const def = VERCEL_PROVIDERS[vendor];
    if (!def) throw new Error(`VercelAgentRunner: unknown vendor "${vendor}"`);

    // Resolve API key from the named env var (inherited via process.env)
    const envVarName = args.providerConfig?.apiKeyEnv ?? def.envVar;
    const apiKey = envVarName ? (args.env[envVarName] ?? process.env[envVarName]) : undefined;
    const baseUrl = args.providerConfig?.baseUrl ?? def.defaultBaseUrl;

    // Dynamic import — fails with clear error if package missing
    const modelFactory = await loadVercelProvider(def, apiKey, baseUrl);
    const modelId = args.model ?? def.defaultModel;
    if (!modelId) {
      throw new Error(
        `VercelAgentRunner: no model specified for vendor "${vendor}". ` +
          `Set adapter_config.model in the role definition.`,
      );
    }
    const model = modelFactory(modelId);

    // Dynamic import of the Vercel AI SDK core. Specifier held in a variable
    // so TypeScript types the result as `any` and does NOT try to resolve
    // (and fail on) the missing module at compile time.
    const aiSpec = 'ai';
    let streamText: any, tool: any, isStepCount: any;
    try {
      const ai: any = await import(/* @vite-ignore */ aiSpec);
      streamText = ai.streamText;
      tool = ai.tool;
      isStepCount = ai.isStepCount;
    } catch {
      throw new Error('VercelAgentRunner requires the "ai" package. Install it: npm install ai');
    }

    // Session store for resume — org dir is set by session.ts via env
    // Sections orgs: the session store goes to the role's private directory, not the
    // org's shared sessions directory.
    const orgDir = args.env[RUNNER_DATA_DIR_ENV] ?? args.env.MONOMIND_ORG_DIR ?? args.cwd;
    const roleId = args.env.MONOMIND_ROLE_ID ?? 'default';
    const store = new VercelSessionStore(orgDir, roleId, args.resume);
    const messages = await store.load();

    // Build tools with policy gating — CRITICAL: every execute() must call
    // canUseTool before running the handler, otherwise denyTools / file scope
    // / fence guardrails are all silently bypassed.
    const buildTools = (): Record<string, any> => {
      const vercelTools: Record<string, any> = {};
      for (const t of args.tools) {
        vercelTools[t.name] = tool({
          description: t.description,
          inputSchema: toolInputSchema(t),
          execute: async (input: Record<string, unknown>): Promise<string> => {
            if (args.canUseTool) {
              const decision = await args.canUseTool(t.name, input);
              if (decision && typeof decision === 'object' && 'behavior' in decision) {
                if ((decision as { behavior: string }).behavior === 'deny') {
                  throw new Error(
                    `Tool ${t.name} denied by policy: ${(decision as { message?: string }).message ?? 'no reason'}`,
                  );
                }
              } else if (decision === false) {
                throw new Error(`Tool ${t.name} denied by policy`);
              }
            }
            return (await t.handler(input)).text;
          },
        });
      }
      return vercelTools;
    };

    const streamPartials = args.extras?.includePartialMessages === true;

    // Mailbox turn-loop: streamText takes one prompt at a time. The mailbox
    // (args.prompt) is an async iterable of incoming messages; we consume
    // each one, run a full streamText turn, and accumulate history.
    try {
      for await (const userMsg of args.prompt) {
        const userText =
          typeof userMsg === 'string'
            ? userMsg
            : (userMsg?.message?.content ?? String(userMsg ?? ''));
        messages.push({ role: 'user', content: userText });

        const result = streamText({
          model,
          system: args.systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          tools: buildTools(),
          stopWhen: isStepCount(args.maxTurns),
          // Abort hook (see AgentRunArgs.signal): no subprocess here, but
          // the SDK cancels the in-flight HTTP stream and stops issuing
          // further tool steps.
          abortSignal: args.signal,
        });

        let assistantText = '';
        // #563: session-run.ts emits one org bus `chat` event per `assistant`
        // message, so deltas are joined into one message per model step, as
        // the claude/codex/aider runners do. Per-delta streaming stays for
        // callers that opt in (agent exec sets includePartialMessages).
        let stepText = '';
        // An 'error' or 'abort' part does not end fullStream: the stream still
        // closes normally, so the turn's failure is recorded here.
        let failure: string | undefined;
        const takeStepText = (): string => {
          const text = stepText;
          stepText = '';
          return text;
        };
        try {
          for await (const part of result.fullStream) {
            // ai-sdk v7's text-delta stream part carries the chunk under `text`,
            // not `textDelta` — the latter is always undefined, which silently
            // concatenates the literal string "undefined" into assistantText.
            if (part.type === 'text-delta') {
              assistantText += part.text;
              if (streamPartials) {
                yield { type: 'assistant', session_id: store.sessionId, text: part.text };
              } else {
                stepText += part.text;
              }
            } else if (part.type === 'finish-step' && stepText) {
              yield { type: 'assistant', session_id: store.sessionId, text: takeStepText() };
            } else if (part.type === 'error') {
              failure ??= describeStreamError(part.error);
            } else if (part.type === 'abort') {
              failure ??= `vercel turn aborted${part.reason ? `: ${part.reason}` : ''}`;
            }
          }
        } catch (err) {
          // An aborted or failed turn still reports the text it got so far, once.
          if (stepText) {
            yield { type: 'assistant', session_id: store.sessionId, text: takeStepText() };
          }
          throw err;
        }
        // A stream that ends without a finish-step (e.g. an 'abort' part).
        if (stepText) {
          yield { type: 'assistant', session_id: store.sessionId, text: takeStepText() };
        }

        messages.push({ role: 'assistant', content: assistantText });
        await store.save(messages);

        // Vercel SDK v4+: `result.usage` is a Promise that resolves only AFTER
        // the stream completes. Awaiting it here (post-fullStream drain) gives
        // the real token counts; without the await, `.inputTokens` would
        // be undefined and budgets would silently never enforce.
        // A failed stream's usage promise can reject; the failure is still reported.
        const usage = failure ? await result.usage.catch(() => undefined) : await result.usage;

        // Yield token usage; no cost_usd (Vercel returns no USD, so the cost
        // is unknown, not 0 — token budgets still enforce via policy.ts). `result.usage` resolves
        // to `totalUsage`, whose fields are `inputTokens`/`outputTokens` — not
        // `totalInputTokens`/`totalOutputTokens` (that prefix doesn't exist on
        // this object and silently zeroed every vercel-routed role's usage).
        // A failed turn is reported like the claude runner's failed result
        // (error_during_execution, is_error); agent exec maps `text` to its
        // error code (rate-limited, auth, quota, runner-error).
        yield {
          type: 'result',
          session_id: store.sessionId,
          subtype: failure ? 'error_during_execution' : 'success',
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          is_error: failure !== undefined,
          ...(failure ? { text: failure } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        throw new Error(
          `VercelAgentRunner requires the "${def.package}" package and "ai". ` +
            `Install them: npm install ai ${def.package}`,
        );
      }
      throw err;
    }
  }
}

/** The message of an ai-sdk stream 'error' part (an Error, an APICallError
 *  with a statusCode, or a bare value). */
function describeStreamError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? `${error.message} (HTTP ${status})` : error.message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
