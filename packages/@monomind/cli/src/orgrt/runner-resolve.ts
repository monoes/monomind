// packages/@monomind/cli/src/orgrt/runner-resolve.ts
// Extracted from daemon.ts — which AgentRunner hosts a role's sessions.
import type { AgentRunner } from './agent-runner.js';
import { AiderAgentRunner } from './aider-runner.js';
import { AntigravityAgentRunner } from './antigravity-runner.js';
import { ClineAgentRunner } from './cline-runner.js';
import { CodexAgentRunner } from './codex-runner.js';
import { CopilotAgentRunner } from './copilot-runner.js';
import { CrushAgentRunner } from './crush-runner.js';
import { DshAgentRunner } from './dsh-runner.js';
import { FreebuffAgentRunner } from './freebuff-runner.js';
import { GrokAgentRunner } from './grok-runner.js';
import { HermesAgentRunner } from './hermes-runner.js';
import { KiloAgentRunner } from './kilo-runner.js';
import { KimiCodeAgentRunner } from './kimicode-runner.js';
import { OpencodeAgentRunner } from './opencode-runner.js';
import { PiRpcAgentRunner } from './pi-rpc-runner.js';
import { PiAgentRunner } from './pi-runner.js';
import { QwenRpcAgentRunner } from './qwen-rpc-runner.js';
import { QwenAgentRunner } from './qwen-runner.js';
import { autoRuntimeFromProvider, resolveRoleRuntime } from './runner-specs.js';
import type { ProviderConfig } from './types.js';
import { VercelAgentRunner } from './vercel-runner.js';

/** Resolve which AgentRunner hosts an org's role sessions.
 *  Precedence: role `runtime` field > org def `runtime` field >
 *  MONOMIND_RUNTIME env > auto-resolve from provider kind > undefined (the
 *  default path, where session.ts falls back to ClaudeAgentRunner). Returning
 *  undefined for the default path keeps Claude/Antigravity orgs byte-for-byte
 *  unchanged. Callers pass `role.runtime ?? def.runtime` as `orgRuntime`
 *  (see resolveRoleRunner). */
export type RuntimeKind =
  | 'claude'
  | 'kimicode'
  | 'opencode'
  | 'vercel'
  | 'codex'
  | 'antigravity'
  | 'grok'
  | 'qwen'
  | 'crush'
  | 'copilot'
  | 'pi'
  /** Opt-in alternate to 'pi': keeps the pi subprocess alive for the whole
   *  mailbox session (--mode rpc) instead of spawning fresh per turn — see
   *  pi-rpc-runner.ts's header for the protocol source (live-verified
   *  against pi v0.73.1, issue #179). Prefer plain 'pi' unless you
   *  specifically want session-lifetime context continuity. */
  | 'pi-rpc'
  /** Opt-in alternate to 'qwen': keeps the qwen subprocess alive for the
   *  whole mailbox session (--input-format/--output-format stream-json)
   *  instead of spawning fresh per turn — see qwen-rpc-runner.ts's header
   *  for the protocol source (live-verified against qwen-code v0.21.13,
   *  issue #182). One gap not independently re-verified: whether `result`
   *  fires exactly once per turn even when qwen runs several of its own
   *  native tools in sequence first (inferred by symmetry with the non-RPC
   *  QwenAgentRunner, not separately live-tested for this runner). Prefer
   *  plain 'qwen' unless you specifically want session-lifetime context
   *  continuity. */
  | 'qwen-rpc'
  /** Nous Research's Hermes Agent CLI (`hermes`), spawned fresh per
   *  tool-call round like 'codex' — but with NO session-resume flag in
   *  headless mode (see hermes-runner.ts's header): every round resends the
   *  full transcript, and args.resume across mailbox messages cannot be
   *  honored. Docs-only verified, streamsIncrementally: false — see
   *  runner-registry.ts. */
  | 'hermes'
  /** Cline CLI (`cline`): `--json` for a fresh session, ACP session/load for
   *  resume; kills the hub daemon it starts (cline-runner.ts, #382). */
  | 'cline'
  /** Aider (`aider`) through a Python shim run with aider's own interpreter;
   *  falls back to the plain CLI when aider is not importable (#383). */
  | 'aider'
  /** DeepSeek Harness (`dsh --profile headless --json`), developer preview;
   *  free models via `<route>/<model>` over its pi-ai adapter (#384). */
  | 'dsh'
  | 'freebuff'
  | 'kilo';
export type ProviderKind =
  | 'subscription'
  | 'api-key'
  | 'base-url'
  | 'bedrock'
  | 'vertex'
  | 'gemini'
  | 'openai'
  | 'vercel-api-key'
  | 'codex'
  | 'antigravity';

export function resolveRunner(
  orgRuntime?: RuntimeKind,
  providerKind?: ProviderKind,
  provider?: ProviderConfig,
): AgentRunner | undefined {
  const selected =
    orgRuntime ??
    autoRuntimeFromProvider(providerKind) ??
    (process.env.MONOMIND_RUNTIME as RuntimeKind | undefined);
  if (selected === 'opencode') return new OpencodeAgentRunner();
  if (selected === 'kimicode') return new KimiCodeAgentRunner();
  if (selected === 'vercel') return new VercelAgentRunner();
  if (selected === 'codex') return new CodexAgentRunner();
  if (selected === 'antigravity') return new AntigravityAgentRunner();
  if (selected === 'grok') return new GrokAgentRunner();
  if (selected === 'qwen') return new QwenAgentRunner();
  if (selected === 'crush') {
    // Issue #177: usage-proxy accounting is opt-in via provider.usageProxy +
    // provider.baseUrl (the upstream the crush CLI's own provider config
    // points at). Absent either, CrushAgentRunner falls back to its
    // documented 0-token behavior — this never blocks a turn either way.
    if (provider?.usageProxy && provider.baseUrl) {
      return new CrushAgentRunner({
        usageProxy: { upstreamBaseUrl: provider.baseUrl, baseUrlEnvVar: provider.usageProxyEnvVar },
      });
    }
    return new CrushAgentRunner();
  }
  if (selected === 'copilot') return new CopilotAgentRunner();
  if (selected === 'pi') return new PiAgentRunner();
  if (selected === 'pi-rpc') return new PiRpcAgentRunner();
  if (selected === 'qwen-rpc') return new QwenRpcAgentRunner();
  if (selected === 'hermes') return new HermesAgentRunner();
  if (selected === 'cline') return new ClineAgentRunner();
  if (selected === 'aider') return new AiderAgentRunner();
  if (selected === 'freebuff') return new FreebuffAgentRunner();
  if (selected === 'kilo') return new KiloAgentRunner();
  if (selected === 'dsh') return new DshAgentRunner();
  return undefined;
}

/** Per-session variant: a role's own `runtime` field wins over the org-level
 *  one (and the env var) — including `role.runtime === 'claude'`, which forces
 *  the default Claude path even when the org/env select another runtime.
 *  Roles without a `runtime` inherit the org-level resolution unchanged.
 *  If no explicit runtime is set, auto-resolve from the provider kind. */
export function resolveRoleRunner(
  roleRuntime?: RuntimeKind,
  orgRuntime?: RuntimeKind,
  roleProviderKind?: ProviderKind,
  orgProviderKind?: ProviderKind,
  roleProvider?: ProviderConfig,
): AgentRunner | undefined {
  return resolveRunner(
    resolveRoleRuntime(roleRuntime, orgRuntime, roleProviderKind, orgProviderKind),
    undefined,
    roleProvider,
  );
}

export { effectiveRoleRuntime, resolveRoleRuntime } from './runner-specs.js';
