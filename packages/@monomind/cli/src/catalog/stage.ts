/**
 * Staging: bring one skill, archetype or blueprint from a Git repository or a
 * local path into the content-addressed package store
 * (`.monomind/catalog/packages/<name>/<sha12>/`) and record it as `staged`
 * (clean scan) or `quarantined`. The candidate is copied first (O_NOFOLLOW)
 * and the copy is what gets inspected, hashed and stored — so a source edited
 * mid-stage cannot reach the store. A refused stage leaves no store debris.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { checkout, findSkillDirs, skillLicense, toSkillName } from '../orgrt/skill-import.js';
import { parseFrontmatter } from '../orgrt/skill-library.js';
import { BlueprintSchema } from './blueprints.js';
import { packageDigest, packagesDir } from './digest.js';
import { sanitizeFrontmatter } from './frontmatter.js';
import { type FenceLoader, inspectPackage, MAX_FILE_BYTES, SKIP_DIRS } from './scan.js';
import { CatalogStateError, HISTORY_CAP, loadCatalogState, mutateCatalogState } from './state.js';
import type { CatalogEntry, CatalogStatus } from './types.js';

export type { FenceLoader } from './scan.js';

export interface StageOptions {
  /** Self-asserted provenance, recorded in history. */
  actor: string;
  /** Candidate name when the source holds more than one. */
  only?: string;
  /** Default: `skill` when the source has a SKILL.md, else `blueprint`. */
  kind?: CatalogEntry['kind'];
  /** Scanner override (tests); default loads monofence-ai. */
  fence?: FenceLoader;
  now?: string;
}

export interface StageResult {
  entry: CatalogEntry;
  /** The stored package directory. */
  dir: string;
  /** Same digest as the recorded revision: nothing changed. */
  unchanged: boolean;
}

/** Statuses from which changed content may replace the recorded revision. */
const RESTAGEABLE: readonly CatalogStatus[] = ['staged', 'quarantined', 'disabled'];
const DISCOVERY_SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

interface Candidate {
  name: string;
  dir: string;
  declaredLicense?: string;
  /** Blueprint schema failure, raised only if this candidate is chosen. */
  invalid?: string;
}

/** Every directory holding a blueprint.json under `root`. */
export function findBlueprintDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === 'blueprint.json')) out.push(dir);
    for (const e of entries)
      if (e.isDirectory() && !DISCOVERY_SKIP.has(e.name)) walk(join(dir, e.name));
  };
  walk(root);
  return out;
}

const byDepth = (a: string, b: string): number =>
  a.split('/').length - b.split('/').length || a.localeCompare(b);

function discover(root: string, kind: CatalogEntry['kind']): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    if (seen.has(c.name)) return;
    seen.add(c.name);
    out.push(c);
  };
  if (kind === 'blueprint') {
    for (const dir of findBlueprintDirs(root).sort(byDepth)) {
      try {
        const bp = BlueprintSchema.parse(
          JSON.parse(readFileSync(join(dir, 'blueprint.json'), 'utf8')),
        );
        add({ name: bp.name, dir });
      } catch (e) {
        add({ name: toSkillName(basename(dir)), dir, invalid: (e as Error).message.slice(0, 300) });
      }
    }
    return out;
  }
  for (const dir of findSkillDirs(root).sort(byDepth)) {
    const { data } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    const name = typeof data.name === 'string' ? data.name : basename(dir);
    const license = typeof data.license === 'string' ? data.license : undefined;
    add({ name: toSkillName(name), dir, declaredLicense: license });
  }
  return out;
}

function choose(root: string, opts: StageOptions): { kind: CatalogEntry['kind']; c: Candidate } {
  const kind = opts.kind ?? (findSkillDirs(root).length ? 'skill' : 'blueprint');
  const all = discover(root, kind);
  const picked = opts.only ? all.filter((c) => c.name === opts.only) : all;
  if (picked.length === 0)
    throw new CatalogStateError(
      opts.only
        ? `no ${kind} named "${opts.only}" in the source`
        : `no ${kind} found in the source`,
    );
  if (picked.length > 1)
    throw new CatalogStateError(
      `${picked.length} candidates (${picked.map((c) => c.name).join(', ')}); pass --only <name>`,
    );
  const c = picked[0];
  if (c.invalid) throw new CatalogStateError(`invalid blueprint.json in ${c.dir}: ${c.invalid}`);
  return { kind, c };
}

