// packages/@monomind/cli/src/commands/agent-exec.ts
/**
 * `monomind agent exec|scan|test` — the Agent Exec Protocol CLI surface
 * (doc/agent-exec-protocol.md). These join the existing `agent` swarm
 * namespace (commands/agent.ts); `agent list` stays with swarm lifecycle —
 * the installed-only runner view is `agent scan --installed`.
 *
 * stdout purity (§3): `exec` and `test` write protocol NDJSON to stdout and
 * nothing else; all diagnostics go to stderr. `scan` emits JSON on stdout
 * with `--json` (or the global `--format json`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAgentExec, type ToolSpec } from '../orgrt/agent-exec.js';
import { parseSettingsFlag } from '../orgrt/agent-exec-settings.js';
import { ORG_EFFORT_LEVELS, type OrgEffortLevel } from '../orgrt/cost-tier.js';
import { reportClaudeSkip } from '../orgrt/claude-sdk.js';
import { scanInstalled } from '../orgrt/runner-registry.js';
import { SANDBOX_FALLBACKS, SANDBOX_MODES, type SandboxMode } from '../orgrt/runner-sandbox.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const errOut = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

/** Parse a duration flag: plain number = seconds; `45s`/`10m`/`2h` suffixes. */
export function parseDuration(raw: unknown, flag: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim();
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(s);
  if (!m) throw new Error(`invalid --${flag} duration: "${s}" (use e.g. 45s, 10m, 2h)`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ms':
      return Math.round(n);
    case 'm':
      return Math.round(n * 60_000);
    case 'h':
      return Math.round(n * 3_600_000);
    default:
      return Math.round(n * 1000);
  }
}

