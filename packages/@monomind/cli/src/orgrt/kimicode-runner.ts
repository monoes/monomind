// packages/@monomind/cli/src/orgrt/kimicode-runner.ts
/**
 * KimiCodeAgentRunner — AgentRunner impl backed by the Kimi Code CLI.
 *
 * Architectural difference from ClaudeAgentRunner:
 *   - Claude's `query()` runs the whole agent loop IN-PROCESS (tools execute
 *     inside the same Node process as the daemon). That's why ClaudeAgentRunner
 *     can register org tools (org_send, ask_human, …) directly via
 *     createSdkMcpServer.
 *   - Kimi Code has no embeddable SDK. The CLI is driven as a subprocess:
 *     `kimi -p "<prompt>" --output-format stream-json` runs one non-interactive
 *     turn and emits JSONL events on stdout (verified against kimi 0.29.2:
 *     {"role":"assistant","content":...} per reply, then a
 *     {"role":"meta","type":"session.resume_hint",session_id} event).
 *     Session continuity comes from `--session <id>` on later turns.
 *     ARG ORDER MATTERS: the prompt must immediately follow `-p` — flags in
 *     between are consumed as the prompt text.
 *
 * Streaming / liveness — WHY INCREMENTAL:
 *   Kimi turns routinely run 10-20+ minutes when the model chains many
 *   internal tool calls (observed: 45+ steps in one turn). session.ts races
 *   the FIRST pull from this runner against a 4-minute silent-stream
 *   watchdog, so buffering stdout until process exit (the original design)
 *   meant any turn longer than 4 minutes yielded zero messages in time —
 *   abort, retry, kill, circuit breaker, stalled org. This runner therefore
 *   parses stdout LINE BY LINE as data arrives: a liveness `tool_use`
 *   message is yielded the moment the subprocess spawns (deterministically
 *   winning the first-pull race regardless of model-thinking latency),
 *   assistant text is yielded as each event lands, and kimi's own
 *   {"role":"tool",...} progress events are forwarded as `tool_use`
 *   liveness messages so the StateDetector/idle watchdog see a working
 *   agent throughout the turn. Tool_call fences are still collected from
 *   the raw texts and parsed at end of turn (fence parsing needs the
 *   complete text).
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   kimi's tool surface can only be extended via MCP servers or plugins, both
 *   loaded by the CLI itself, not by an external caller per-turn. Instead the
 *   tools are rendered INTO the role's system prompt: the model emits
 *   ```tool_call fenced JSON blocks, this runner parses them out of the
 *   assistant text, executes the real OrgToolDef handlers in-process (the same
 *   handlers ClaudeAgentRunner registers with the SDK), and feeds the results
 *   back as the next prompt IN THE SAME kimi session. Loop repeats until a
 *   turn produces no tool calls (cap: MAX_TOOL_ROUNDS). Tool-call fences are
 *   stripped from the text yielded to session.ts so the bus only sees prose.
 *
 * Usage accounting — WIRE FILE:
 *   kimi's stream-json has no usage/result event, but every session writes
 *   usage.record entries to $KIMI_CODE_HOME/sessions/<wd>/<session_id>/
 *   agents/main/wire.jsonl. After each CLI turn this runner reads the new
 *   entries written since each round started (timestamp-filtered, so a
 *   resumed session's historical entries are never double-counted) and
 *   attaches the summed tokens to the synthesized result message session.ts
 *   needs for budget checks.
 *
 * Non-disturbance guarantees (mirrors the opencode integration):
 *   - No new package dependency: the runner shells out to the `kimi` binary
 *     via node:child_process; nothing is imported at module load time.
 *   - The runner is only constructed when MONOMIND_RUNTIME=kimicode is set
 *     (daemon.ts runner resolution). Without the env var, or without a `kimi`
 *     binary on PATH, the Claude path is byte-for-byte unchanged and run()
 *     rejects with a clear actionable error instead of crashing at import.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';

/** How long a single `kimi -p` invocation may run before we kill it (2 hours,
 *  matching kimi's own subagent default). */
const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

interface TurnOutcome {
  sessionId?: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
}

export class KimiCodeAgentRunner implements AgentRunner {
  private emptySkillsDir = '';