function copyNoFollow(from: string, to: string): void {
  const fd = openSync(from, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`not a regular file: ${from}`);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(fd));
  } finally {
    closeSync(fd);
  }
}

/** Copy regular files of `src` into `dest`; symlinks, excluded dirs and oversize files are rejected. */
function copyCandidate(src: string, dest: string, skip: string | undefined) {
  const rejected: { path: string; reason: string }[] = [];
  const walk = (prefix: string): void => {
    for (const name of readdirSync(join(src, prefix)).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const from = join(src, rel);
      if (from === skip) continue;
      const st = lstatSync(from);
      if (st.isSymbolicLink()) rejected.push({ path: rel, reason: 'symlink' });
      else if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) rejected.push({ path: rel, reason: 'excluded directory' });
        else walk(rel);
      } else if (!st.isFile()) rejected.push({ path: rel, reason: 'not a regular file' });
      else if (st.size > MAX_FILE_BYTES)
        rejected.push({ path: rel, reason: `larger than ${MAX_FILE_BYTES / 1024} KiB` });
      else copyNoFollow(from, join(dest, rel));
    }
  };
  walk('');
  return rejected;
}

function pruneEmptyDirs(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    pruneEmptyDirs(sub);
    if (readdirSync(sub).length === 0) rmdirSync(sub);
  }
}

function sourceOf(
  src: string,
  co: { root: string; source: string; commit?: string },
  dir: string,
  license: 'MIT' | 'Apache-2.0',
): CatalogEntry['source'] {
  const inSource = relative(co.root, dir) || '.';
  const commit = co.commit && /^[0-9a-f]{40}$/.test(co.commit) ? co.commit : undefined;
  if (!existsSync(src)) {
    if (!commit) throw new CatalogStateError(`no commit recorded for ${co.source}`);
    return { kind: 'git', url: co.source, commit, path: inSource, license };
  }
  return {
    kind: 'local',
    path: realpathSync(co.root),
    ...(commit ? { commit } : {}),
    path_in_source: inSource,
    license,
  };
}

/** Rewrites SKILL.md frontmatter to the allow-list in place; one reject record per dropped key. */
function sanitizeSkillMd(dir: string): { path: string; reason: string }[] {
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return [];
  const before = readFileSync(file, 'utf8');
  const { text, removed } = sanitizeFrontmatter(before);
  if (text !== before) writeFileSync(file, text);
  return removed.map((key) => ({
    path: `SKILL.md (frontmatter ${key})`,
    reason: 'frontmatter key not allowed; removed',
  }));
}