/** Parse --allow-bash-prefix "a,b,c" into a trimmed, non-empty string array. */
export function parseBashPrefixesFlag(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const list = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

/** Parse repeatable --env KEY=V into a record. */
export function parseEnvFlags(raw: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  const list = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  for (const item of list) {
    const s = String(item);
    const eq = s.indexOf('=');
    if (eq <= 0) throw new Error(`invalid --env entry: "${s}" (expected KEY=V)`);
    env[s.slice(0, eq)] = s.slice(eq + 1);
  }
  return env;
}

/**
 * Usage error for a `--sandbox` value (#396), or undefined when it is valid.
 * Per-runtime support is checked later, in the engine (`unsupported`).
 */
export function sandboxFlagError(raw: unknown, access: string): string | undefined {
  if (raw === undefined) return undefined;
  if (!(SANDBOX_MODES as readonly unknown[]).includes(raw)) {
    return `--sandbox must be one of ${SANDBOX_MODES.join(', ')} (got "${String(raw)}")`;
  }
  if (access === 'read' && raw === 'full') {
    return '--access read cannot be combined with --sandbox full';
  }
  return undefined;
}

/** Usage error for a `--sandbox-fallback` value (#482; ignored without `--sandbox`). */
export function sandboxFallbackFlagError(raw: unknown): string | undefined {
  if (raw === undefined || (SANDBOX_FALLBACKS as readonly unknown[]).includes(raw))
    return undefined;
  return `--sandbox-fallback must be one of ${SANDBOX_FALLBACKS.join(', ')} (got "${String(raw)}")`;
}

/** Load tool specs from --tools-file JSON: [{name, description, schema}]. */
function loadToolSpecs(file: string | undefined): ToolSpec[] {
  if (!file) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch (e) {
    throw new Error(`--tools-file unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed))
    throw new Error('--tools-file must be a JSON array of tool definitions');
  return parsed.map((t, i) => {
    const tool = t as Record<string, unknown>;
    if (typeof tool.name !== 'string' || !tool.name) {
      throw new Error(`--tools-file entry ${i}: "name" (string) is required`);
    }
    if (typeof tool.description !== 'string') {
      throw new Error(
        `--tools-file entry ${i} ("${tool.name}"): "description" (string) is required`,
      );
    }
    if (tool.schema !== undefined && (typeof tool.schema !== 'object' || tool.schema === null)) {
      throw new Error(
        `--tools-file entry ${i} ("${tool.name}"): "schema" must be a JSON Schema object`,
      );
    }
    return {
      name: tool.name,
      description: tool.description,
      schema: tool.schema as Record<string, unknown> | undefined,
    };
  });
}

/** Tool specs from --tool-names csv (§4.2 caller-described, schema-less). */
function toolNamesSpecs(raw: unknown): ToolSpec[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      description: 'Caller-provided tool (described in the system prompt).',
    }));
}

/** Exported for unit tests (returns the exit code; no process.exit here — see execCommand.action). */
export async function runExec(
  ctx: CommandContext,
  overrides: Partial<Parameters<typeof runAgentExec>[0]>,
): Promise<number> {
  const runtime = String(ctx.flags.runtime ?? '');
  const promptFlag = ctx.flags.prompt as string | undefined;
  const promptFile = ctx.flags['prompt-file'] as string | undefined;

  const diagnostics: string[] = [];
  const usageError = (msg: string): number => {
    errOut(output.error(`agent exec: ${msg}`));
    return 2;
  };

  if (!runtime) return usageError('--runtime is required');
  if (overrides.prompt === undefined) {
    if (Boolean(promptFlag) === Boolean(promptFile)) {
      return usageError('exactly one of --prompt or --prompt-file is required');
    }
  }
  const protocol = ctx.flags.protocol;
  if (protocol !== undefined && String(protocol) !== '1') {
    return usageError(`--protocol ${protocol} unsupported (this build implements v1)`);
  }

  // #355: --access full is a usage-error flag combo, checked before the
  // engine runs (root/runtime/--cwd guards live inside it — see
  // agent-exec-access.ts's "not only the caller" doc comment). `read`
  // (#388) is checked per runtime inside the engine too.
  const access = String(ctx.flags.access ?? 'scoped');
  if (access !== 'scoped' && access !== 'read' && access !== 'full') {
    return usageError(`--access must be "scoped", "read" or "full" (got "${access}")`);
  }
  if (access === 'full' && ctx.flags['allow-bash-prefix']) {
    return usageError('--access full cannot be combined with --allow-bash-prefix');
  }

  // #396 (rev 23): the vendor CLI's own sandbox; per-runtime support is
  // checked in the engine (`unsupported`). `read` always runs read-only, so
  // asking for `full` with it is a contradiction.
  const sandboxFlag = ctx.flags.sandbox;
  const sandboxFallback = ctx.flags['sandbox-fallback'];
  const sandboxError =
    sandboxFlagError(sandboxFlag, access) ?? sandboxFallbackFlagError(sandboxFallback);
  if (sandboxError) return usageError(sandboxError);

  let toolSpecs: ToolSpec[] = [];
  const toolsMode = String(ctx.flags.tools ?? 'none');
  if (toolsMode !== 'none' && toolsMode !== 'stdio') {
    return usageError(`--tools must be "stdio" or "none" (got "${toolsMode}")`);
  }
  if (toolsMode === 'stdio') {
    const toolsFile = ctx.flags['tools-file'] as string | undefined;
    const toolNames = ctx.flags['tool-names'];
    if (toolsFile && toolNames) {
      return usageError('--tools-file and --tool-names are mutually exclusive');
    }
    toolSpecs = toolsFile ? loadToolSpecs(toolsFile) : toolNamesSpecs(toolNames);
    if (toolsFile && toolSpecs.length === 0)
      diagnostics.push('--tools-file contained no tool definitions');
  } else if (ctx.flags['tools-file'] || ctx.flags['tool-names']) {
    return usageError('--tools-file/--tool-names require --tools stdio');
  }

  // rev 16 (+ rev 19 notice): --effort, validated here; the runner maps or ignores it.
  const effortFlag = ctx.flags.effort;
  if (effortFlag !== undefined && !(ORG_EFFORT_LEVELS as readonly unknown[]).includes(effortFlag)) {
    return usageError(
      `--effort must be one of ${ORG_EFFORT_LEVELS.join(', ')} (got "${effortFlag}")`,
    );
  }

  // Coder mode (#356): none (default) = today's isolated behavior.
  const parsedSettings = parseSettingsFlag(ctx.flags.settings);
  if ('error' in parsedSettings) return usageError(parsedSettings.error);

  let systemPrompt: string | undefined;
  const systemFile = ctx.flags['system-file'] as string | undefined;
  if (systemFile) {
    try {
      systemPrompt = readFileSync(resolve(systemFile), 'utf8');
    } catch (e) {
      return usageError(`--system-file unreadable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let timeoutMs: number | undefined;
  let toolTimeoutMs = 120_000;
  let startupTimeoutMs = 30_000;
  try {
    timeoutMs = overrides.timeoutMs ?? parseDuration(ctx.flags.timeout, 'timeout');
    toolTimeoutMs = parseDuration(ctx.flags['tool-timeout'], 'tool-timeout') ?? 120_000;
    startupTimeoutMs = parseDuration(ctx.flags['startup-timeout'], 'startup-timeout') ?? 30_000;
  } catch (e) {
    return usageError(e instanceof Error ? e.message : String(e));
  }

  let env: Record<string, string> = {};
  try {
    env = parseEnvFlags(ctx.flags.env);
  } catch (e) {
    return usageError(e instanceof Error ? e.message : String(e));
  }

  const prompt =
    overrides.prompt ??
    (promptFile ? readFileSync(resolve(promptFile), 'utf8') : (promptFlag as string));

  for (const d of diagnostics) errOut(output.warning(d));

  const exitCode = await runAgentExec({
    runtime,
    access: access as 'scoped' | 'read' | 'full',
    ...(sandboxFlag !== undefined ? { sandbox: sandboxFlag as SandboxMode } : {}),
    sandboxFallback: sandboxFallback as (typeof SANDBOX_FALLBACKS)[number] | undefined, // #482
    prompt,
    systemPrompt,
    model: ctx.flags.model ? String(ctx.flags.model) : undefined,
    effort: effortFlag as OrgEffortLevel | undefined,
    cwd: ctx.flags.cwd ? resolve(String(ctx.flags.cwd)) : undefined,
    resume: ctx.flags.resume ? String(ctx.flags.resume) : undefined,
    maxTurns: Number(ctx.flags['max-turns'] ?? 25) || 25,
    timeoutMs,
    toolTimeoutMs,
    budgetUsd: ctx.flags['budget-usd'] !== undefined ? Number(ctx.flags['budget-usd']) : undefined,
    env,
    toolSpecs: toolSpecs.length ? toolSpecs : null,
    stdioFrames: toolsMode === 'stdio',
    allowBashPrefixes: parseBashPrefixesFlag(ctx.flags['allow-bash-prefix']),
    settings: parsedSettings.sources,
    startupTimeoutMs,
    emit: (ev) => {
      process.stdout.write(`${JSON.stringify(ev)}\n`);
    },
    ...overrides,
  });

  return exitCode;
}

/** Flush queued stdout writes (pipes are async) before an explicit exit. */
function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write('', () => resolve());
  });
}

