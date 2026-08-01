// packages/@monomind/cli/src/orgrt/tool-fence.ts
/**
 * Tool fence protocol — shared by the subprocess-backed AgentRunners
 * (KimiCodeAgentRunner, OpencodeAgentRunner).
 *
 * Why this exists: the Claude Agent SDK lets the daemon register org tools
 * (org_send, ask_human, …) as REAL tools via createSdkMcpServer. Subprocess
 * backends (the kimi CLI, an opencode server) own their tool surface — an
 * external caller cannot register tools per-turn. Instead the tools are
 * rendered INTO the role's system prompt; the model emits ```tool_call
 * fenced JSON blocks; the runner parses them out of the assistant text,
 * executes the real OrgToolDef handlers in-process (the same handlers
 * ClaudeAgentRunner registers with the SDK), and feeds the results back as
 * ```tool_result fences in the next prompt of the same session.
 */

import { z } from 'zod';
import type { OrgToolDef } from './agent-runner.js';

/** Fenced block the model uses to call a tool (see buildToolProtocol). */
export const TOOL_CALL_RE = /```tool_call\s*\n([\s\S]*?)```/g;

/** Max tool_call → tool_result round-trips within a single mailbox prompt.
 *  Guards against a model that keeps calling tools forever. */
export const MAX_TOOL_ROUNDS = 10;

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Render the org tools as a text protocol appended to the role's system
 * prompt. The model calls a tool by emitting a fenced block:
 *
 *   ```tool_call
 *   {"name": "org_send", "arguments": {"to": "...", "subject": "...", "message": "..."}}
 *   ```
 *
 * Results come back as a user-role prompt containing ```tool_result fences.
 */
export function buildToolProtocol(tools: OrgToolDef[]): string {
  if (!tools || tools.length === 0) return '';
  const lines = [
    '',
    '',
    '# Tool Protocol (MANDATORY)',
    '',
    'You have NO native tool-calling channel. Call a tool by emitting a fenced',
    'block EXACTLY like this (one tool call per block):',
    '',
    '```tool_call',
    '{"name": "<tool-name>", "arguments": { ... }}',
    '```',
    '',
    'Results come back as ```tool_result fences in the next message — wait for',
    'them; never invent one.',
    '',
    '## Available tools',
    '',
  ];
  for (const t of tools) {
    const params = Object.entries(t.schema)
      .map(([k, v]) => `${k}: ${describeZod(v)}`)
      .join(', ');
    lines.push(`- **${t.name}**(${params}) — ${t.description}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Best-effort human-readable type for a zod schema field. */
function describeZod(schema: z.ZodType<any>): string {
  const desc = (schema as { description?: string }).description;
  let kind = 'value';
  if (schema instanceof z.ZodString) kind = 'string';
  else if (schema instanceof z.ZodNumber) kind = 'number';
  else if (schema instanceof z.ZodBoolean) kind = 'boolean';
  else if (schema instanceof z.ZodArray) kind = 'array';
  else if (schema instanceof z.ZodObject) kind = 'object';
  else if (schema instanceof z.ZodEnum) kind = (schema.options as string[]).join('|');
  else if (schema instanceof z.ZodOptional) return `optional ${describeZod(schema.unwrap() as z.ZodType<any>)}`;
  else if (schema instanceof z.ZodNullable) return `nullable ${describeZod(schema.unwrap() as z.ZodType<any>)}`;
  else if (schema instanceof z.ZodDefault) return `optional ${describeZod(schema._def.innerType as z.ZodType<any>)}`;
  return desc ? `${kind} — ${desc}` : kind;
}

/** Extract tool_call fences from raw assistant texts. Invalid JSON or a
 *  missing name is skipped (reported back as an error result is impossible
 *  without a name — so it's silently ignored, matching lenient parsing). */
export function parseToolCalls(rawTexts: string[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const text of rawTexts) {
    TOOL_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOOL_CALL_RE.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim()) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name !== 'string' || !parsed.name) continue;
        calls.push({
          name: parsed.name,
          arguments: (parsed.arguments && typeof parsed.arguments === 'object')
            ? parsed.arguments as Record<string, unknown>
            : {},
        });
      } catch { /* malformed fence — ignore */ }
    }
  }
  return calls;
}

/** Execute one tool call against the OrgToolDef handlers, validating args
 *  against the tool's zod shape. Handler errors come back as text so the
 *  model sees the failure instead of the turn dying. */
export async function executeToolCall(tools: OrgToolDef[], call: ToolCall): Promise<string> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `ERROR: unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(', ')}`;
  const parsed = z.object(tool.schema).safeParse(call.arguments);
  if (!parsed.success) {
    return `ERROR: invalid arguments for ${call.name}: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`;
  }
  try {
    const r = await tool.handler(parsed.data as Record<string, unknown>);
    return r.text;
  } catch (err) {
    return `ERROR: ${call.name} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Format executed results as the next prompt's tool_result fences. */
export function formatToolResults(calls: ToolCall[], results: string[]): string {
  return 'Tool results:\n' + results.map((r, i) =>
    '```tool_result\n' + JSON.stringify({ name: calls[i].name, result: r }) + '\n```'
  ).join('\n');
}
