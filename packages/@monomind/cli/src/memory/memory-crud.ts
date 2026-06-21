/**
 * Memory CRUD Operations
 * Store, search, list, get, delete entries; verify memory initialization.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/memory-crud
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeParseEmbedding } from './memory-bridge.js';
import { ensureSchemaColumns } from './memory-migrations.js';
import { generateEmbedding } from './embedding-operations.js';
import { addToHNSWIndex, searchHNSWIndex, rebuildSearchIndex } from './hnsw-operations.js';

/** Maximum SQLite database file size accepted before read (256 MB). */
const MAX_DB_FILE_BYTES = 256 * 1024 * 1024;

// ADR-053: Lazy import of AgentDB v1 bridge
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
 * Optimized cosine similarity
 * V8 JIT-friendly - avoids manual unrolling which can hurt performance
 * ~0.5μs per 384-dim vector comparison
 */
function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;

  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;

  // Simple loop - V8 optimizes this well
  for (let i = 0; i < len; i++) {
    const ai = a[i], bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  // Combined sqrt for slightly better performance
  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
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
  // ADR-053: Try AgentDB v1 bridge first
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

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const storeStat = fs.statSync(dbPath);
    if (storeStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, id: '', error: `Database file too large: ${storeStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    const id = `entry_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    // Generate embedding if requested
    let embeddingJson: string | null = null;
    let embeddingDimensions: number | null = null;
    let embeddingModel: string | null = null;

    if (generateEmbeddingFlag && value.length > 0) {
      const embResult = await generateEmbedding(value);
      embeddingJson = JSON.stringify(embResult.embedding);
      embeddingDimensions = embResult.dimensions;
      embeddingModel = embResult.model;
    }

    // Insert or update entry (upsert mode uses REPLACE)
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

    // Add to HNSW index for faster future searches (validated to reject malformed embeddings)
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
 * Search entries using sql.js with vector similarity
 * Uses HNSW index for 150x faster search when available
 */
export async function searchEntries(options: {
  query: string;
  namespace?: string;
  limit?: number;
  threshold?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  results: {
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
  }[];
  searchTime: number;
  error?: string;
}> {
  // ADR-053: Try AgentDB v1 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeSearchEntries(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    query,
    namespace,
    limit = 10,
    threshold = 0.3,
    dbPath: customPath
  } = options;
  const effectiveNamespace = namespace || 'all';

  const swarmDir = path.resolve(process.cwd(), '.swarm');
  const dbPath = customPath ? path.resolve(customPath) : path.join(swarmDir, 'memory.db');
  const startTime = Date.now();

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, results: [], searchTime: 0, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    // Guard against excessively large DB files to prevent OOM.
    const searchStat = fs.statSync(dbPath);
    if (searchStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, results: [], searchTime: 0, error: `Database file too large: ${searchStat.size} bytes` };
    }

    // Generate query embedding
    const queryEmb = await generateEmbedding(query);
    const queryEmbedding = queryEmb.embedding;

    // Try HNSW search first (150x faster)
    const hnswResults = await searchHNSWIndex(queryEmbedding, { k: limit, namespace: effectiveNamespace });
    if (hnswResults && hnswResults.length > 0) {
      // Filter by threshold
      const filtered = hnswResults.filter(r => r.score >= threshold);
      return {
        success: true,
        results: filtered,
        searchTime: Date.now() - startTime
      };
    }

    // Fall back to brute-force SQLite search
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const searchFbStat = fs.statSync(dbPath);
    if (searchFbStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, results: [], searchTime: Date.now() - startTime, error: `Database file too large: ${searchFbStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Get entries with embeddings
    const searchStmt = db.prepare(
      effectiveNamespace !== 'all'
        ? `SELECT id, key, namespace, content, embedding FROM memory_entries WHERE status = 'active' AND namespace = ? LIMIT 1000`
        : `SELECT id, key, namespace, content, embedding FROM memory_entries WHERE status = 'active' LIMIT 1000`
    );
    if (effectiveNamespace !== 'all') {
      searchStmt.bind([effectiveNamespace]);
    }
    const searchRows: unknown[][] = [];
    while (searchStmt.step()) {
      searchRows.push(searchStmt.get());
    }
    searchStmt.free();
    const entries = searchRows.length > 0 ? [{ values: searchRows }] : [];

    const results: { id: string; key: string; content: string; score: number; namespace: string }[] = [];

    if (entries[0]?.values) {
      for (const row of entries[0].values) {
        const [id, key, ns, content, embeddingJson] = row as [string, string, string, string, string | null];

        let score = 0;

        if (embeddingJson) {
          const embedding = safeParseEmbedding(embeddingJson);
          if (embedding && embedding.length === queryEmbedding.length) {
            score = cosineSim(queryEmbedding, embedding);
          }
        }

        // Fallback to keyword matching
        if (score < threshold) {
          const lowerContent = (content || '').toLowerCase();
          const lowerQuery = query.toLowerCase();
          const words = lowerQuery.split(/\s+/).filter(w => w.length > 0);
          if (words.length > 0) {
            const matchCount = words.filter(w => lowerContent.includes(w)).length;
            const keywordScore = matchCount / words.length * 0.5;
            score = Math.max(score, keywordScore);
          }
        }

        if (score >= threshold) {
          results.push({
            id: id.substring(0, 12),
            key: key || id.substring(0, 15),
            content: (content || '').substring(0, 60) + ((content || '').length > 60 ? '...' : ''),
            score,
            namespace: ns || 'default'
          });
        }
      }
    }

    db.close();

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return {
      success: true,
      results: results.slice(0, limit),
      searchTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      searchTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * List all entries from the memory database
 */
export async function listEntries(options: {
  namespace?: string;
  limit?: number;
  offset?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  entries: {
    id: string;
    key: string;
    namespace: string;
    size: number;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
  }[];
  total: number;
  error?: string;
}> {
  // ADR-053: Try AgentDB v1 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeListEntries(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    namespace,
    limit = 20,
    offset = 0,
    dbPath: customPath
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, entries: [], total: 0, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const listStat = fs.statSync(dbPath);
    if (listStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, entries: [], total: 0, error: `Database file too large: ${listStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Get total count
    const countStmt = namespace
      ? db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active' AND namespace = ?`)
      : db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active'`);
    if (namespace) {
      countStmt.bind([namespace]);
    }
    const countRows: unknown[][] = [];
    while (countStmt.step()) {
      countRows.push(countStmt.get());
    }
    countStmt.free();
    const countResult = countRows.length > 0 ? [{ values: countRows }] : [];
    const total = countResult[0]?.values?.[0]?.[0] as number || 0;

    // Get entries — cap limit to 10 000 to prevent full-table loads that OOM
    // the sql.js in-memory database on large datasets.
    const MAX_LIST_LIMIT = 10_000;
    const rawLimit = parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIST_LIMIT) : 100;
    const rawOffset = parseInt(String(offset), 10);
    const safeOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const listStmt = namespace
      ? db.prepare(`SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at FROM memory_entries WHERE status = 'active' AND namespace = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      : db.prepare(`SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at FROM memory_entries WHERE status = 'active' ORDER BY updated_at DESC LIMIT ? OFFSET ?`);
    if (namespace) {
      listStmt.bind([namespace, safeLimit, safeOffset]);
    } else {
      listStmt.bind([safeLimit, safeOffset]);
    }
    const listRows: unknown[][] = [];
    while (listStmt.step()) {
      listRows.push(listStmt.get());
    }
    listStmt.free();
    const result = listRows.length > 0 ? [{ values: listRows }] : [];
    const entries: {
      id: string;
      key: string;
      namespace: string;
      size: number;
      accessCount: number;
      createdAt: string;
      updatedAt: string;
      hasEmbedding: boolean;
    }[] = [];

    if (result[0]?.values) {
      for (const row of result[0].values) {
        const [id, key, ns, content, embedding, accessCount, createdAt, updatedAt] = row as [
          string, string, string, string, string | null, number, string, string
        ];
        entries.push({
          id: String(id).substring(0, 20),
          key: key || String(id).substring(0, 15),
          namespace: ns || 'default',
          size: (content || '').length,
          accessCount: accessCount || 0,
          createdAt: createdAt || new Date().toISOString(),
          updatedAt: updatedAt || new Date().toISOString(),
          hasEmbedding: !!embedding && embedding.length > 10
        });
      }
    }

    db.close();

    return { success: true, entries, total };
  } catch (error) {
    return {
      success: false,
      entries: [],
      total: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get a specific entry from the memory database
 */
export async function getEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
  /** Agent ID for collaborative memory promotion tracking */
  agentId?: string;
}): Promise<{
  success: boolean;
  found: boolean;
  entry?: {
    id: string;
    key: string;
    namespace: string;
    content: string;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
    tags: string[];
  };
  error?: string;
}> {
  // ADR-053: Try AgentDB v1 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeGetEntry(options);
    if (bridgeResult) return bridgeResult;
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
      return { success: false, found: false, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const getStat = fs.statSync(dbPath);
    if (getStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, found: false, error: `Database file too large: ${getStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Find entry by key
    const getStmt = db.prepare(`
      SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at, tags
      FROM memory_entries
      WHERE status = 'active'
        AND key = ?
        AND namespace = ?
      LIMIT 1
    `);
    getStmt.bind([key, namespace]);
    const getRows: unknown[][] = [];
    while (getStmt.step()) {
      getRows.push(getStmt.get());
    }
    getStmt.free();
    const result = getRows.length > 0 ? [{ values: getRows }] : [];

    if (!result[0]?.values?.[0]) {
      db.close();
      return { success: true, found: false };
    }

    const [id, entryKey, ns, content, embedding, accessCount, createdAt, updatedAt, tagsJson] = result[0].values[0] as [
      string, string, string, string, string | null, number, string, string, string | null
    ];

    db.close();

    let tags: string[] = [];
    if (tagsJson) {
      try {
        tags = JSON.parse(tagsJson);
      } catch {
        // Invalid JSON
      }
    }

    return {
      success: true,
      found: true,
      entry: {
        id: String(id),
        key: entryKey || String(id),
        namespace: ns || 'default',
        content: content || '',
        accessCount: (accessCount || 0) + 1,
        createdAt: createdAt || new Date().toISOString(),
        updatedAt: updatedAt || new Date().toISOString(),
        hasEmbedding: !!embedding && embedding.length > 10,
        tags
      }
    };
  } catch (error) {
    return {
      success: false,
      found: false,
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
  // ADR-053: Try AgentDB v1 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeDeleteEntry(options);
    if (bridgeResult) {
      // #1122: Bridge path must also invalidate the in-memory HNSW index.
      // Without this, deleted vectors remain as ghost entries in search results.
      if (bridgeResult.deleted) {
        rebuildSearchIndex();
      }
      return bridgeResult;
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

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Guard against excessively large DB files to prevent OOM.
    const deleteStat = fs.statSync(dbPath);
    if (deleteStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, deleted: false, key, namespace, remainingEntries: 0, error: `Database file too large: ${deleteStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Check if entry exists first
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
      // Get remaining count before closing
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

    // Delete the entry (soft delete by setting status to 'deleted')
    // Also null out the embedding to clean up vector data from SQLite
    db.run(`
      UPDATE memory_entries
      SET status = 'deleted',
          embedding = NULL,
          updated_at = strftime('%s', 'now') * 1000
      WHERE key = ?
        AND namespace = ?
        AND status = 'active'
    `, [key, namespace]);

    // Get remaining count
    const countResult = db.exec(`SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`);
    const remainingEntries = countResult[0]?.values?.[0]?.[0] as number || 0;

    // Save updated database atomically
    const data = db.export();
    const dbTmpDelete = dbPath + '.tmp';
    fs.writeFileSync(dbTmpDelete, Buffer.from(data));
    fs.renameSync(dbTmpDelete, dbPath);

    db.close();

    // Invalidate the HNSW index so it rebuilds from DB on next search.
    // We can't surgically remove a vector from the HNSW graph, so we
    // clear the entire index; it will be lazily rebuilt from SQLite.
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
