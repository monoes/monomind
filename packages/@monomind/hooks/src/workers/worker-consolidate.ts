/**
 * Memory consolidation worker factory.
 * Ported from the deleted CLI worker-daemon (runConsolidateWorker) so the
 * .monomind/metrics/consolidation.json consumers (route-handler.cjs, doctor
 * metrics freshness) keep working.
 *
 * RAPTOR-style memory consolidation: cluster episodic entries by namespace,
 * generate a summary entry as 'contextual' type referencing source cluster.
 * Source: https://arxiv.org/abs/2401.18059 (RAPTOR — ICLR 2024)
 *
 * Output schema (unchanged): { timestamp, patternsConsolidated,
 * clustersCreated, memoryCleaned, duplicatesRemoved, mode }
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

/**
 * Walk upward from `startDir` looking for a package.json whose "name" is
 * `@monoes/monomindcli`, returning that package's root directory. Used to
 * find the CLI when this worker is itself running from inside the CLI's own
 * process (the normal case for a globally-installed or npx-invoked CLI,
 * where there is no monorepo/node_modules layout to guess a relative path
 * for).
 */
function findCliRootFrom(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === '@monoes/monomindcli') return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the CLI memory bridge (bridgeSearchEntries/bridgeStoreEntry).
 * The bridge lives in @monomind/cli, which this package must not depend on.
 * There is no existing cross-package "where is the CLI installed" convention
 * in this monorepo (no env var, no shared registry) — so this tries, in
 * order:
 *   1. Dev monorepo layout relative to projectRoot.
 *   2. projectRoot/node_modules/@monoes/monomindcli (CLI installed as a
 *      dependency of the target project).
 *   3. require.resolve('@monoes/monomindcli/package.json') from this
 *      module's own location — resolves via normal Node module resolution,
 *      which finds the CLI package wherever npm/npx actually placed it
 *      (works for local, global, and npx-cache installs) as long as hooks
 *      and cli end up as siblings/deps in the same resolution chain.
 *   4. Walk up from process.argv[1] (the actual running entry script) to
 *      find the CLI's own package.json — this is the case that matters most
 *      in practice: a globally-installed or npx-invoked CLI is *itself* the
 *      running process, so its own script location is the ground truth for
 *      where its dist/ lives, regardless of projectRoot.
 * Any candidate that doesn't resolve is skipped silently; if all fail,
 * consolidation reports zeros, honestly.
 */
async function loadMemoryBridge(projectRoot: string): Promise<{
  bridgeSearchEntries: (o: Record<string, unknown>) => Promise<{ results?: Array<{ key: string }> } | null>;
  bridgeStoreEntry: (o: Record<string, unknown>) => Promise<unknown>;
} | null> {
  const candidates: string[] = [
    path.join(projectRoot, 'packages', '@monomind', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js'),
    path.join(projectRoot, 'node_modules', '@monoes', 'monomindcli', 'dist', 'src', 'memory', 'memory-bridge.js'),
  ];

  try {
    const require = createRequire(import.meta.url);
    const cliPkgPath = require.resolve('@monoes/monomindcli/package.json');
    candidates.push(path.join(path.dirname(cliPkgPath), 'dist', 'src', 'memory', 'memory-bridge.js'));
  } catch { /* @monoes/monomindcli not resolvable from here — try next strategy */ }

  if (process.argv[1]) {
    const cliRoot = findCliRootFrom(path.dirname(process.argv[1]));
    if (cliRoot) {
      candidates.push(path.join(cliRoot, 'dist', 'src', 'memory', 'memory-bridge.js'));
    }
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (typeof mod.bridgeSearchEntries === 'function' && typeof mod.bridgeStoreEntry === 'function') {
        return mod;
      }
    } catch { /* try next */ }
  }
  return null;
}

/** Resolve the CLI knowledge-graph module (kgConsolidateCandidates/kgIngest)
 *  — sibling of memory-bridge.js, same resolution strategy. */
async function loadMemoryKg(projectRoot: string): Promise<{
  kgConsolidateCandidates: (o?: Record<string, unknown>) => Promise<Array<{ name: string; type: string; description: string; neighborhood: string[] }>>;
  kgIngest: (o: Record<string, unknown>) => Promise<{ success: boolean }>;
} | null> {
  const candidates: string[] = [
    path.join(projectRoot, 'packages', '@monomind', 'cli', 'dist', 'src', 'memory', 'memory-kg.js'),
    path.join(projectRoot, 'node_modules', '@monoes', 'monomindcli', 'dist', 'src', 'memory', 'memory-kg.js'),
  ];
  try {
    const require = createRequire(import.meta.url);
    const cliPkgPath = require.resolve('@monoes/monomindcli/package.json');
    candidates.push(path.join(path.dirname(cliPkgPath), 'dist', 'src', 'memory', 'memory-kg.js'));
  } catch { /* not resolvable from here */ }
  if (process.argv[1]) {
    const cliRoot = findCliRootFrom(path.dirname(process.argv[1]));
    if (cliRoot) candidates.push(path.join(cliRoot, 'dist', 'src', 'memory', 'memory-kg.js'));
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (typeof mod.kgConsolidateCandidates === 'function' && typeof mod.kgIngest === 'function') return mod;
    } catch { /* try next */ }
  }
  return null;
}

