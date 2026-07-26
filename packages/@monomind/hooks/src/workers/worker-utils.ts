/**
 * Shared utilities for built-in worker implementations.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';

// ============================================================================
// Security Constants
// ============================================================================

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
export const MAX_RECURSION_DEPTH = 20;
export const MAX_CONCURRENCY = 5;

// Allowed worker names for input validation
export const ALLOWED_WORKERS = new Set([
  // Canonical internal names
  'performance', 'health', 'security', 'adr', 'ddd',
  'patterns', 'learning', 'cache', 'git', 'swarm', 'progress',
  // Workers folded in from the deleted CLI worker-daemon
  'map', 'audit', 'optimize', 'consolidate',
]);

// ============================================================================
// Pre-compiled Regexes for DDD Pattern Detection (20-40% faster)
// ============================================================================

export const DDD_PATTERNS = {
  entity: /class\s+\w+Entity\b|interface\s+\w+Entity\b/,
  valueObject: /class\s+\w+(VO|ValueObject)\b|type\s+\w+VO\s*=/,
  aggregate: /class\s+\w+Aggregate\b|AggregateRoot/,
  repository: /class\s+\w+Repository\b|interface\s+I\w+Repository\b/,
  service: /class\s+\w+Service\b|interface\s+I\w+Service\b/,
  domainEvent: /class\s+\w+Event\b|DomainEvent/,
} as const;

// ============================================================================
// File Cache for Repeated Reads (30-50% I/O reduction)
// ============================================================================

interface CacheEntry {
  content: string;
  expires: number;
}

const FILE_CACHE_TTL = 30_000; // 30 seconds
const fileCache = new Map<string, CacheEntry>();

export async function cachedReadFile(filePath: string): Promise<string> {
  const cached = fileCache.get(filePath);
  const now = Date.now();

  if (cached && cached.expires > now) {
    return cached.content;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  fileCache.set(filePath, {
    content,
    expires: now + FILE_CACHE_TTL,
  });

  // Cleanup old entries periodically (keep cache small)
  if (fileCache.size > 100) {
    for (const [key, entry] of fileCache) {
      if (entry.expires < now) {
        fileCache.delete(key);
      }
    }
  }

  return content;
}

// ============================================================================
// Security Utilities
// ============================================================================

/**
 * Validate and resolve a path ensuring it stays within projectRoot.
 * Uses realpath to prevent TOCTOU symlink attacks.
 */
export async function safePathAsync(projectRoot: string, ...segments: string[]): Promise<string> {
  const resolved = path.resolve(projectRoot, ...segments);

  try {
    const realResolved = await fs.realpath(resolved).catch(() => resolved);
    const realRoot = await fs.realpath(projectRoot).catch(() => projectRoot);

    if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
      throw new Error(`Path traversal blocked: ${realResolved}`);
    }
    return realResolved;
  } catch (error) {
    const parent = path.dirname(resolved);
    const realParent = await fs.realpath(parent).catch(() => parent);
    const realRoot = await fs.realpath(projectRoot).catch(() => projectRoot);

    if (!realParent.startsWith(realRoot + path.sep) && realParent !== realRoot) {
      throw new Error(`Path traversal blocked: ${resolved}`);
    }
    return resolved;
  }
}

/**
 * Synchronous path validation (for non-async contexts).
 */
export function safePath(projectRoot: string, ...segments: string[]): string {
  const resolved = path.resolve(projectRoot, ...segments);
  const realRoot = path.resolve(projectRoot);

  if (!resolved.startsWith(realRoot + path.sep) && resolved !== realRoot) {
    throw new Error(`Path traversal blocked: ${resolved}`);
  }
  return resolved;
}

/**
 * Safe JSON parse that strips dangerous prototype pollution keys.
 */
export function safeJsonParse<T>(content: string): T {
  return JSON.parse(content, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return value;
  });
}

/**
 * Validate worker name against allowed list.
 */
export function isValidWorkerName(name: unknown): name is string {
  return typeof name === 'string' && (ALLOWED_WORKERS.has(name) || name.startsWith('test-'));
}

/**
 * Safe file read with size limit.
 */
export async function safeReadFile(filePath: string, maxSize = MAX_FILE_SIZE): Promise<string> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > maxSize) {
      throw new Error(`File too large: ${stats.size} > ${maxSize}`);
    }
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File not found');
    }
    throw error;
  }
}

/**
 * Validate project root is a real directory.
 */
export async function validateProjectRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  try {
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error('Project root must be a directory');
    }
    return resolved;
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[worker-utils] invalid project root, falling back to cwd:', e);
    return process.cwd();
  }
}

// ============================================================================
// File System Helpers
// ============================================================================

export async function countLines(dir: string, ext: string): Promise<number> {
  let total = 0;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        total += await countLines(fullPath, ext);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        const content = await fs.readFile(fullPath, 'utf-8');
        total += content.split('\n').length;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return total;
}

export interface CollectResult {
  /** Files found under `dir` (recursively) matching `ext`. */
  files: string[];
  /**
   * Directories that could not be enumerated (permissions, I/O errors) or
   * that were cut off by the recursion-depth guard. A non-empty `skipped`
   * means `files` is INCOMPLETE — "found nothing here" is not the same claim
   * as "there is nothing here", and callers must be able to tell them apart.
   *
   * A directory that simply does not exist (ENOENT) is NOT reported: nothing
   * was hidden from us, there is genuinely nothing to look at.
   */
  skipped: string[];
}

