/**
 * Ownership-checked plan for `monomind cleanup`.
 *
 * Incident 2026-09-22: `cleanup --force` deleted a fixed list of paths
 * (.agents/, .gemini/, AGENTS.md, data/, ...) wholesale. Run in a real
 * repository it removed ~1000 git-tracked files and the project's memory
 * store. The plan below removes a path only when monomind demonstrably owns
 * it, and the same plan drives both the preview and `--force`, so the preview
 * is exactly what `--force` will do.
 *
 * Rules, in order:
 *  1. A git-tracked file, or a directory holding one, is never deleted or
 *     rewritten. Its untracked monomind-owned children may still be removed.
 *  2. User data (memory stores, org memory, knowledge index, monograph and
 *     other databases, org configs, backups) is kept unless `--purge-data`.
 *  3. Whole-path removal needs proof of ownership: a monomind-only namespace
 *     (.monomind/, monomind.config.json, legacy .swarm/.hive-mind), an entry
 *     listed in init's manifest, a file whose content still matches the hash
 *     init recorded for it, a file named `monomind*` inside a provider dir, or
 *     a file whose content is nothing but monomind marker blocks.
 *  4. A file that mixes monomind marker blocks (or a `monomind` JSON entry)
 *     with other content only loses the monomind part.
 *  5. Anything else is kept and reported with the reason.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readInitManifest } from '../init/init-manifest.js';
import { safeJsonRemove } from '../platform-adapters/merge.js';

export type CleanupAction = 'remove' | 'strip' | 'skip';

export interface CleanupPlanEntry {
  /** Path relative to the project root, `/`-separated. */
  path: string;
  kind: 'dir' | 'file';
  action: CleanupAction;
  reason: string;
  size: number;
  /** True for user data that only `--purge-data` removes. */
  data?: boolean;
  /** New file content for `strip`. */
  content?: string;
}

export interface CleanupPlanOptions {
  keepConfig: boolean;
  purgeData: boolean;
  /** MONOMIND_MEMORY_PATH, if set. */
  memoryPath?: string;
}

export type CleanupPlanResult =
  | { ok: true; entries: CleanupPlanEntry[] }
  | { ok: false; error: string };

/** Directories whose every untracked, non-data entry is monomind's own state. */
const NAMESPACE_DIRS = ['.monomind', '.swarm', '.hive-mind'];
/** Agent-tool directories shared with the user and other tools. */
const SHARED_DIRS = ['.claude', '.agents', '.gemini', '.opencode', '.codex', '.kimi-code'];
/** Root instruction files that may carry a monomind marker block. */
const MARKED_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];
/** Root JSON files where monomind registers one named entry. */
const JSON_ENTRY_FILES: { path: string; entry: string[] }[] = [
  { path: '.mcp.json', entry: ['mcpServers', 'monomind'] },
  { path: 'opencode.json', entry: ['mcp', 'monomind'] },
];
/** Data paths (relative to the project root), kept unless --purge-data. */
const DATA_PATHS = [
  'data/memory',
  'data/memory.db',
  'data/memory.db-wal',
  'data/memory.db-shm',
  'data/memory.graph',
  'memory',
  '.monomind/data',
  '.monomind/org-memory',
  '.monomind/knowledge',
  '.monomind/orgs',
  '.monomind/org-skills',
  '.monomind/backups',
  '.monomind/episodic',
  '.monomind/neural',
  '.monomind/capture',
  '.monomind/graph',
  '.monomind/.monograph',
];
/** Any database file is treated as data wherever it sits. */
const DATA_FILE_RE = /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/;
/** Generator title init writes as GEMINI.md's first line. */
const GEMINI_SIGNATURE_RE = /^# Monomind for Antigravity \(agy\) — v\S+\n/;
const MAX_MARKER_SCAN_BYTES = 2 * 1024 * 1024;

