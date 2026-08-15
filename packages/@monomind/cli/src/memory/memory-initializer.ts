/**
 * Memory Initializer
 * Properly initializes the memory database with sql.js (WASM SQLite)
 * Includes pattern tables, vector embeddings, migration state tracking
 *
 * Routes through SQLite-backed memory bridge
 * when available, falls back to raw sql.js for backwards compatibility.
 *
 * @module v1/cli/memory-initializer
 */

import * as fs from 'fs';
import * as path from 'path';
import { BRIDGE_EMBEDDING_DIMS } from './memory-bridge.js';
import { withDbLock } from '../utils/db-mutex.js';
import { secureDbFilePermissions } from './file-permissions.js';

/** Maximum SQLite database file size accepted before read (256 MB). */
const MAX_DB_FILE_BYTES = 256 * 1024 * 1024;

// Lazy import of SQLite-backed memory bridge
let _bridge: typeof import('./memory-bridge.js') | null | undefined;
async function getBridge(): Promise<typeof import('./memory-bridge.js') | null> {
  if (_bridge === null) return null;
  if (_bridge) return _bridge;
  try {
    _bridge = await import('./memory-bridge.js');
    return _bridge;
  } catch {
    _bridge = null;
    return null;
  }
}

// ============================================================================
// Re-exports from extracted modules (ARCH-4)
// ============================================================================

export { MEMORY_SCHEMA } from './memory-schema.js';

export {
  getHNSWIndex,
  addToHNSWIndex,
  searchHNSWIndex,
  getHNSWStatus,
  clearHNSWIndex,
  rebuildSearchIndex,
  quantizeInt8,
  dequantizeInt8,
  quantizedCosineSim,
  getQuantizationStats,
  batchCosineSim,
  softmaxAttention,
  topKIndices,
  flashAttentionSearch,
} from './hnsw-operations.js';

export {
  ensureSchemaColumns,
} from './memory-migrations.js';

export {
  loadEmbeddingModel,
  generateEmbedding,
  generateBatchEmbeddings,
  generateHashEmbedding,
} from './embedding-operations.js';

export {
  verifyMemoryInit,
  storeEntry,
  searchEntries,
  listEntries,
  getEntry,
  deleteEntry,
  clearNamespace,
  listNamespaces,
  compactDatabase,
  getMemoryStats,
  checkMemoryHealth,
  repairMemoryDatabase,
} from './memory-crud.js';

// ============================================================================
// Local imports for use in this file
// ============================================================================

import { MEMORY_SCHEMA } from './memory-schema.js';
import { ensureSchemaColumns } from './memory-migrations.js';
import { rebuildSearchIndex } from './hnsw-operations.js';
import {
  verifyMemoryInit,
  storeEntry,
  searchEntries,
  listEntries,
  getEntry,
  deleteEntry,
} from './memory-crud.js';
import {
  loadEmbeddingModel,
  generateEmbedding,
  generateBatchEmbeddings,
  generateHashEmbedding,
} from './embedding-operations.js';

// ============================================================================
// METADATA AND INITIALIZATION
// ============================================================================

/**
 * Initial metadata to insert after schema creation
 */
