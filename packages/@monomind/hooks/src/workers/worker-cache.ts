/**
 * Cache eviction worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { safePathAsync } from './worker-utils.js';

export function createCacheWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    let cleaned = 0;
    let freedBytes = 0;

    const safeCleanDirs = ['.monomind/cache', '.monomind/temp'];

    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    const now = Date.now();

    for (const relDir of safeCleanDirs) {
      try {
        // safePathAsync realpaths both sides before comparing, so a symlink that's
        // lexically inside .monomind/cache but physically points elsewhere can't
        // smuggle a recursive delete (fs.rm below) outside projectRoot — the gap
        // the lexical-only safePath() left open.
        const dir = await safePathAsync(projectRoot, relDir);
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.')) {
            continue;
          }

          const entryPath = path.join(dir, entry.name);

          try {
            await safePathAsync(projectRoot, relDir, entry.name);
          } catch {
            continue;
          }

          try {
            const stat = await fs.stat(entryPath);
            const age = now - stat.mtimeMs;

            if (age > maxAgeMs) {
              freedBytes += stat.size;
              await fs.rm(entryPath, { recursive: true, force: true });
              cleaned++;
            }
          } catch {
            // Skip entries we can't stat
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return {
      worker: 'cache',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        cleaned,
        freedMB: Math.round(freedBytes / 1024 / 1024),
        maxAgedays: 7,
      },
    };
  };
}
