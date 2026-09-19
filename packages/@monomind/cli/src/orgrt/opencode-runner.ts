// packages/@monomind/cli/src/orgrt/opencode-runner.ts
/**
 * OpencodeAgentRunner — AgentRunner impl backed by the opencode server.
 *
 * Architectural difference from ClaudeAgentRunner:
 *   - Claude's `query()` runs the whole agent loop IN-PROCESS (tools execute
 *     inside the same Node process as the daemon). That's why ClaudeAgentRunner
 *     can register org tools (org_send, ask_human, …) directly via
 *     createSdkMcpServer.
 *   - opencode runs the agent loop in its OWN server process. The SDK is a
 *     remote client: create a session, kick off a prompt, watch a shared
 *     event stream for what happens.
 *
 * Streaming — LIVE-VERIFIED against a real opencode server (v1.18.30,
 * @opencode-ai/sdk 1.18.15), not just the installed .d.ts, which turned out
 * to be incomplete for this specific need:
 *   - `client.session.promptAsync({ path, body })` is fire-and-forget —
 *     `POST /session/{id}/prompt_async` returns 204 with no body. Unlike the
 *     blocking `session.prompt()` this runner used before, there is no
 *     response to read text or usage from; everything comes from the event
 *     stream below.
 *   - `client.event.subscribe()` resolves `{ stream: AsyncGenerator<Event> }`
 *     (SSE). The two events this runner needs:
 *       `message.part.delta` — `{sessionID, messageID, partID, field, delta}`
 *         — the REAL per-token/per-chunk text event. This is NOT in the
 *         installed SDK's own `Event` union type at all (only
 *         `message.part.updated` is, whose own `delta?: string` field was
 *         observed to always be `undefined` live — the .d.ts is stale
 *         relative to the server's actual wire format). Confirmed live: a
 *         real generation emits dozens of these per part.
 *       `message.updated` — `{info: AssistantMessage}` — fires repeatedly as
 *         a message evolves; `info.time.completed` being set (confirmed live
 *         on both a normal completion and a provider error) is the reliable
 *         "this assistant message is fully done" signal, at which point
 *         `info.tokens`/`info.cost` are the final values for the round.
 *     `message.part.updated`'s own full `part.text` snapshot (fired once
 *     when a part is created, empty, and again as it's completed) is kept as
 *     a checkpoint but the incremental visible stream is driven by
 *     `message.part.delta` — same decouple-and-diff shape as
 *     antigravity-runner.ts/qwen-rpc-runner.ts: `computeSafeChunk` picks out
 *     what's fence-safe to reveal from the accumulating per-part raw text,
 *     diffed against how much of that part has already been shown; the
 *     final reconciliation at round end reveals anything the incremental
 *     path hasn't (normally nothing).
 *   - A message's `reasoning`-type parts also emit `message.part.delta`
 *     events with `field:"text"` — excluded from visible output the same
 *     way Claude's thinking blocks are, by checking the owning part's own
 *     `type` (tracked from `message.part.updated`, which always precedes
 *     that part's first delta).
 *   - Because prompt() no longer blocks, the previous undici headers-timeout
 *     workaround is less critical for the prompt call itself (which now
 *     returns near-instantly), but the SSE connection is still a long-lived
 *     body stream for the whole role's lifetime — the same generous
 *     dispatcher (headersTimeout + bodyTimeout:0) is kept for it.
 *
 * Org tools (org_send, knowledge_search, …) travel over the shared FENCE
 * PROTOCOL (tool-fence.ts): rendered into the system prompt, parsed out of
 * the assistant text, executed in-process, results fed back into the same
 * session — same mechanism as KimiCodeAgentRunner. `parseToolCalls` needs
 * each text part's RAW (fence-intact) text, so that — not the fence-stripped
 * visible text — is what's collected per part for it, exactly as the
 * previous blocking-call implementation did.
 *
 * Non-disturbance guarantees:
 *   - The SDK is imported dynamically; the package has no hard dependency on
 *     @opencode-ai/sdk. Selected only via MONOMIND_RUNTIME=opencode; without
 *     it the Claude path is byte-for-byte unchanged and run() rejects with a
 *     clear actionable error instead of crashing at import time.
 */

import { spawn } from 'node:child_process';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
// Reused, not reimplemented — see antigravity-runner.ts's own header for why
// a fence can legitimately span multiple incremental deltas and must never
// surface, complete or partial, in visible text.
import { computeSafeChunk } from './antigravity-runner.js';
import { omitAnthropicManagedKeys } from './provider.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';

/** How long a single tool round may take — from sending the prompt to its
 *  assistant message completing — before we give up (2 hours — org turns
 *  with tool loops are long). Also drives the undici dispatcher's headers
 *  timeout for the long-lived event-stream connection. */
