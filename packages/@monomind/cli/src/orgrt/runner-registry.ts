// packages/@monomind/cli/src/orgrt/runner-registry.ts
/**
 * Runner registry — static metadata for every AgentRunner runtime id:
 * binary name, env-var override, install hint. Shared by `agent exec`
 * (error taxonomy: no-runner vs missing-binary, §3.4) and `agent scan`
 * (installed detection + version probe, §6) of doc/agent-exec-protocol.md.
 *
 * Binary names and env overrides MUST mirror the `<X>_CLI_BIN` lookups in
 * each orgrt/*-runner.ts — a mismatch here means scan reports a runner as
 * installed when its runner would spawn a different binary (or vice versa).
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { delimiter, join } from 'node:path';
import type { AgentRunner } from './agent-runner.js';
import { resolveRunner, type RuntimeKind } from './daemon.js';

export interface RunnerSpec {
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
}

export const RUNNER_SPECS: RunnerSpec[] = [
  {
    id: 'claude',
    binary: 'claude', // SDK locates its own CLI; PATH probe is best-effort
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginHint: 'claude login',
  },
  {
    id: 'codex',
    binary: 'codex',
    binEnv: 'CODEX_CLI_BIN',
    installHint: 'npm install -g @openai/codex',
    loginHint: 'codex login',
  },
  {
    id: 'kimicode',
    binary: 'kimi',
    binEnv: 'KIMI_CLI_BIN',
    installHint: 'install the Kimi Code CLI (kimi) from Moonshot and log in',
    loginHint: 'kimi (interactive first run)',
  },
  {
    id: 'opencode',
    binary: 'opencode',
    binEnv: 'OPENCODE_BIN',
    installHint: 'npm install -g opencode-ai',
  },
  {
    id: 'vercel',
    binary: null, // in-process via the npm `ai` package
    installHint: 'npm install ai (plus the vendor model package)',
  },
  {
    id: 'antigravity',
    binary: 'agy',
    binEnv: 'ANTIGRAVITY_CLI_BIN',
    installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    loginHint: 'agy (interactive login)',
  },
  {
    id: 'grok',
    binary: 'grok',
    binEnv: 'GROK_CLI_BIN',
    installHint: 'install the Grok Build CLI per https://docs.x.ai/build/cli',
    loginHint: 'grok login',
  },
  {
    id: 'qwen',
    binary: 'qwen',
    binEnv: 'QWEN_CLI_BIN',
    installHint: 'npm install -g @qwen-code/qwen-code',
    loginHint: 'qwen (interactive first run)',
  },
  {
    id: 'qwen-rpc',
    binary: 'qwen',
    binEnv: 'QWEN_CLI_BIN',
    installHint: 'npm install -g @qwen-code/qwen-code',
    loginHint: 'qwen (interactive first run)',
  },
  {
    id: 'crush',
    binary: 'crush',
    binEnv: 'CRUSH_CLI_BIN',
    installHint: 'install Crush per https://github.com/charmbracelet/crush',
  },
  {
    id: 'copilot',
    binary: 'copilot',
    binEnv: 'COPILOT_CLI_BIN',
    installHint: 'npm install -g @github/copilot',
    loginHint: 'copilot (interactive first run)',
  },
  {
    id: 'pi',
    binary: 'pi',
    binEnv: 'PI_CLI_BIN',
    installHint: 'npm install -g @mariozechner/pi-coding-agent',
  },
  {
    id: 'pi-rpc',
    binary: 'pi',
    binEnv: 'PI_CLI_BIN',
    installHint: 'npm install -g @mariozechner/pi-coding-agent',
  },
];

const SPEC_BY_ID = new Map(RUNNER_SPECS.map((s) => [s.id, s]));

export function runnerSpec(id: string): RunnerSpec | undefined {
  return SPEC_BY_ID.get(id as RuntimeKind);
}

export function isKnownRuntime(id: string): boolean {
  return SPEC_BY_ID.has(id as RuntimeKind);
}

/**
 * Resolve a runner for `agent exec --runtime <id>`.
 *
 * Distinct from daemon.ts's resolveRunner: unknown ids are a protocol
 * `no-runner` error (the id has no implementation), while 'claude' — for
 * which resolveRunner returns undefined as the implicit default path —
 * resolves to the shared defaultClaudeRunner. Dynamic import keeps the
 * Claude Agent SDK out of this module's static graph (scan must stay light).
 */
export async function resolveExecRunner(id: string): Promise<AgentRunner | null> {
  if (!isKnownRuntime(id)) return null;
  if (id === 'claude') {
    const { defaultClaudeRunner } = await import('./agent-runner.js');
    return defaultClaudeRunner;
  }
  return resolveRunner(id as RuntimeKind) ?? null;
}

// ─── scan (doc/agent-exec-protocol.md §6) ───────────────────────────────────

export interface ScanEntry {
  id: string;
  installed: boolean;
  binary: string | null;
  version: string | null;
  install_hint: string;
}

/** Resolve a binary honoring the runner's `<X>_CLI_BIN` override. */
function resolveBinary(spec: RunnerSpec, env: NodeJS.ProcessEnv): string | null {
  if (!spec.binary) return null;
  const overridden = spec.binEnv ? env[spec.binEnv] : undefined;
  return overridden && overridden.trim() ? overridden : spec.binary;
}

/** Absolute binary path if findable on PATH (or the override if it exists). */
function locateBinary(bin: string, env: NodeJS.ProcessEnv): string | null {
  if (bin.includes('/')) {
    // Explicit path (env override or absolute) — must exist and be executable.
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch {
      return null;
    }
  }
  const pathDirs = (env.PATH ?? '').split(delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const full = join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/** Probe `bin --version` with a hard per-binary timeout (default 5s). */
function probeVersion(
  binPath: string,
  timeoutMs = 5000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      binPath,
      ['--version'],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // Some CLIs exit non-zero for --version yet still print it.
          const line = String(stdout ?? '').trim().split('\n')[0];
          resolve(line || null);
          return;
        }
        resolve(String(stdout ?? '').trim().split('\n')[0] || null);
      },
    );
    // Belt-and-braces: execFile timeout kills, but a wedged pre-exec spawn
    // also needs the promise settled.
    child.on('error', () => resolve(null));
  });
}

export interface ScanOptions {
  /** Env used for PATH + `<X>_CLI_BIN` overrides (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Per-binary `--version` probe timeout (default 5s). */
  versionTimeoutMs?: number;
  /** Skip version probes (binary-presence scan only). */
  skipVersionProbe?: boolean;
}

/**
 * Detect every known runtime, in parallel. Exit-0-always by contract —
 * detection, not a test. Auth is deliberately NOT probed (§6): logins are
 * too heterogeneous; auth failures surface at exec time.
 */
export async function scanInstalled(opts: ScanOptions = {}): Promise<{
  v: number;
  agents: ScanEntry[];
}> {
  const env = opts.env ?? process.env;
  const entries = await Promise.all(
    RUNNER_SPECS.map(async (spec): Promise<ScanEntry> => {
      const bin = resolveBinary(spec, env);
      const binPath = bin ? locateBinary(bin, env) : null;
      const installed = binPath !== null;
      return {
        id: spec.id,
        installed,
        binary: binPath,
        version:
          installed && !opts.skipVersionProbe && binPath
            ? await probeVersion(binPath, opts.versionTimeoutMs)
            : null,
        install_hint: spec.installHint,
      };
    }),
  );
  return { v: 1, agents: entries };
}