/** Stage one candidate from `src` (owner/repo, git URL or local path). */
export async function stage(root: string, src: string, opts: StageOptions): Promise<StageResult> {
  const now = opts.now ?? new Date().toISOString();
  // Never echo the URL: it would print the credential it carries.
  if (!existsSync(src) && /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(src))
    throw new CatalogStateError(
      'refusing a source URL with embedded credentials (user[:token]@); use a git credential helper',
    );
  const co = checkout(src);
  const store = packagesDir(root);
  const storeExisted = existsSync(store);
  let temp: string | undefined;
  try {
    const { kind, c } = choose(co.root, opts);
    const id = `${kind}:${c.name}`;
    const verdict = skillLicense(c.dir, co.root, c.declaredLicense);
    if (!verdict.license) throw new CatalogStateError(`license: ${verdict.found}`);
    const license = verdict.license;
    const source = sourceOf(src, co, c.dir, license);
    // Read-only preflight; repeated under the lock below.
    const prior = loadCatalogState(root).entries.find((e) => e.id === id);
    if (prior?.status === 'revoked') throw new CatalogStateError(`${id} is revoked`);

    mkdirSync(join(store, '.incoming'), { recursive: true });
    temp = mkdtempSync(join(store, '.incoming', `${c.name}-`));
    const copyRejects = copyCandidate(c.dir, temp, verdict.file);
    if (verdict.file) copyNoFollow(verdict.file, join(temp, 'LICENSE.txt'));
    // Before inspection and hashing: platforms execute frontmatter config.
    if (kind !== 'blueprint') copyRejects.push(...sanitizeSkillMd(temp));
    const insp = await inspectPackage(temp, kind, { root, fence: opts.fence });
    if (insp.fatal) throw new CatalogStateError(`refused ${id}: ${insp.fatal}`);
    for (const r of insp.rejected) rmSync(join(temp, r.path), { recursive: true, force: true });
    pruneEmptyDirs(temp);
    const sha256 = packageDigest(temp);
    if (prior && prior.sha256 !== sha256 && !RESTAGEABLE.includes(prior.status))
      throw new CatalogStateError(`entry is ${prior.status}; disable it first`);

    const dir = join(store, c.name, sha256.slice(0, 12));
    let created = false;
    if (existsSync(dir)) {
      if (packageDigest(dir) !== sha256)
        throw new CatalogStateError(`stored package ${dir} does not match its digest`);
    } else {
      mkdirSync(dirname(dir), { recursive: true });
      renameSync(temp, dir);
      temp = undefined;
      created = true;
    }

    const inspection: CatalogEntry['inspection'] = {
      verdict: insp.verdict,
      accepted: insp.accepted,
      rejected: [...copyRejects, ...insp.rejected].sort((a, b) => (a.path < b.path ? -1 : 1)),
      requestedTools: insp.requestedTools,
      scanner: insp.scanner,
      at: now,
    };
    const status: CatalogStatus = insp.verdict === 'clean' ? 'staged' : 'quarantined';
    let entry: CatalogEntry | undefined;
    let unchanged = false;
    try {
      mutateCatalogState(root, (state) => {
        const cur = state.entries.find((e) => e.id === id);
        if (cur?.status === 'revoked') throw new CatalogStateError(`${id} is revoked`);
        if (cur && cur.sha256 === sha256) {
          unchanged = true;
          entry = cur;
          return state;
        }
        if (cur && !RESTAGEABLE.includes(cur.status))
          throw new CatalogStateError(`entry is ${cur.status}; disable it first`);
        const next: CatalogEntry = cur
          ? {
              ...cur,
              sha256,
              source,
              inspection,
              status,
              targets: [],
              grantedTools: [],
              replacesLegacy: false,
              updatedAt: now,
              history: [
                ...cur.history,
                { from: cur.status, to: status, actor: opts.actor, at: now, reason: 'restaged' },
              ].slice(-HISTORY_CAP),
            }
          : {
              id,
              kind,
              status,
              sha256,
              source,
              inspection,
              targets: [],
              grantedTools: [],
              replacesLegacy: false,
              createdAt: now,
              updatedAt: now,
              history: [{ from: null, to: status, actor: opts.actor, at: now }],
            };
        entry = next;
        return {
          ...state,
          entries: cur
            ? state.entries.map((e) => (e.id === id ? next : e))
            : [...state.entries, next],
        };
      });
    } catch (e) {
      if (created) {
        rmSync(dir, { recursive: true, force: true });
        rmdirIfEmpty(dirname(dir));
      }
      throw e;
    }
    return { entry: entry as CatalogEntry, dir, unchanged };
  } finally {
    co.cleanup();
    if (temp) rmSync(temp, { recursive: true, force: true });
    rmdirIfEmpty(join(store, '.incoming'));
    if (!storeExisted) {
      rmdirIfEmpty(store);
      rmdirIfEmpty(dirname(store));
    }
  }
}

function rmdirIfEmpty(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    // not empty (still in use) or absent
  }
}
