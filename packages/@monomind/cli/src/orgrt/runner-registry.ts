// packages/@monomind/cli/src/orgrt/runner-registry.ts
/**
 * Runner registry — static metadata for every AgentRunner runtime id
 * (runner-specs.ts merged with runner-features.ts). Shared by `agent exec`
 * (error taxonomy: no-runner vs missing-binary, §3.4) and `agent scan`
 * (installed detection + version probe, §6) of doc/agent-exec-protocol.md.
 *
 * Binary names and env overrides MUST mirror the `<X>_CLI_BIN` lookups in
 * each orgrt/*-runner.ts — a mismatch here means scan reports a runner as
 * installed when its runner would spawn a different binary (or vice versa).
 */

import * as fs from 'node:fs';
import { delimiter, join } from 'node:path';
import { claudeCodeInfo, type ClaudeCodeInfo } from './claude-sdk.js';
import type { AgentRunner } from './agent-runner.js';
import { type RuntimeKind, resolveRunner } from './daemon.js';
import { accessModes, callerToolsWithFullAccess, RUNNER_ACCESS } from './runner-access.js';
import { RUNNER_FEATURES, type RunnerFeatures } from './runner-features.js';
import {
  type Approvals,
  type NativeSandbox,
  type SandboxMode,
  type SandboxReport,
  sandboxModeReports,
  sandboxModes,
  sandboxReport,
} from './runner-sandbox.js';
import { BASE_SPECS, type RunnerSpec } from './runner-specs.js';
import { detectVersion, type VersionSource } from './version-probe.js';

export type { RunnerSpec };

export const RUNNER_SPECS: RunnerSpec[] = BASE_SPECS.map((s) => ({
  ...s,
  ...RUNNER_FEATURES[s.id],
  ...RUNNER_ACCESS[s.id],
}));

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
  claude_code?: ClaudeCodeInfo;
  id: string;
  installed: boolean;
  binary: string | null;
  version: string | null;
  /** Where `version` came from; null when not installed (rev 11, #337). */
  version_source: VersionSource | null;
  install_hint: string;
  /** `install_hint` in a shape a caller can execute safely (rev 9). */
  install: InstallRecipe;
  /** The runtime's own sign-in command, when it has one (rev 9). */
  login_hint: string | null;
  /** Mirrors `RunnerSpec.streamsIncrementally` — see its doc comment. */
  streams_incrementally: boolean;
  /** #355. Mirrors `RunnerSpec.supportsFullAccess` — see its doc comment. */
  full_access: boolean;
  /** #388 (rev 21): the `--access` values this runtime accepts. */
  access_modes: Array<'scoped' | 'read' | 'full'>;
  /** #389 (rev 22): `--tools stdio` caller tools work on this runtime. */
  caller_tools: boolean;
  /** #389 (rev 22): caller tools also work together with `--access full`. */
  caller_tools_with_full_access: boolean;
  /** #396 (rev 23): the native sandbox / approvals of a default (scoped, no
   *  `--sandbox`, no org git level) turn, and the `--sandbox` values accepted. */
  native_sandbox: NativeSandbox;
  approvals: Approvals;
  sandbox_modes: SandboxMode[];
  /** #482 (rev 26): what each accepted `--sandbox` mode reports on a
   *  scoped turn — the start event's native_sandbox/approvals for it. */
  sandbox_mode_reports: Partial<Record<SandboxMode, SandboxReport>>;
  /** Mirrors `RunnerSpec.toolActivityFidelity` (#357) — see its doc comment. */
  tool_activity_fidelity: 'full' | 'start-only' | 'none';
  /** Rev 13 service flags — mirror `RunnerFeatures` (runner-features.ts). */
  resume: boolean;
  effort: boolean;
  max_turns: boolean;
  reports_cost: boolean;
  init_target: RunnerFeatures['initTarget'];
}

import { type InstallRecipe, installRecipe } from './runner-install-recipe.js';

export { type InstallRecipe, installRecipe };

/** Resolve a binary honoring the runner's `<X>_CLI_BIN` override. */
export function resolveBinary(spec: RunnerSpec, env: NodeJS.ProcessEnv): string | null {
  if (!spec.binary) return null;
  const overridden = spec.binEnv ? env[spec.binEnv] : undefined;
  return overridden?.trim() ? overridden : spec.binary;
}

/** Absolute binary path if findable on PATH (or the override if it exists). */
export function locateBinary(bin: string, env: NodeJS.ProcessEnv): string | null {
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

export interface ScanOptions {
  /** Env used for PATH + `<X>_CLI_BIN` overrides (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Per-binary `--version` probe timeout (default 5s). */
  versionTimeoutMs?: number;
  /** Skip version detection (binary-presence scan only). */
  skipVersionProbe?: boolean;
  /**
   * Run `--version` (in a scratch HOME) for every installed runtime whose
   * install metadata has no version, not only the side-effect-free ones.
   */
  probe?: boolean;
}

/**
 * Detect every known runtime, in parallel. Exit-0-always by contract —
 * detection, not a test. Auth is deliberately NOT probed (§6): logins are
 * too heterogeneous; auth failures surface at exec time. Read-only unless
 * `probe` is set: see version-probe.ts for when a binary is run (#337).
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
      const detected =
        binPath === null
          ? null
          : opts.skipVersionProbe
            ? { version: null, source: 'not-probed' as const }
            : await detectVersion(spec.id, binPath, opts);
      return {
        ...(spec.id === 'claude' ? { claude_code: await claudeCodeInfo(env) } : {}),
        id: spec.id,
        installed: binPath !== null,
        binary: binPath,
        version: detected?.version ?? null,
        version_source: detected?.source ?? null,
        install_hint: spec.installHint,
        install: installRecipe(spec.installHint),
        login_hint: spec.loginHint ?? null,
        streams_incrementally: spec.streamsIncrementally,
        full_access: spec.supportsFullAccess,
        access_modes: accessModes(spec),
        caller_tools: spec.callerTools,
        caller_tools_with_full_access: callerToolsWithFullAccess(spec),
        ...sandboxReport(spec.id, { access: 'scoped' }),
        sandbox_modes: [...sandboxModes(spec.id)],
        sandbox_mode_reports: sandboxModeReports(spec.id),
        tool_activity_fidelity: spec.toolActivityFidelity,
        resume: spec.resume,
        effort: spec.effort,
        max_turns: spec.maxTurns,
        reports_cost: spec.reportsCost,
        init_target: spec.initTarget,
      };
    }),
  );
  return { v: 1, agents: entries };
}
