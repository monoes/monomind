// packages/@monomind/cli/src/latest-models.ts
/**
 * The newest model of a family, never an older one, resolved when it is asked
 * for. The answer is the newest of two sources:
 *
 *  - the live catalog: each runtime's own model list, cached by
 *    `refreshLatestModels` (org start, `agent models`) in
 *    ~/.monomind/latest-models.json, so a new release is picked up with no code
 *    change;
 *  - LATEST_FLOOR: the newest ids known when this release was cut. A runtime's
 *    catalog can lag a usable model (Claude Code's `haiku` alias was still 4.5
 *    when `claude-haiku-5-5` already ran), so the floor keeps a stale or empty
 *    catalog from ever pulling a default back.
 *
 * Blocked models (model-guard.ts) never count.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isBlockedModel } from './model-guard.js';

export type ModelRuntime = 'claude' | 'codex' | 'antigravity';
type Version = [number, number];
export interface ParsedModel {
  runtime: ModelRuntime;
  family: string;
  version: Version;
}

const CLAUDE = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
const CODEX = /^gpt-(\d+)(?:\.(\d+))?-(terra|sol|luna|astra)$/;
const ANTIGRAVITY = /^gemini-(\d+)(?:\.(\d+))?-(flash|pro|argon)-(low|medium|high)$/;

/** Runtime, family and version of a model id; null for a name this does not
 *  judge (aliases such as `opus`, other vendors). */
export function parseModelId(id: string): ParsedModel | null {
  let m = CLAUDE.exec(id);
  if (m) return { runtime: 'claude', family: m[1], version: [Number(m[2]), Number(m[3] ?? 0)] };
  m = CODEX.exec(id);
  if (m) return { runtime: 'codex', family: m[3], version: [Number(m[1]), Number(m[2] ?? 0)] };
  m = ANTIGRAVITY.exec(id);
  if (m) {
    return {
      runtime: 'antigravity',
      family: `${m[3]}-${m[4]}`,
      version: [Number(m[1]), Number(m[2] ?? 0)],
    };
  }
  return null;
}

const newer = (a: Version, b: Version): boolean => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/** The highest version of `family` among `ids`, ignoring blocked models. */
export function newestModel(
  ids: readonly string[],
  runtime: ModelRuntime,
  family: string,
): string | undefined {
  let best: { id: string; version: Version } | undefined;
  for (const id of ids) {
    const p = parseModelId(id);
    if (!p || p.runtime !== runtime || p.family !== family || isBlockedModel(id)) continue;
    if (!best || newer(p.version, best.version)) best = { id, version: p.version };
  }
  return best?.id;
}

/** The newest ids known at this release. Raise these when a family ships. */
export const LATEST_FLOOR: Record<ModelRuntime, Record<string, string>> = {
  claude: { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' },
  codex: { terra: 'gpt-5.6-terra' },
  antigravity: { 'flash-high': 'gemini-3.8-flash-high' },
};

type Catalog = Partial<Record<ModelRuntime, string[]>>;
const RUNTIMES: ModelRuntime[] = ['claude', 'codex', 'antigravity'];

export const catalogFile = (): string => join(homedir(), '.monomind', 'latest-models.json');

function readRaw(file: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** The cached catalog; empty when the file is missing or unreadable. */
export function readCatalog(file: string = catalogFile()): Catalog {
  const raw = readRaw(file);
  const out: Catalog = {};
  for (const r of RUNTIMES) {
    const v = raw[r];
    if (Array.isArray(v)) out[r] = v.filter((x): x is string => typeof x === 'string');
  }
  return out;
}

function writeCatalog(file: string, catalog: Catalog, updatedAt?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const stamp = updatedAt ?? readRaw(file)._updatedAt;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({ ...catalog, ...(stamp === undefined ? {} : { _updatedAt: stamp }) }, null, 2),
  );
  renameSync(tmp, file);
}

/** Stores one runtime's model list (what `agent models` just read) without
 *  touching the other runtimes or the refresh clock. Blocked models are dropped. */
export function recordCatalog(
  runtime: ModelRuntime,
  ids: readonly string[],
  opts: { file?: string } = {},
): void {
  const file = opts.file ?? catalogFile();
  const clean = ids.filter((id) => !isBlockedModel(id));
  if (!clean.length) return;
  writeCatalog(file, { ...readCatalog(file), [runtime]: clean });
}

/** The newest model of `family` for `runtime`: the live catalog or the floor,
 *  whichever is newer. */
export function latestModel(
  runtime: ModelRuntime,
  family: string,
  opts: { file?: string } = {},
): string {
  const floor = LATEST_FLOOR[runtime][family];
  const best = newestModel(
    [...(floor ? [floor] : []), ...(readCatalog(opts.file)[runtime] ?? [])],
    runtime,
    family,
  );
  if (!best) throw new Error(`no known ${runtime} model of family "${family}"`);
  return best;
}

/** The newer model to use instead of `model`, when `model` is older than the
 *  newest of its family; undefined for a current pin or a name not judged. */
export function outdatedModelHint(model: string, opts: { file?: string } = {}): string | undefined {
  const p = parseModelId(model);
  if (!p) return undefined;
  const floor = LATEST_FLOOR[p.runtime][p.family];
  const best = newestModel(
    [...(floor ? [floor] : []), ...(readCatalog(opts.file)[p.runtime] ?? [])],
    p.runtime,
    p.family,
  );
  const bp = best ? parseModelId(best) : null;
  return best && bp && newer(bp.version, p.version) ? best : undefined;
}

/** Re-reads each runtime's model list into the cache. A runtime whose listing
 *  fails keeps its old entry. Skipped while the cache is younger than `maxAgeMs`,
 *  and entirely (with the real listers) when MONOMIND_MODEL_REFRESH=0. */
export async function refreshLatestModels(
  opts: {
    file?: string;
    now?: () => number;
    maxAgeMs?: number;
    timeoutMs?: number;
    list?: (runtime: ModelRuntime) => Promise<string[]>;
  } = {},
): Promise<void> {
  if (process.env.MONOMIND_MODEL_REFRESH === '0' && !opts.list) return;
  const file = opts.file ?? catalogFile();
  const now = (opts.now ?? Date.now)();
  const updatedAt = Number(readRaw(file)._updatedAt);
  if (opts.maxAgeMs !== undefined && Number.isFinite(updatedAt) && now - updatedAt < opts.maxAgeMs)
    return;
  const list = opts.list ?? (async (runtime) => listIds(runtime, opts.timeoutMs ?? 8000));
  const next: Catalog = readCatalog(file);
  await Promise.all(
    RUNTIMES.map(async (runtime) => {
      try {
        const ids = (await list(runtime)).filter((id) => !isBlockedModel(id));
        if (ids.length) next[runtime] = ids;
      } catch {
        /* keep the old entry */
      }
    }),
  );
  writeCatalog(file, next, now);
}

/** The ids a runtime's model list names: each entry's id and resolved id. */
export function catalogIds(models: readonly { id: string; resolved_id?: string }[]): string[] {
  return models.flatMap((m) => [m.id, m.resolved_id].filter((x): x is string => !!x));
}

async function listIds(runtime: ModelRuntime, timeoutMs: number): Promise<string[]> {
  const { listRuntimeModels } = await import('./orgrt/agent-models.js');
  return catalogIds((await listRuntimeModels(runtime, { timeoutMs })).models);
}