export async function collectFiles(dir: string, ext: string, depth = 0): Promise<CollectResult> {
  // Security: Prevent infinite recursion. Anything below this point is
  // unexamined, so it is reported as skipped rather than silently dropped.
  if (depth > MAX_RECURSION_DEPTH) {
    return { files: [], skipped: [dir] };
  }

  const files: string[] = [];
  const skipped: string[] = [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // Unreadable directory (EACCES/EPERM/EIO/ENOTDIR...): its contents were
      // never examined. Surface it the same way an unreadable file is.
      skipped.push(dir);
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
        console.error('[worker-utils] collectFiles could not read directory:', dir, e);
      }
    }
    return { files, skipped };
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip symlinks to prevent traversal attacks
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const sub = await collectFiles(fullPath, ext, depth + 1);
      files.push(...sub.files);
      skipped.push(...sub.skipped);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }

  return { files, skipped };
}

export interface DDDPatternResult {
  patterns: {
    entities: number;
    valueObjects: number;
    aggregates: number;
    repositories: number;
    services: number;
    domainEvents: number;
  };
  /** Files/directories that could not be read — the counts are a lower bound. */
  skipped: string[];
}

export async function searchDDDPatterns(srcPath: string): Promise<DDDPatternResult> {
  const patterns = {
    entities: 0,
    valueObjects: 0,
    aggregates: 0,
    repositories: 0,
    services: 0,
    domainEvents: 0,
  };
  const skipped: string[] = [];

  try {
    const collected = await collectFiles(srcPath, '.ts');
    const files = collected.files;
    skipped.push(...collected.skipped);

    const BATCH_SIZE = 10;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const contents = await Promise.all(
        batch.map(file => cachedReadFile(file).catch((e) => {
          // Unreadable file: record it, do not pretend it was empty.
          skipped.push(file);
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
            console.error('[worker-utils] searchDDDPatterns skipped unreadable file:', file, e);
          }
          return '';
        }))
      );

      for (const content of contents) {
        if (!content) continue;

        if (DDD_PATTERNS.entity.test(content)) patterns.entities++;
        if (DDD_PATTERNS.valueObject.test(content)) patterns.valueObjects++;
        if (DDD_PATTERNS.aggregate.test(content)) patterns.aggregates++;
        if (DDD_PATTERNS.repository.test(content)) patterns.repositories++;
        if (DDD_PATTERNS.service.test(content)) patterns.services++;
        if (DDD_PATTERNS.domainEvent.test(content)) patterns.domainEvents++;
      }
    }
  } catch (e) {
    // The walk itself blew up: the whole subtree is unexamined, so say so
    // rather than returning zeroes that read like "no DDD patterns here".
    skipped.push(srcPath);
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[worker-utils] searchDDDPatterns failed:', e);
  }

  return { patterns, skipped };
}

export interface ScanResult {
  secrets: number;
  vulnerabilities: number;
  /** Files actually read and pattern-matched. */
  filesScanned: number;
  /**
   * Paths that could not be read (permissions, I/O errors) — NOT proof of
   * absence. Includes both unreadable FILES and unreadable DIRECTORIES: an
   * un-enumerable directory hides an unknown number of files, so it counts
   * as an unexamined path just like a locked file does.
   */
  skipped: string[];
}

/**
 * Scan a directory tree for secret/vulnerability patterns.
 *
 * Neither a file nor a directory that cannot be read may abort the scan or
 * silently vanish: each read is guarded individually, and unreadable paths —
 * files from the read loop, directories from `collectFiles` — are reported in
 * `skipped` so callers can tell "found nothing" apart from "did not look".
 */
export async function scanDirectoryForPatterns(
  dir: string,
  secretPatterns: RegExp[],
  vulnPatterns: RegExp[]
): Promise<ScanResult> {
  let secrets = 0;
  let vulnerabilities = 0;
  let filesScanned = 0;
  const skipped: string[] = [];

  const tsCollected = await collectFiles(dir, '.ts');
  const jsCollected = await collectFiles(dir, '.js');
  const files = [...tsCollected.files, ...jsCollected.files];

  // Both walks cover the same tree, so an unreadable directory shows up
  // twice — dedupe so skippedCount stays a count of distinct unseen paths.
  for (const d of new Set([...tsCollected.skipped, ...jsCollected.skipped])) {
    skipped.push(d);
  }

  for (const file of files) {
    if (file.includes('node_modules') || file.includes('.test.') || file.includes('.spec.')) {
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch (e) {
      skipped.push(file);
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
        console.error('[worker-utils] scanDirectoryForPatterns skipped unreadable file:', file, e);
      }
      continue;
    }

    filesScanned++;

    for (const pattern of secretPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        secrets += matches.length;
      }
    }

    for (const pattern of vulnPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        vulnerabilities += matches.length;
      }
    }
  }

  return { secrets, vulnerabilities, filesScanned, skipped };
}

export function calculateAvgQuality(patterns: Array<{ quality?: number }>): number {
  if (patterns.length === 0) return 0;

  const sum = patterns.reduce((acc, p) => acc + (p.quality ?? 0), 0);
  return Math.round((sum / patterns.length) * 100) / 100;
}

export async function countFilesRecursive(dir: string, ext: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        count += await countFilesRecursive(fullPath, ext);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        count++;
      }
    }
  } catch {
    // Ignore
  }
  return count;
}
