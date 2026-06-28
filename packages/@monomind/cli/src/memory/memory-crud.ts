/**
 * Memory Write Operations
 * Verify initialization, store, and delete entries.
 * Read operations (search, list, get) live in memory-read.ts (ARCH-4b split).
 *
 * @module v1/cli/memory-crud
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeParseEmbedding } from './memory-bridge.js';
import { ensureSchemaColumns } from './memory-migrations.js';
import { generateEmbedding } from './embedding-operations.js';
import { addToHNSWIndex, rebuildSearchIndex } from './hnsw-operations.js';

// Re-export read operations so existing callers keep working without changes.
export { searchEntries, listEntries, getEntry } from './memory-read.js';

/** Maximum SQLite database file size accepted before read (256 MB). */
const MAX_DB_FILE_BYTES = 256 * 1024 * 1024;

// ADR-053: Lazy import of memory bridge
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

/**
 * Verify memory initialization works correctly
 * Tests: write, read, search, patterns
 */
export async function verifyMemoryInit(dbPath: string, options?: {
  verbose?: boolean;
}): Promise<{
  success: boolean;
  tests: {
    name: string;
    passed: boolean;
    details?: string;
    duration?: number;
  }[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
}> {
  const { verbose = false } = options || {};
  const tests: { name: string; passed: boolean; details?: string; duration?: number }[] = [];

  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const fs = await import('fs');

    // Guard against excessively large DB files to prevent OOM.
    const verifyStat = fs.statSync(dbPath);
    if (verifyStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, tests: [{ name: 'Database access', passed: false, details: `File too large: ${verifyStat.size} bytes` }], summary: { passed: 0, failed: 1, total: 1 } };
    }

    // Load database
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Test 1: Schema verification
    const schemaStart = Date.now();
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables[0]?.values?.map(v => v[0] as string) || [];
    const expectedTables = ['memory_entries', 'patterns', 'metadata', 'vector_indexes'];
    const missingTables = expectedTables.filter(t => !tableNames.includes(t));

    tests.push({
      name: 'Schema verification',
      passed: missingTables.length === 0,
      details: missingTables.length > 0 ? `Missing: ${missingTables.join(', ')}` : `${tableNames.length} tables found`,
      duration: Date.now() - schemaStart
    });

    // Test 2: Write entry
    const writeStart = Date.now();
    const testId = `test_${Date.now()}`;
    const testKey = 'verification_test';
    const testValue = 'This is a verification test entry for memory initialization';

    try {
      db.run(`
        INSERT INTO memory_entries (id, key, namespace, content, type, created_at, updated_at)
        VALUES (?, ?, 'test', ?, 'semantic', ?, ?)
      `, [testId, testKey, testValue, Date.now(), Date.now()]);

      tests.push({
        name: 'Write entry',
        passed: true,
        details: 'Entry written successfully',
        duration: Date.now() - writeStart
      });
    } catch (e) {
      tests.push({
        name: 'Write entry',
        passed: false,
        details: e instanceof Error ? e.message : 'Write failed',
        duration: Date.now() - writeStart
      });
    }

    // Test 3: Read entry
    const readStart = Date.now();
    try {
      const result = db.exec(`SELECT content FROM memory_entries WHERE id = ?`, [testId]);
      const content = result[0]?.values[0]?.[0] as string;

      tests.push({
        name: 'Read entry',
        passed: content === testValue,
        details: content === testValue ? 'Content matches' : 'Content mismatch',
        duration: Date.now() - readStart
      });
    } catch (e) {
      tests.push({
        name: 'Read entry',
        passed: false,
        details: e instanceof Error ? e.message : 'Read failed',
        duration: Date.now() - readStart
      });
    }

    // Test 4: Write with embedding
    const embeddingStart = Date.now();
    try {
      const { embedding, dimensions, model } = await generateEmbedding(testValue);
      const embeddingJson = JSON.stringify(embedding);

      db.run(`
        UPDATE memory_entries
        SET embedding = ?, embedding_dimensions = ?, embedding_model = ?
        WHERE id = ?
      `, [embeddingJson, dimensions, model, testId]);

      tests.push({
        name: 'Generate embedding',
        passed: true,
        details: `${dimensions}-dim vector (${model})`,
        duration: Date.now() - embeddingStart
      });
    } catch (e) {
      tests.push({
        name: 'Generate embedding',
        passed: false,
        details: e instanceof Error ? e.message : 'Embedding failed',
        duration: Date.now() - embeddingStart
      });
    }

    // Test 5: Pattern storage
    const patternStart = Date.now();
    try {
      const patternId = `pattern_${Date.now()}`;
      db.run(`
        INSERT INTO patterns (id, name, pattern_type, condition, action, confidence, created_at, updated_at)
        VALUES (?, 'test-pattern', 'task-routing', 'test condition', 'test action', 0.5, ?, ?)
      `, [patternId, Date.now(), Date.now()]);

      tests.push({
        name: 'Pattern storage',
        passed: true,
        details: 'Pattern stored with confidence scoring',
        duration: Date.now() - patternStart
      });

      // Cleanup test pattern
      db.run(`DELETE FROM patterns WHERE id = ?`, [patternId]);
    } catch (e) {
      tests.push({
        name: 'Pattern storage',
        passed: false,
        details: e instanceof Error ? e.message : 'Pattern storage failed',
        duration: Date.now() - patternStart
      });
    }

    // Test 6: Vector index configuration
    const indexStart = Date.now();
    try {
      const indexResult = db.exec(`SELECT name, dimensions, hnsw_m, hnsw_ef_construction FROM vector_indexes`);
      const indexes = indexResult[0]?.values || [];

      tests.push({
        name: 'Vector index config',
        passed: indexes.length > 0,
        details: `${indexes.length} indexes configured (HNSW M=16, ef=200)`,
        duration: Date.now() - indexStart
      });
    } catch (e) {
      tests.push({
        name: 'Vector index config',
        passed: false,
        details: e instanceof Error ? e.message : 'Index check failed',
        duration: Date.now() - indexStart
      });
    }

    // Cleanup test entry
    db.run(`DELETE FROM memory_entries WHERE id = ?`, [testId]);

    // Save changes atomically
    const data = db.export();
    const dbTmpHealth = dbPath + '.tmp';
    fs.writeFileSync(dbTmpHealth, Buffer.from(data));
    fs.renameSync(dbTmpHealth, dbPath);
    db.close();

    const passed = tests.filter(t => t.passed).length;
    const failed = tests.filter(t => !t.passed).length;

    return {
      success: failed === 0,
      tests,
      summary: {
        passed,
        failed,
        total: tests.length
      }
    };
  } catch (error) {
    return {
      success: false,
      tests: [{
        name: 'Database access',
        passed: false,
        details: error instanceof Error ? error.message : 'Unknown error'
      }],
      summary: { passed: 0, failed: 1, total: 1 }
    };
  }
}

