// packages/@monomind/cli/src/orgrt/runner-specs.ts
/**
 * Static per-runtime metadata (binary, install hint, streaming, full access,
 * tool-activity fidelity) for every AgentRunner runtime id. Split out of
 * runner-registry.ts (file-size rule), which merges each entry with its
 * RUNNER_FEATURES flags and re-exports `RunnerSpec`.
 *
 * Binary names and env overrides MUST mirror the `<X>_CLI_BIN` lookups in
 * each orgrt/*-runner.ts — a mismatch here means scan reports a runner as
 * installed when its runner would spawn a different binary (or vice versa).
 */

import type { ProviderKind, RuntimeKind } from './daemon.js';
import { FREEBUFF_UNSUPPORTED } from './freebuff-runner.js';
import { kiloVersionRefusal } from './kilo-version.js';
import type { RunnerAccess } from './runner-access.js';
import type { RunnerFeatures } from './runner-features.js';

export interface RunnerSpec extends RunnerFeatures, RunnerAccess {
  /** Runtime id accepted by `agent exec --runtime` and org role `runtime`. */
  id: RuntimeKind;
  /** Binary probed on PATH (null for in-process runtimes like vercel). */
  binary: string | null;
  /** Env var that overrides the binary path (mirrors each runner's lookup). */
  binEnv?: string;
  /** One-line install hint, shown by scan and the missing-binary error. */
  installHint: string;
  /** Login/auth command appended to auth-class errors (§3.4 auth code). */
  loginHint?: string;
  /** Installed binary is discoverable but automated execution is unavailable. */
  executionUnsupportedReason?: string;
  /** Version-specific readiness, independently from binary presence. */
  executionPrerequisite?: (version: string | null) => string | undefined;
  /**
   * Whether this runner delivers real incremental (per-token/per-chunk)
   * `assistant` text as a turn streams, vs. only ever yielding a complete
   * message at a step/turn boundary. Callers (agent scan --json §6, the
   * `start` frame's `streams_incrementally` field §3.2) use this to set
   * the end user's expectations honestly instead of a live UI implying a
   * hang during a turn that was never going to show partial output.
   *
   * See doc/agent-exec-protocol.md's "Adding a new AgentRunner" section
   * for the checklist a new runner should follow to decide and wire this.
   */
  streamsIncrementally: boolean;
  /**
   * #355: whether `agent exec --access full` (unrestricted native tool
   * access, no approvals, no CLI sandbox) is implemented for this runtime.
   * Rev 20: every coding runtime (claude, codex, opencode, antigravity,
   * kimicode, grok, qwen, copilot, crush, pi, pi-rpc, cline, aider, dsh);
   * the rest (vercel — no native tools; hermes, qwen-rpc — no resume/tool
   * events) reject `--access full` with `error
   * {code:"unsupported", fatal:true}` rather than silently running scoped.
   * Discoverable via `agent scan --json`'s `full_access` field.
   */
  supportsFullAccess: boolean;
  /**
   * #357: how faithfully this runner's AgentMessage stream can be turned
   * into `tool_activity` start/end pairs (doc §3.2/§9) — `"full"` (real
   * tool_use id, input, and a matched end from a real tool_result),
   * `"start-only"` (a lightweight `{type:'tool_use', text: toolName}`
   * liveness signal with no id to correlate an end with), or `"none"` (no
   * tool signal surfaces in this runner's AgentMessage stream at all today).
   */
  toolActivityFidelity: 'full' | 'start-only' | 'none';
}

