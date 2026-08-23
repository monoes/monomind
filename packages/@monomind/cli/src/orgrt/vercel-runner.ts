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
 *   3. Cost: Vercel returns token usage but no USD; we yield cost_usd: 0
 *      (documented). Token budgets still enforce via policy.ts.
 *   4. Mailbox consumption: Vercel's streamText takes a single prompt, not an
 *      async iterable. We loop over args.prompt, running one streamText per
 *      mailbox message and accumulating into messages[].
 *
 * Streaming asymmetry (documented): Vercel yields per-token text-delta events
 * (real-time token streaming), while the Codex runner yields whole
 * agent_message items at once. This matches each vendor's native behavior.
 */
import { z } from 'zod';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
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
    const orgDir = args.env.MONOMIND_ORG_DIR ?? args.cwd;
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
          inputSchema: z.object(t.schema),
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
        });

        let assistantText = '';
        for await (const part of result.fullStream) {
          // ai-sdk v7's text-delta stream part carries the chunk under `text`,
          // not `textDelta` — the latter is always undefined, which silently
          // concatenates the literal string "undefined" into assistantText.
          if (part.type === 'text-delta') {
            assistantText += part.text;
            yield { type: 'assistant', session_id: store.sessionId, text: part.text };
          }
        }

        messages.push({ role: 'assistant', content: assistantText });
        await store.save(messages);

        // Vercel SDK v4+: `result.usage` is a Promise that resolves only AFTER
        // the stream completes. Awaiting it here (post-fullStream drain) gives
        // the real token counts; without the await, `.inputTokens` would
        // be undefined and budgets would silently never enforce.
        const usage = await result.usage;

        // Yield token usage; cost_usd: 0 (Vercel returns no USD; documented —
        // token budgets still enforce via policy.ts). `result.usage` resolves
        // to `totalUsage`, whose fields are `inputTokens`/`outputTokens` — not
        // `totalInputTokens`/`totalOutputTokens` (that prefix doesn't exist on
        // this object and silently zeroed every vercel-routed role's usage).
        yield {
          type: 'result',
          session_id: store.sessionId,
          subtype: 'success',
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          cost_usd: 0,
          is_error: false,
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
