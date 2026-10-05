// packages/@monomind/cli/src/orgrt/agent-models.ts
/**
 * #369: each runtime's real model list, for `monomind agent models`
 * (capability `agent-models`). Callers used to keep hand-written lists that
 * went stale; every source here is what the runtime itself offers, and none
 * sends a prompt:
 *  - claude: the Agent SDK's `query().supportedModels()` — what Claude Code's
 *    `/model` picker shows for this account.
 *  - codex: `codex debug models`, only entries with `visibility: "list"`.
 *  - antigravity: `agy models` (`<id>\t<label>` lines).
 *  - opencode: `opencode models` (`<provider>/<model>` lines).
 *  - dsh: no listing command (its picker is the web Models page), so the
 *    runner's own curated list (dsh-runner-models.ts DSH_MODELS, incl. the
 *    free OpenRouter/NVIDIA routes) with `curated: true`.
 * Every other runtime has no listing command: `supported: false`, `[]`.
 */

import { spawn } from 'node:child_process';
import {
  type ClaudeCodeInfo,
  claudeCodeInfo,
  defaultClaudeProbe,
  loadClaudeSdk,
} from './claude-sdk.js';
import { DSH_MODELS } from './dsh-runner-models.js';
import { locateBinary, resolveBinary, runnerSpec } from './runner-registry.js';

export interface AgentModel {
  /** What to pass as the runtime's model option. */
  id: string;
  /** The concrete model an alias (`default`, `opus`) resolves to today. */
  resolved_id?: string;
  /** On the canonical entry: every id that resolves to this same model,
   *  this entry's own `id` first (claude `default` and `opus`). Omitted when
   *  only one id does. */
  aliases?: string[];
  /** On a duplicate: the canonical entry's `id` (the first entry for the
   *  same resolved model). A caller that tests every model skips these; a
   *  lookup by id still finds them. */
  alias_of?: string;
  label: string;
  description?: string;
  /** The runtime's own default choice. */
  default?: boolean;
  effort_levels?: string[];
}

export interface ModelsResult {
  v: 1;
  runtime: string;
  /** false: this runtime has no model-listing command (`models` is `[]`). */
  supported: boolean;
  /** true: a static list monomind ships for a runtime with no listing
   *  command (dsh), not one the runtime printed. */
  curated?: boolean;
  claude_code?: ClaudeCodeInfo;
  models: AgentModel[];
  reason?: string;
  error?: { code: 'unknown-runtime' | 'missing-binary' | 'list-failed'; message: string };
}

const LISTABLE = new Set(['claude', 'codex', 'antigravity', 'opencode', 'kilo']);

// ─── parsers (pure) ──────────────────────────────────────────────────────────

interface SdkModelInfo {
  value?: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportedEffortLevels?: string[];
}

export function parseClaudeModels(list: SdkModelInfo[]): AgentModel[] {
  const models = list
    .filter((m) => typeof m.value === 'string' && m.value)
    .map((m) => ({
      id: m.value as string,
      ...(m.resolvedModel && m.resolvedModel !== m.value ? { resolved_id: m.resolvedModel } : {}),
      label: m.displayName || (m.value as string),
      ...(m.description ? { description: m.description } : {}),
      ...(m.value === 'default' ? { default: true } : {}),
      ...(m.supportedEffortLevels?.length ? { effort_levels: m.supportedEffortLevels } : {}),
    }));
  return markAliases(models);
}

/**
 * Marks aliases of the same concrete model (claude `default` and `opus` both
 * → claude-opus-5-5), which would otherwise be tested and billed twice.
 * Every entry is kept, so a lookup by id (`opus`) still works: the first
 * entry per resolved model is canonical and lists every id in `aliases`; each
 * later one gets `alias_of: <canonical id>`.
 */
export function markAliases(models: AgentModel[]): AgentModel[] {
  const canonical = new Map<string, AgentModel>();
  return models.map((m) => {
    const key = m.resolved_id ?? m.id;
    const first = canonical.get(key);
    if (!first) {
      const kept = { ...m };
      canonical.set(key, kept);
      return kept;
    }
    first.aliases = [...(first.aliases ?? [first.id]), m.id];
    return { ...m, alias_of: first.id };
  });
}

export function parseCodexModels(stdout: string): AgentModel[] {
  const json = JSON.parse(stdout) as {
    models?: Array<{
      slug?: string;
      display_name?: string;
      description?: string;
      visibility?: string;
      supported_reasoning_levels?: Array<{ effort?: string }>;
    }>;
  };
  return (json.models ?? [])
    .filter((m) => m.visibility === 'list' && m.slug)
    .map((m) => {
      const efforts = (m.supported_reasoning_levels ?? [])
        .map((l) => l.effort)
        .filter((e): e is string => !!e);
      return {
        id: m.slug as string,
        label: m.display_name || (m.slug as string),
        ...(m.description ? { description: m.description } : {}),
        ...(efforts.length ? { effort_levels: efforts } : {}),
      };
    });
}

