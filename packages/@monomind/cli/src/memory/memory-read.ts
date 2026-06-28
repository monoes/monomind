/**
 * Memory Read Operations
 * Search, list, and get entries from the memory database.
 * Split from memory-crud.ts (ARCH-4b).
 *
 * @module v1/cli/memory-read
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeParseEmbedding } from './memory-bridge.js';
import { ensureSchemaColumns } from './memory-migrations.js';
import { generateEmbedding } from './embedding-operations.js';
import { searchHNSWIndex } from './hnsw-operations.js';

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

/**
 * Optimized cosine similarity
 * V8 JIT-friendly - avoids manual unrolling which can hurt performance
 * ~0.5μs per 384-dim vector comparison
 */
function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;

  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;

  for (let i = 0; i < len; i++) {
    const ai = a[i], bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
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
  // ADR-053: Try LanceDB memory bridge first
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

    await ensureSchemaColumns(dbPath);

    const searchStat = fs.statSync(dbPath);
    if (searchStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, results: [], searchTime: 0, error: `Database file too large: ${searchStat.size} bytes` };
    }

    const queryEmb = await generateEmbedding(query);
    const queryEmbedding = queryEmb.embedding;

    // Try HNSW search first (150x faster)
    const hnswResults = await searchHNSWIndex(queryEmbedding, { k: limit, namespace: effectiveNamespace });
    if (hnswResults && hnswResults.length > 0) {
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

    const searchFbStat = fs.statSync(dbPath);
    if (searchFbStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, results: [], searchTime: Date.now() - startTime, error: `Database file too large: ${searchFbStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

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
  // ADR-053: Try LanceDB memory bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeListEntries(options);
    if (bridgeResult) return {
      success: bridgeResult.success,
      total: bridgeResult.total,
      error: bridgeResult.error,
      entries: bridgeResult.entries.map((e: { id: string; key: string; namespace: string; content?: string; accessCount: number; createdAt: string; updatedAt: string; hasEmbedding: boolean }) => ({
        id: e.id, key: e.key, namespace: e.namespace,
        size: typeof e.content === 'string' ? e.content.length : 0,
        accessCount: e.accessCount, createdAt: e.createdAt, updatedAt: e.updatedAt, hasEmbedding: e.hasEmbedding,
      })),
    };
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

    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const listStat = fs.statSync(dbPath);
    if (listStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, entries: [], total: 0, error: `Database file too large: ${listStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

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
  // ADR-053: Try LanceDB memory bridge first
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

    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const getStat = fs.statSync(dbPath);
    if (getStat.size > MAX_DB_FILE_BYTES) {
      return { success: false, found: false, error: `Database file too large: ${getStat.size} bytes` };
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

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
