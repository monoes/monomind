// packages/@monomind/cli/src/orgrt/hermes-runner.ts
/**
 * HermesAgentRunner — AgentRunner impl backed by Nous Research's Hermes
 * Agent CLI (`hermes`, github.com/NousResearch/hermes-agent), spawned as a
 * subprocess.
 *
 * VERIFICATION STATUS — LIVE-VERIFIED (2026-09-14) against a real installed
 * binary (official installer, `hermes-agent` via `uv`) configured with a
 * free OpenRouter model. This replaced an earlier docs-only design that got
 * two real things wrong — see "CORRECTIONS FROM LIVE TESTING" below. Ground
 * truth throughout this header is `hermes --help` / `hermes chat --help`
 * output from the installed binary, not fetched docs pages.
 *
 * Architecture: closest existing pattern is CodexAgentRunner — a fresh
 * `hermes` subprocess is spawned per tool-call round, org tools are rendered
 * into the prompt via the fence protocol (tool-fence.ts), and the model's
 * ```tool_call fences are parsed out, executed in-process (canUseTool-gated),
 * and fed back as the next round's prompt. NOT the RPC/session-store
 * patterns (qwen-rpc/pi-rpc/antigravity) — hermes headless mode has no
 * persistent session to attach to. NOT vercel-runner's client-side
 * message-array store either — hermes takes one flat prompt string, not a
 * structured message list.
 *
 * ONE REAL DEVIATION FROM CODEX: codex reconnects context between tool-call
 * rounds via `resume <threadId>`, so only round 0 needs the full system
 * prompt. Hermes's headless CLI has NO session-resume flag reachable from
 * `--oneshot` (confirmed: `--resume`/`--continue`/`-c` all resume by session
 * ID, which only exists once a session has been created — `--oneshot`
 * exits before the caller ever sees one). So every round here resends the
 * FULL transcript (system prompt + tool protocol + original user text +
 * every prior round's raw assistant text + tool results) as one flat
 * string. Bounded by MAX_TOOL_ROUNDS (10), so not unbounded, but real extra
 * token cost on any multi-round turn compared to codex's resume-based
 * approach — worth knowing going in.
 *
 * `args.resume` (cross-mailbox-message continuity) CANNOT be honored: there
 * is no flag to resume a prior headless invocation by an ID the caller
 * already has. This is a real gap versus every other runner, but it doesn't
 * bite the path this runner ships for today — agent-exec.ts's prompt stream
 * is single-message per process (see its own "Single-message prompt
 * stream" comment), so there is no second mailbox message that would ever
 * need resuming. It WOULD bite a hypothetical session.ts org role on
 * runtime: 'hermes' sending multiple mailbox messages to the same runner
 * instance — left unresolved, not silently faked.
 *
 * LIVENESS: hermes produces ZERO stdout until the whole turn completes — no
 * JSONL event stream at all, unlike codex. This is the exact liveness hazard
 * codex's own header describes fixing (#204: session.ts races the first pull
 * against a 4-minute silent-stream watchdog) — worse here, since there is no
 * intermediate event to parse at all. Mirrors codex's fix: a `tool_use`
 * liveness message is yielded the instant the subprocess spawns, before
 * waiting on exit.
 *
 * Invocation (live-verified against `hermes chat --help` and real runs):
 *   hermes chat --query-file <path> --oneshot -Q [-m <model>]
 *   - `--query-file PATH`: "Read the single query from a file instead of
 *     the command line ('-' reads stdin). Safe for arbitrary text: nothing
 *     is shell-interpreted" — confirmed file-based (not a stdin alias) by
 *     `--help`'s own wording AND by a live run where the file's content was
 *     what the model answered from. Avoids argv quoting/length limits
 *     (system prompt + tool protocol + resent transcript routinely exceeds
 *     a safe single argv element — same rationale codex-runner.ts documents
 *     for stdin). "Mutually exclusive with -q" — never pass both.
 *   - `--oneshot`: "With -q/--query-file: answer the query and exit...
 *     instead of seeding an interactive session."
 *   - `-Q`/`--quiet`: "suppress banner, spinner, and tool previews. Only
 *     output the final response and session info." In practice: stdout is
 *     mostly clean, but see the stdout-pollution finding below — this flag
 *     does NOT guarantee stdout is nothing but the answer.
 *   - `session_id` is printed to STDERR (`session_id: <id>`), not stdout —
 *     confirmed live. Parsed out and surfaced as AgentMessage.session_id
 *     for observability; still cannot be used to resume (see above).
 *   - No usage/cost reporting: `--usage-file` exists ONLY on the top-level
 *     `hermes -z PROMPT --usage-file PATH` shorthand (confirmed via
 *     top-level `hermes --help`), NOT on `hermes chat` — passing it to
 *     `chat` is a hard argument-parse error ("unrecognized arguments"),
 *     confirmed live. The top-level `-z` form takes the prompt as a raw
 *     argv string, reintroducing the exact argv-length/quoting problem
 *     `--query-file` exists to avoid — not worth it just for usage
 *     accounting. This runner always reports input_tokens/output_tokens/
 *     cost_usd as 0 (same documented limitation as vercel-runner.ts's
 *     cost_usd:0 — token budgets still enforce via policy.ts elsewhere).
 *
 * CORRECTIONS FROM LIVE TESTING (what the docs-only version got wrong):
 *   1. `--usage-file` is NOT a `chat` flag (see above) — the original
 *      design tried `chat --oneshot --usage-file <path>` and hermes
 *      rejected it outright. Usage tracking was removed rather than
 *      switched to the argv-based `-z` form, for the reason given above.
 *   2. STDOUT IS NOT ALWAYS PURE ANSWER TEXT even with `-Q`: a live run hit
 *      a leaked warning line — `⚠ tirith security scanner enabled but not
 *      available — command scanning will use pattern matching only` — ahead
 *      of the real answer on stdout. Non-deterministic (did not reproduce
 *      on a second identical run), and specific to a missing optional
 *      Python dependency (`tirith`) in the environment this was verified
 *      in — a DIFFERENT hermes install could leak a different warning for a
 *      different missing dependency. Any line starting with the `⚠` marker
 *      is filtered out of stdout before the remainder is treated as the
 *      raw assistant text (see `stripWarningLines` below); this is a
 *      pattern-based defense, not an exhaustive one — an undiscovered
 *      warning shape could still leak through.
 *   Both were caught only by live-verifying the EXACT argv this runner
 *   sends, not by re-reading documentation more carefully — the docs page
 *   this was originally built from didn't mention either.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
import { maskedCommand } from './authority-mask.js';
import { classifyStderr } from './kimicode-runner.js';
import { omitAnthropicManagedKeys } from './provider.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching codex/kimi runners

/** Lines hermes has been observed to leak onto stdout despite -Q ("quiet
 *  mode") — see file header's "CORRECTIONS FROM LIVE TESTING". Pattern-based,
 *  not exhaustive: only the one shape actually observed live is filtered. */