export function parseAgyModels(stdout: string): AgentModel[] {
  const out: AgentModel[] = [];
  for (const line of stdout.split('\n')) {
    const [id, label] = line.split('\t');
    if (!id?.trim() || label === undefined) continue; // e.g. "Fetching available models..."
    out.push({ id: id.trim(), label: label.trim() || id.trim() });
  }
  return out;
}

export function parseOpencodeModels(stdout: string): AgentModel[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/\S+$/.test(l))
    .map((id) => ({ id, label: id }));
}

// ─── runners ─────────────────────────────────────────────────────────────────

export type CliRunner = (bin: string, args: string[], timeoutMs: number) => Promise<string>;
export type ClaudeLister = (timeoutMs: number) => Promise<SdkModelInfo[]>;

const runCli: CliRunner = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (out.length < 4 * 1024 * 1024) out += d;
    });
    child.stderr.on('data', (d) => {
      if (err.length < 4096) err += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(new Error(`${bin} ${args.join(' ')} exited ${code}: ${err.trim().slice(0, 300)}`));
    });
  });

/** The SDK spawns Claude Code and answers from its init handshake — no
 *  prompt is ever sent (the prompt iterable never yields). */
const listClaudeViaSdk = async (
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdkModelInfo[]> => {
  // Installed on first use (#428); a failure lands in listRuntimeModels' catch.
  const { query } = await loadClaudeSdk(defaultClaudeProbe(env));
  const abortController = new AbortController();
  async function* never(): AsyncGenerator<never> {
    await new Promise<void>((resolve) =>
      abortController.signal.addEventListener('abort', () => resolve()),
    );
  }
  const q = query({ prompt: never(), options: { settingSources: [], abortController } });
  let timer: NodeJS.Timeout | undefined;
  try {
    return (await Promise.race([
      q.supportedModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`claude model list timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ])) as SdkModelInfo[];
  } finally {
    clearTimeout(timer);
    await q.interrupt().catch(() => {});
    abortController.abort();
  }
};

export async function listRuntimeModels(
  runtime: string,
  opts: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    runCli?: CliRunner;
    listClaude?: ClaudeLister;
  } = {},
): Promise<ModelsResult> {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const base = { v: 1 as const, runtime };
  const spec = runnerSpec(runtime);
  if (!spec) {
    return {
      ...base,
      supported: false,
      models: [],
      error: { code: 'unknown-runtime', message: `unknown runtime "${runtime}" (see agent scan)` },
    };
  }
  if (runtime === 'dsh') {
    return { ...base, supported: true, curated: true, models: DSH_MODELS.map((m) => ({ ...m })) };
  }
  if (!LISTABLE.has(runtime))
    return {
      ...base,
      supported: false,
      models: [],
      ...(spec.executionUnsupportedReason ? { reason: spec.executionUnsupportedReason } : {}),
    };

  try {
    if (runtime === 'claude') {
      const list = await (opts.listClaude
        ? opts.listClaude(timeoutMs)
        : listClaudeViaSdk(timeoutMs, env));
      return {
        ...base,
        supported: true,
        models: parseClaudeModels(list),
        claude_code: opts.listClaude
          ? await claudeCodeInfo(env)
          : ((await loadClaudeSdk(defaultClaudeProbe(env))).claude_code ??
            (await claudeCodeInfo(env))),
      };
    }
    const bin = resolveBinary(spec, env);
    const binPath = bin ? locateBinary(bin, env) : null;
    if (!binPath) {
      return {
        ...base,
        supported: true,
        models: [],
        error: { code: 'missing-binary', message: `${bin} not found — ${spec.installHint}` },
      };
    }
    const run = opts.runCli ?? runCli;
    if (spec.executionPrerequisite) {
      let version: string | null;
      try {
        version = await run(binPath, ['--version'], timeoutMs);
      } catch {
        version = null;
      }
      const reason = spec.executionPrerequisite(version);
      if (reason) return { ...base, supported: false, models: [], reason };
    }
    if (runtime === 'codex') {
      return {
        ...base,
        supported: true,
        models: parseCodexModels(await run(binPath, ['debug', 'models'], timeoutMs)),
      };
    }
    if (runtime === 'antigravity') {
      return {
        ...base,
        supported: true,
        models: parseAgyModels(await run(binPath, ['models'], timeoutMs)),
      };
    }
    return {
      ...base,
      supported: true,
      models: parseOpencodeModels(await run(binPath, ['models'], timeoutMs)),
    };
  } catch (err) {
    return {
      ...base,
      supported: true,
      models: [],
      error: { code: 'list-failed', message: err instanceof Error ? err.message : String(err) },
    };
  }
}
