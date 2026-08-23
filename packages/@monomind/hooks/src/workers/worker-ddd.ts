/**
 * DDD compliance worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { searchDDDPatterns } from './worker-utils.js';

/**
 * Discover workspace packages under `packagesPath`, supporting both flat
 * layouts (`packages/foo/package.json`) and npm-scoped layouts
 * (`packages/@scope/foo/package.json`). Returns paths relative to
 * `packagesPath` (e.g. `'foo'` or `'@scope/foo'`) for directories that
 * actually contain a package.json — not the package's declared `name`,
 * since what matters here is the on-disk module directory to scan.
 */
async function discoverWorkspacePackages(packagesPath: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(packagesPath, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(packagesPath, entry.name);

    if (entry.name.startsWith('@')) {
      // Scoped scope directory (e.g. `@monomind`) — look one level deeper.
      let scopedEntries;
      try {
        scopedEntries = await fs.readdir(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory()) continue;
        const pkgJsonPath = path.join(entryPath, scoped.name, 'package.json');
        try {
          await fs.access(pkgJsonPath);
          found.push(path.join(entry.name, scoped.name));
        } catch {
          /* not a package directory */
        }
      }
    } else {
      const pkgJsonPath = path.join(entryPath, 'package.json');
      try {
        await fs.access(pkgJsonPath);
        found.push(entry.name);
      } catch {
        /* not a package directory */
      }
    }
  }

  return found;
}

export function createDDDWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const packagesPath = path.join(projectRoot, 'packages');
    const dddMetrics: Record<string, Record<string, number>> = {};
    let totalScore = 0;
    let maxScore = 0;

    // Discover real workspace packages instead of hardcoding this repo's own
    // package paths — every other project previously scored 0% forever.
    let modules = await discoverWorkspacePackages(packagesPath);
    let basePath = packagesPath;
    if (modules.length === 0) {
      // Single-package project layout: no packages/*/package.json anywhere.
      // Fall back to treating the project root itself as the one module to
      // scan, provided it has a src/ directory.
      try {
        await fs.access(path.join(projectRoot, 'src'));
        modules = [path.basename(projectRoot) || 'project'];
        basePath = projectRoot;
      } catch {
        /* no packages/ and no src/ — nothing to score */
      }
    }

    const moduleResults = await Promise.all(
      modules.map(async (mod) => {
        const modPath = basePath === projectRoot ? projectRoot : path.join(basePath, mod);
        const modMetrics: Record<string, number> = {
          entities: 0,
          valueObjects: 0,
          aggregates: 0,
          repositories: 0,
          services: 0,
          domainEvents: 0,
        };

        try {
          await fs.access(modPath);

          const srcPath = path.join(modPath, 'src');
          const { patterns, skipped } = await searchDDDPatterns(srcPath);
          Object.assign(modMetrics, patterns);

          const modScore =
            patterns.entities * 2 +
            patterns.valueObjects +
            patterns.aggregates * 3 +
            patterns.repositories * 2 +
            patterns.services +
            patterns.domainEvents * 2;

          return { mod, modMetrics, modScore, exists: true, skipped };
        } catch {
          return { mod, modMetrics, modScore: 0, exists: false, skipped: [] as string[] };
        }
      }),
    );

    const skippedPaths: string[] = [];

    for (const result of moduleResults) {
      if (result.exists) {
        dddMetrics[result.mod] = result.modMetrics;
        totalScore += result.modScore;
        maxScore += 20;
        skippedPaths.push(...result.skipped);
      }
    }

    const progressPct = maxScore > 0 ? Math.min(100, Math.round((totalScore / maxScore) * 100)) : 0;

    // Unreadable files/directories deflate every count above, so `progress` is
    // a lower bound rather than a measurement whenever this is true.
    const incomplete = skippedPaths.length > 0;

    try {
      const outputPath = path.join(projectRoot, '.monomind', 'metrics', 'ddd-progress.json');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(
        outputPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            progress: progressPct,
            score: totalScore,
            maxScore,
            modules: dddMetrics,
            incomplete,
            skippedCount: skippedPaths.length,
            skippedPaths: skippedPaths.slice(0, 50),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[worker-ddd] failed to write ddd-progress.json:', e);
    }

    return {
      worker: 'ddd',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        progress: progressPct,
        score: totalScore,
        maxScore,
        modulesTracked: Object.keys(dddMetrics).length,
        modules: dddMetrics,
        incomplete,
        skippedCount: skippedPaths.length,
      },
    };
  };
}