/**
 * Store an entry directly using sql.js
 * This bypasses MCP and writes directly to the database
 */
export async function storeEntry(options: {
  key: string;
  value: string;
  namespace?: string;
  generateEmbeddingFlag?: boolean;
  tags?: string[];
  ttl?: number;
  dbPath?: string;
  upsert?: boolean;
}): Promise<{
  success: boolean;
  id: string;
  embedding?: { dimensions: number; model: string };
  error?: string;
}> {
  // ADR-053: Try LanceDB memory bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeStoreEntry(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    key,
    value,
    namespace = 'default',
    generateEmbeddingFlag = true,
    tags = [],
    ttl,
    dbPath: customPath,
    upsert = false
  } = options;

  const swarmDir = path.resolve(process.cwd(), '.swarm');
  const dbPath = customPath ? path.resolve(customPath) : path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, id: '', error: 'Database not initialized. Run: monomind memory init' };
    }

    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const storeStat = fs.statSync(dbPath);
    if (storeStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, id: '', error: `Database file too large: ${storeStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    const id = `entry_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    let embeddingJson: string | null = null;
    let embeddingDimensions: number | null = null;
    let embeddingModel: string | null = null;

    if (generateEmbeddingFlag && value.length > 0) {
      const embResult = await generateEmbedding(value);
      embeddingJson = JSON.stringify(embResult.embedding);
      embeddingDimensions = embResult.dimensions;
      embeddingModel = embResult.model;
    }

    const insertSql = upsert
      ? `INSERT OR REPLACE INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      : `INSERT INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`;

    db.run(insertSql, [
      id,
      key,
      namespace,
      value,
      embeddingJson,
      embeddingDimensions,
      embeddingModel,
      tags.length > 0 ? JSON.stringify(tags) : null,
      '{}',
      now,
      now,
      ttl ? now + (ttl * 1000) : null
    ]);

    // Save atomically
    const data = db.export();
    const dbTmpStore = dbPath + '.tmp';
    fs.writeFileSync(dbTmpStore, Buffer.from(data));
    fs.renameSync(dbTmpStore, dbPath);
    db.close();

    // Add to HNSW index for faster future searches
    if (embeddingJson) {
      const embResult = safeParseEmbedding(embeddingJson);
      if (embResult) {
        await addToHNSWIndex(id, embResult, {
          id,
          key,
          namespace,
          content: value
        });
      }
    }

    return {
      success: true,
      id,
      embedding: embeddingJson ? { dimensions: embeddingDimensions!, model: embeddingModel! } : undefined
    };
  } catch (error) {
    return {
      success: false,
      id: '',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Delete a memory entry by key and namespace
 * Issue #980: Properly supports namespaced entries
 */
export async function deleteEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  key: string;
  namespace: string;
  remainingEntries: number;
  error?: string;
}> {
  // ADR-053: Try LanceDB memory bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeDeleteEntry(options);
    if (bridgeResult) {
      // #1122: Bridge path must also invalidate the in-memory HNSW index.
      if (bridgeResult.deleted) {
        rebuildSearchIndex();
      }
      return { ...bridgeResult, key: options.key, namespace: options.namespace ?? 'default', remainingEntries: 0 };
    }
  }

  // Fallback: raw sql.js
  const {
    key,
    namespace = 'default',
    dbPath: customPath
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return {
        success: false,
        deleted: false,
        key,
        namespace,
        remainingEntries: 0,
        error: 'Database not found'
      };
    }

    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const deleteStat = fs.statSync(dbPath);
    if (deleteStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, deleted: false, key, namespace, remainingEntries: 0, error: `Database file too large: ${deleteStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    const checkStmt = db.prepare(`
      SELECT id FROM memory_entries
      WHERE status = 'active'
        AND key = ?
        AND namespace = ?
      LIMIT 1
    `);
    checkStmt.bind([key, namespace]);
    const checkRows: unknown[][] = [];
    while (checkStmt.step()) {
      checkRows.push(checkStmt.get());
    }
    checkStmt.free();
    const checkResult = checkRows.length > 0 ? [{ values: checkRows }] : [];

    if (!checkResult[0]?.values?.[0]) {
      const countResult = db.exec(`SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`);
      const remainingEntries = countResult[0]?.values?.[0]?.[0] as number || 0;
      db.close();
      return {
        success: true,
        deleted: false,
        key,
        namespace,
        remainingEntries,
        error: `Key '${key}' not found in namespace '${namespace}'`
      };
    }

    db.run(`
      UPDATE memory_entries
      SET status = 'deleted',
          embedding = NULL,
          updated_at = strftime('%s', 'now') * 1000
      WHERE key = ?
        AND namespace = ?
        AND status = 'active'
    `, [key, namespace]);

    const countResult = db.exec(`SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`);
    const remainingEntries = countResult[0]?.values?.[0]?.[0] as number || 0;

    // Save updated database atomically
    const data = db.export();
    const dbTmpDelete = dbPath + '.tmp';
    fs.writeFileSync(dbTmpDelete, Buffer.from(data));
    fs.renameSync(dbTmpDelete, dbPath);

    db.close();

    // Invalidate the HNSW index so it rebuilds from DB on next search.
    rebuildSearchIndex();

    return {
      success: true,
      deleted: true,
      key,
      namespace,
      remainingEntries
    };
  } catch (error) {
    return {
      success: false,
      deleted: false,
      key,
      namespace,
      remainingEntries: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