const NAMED_BLOCK_RE =
  /^[\t ]*(?:(?:#|\/\/)\s*|<!--\s*)?monomind:start\s+(\S+)\s*(?:-->)?[^\S\r\n]*(?:\r?\n|$)[\s\S]*?^[\t ]*(?:(?:#|\/\/)\s*|<!--\s*)?monomind:end\s+\1\s*(?:-->)?[^\S\r\n]*(?:\r?\n|$)/gm;
const TAGGED_BLOCK_RE =
  /^<!-- monomind-block:(\S+) -->\r?\n[\s\S]*?^<!-- \/monomind-block:\1 -->(?:\r?\n|$)/gm;
const BARE_HTML_BLOCK_RE = /<!--\s*monomind:start\s*-->[\s\S]*?<!--\s*monomind:end\s*-->\r?\n?/g;

/** Remove every monomind marker block. Returns null when there was none. */
export function stripMonomindBlocks(text: string): string | null {
  let count = 0;
  const count1 = (): string => {
    count++;
    return '';
  };
  const out = text
    .replace(TAGGED_BLOCK_RE, count1)
    .replace(NAMED_BLOCK_RE, count1)
    .replace(BARE_HTML_BLOCK_RE, count1);
  if (count === 0) return null;
  return `${out.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Cheap, reliable signal that `cwd` is monomind's own source checkout. */
export function isMonomindSourceRepo(cwd: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { name?: unknown };
    return pkg.name === 'monomind' && existsSync(join(cwd, 'packages', '@monomind', 'cli'));
  } catch {
    return false;
  }
}

interface Tracked {
  files: Set<string>;
  dirs: Set<string>;
}

/**
 * Tracked paths under `cwd`, relative to it. An empty set outside a git repo;
 * an error string when a repo is present but cannot be read (fail closed).
 */
function readTracked(cwd: string): Tracked | string {
  const files = new Set<string>();
  const dirs = new Set<string>();
  let out: string;
  try {
    out = execFileSync('git', ['-C', cwd, 'ls-files', '-z', '--cached'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '');
    if (/not a git repository/i.test(stderr)) return { files, dirs };
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) {
        return `cannot list git-tracked files (${(err as Error).message.split('\n')[0]}); refusing to delete anything`;
      }
      if (dirname(dir) === dir) break;
    }
    return { files, dirs };
  }
  for (const f of out.split('\0')) {
    if (!f) continue;
    files.add(f);
    for (let d = f; d.includes('/'); ) {
      d = d.slice(0, d.lastIndexOf('/'));
      if (dirs.has(d)) break;
      dirs.add(d);
    }
  }
  return { files, dirs };
}

function sizeOf(abs: string, depth = 0): number {
  if (depth > 20) return 0;
  try {
    const st = lstatSync(abs);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const name of readdirSync(abs)) total += sizeOf(join(abs, name), depth + 1);
    return total;
  } catch {
    return 0;
  }
}

class Planner {
  readonly entries: CleanupPlanEntry[] = [];
  private readonly dataPaths: Set<string>;
  private readonly owned: Set<string>;
  /** sha256 of each file init installed, keyed by project-relative path. */
  private readonly installed: Record<string, string>;

  constructor(
    private readonly cwd: string,
    private readonly tracked: Tracked,
    private readonly opts: CleanupPlanOptions,
  ) {
    this.dataPaths = new Set(DATA_PATHS);
    if (opts.memoryPath) {
      const abs = resolve(cwd, opts.memoryPath);
      const rel = relative(cwd, abs);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel))
        this.dataPaths.add(rel.split(sep).join('/'));
    }
    const m = readInitManifest(cwd);
    this.owned = new Set([
      ...(m?.skills ?? []).map((n) => `.claude/skills/${n}`),
      ...(m?.commands ?? []).map((n) => `.claude/commands/${n}`),
      ...(m?.agents ?? []).map((n) => `.claude/agents/${n}`),
      ...(m?.kimiSkills ?? []).map((n) => `.kimi-code/skills/${n}`),
      ...(m?.kimiPluginCommands ?? []).map((n) => `.kimi-code/plugin/commands/${n}`),
      ...(m?.opencodeSkills ?? []).map((n) => `.opencode/skills/${n}`),
    ]);
    this.installed = m?.files ?? {};
  }

  /** A regular file init installed and nobody edited since. */
  private isUneditedInstall(rel: string): boolean {
    const recorded = this.installed[rel];
    try {
      if (!recorded || !lstatSync(this.abs(rel)).isFile()) return false;
      return (
        createHash('sha256')
          .update(readFileSync(this.abs(rel)))
          .digest('hex') === recorded
      );
    } catch {
      return false;
    }
  }

  private abs(rel: string): string {
    return join(this.cwd, ...rel.split('/'));
  }

  private isData(rel: string): boolean {
    return this.dataPaths.has(rel) || DATA_FILE_RE.test(rel);
  }

  private hasTracked(rel: string): boolean {
    return this.tracked.files.has(rel) || this.tracked.dirs.has(rel);
  }

  private add(
    rel: string,
    kind: 'dir' | 'file',
    action: CleanupAction,
    reason: string,
    extra?: Partial<CleanupPlanEntry>,
  ): void {
    this.entries.push({ path: rel, kind, action, reason, size: sizeOf(this.abs(rel)), ...extra });
  }

  private kindOf(rel: string): 'dir' | 'file' | null {
    try {
      const st = lstatSync(this.abs(rel));
      return st.isDirectory() ? 'dir' : 'file';
    } catch {
      return null;
    }
  }

  /** Protected data paths outside the directories walked below (data/, memory/, MONOMIND_MEMORY_PATH). */
  planData(): void {
    for (const rel of [...this.dataPaths].sort()) {
      const top = rel.split('/')[0]!;
      if (NAMESPACE_DIRS.includes(top) || SHARED_DIRS.includes(top)) continue; // walked
      const kind = this.kindOf(rel);
      if (kind) this.dataEntry(rel, kind);
    }
  }

  private dataEntry(rel: string, kind: 'dir' | 'file'): void {
    if (this.hasTracked(rel)) this.add(rel, kind, 'skip', 'tracked by git', { data: true });
    else if (this.opts.purgeData)
      this.add(rel, kind, 'remove', 'user data (--purge-data)', { data: true });
    else this.add(rel, kind, 'skip', 'user data — kept unless --purge-data', { data: true });
  }

  /**
   * Walk a directory. `ownsUnmarked` says whether an untracked entry with no
   * other evidence is ours (namespace dirs) or not (shared provider dirs).
   * Returns true when every entry below was planned for removal, so the
   * caller can collapse them into one removal of this directory.
   */
  walk(rel: string, ownsUnmarked: boolean): boolean {
    const kind = this.kindOf(rel);
    if (!kind) return true;
    if (this.isData(rel)) {
      this.dataEntry(rel, kind);
      return this.opts.purgeData && !this.hasTracked(rel);
    }
    if (this.tracked.files.has(rel)) {
      this.add(rel, kind, 'skip', 'tracked by git');
      return false;
    }
    const listed = this.owned.has(rel) || (kind === 'file' && this.isUneditedInstall(rel));
    const owned = listed || (ownsUnmarked && kind === 'file');
    if (kind === 'file' || lstatSync(this.abs(rel)).isSymbolicLink()) {
      if (owned || /^monomind/i.test(rel.slice(rel.lastIndexOf('/') + 1))) {
        this.add(rel, kind, 'remove', listed ? 'listed in init manifest' : 'monomind-owned');
        return true;
      }
      return this.planMarkedFile(rel);
    }
    if (
      !this.tracked.dirs.has(rel) &&
      (this.owned.has(rel) || ownsUnmarked) &&
      !this.containsData(rel)
    ) {
      this.add(
        rel,
        'dir',
        'remove',
        this.owned.has(rel) ? 'listed in init manifest' : 'monomind-owned',
      );
      return true;
    }
    const start = this.entries.length;
    let all = true;
    for (const name of readdirSync(this.abs(rel)).sort()) {
      if (!this.walk(`${rel}/${name}`, ownsUnmarked || this.owned.has(rel))) all = false;
    }
    if (all && !this.tracked.dirs.has(rel)) {
      // Every child is ours: remove the directory as one unit instead.
      this.entries.splice(start);
      this.add(rel, 'dir', 'remove', 'contains only monomind-owned content');
      return true;
    }
    return false;
  }

  private containsData(rel: string, depth = 0): boolean {
    if (this.isData(rel)) return true;
    if (depth > 20 || this.kindOf(rel) !== 'dir') return false;
    try {
      return readdirSync(this.abs(rel)).some((n) => this.containsData(`${rel}/${n}`, depth + 1));
    } catch {
      return true; // unreadable: assume it may hold data
    }
  }

  /** A file carrying monomind marker blocks: strip them, delete only if nothing else remains. */
  planMarkedFile(rel: string): boolean {
    if (this.tracked.files.has(rel)) {
      this.add(rel, 'file', 'skip', 'tracked by git');
      return false;
    }
    let text: string;
    try {
      const st = lstatSync(this.abs(rel));
      // Never read or rewrite through a symlink: the target may be outside the project.
      if (st.isSymbolicLink() || st.size > MAX_MARKER_SCAN_BYTES) throw new Error('not scanned');
      text = readFileSync(this.abs(rel), 'utf8');
    } catch {
      this.add(rel, 'file', 'skip', 'no monomind ownership evidence');
      return false;
    }
    if (
      rel === 'GEMINI.md' &&
      GEMINI_SIGNATURE_RE.test(text) &&
      stripMonomindBlocks(text) === null
    ) {
      this.add(rel, 'file', 'remove', 'generated by monomind init (signature line)');
      return true;
    }
    const stripped = stripMonomindBlocks(text);
    if (stripped === null) {
      this.add(rel, 'file', 'skip', 'no monomind ownership evidence');
      return false;
    }
    if (stripped.trim() === '') {
      this.add(rel, 'file', 'remove', 'contains only monomind blocks');
      return true;
    }
    this.add(rel, 'file', 'strip', 'remove monomind block, keep the rest', { content: stripped });
    return false;
  }

  planJsonEntry(rel: string, entryPath: string[]): void {
    if (this.kindOf(rel) !== 'file') return;
    if (this.tracked.files.has(rel)) {
      this.add(rel, 'file', 'skip', 'tracked by git');
      return;
    }
    const text = readFileSync(this.abs(rel), 'utf8');
    const res = safeJsonRemove(text, entryPath.slice(0, -1), entryPath[entryPath.length - 1]!);
    if (res.diagnostics.length > 0) {
      this.add(rel, 'file', 'skip', 'unparseable JSON — left alone');
      return;
    }
    if (res.content === text) {
      this.add(rel, 'file', 'skip', 'no monomind entry');
      return;
    }
    const rest = JSON.parse(res.content) as Record<string, unknown>;
    const parent = rest[entryPath[0]!];
    const empty =
      Object.keys(rest).length === 1 &&
      !!parent &&
      typeof parent === 'object' &&
      Object.keys(parent).length === 0;
    if (empty) this.add(rel, 'file', 'remove', 'contains only the monomind entry');
    else
      this.add(rel, 'file', 'strip', 'remove the monomind entry, keep the rest', {
        content: res.content,
      });
  }

  planConfigFile(rel: string): void {
    if (this.kindOf(rel) !== 'file') return;
    if (this.tracked.files.has(rel)) this.add(rel, 'file', 'skip', 'tracked by git');
    else if (this.opts.keepConfig) this.add(rel, 'file', 'skip', 'preserved (--keep-config)');
    else this.add(rel, 'file', 'remove', 'monomind-owned');
  }
}

export function buildCleanupPlan(cwd: string, opts: CleanupPlanOptions): CleanupPlanResult {
  const tracked = readTracked(cwd);
  if (typeof tracked === 'string') return { ok: false, error: tracked };
  const p = new Planner(cwd, tracked, opts);
  for (const d of NAMESPACE_DIRS) p.walk(d, true);
  for (const d of SHARED_DIRS) p.walk(d, false);
  p.planConfigFile('monomind.config.json');
  for (const f of MARKED_FILES) if (existsSync(join(cwd, f))) p.planMarkedFile(f);
  for (const { path, entry } of JSON_ENTRY_FILES) p.planJsonEntry(path, entry);
  p.planData();
  return { ok: true, entries: p.entries };
}

/** Apply one `remove`/`strip` entry; `skip` is a no-op. Throws on failure. */
export function applyCleanupEntry(cwd: string, e: CleanupPlanEntry): void {
  const abs = join(cwd, ...e.path.split('/'));
  if (e.action === 'remove') rmSync(abs, { recursive: e.kind === 'dir', force: true });
  else if (e.action === 'strip' && e.content !== undefined) writeFileSync(abs, e.content);
}
