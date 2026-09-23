/**
 * Typed door into .claude/helpers/jev-picker.cjs, the ONE implementation of the
 * Jev decision picker. It is shared with the prompt hook, which runs as a
 * standalone CommonJS script in user projects and cannot import this package.
 * Everything here is safe when nothing is configured or the helper is missing:
 * the answer is "no decision" and callers keep their existing path.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CatalogItem {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  text?: string;
  invoke?: string;
}

export interface RankedOption {
  id: string;
  probability: number;
}

export interface JevAnswer {
  choice: string;
  confidence: number;
  ranked: RankedOption[];
}

export interface JevPick {
  provider: 'custom' | 'typesafe';
  agent?: JevAnswer;
  skill?: JevAnswer;
}

export interface JevProvider {
  name: 'custom' | 'typesafe';
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface JevError extends Error {
  provider: string;
  status?: number;
}

export interface PickOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  onError?: (err: JevError) => void;
  /** Overrides MONOMIND_JEV_TIMEOUT_MS for this call. */
  timeoutMs?: number;
  maxCandidates?: number;
  include?: { agents?: string[]; skills?: string[] };
  agentInstructions?: string;
  skillInstructions?: string;
}

export interface JevPickerModule {
  NONE_ID: string;
  isDisabled(env?: NodeJS.ProcessEnv): boolean;
  normalizeBaseUrl(value?: string): string | null;
  resolveProviders(env?: NodeJS.ProcessEnv): JevProvider[];
  resolveTimeoutMs(env?: NodeJS.ProcessEnv): number;
  resolveHookTimeoutMs(env?: NodeJS.ProcessEnv): number;
  redactSecrets(text: string): string;
  shortlist<T extends CatalogItem>(
    query: string,
    items: T[],
    limit: number,
    include?: string[],
  ): (T & { score: number })[];
  pick(
    task: string,
    catalogs: { agents?: CatalogItem[]; skills?: CatalogItem[] },
    opts?: PickOptions,
  ): Promise<JevPick | null>;
  acceptAgent(answer: JevAnswer | undefined, env?: NodeJS.ProcessEnv): string | null;
  acceptSkills(answer: JevAnswer | undefined, env?: NodeJS.ProcessEnv, max?: number): string[];
  probe(
    provider: JevProvider,
    opts?: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch },
  ): Promise<number>;
  loadAgentCatalog(root: string): CatalogItem[];
  loadSkillCatalog(root: string): CatalogItem[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/decision → ../.. is the package root; dist/src/decision → ../../.. */
const HELPER_CANDIDATES = [
  join(HERE, '..', '..', '.claude', 'helpers', 'jev-picker.cjs'),
  join(HERE, '..', '..', '..', '.claude', 'helpers', 'jev-picker.cjs'),
];

let loaded: JevPickerModule | null | undefined;
let loadError: Error | undefined;

export function jevModule(): JevPickerModule | null {
  if (loaded !== undefined) return loaded;
  const file = HELPER_CANDIDATES.find((p) => existsSync(p));
  try {
    loaded = file ? (createRequire(import.meta.url)(file) as JevPickerModule) : null;
  } catch (err) {
    loaded = null;
    loadError = err instanceof Error ? err : new Error(String(err));
  }
  return loaded;
}

/** Why the helper exists but failed to load; undefined when it is just missing. */
export function jevLoadError(): Error | undefined {
  jevModule();
  return loadError;
}

export function decisionModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (jevModule()?.resolveProviders(env).length ?? 0) > 0;
}

export async function pickWithJev(
  task: string,
  catalogs: { agents?: CatalogItem[]; skills?: CatalogItem[] },
  opts: PickOptions = {},
): Promise<JevPick | null> {
  const mod = jevModule();
  if (!mod) return null;
  try {
    return await mod.pick(task, catalogs, opts);
  } catch (err) {
    // A picker bug must not break routing, but it must not vanish either.
    const e = (err instanceof Error ? err : new Error(String(err))) as JevError;
    e.provider ??= 'jev-picker';
    try {
      opts.onError?.(e);
    } catch {
      /* a logger must never break routing */
    }
    return null;
  }
}

export function acceptAgent(answer: JevAnswer | undefined, env?: NodeJS.ProcessEnv): string | null {
  return jevModule()?.acceptAgent(answer, env) ?? null;
}

export function acceptSkills(
  answer: JevAnswer | undefined,
  env?: NodeJS.ProcessEnv,
  max?: number,
): string[] {
  return jevModule()?.acceptSkills(answer, env, max) ?? [];
}

/** Keyword ranking (the no-model fallback): only items with some overlap. */
export function keywordRank<T extends CatalogItem>(
  query: string,
  items: T[],
  limit: number,
): (T & { score: number })[] {
  const mod = jevModule();
  return mod ? mod.shortlist(query, items, limit).filter((i) => i.score > 0) : [];
}