const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class OpencodeAgentRunner implements AgentRunner {
  constructor(private opencodeUrl?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    // Incremental streaming is opt-in via extras, not unconditional — same
    // reasoning as every other subprocess runner this session
    // (ClaudeAgentRunner/AntigravityAgentRunner/QwenRpcAgentRunner):
    // session.ts (the org runtime) wants exactly one AgentMessage per text
    // part for its chat-bus/state-detector, regardless of which runner
    // backs the role; agent-exec.ts sets this for every runtime, session.ts
    // never does.
    const streamPartials = args.extras?.includePartialMessages === true;

    // Dynamic import: keeps @opencode-ai/sdk out of the package's dependency
    // graph so the Claude/Kimi paths never need it installed. Specifiers are
    // held in variables so TypeScript types the result as `any` and does NOT
    // try to resolve (and fail on) the missing module at compile time.
    const sdkMod = '@opencode-ai/sdk';
    let sdk: any;
    try {
      sdk = await import(/* @vite-ignore */ sdkMod);
    } catch {
      throw new Error(
        'OpencodeAgentRunner requires @opencode-ai/sdk. Install it (npm i @opencode-ai/sdk) ' +
          'and ensure opencode is available, or unset MONOMIND_RUNTIME to use the Claude runner.',
      );
    }

    // The event-stream connection stays open for the whole role's lifetime,
    // so the default undici headers timeout (~30s) would otherwise abort it
    // long before a real org turn finishes. Install a generous dispatcher.
    // Best-effort: if undici can't be imported here, turns still work up to
    // the library default (short turns only).
    try {
      const undiciMod = 'undici';
      const undici: any = await import(/* @vite-ignore */ undiciMod);
      undici.setGlobalDispatcher(
        new undici.Agent({
          headersTimeout: TURN_TIMEOUT_MS,
          bodyTimeout: 0,
        }),
      );
    } catch {
      /* library default applies */
    }

    // Connect: either attach to a running server (opencodeUrl / OPENCODE_URL)
    // or spawn an ephemeral one. Spawning per role keeps org roles isolated
    // from the user's interactive opencode state — and is the only path that
    // can carry the role's session env (#262, see startOpencodeServer).
    let client: any;
    let server: { url: string; close(): void } | null = null;
    const attachUrl = this.opencodeUrl || process.env.OPENCODE_URL;
    if (attachUrl) {
      client = sdk.createOpencodeClient({ baseUrl: attachUrl, directory: args.cwd });
    } else {
      server = await startOpencodeServer(args);
      client = sdk.createOpencodeClient({ baseUrl: server.url });
    }

    // Abort hook (see AgentRunArgs.signal): the only child this runner owns
    // is the ephemeral server it spawned — close it so its process dies,
    // which also tears down the event-stream connection below and fails the
    // in-flight round instead of running on unobserved. (Attached servers
    // are the user's — never close those.)
    const unsubscribeAbort = killOnAbort(args.signal, {
      kill: () => {
        try {
          server?.close();
        } catch {
          /* best-effort */
        }
      },
    });

    // ONE subscription for this role's whole lifetime — every round below
    // pulls from the SAME iterator so no event landing between two rounds is
    // ever missed. Subscribed before any prompt is sent so the SSE
    // connection is already established by the time promptAsync() fires.
    const eventsSub: any = await client.event.subscribe();
    const events: any = eventsSub.stream;

    try {
      // One opencode session per role run. The system prompt (plus the fence
      // protocol for org tools) is carried on each prompt() call's `system`
      // field — opencode has no per-session system-prompt binding.
      const systemPrompt = args.systemPrompt + buildToolProtocol(args.tools);
      let sessionId: string | undefined = args.resume;
      if (sessionId) {
        // opencode's session.create has no resume/id parameter (only
        // parentID/title) — resuming means reusing the existing session id
        // directly. session.get confirms the session still exists on the
        // opencode server before we drive prompt() calls against it.
        await client.session.get({ path: { id: sessionId } });
      } else {
        const created = await client.session.create({ body: { title: 'monomind-org-role' } });
        sessionId = created?.data?.id ?? created?.id;
      }
      if (!sessionId) {
        throw new Error(
          'OpencodeAgentRunner: session.create returned no id — check the opencode server is healthy.',
        );
      }

      // Model: AgentRunArgs.model is "provider/model" (e.g.
      // "anthropic/claude-sonnet-4"); the SDK wants the two halves separate.
      const modelParts = typeof args.model === 'string' ? args.model.split('/') : [];
      const model =
        modelParts.length >= 2
          ? { providerID: modelParts[0], modelID: modelParts.slice(1).join('/') }
          : undefined;

      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let turnCost = 0;

        // Tool-call loop: keep driving the same session until a turn produces
        // no tool_call fences (or the round cap hits).
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          await withTimeout(
            client.session.promptAsync({
              path: { id: sessionId },
              body: {
                parts: [{ type: 'text', text: nextPrompt }],
                system: systemPrompt,
                ...(model ? { model } : {}),
              },
            }),
            TURN_TIMEOUT_MS,
            `opencode promptAsync (tool round ${round})`,
          );

          // Per-round incremental-streaming state — reset every round, same
          // cadence as antigravity/qwen-rpc's own per-step/per-round reset.
          // assistantMessageId is discovered from the event stream itself
          // (promptAsync's 204 response carries no id) — the first
          // role:"assistant" message.updated seen this round.
          let assistantMessageId: string | undefined;
          const partTypes = new Map<string, string>();
          const partRawText = new Map<string, string>();
          const partVisible = new Map<string, string>();
          const partOrder: string[] = [];
          let finalTokens:
            | { input?: number; output?: number; cache?: { read?: number; write?: number } }
            | undefined;
          let finalCost: number | undefined;

          const roundDeadline = Date.now() + TURN_TIMEOUT_MS;
          for (;;) {
            const remaining = roundDeadline - Date.now();
            if (remaining <= 0) {
              throw new Error(
                `OpencodeAgentRunner: opencode round ${round} exceeded the ` +
                  `${Math.round(TURN_TIMEOUT_MS / 60000)}min turn timeout waiting for the assistant message to complete`,
              );
            }
            const next: any = await withTimeout<any>(
              events.next(),
              remaining,
              `opencode event stream (tool round ${round})`,
            );
            const ev = next?.value;
            if (next?.done || !ev) break;
            const evType = (ev as any)?.type;
            const props = (ev as any)?.properties;
            if (!props) continue;

            if (evType === 'message.updated') {
              const info = props.info;
              if (!info || info.sessionID !== sessionId || info.role !== 'assistant') continue;
              if (assistantMessageId === undefined) assistantMessageId = info.id;
              if (info.id !== assistantMessageId) continue;
              if (info.time?.completed) {
                finalTokens = info.tokens;
                finalCost = typeof info.cost === 'number' ? info.cost : undefined;
                break; // this round's assistant response is fully generated
              }
              continue;
            }

            if (evType === 'message.part.updated') {
              const part = props.part;
              if (!part || part.sessionID !== sessionId) continue;
              // Strict gate, not "skip the check if unknown": the echoed
              // USER message (and its own text part, carrying the prompt
              // text back verbatim) always arrives BEFORE the assistant
              // message.updated that establishes assistantMessageId — live-
              // verified. Treating "don't know the assistant id yet" as
              // "let it through" was a real bug caught live: the prompt
              // text itself got recorded as a text part and leaked out as
              // a fake final "assistant" message once nothing else claimed
              // to have already shown it.
              if (assistantMessageId === undefined || part.messageID !== assistantMessageId)
                continue;
              if (!partTypes.has(part.id)) partOrder.push(part.id);
              partTypes.set(part.id, part.type);
              if (part.type === 'text' && typeof part.text === 'string') {
                partRawText.set(part.id, part.text);
              }
              continue;
            }

            if (evType === 'message.part.delta') {
              if (props.sessionID !== sessionId) continue;
              // Same strict gate as message.part.updated above.
              if (assistantMessageId === undefined || props.messageID !== assistantMessageId)
                continue;
              if (props.field !== 'text') continue;
              if (partTypes.get(props.partID) !== 'text') continue;
              const raw = (partRawText.get(props.partID) ?? '') + (props.delta ?? '');
              partRawText.set(props.partID, raw);
              // Gated on streamPartials: when false, partVisible simply
              // never advances, so the final reconciliation below naturally
              // degrades to "reveal the whole finalStripped text per part"
              // — byte-for-byte the pre-streaming behavior session.ts
              // depends on.
              if (streamPartials) {
                const { chunk } = computeSafeChunk(raw, 0);
                const trimmed = chunk.replace(/\s+$/, '');
                const shown = partVisible.get(props.partID) ?? '';
                if (trimmed.length > shown.length) {
                  const increment = trimmed.slice(shown.length);
                  partVisible.set(props.partID, trimmed);
                  yield { type: 'assistant', session_id: sessionId, text: increment };
                }
              }
              continue;
            }

            if (evType === 'session.error') {
              const err = props.error;
              throw new Error(
                `OpencodeAgentRunner: opencode session error: ` +
                  (err?.data?.message ?? err?.name ?? JSON.stringify(err) ?? 'unknown error'),
              );
            }
            // Everything else (session.status, session.idle, plugin.*,
            // file.watcher.*, catalog.*, …) carries no signal this runner
            // acts on — drained, matching the previous implementation's own
            // "only text parts matter" scope.
          }

          const tokens = finalTokens ?? {};
          turnInputTokens +=
            (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
          turnOutputTokens += tokens.output ?? 0;
          turnCost += finalCost ?? 0;

          // Final reconciliation, one texts[] entry per text part — matching
          // the previous implementation's per-part (not joined) granularity.
          // texts[] carries the RAW fence-intact text (parseToolCalls needs
          // the fence itself); the visible reveal below is the fence-stripped
          // remainder the incremental path hasn't already shown (normally
          // nothing — see antigravity-runner.ts's flushText for why an
          // unclosed fence must still leak through here unchanged).
          const texts: string[] = [];
          for (const partId of partOrder) {
            if (partTypes.get(partId) !== 'text') continue;
            const raw = partRawText.get(partId) ?? '';
            texts.push(raw);
            const finalStripped = raw.replace(TOOL_CALL_RE, '').trim();
            const shown = partVisible.get(partId) ?? '';
            const remainder =
              finalStripped.length > shown.length ? finalStripped.slice(shown.length) : undefined;
            if (remainder) yield { type: 'assistant', session_id: sessionId, text: remainder };
          }

          const malformed: string[] = [];
          const calls = parseToolCalls(texts, (raw, err) =>
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

          const results: string[] = [];
          for (const call of calls) {
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
          }
          nextPrompt = formatToolResults(calls, results);
        }

        // One result per mailbox prompt, matching the other runners' cadence
        // so session.ts' usage accounting and budget checks work unchanged.
        yield {
          type: 'result',
          session_id: sessionId,
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
          cost_usd: turnCost || undefined,
        };
      }
    } finally {
      unsubscribeAbort();
      // Termination path: close the ephemeral server we spawned. (Attached
      // servers are the user's — never close those.) This also tears down
      // the event-stream connection.
      try {
        server?.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

/** How long the ephemeral server may take to print its listening line. The
 *  SDK's own default of 5s is too tight for a cold machine, and a timeout
 *  there crashes the role session. */
const SERVER_START_TIMEOUT_MS = 30_000;

/**
 * Start the ephemeral opencode server WITH THE ROLE'S SESSION ENV (#262).
 *
 * The SDK's `createOpencode()`/`createOpencodeServer()` spawn `opencode serve`
 * with the daemon's `process.env` and take no env option (`ServerOptions` is
 * `{hostname, port, signal, timeout, config}` — @opencode-ai/sdk 1.18.15), so
 * `args.env` never reached the process that runs the role's shell: provider
 * credentials, the #249 MONOMIND_* scoping and the #258 git guard all silently
 * failed to apply, and that shell had the operator's full git/GitHub access.
 * Spawning it here is codex-runner.ts's own `{ ...process.env, ...args.env }`
 * shape. An ATTACHED server (`OPENCODE_URL`) can't get the env — it is the
 * operator's own process; role-sandbox.ts audits it with `git-guard-unapplied`.
 */
function startOpencodeServer(args: AgentRunArgs): Promise<{ url: string; close(): void }> {
  // Mirrors runner-registry.ts's OPENCODE_BIN override for this runtime.
  const bin = process.env.OPENCODE_BIN || 'opencode';
  const child = spawn(bin, ['serve', '--hostname=127.0.0.1', '--port=0'], {
    cwd: args.cwd,
    env: { ...omitAnthropicManagedKeys(process.env), ...args.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // kill() on an exited child is a no-op (same as the SDK's own stop()).
  const close = () => void child.kill();
  return new Promise((resolve, reject) => {
    let out = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const die = (what: string) =>
      settle(() => {
        close();
        reject(new Error(`OpencodeAgentRunner: opencode serve ${what}\n${out}`.trimEnd()));
      });
    const timer = setTimeout(() => die('did not start in time'), SERVER_START_TIMEOUT_MS);
    const onOutput = (c: Buffer) => {
      // The SDK reads the same line ("opencode server listening on <url>").
      out = (out + c.toString()).slice(-4000);
      const m = out.match(/opencode server listening on\s+(https?:\/\/\S+)/);
      if (m) settle(() => resolve({ url: m[1], close }));
    };
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);
    child.on('error', (e: Error) => settle(() => reject(e)));
    child.on('exit', (code: number | null) => die(`exited with code ${code}`));
  });
}

/** Race a promise against a wall-clock timeout. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `OpencodeAgentRunner: ${label} exceeded the ${Math.round(ms / 60000)}min turn timeout`,
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
