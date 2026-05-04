import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const CHURN_CACHE_VERSION = 3;
const MAX_CHURN_CACHE_BYTES = 64 * 1024 * 1024;

export interface CachedCommitEvent {
  timestamp: number;
  linesAdded: number;
  linesDeleted: number;
  authorIdx: number | null;
}

export interface CachedFileChurn {
  path: string;
  events: CachedCommitEvent[];
}

export interface ChurnCache {
  version: number;
  lastIndexedSha: string;
  gitAfter: string;
  files: CachedFileChurn[];
  shallowClone: boolean;
  authorPool: string[];
}

export interface CachedChurnResult {
  files: Map<string, { commits: number; linesAdded: number; linesDeleted: number; weightedCommits: number }>;
  shallowClone: boolean;
  authorPool: string[];
  cacheHit: boolean;
}

function loadChurnCache(cacheDir: string, gitAfter: string): ChurnCache | null {
  const file = join(cacheDir, 'churn.json');
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    if (raw.length > MAX_CHURN_CACHE_BYTES) return null;
    const cache: ChurnCache = JSON.parse(raw);
    if (cache.version !== CHURN_CACHE_VERSION) return null;
    if (cache.gitAfter !== gitAfter) return null;
    return cache;
  } catch { return null; }
}

function saveChurnCache(cacheDir: string, sha: string, gitAfter: string, cache: ChurnCache): void {
  mkdirSync(cacheDir, { recursive: true });
  const tmp = join(cacheDir, 'churn.json.tmp');
  writeFileSync(tmp, JSON.stringify({ ...cache, version: CHURN_CACHE_VERSION, lastIndexedSha: sha, gitAfter }));
  renameSync(tmp, join(cacheDir, 'churn.json'));
}

function getHeadSha(root: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function runGitLog(root: string, gitAfter: string, range: string | null): ChurnCache | null {
  try {
    const rangeArg = range ? [range] : [];
    const stdout = execSync(
      ['git', 'log', ...rangeArg, '--numstat', '--no-merges', '--no-renames',
       '--use-mailmap', '--format=format:%at|%ae', `--after=${gitAfter}`].join(' '),
      { cwd: root, maxBuffer: 256 * 1024 * 1024 }
    ).toString();
    return parseGitLog(stdout);
  } catch { return null; }
}

function parseGitLog(stdout: string): ChurnCache {
  const files: Map<string, CachedCommitEvent[]> = new Map();
  const authorPool: string[] = [];
  const authorIndex: Map<string, number> = new Map();
  let currentTs = Math.floor(Date.now() / 1000);
  let currentAuthorIdx: number | null = null;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const headerMatch = line.match(/^(\d+)\|(.+)$/);
    if (headerMatch) {
      currentTs = parseInt(headerMatch[1], 10);
      const email = headerMatch[2];
      if (!authorIndex.has(email)) { authorIndex.set(email, authorPool.length); authorPool.push(email); }
      currentAuthorIdx = authorIndex.get(email)!;
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10);
    const deleted = parseInt(parts[1], 10);
    if (isNaN(added) || isNaN(deleted)) continue;
    const path = parts[2];
    if (!files.has(path)) files.set(path, []);
    files.get(path)!.push({ timestamp: currentTs, linesAdded: added, linesDeleted: deleted, authorIdx: currentAuthorIdx });
  }

  return { version: CHURN_CACHE_VERSION, lastIndexedSha: '', gitAfter: '', shallowClone: false, authorPool, files: Array.from(files.entries()).map(([path, events]) => ({ path, events })) };
}

function mergeChurnCaches(base: ChurnCache, delta: ChurnCache): ChurnCache {
  const authorMap = new Map<number, number>();
  const baseIndex = new Map(base.authorPool.map((e, i) => [e, i]));
  for (let i = 0; i < delta.authorPool.length; i++) {
    const email = delta.authorPool[i];
    if (!baseIndex.has(email)) { baseIndex.set(email, base.authorPool.length); base.authorPool.push(email); }
    authorMap.set(i, baseIndex.get(email)!);
  }
  const fileMap = new Map(base.files.map(f => [f.path, f]));
  for (const df of delta.files) {
    const remapped = df.events.map(e => ({ ...e, authorIdx: e.authorIdx !== null ? (authorMap.get(e.authorIdx) ?? null) : null }));
    if (fileMap.has(df.path)) fileMap.get(df.path)!.events.push(...remapped);
    else fileMap.set(df.path, { path: df.path, events: remapped });
  }
  return { ...base, files: Array.from(fileMap.values()) };
}

function buildChurnResult(cache: ChurnCache): Omit<CachedChurnResult, 'cacheHit'> {
  const HALF_LIFE_DAYS = 90;
  const SECS_PER_DAY = 86400;
  const now = Math.floor(Date.now() / 1000);
  const files = new Map<string, { commits: number; linesAdded: number; linesDeleted: number; weightedCommits: number }>();
  for (const { path, events } of cache.files) {
    let commits = 0, linesAdded = 0, linesDeleted = 0, weightedCommits = 0;
    for (const e of events) {
      const ageDays = (now - e.timestamp) / SECS_PER_DAY;
      weightedCommits += Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      commits++; linesAdded += e.linesAdded; linesDeleted += e.linesDeleted;
    }
    files.set(path, { commits, linesAdded, linesDeleted, weightedCommits: Math.round(weightedCommits * 100) / 100 });
  }
  return { files, shallowClone: cache.shallowClone, authorPool: cache.authorPool };
}

export function analyzeChurnCached(root: string, gitAfter: string, cacheDir: string, noCache = false): CachedChurnResult | null {
  const headSha = getHeadSha(root);
  if (!headSha) return null;
  if (!noCache) {
    const cached = loadChurnCache(cacheDir, gitAfter);
    if (cached) {
      if (cached.lastIndexedSha === headSha) return { ...buildChurnResult(cached), cacheHit: true };
      if (isAncestor(root, cached.lastIndexedSha, headSha)) {
        const delta = runGitLog(root, gitAfter, `${cached.lastIndexedSha}..HEAD`);
        if (delta) {
          const merged = mergeChurnCaches(cached, delta);
          saveChurnCache(cacheDir, headSha, gitAfter, merged);
          return { ...buildChurnResult(merged), cacheHit: true };
        }
      }
    }
  }
  const fresh = runGitLog(root, gitAfter, null);
  if (!fresh) return null;
  if (!noCache) saveChurnCache(cacheDir, headSha, gitAfter, fresh);
  return { ...buildChurnResult(fresh), cacheHit: false };
}