  constructor(private kimiBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.kimiBin || process.env.KIMI_CLI_BIN || 'kimi';

    // The system prompt reaches kimi as an agent file (--agent-file binds the
    // agent at session creation; resume restores it, so later turns only need
    // --session). Written to a per-run temp dir and cleaned up in finally.
    //
    // The `tools:` allowlist is load-bearing TWICE over:
    //   1. Token cost: kimi injects the schemas of every tool the agent may
    //      see into each request — measured 73KB/turn for the full built-in
    //      surface (Agent, Skill, Cron, WebSearch, …) that org roles never
    //      use. This list cuts it to the handful an org role actually needs.
    //   2. Policy: on the subprocess backends the daemon cannot intercept
    //      native tool calls (canUseTool only gates Claude's in-process
    //      tools), so this allowlist IS the tool gate for kimi org roles.
    //      Keep it minimal — org-specific denials belong here, not prose.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-'));
    const agentFile = path.join(tmpDir, 'org-role.md');
    // kimi rejects an agent file whose body (everything after the frontmatter)
    // is empty with "Missing prompt body". `args.systemPrompt` is legitimately
    // '' for bare `agent exec` calls with no --system-file (agent.ask, `chat`
    // without --canvas, `agent test`), and buildToolProtocol() is also '' with
    // no tools — so the two together can leave nothing after the frontmatter.
    // Fall back to a minimal default so the file body is never empty.
    const body =
      (args.systemPrompt || 'You are a helpful assistant.') + buildToolProtocol(args.tools);
    fs.writeFileSync(
      agentFile,
      `---\nname: monomind-org-role\ndescription: Monomind org role (managed by monomind orgrt)\n` +
        `tools: [Bash, Read, Write, Edit, Glob, Grep]\n---\n\n` +
        body,
    );

    // Empty skills dir: kimi loads every user/project skill's description
    // into the system prompt on launch (measured: 47 skills ≈ several KB per
    // turn). Org roles get their instructions from the role prompt — user
    // skills are pure overhead and a source of instruction drift.
    this.emptySkillsDir = path.join(tmpDir, 'no-skills');
    fs.mkdirSync(this.emptySkillsDir, { recursive: true });

    let sessionId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        // Tool-call loop: keep driving the same kimi session until a turn
        // produces no tool_call fences (or the round cap hits).
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const roundStart = Date.now();
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = { exitCode: 1, stderrTail: '', timedOut: false };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of this.streamTurn(
            bin,
            nextPrompt,
            sessionId,
            args,
            agentFile,
            outcome,
          )) {
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (not after process exit):
              // a kimi turn can run 10-20+ minutes, and session.ts's watchdog
              // must see messages DURING the turn. Note this means partial
              // output may already be yielded when a turn later exits
              // non-zero — preferable to losing it entirely.
              if (ev.text) yield { type: 'assistant', session_id: sessionId, text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness for kimi's own tool activity: session.ts never
              // renders tool_use as chat — it only feeds the StateDetector
              // ('tool-call' state) and refreshes last-activity.
              yield { type: 'tool_use', session_id: sessionId, text: ev.toolName };
            }
          }
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (outcome.exitCode !== 0) {
            throw turnError(outcome, round, bin);
          }