export const BASE_SPECS: Array<Omit<RunnerSpec, keyof RunnerFeatures | keyof RunnerAccess>> = [
  {
    id: 'freebuff',
    binary: 'freebuff',
    binEnv: 'FREEBUFF_CLI_BIN',
    installHint: 'npm install -g freebuff',
    loginHint: 'freebuff login',
    streamsIncrementally: false,
    supportsFullAccess: false,
    toolActivityFidelity: 'none',
    executionUnsupportedReason: FREEBUFF_UNSUPPORTED,
  },
  {
    id: 'kilo',
    executionPrerequisite: kiloVersionRefusal,
    binary: 'kilo',
    binEnv: 'KILO_CLI_BIN',
    installHint: 'npm install -g @kilocode/cli@7.8.3',
    loginHint: 'kilo auth login',
    streamsIncrementally: false,
    supportsFullAccess: true,
    toolActivityFidelity: 'full',
  },
  {
    id: 'claude',
    binary: 'claude', // SDK locates its own CLI; PATH probe is best-effort
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginHint: 'claude login',
    // Real per-token streaming via the SDK's `includePartialMessages`,
    // opted into only for this protocol's own caller (agent-exec.ts) —
    // see agent-runner.ts's `streamPartials` for why it's opt-in rather
    // than always-on. Live-verified against the SDK: content_block_delta
    // events with text_delta arrive per-token, and the complete message
    // still follows with full content/usage.
    streamsIncrementally: true,
    supportsFullAccess: true, // #355
    // #357: real tool_use id/input via ClaudeAgentRunner's own richer
    // 'tool_use' AgentMessage, matched to a real tool_result end.
    toolActivityFidelity: 'full',
  },
  {
    id: 'codex',
    binary: 'codex',
    binEnv: 'CODEX_CLI_BIN',
    installHint: 'npm install -g @openai/codex',
    loginHint: 'codex login',
    // Hard protocol limitation, not a monomind gap: codex's own event set
    // has no delta field at all — confirmed via its documented event enum
    // (codex-runner.ts header) — only whole `item.completed` messages.
    // The runner already yields each one the instant it lands.
    streamsIncrementally: false,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'kimicode',
    binary: 'kimi',
    binEnv: 'KIMI_CLI_BIN',
    installHint: 'install the Kimi Code CLI (kimi) from Moonshot and log in',
    loginHint: 'kimi (interactive first run)',
    // Whole messages only in the version this was verified against
    // (kimicode-runner.ts header, kimi 0.29.2) — moderate confidence, not
    // a live byte-verified spec like codex/qwen/pi below. A newer
    // installed binary hints at an internal "assistant.delta" event of
    // unconfirmed reach into `--output-format stream-json`; worth
    // re-checking before ruling this out permanently.
    streamsIncrementally: false,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'opencode',
    binary: 'opencode',
    binEnv: 'OPENCODE_BIN',
    installHint: 'npm install -g opencode-ai',
    // Real per-token streaming, switched from a blocking session.prompt()
    // call to session.promptAsync() + client.event.subscribe(). Live-verified
    // against a real opencode server (v1.18.30): the actual per-token event
    // is `message.part.delta` — NOT in the installed SDK's own .d.ts at all
    // (only message.part.updated is, whose own `delta` field was observed
    // to always be undefined live). See opencode-runner.ts's header for the
    // full live-verified event shapes and a real bug this live testing
    // caught (the echoed user prompt leaking out as a fake assistant
    // message) before it could ship. Opt-in via
    // AgentRunArgs.extras.includePartialMessages (agent-exec.ts sets it,
    // session.ts does not) — same reasoning as every other subprocess
    // runner: session.ts wants one AgentMessage per text part regardless
    // of which runner backs the role.
    streamsIncrementally: true,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'vercel',
    binary: null, // in-process via the npm `ai` package
    installHint: 'npm install ai (plus the vendor model package)',
    // Real per-token streaming: vercel-runner.ts consumes the `ai` SDK's
    // `result.fullStream` and yields each real `text-delta` part as it
    // arrives (verified against the installed `ai` package's own types)
    // when extras.includePartialMessages is set; otherwise one message per
    // model step (#563).
    streamsIncrementally: true,
    supportsFullAccess: false,
    // #357: vercel-runner.ts never yields a 'tool_use' AgentMessage at all
    // today — no tool signal to map to tool_activity.
    toolActivityFidelity: 'none',
  },
  {
    id: 'antigravity',
    binary: 'agy',
    binEnv: 'ANTIGRAVITY_CLI_BIN',
    installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    loginHint: 'agy (interactive login)',
    // Real per-token streaming via `agy --output-format stream-json`'s
    // text_delta events, fence-safely buffered by computeSafeChunk/
    // emitVisible/flushText — the reference implementation for a runner
    // whose underlying protocol needs fence-boundary awareness. Live
    // end-to-end verified: multiple incremental NDJSON lines per turn.
    // Opt-in via AgentRunArgs.extras.includePartialMessages (agent-exec.ts
    // sets it; session.ts, the org runtime, does not) — same reasoning as
    // `claude` below: session.ts wants one complete AgentMessage per step
    // for its chat-bus/state-detector, regardless of which runner backs it.
    streamsIncrementally: true,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'grok',
    binary: 'grok',
    binEnv: 'GROK_CLI_BIN',
    installHint: 'install the Grok Build CLI per https://docs.x.ai/build/cli',
    loginHint: 'grok login',
    // Whole messages only with the flag grok-runner.ts currently passes
    // (`--output-format json`) — confirmed via its own event-shape parser,
    // which has no delta field. Its header flags an untested
    // `streaming-messages-json` mode (Anthropic Messages wire format) as a
    // possible source of real deltas — unconfirmed, left `false` until
    // verified live.
    streamsIncrementally: false,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'qwen',
    binary: 'qwen',
    binEnv: 'QWEN_CLI_BIN',
    installHint: 'npm install -g @qwen-code/qwen-code',
    loginHint: 'qwen (interactive first run)',
    // Hard protocol limitation, confirmed live: qwen-runner.ts's own
    // header states directly "qwen's stream-json sends whole messages per
    // event, not per-token deltas — confirmed live, #182".
    streamsIncrementally: false,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'qwen-rpc',
    binary: 'qwen',
    binEnv: 'QWEN_CLI_BIN',
    installHint: 'npm install -g @qwen-code/qwen-code',
    loginHint: 'qwen (interactive first run)',
    // Still false — same whole-message-per-event wire vocabulary as
    // `qwen` above, no per-token/per-chunk delta field to surface. This
    // runner USED TO also buffer every message across the WHOLE round and
    // yield once at the end when `result` fired, instead of yielding per
    // event the way its qwen-runner.ts sibling always did — fixed (each
    // `assistant` event now streams the instant it lands, fence-safely,
    // reusing antigravity-runner.ts's computeSafeChunk). That was a real
    // latency bug (a multi-internal-tool-round turn could sit silent for
    // the WHOLE round instead of showing "working on it" as soon as it
    // arrived) but is orthogonal to this flag: promptness at the wire
    // format's own whole-message granularity isn't per-token streaming —
    // see doc/agent-exec-protocol.md §9 step 3. Like every other subprocess
    // runner, the fix is opt-in via extras.includePartialMessages
    // (agent-exec.ts sets it, session.ts does not) — session.ts wants one
    // AgentMessage per round regardless of which runner backs the role.
    streamsIncrementally: false,
    supportsFullAccess: false,
    // #357: qwen-rpc-runner.ts never yields a 'tool_use' AgentMessage at
    // all today — no tool signal to map to tool_activity.
    toolActivityFidelity: 'none',
  },
  {
    id: 'crush',
    binary: 'crush',
    binEnv: 'CRUSH_CLI_BIN',
    installHint: 'install Crush per https://github.com/charmbracelet/crush',
    // #473: crush's own sign-in error says "please run 'crush' to set up a provider".
    loginHint: 'crush (interactive provider setup)',
    // No structured protocol at all — crush's `run` subcommand has no
    // documented JSON event stream, just plain text (crush-runner.ts
    // header). The runner already streams each line the instant it
    // arrives; there is no finer granularity available to request.
    streamsIncrementally: false,
    supportsFullAccess: true,
    // Rev 19: `crush run` prints plain text with no native tool events; its
    // only tool_use messages are label-free liveness pings, which never
    // become tool_activity.
    toolActivityFidelity: 'none',
  },
  {
    id: 'copilot',
    binary: 'copilot',
    binEnv: 'COPILOT_CLI_BIN',
    installHint: 'npm install -g @github/copilot',
    loginHint: 'copilot (interactive first run)',
    // Whole-message NDJSON per copilot-runner.ts's own header — but that
    // header also notes the protocol is sourced from public docs, "NOT
    // byte-verified" against the real CLI, so this is lower-confidence
    // than qwen/pi's live-confirmed `false`s. Worth re-checking live
    // before assuming it can never stream.
    streamsIncrementally: false,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from the CLI's own tool start/complete events.
    toolActivityFidelity: 'full',
  },
  {
    id: 'pi',
    binary: 'pi',
    binEnv: 'PI_CLI_BIN',
    // pi 0.87 moved to the @earendil-works scope (pi-runner.ts's
    // PI_INSTALL_HINT also names --ignore-scripts and pi.dev/install.sh);
    // this plain form stays an `npm` install recipe a caller can run.
    installHint: 'npm install -g @earendil-works/pi-coding-agent',
    // #473: pi's own sign-in error says "Use /login to log into a provider".
    loginHint: 'pi, then /login (or export the provider API key)',
    // Rev 20 (#381): message_update's assistantMessageEvent.text_delta
    // streams per token when includePartialMessages is set, tool-call fences
    // held back until complete — live-verified against pi 0.87.1.
    streamsIncrementally: true,
    supportsFullAccess: true,
    // Rev 19: the runner yields id-carrying tool_use + matched tool_result
    // from pi's tool_execution_start/end (paired by toolCallId).
    toolActivityFidelity: 'full',
  },
  {
    id: 'pi-rpc',
    binary: 'pi',
    binEnv: 'PI_CLI_BIN',
    installHint: 'npm install -g @earendil-works/pi-coding-agent',
    // #473: pi's own sign-in error says "Use /login to log into a provider".
    loginHint: 'pi, then /login (or export the provider API key)',
    // Real per-token streaming via message_update's assistantMessageEvent
    // text_delta (fence-safely buffered by computeSafeChunk), live-verified
    // against pi 0.87.1 with a free OpenRouter model (#381).
    streamsIncrementally: true,
    // Rev 20 (#381): spawns through spawnRunnerProcess (process-group kill),
    // --approve/--no-approve like the json runner.
    supportsFullAccess: true,
    // Rev 20: tool_execution_start/end paired by toolCallId, live-verified.
    toolActivityFidelity: 'full',
  },
  {
    id: 'hermes',
    binary: 'hermes',
    binEnv: 'HERMES_CLI_BIN',
    installHint: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
    loginHint: 'hermes setup',
    // Live-verified (2026-09-14) against a real installed binary configured
    // with a free OpenRouter model — see hermes-runner.ts's header for the
    // full account, including two real bugs an earlier docs-only design had
    // (an invalid --usage-file flag on `chat`, and a leaked warning line on
    // stdout despite -Q). `chat --oneshot` is one-shot, whole-text-only — no
    // per-token delta mechanism, and no session-resume flag reachable from
    // it either (confirmed: --resume/--continue/-c all resume by session ID,
    // which only exists once a session has been created). hermes serve's
    // JSON-RPC/WebSocket gateway (the desktop app's transport) is the
    // plausible path to real streaming but has no published protocol/schema
    // doc found — revisit if one surfaces. See doc/agent-exec-protocol.md §9.
    streamsIncrementally: false,
    supportsFullAccess: false,
    // #357: hermes-runner.ts's own 'tool_use' yield is a single fixed
    // "turn started" placeholder ping, not a per-call tool name — no real
    // tool signal to map to tool_activity.
    toolActivityFidelity: 'none',
  },
  {
    id: 'cline',
    binary: 'cline',
    binEnv: 'CLINE_CLI_BIN',
    // cline-runner.ts's CLINE_INSTALL_HINT adds `&& cline auth`; the login
    // half lives in loginHint so this stays an `npm` install recipe.
    installHint: 'npm install -g cline',
    loginHint:
      'cline auth <provider> -k <key> -m <model> (or export the provider key, e.g. OPENROUTER_API_KEY, plus CLINE_PROVIDER)',
    // Rev 20 (#382): `cline --json` text events stream as they arrive; a
    // resumed turn runs over ACP session/prompt chunks.
    streamsIncrementally: true,
    supportsFullAccess: true,
    // content_start/content_end paired on toolCallId (cline-runner-tools.ts).
    toolActivityFidelity: 'full',
  },
  {
    id: 'aider',
    binary: 'aider',
    binEnv: 'AIDER_CLI_BIN',
    installHint: 'uv tool install --python 3.12 aider-chat',
    // aider has no login command: provider env keys, `.env`, or `api-key:`
    // in .aider.conf.yml.
    loginHint:
      'set your provider API key (e.g. OPENAI_API_KEY / OPENROUTER_API_KEY) or api-key: in ~/.aider.conf.yml',
    // Rev 20 (#383): the Python shim streams text chunks as aider's
    // coder.send yields them.
    streamsIncrementally: true,
    // Only through the shim (ShimIO answers explicit_yes_required with yes).
    supportsFullAccess: true,
    // Shim: id-carrying tool_start/tool_end with exit_code. The plain-CLI
    // fallback (aider not importable) is start-only.
    toolActivityFidelity: 'full',
  },
  {
    id: 'dsh',
    binary: 'dsh',
    binEnv: 'DSH_CLI_BIN',
    // DeepSeek Harness, developer preview; the runner accepts
    // >=0.1.7-0 <0.3.0 (dsh-runner-parse.ts DSH_SUPPORTED_RANGE).
    installHint: 'npm install -g @deepseek-ai/dsh',
    loginHint:
      'export DEEPSEEK_API_KEY (or a free OPENROUTER_API_KEY / NVIDIA_API_KEY with a <route>/<model> model), or save a key on the Models page of `dsh web`',
    // dsh emits thinking/text once per committed step, not per token.
    streamsIncrementally: false,
    supportsFullAccess: true,
    // tool_call/tool_result paired on callId (dsh-runner-parse.ts DshToolCalls).
    toolActivityFidelity: 'full',
  },
];