/** cognee consolidate_entity_descriptions, LLM-less half: fold distinct
 *  neighborhood facts into a stale entity's description. The LLM half (a live
 *  agent rewriting prose) still happens via memory_kg_ingest during sessions;
 *  this keeps descriptions from lagging connectivity in between. Longer
 *  descriptions win on merge, so re-running is idempotent-ish; note an LLM
 *  rewrite only supersedes this digest when it is LONGER (kgIngest keeps the
 *  longer description) — a concise rewrite must carry the facts to win. */
const KG_MAX_DESC = 2000; // mirrors memory-kg.ts MAX_DESC_LEN
function foldNeighborhood(description: string, neighborhood: string[]): string | null {
  const base = String(description || '').trim();
  const fresh = neighborhood
    .map(f => String(f || '').replace(/\s+/g, ' ').trim())
    .filter(f => f.length > 3 && !base.toLowerCase().includes(f.toLowerCase().slice(0, 60)));
  if (!fresh.length) return null;
  // Extend an existing trailing Facts block instead of stacking headers.
  const digest = (/Facts: [^]*$/.test(base)
    ? `${base}; ${fresh.join('; ')}`
    : `${base ? base + ' ' : ''}Facts: ${fresh.join('; ')}`
  ).slice(0, KG_MAX_DESC);
  return digest.length > base.length ? digest : null; // merge keeps longer — don't resubmit no-ops
}

export function createConsolidateWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const metricsDir = path.join(projectRoot, '.monomind', 'metrics');
    const consolidateFile = path.join(metricsDir, 'consolidation.json');

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    let patternsConsolidated = 0;
    let clustersCreated = 0;

    const writeMetrics = (data: Record<string, unknown>) => {
      // Atomic write: tmp + rename, so readers never see a partial file.
      const tmp = consolidateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, consolidateFile);
    };

    // P2-52(b): a "the process might die mid-run" placeholder is genuinely
    // useful here — the memory bridge loads an embedding model, which can
    // outlive the caller's timeout budget (session-start hooks abandon after
    // 1.5s and the hook process force-exits at 5s) — but it must never
    // clobber the last-known-good consolidation.json with zeros. Write the
    // placeholder to a SEPARATE in-progress file only; the real output path
    // is only ever touched by the final tmp+rename write below, so a killed
    // run leaves whatever real data existed from the previous successful run
    // untouched.
    const inProgressFile = consolidateFile + '.inprogress';
    const baseline = {
      timestamp: new Date().toISOString(),
      patternsConsolidated: 0,
      clustersCreated: 0,
      memoryCleaned: 0,
      duplicatesRemoved: 0,
      mode: 'raptor',
      status: 'in-progress',
    };
    try { fs.writeFileSync(inProgressFile, JSON.stringify(baseline, null, 2)); } catch { /* non-critical */ }

    try {
      const bridge = await loadMemoryBridge(projectRoot);
      if (bridge) {
        // Retrieve recent episodic entries (short-term tier) for RAPTOR clustering
        const episodic = await bridge.bridgeSearchEntries({
          query: 'task outcome agent pattern',
          namespace: 'patterns',
          limit: 50,
          threshold: 0.0,
        });

        if (episodic?.results && episodic.results.length >= 3) {
          // Group into clusters of ~5 by simple sequential chunking
          const CLUSTER_SIZE = 5;
          for (let i = 0; i < episodic.results.length; i += CLUSTER_SIZE) {
            const cluster = episodic.results.slice(i, i + CLUSTER_SIZE);
            if (cluster.length < 2) continue;

            // Build cluster summary (lightweight abstraction without LLM)
            const keys = cluster.map(r => r.key).join(', ');
            const summary = `RAPTOR cluster [${Math.floor(i / CLUSTER_SIZE)}]: ` +
              `${cluster.length} patterns consolidated. Topics: ${keys.slice(0, 120)}`;

            await bridge.bridgeStoreEntry({
              key: `raptor_cluster:${Date.now()}_${i}`,
              value: summary,
              namespace: 'contextual',
              tags: ['raptor', 'cluster_summary'],
            });

            patternsConsolidated += cluster.length;
            clustersCreated++;
          }
        }
      }
    } catch (e) {
      // non-critical — bridge may be unavailable, but a mid-run failure here
      // silently under-reports patternsConsolidated/clustersCreated.
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[worker-consolidate] RAPTOR clustering failed:', e);
    }

    // KG entity-description consolidation (cognee port, mechanical half).
    let kgCandidates = 0;
    let kgDescriptionsExtended = 0;
    try {
      const kg = await loadMemoryKg(projectRoot);
      if (kg) {
        const cands = await kg.kgConsolidateCandidates({ minEdges: 3, limit: 10 });
        kgCandidates = cands.length;
        const nodes = cands
          .map(c => {
            const folded = foldNeighborhood(c.description, c.neighborhood);
            return folded ? { name: c.name, type: c.type, description: folded } : null;
          })
          .filter((n): n is { name: string; type: string; description: string } => !!n);
        if (nodes.length) {
          const r = await kg.kgIngest({ nodes, edges: [], originRef: `consolidate-worker:${new Date().toISOString().slice(0, 10)}` });
          if (r?.success) kgDescriptionsExtended = nodes.length;
        }
      }
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[worker-consolidate] KG consolidation failed:', e);
    }

    const result = {
      timestamp: new Date().toISOString(),
      patternsConsolidated,
      clustersCreated,
      memoryCleaned: 0,
      duplicatesRemoved: 0,
      kgCandidates,
      kgDescriptionsExtended,
      mode: 'raptor',
    };

    writeMetrics(result);
    try { fs.unlinkSync(inProgressFile); } catch { /* already gone or never written */ }

    return {
      worker: 'consolidate',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: result,
    };
  };
}