          const usage = this.readUsageDelta(sessionId, args.env, roundStart);
          turnInputTokens += usage.input;
          turnOutputTokens += usage.output;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) {
            yield { type: 'assistant', session_id: sessionId, text: note };
          }
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
              session_id: sessionId,
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            break;
          }

          // Execute the real OrgToolDef handlers in-process and feed results
          // back into the same kimi session as the next prompt.
          const results: string[] = [];
          for (const call of calls) {
            results.push(await executeToolCall(args.tools, call));
          }
          nextPrompt = formatToolResults(calls, results);
        }

        // kimi emits no usage/result event, so synthesize one per mailbox
        // prompt: session.ts uses result messages for usage accounting and
        // budget checks, and other runners yield exactly one result per turn.
        yield {
          type: 'result',
          session_id: sessionId,
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
        };
      }
    } catch (err) {
      // Spawn-level failure (binary missing) gets the opencode-style guidance.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'KimiCodeAgentRunner requires the Kimi Code CLI (kimi) on PATH. ' +
            'Install it and log in, or unset MONOMIND_RUNTIME to use the Claude runner.',
        );
      }
      throw err;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Run one `kimi -p` invocation and stream its stream-json output
   * INCREMENTALLY: each parsed event is yielded as soon as its line arrives
   * on stdout (see the header's "Streaming / liveness" note for why buffering
   * until process exit was a bug). End-of-turn facts (exit code, stderr tail,
   * final session id, timeout flag) are written into `outcome`, which the
   * caller reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    promptText: string,
    sessionId: string | undefined,
    args: AgentRunArgs,
    agentFile: string,
    outcome: TurnOutcome,
  ): AsyncGenerator<KimiStreamEvent> {
    // ARG ORDER MATTERS: -p consumes the IMMEDIATELY following argument as
    // the prompt. Putting flags in between (e.g. `-p --session <id> text`)
    // makes kimi consume the flag as the prompt and fail with
    // "unknown command". Prompt first, flags after.
    const cliArgs: string[] = [
      '-p',
      promptText,
      '--output-format',
      'stream-json',
      '--skills-dir',
      this.emptySkillsDir,
    ];
    if (sessionId) {
      cliArgs.push('--session', sessionId);
    } else {
      // First turn: bind the role's system prompt via --agent-file.
      // (--agent-file and --session/--continue are mutually exclusive.)
      cliArgs.push('--agent-file', agentFile);
    }
    // Model only on the first turn: the session binds it at creation and
    // kimi rejects model changes on resume.
    if (args.model && !sessionId) cliArgs.push('--model', args.model);

    const child = spawn(bin, cliArgs, {
      cwd: args.cwd,
      env: {
        ...process.env,
        ...args.env,
        // --agent-file (the role's system prompt) requires kimi's v2
        // engine; without this the CLI exits 1 with
        // "--agent-file is only available with the v2 engine".
        KIMI_CODE_EXPERIMENTAL_FLAG: process.env.KIMI_CODE_EXPERIMENTAL_FLAG || '1',
        // Org sessions are single-purpose: each resumed turn re-reads the
        // whole session history, and keeping prior turns' thinking
        // ("thinkingKeep: all") inflates every request's cache reads.
        // Org roles don't need reasoning continuity between turns — the
        // mailbox + session history carry the state.
        KIMI_MODEL_THINKING_KEEP: process.env.KIMI_MODEL_THINKING_KEEP || 'off',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    // Arm the turn timeout BEFORE consuming stdout — a hung CLI must be
    // killed while we're still reading, not after it finishes.
    let timedOut = false;
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A wedged CLI that ignores SIGTERM must not leak a zombie per turn:
      // escalate to SIGKILL after a short grace period.
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, TURN_TIMEOUT_MS);

    // Attach the exit promise BEFORE consuming stdout: on a spawn failure
    // (ENOENT, bad binary) the 'error' event fires almost immediately —
    // if no listener is attached yet it escapes as an unhandled 'error'
    // event and crashes the process instead of reaching our catch block.
    const exitPromise = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('close', (code) => res(code ?? 1));
    });
    // Prevent an unhandled-rejection crash if the stdout loop below throws
    // before we await exitPromise (the await still sees the rejection).
    exitPromise.catch(() => {});

    let lastSessionId: string | undefined;
    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and the model's first event can
      // itself take minutes (long thinking chains). Yielding at spawn wins
      // that race deterministically instead of depending on kimi's latency.
      yield { kind: 'tool', toolName: 'turn started', sessionId };

      let buf = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const ev = parseStreamJsonLine(line);
          if (!ev) continue;
          if (ev.sessionId) lastSessionId = ev.sessionId;
          yield ev;
        }
      }
      if (buf.trim()) {
        const ev = parseStreamJsonLine(buf);
        if (ev) {
          if (ev.sessionId) lastSessionId = ev.sessionId;
          yield ev;
        }
      }
    } finally {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      // If the consumer abandons this stream mid-turn (session.ts's
      // silent-abort calls iterator.return(), the mailbox closes, or an
      // error is thrown downstream), don't leak the CLI subprocess.
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }

    const exitCode = await exitPromise;
    // Also scan stderr for session_id — kimi 0.33+ may emit
    // session.resume_hint on stderr instead of stdout. The stdout parser
    // already captures session_id from any event that carries it; this
    // ensures we catch it regardless of which stream kimi emits it on.
    const stderrSid = extractStderrSessionId(stderrTail);
    outcome.sessionId = lastSessionId ?? stderrSid ?? sessionId;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
  }

  /**
   * Sum usage.record entries in the session's wire.jsonl written at or after
   * `since` (the round's start time). Timestamp filtering (not line offsets)
   * is what makes resume safe: a resumed session's wire file already contains
   * historical entries from previous processes, and those must not be
   * double-counted. Returns zeros when the wire file can't be found — usage
   * reporting must never break a turn.
   */
  private readUsageDelta(
    sessionId: string | undefined,
    env: Record<string, string>,
    since: number,
  ): { input: number; output: number } {
    if (!sessionId) return { input: 0, output: 0 };
    try {
      const home =
        env.KIMI_CODE_HOME || process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
      const sessionsDir = path.join(home, 'sessions');
      const wirePath = findWireFile(sessionsDir, sessionId);
      if (!wirePath) return { input: 0, output: 0 };

      const lines = fs.readFileSync(wirePath, 'utf-8').split('\n').filter(Boolean);
      let input = 0,
        output = 0;
      for (const line of lines) {
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (ev.type !== 'usage.record') continue;
        if (typeof ev.time === 'number' && ev.time < since) continue;
        const u = (ev.usage ?? {}) as Record<string, number>;
        input += (u.inputOther ?? 0) + (u.inputCacheRead ?? 0) + (u.inputCacheCreation ?? 0);
        output += u.output ?? 0;
      }
      return { input, output };
    } catch {
      return { input: 0, output: 0 };
    }
  }
}

