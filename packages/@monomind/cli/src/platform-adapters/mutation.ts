/** Locking, backup and atomic-write primitives shared by platform mutations. */

import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { InstallRequest } from './types.js';

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
  const destination = join(backupRoot, basename(path));
  if (statSync(path).isDirectory()) cpSync(path, destination, { recursive: true });
  else writeFileSync(destination, readFileSync(path));
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