function stripWarningLines(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => !line.trim().startsWith('⚠'))
    .join('\n')
    .trim();
}

/** hermes prints `session_id: <id>` on stderr (confirmed live — not stdout,
 *  unlike the top-level `-z` shorthand's documented "no Session: line"). */
function extractSessionId(stderrTail: string): string | undefined {
  const m = /^session_id:\s*(\S+)/m.exec(stderrTail);
  return m?.[1];
}

interface TurnOutcome {
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  stdout: string;
  sessionId?: string;
}

export class HermesAgentRunner implements AgentRunner {
  constructor(private hermesBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.hermesBin || process.env.HERMES_CLI_BIN || 'hermes';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-hermes-'));
    const promptFile = path.join(tmpDir, 'prompt.txt');

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let sessionId: string | undefined;

        // Full transcript, resent in full every round — see file header on
        // why (headless hermes has no session-resume flag, unlike codex).
        const transcript: string[] = [`${args.systemPrompt}${buildToolProtocol(args.tools)}`, text];

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          fs.writeFileSync(promptFile, transcript.join('\n\n---\n\n'));

          const outcome: TurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            stdout: '',
          };

          for await (const ev of this.streamTurn(bin, promptFile, args, outcome)) {
            yield ev;
          }

          if (outcome.exitCode !== 0 || outcome.timedOut) {
            throw turnError(outcome, round);
          }
          if (outcome.sessionId) sessionId = outcome.sessionId;

          const rawText = outcome.stdout;
          const stripped = rawText.replace(TOOL_CALL_RE, '').trim();
          if (stripped) yield { type: 'assistant', session_id: sessionId, text: stripped };