/** Auto-resolve runtime from provider kind. Returns undefined for Claude default. */
export function autoRuntimeFromProvider(kind?: ProviderKind): RuntimeKind | undefined {
  if (kind === 'vercel-api-key') return 'vercel';
  if (kind === 'codex') return 'codex';
  if (kind === 'antigravity') return 'antigravity';
  return undefined;
}

/** The runtime resolveRoleRunner selects for a role, undefined for the
 *  default Claude path. What the session ledger and its audit key on (#562). */
export function resolveRoleRuntime(
  roleRuntime?: RuntimeKind,
  orgRuntime?: RuntimeKind,
  roleProviderKind?: ProviderKind,
  orgProviderKind?: ProviderKind,
): RuntimeKind | undefined {
  return (
    roleRuntime ??
    orgRuntime ??
    autoRuntimeFromProvider(roleProviderKind ?? orgProviderKind) ??
    (process.env.MONOMIND_RUNTIME as RuntimeKind | undefined)
  );
}

/** The runtime whose runner hosts a role — what the session ledger, the
 *  full-access check, the sandbox choice and `org sign`'s review all name
 *  (#562, #567). Takes raw values so the sign review can pass unvalidated
 *  JSON. A configured runtime (the role's or the org's) is returned as is:
 *  the schema admits only known ones, and an unknown one keeps the stricter
 *  treatment it always had (no runner spec, so no full access). With none,
 *  provider.kind or MONOMIND_RUNTIME decide as in resolveRoleRunner; a name
 *  no runner answers to leaves the default Claude runner, so it is 'claude'. */
export function effectiveRoleRuntime(
  roleRuntime: unknown,
  orgRuntime: unknown,
  providerKind: unknown,
): string {
  const configured = roleRuntime ?? orgRuntime;
  if (configured !== undefined && configured !== null) return String(configured);
  const resolved = resolveRoleRuntime(undefined, undefined, providerKind as ProviderKind);
  return BASE_SPECS.find((s) => s.id === resolved)?.id ?? 'claude';
}
