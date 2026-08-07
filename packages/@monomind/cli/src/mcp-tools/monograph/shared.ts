import { join } from 'path';
import { execSync } from 'child_process';
import { statSync } from 'fs';
import { getProjectCwd } from '../types.js';

let _cachedDbPath: string | undefined;
let _cachedCwd: string | undefined;
// P2: staleness cache for computeCommitsBehind. Keyed by repoPath, TTL 30s.
// Cuts the per-call git rev-list spawn from "every monograph_* tool call"
// down to one per 30s per repo — a 50-100ms saving on the hottest path.
const _stalenessCache = new Map<string, { ts: number; value: { commitsBehind: number; lastCommit: string } | null }>();
export function _isValidDb(p: string): boolean {
  try { return statSync(p).size >= 100; } catch { return false; }
}
/**
 * Resolve the monograph DB path for a given repo root (defaults to project cwd).
 * Falls back to searching up to the git root when the DB isn't directly under
 * `<cwd>/.monomind` — e.g. when called from a subdirectory of the repo. Only
 * the no-arg (project cwd) form is cached; explicit `repoPath` overrides are
 * cheap one-off lookups (staleness checks with a user-supplied path) so caching
 * them isn't worth the invalidation complexity.
 */
export function getDbPath(repoPathOverride?: string): string {
  const cwd = repoPathOverride ?? getProjectCwd();
  const useCache = repoPathOverride === undefined;
  // Invalidate cache when project root changes (e.g. MONOMIND_CWD set after initialize)
  if (useCache && _cachedDbPath && _cachedCwd === cwd) return _cachedDbPath;
  if (useCache) { _cachedCwd = cwd; _cachedDbPath = undefined; }

  const direct = join(cwd, '.monomind', 'monograph.db');
  if (_isValidDb(direct)) { if (useCache) _cachedDbPath = direct; return direct; }
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
    const candidate = join(root, '.monomind', 'monograph.db');
    if (_isValidDb(candidate)) {
      if (useCache) _cachedDbPath = candidate;
      return candidate;
    }
  } catch { /* not in a git repo */ }
  // Don't cache failures — the DB may be created by a subsequent build
  return direct;
}

export function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

// ── Shared PPR rerank helper (HippoRAG-style, arXiv:2405.14831) ─────────────
// Expands one hop through edges and boosts neighbor scores.
export type PprScoredNode = { id: string; name: string; label: string; filePath: string; startLine: number | null; score: number };
export function applyPprRerank(
  db: any,
  seedNodes: PprScoredNode[],
  damping: number,
  maxResults: number,
): Array<PprScoredNode & { boostedByNeighbors: boolean }> {
  const propagated = new Map<string, number>();
  for (const r of seedNodes) {
    propagated.set(r.id, r.score);
  }

  // P3: batched edge lookup — was one SELECT per seed node (N+1 over the
  // default limit*2=40 seeds). Now a single WHERE source_id IN (?, ?, …)
  // pulls every neighbor in one round-trip. SQLite parameter limit is 999,
  // well above the 40-seed default; fall back to chunking if a caller ever
  // exceeds it.
  const seedIds = seedNodes.map(r => r.id);
  const SEED_CHUNK = 500;
  const sourceToTargets = new Map<string, string[]>();
  for (let i = 0; i < seedIds.length; i += SEED_CHUNK) {
    const chunk = seedIds.slice(i, i + SEED_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT source_id, target_id FROM edges WHERE source_id IN (${placeholders})`).all(...chunk) as
      Array<{ source_id: string; target_id: string }>;
    for (const row of rows) {
      const arr = sourceToTargets.get(row.source_id) ?? [];
      arr.push(row.target_id);
      sourceToTargets.set(row.source_id, arr);
    }
  }
  for (const r of seedNodes) {
    const neighbors = sourceToTargets.get(r.id) ?? [];
    for (const n of neighbors) {
      const boost = r.score * damping;
      const current = propagated.get(n) ?? 0;
      propagated.set(n, Math.max(current, boost));
    }
  }

  const seedIdSet = new Set(seedNodes.map(r => r.id));
  const ranked: Array<PprScoredNode & { combinedScore: number; boostedByNeighbors: boolean }> = seedNodes.map(r => ({
    ...r,
    combinedScore: Math.max(r.score, propagated.get(r.id) ?? 0),
    boostedByNeighbors: false,
  }));

  // P3: batched node lookup for non-seed propagated nodes — was one SELECT
  // per propagated id (~10 per call). Single WHERE id IN (?, ?, …) instead.
  const nonSeedIds = [...propagated.keys()].filter(id => !seedIdSet.has(id));
  const nodeById = new Map<string, { id: string; name: string; label: string; file_path: string; start_line: number | null }>();
  for (let i = 0; i < nonSeedIds.length; i += SEED_CHUNK) {
    const chunk = nonSeedIds.slice(i, i + SEED_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, name, label, file_path, start_line FROM nodes WHERE id IN (${placeholders})`).all(...chunk) as
      Array<{ id: string; name: string; label: string; file_path: string; start_line: number | null }>;
    for (const row of rows) nodeById.set(row.id, row);
  }
  for (const [id, score] of propagated) {
    if (!seedIdSet.has(id)) {
      const node = nodeById.get(id);
      if (node) {
        ranked.push({
          id: node.id, name: node.name, label: node.label,
          filePath: node.file_path, startLine: node.start_line,
          score: 0, combinedScore: score, boostedByNeighbors: true,
        });
      }
    }
  }

  ranked.sort((a, b) => b.combinedScore - a.combinedScore);
  return ranked.slice(0, maxResults).map(r => ({
    id: r.id, name: r.name, label: r.label,
    filePath: r.filePath, startLine: r.startLine,
    score: r.combinedScore, boostedByNeighbors: r.boostedByNeighbors,
  }));
}