export function getInitialMetadata(backend: string): string {
  const safeBackend = backend.replace(/'/g, "''");
  return `
INSERT OR REPLACE INTO metadata (key, value) VALUES
  ('schema_version', '3.0.0'),
  ('backend', '${safeBackend}'),
  ('created_at', '${new Date().toISOString()}'),
  ('sql_js', 'true'),
  ('vector_embeddings', 'enabled'),
  ('pattern_learning', 'enabled'),
  ('temporal_decay', 'enabled'),
  ('hnsw_indexing', 'enabled');

-- Create default vector index configuration
-- Dimensions match BRIDGE_EMBEDDING_DIMS (gte-modernbert-base = 768d).
INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES
  ('default', 'default', ${BRIDGE_EMBEDDING_DIMS}),
  ('patterns', 'patterns', ${BRIDGE_EMBEDDING_DIMS});
`;
}

/**
 * Memory initialization result
 */
export interface MemoryInitResult {
  success: boolean;
  backend: string;
  dbPath: string;
  schemaVersion: string;
  tablesCreated: string[];
  indexesCreated: string[];
  features: {
    vectorEmbeddings: boolean;
    patternLearning: boolean;
    temporalDecay: boolean;
    hnswIndexing: boolean;
    migrationTracking: boolean;
  };
  /** Memory controllers activation state */
  controllers?: {
    activated: string[];
    failed: string[];
    initTimeMs: number;
  };
  error?: string;
}


/**
 * Initialize the memory database properly using sql.js
 */
export async function initializeMemoryDatabase(options: {
  backend?: string;
  dbPath?: string;
  force?: boolean;
  verbose?: boolean;
}): Promise<MemoryInitResult> {
  const {
    backend = 'hybrid',
    dbPath: customPath,
    force = false,
    verbose = false,
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');
  const dbDir = path.dirname(dbPath);

  try {
    // Create directory if needed
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Check existing database
    if (fs.existsSync(dbPath) && !force) {
      return {
        success: false,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [],
        indexesCreated: [],
        features: {
          vectorEmbeddings: false,
          patternLearning: false,
          temporalDecay: false,
          hnswIndexing: false,
          migrationTracking: false
        },
        error: 'Database already exists. Use --force to reinitialize.'
      };
    }

    // Try to use sql.js (WASM SQLite)
    let db: any;
    let usedSqlJs = false;

    try {
      // Dynamic import of sql.js
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();

      // Load existing database or create new
      if (fs.existsSync(dbPath) && force) {
        fs.unlinkSync(dbPath);
      }

      db = new SQL.Database();
      usedSqlJs = true;
    } catch (e) {
      // sql.js not available, fall back to writing schema file
      if (verbose) {
        console.log('sql.js not available, writing schema file for later initialization');
      }
    }

    if (usedSqlJs && db) {
      // Execute schema
      db.run(MEMORY_SCHEMA);

      // Insert initial metadata
      db.run(getInitialMetadata(backend));

      // Save to file atomically — direct writeFileSync to dbPath would corrupt
      // the SQLite file if the process crashes mid-write. tmp+rename is atomic on POSIX.
      const data = db.export();
      const buffer = Buffer.from(data);
      const dbTmp = dbPath + '.tmp';
      fs.writeFileSync(dbTmp, buffer);
      fs.renameSync(dbTmp, dbPath);
      secureDbFilePermissions(dbPath);

      // Close database
      db.close();

      // Also create schema file for reference (atomic)
      const schemaPath = path.join(dbDir, 'schema.sql');
      const schemaTmp = schemaPath + '.tmp';
      fs.writeFileSync(schemaTmp, MEMORY_SCHEMA + '\n' + getInitialMetadata(backend));
      fs.renameSync(schemaTmp, schemaPath);

      return {
        success: true,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [
          'memory_entries',
          'patterns',
          'pattern_history',
          'trajectories',
          'trajectory_steps',
          'migration_state',
          'sessions',
          'vector_indexes',
          'metadata'
        ],
        indexesCreated: [
          'idx_memory_namespace',
          'idx_memory_key',
          'idx_memory_type',
          'idx_memory_status',
          'idx_memory_created',
          'idx_memory_accessed',
          'idx_memory_owner',
          'idx_patterns_type',
          'idx_patterns_confidence',
          'idx_patterns_status',
          'idx_patterns_last_matched',
          'idx_pattern_history_pattern',
          'idx_steps_trajectory'
        ],
        features: {
          vectorEmbeddings: true,
          patternLearning: true,
          temporalDecay: true,
          hnswIndexing: true,
          migrationTracking: true
        },
      };
    } else {
      // R2: sql.js is missing. The previous code wrote a hand-crafted 4 KB
      // "SQLite format 3" buffer to disk and reported success:true — every
      // subsequent read on that file fails (it isn't a real SQLite DB) and
      // checkMemoryInitialization loops forever reporting "not initialized"
      // on a file the user thinks is fresh. Honest behavior: report failure
      // with a clear error so the caller can either install sql.js, switch
      // to the native backend, or skip memory entirely.
      if (verbose) {
        console.error('[memory-initializer] sql.js is not installed and the native @monoes/memory backend is unavailable; refusing to write a fake SQLite header. Install sql.js (npm install sql.js) or @monoes/memory to enable memory.');
      }
      return {
        success: false,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [],
        indexesCreated: [],
        features: {
          vectorEmbeddings: false,
          patternLearning: false,
          temporalDecay: false,
          hnswIndexing: false,
          migrationTracking: false
        },
        error: 'sql.js is not installed and the native @monoes/memory backend is unavailable. Install one of them to enable persistent memory; refusing to write a placeholder SQLite file.'
      };
    }
  } catch (error) {
    return {
      success: false,
      backend,
      dbPath,
      schemaVersion: '3.0.0',
      tablesCreated: [],
      indexesCreated: [],
      features: {
        vectorEmbeddings: false,
        patternLearning: false,
        temporalDecay: false,
        hnswIndexing: false,
        migrationTracking: false
      },
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if memory database is properly initialized
 */
export async function checkMemoryInitialization(dbPath?: string): Promise<{
  initialized: boolean;
  version?: string;
  backend?: string;
  features?: {
    vectorEmbeddings: boolean;
    patternLearning: boolean;
    temporalDecay: boolean;
  };
  tables?: string[];
}> {
  const swarmDir = path.join(process.cwd(), '.swarm');
  const path_ = dbPath || path.join(swarmDir, 'memory.db');

  if (!fs.existsSync(path_)) {
    return { initialized: false };
  }

  try {
    // Try to load with sql.js
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const checkStat = fs.statSync(path_);
    if (checkStat.size > MAX_DB_FILE_BYTES) {
      return { initialized: false };
    }

    const fileBuffer = fs.readFileSync(path_);
    const db = new SQL.Database(fileBuffer);

    // Check for metadata table
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables[0]?.values?.map(v => v[0] as string) || [];

    // Get version
    let version = 'unknown';
    let backend = 'unknown';
    try {
      const versionResult = db.exec("SELECT value FROM metadata WHERE key='schema_version'");
      version = versionResult[0]?.values[0]?.[0] as string || 'unknown';

      const backendResult = db.exec("SELECT value FROM metadata WHERE key='backend'");
      backend = backendResult[0]?.values[0]?.[0] as string || 'unknown';
    } catch {
      // Metadata table might not exist
    }

    db.close();

    return {
      initialized: true,
      version,
      backend,
      features: {
        vectorEmbeddings: tableNames.includes('vector_indexes'),
        patternLearning: tableNames.includes('patterns'),
        temporalDecay: tableNames.includes('pattern_history')
      },
      tables: tableNames
    };
  } catch {
    // Could not read database
    return { initialized: false };
  }
}

/**
 * Apply temporal decay to patterns
 * Reduces confidence of patterns that haven't been used recently
 */
export async function applyTemporalDecay(dbPath?: string): Promise<{
  success: boolean;
  patternsDecayed: number;
  error?: string;
}> {
  const swarmDir = path.join(process.cwd(), '.swarm');
  const path_ = dbPath || path.join(swarmDir, 'memory.db');

  try {
    return await withDbLock(path_, async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const decayStat = fs.statSync(path_);
    if (decayStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, patternsDecayed: 0, error: `Database file too large: ${decayStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(path_);
    const db = new SQL.Database(fileBuffer);

    const now = Date.now();
    // #87: the decay formula is linear (`confidence * (1 - rate * days)`), which
    // goes negative after ~20 days at the default rate 0.05 — downstream code
    // rejects confidence outside [0,1], so stale patterns silently vanished.
    // Clamp at 0.0 so confidence decays to zero instead of wrapping negative.
    const decayQuery = `
      UPDATE patterns
      SET
        confidence = MAX(0.0, confidence * (1.0 - decay_rate * ((? - COALESCE(last_matched_at, created_at)) / 86400000.0))),
        updated_at = ?
      WHERE status = 'active'
        AND confidence > 0.1
        AND (? - COALESCE(last_matched_at, created_at)) > 86400000
    `;

    db.run(decayQuery, [now, now, now]);

    const changes = db.getRowsModified();

    const data = db.export();
    const dbTmpDecay = path_ + '.tmp';
    fs.writeFileSync(dbTmpDecay, Buffer.from(data));
    fs.renameSync(dbTmpDecay, path_);
    secureDbFilePermissions(path_);
    db.close();

    return {
      success: true,
      patternsDecayed: changes
    };
    });
  } catch (error) {
    return {
      success: false,
      patternsDecayed: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export default {
  initializeMemoryDatabase,
  checkMemoryInitialization,
  ensureSchemaColumns,
  applyTemporalDecay,
  loadEmbeddingModel,
  generateEmbedding,
  verifyMemoryInit,
  storeEntry,
  searchEntries,
  listEntries,
  getEntry,
  deleteEntry,
  rebuildSearchIndex,
  MEMORY_SCHEMA,
  getInitialMetadata
};
