// packages/@monomind/cli/src/orgrt/agent-runner.ts
/**
 * AgentRunner — provider-agnostic execution surface for Org Runtime v2.
 *
 * Why this exists: session.ts used to import `query`, `tool`, and
 * `createSdkMcpServer` directly from `@anthropic-ai/claude-agent-sdk`, which
 * hard-coupled the entire org runtime to Claude. This interface lets session.ts
 * describe WHAT to run (an agent with a set of org tools, a system prompt, and
 * a mailbox prompt stream) without knowing WHICH SDK executes it.
 *
 * Behavior preservation (the invariant the Claude path must not break):
 * ClaudeAgentRunner is a faithful, line-for-line extraction of the previous
 * inline logic in session.ts's runOneSession — same options object, same
 * message normalization, same queryFn injection seam that test-loop.ts relies
 * on. The default runner is ClaudeAgentRunner, so an org that doesn't ask for
 * opencode executes through exactly the same code path it always did.
 */

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { z } from 'zod';

/** A platform-agnostic org tool definition. `schema` is a zod object because
 *  both the Claude SDK's `tool()` and opencode's `tool()` consume zod. */
export interface OrgToolDef {
  name: string;
  description: string;
  /** zod shape object (e.g. { query: z.string() }), NOT a z.object() instance.
   *  Both the Claude SDK's tool() and opencode's tool() consume a shape. */
  schema: Record<string, z.ZodType<any>>;
  handler: (args: Record<string, unknown>) => Promise<{ text: string }>;
}

/** Arguments every runner needs to execute one agent session. */
export interface AgentRunArgs {
  tools: OrgToolDef[];
  /** The mailbox prompt stream (or any async iterable of prompt messages). */
  prompt: AsyncIterable<any>;
  systemPrompt: string;
  model?: string;
  cwd: string;
  env: Record<string, string>;
  maxTurns: number;
  resume?: string;
  canUseTool?: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
  /** Provider-specific escape hatch. ClaudeAgentRunner merges this into the
   *  SDK options verbatim (e.g. the `_orgTest` seam used by test-loop.ts).
   *  Other runners ignore it. */
  extras?: Record<string, unknown>;
}

/** Normalized message every runner yields. Carries `session_id` on whatever
 *  message the underlying SDK attaches it to, so session.ts can track it for
 *  resume — matching the previous `if (m.session_id) sessionId = m.session_id`
 *  behaviour that read it off ANY message kind.
 *
 *  `tool_use` is a lightweight liveness/progress signal: session.ts never
 *  renders it as chat or usage — it only feeds the StateDetector (which maps
 *  it to the 'tool-call' state) and refreshes last-activity. Subprocess
 *  runners (kimicode) emit it for native tool activity so long turns show
 *  ongoing progress instead of looking silent. */
export interface AgentMessage {
  type: 'assistant' | 'result' | 'tool_use';
  session_id?: string;
  text?: string; // assistant (prose) / tool_use (short progress label)
  subtype?: string; // result
  is_error?: boolean; // result
  input_tokens?: number; // result
  output_tokens?: number; // result
  cost_usd?: number; // result
}

export interface AgentRunner {
  run(args: AgentRunArgs): AsyncIterable<AgentMessage>;
}

/**
 * Default runner — wraps the Claude Agent SDK. This is the previous inline
 * logic of runOneSession, extracted verbatim:
 *   - convert OrgToolDef[] → SDK tool() calls → createSdkMcpServer
 *   - call queryFn({ prompt, options }) (queryFn injectable for tests)
 *   - normalize the raw stream into AgentMessage
 */
export class ClaudeAgentRunner implements AgentRunner {
  constructor(private queryFn: typeof query = query) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    // Wrap each OrgToolDef handler ({ text }) into the Claude SDK's
    // { content: [{ type: 'text', text }] } return shape.
    const sdkTools = args.tools.map((t) =>
      tool(t.name, t.description, t.schema, async (input: Record<string, unknown>) => {
        const r = await t.handler(input);
        return { content: [{ type: 'text' as const, text: r.text }] };
      }),
    );
    const orgServer = createSdkMcpServer({ name: 'org', version: '1.0.0', tools: sdkTools });

    const stream = this.queryFn({
      prompt: args.prompt,
      options: {
        systemPrompt: args.systemPrompt,
        model: args.model,
        cwd: args.cwd,
        env: args.env,
        mcpServers: { org: orgServer },
        maxTurns: args.maxTurns,
        permissionMode: 'default',
        resume: args.resume,
        canUseTool: args.canUseTool,
        ...(args.extras || {}),
      } as any,
    });

    for await (const m of stream as AsyncIterable<any>) {
      const session_id = m.session_id;
      if (m.type === 'assistant') {
        const text = (m.message?.content ?? [])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
        yield { type: 'assistant', session_id, text };
      } else if (m.type === 'result') {
        yield {
          type: 'result',
          session_id,
          subtype: m.subtype,
          is_error: m.is_error,
          input_tokens: m.usage?.input_tokens ?? 0,
          output_tokens: m.usage?.output_tokens ?? 0,
          cost_usd: m.total_cost_usd,
        };
      }
      // Other message kinds (tool_use, tool_result, system, …) carry no
      // signal session.ts previously acted on, so they're dropped here —
      // matching the prior code which only branched on assistant/result.
    }
  }
}

/** Shared default instance (stateless — safe to reuse). */
export const defaultClaudeRunner = new ClaudeAgentRunner();
