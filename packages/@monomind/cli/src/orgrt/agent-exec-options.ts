// packages/@monomind/cli/src/orgrt/agent-exec-options.ts
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { ExecErrorCode } from './agent-exec-errors.js';
import type { AgentRunner } from './agent-runner.js';
import type { OrgEffortLevel } from './cost-tier.js';

// ─── options & events ───────────────────────────────────────────────────────

/** Tool definition from `--tools-file` (JSON Schema) or `--tool-names`. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema `{type:'object', properties, required}` (optional for --tool-names). */
  schema?: Record<string, unknown>;
}

export interface AgentExecOptions {
  runtime: string;
  prompt: string;
  /** rev 31 (`--attach`): absolute paths of files sent with the prompt,
   *  already validated (agent-exec-attach.ts). Unset/[] = the prompt alone. */
  attachments?: string[];
  /** #355. `scoped` (default) = today's allow-list behavior, byte-identical
   *  SDK options. `full` = unrestricted native tool access (any runtime
   *  whose RunnerSpec.supportsFullAccess is true; guarded — see
   *  agent-exec-access.ts). `read` (#388) = read files, search, web and
   *  read-only shell only (agent-exec-read.ts; runtimes with readAccess). */
  access?: 'scoped' | 'read' | 'full';
  /** #396 (rev 23): `--sandbox` — the vendor CLI's own sandbox mode
   *  (runner-sandbox.ts). undefined = today's default, argv unchanged. */
  sandbox?: 'read-only' | 'restricted' | 'workspace-write' | 'full';
  /** #482 (rev 26): `--sandbox-fallback` — what an unsupported `sandbox`
   *  does: `fail` (default, today's error), `strictest` or `run`. */
  sandboxFallback?: 'fail' | 'strictest' | 'run';
  systemPrompt?: string;
  model?: string;
  /** `--effort`: reasoning effort, mapped per runtime (AgentRunArgs.effort). */
  effort?: OrgEffortLevel;
  cwd?: string;
  resume?: string;
  maxTurns: number;
  /** Overall wall-clock cap (ms); undefined = none. */
  timeoutMs?: number;
  /** Max wait per caller tool_result frame (ms). */
  toolTimeoutMs: number;
  /** Optional spend cap (USD) checked at result granularity (see §3.1 note). */
  budgetUsd?: number;
  env?: Record<string, string>;
  /** null/[] = no caller-side tools. Non-empty enables the stdio bridge. */
  toolSpecs?: ToolSpec[] | null;
  /** `--tools stdio`: read caller frames (`cancel`) on stdin even when no
   *  tools are declared. */
  stdioFrames?: boolean;
  /** Injectable runner for tests; production resolves via resolveExecRunner. */
  runnerOverride?: AgentRunner;
  /** Event sink — the command layer writes each object as one NDJSON line. */
  emit: (ev: Record<string, unknown>) => void;
  /** Frame source for the tool bridge (default: process.stdin at command layer). */
  stdin?: Readable;
  /** Grace window for stream.return() propagation before resolving (ms). */
  returnGraceMs?: number;
  /**
   * Command prefixes (e.g. "monomind", "monoagentcli") the SDK's own Bash
   * tool is allowed to run, on top of whatever toolSpecs were given. Real
   * shell access is far more reliable for the model to actually use than a
   * large custom MCP tool surface (observed directly: with only ~44
   * mcp__org__* tools, the model frequently refused and fabricated an
   * excuse rather than call one; the same requests reliably succeed via a
   * plain `monomind ...`/`monoagentcli ...` Bash invocation). Still fully
   * scoped, not a blanket Bash grant: canUseTool below only allows a Bash
   * call whose command starts with one of these prefixes (after trimming
   * leading whitespace) — everything else is denied exactly as before.
   * undefined/[] = no Bash allowance, matching prior behavior exactly.
   */
  allowBashPrefixes?: string[];
  /** Coder mode (#356): parsed `--settings` value. `undefined`/`[]` = `none`
   *  (today's default, byte-identical). Forwarded to AgentRunArgs.settingSources
   *  — only ClaudeAgentRunner acts on it. */
  settings?: Array<'user' | 'project' | 'local'>;
  /** Coder mode (#356): startup watchdog timeout (ms) for `--settings`
   *  non-none turns — see agent-exec-settings.ts's createExecStatusHandler. */
  startupTimeoutMs?: number;
}

export interface Terminal {
  code: ExecErrorCode;
  exitCode: number;
}

// ─── JSON Schema → zod shape (for OrgToolDef.schema) ────────────────────────

function jsonPropToZod(prop: unknown, required: boolean): z.ZodType<any> {
  let base: z.ZodType<any> = z.any();
  if (prop && typeof prop === 'object') {
    const p = prop as Record<string, unknown>;
    if (Array.isArray(p.enum)) base = z.enum(p.enum as [string, ...string[]]);
    else
      switch (p.type) {
        case 'string':
          base = z.string();
          break;
        case 'number':
        case 'integer':
          base = z.number();
          break;
        case 'boolean':
          base = z.boolean();
          break;
        case 'array':
          base = z.array(z.any());
          break;
        case 'object':
          base = z.record(z.string(), z.any());
          break;
      }
  }
  return required ? base : base.optional();
}

/** Convert `{type:'object', properties, required}` JSON Schema to a zod shape. */
export function jsonSchemaToZodShape(
  schema?: Record<string, unknown>,
): Record<string, z.ZodType<any>> {
  const shape: Record<string, z.ZodType<any>> = {};
  const props = (schema?.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as unknown[]) : []);
  for (const [key, prop] of Object.entries(props)) {
    shape[key] = jsonPropToZod(prop, required.has(key));
  }
  return shape;
}
