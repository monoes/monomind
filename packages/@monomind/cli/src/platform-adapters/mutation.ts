/** Locking, backup and atomic-write primitives shared by platform mutations. */

import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { removeManagedMarker } from './merge.js';
import { resolveArtifactLocation } from './operations.js';
import type { InstallRequest, PlatformAdapter } from './types.js';

export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

export function backup(path: string, root: string, privateBackup = false): void {
  if (!existsSync(path)) return;
  const backupRoot = join(root, '.monomind', 'backups', `${Date.now()}-${process.pid}`);
  mkdirSync(backupRoot, { recursive: true, mode: privateBackup ? 0o700 : undefined });
  // mkdir's mode is subject to umask and does not change an existing path. A
  // user-scope backup can contain credentials from a platform config, so its
  // leaf directory must be private regardless of the caller's umask.
  if (privateBackup) chmodSync(backupRoot, 0o700);
  // Mirror the path below `root` so several files of one apply cannot collide;
  // the first copy in a backup directory is the pre-apply content, so a later
  // backup (of the same file, or of a directory holding it) never overwrites it.
  const rel = relative(root, path);
  const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  // Outside `root`: mirror the absolute path, each segment percent-encoded
  // (a drive `C:` included), so two different paths never share a name.
  const external = join(
    '_external',
    ...resolve(path).split(sep).filter(Boolean).map(encodeURIComponent),
  );
  const destination = join(backupRoot, inside ? rel : external);
  mkdirSync(dirname(destination), { recursive: true });
  if (statSync(path).isDirectory()) cpSync(path, destination, { recursive: true, force: false });
  else if (!existsSync(destination)) writeFileSync(destination, readFileSync(path));
}

export function scopeStateRoot(request: Pick<InstallRequest, 'scope' | 'path'>): string {
  return request.scope === 'project'
    ? resolve(request.path ?? process.cwd(), '.monomind')
    : join(homedir(), '.monomind');
}

/**
 * Locks are deliberately scope-local. A stale lock remains visible and fails
 * safe; it is never removed by a later invocation that cannot prove ownership.
 */
export function withScopeLock<T>(
  request: Pick<InstallRequest, 'scope' | 'path'>,
  action: () => T,
): T {
  const privateLock = request.scope === 'user';
  const lockPath = join(scopeStateRoot(request), 'locks', 'platforms.lock');
  mkdirSync(dirname(lockPath), { recursive: true, mode: privateLock ? 0o700 : undefined });
  if (privateLock) chmodSync(dirname(lockPath), 0o700);
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx', privateLock ? 0o600 : undefined);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error(
        `Platform mutation lock already exists: ${lockPath}. ` +
          'Inspect its PID and start time, then remove it manually only after verifying the owner is gone.',
      );
    }
    throw error;
  }
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), scope: request.scope })}\n`,
      'utf8',
    );
    return action();
  } finally {
    closeSync(fd);
    unlinkSync(lockPath);
  }
}

/** A dry run is read-only, including Monomind's own lock and state roots. */
export function withMutationLock<T>(
  request: Pick<InstallRequest, 'scope' | 'path' | 'dryRun'>,
  action: () => T,
): T {
  return request.dryRun ? action() : withScopeLock(request, action);
}

function surfaceLedgerPath(request: Pick<InstallRequest, 'scope' | 'path'>): string {
  return join(scopeStateRoot(request), 'platforms', 'shared-skills.json');
}

function readSurfaceLedger(
  request: Pick<InstallRequest, 'scope' | 'path'>,
): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(surfaceLedgerPath(request), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

function writeSurfaceOwners(
  request: Pick<InstallRequest, 'scope' | 'path' | 'dryRun'>,
  surface: string,
  owners: readonly string[],
): void {
  const ledger = readSurfaceLedger(request);
  const next = [...new Set(owners)].sort();
  if (request.dryRun || JSON.stringify(ledger[surface] ?? []) === JSON.stringify(next)) return;
  if (next.length) ledger[surface] = next;
  else delete ledger[surface];
  atomicWrite(surfaceLedgerPath(request), `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Platforms that installed into a shared skill surface. The co-owned block no
 * longer names them, so uninstalling one needs this to know whether another
 * still depends on the block. Unlocked: callers hold the mutation lock.
 */