/** Locate $KIMI_CODE_HOME/sessions/<wd>/<sessionId>/agents/main/wire.jsonl.
 *  The wd_ directory name is a hash of the cwd — scan one level instead of
 *  reimplementing the hash. */
function findWireFile(sessionsDir: string, sessionId: string): string | null {
  let wds: string[];
  try {
    wds = fs.readdirSync(sessionsDir);
  } catch {
    return null;
  }
  for (const wd of wds) {
    const candidate = path.join(sessionsDir, wd, sessionId, 'agents', 'main', 'wire.jsonl');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * One parsed kimi stream-json event, normalized for incremental streaming.
 *   - 'assistant': rawText is the full assistant text (fences intact) for
 *     end-of-turn tool-call parsing; text is the fence-stripped prose,
 *     present only when non-empty.
 *   - 'tool':      kimi's own tool activity ({"role":"tool",...}) — forwarded
 *     by run() as a `tool_use` liveness AgentMessage (see header).
 *   - 'meta':      any other event that only carries a session id.
 */
export interface KimiStreamEvent {
  kind: 'assistant' | 'tool' | 'meta';
  text?: string;
  rawText?: string;
  toolName?: string;
  sessionId?: string;
}

/**
 * Parse ONE kimi stream-json line into a normalized event (null for blank,
 * non-JSON, or content-free lines). Exported for unit tests — this encodes
 * the wire format verified against kimi 0.29.2, and a CLI format change
 * should fail loudly in CI, not silently starve an org at runtime.
 *
 * Real shapes (verified):
 *   {"role":"assistant","content":"..."}                 — reply text
 *   {"role":"assistant","content":[{"type":"text",...}]} — block form
 *   {"role":"meta","type":"session.resume_hint",session_id} — resume hint
 *   {"role":"tool","content":"Bash(ls ...)"}             — tool progress
 */
export function parseStreamJsonLine(line: string): KimiStreamEvent | null {
  const t = line.trim();
  if (!t?.startsWith('{')) return null;
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Capture the session id from ANY event that carries it — resume needs it
  // on the next turn.
  const sid = (ev.session_id ??
    ev.sessionId ??
    (ev.session as Record<string, unknown> | undefined)?.id) as string | undefined;
  const sessionId = sid && typeof sid === 'string' ? sid : undefined;

  const role = (ev.role ?? ev.type) as string | undefined;
  if (role === 'assistant') {
    const content = ev.content ?? (ev.message as Record<string, unknown> | undefined)?.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b: Record<string, unknown>) => b?.type === 'text')
        .map((b: Record<string, unknown>) => String(b.text ?? ''))
        .join('\n');
    } else if (typeof ev.text === 'string') {
      text = ev.text;
    }
    if (text) {
      const stripped = text.replace(TOOL_CALL_RE, '').trim();
      return { kind: 'assistant', rawText: text, text: stripped || undefined, sessionId };
    }
  } else if (role === 'tool') {
    return { kind: 'tool', toolName: describeToolEvent(ev), sessionId };
  }
  // Meta/unknown events matter only when they carry a session id.
  return sessionId ? { kind: 'meta', sessionId } : null;
}

