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
 *     remote client: create a session, POST prompts, read the response.
 *
 * Verified against @opencode-ai/sdk 1.18.x (NOT the docs — the .d.ts and a
 * live probe):
 *   - `createOpencode()` spawns a server and returns { client, server }.
 *   - `client.session.create({ body: { title } })` → `{ data: { id } }`.
 *   - `client.session.prompt({ path: { id }, body: { parts: [{ type: 'text',
 *     text }], system?, model? } })` BLOCKS for the whole turn and returns
 *     `{ data: { info, parts } }` — info carries tokens
 *     ({ input, output, reasoning, cache: { read, write } }) and cost; the
 *     assistant text lives in parts of type "text".
 *   - Because prompt() blocks, undici's default headers timeout (~30s) kills
 *     any real turn with UND_ERR_HEADERS_TIMEOUT. This runner installs a
 *     dispatcher with headersTimeout matching TURN_TIMEOUT_MS — without it
 *     every non-trivial org turn dies.
 *
 * Org tools (org_send, knowledge_search, …) travel over the shared FENCE
 * PROTOCOL (tool-fence.ts): rendered into the system prompt, parsed out of
 * the assistant text, executed in-process, results fed back into the same
 * session — same mechanism as KimiCodeAgentRunner.
 *
 * Non-disturbance guarantees:
 *   - The SDK is imported dynamically; the package has no hard dependency on
 *     @opencode-ai/sdk. Selected only via MONOMIND_RUNTIME=opencode; without
 *     it the Claude path is byte-for-byte unchanged and run() rejects with a
 *     clear actionable error instead of crashing at import time.
 */

import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';

/** How long a single prompt() call may block before we give up (2 hours —
 *  org turns with tool loops are long). Also drives the undici dispatcher's
 *  headers timeout, which is what actually kills slow turns otherwise. */
const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class OpencodeAgentRunner implements AgentRunner {
  constructor(private opencodeUrl?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
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

    // prompt() blocks for entire turns, so the default undici headers timeout
    // (~30s) aborts every real org turn. Install a generous dispatcher.
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
    // from the user's interactive opencode state.
    let client: any;
    let server: { url: string; close(): void } | null = null;
    const attachUrl = this.opencodeUrl || process.env.OPENCODE_URL;
    if (attachUrl) {
      client = sdk.createOpencodeClient({ baseUrl: attachUrl, directory: args.cwd });
    } else {
      if (typeof sdk.createOpencode !== 'function') {
        throw new Error(
          'OpencodeAgentRunner: @opencode-ai/sdk has no createOpencode — check the SDK version.',
        );
      }
      // The SDK's default server-start timeout is 5s — too tight for a cold
      // machine (first spawn of the opencode binary can take longer, and a
      // timeout crashes the role session). 30s is safely above cold-start
      // time while still failing fast enough for the retry backoff to help.
      const started = await sdk.createOpencode({ hostname: '127.0.0.1', port: 0, timeout: 30_000 });
      client = started.client;
      server = started.server;
    }

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
          const res: any = await withTimeout(
            client.session.prompt({
              path: { id: sessionId },
              body: {
                parts: [{ type: 'text', text: nextPrompt }],
                system: systemPrompt,
                ...(model ? { model } : {}),
              },
            }),
            TURN_TIMEOUT_MS,
            `opencode prompt (tool round ${round})`,
          );

          const info = res?.data?.info ?? res?.info ?? {};
          const parts: Array<Record<string, unknown>> = res?.data?.parts ?? res?.parts ?? [];
          const texts = parts
            .filter((pt) => pt?.type === 'text' && typeof pt.text === 'string')
            .map((pt) => String(pt.text));

          const tokens = (info.tokens ?? {}) as {
            input?: number;
            output?: number;
            cache?: { read?: number; write?: number };
          };
          turnInputTokens +=
            (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
          turnOutputTokens += tokens.output ?? 0;
          turnCost += typeof info.cost === 'number' ? info.cost : 0;

          for (const t of texts) {
            const stripped = t.replace(TOOL_CALL_RE, '').trim();
            if (stripped) yield { type: 'assistant', session_id: sessionId, text: stripped };
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
      // Termination path: close the ephemeral server we spawned. (Attached
      // servers are the user's — never close those.)
      try {
        server?.close();
      } catch {
        /* best-effort */
      }
    }
  }
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
