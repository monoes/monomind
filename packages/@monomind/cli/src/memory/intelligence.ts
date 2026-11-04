/**
 * V1 Intelligence Module
 * SONA and ReasoningBank
 * for adaptive learning and pattern recognition
 *
 * Performance targets:
 * - Signal recording: <0.05ms (achieved: ~0.01ms)
 * - Pattern search: O(n) cosine scan
 * - Memory efficient circular buffers
 *
 * File-size sweep: split into sibling modules (intelligence-persistence.ts,
 * intelligence-types.ts, intelligence-sona.ts, intelligence-reasoning-bank.ts,
 * intelligence-sona-routing.ts, intelligence-learning.ts,
 * intelligence-pattern-api.ts, intelligence-memory-proficiency.ts). This file
 * remains the entry point: it owns the shared module state and re-exports
 * everything that used to live here so every existing import keeps working.
 *
 * @module v1/cli/intelligence
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERNS_DB_FILE } from './intelligence-pattern-db.js';
import { getDataDir, getPatternsPath, getStatsPath } from './intelligence-persistence.js';
import { LocalReasoningBank } from './intelligence-reasoning-bank.js';
import { LocalSonaCoordinator } from './intelligence-sona.js';
import { loadSonaRoutingPatterns } from './intelligence-sona-routing.js';
import {
  openSqlitePatternStore,
  type ReasoningBankStore,
  SqlitePatternStore,
} from './intelligence-sqlite-store.js';
import type { IntelligenceStats, SonaConfig } from './intelligence-types.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SONA_CONFIG: SonaConfig = {
  instantLoopEnabled: true,
  backgroundLoopEnabled: false,
  confidenceLearningRate: 0.001,
  ewcLambda: 0.4,
  maxTrajectorySize: 100,
  patternThreshold: 0.7,
  maxSignals: 10000,
  maxPatterns: 5000,
};

// ============================================================================
// Module State
// ============================================================================

export let sonaCoordinator: LocalSonaCoordinator | null = null;
export let reasoningBank: ReasoningBankStore | null = null;
let intelligenceInitialized = false;
let initPromise: Promise<{
  success: boolean;
  sonaEnabled: boolean;
  reasoningBankEnabled: boolean;
  error?: string;
}> | null = null;
export let globalStats = {
  trajectoriesRecorded: 0,
  lastAdaptation: null as number | null,
};

// ============================================================================
// Stats Persistence
// ============================================================================

/**
 * Load persisted stats from disk
 */
function loadPersistedStats(): void {
  try {
    const path = getStatsPath();
    if (existsSync(path) && statSync(path).size <= 10 * 1024 * 1024) {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (data && typeof data === 'object') {
        globalStats.trajectoriesRecorded = data.trajectoriesRecorded ?? 0;
        globalStats.lastAdaptation = data.lastAdaptation ?? null;
      }
    }
  } catch (e) {
    // Ignore load errors, start fresh
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[intelligence] failed to load stats.json, starting fresh:', e);
  }
}

/**
 * Save stats to disk
 */