// ─── exec ────────────────────────────────────────────────────────────────────

export const execCommand: Command = {
  name: 'exec',
  description: 'Run one agent turn via a local runner (Agent Exec Protocol — NDJSON on stdout)',
  options: [
    {
      name: 'runtime',
      short: 'r',
      description: 'Runner id (claude, codex, kimicode, qwen, …)',
      type: 'string',
    },
    { name: 'prompt', short: 'p', description: 'Prompt text', type: 'string' },
    { name: 'prompt-file', description: 'Read the prompt from a file', type: 'string' },
    { name: 'system-file', description: 'System prompt file', type: 'string' },
    {
      name: 'tools',
      description: 'Tool mode: stdio (caller executes) or none',
      type: 'string',
      choices: ['stdio', 'none'],
    },
    {
      name: 'tools-file',
      description: 'Tool definitions JSON [{name, description, schema}] (requires --tools stdio)',
      type: 'string',
    },
    {
      name: 'tool-names',
      description: 'CSV of tool names for caller-described tools (requires --tools stdio)',
      type: 'string',
    },
    {
      name: 'tool-timeout',
      description: 'Max wait per caller tool_result frame (default 120s)',
      type: 'string',
    },
    { name: 'model', short: 'm', description: 'Model override', type: 'string' },
    {
      name: 'effort',
      description:
        'Reasoning effort: off|low|medium|high|xhigh|max (mapped per runtime — see agent scan --json effort; ignored with a notice where unsupported)',
      type: 'string',
      choices: [...ORG_EFFORT_LEVELS],
    },
    { name: 'cwd', description: 'Working dir for the agent (default: cwd)', type: 'string' },
    { name: 'resume', description: 'Session/thread id to resume', type: 'string' },
    { name: 'max-turns', description: 'Cap agent turns (default 25)', type: 'number' },
    {
      name: 'timeout',
      description: 'Overall wall-clock timeout, e.g. 10m (exit 124 on expiry)',
      type: 'string',
    },
    {
      name: 'budget-usd',
      description: 'Spend cap for this turn (error code "budget" on breach)',
      type: 'number',
    },
    {
      name: 'env',
      description: 'Extra env for the agent process, KEY=V (repeatable)',
      type: 'array',
    },
    {
      name: 'allow-bash-prefix',
      description:
        'CSV of command prefixes (e.g. "monomind,monoagentcli") the Bash tool may run, on top of --tools-file — scoped, not a blanket Bash grant. With --access read, added to the read-only list. Incompatible with --access full',
      type: 'string',
    },
    {
      name: 'access',
      description:
        'scoped (default, allow-list only), read — read files, search, web and read-only git, no edits or general shell (runtimes listing "read" in agent scan access_modes), or full — unrestricted native tool access (runtimes with full_access in agent scan; requires --cwd, refuses root)',
      type: 'string',
      choices: ['scoped', 'read', 'full'],
    },
    {
      name: 'sandbox',
      description:
        "The vendor CLI's own sandbox: read-only, restricted (the CLI's approval rules, asks refused), workspace-write or full (today's default). Only modes listed in agent scan --json sandbox_modes (see --sandbox-fallback); never loosens an org role's git level; --access read always runs read-only",
      type: 'string',
      choices: [...SANDBOX_MODES],
    },
    {
      name: 'sandbox-fallback',
      description:
        'When the runtime lacks the --sandbox mode: fail (default, error "unsupported"), strictest (the closest supported mode that is at least as strict, else the strictest there is) or run (the runtime default); strictest/run emit a status notice and report sandbox_applied',
      type: 'string',
      choices: [...SANDBOX_FALLBACKS],
    },
    { name: 'protocol', description: 'Protocol version pin (1)', type: 'string' },
    {
      name: 'settings',
      description:
        'Coder mode: "none" (default) or a CSV of user,project,local — claude loads CLAUDE.md, skills, hooks, and project+user MCP servers; other runtimes stop isolating their own CLI config',
      type: 'string',
    },
    {
      name: 'startup-timeout',
      description: 'Max wait for claude to report ready when --settings is non-none (default 30s)',
      type: 'string',
    },
  ],
  examples: [
    {
      command: 'monomind agent exec --runtime codex --prompt "summarize ./README"',
      description: 'One codex turn, NDJSON events on stdout',
    },
    {
      command:
        'monomind agent exec --runtime claude --tools stdio --tools-file tools.json --prompt-file task.md',
      description: 'Claude turn with caller-side tools over stdio frames',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const code = await runExec(ctx, {});
    await flushStdout();
    // Always exit explicitly: a runner's internal timers (turn ladders,
    // startup grace) can keep the event loop alive after the turn is done.
    process.exit(code);
  },
};

// ─── scan ────────────────────────────────────────────────────────────────────

export const scanCommand: Command = {
  name: 'scan',
  description: 'Detect locally installed agent runtimes (exit 0 always)',
  options: [
    {
      name: 'json',
      description: 'Emit the protocol JSON shape (see agent-exec-protocol.md §6)',
      type: 'boolean',
    },
    { name: 'installed', description: 'Only list installed runtimes', type: 'boolean' },
    {
      name: 'probe',
      description:
        'Run --version (in a scratch HOME) for runtimes whose version is not in their install files; some download or write state',
      type: 'boolean',
    },
  ],
  examples: [
    { command: 'monomind agent scan --json', description: 'Full detection report as JSON' },
    {
      command: 'monomind agent scan --probe --json',
      description: 'Also run --version for runtimes not known to be side-effect free',
    },
    { command: 'monomind agent scan --installed --json', description: 'Installed-only view' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const result = await scanInstalled({ probe: Boolean(ctx.flags.probe) });
    const agents = ctx.flags.installed ? result.agents.filter((a) => a.installed) : result.agents;
    const payload = { v: 1, agents };

    if (ctx.flags.json || ctx.flags.format === 'json') {
      output.printJson(payload);
      return { success: true, data: payload };
    }

    output.writeln();
    const claude = agents.find((a) => a.id === 'claude')?.claude_code;
    if (claude) reportClaudeSkip(claude);
    output.writeln(output.bold('Agent Runtimes'));
    output.writeln();
    output.printTable({
      columns: [
        { key: 'id', header: 'Runtime', width: 14 },
        { key: 'installed', header: 'Installed', width: 10 },
        { key: 'version', header: 'Version', width: 24 },
        { key: 'binary', header: 'Binary', width: 40 },
      ],
      data: agents.map((a) => ({
        id: a.id,
        installed: a.installed ? output.success('yes') : output.dim('no'),
        version: a.version ?? '—',
        binary: a.binary ?? '—',
      })),
    });
    output.writeln();
    for (const a of agents.filter((x) => !x.installed)) {
      output.writeln(output.dim(`  ${a.id}: ${a.install_hint}`));
    }
    return { success: true, data: payload };
  },
};

// ─── test ────────────────────────────────────────────────────────────────────

export const testCommand: Command = {
  name: 'test',
  description: 'Smoke-test a runtime with one tiny turn (also verifies auth)',
  options: [{ name: 'timeout', description: 'Overall timeout (default 90s)', type: 'string' }],
  examples: [
    {
      command: 'monomind agent test codex',
      description: 'One smoke turn through the codex runner',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const runtime = ctx.args[0];
    if (!runtime) {
      output.printError('runtime id required: monomind agent test <id> (see agent scan)');
      return { success: false, exitCode: 2 };
    }
    ctx.flags.runtime = runtime;
    ctx.flags['max-turns'] = 3;
    const code = await runExec(ctx, {
      prompt: 'Reply with the single word: ok',
      timeoutMs: parseDuration(ctx.flags.timeout, 'timeout') ?? 90_000,
    });
    await flushStdout();
    process.exit(code);
  },
};