function surfaceOwners(request: Pick<InstallRequest, 'scope' | 'path'>, surface: string): string[] {
  const owners = readSurfaceLedger(request)[surface];
  return Array.isArray(owners) ? owners.filter((owner) => typeof owner === 'string') : [];
}

export function addSurfaceOwners(
  request: Pick<InstallRequest, 'scope' | 'path' | 'dryRun'>,
  surface: string,
  owners: readonly string[],
): void {
  writeSurfaceOwners(request, surface, [...surfaceOwners(request, surface), ...owners]);
}

/** Forgets `platform` as an owner and returns the platforms still installed there. */
export function dropSurfaceOwner(
  request: Pick<InstallRequest, 'scope' | 'path' | 'dryRun'>,
  surface: string,
  platform: string,
): string[] {
  const rest = surfaceOwners(request, surface).filter((owner) => owner !== platform);
  writeSurfaceOwners(request, surface, rest);
  return rest;
}

/**
 * The first symbolic link on the way from `base` down to `target` (exclusive of
 * `base`), or `target` itself when it lies outside `base`. Resolved locations
 * are lexical only, so this is what stops a planted `<skills>/<name> → /elsewhere`
 * link from redirecting a write or a removal.
 */
export function symlinkedComponent(base: string, target: string): string | undefined {
  const rel = relative(base, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return target;
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    const st = lstatSync(current, { throwIfNoEntry: false });
    if (!st) return undefined;
    if (st.isSymbolicLink()) return current;
  }
  return undefined;
}

export interface RemovalResult {
  changed: string[];
  skipped: string[];
  diagnostics: string[];
}

/** Every regular file below `dir`; undefined when anything inside is a link. */
function packageFiles(dir: string, prefix = ''): string[] | undefined {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isSymbolicLink()) return undefined;
    if (entry.isDirectory()) {
      const nested = packageFiles(dir, rel);
      if (!nested) return undefined;
      out.push(...nested);
    } else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function removeEmptyDirs(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name));
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

/**
 * Removes one managed skill package directory below the adapter's skill root.
 * Unlocked: callers hold the mutation lock. Only `marker` blocks are stripped;
 * a file left with nothing but frontmatter or whitespace is deleted, a file
 * without the marker is never touched, and directories go only when empty.
 * Files listed in `keep` (relative to the package) are left alone, so a new
 * revision can shed only the files its predecessor projected.
 */
export function removeManagedSkillPackage(
  adapter: PlatformAdapter,
  request: InstallRequest,
  relativeDir: string,
  marker: string,
  keep: readonly string[] = [],
): RemovalResult {
  const result: RemovalResult = { changed: [], skipped: [], diagnostics: [] };
  const location = resolveArtifactLocation(adapter, 'skill', request.scope, {
    root: request.path,
    discovery: request.discovery,
  });
  if (!location) {
    result.diagnostics.push(`No declared skill location for ${adapter.id}`);
    return result;
  }
  const dir = resolve(location.path, relativeDir);
  const display = join(location.displayPath, relativeDir);
  const rel = relative(location.path, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    result.diagnostics.push(`escaping-path: ${relativeDir}`);
    return result;
  }
  const base = request.scope === 'project' ? resolve(request.path ?? process.cwd()) : homedir();
  const link = symlinkedComponent(base, dir);
  if (link) {
    result.diagnostics.push(`symlinked-destination: ${relative(base, link) || link}`);
    return result;
  }
  if (!existsSync(dir)) return result;
  const files = packageFiles(dir);
  if (!files) {
    result.diagnostics.push(`symlinked-destination: ${display} contains a link`);
    return result;
  }
  const edits: { path: string; content: string; display: string }[] = [];
  for (const file of files.sort()) {
    if (keep.includes(file)) continue;
    const path = join(dir, file);
    const oldContent = readFileSync(path, 'utf8');
    const content = removeManagedMarker(oldContent, marker);
    if (content === oldContent) result.skipped.push(join(display, file));
    else edits.push({ path, content, display: join(display, file) });
  }
  if (edits.length && !request.dryRun) {
    backup(dir, base, request.scope === 'user');
    for (const edit of edits) {
      const rest = edit.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      if (rest.trim().length === 0) unlinkSync(edit.path);
      else atomicWrite(edit.path, edit.content);
    }
    removeEmptyDirs(dir);
  }
  result.changed.push(...edits.map((edit) => edit.display));
  return result;
}