export function savePersistedStats(): void {
  try {
    const path = getStatsPath();
    writeFileSync(path, JSON.stringify(globalStats, null, 2), 'utf-8');
  } catch (e) {
    // Ignore save errors
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[intelligence] failed to save stats.json:', e);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the intelligence system (SONA + ReasoningBank)
 * Uses optimized local implementations
 */
async function _doInitializeIntelligence(config?: Partial<SonaConfig>): Promise<{
  success: boolean;
  sonaEnabled: boolean;
  reasoningBankEnabled: boolean;
  error?: string;
}> {
  try {
    // Merge config with defaults
    const finalConfig: SonaConfig = {
      ...DEFAULT_SONA_CONFIG,
      ...config,
    };

    // Initialize local SONA (optimized for <0.05ms)
    sonaCoordinator = new LocalSonaCoordinator(finalConfig);

    // Initialize local ReasoningBank with persistence enabled: SQLite
    // (patterns.db) when better-sqlite3 loads, else the JSON file.
    reasoningBank =
      openSqlitePatternStore(getDataDir(), finalConfig.maxPatterns) ??
      new LocalReasoningBank({
        maxSize: finalConfig.maxPatterns,
        persistence: true,
      });

    // Load persisted stats if available
    loadPersistedStats();

    // Seed neural learned patterns from pattern store.
    // This is the A→B bridge reader: connects the automatic learning loop to routing.
    const neuralPatternsPath = join(getDataDir(), 'patterns.json');
    if (existsSync(neuralPatternsPath) && statSync(neuralPatternsPath).size <= 50 * 1024 * 1024) {
      try {
        const { generateEmbedding: genEmb } = await import('./memory-initializer.js').catch(() => ({
          generateEmbedding: null,
        }));
        const raw = readFileSync(neuralPatternsPath, 'utf-8');
        const entries = JSON.parse(raw) as Array<{
          id?: string;
          type?: string;
          content?: string;
          confidence?: number;
          usageCount?: number;
          embedding?: number[];
        }>;
        if (Array.isArray(entries)) {
          for (const p of entries.slice(0, 200)) {
            try {
              if (!p.id || typeof p.id !== 'string' || p.id.length > 512) continue;
              if (!p.content || typeof p.content !== 'string' || p.content.length > 4096) continue;
              const conf = p.confidence ?? 0.5;
              if (!Number.isFinite(conf) || conf < 0 || conf > 1) continue;
              const embedding =
                p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0
                  ? p.embedding
                  : genEmb
                    ? ((await genEmb(p.content))?.embedding ?? [])
                    : [];
              if (embedding.some((v: number) => !Number.isFinite(v))) continue;
              // Only store if not already present, or if we now have an embedding
              // where the existing entry has none — avoids inflating usageCount on
              // every cold-start re-seed.
              const existing = reasoningBank?.get(p.id);
              if (!existing || (existing.embedding.length === 0 && embedding.length > 0)) {
                reasoningBank?.store({
                  id: p.id,
                  type: p.type ?? 'general',
                  content: p.content,
                  confidence: conf,
                  embedding,
                  usageCount: p.usageCount ?? 0,
                });
              }
            } catch {
              /* skip invalid entries */
            }
          }
        }
      } catch (e) {
        /* neural patterns file unreadable — skip */
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[intelligence] failed to seed patterns.json into ReasoningBank:', e);
      }
    }

    // Seed SONA routing patterns into the ReasoningBank so keyword-based
    // routing knowledge from .swarm/sona-patterns.json participates in
    // similarity search alongside neural patterns.
    const sonaRouting = loadSonaRoutingPatterns();
    if (sonaRouting.length > 0) {
      const { generateEmbedding } = await import('./memory-initializer.js').catch(() => ({
        generateEmbedding: null,
      }));
      for (const p of sonaRouting.slice(0, 100)) {
        // cap seeding to 100 entries
        try {
          // M2: validate before seeding — malformed sona-patterns.json must not corrupt bank
          if (!p.id || typeof p.id !== 'string' || p.id.length > 512) continue;
          if (!Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) continue;
          if (!p.content || typeof p.content !== 'string' || p.content.length > 4096) continue;

          const embResult = generateEmbedding ? await generateEmbedding(p.content) : null;
          const embedding = embResult?.embedding ?? [];

          // Reject NaN/Infinity in embedding
          if (embedding.some((v: number) => !Number.isFinite(v))) continue;

          reasoningBank?.store({
            id: p.id,
            type: p.type,
            content: p.content,
            confidence: p.confidence,
            embedding,
            usageCount: p.usageCount,
          });
        } catch {
          /* skip unembeddable entries */
        }
      }
    }

    intelligenceInitialized = true;

    return {
      success: true,
      sonaEnabled: true,
      reasoningBankEnabled: true,
    };
  } catch (error) {
    return {
      success: false,
      sonaEnabled: false,
      reasoningBankEnabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Initialize the intelligence system (SONA + ReasoningBank).
 * Promise-based singleton: concurrent callers share a single init flight.
 */
export async function initializeIntelligence(config?: Partial<SonaConfig>): Promise<{
  success: boolean;
  sonaEnabled: boolean;
  reasoningBankEnabled: boolean;
  error?: string;
}> {
  if (intelligenceInitialized) {
    return { success: true, sonaEnabled: !!sonaCoordinator, reasoningBankEnabled: !!reasoningBank };
  }
  if (!initPromise) {
    initPromise = _doInitializeIntelligence(config);
  }
  return initPromise;
}

/**
 * Get intelligence system statistics
 */
export function getIntelligenceStats(): IntelligenceStats {
  const sonaStats = sonaCoordinator?.stats();
  const bankStats = reasoningBank?.stats();

  return {
    sonaEnabled: !!sonaCoordinator,
    reasoningBankSize: bankStats?.size ?? 0,
    patternsLearned: bankStats?.patternCount ?? 0,
    trajectoriesRecorded: globalStats.trajectoriesRecorded,
    lastAdaptation: globalStats.lastAdaptation,
    avgAdaptationTime: sonaStats?.avgAdaptationMs ?? 0,
  };
}

/**
 * Get SONA coordinator for advanced operations
 */
export function getSonaCoordinator(): LocalSonaCoordinator | null {
  return sonaCoordinator;
}

/**
 * Get ReasoningBank for advanced operations
 */
export function getReasoningBank(): ReasoningBankStore | null {
  return reasoningBank;
}

/**
 * Clear intelligence state
 */
export function clearIntelligence(): void {
  if (reasoningBank instanceof SqlitePatternStore) reasoningBank.close();
  sonaCoordinator = null;
  reasoningBank = null;
  intelligenceInitialized = false;
  // Must be dropped too. initializeIntelligence() returns an existing
  // initPromise without re-running init, so leaving the resolved promise here
  // made every later init report success while sonaCoordinator and
  // reasoningBank stayed null — after which the non-null assertions in
  // clearAllPatterns()/getAllPatterns() etc. threw
  // "Cannot read properties of null". Intelligence could never be
  // re-initialized after a clear, for the life of the process.
  initPromise = null;
  globalStats = {
    trajectoriesRecorded: 0,
    lastAdaptation: null,
  };
}

/**
 * Get the neural data directory path
 */
export function getNeuralDataDir(): string {
  return getDataDir();
}

/**
 * Get persistence status
 */
export function getPersistenceStatus(): {
  enabled: boolean;
  dataDir: string;
  patternsFile: string;
  statsFile: string;
  patternsExist: boolean;
  statsExist: boolean;
} {
  const dataDir = getDataDir();
  const patternsFile =
    reasoningBank instanceof SqlitePatternStore
      ? join(dataDir, PATTERNS_DB_FILE)
      : getPatternsPath();
  const statsFile = getStatsPath();

  return {
    enabled: true,
    dataDir,
    patternsFile,
    statsFile,
    patternsExist: existsSync(patternsFile),
    statsExist: existsSync(statsFile),
  };
}

// ============================================================================
// Re-exports (file-size sweep — see module header)
// ============================================================================

export type { PatternMatch } from './intelligence-learning.js';
export {
  benchmarkAdaptation,
  distillLearning,
  endTrajectoryWithVerdict,
  findSimilarPatterns,
  recordStep,
  recordTrajectory,
} from './intelligence-learning.js';
export {
  getMemoryProficiencyStats,
  recordMemoryDecision,
} from './intelligence-memory-proficiency.js';
export {
  clearAllPatterns,
  compactPatterns,
  deletePattern,
  flushPatterns,
  getAllPatterns,
  getPatternsByType,
} from './intelligence-pattern-api.js';
export type {
  IntelligenceStats,
  Pattern,
  SonaConfig,
  TrajectoryStep,
} from './intelligence-types.js';
