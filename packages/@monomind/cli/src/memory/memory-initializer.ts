/**
 * Memory Initializer
 * Properly initializes the memory database with sql.js (WASM SQLite)
 * Includes pattern tables, vector embeddings, migration state tracking
 *
 * ADR-053: Routes through ControllerRegistry → LanceDB when available,
 * falls back to raw sql.js for backwards compatibility.
 *
 * @module v1/cli/memory-initializer
 */

import * as fs from 'fs';
import * as path from 'path';

/** Maximum SQLite database file size accepted before read (256 MB). */
const MAX_DB_FILE_BYTES = 256 * 1024 * 1024;

// ADR-053: Lazy import of LanceDB memory bridge
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
  checkAndMigrateLegacy,
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
} from './memory-crud.js';

// ============================================================================
// Local imports for use in this file
// ============================================================================

import { MEMORY_SCHEMA } from './memory-schema.js';
import { checkAndMigrateLegacy, ensureSchemaColumns } from './memory-migrations.js';
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
-- Dimensions match BRIDGE_EMBEDDING_DIMS=384 (Xenova/all-MiniLM-L6-v2).
INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES
  ('default', 'default', 384),
  ('patterns', 'patterns', 384);
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
  /** ADR-053: Controllers activated via ControllerRegistry */
  controllers?: {
    activated: string[];
    failed: string[];
    initTimeMs: number;
  };
  error?: string;
}

/**
 * ADR-053: Activate ControllerRegistry so LanceDB controllers
 * (ReasoningBank, SkillLibrary, ExplainableRecall, etc.) are instantiated.
 *
 * Uses the memory-bridge's getControllerRegistry() which lazily creates
 * a singleton ControllerRegistry and initializes it with the given dbPath.
 * After this call, all enabled controllers are ready for immediate use.
 *
 * Failures are isolated: if @monomind/memory or LanceDB is not available,
 * this returns an empty result without throwing.
 */
async function activateControllerRegistry(
  dbPath: string,
  verbose?: boolean,
): Promise<{ activated: string[]; failed: string[]; initTimeMs: number }> {
  const startTime = performance.now();
  const activated: string[] = [];
  const failed: string[] = [];

  try {
    const bridge = await getBridge();
    if (!bridge) {
      return { activated, failed, initTimeMs: performance.now() - startTime };
    }

    const registry = await bridge.getControllerRegistry(dbPath);
    if (!registry) {
      return { activated, failed, initTimeMs: performance.now() - startTime };
    }

    // Collect controller status from the registry
    if (typeof registry.listControllers === 'function') {
      const controllers = registry.listControllers();
      for (const ctrl of controllers) {
        if (ctrl.enabled) {
          activated.push(ctrl.name);
        } else {
          failed.push(ctrl.name);
        }
      }
    }

    if (verbose && activated.length > 0) {
      console.log(`ControllerRegistry: ${activated.length} controllers activated`);
    }
  } catch {
    // ControllerRegistry activation is best-effort
  }

  return { activated, failed, initTimeMs: performance.now() - startTime };
}

/**
 * Initialize the memory database properly using sql.js
 */
export async function initializeMemoryDatabase(options: {
  backend?: string;
  dbPath?: string;
  force?: boolean;
  verbose?: boolean;
  migrate?: boolean;
}): Promise<MemoryInitResult> {
  const {
    backend = 'hybrid',
    dbPath: customPath,
    force = false,
    verbose = false,
    migrate = true
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');
  const dbDir = path.dirname(dbPath);

  try {
    // Create directory if needed
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Check for legacy installations
    if (migrate) {
      const legacyCheck = await checkAndMigrateLegacy({ dbPath, verbose });
      if (legacyCheck.needsMigration && verbose) {
        console.log(`Found legacy database (v${legacyCheck.legacyVersion}) with ${legacyCheck.legacyEntries} entries`);
      }
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

      // Close database
      db.close();

      // Also create schema file for reference (atomic)
      const schemaPath = path.join(dbDir, 'schema.sql');
      const schemaTmp = schemaPath + '.tmp';
      fs.writeFileSync(schemaTmp, MEMORY_SCHEMA + '\n' + getInitialMetadata(backend));
      fs.renameSync(schemaTmp, schemaPath);

      // ADR-053: Activate ControllerRegistry so controllers (ReasoningBank,
      // SkillLibrary, ExplainableRecall, etc.) are instantiated during init
      const controllerResult = await activateControllerRegistry(dbPath, verbose);

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
        controllers: controllerResult,
      };
    } else {
      // Fall back to schema file approach (atomic writes)
      const schemaPath = path.join(dbDir, 'schema.sql');
      const schemaTmpFb = schemaPath + '.tmp';
      fs.writeFileSync(schemaTmpFb, MEMORY_SCHEMA + '\n' + getInitialMetadata(backend));
      fs.renameSync(schemaTmpFb, schemaPath);

      // Create minimal valid SQLite file
      const sqliteHeader = Buffer.alloc(4096, 0);
      // SQLite format 3 header
      Buffer.from('SQLite format 3\0').copy(sqliteHeader, 0);
      sqliteHeader[16] = 0x10; // page size high byte (4096)
      sqliteHeader[17] = 0x00; // page size low byte
      sqliteHeader[18] = 0x01; // file format write version
      sqliteHeader[19] = 0x01; // file format read version
      sqliteHeader[24] = 0x00; // max embedded payload
      sqliteHeader[25] = 0x40;
      sqliteHeader[26] = 0x20; // min embedded payload
      sqliteHeader[27] = 0x20; // leaf payload

      const dbTmpFb = dbPath + '.tmp';
      fs.writeFileSync(dbTmpFb, sqliteHeader);
      fs.renameSync(dbTmpFb, dbPath);

      // ADR-053: Activate ControllerRegistry even on fallback path
      const controllerResult = await activateControllerRegistry(dbPath, verbose);

      return {
        success: true,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [
          'memory_entries (pending)',
          'patterns (pending)',
          'pattern_history (pending)',
          'trajectories (pending)',
          'trajectory_steps (pending)',
          'migration_state (pending)',
          'sessions (pending)',
          'vector_indexes (pending)',
          'metadata (pending)'
        ],
        indexesCreated: [],
        features: {
          vectorEmbeddings: true,
          patternLearning: true,
          temporalDecay: true,
          hnswIndexing: true,
          migrationTracking: true
        },
        controllers: controllerResult,
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
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const decayStat = fs.statSync(path_);
    if (decayStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, patternsDecayed: 0, error: `Database file too large: ${decayStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(path_);
    const db = new SQL.Database(fileBuffer);

    // Apply decay: confidence *= exp(-decay_rate * days_since_last_use)
    const now = Date.now();
    const decayQuery = `
      UPDATE patterns
      SET
        confidence = confidence * (1.0 - decay_rate * ((? - COALESCE(last_matched_at, created_at)) / 86400000.0)),
        updated_at = ?
      WHERE status = 'active'
        AND confidence > 0.1
        AND (? - COALESCE(last_matched_at, created_at)) > 86400000
    `;

    db.run(decayQuery, [now, now, now]);

    const changes = db.getRowsModified();

    // Save atomically
    const data = db.export();
    const dbTmpDecay = path_ + '.tmp';
    fs.writeFileSync(dbTmpDecay, Buffer.from(data));
    fs.renameSync(dbTmpDecay, path_);
    db.close();

    return {
      success: true,
      patternsDecayed: changes
    };
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
  checkAndMigrateLegacy,
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
