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

/** Return the prefix of `s` ending at the first balanced JSON object/array,
 *  respecting string literals. Falls back to `s` unchanged when no balanced
 *  prefix exists (JSON.parse then reports the original error). */
function firstBalancedJson(s: string): string {
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
      if (depth < 0) return s;
    }
  }
  return s;
}

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
 *
 * IMPORTANT wording note: the tools listed here are ORG tools (org_send,
 * org_recall, …) that exist ONLY through this protocol — the model cannot
 * reach them natively. But the agent also has NATIVE file/shell tools
 * (Write, Edit, Bash, …) for doing its actual work. Saying "you have no
 * native tools" makes the model believe it cannot even write files — the
 * protocol must name the distinction explicitly.
 */
export function buildToolProtocol(tools: OrgToolDef[]): string {
  if (!tools || tools.length === 0) return '';
  const lines = [
    '',
    '',
    '# Org Tool Protocol (MANDATORY)',
    '',
    'The org tools listed below are NOT native tools — call each one by',
    'emitting a fenced block EXACTLY like this (one call per block):',
    '',
    '```tool_call',
    '{"name": "<tool-name>", "arguments": { ... }}',
    '```',
    '',
    'Results come back as ```tool_result fences in the next message — wait for',
    'them; never invent one. Your native file/shell tools (Write, Edit, Bash,',
    'Read, Glob, Grep) are used normally for the actual work.',
    '',
    '## Org tools (fence protocol only)',
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
  else if (schema instanceof z.ZodOptional)
    return `optional ${describeZod(schema.unwrap() as z.ZodType<any>)}`;
  else if (schema instanceof z.ZodNullable)
    return `nullable ${describeZod(schema.unwrap() as z.ZodType<any>)}`;
  else if (schema instanceof z.ZodDefault)
    return `optional ${describeZod(schema._def.innerType as z.ZodType<any>)}`;
  return desc ? `${kind} — ${desc}` : kind;
}

/** Extract tool_call fences from raw assistant texts. A fence whose JSON
 *  cannot be parsed at all is skipped — but NOT silently: `onMalformed` (when
 *  given) is invoked with the raw fence body and the parse error so callers
 *  can surface it (runners emit it as an assistant note, which session.ts
 *  routes to the org bus and scrollback). A parsed object without a string
 *  `name` is skipped quietly — there is nothing actionable to report. */
export function parseToolCalls(
  rawTexts: string[],
  onMalformed?: (raw: string, error: string) => void,
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const text of rawTexts) {
    TOOL_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastMatchEnd = 0;
    while ((m = TOOL_CALL_RE.exec(text)) !== null) {
      lastMatchEnd = TOOL_CALL_RE.lastIndex;
      try {
        // Models sometimes append extra closing braces after the JSON object
        // (observed with kimi k3: `...}}}`); parse only the first balanced
        // object instead of rejecting the whole fence.
        const parsed = JSON.parse(firstBalancedJson(m[1].trim())) as {
          name?: unknown;
          arguments?: unknown;
        };
        if (typeof parsed.name !== 'string' || !parsed.name) continue;
        calls.push({
          name: parsed.name,
          arguments:
            parsed.arguments && typeof parsed.arguments === 'object'
              ? (parsed.arguments as Record<string, unknown>)
              : {},
        });
      } catch (err) {
        onMalformed?.(m[1].trim(), err instanceof Error ? err.message : String(err));
      }
    }
    // A ```tool_call opener with no closing ``` anywhere after it (the model
    // hit its per-response output limit mid-argument) never matches
    // TOOL_CALL_RE at all — the regex requires both fences. Left undetected,
    // the tool silently never executes and the model believes it did. Flag
    // any opener that starts at or after the last successful match's end as
    // truncated, distinctly from a parse failure, so the model can retry
    // with shorter arguments instead of moving on unaware.
    const OPENER = '```tool_call';
    const openerIdx = text.lastIndexOf(OPENER);
    if (openerIdx !== -1 && openerIdx >= lastMatchEnd) {
      const body = text.slice(openerIdx + OPENER.length).replace(/^[ \t]*\n/, '');
      onMalformed?.(
        body.trim(),
        'tool_call fence was truncated (no closing ``` found) — re-issue with shorter arguments',
      );
    }
  }
  return calls;
}

/** Execute one tool call against the OrgToolDef handlers, validating args
 *  against the tool's zod shape. Handler errors come back as text so the
 *  model sees the failure instead of the turn dying.
 *
 *  When `canUseTool` is provided (passed by fence-protocol runners like
 *  CodexAgentRunner that can't use the SDK's native permission gate), it is
 *  invoked AFTER zod validation but BEFORE the handler — a deny decision
 *  short-circuits with a policy-error message instead of executing. */
export async function executeToolCall(
  tools: OrgToolDef[],
  call: ToolCall,
  canUseTool?: (toolName: string, input: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool)
    return `ERROR: unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(', ')}`;
  const parsed = z.object(tool.schema).safeParse(call.arguments);
  if (!parsed.success) {
    return `ERROR: invalid arguments for ${call.name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
  }
  if (canUseTool) {
    const decision = await canUseTool(call.name, parsed.data as Record<string, unknown>);
    if (decision && typeof decision === 'object' && 'behavior' in decision) {
      if ((decision as { behavior: string }).behavior === 'deny') {
        return `ERROR: ${call.name} denied by policy: ${(decision as { message?: string }).message ?? 'denied'}`;
      }
    } else if (decision === false) {
      return `ERROR: ${call.name} denied by policy`;
    }
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
  return (
    'Tool results:\n' +
    results
      .map(
        (r, i) =>
          `\`\`\`tool_result\n${JSON.stringify({ name: calls[i].name, result: r })}\n\`\`\``,
      )
      .join('\n')
  );
}
