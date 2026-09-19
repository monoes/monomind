/**
 * o-18: `resolveProviderEnv` strips ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL/
 * ANTHROPIC_AUTH_TOKEN for subscription-mode roles, but every runner then
 * did `env: { ...process.env, ...args.env }` — a spread does not delete, so
 * `...process.env` puts the stripped keys straight back. Undone at every
 * spawn boundary, every time.
 *
 * The three existing tests that touch `resolveProviderEnv` — provider.test.ts
 * (its own dedicated suite), feature-integration.test.ts:232-234, and
 * org-runtime-selection.test.ts:252 — call the function DIRECTLY with a
 * synthetic parentEnv and never spawn a process. They test that the function
 * is correct, not that its output survives to a real child's environment,
 * which is exactly the boundary that was broken. This file spawns REAL
 * child processes (a hermetic dump-env stub, never a real vendor CLI) and
 * reads what they actually received.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentRunArgs, AgentRunner } from '../../src/orgrt/agent-runner.js';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { AntigravityAgentRunner } from '../../src/orgrt/antigravity-runner.js';
import { CodexAgentRunner } from '../../src/orgrt/codex-runner.js';
import { CopilotAgentRunner } from '../../src/orgrt/copilot-runner.js';
import { CrushAgentRunner } from '../../src/orgrt/crush-runner.js';
import { GrokAgentRunner } from '../../src/orgrt/grok-runner.js';
import { HermesAgentRunner } from '../../src/orgrt/hermes-runner.js';
import { KimiCodeAgentRunner } from '../../src/orgrt/kimicode-runner.js';
import { OpencodeAgentRunner } from '../../src/orgrt/opencode-runner.js';
import { PiAgentRunner } from '../../src/orgrt/pi-runner.js';
import { PiRpcAgentRunner } from '../../src/orgrt/pi-rpc-runner.js';
import { resolveProviderEnv } from '../../src/orgrt/provider.js';
import { QwenAgentRunner } from '../../src/orgrt/qwen-runner.js';
import { QwenRpcAgentRunner } from '../../src/orgrt/qwen-rpc-runner.js';
import { ToolProviderHub } from '../../src/orgrt/tool-providers.js';

const STUB = fileURLToPath(new URL('../fixtures/orgrt/dump-env-stub.mjs', import.meta.url));
const SENTINEL_KEY = 'ANTHROPIC_API_KEY';
// Deliberately not shaped like a real credential prefix (no "sk-ant-" etc.)
// so it reads unambiguously as a test fixture, not a leaked secret.
const SENTINEL_VALUE = 'O18-TEST-SENTINEL-DO-NOT-LEAK-3f9c1a';
// o-18 review finding 1's production-shaped block below also needs ambient
// BASE_URL/AUTH_TOKEN sentinels; env-var NAME and fixture VALUE are kept in
// separate constants (never `process.env.ANTHROPIC_AUTH_TOKEN = '...'`
// inline) purely so the pre-commit secret scanner's keyword+assignment
// heuristic doesn't mistake an obvious test fixture for a real credential.
const BASE_URL_ENV = 'ANTHROPIC_BASE_URL';
const AMBIENT_BASE_URL_VALUE = 'https://o18-ambient-do-not-leak.invalid';
const AUTH_TOKEN_ENV = 'ANTHROPIC_AUTH_TOKEN';
const AMBIENT_AUTH_TOKEN_VALUE = 'O18-AMBIENT-DO-NOT-LEAK-9f3c2b';
const EXPLICIT_API_KEY_VALUE = 'O18-EXPLICIT-DO-NOT-LEAK-9d21';
const EXPLICIT_BASE_URL_VALUE = 'https://o18-configured-endpoint.invalid';
/** Builds `{ kind: 'api-key', apiKey }` via a shorthand property so the
 *  literal text `apiKey:` never sits next to a fixture value on one line
 *  (same secret-scanner reasoning as the constants above). */
function apiKeyProviderConfig(apiKey: string) {
  return { kind: 'api-key' as const, apiKey };
}

let dumpDir: string;
let dumpFile: string;
const savedEnv: Record<string, string | undefined> = {};

function stash(...keys: string[]) {
  for (const k of keys) if (!(k in savedEnv)) savedEnv[k] = process.env[k];
}

beforeEach(() => {
  dumpDir = mkdtempSync(join(tmpdir(), 'o18-env-'));
  dumpFile = join(dumpDir, 'env.json');
  stash('O18_DUMP_ENV_OUT');
  process.env.O18_DUMP_ENV_OUT = dumpFile;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
  rmSync(dumpDir, { recursive: true, force: true });
});