/** Short human-readable label for a {"role":"tool",...} progress event —
 *  used only as liveness text (never parsed, never shown as chat). */
function describeToolEvent(ev: Record<string, unknown>): string {
  const content = ev.content ?? (ev.message as Record<string, unknown> | undefined)?.content;
  let label: string | undefined;
  if (typeof content === 'string') label = content;
  else if (typeof ev.name === 'string') label = ev.name;
  else if (typeof ev.tool_name === 'string') label = ev.tool_name;
  else if (typeof ev.tool === 'string') label = ev.tool;
  else if (content !== undefined) label = JSON.stringify(content);
  return (label ?? 'tool activity').slice(0, 200);
}

/**
 * Parse kimi stream-json lines into normalized texts + session id.
 * Batch convenience wrapper over parseStreamJsonLine, kept for callers/tests
 * that parse a completed turn's output; the runner itself streams per line.
 */
export function parseStreamJsonLines(lines: string[]): {
  texts: string[];
  rawTexts: string[];
  sessionId?: string;
} {
  const texts: string[] = [];
  const rawTexts: string[] = [];
  let sessionId: string | undefined;

  for (const line of lines) {
    const ev = parseStreamJsonLine(line);
    if (!ev) continue;
    if (ev.sessionId) sessionId = ev.sessionId;
    if (ev.kind === 'assistant' && ev.rawText !== undefined) {
      rawTexts.push(ev.rawText);
      if (ev.text) texts.push(ev.text);
    }
  }
  return { texts, rawTexts, sessionId };
}

/** Scan stderr for session_id events. Kimi 0.33+ emits session.resume_hint on
 *  stderr (not stdout) in stream-json mode; the stdout parser captures session_id
 *  from assistant events, but if kimi emits it ONLY on stderr we'd miss it and
 *  fall back to a cold session on every turn. This defensive scan catches it
 *  regardless of which stream kimi writes it to. */
function extractStderrSessionId(stderr: string): string | undefined {
  let sessionId: string | undefined;
  for (const line of stderr.split('\n')) {
    const t = line.trim();
    if (!t?.startsWith('{')) continue;
    try {
      const ev = JSON.parse(t) as Record<string, unknown>;
      const sid = (ev.session_id ?? ev.sessionId) as string | undefined;
      if (sid && typeof sid === 'string') sessionId = sid;
    } catch {
      /* not JSON, skip */
    }
  }
  return sessionId;
}

/** Stderr patterns that mark a turn failure as FATAL (non-retryable): auth,
 *  quota, and billing errors can never be fixed by restarting the session —
 *  the daemon must not burn its crash-restart budget on them. */
const FATAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /auth_error|401|403/i, label: 'authentication/permission error' },
  {
    re: /usage limit|quota|billing cycle|insufficient.*balance|rate.?limit/i,
    label: 'provider quota/billing limit',
  },
];

export interface FatalErrorInfo {
  fatal: boolean;
  label?: string;
}

/** Classify a CLI turn's stderr: is this a fatal (non-retryable) failure? */
export function classifyStderr(stderrTail: string): FatalErrorInfo {
  for (const p of FATAL_PATTERNS) {
    if (p.re.test(stderrTail)) return { fatal: true, label: p.label };
  }
  return { fatal: false };
}

/** Build the actionable error for a failed CLI turn. */
function turnError(outcome: TurnOutcome, round: number, bin: string): Error {
  if (outcome.timedOut) {
    return new Error(
      `KimiCodeAgentRunner: kimi turn (tool round ${round}) exceeded the ${Math.round(TURN_TIMEOUT_MS / 60000)}min ` +
        `turn timeout and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors: report what actually happened, and tag the error
  // so the daemon does NOT restart into the same guaranteed failure (a
  // restart on quota exhaustion can only hang or fail again).
  const cls = classifyStderr(outcome.stderrTail);
  if (cls.fatal) {
    const err = new Error(
      `KimiCodeAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  const hint =
    bin === 'kimi' || bin.endsWith('/kimi')
      ? ' Is the Kimi Code CLI installed and logged in (kimi --version, /login)?'
      : '';
  return new Error(
    `KimiCodeAgentRunner: kimi exited with code ${outcome.exitCode} (tool round ${round}).${hint}` +
      (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