          const malformed: string[] = [];
          const calls = parseToolCalls([rawText], (raw, err) =>
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

          // Execute org tools in-process, gated through canUseTool, then
          // append THIS round's raw assistant text and the tool results to
          // the transcript — the whole thing gets resent next round.
          const results: string[] = [];
          for (const call of calls) {
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
          }
          transcript.push(rawText, formatToolResults(calls, results));
        }

        // Synthesize one result message per mailbox prompt — session.ts /
        // agent-exec.ts use these for usage accounting and budget checks.
        // Usage is always 0: hermes's only usage-report mechanism
        // (--usage-file) is incompatible with `chat` — see file header.
        yield {
          type: 'result',
          session_id: sessionId,
          subtype: 'success',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'HermesAgentRunner requires the Hermes CLI (hermes) on PATH. ' +
            'Install: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash, ' +
            "then run 'hermes setup' to authenticate. Or unset the runtime to use Claude.",
        );
      }
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Run one `hermes chat --oneshot` invocation. Yields exactly one liveness
   * `tool_use` message the instant the subprocess spawns (see file header —
   * hermes has no intermediate event stream to yield from, unlike codex),
   * then drains stdout to completion. End-of-turn facts (exit code, stderr
   * tail, warning-filtered stdout text, session id parsed from stderr) are
   * written into `outcome`, which the caller reads after this generator
   * completes.
   */
  private async *streamTurn(
    bin: string,
    promptFile: string,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<AgentMessage> {
    const cliArgs: string[] = ['chat', '--query-file', promptFile, '--oneshot', '-Q'];
    if (args.model) cliArgs.push('-m', args.model);

    const child = spawn(...maskedCommand(args.authorityMask, bin, cliArgs), {
      cwd: args.cwd,
      // o-18: ambient ANTHROPIC_* creds never belong to a non-Anthropic
      // vendor CLI; an explicit value in args.env still wins below.
      env: { ...omitAnthropicManagedKeys(process.env), ...args.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    // SIGTERM→SIGKILL escalation, shared by the turn timeout, the abort
    // signal, and the abandoned-stream path in `finally` — same shape as
    // codex-runner.ts's streamTurn.
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const killChild = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, TURN_TIMEOUT_MS);
    const unsubscribeAbort = killOnAbort(args.signal, child, KILL_GRACE_MS);

    // Attach the exit promise BEFORE consuming stdout: on a spawn failure
    // (ENOENT, bad binary) the 'error' event fires almost immediately — if
    // no listener is attached yet it escapes as an unhandled 'error' event.
    const exitPromise = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('close', (code) => res(code ?? 1));
    });
    exitPromise.catch(() => {});

    try {
      // Liveness: hermes prints NOTHING until the whole turn is done (no
      // JSONL stream, unlike codex) — yield immediately so a long turn never
      // looks silent to session.ts's watchdog.
      yield { type: 'tool_use', text: 'turn started' };

      let stdout = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        stdout += chunk.toString();
      }
      outcome.stdout = stripWarningLines(stdout);
    } finally {
      clearTimeout(timer);
      unsubscribeAbort();
      if (child.exitCode === null && child.signalCode === null) {
        // Not confirmed dead: either the consumer abandoned this stream
        // mid-turn or a SIGTERM from the timeout/abort is still inside its
        // grace period — see codex-runner.ts's identical comment.
        if (!child.killed) killChild();
      } else if (killTimer) {
        clearTimeout(killTimer);
      }
    }

    const exitCode = await exitPromise;
    if (killTimer) clearTimeout(killTimer);
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.sessionId = extractSessionId(stderrTail);
  }
}

/** Build the actionable error for a failed hermes turn. Same shape as
 *  codex-runner.ts's turnError. */
function turnError(outcome: TurnOutcome, round: number): Error {
  if (outcome.timedOut) {
    return new Error(
      `HermesAgentRunner: hermes turn (tool round ${round}) exceeded the ${Math.round(TURN_TIMEOUT_MS / 60000)}min ` +
        `turn timeout and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  const cls = classifyStderr(outcome.stderrTail);
  if (cls.fatal) {
    const err = new Error(
      `HermesAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `HermesAgentRunner: hermes chat failed (exit ${outcome.exitCode})` +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