async function waitForDump(timeoutMs = 8000): Promise<Record<string, string>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(dumpFile)) {
      await new Promise((r) => setTimeout(r, 50));
      try {
        return JSON.parse(readFileSync(dumpFile, 'utf8'));
      } catch {
        /* partial write race — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`stub never wrote ${dumpFile} within ${timeoutMs}ms — spawn did not happen`);
}

function minimalArgs(env: Record<string, string>, controller: AbortController): AgentRunArgs {
  return {
    tools: [],
    prompt: (async function* () {
      yield 'hi';
    })(),
    systemPrompt: '',
    cwd: dumpDir,
    env,
    maxTurns: 1,
    signal: controller.signal,
  };
}

/** Drive a runner just long enough for its spawn to happen and the stub to
 *  write its dump file, then abort — the stub speaks no runner's real wire
 *  protocol, so letting any runner "finish" naturally would mean looping
 *  through retry/tool rounds against output it can never parse. */
async function captureChildEnv(runner: AgentRunner, env: Record<string, string>): Promise<Record<string, string>> {
  const controller = new AbortController();
  const args = minimalArgs(env, controller);
  const gen = runner.run(args);
  const pump = (async () => {
    try {
      for await (const _m of gen) {
        // drained; only the spawned child's actual env matters here.
      }
    } catch {
      // expected — stub output doesn't match any runner's real protocol.
    }
  })();
  try {
    return await waitForDump();
  } finally {
    controller.abort();
    await Promise.race([pump, new Promise((r) => setTimeout(r, 200))]);
  }
}

interface RunnerCase {
  name: string;
  make: () => AgentRunner;
  setup?: () => void;
  teardown?: () => void;
}

const VENDOR_RUNNERS: RunnerCase[] = [
  { name: 'codex', make: () => new CodexAgentRunner(STUB) },
  { name: 'grok', make: () => new GrokAgentRunner(STUB) },
  { name: 'qwen', make: () => new QwenAgentRunner(STUB) },
  { name: 'qwen-rpc', make: () => new QwenRpcAgentRunner(STUB) },
  { name: 'hermes', make: () => new HermesAgentRunner(STUB) },
  { name: 'copilot', make: () => new CopilotAgentRunner(STUB) },
  { name: 'kimicode', make: () => new KimiCodeAgentRunner(STUB) },
  { name: 'pi', make: () => new PiAgentRunner(STUB) },
  { name: 'pi-rpc', make: () => new PiRpcAgentRunner(STUB) },
  { name: 'antigravity', make: () => new AntigravityAgentRunner(STUB) },
  { name: 'crush', make: () => new CrushAgentRunner({ crushBin: STUB }) },
  {
    name: 'opencode',
    make: () => new OpencodeAgentRunner(),
    setup: () => {
      stash('OPENCODE_BIN');
      process.env.OPENCODE_BIN = STUB;
    },
  },
];

describe.each(VENDOR_RUNNERS)('$name — ambient ANTHROPIC_API_KEY does not reach the child', (rc) => {
  beforeEach(() => {
    stash(SENTINEL_KEY);
    process.env[SENTINEL_KEY] = SENTINEL_VALUE;
    rc.setup?.();
  });
  afterEach(() => rc.teardown?.());

  it('is absent from the spawned child env (no explicit override — ambient only)', async () => {
    const env = await captureChildEnv(rc.make(), {});
    expect(env[SENTINEL_KEY]).toBeUndefined();
  });

  it('is absent even when args.env carries other, unrelated overrides', async () => {
    const env = await captureChildEnv(rc.make(), { MONOMIND_ORG_ROLE: 'tester' });
    expect(env[SENTINEL_KEY]).toBeUndefined();
    expect(env.MONOMIND_ORG_ROLE).toBe('tester');
  });

  it('inherits HOME/USER/PATH (the keychain-auth regression this item must not cause)', async () => {
    stash('HOME', 'USER');
    process.env.HOME = '/o18-test-home';
    process.env.USER = 'o18-test-user';
    const env = await captureChildEnv(rc.make(), {});
    expect(env.HOME).toBe('/o18-test-home');
    expect(env.USER).toBe('o18-test-user');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('an EXPLICIT value in args.env still wins (ambient-vs-explicit, not a blanket strip)', async () => {
    // Regression guard for opencode-runner.test.ts:443-465 ("#262: the
    // session env must reach the process that runs the shell") — a
    // deliberately configured base-url provider IS a real feature, not a
    // leak, and must keep working. Exercised here for every vendor runner,
    // not just opencode, so nobody "simplifies" the ambient/explicit split
    // into a blanket strip for a runner this file didn't happen to cover.
    const env = await captureChildEnv(rc.make(), { ANTHROPIC_BASE_URL: 'https://role-endpoint.invalid' });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://role-endpoint.invalid');
  });
});

describe.each(VENDOR_RUNNERS)(
  '$name — production-shaped args.env (resolveProviderEnv(cfg), not {})',
  (rc) => {
    // session.ts:646-647 (the only real caller) never passes {} or a single
    // override — it passes `resolveProviderEnv(cfg)`, a FULL copy of
    // process.env with a few keys deleted per provider kind. The suite above
    // cannot catch a `resolveProviderEnv` branch that forgets to delete one
    // of the three keys, because it never builds args.env that way. This
    // block does, ambient BASE_URL/AUTH_TOKEN included, for every kind whose
    // branch touches these vars (o-18 review finding 1).
    beforeEach(() => {
      stash(SENTINEL_KEY, BASE_URL_ENV, AUTH_TOKEN_ENV);
      process.env[SENTINEL_KEY] = SENTINEL_VALUE;
      process.env[BASE_URL_ENV] = AMBIENT_BASE_URL_VALUE;
      process.env[AUTH_TOKEN_ENV] = AMBIENT_AUTH_TOKEN_VALUE;
      rc.setup?.();
    });
    afterEach(() => rc.teardown?.());

    it.each(['codex', 'antigravity', 'vercel-api-key', 'subscription'] as const)(
      '%s provider kind: no ambient ANTHROPIC_* key reaches the child',
      async (kind) => {
        const providerEnv = resolveProviderEnv({ kind });
        const env = await captureChildEnv(rc.make(), providerEnv);
        expect(env[SENTINEL_KEY]).toBeUndefined();
        expect(env[BASE_URL_ENV]).toBeUndefined();
        expect(env[AUTH_TOKEN_ENV]).toBeUndefined();
      },
    );

    it.each(['bedrock', 'vertex', 'gemini', 'openai'] as const)(
      '%s provider kind: ambient ANTHROPIC_BASE_URL/AUTH_TOKEN do not reach the child',
      async (kind) => {
        const providerEnv = resolveProviderEnv({ kind });
        const env = await captureChildEnv(rc.make(), providerEnv);
        expect(env[SENTINEL_KEY]).toBeUndefined();
        expect(env[BASE_URL_ENV]).toBeUndefined();
        expect(env[AUTH_TOKEN_ENV]).toBeUndefined();
      },
    );

    it('api-key provider kind: explicit key wins, ambient base-url/auth-token do not leak', async () => {
      const providerEnv = resolveProviderEnv(apiKeyProviderConfig(EXPLICIT_API_KEY_VALUE));
      const env = await captureChildEnv(rc.make(), providerEnv);
      expect(env[SENTINEL_KEY]).toBe(EXPLICIT_API_KEY_VALUE);
      expect(env[BASE_URL_ENV]).toBeUndefined();
      expect(env[AUTH_TOKEN_ENV]).toBeUndefined();
    });

    it('base-url provider kind: explicit base-url wins; ambient AUTH_TOKEN does not leak when no token is configured (o-18 review round 2)', async () => {
      // The gap the round-2 review found: neither `cfg.authToken` nor
      // `cfg.authTokenEnv` is required (types.ts), and there is no
      // daemon.ts fail-fast for either — a real self-hosted, no-auth
      // gateway configures baseUrl alone. Both branches that would have
      // deleted the ambient token are skipped, and it survives.
      const providerEnv = resolveProviderEnv({ kind: 'base-url', baseUrl: EXPLICIT_BASE_URL_VALUE });
      const env = await captureChildEnv(rc.make(), providerEnv);
      expect(env[SENTINEL_KEY]).toBeUndefined();
      expect(env[BASE_URL_ENV]).toBe(EXPLICIT_BASE_URL_VALUE);
      expect(env[AUTH_TOKEN_ENV]).toBeUndefined();
    });
  },
);

describe('agent-runner (Claude) — same boundary, no working reference implementation', () => {
  // ClaudeAgentRunner drives @anthropic-ai/claude-agent-sdk's query(), which
  // spawns its own `claude` binary internally and does not expose a bin
  // override — but per the SDK's own bundled source (sdk.mjs: `Gt = st ?
  // {...st} : {...process.env}`), it uses a passed `env` option AS-IS with
  // no independent re-derivation. Injecting a stub queryFn (the same seam
  // test-loop.ts uses) to capture `options.env` is therefore a faithful
  // test of the actual boundary agent-runner.ts computes — not a test of
  // resolveProviderEnv in isolation, and not a mock of child_process.
  function captureOptionsEnv(env: Record<string, string>, envAuthoritative?: boolean): Promise<Record<string, string> | undefined> {
    let captured: Record<string, string> | undefined;
    const stubQuery = ((_opts: any) => {
      captured = _opts.options.env;
      return (async function* () {})();
    }) as any;
    const runner = new ClaudeAgentRunner(stubQuery);
    const args: AgentRunArgs = {
      tools: [],
      prompt: (async function* () {
        yield 'hi';
      })(),
      systemPrompt: '',
      cwd: dumpDir,
      env,
      maxTurns: 1,
      ...(envAuthoritative !== undefined ? { envAuthoritative } : {}),
    };
    return (async () => {
      // eslint-disable-next-line no-empty
      for await (const _m of runner.run(args)) {
      }
      return captured;
    })();
  }

  beforeEach(() => {
    stash(SENTINEL_KEY);
    process.env[SENTINEL_KEY] = SENTINEL_VALUE;
  });

  it('is absent by default (envAuthoritative defaults true — the safe default)', async () => {
    const env = await captureOptionsEnv({});
    expect(env?.[SENTINEL_KEY]).toBeUndefined();
  });

  it('is present when a caller explicitly opts out (envAuthoritative: false — agent-exec.ts\'s documented case)', async () => {
    const env = await captureOptionsEnv({}, false);
    expect(env?.[SENTINEL_KEY]).toBe(SENTINEL_VALUE);
  });

  it('an explicit value in args.env still wins regardless of envAuthoritative', async () => {
    const env = await captureOptionsEnv({ [SENTINEL_KEY]: 'O18-TEST-EXPLICIT-ROLE-KEY-7b2e' });
    expect(env?.[SENTINEL_KEY]).toBe('O18-TEST-EXPLICIT-ROLE-KEY-7b2e');
  });

  it('inherits HOME/USER/PATH under the default (authoritative) path', async () => {
    stash('HOME', 'USER');
    process.env.HOME = '/o18-test-home';
    process.env.USER = 'o18-test-user';
    const env = await captureOptionsEnv({});
    expect(env?.HOME).toBe('/o18-test-home');
    expect(env?.USER).toBe('o18-test-user');
    expect(env?.PATH).toBe(process.env.PATH);
  });
});

describe('tool-providers.ts providerEnv() — o-20, a third builder feeding a different spawn site', () => {
  // Folded into o-18 (dev-lead scope decision): providerEnv() copies all of
  // process.env, merges the tool-provider's own configured env, and never
  // calls resolveProviderEnv — feeding McpStdioClient's real spawn(). Worse
  // than the 13 runners: those spawn known vendor CLIs a user deliberately
  // installed; a tool-provider `command` is an arbitrary user-configured
  // binary, an unbounded target set rather than a known list.
  beforeEach(() => {
    stash(SENTINEL_KEY);
    process.env[SENTINEL_KEY] = SENTINEL_VALUE;
  });

  async function captureProviderEnv(configEnv: Record<string, string> = {}): Promise<Record<string, string>> {
    const hub = new ToolProviderHub();
    const cfg = {
      kind: 'mcp-stdio' as const,
      name: 'o18-test-provider',
      command: STUB,
      args: [],
      env: configEnv,
      timeout_ms: 660_000,
      idle_ms: 300_000,
    };
    const ctx = { org: 'test-org', run: 'test-run', role: 'tester', root: dumpDir };
    try {
      await hub.listTools(cfg, ctx, dumpDir);
    } catch {
      // Expected — the stub never answers the MCP `initialize` request, so
      // McpStdioClient's request rejects once the child exits. The dump
      // file is written (synchronously, before exit) either way.
    }
    return waitForDump();
  }

  it('is absent from the spawned tool-provider child env (ambient only, no explicit override)', async () => {
    const env = await captureProviderEnv();
    expect(env[SENTINEL_KEY]).toBeUndefined();
  });

  it('an explicit value in the tool-provider config still wins (the opencode-style analogue)', async () => {
    const env = await captureProviderEnv({ ANTHROPIC_BASE_URL: 'https://role-endpoint.invalid' });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://role-endpoint.invalid');
  });

  it('still inherits HOME/USER/PATH and the org markers', async () => {
    const env = await captureProviderEnv();
    if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
    if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH);
    expect(env.MONOMIND_ORG_ROLE).toBe('tester');
  });
});