/** Guard against concurrent background buildAsync calls on the same DB. */
let _buildInProgress = false;

/**
 * Compute how many commits the index is behind HEAD.
 * Returns { commitsBehind, lastCommit } — or null if the index has never been
 * built or git is unavailable.
 */
export async function computeCommitsBehind(repoPath: string): Promise<{ commitsBehind: number; lastCommit: string } | null> {
  // P2: cache per-repoPath for 30s. computeCommitsBehind fires on every
  // monograph_query, monograph_suggest, monograph_staleness, and
  // monograph_health call (4 of the hottest tools) — each one was paying
  // ~50-100ms for `openDb + git rev-list --count + closeDb`. The result
  // changes only when the user commits, so a 30s TTL is well inside the
  // dev cycle and cuts repeated calls to a single git spawn per half-minute.
  const cached = _stalenessCache.get(repoPath);
  if (cached && Date.now() - cached.ts < 30_000) return cached.value;

  const { openDb, closeDb } = await import('@monoes/monograph');
  const { execSync } = await import('child_process');
  const dbPath = getDbPath(repoPath);
  if (!_isValidDb(dbPath)) return null;
  // openDb's fileMustExist option isn't in the currently-published
  // @monoes/monograph release this CLI depends on — _isValidDb above is the
  // real guard against openDb silently creating an empty DB at a missing path.
  const db = openDb(dbPath);
  try {
    const meta = (
      db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() as { value: string } | undefined
    ) ?? (
      db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined
    );
    const lastCommit = meta?.value ?? null;
    if (!lastCommit || !/^[0-9a-f]{7,40}$/i.test(lastCommit)) return null;
    try {
      const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
        cwd: repoPath, encoding: 'utf-8', timeout: 5_000,
      }).trim();
      const value = { commitsBehind: parseInt(out, 10), lastCommit };
      _stalenessCache.set(repoPath, { ts: Date.now(), value });
      return value;
    } catch { return null; }
  } finally { closeDb(db); }
}

/**
 * Shared staleness threshold: both monograph_staleness and monograph_suggest (checkStaleness)
 * trigger a background rebuild only when the index is more than this many commits behind HEAD.
 * Using a shared constant prevents conflicting rebuild pressure during active dev sessions.
 * Was 10 → 3 → 1. Even 3 let routine small commits accumulate stale results
 * silently. At 1 (rebuild triggers at 2+ behind), staleness rarely persists
 * across sessions.
 */
export const STALENESS_THRESHOLD = 1;

/**
 * Fire-and-forget background rebuild. Uses a module-level guard so concurrent
 * MCP tool calls (e.g. repeated monograph_suggest checkStaleness) don't pile up builds.
 * threshold: minimum commitsBehind to trigger (default STALENESS_THRESHOLD + 1).
 */
export function triggerBackgroundBuildIfNeeded(repoPath: string, commitsBehind: number, threshold = STALENESS_THRESHOLD + 1): boolean {
  if (commitsBehind < threshold) return false;
  if (_buildInProgress) return false;
  _buildInProgress = true;
  void import('@monoes/monograph')
    .then(({ buildAsync }) => buildAsync(repoPath, { codeOnly: true }))
    .catch((e) => {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[triggerBackgroundBuildIfNeeded] staleness-triggered rebuild failed:', e);
    })
    .finally(() => { _buildInProgress = false; });
  return true;
}

/**
 * BM25 ranks purely on literal keyword overlap, so a doc/concept node whose
 * prose happens to mention task-related words (e.g. a report mentioning
 * "retry" constants) can outrank the actual code symbol the task is really
 * about, which is conceptually related but lexically different (issue #38).
 * Prefer code-symbol hits (Function/Class/Method/...) over doc-type hits
 * (Document/Concept/Section/...) when there are any, falling back to the
 * full hit list so a genuinely doc-only task still gets results.
 */
export function preferSymbolHits<T extends { label: string }>(hits: T[], symbolLabels: ReadonlySet<string>): T[] {
  const symbolHits = hits.filter(h => symbolLabels.has(h.label));
  return symbolHits.length > 0 ? symbolHits : hits;
}
