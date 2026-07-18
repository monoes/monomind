/**
 * Memory Bridge — Routes CLI memory operations through LanceDB
 *
 * Uses LanceDBBackend from @monoes/memory.
 * All exported function signatures are unchanged.
 *
 * @module v1/cli/memory-bridge
 */

import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';

// ===== Embedding validation =====

const MAX_EMBEDDING_DIMS = 8192;
const MAX_EMBEDDING_JSON_BYTES = MAX_EMBEDDING_DIMS * 32; // ~256KB ceiling

export function safeParseEmbedding(raw: string | null | undefined): number[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length > MAX_EMBEDDING_JSON_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0 || parsed.length > MAX_EMBEDDING_DIMS) return null;
  for (let i = 0; i < parsed.length; i++) {
    const v = parsed[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  }
  return parsed as number[];
}

// ===== Constants =====

const BRIDGE_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const BRIDGE_EMBEDDING_DIMS = 384;
const BRIDGE_MAX_KEY_LEN = 4 * 1024;
const BRIDGE_MAX_VALUE_LEN = 1024 * 1024;
const MAX_TAGS = 32;
const MAX_TAG_LEN = 64;

// ===== DB path resolution =====

// LanceDB commits via atomic rename, which exFAT/SMB project volumes don't support
// (ENOTSUP os error 45) — and non-APFS volumes grow ._ AppleDouble sidecars inside
// the .lance datasets that corrupt reads. So the store always lives on the home
// volume, namespaced per project directory.
//
// The slug is a hash of the full resolved path, not a character-substitution of
// it — flattening separators to '-' is not collision-safe ('/x/foo-bar' and
// '/x/foo/bar' would both flatten to 'x-foo-bar'). A short readable prefix is
// kept purely so the directory name is browsable; only the hash guarantees
// uniqueness.
function projectDataDir(): string {
  const resolved = path.resolve(process.cwd());
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const readable = path.basename(resolved).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'project';
  return path.join(os.homedir(), '.monomind', 'projects', `${readable}-${hash}`);
}

/** Resolve symlinks so the traversal check below can't be bypassed by a link
 * that lexically resolves inside the allowed trees but points outside them. */
function realOrResolved(p: string): string {
  try { return fs.realpathSync(p); } catch { return p; }
}

/** The personal, cross-project knowledge store. Deliberately a SIBLING of
 *  ~/.monomind/projects (never inside it) so per-project pruning heuristics
 *  (`cleanup --data`) can never touch it. Env-overridable for tests and for
 *  users who keep their brain on a synced/external location. Resolved lazily
 *  so the override works regardless of import order. */
export function getGlobalBrainDir(): string {
  return process.env.MONOMIND_GLOBAL_BRAIN_DIR || path.join(os.homedir(), '.monomind', 'global-brain');
}
/** Sentinel callers pass as dbPath to address the global brain. */
export const GLOBAL_BRAIN = '@global';

function getDbPath(customPath?: string): string {
  const defaultDir = path.join(projectDataDir(), 'lancedb');
  if (!customPath || customPath === ':memory:') return defaultDir;
  if (customPath === GLOBAL_BRAIN) return getGlobalBrainDir();
  // Treat legacy .db paths (and the legacy .swarm dir) as a signal to use the default
  if (customPath.endsWith('.db')) return defaultDir;
  const resolved = realOrResolved(path.resolve(customPath));
  // Guard against path traversal from MCP inputs: only allow paths inside the
  // project, the per-project home data dir, or the global brain.
  const relCwd = path.relative(realOrResolved(process.cwd()), resolved);
  const relHome = path.relative(realOrResolved(projectDataDir()), resolved);
  const relGlobal = path.relative(realOrResolved(getGlobalBrainDir()), resolved);
  if (!relCwd.startsWith('..') && !path.isAbsolute(relCwd)) return resolved;
  if (!relHome.startsWith('..') && !path.isAbsolute(relHome)) return resolved;
  if (!relGlobal.startsWith('..') && !path.isAbsolute(relGlobal)) return resolved;
  return defaultDir;
}

/** Resolve the real on-disk LanceDB path for a given custom path (or the default). */
export function bridgeGetDbPath(customPath?: string): string {
  return getDbPath(customPath);
}

function getAutomemConfig(): { dedupThreshold: number; staleDays: number } {
  const defaults = { dedupThreshold: 0.85, staleDays: 7 };
  try {
    const configPath = path.join(process.cwd(), '.monomind', 'automem-config.json');
    if (!fs.existsSync(configPath)) return defaults;
    const stat = fs.statSync(configPath);
    if (stat.size > 64 * 1024) return defaults;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      dedupThreshold: typeof config?.scaffold?.dedupThreshold === 'number' ? config.scaffold.dedupThreshold : defaults.dedupThreshold,
      staleDays: typeof config?.scaffold?.staleDays === 'number' ? config.scaffold.staleDays : defaults.staleDays,
    };
  } catch { return defaults; }
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

// ===== Lazy per-path backend cache =====
//
// One backend PER resolved store directory (project store, global brain, test
// fixtures) — the old module-level singleton bound the whole process to the
// FIRST dbPath it saw and silently served every later caller from that store,
// which both blocked the global brain and could misroute org memory.
// The embedding model stays process-wide: it's the expensive part and is
// store-independent.

interface BackendSlot {
  promise: Promise<any> | null;
  instance: any | null;
  available: boolean | null;
  attempts: number;
}
const backendSlots = new Map<string, BackendSlot>();
let _embedder: ((text: string) => Promise<Float32Array>) | null = null;
let _embedderPromise: Promise<void> | null = null;
const MAX_INIT_ATTEMPTS = 3;

/** Flush after mutations: the sql.js fallback backend is in-memory WASM and
 *  only reaches disk via persist(); the CLI process is short-lived, so waiting
 *  for an auto-persist interval would lose writes. No-op on better-sqlite3. */
async function flushBackend(backend: any): Promise<void> {
  try { await backend?.persist?.(); } catch { /* best effort */ }
}

async function loadEmbedder(): Promise<void> {
  if (_embedder) return;
  if (!_embedderPromise) {
    _embedderPromise = (async () => {
      try {
        const hf = await import('@huggingface/transformers' as string);
        // revision must be a git ref — 'main' is the HF default; 'default' 404s and
        // silently killed embeddings (every search degraded to keyword matching)
        // dtype pinned explicitly: transformers.js logs a "dtype not specified"
        // warning to the console on every load otherwise (leaks into CLI output).
        const extractor = await (hf as any).pipeline('feature-extraction', BRIDGE_EMBEDDING_MODEL, { revision: 'main', dtype: 'fp32' });
        _embedder = async (text: string) => {
          const output = await extractor(text, { pooling: 'mean', normalize: true });
          return new Float32Array(output.data);
        };
      } catch (e) {
        _embedderPromise = null; // allow retry (e.g. first call offline)
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[memory-bridge] embedding model failed to load — store and search without vectors:', e);
      }
    })();
  }
  await _embedderPromise;
}

async function getBackend(dbPath?: string): Promise<any | null> {
  const dir = getDbPath(dbPath);
  let slot = backendSlots.get(dir);
  if (!slot) { slot = { promise: null, instance: null, available: null, attempts: 0 }; backendSlots.set(dir, slot); }
  if (slot.available === false) return null;
  if (slot.attempts >= MAX_INIT_ATTEMPTS) { slot.available = false; return null; }
  if (slot.instance) return slot.instance;

  if (!slot.promise) {
    slot.promise = (async () => {
      try {
        const mod = await import('@monoes/memory' as string);
        await loadEmbedder();

        // Local SQLite engine (LanceDB replaced 2026-07): better-sqlite3 when its
        // native binding loads, sql.js (pure WASM) otherwise — both persist text
        // AND embeddings, so vectors are always recomputable/derivable data.
        fs.mkdirSync(dir, { recursive: true });
        // Origin marker: records which project this data dir belongs to, so
        // `monomind cleanup --data` can verifiably prune dirs whose project
        // no longer exists (the dir-name hash is one-way). Best-effort; never
        // written for the global brain (it has no single origin project).
        if (dir !== getGlobalBrainDir()) {
          try {
            const originFile = path.join(projectDataDir(), 'origin.json');
            fs.writeFileSync(originFile, JSON.stringify({ path: path.resolve(process.cwd()), updatedAt: new Date().toISOString() }) + '\n', 'utf-8');
          } catch { /* non-fatal */ }
        }
        const cfg = {
          databasePath: path.join(dir, 'memory.db'),
          walMode: true,
          optimize: true,
          defaultNamespace: 'default',
          embeddingGenerator: _embedder ?? undefined,
        };

        const origLog = console.log;
        console.log = (...args: unknown[]) => {
          const msg = String(args[0] ?? '');
          if (msg.includes('Transformers.js') || msg.includes('Loading model')) return;
          origLog.apply(console, args);
        };
        let backend: any;
        try {
          try {
            backend = new mod.SQLiteBackend(cfg);
            await backend.initialize();
          } catch (e) {
            if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[memory-bridge] better-sqlite3 unavailable — using sql.js backend:', e);
            backend = new mod.SqlJsBackend(cfg);
            await backend.initialize();
          }
        } finally {
          console.log = origLog;
        }

        slot.instance = backend;
        slot.available = true;
        return backend;
      } catch {
        slot.attempts++;
        slot.promise = null;
        if (slot.attempts >= MAX_INIT_ATTEMPTS) slot.available = false;
        return null;
      }
    })();
  }

  return slot.promise;
}

// ===== Core CRUD =====

export async function bridgeStoreEntry(options: {
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
  guarded?: boolean;
  cached?: boolean;
  attested?: boolean;
  duplicate?: boolean;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const key = typeof options.key === 'string' && options.key.length > BRIDGE_MAX_KEY_LEN
      ? options.key.slice(0, BRIDGE_MAX_KEY_LEN) : options.key;
    const value = typeof options.value === 'string' && options.value.length > BRIDGE_MAX_VALUE_LEN
      ? options.value.slice(0, BRIDGE_MAX_VALUE_LEN) : options.value;
    const namespace = options.namespace ?? 'default';
    const tags = Array.isArray(options.tags)
      // src: tags carry the ingest source path for excerpt provenance — paths
      // routinely exceed the general 64-char tag cap, so they get 512.
      ? options.tags.filter(t => typeof t === 'string' && t.length > 0 && t.length <= (t.startsWith('src:') ? 512 : MAX_TAG_LEN)).slice(0, MAX_TAGS)
      : [];

    const now = Date.now();
    const id = generateId('entry');

    // Generate embedding
    let embedding: Float32Array | undefined;
    let embeddingInfo: { dimensions: number; model: string } | undefined;

    if (options.generateEmbeddingFlag !== false && value.length > 0 && _embedder) {
      try {
        embedding = await _embedder(value);
        embeddingInfo = { dimensions: embedding.length, model: BRIDGE_EMBEDDING_MODEL };
      } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[memory-bridge] embedding generation failed — storing entry without embedding:', e);
      }
    }

    const mod = await import('@monoes/memory' as string);
    const entry = mod.createDefaultEntry({
      key,
      content: value,
      namespace,
      tags,
      expiresAt: options.ttl ? now + options.ttl * 1000 : undefined,
    });
    // Override id and set embedding
    entry.id = id;
    if (embedding) entry.embedding = embedding;

    // Upsert: find any existing entry with the same key+namespace — deleted
    // only AFTER the new entry stores successfully, so a failed store() can't
    // destroy the existing data (old order was delete-then-store).
    let upsertVictim: { id: string } | null = null;
    if (options.upsert) {
      try {
        upsertVictim = await backend.getByKey(namespace, key);
      } catch { /* treat as no existing entry */ }
    }

    // Dedup gate: skip if a near-duplicate already exists IN THIS NAMESPACE —
    // an unscoped search let a similar entry in some other namespace swallow
    // the store entirely (returned duplicate:true, nothing written where asked).
    const automemCfg = getAutomemConfig();
    if (embedding && !options.upsert) {
      try {
        const similar = await backend.search(embedding, {
          k: 1, threshold: automemCfg.dedupThreshold,
          filters: { type: 'exact', namespace },
        });
        if (similar.length > 0 && similar[0].score >= automemCfg.dedupThreshold) {
          return { success: true, id: similar[0].entry.id, duplicate: true };
        }
      } catch { /* non-fatal — store anyway */ }
    }

    await backend.store(entry);
    if (upsertVictim && upsertVictim.id !== id) {
      try { await backend.delete(upsertVictim.id); }
      catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[memory-bridge] upsert stored new entry but failed to delete the old one — duplicate may remain:', e);
      }
    }
    await flushBackend(backend);

    return { success: true, id, embedding: embeddingInfo };
  } catch (err: any) {
    return { success: false, id: '', error: String(err?.message ?? err) };
  }
}

export async function bridgeSearchEntries(options: {
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
    provenance?: string;
    tags?: string[];
  }[];
  searchTime: number;
  searchMethod?: string;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const { query: queryStr, limit = 10, threshold = 0.3 } = options;
    // CLI callers pass 'all' as a no-filter sentinel — never treat it as a literal namespace
    const namespace = options.namespace && options.namespace !== 'all' ? options.namespace : undefined;
    const startTime = Date.now();

    let results: any[] = [];
    let searchMethod = 'keyword';

    if (_embedder && queryStr.length > 0) {
      try {
        const queryEmbedding = await _embedder(queryStr);
        const searchResults = await backend.search(queryEmbedding, {
          k: limit,
          threshold,
          filters: namespace ? { type: 'exact', namespace } : undefined,
        });
        results = searchResults.map((r: any) => ({
          id: r.entry.id,
          key: r.entry.key,
          content: r.entry.content || '',
          score: r.score,
          namespace: r.entry.namespace,
          provenance: `semantic:${r.score.toFixed(3)}`,
          tags: r.entry.tags ?? [],
          _createdAt: r.entry.createdAt || 0,
        }));
        searchMethod = 'semantic';
      } catch { /* fall through to keyword search */ }
    }

    // Keyword fallback — scan all entries in namespace (not just first 100)
    // to avoid missing documents that were ingested later in the batch.
    if (results.length === 0) {
      // No namespace filter means ALL namespaces — collapsing to 'default'
      // made "search everything" silently miss every non-default entry.
      const entries = await backend.query({
        type: 'exact',
        ...(namespace ? { namespace } : {}),
        limit: 50000,
      });
      // Token-based matching, not whole-phrase substring: "semantic test" must
      // match an entry keyed "semantic-test" (the old .includes(query) required
      // the exact phrase — including its whitespace — to appear verbatim).
      // Score = fraction of query tokens present in key+content.
      const tokens = queryStr.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
      if (tokens.length) {
        results = entries
          .map((e: any) => {
            const haystack = `${e.key || ''} ${e.content || ''}`.toLowerCase();
            const hits = tokens.filter(t => haystack.includes(t)).length;
            return { e, score: hits / tokens.length };
          })
          .filter((x: any) => x.score > 0)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, limit)
          .map(({ e, score }: any) => ({
            id: e.id,
            key: e.key,
            content: e.content || '',
            score: Math.min(0.9, 0.3 + score * 0.6),
            namespace: e.namespace,
            provenance: `keyword:${score.toFixed(2)}`,
            tags: e.tags ?? [],
            _createdAt: e.createdAt || 0,
          }));
      }
      searchMethod = 'keyword';
    }

    // Filter stale entries based on automem config — skip for knowledge
    // namespaces (documents should remain searchable indefinitely)
    // Stale filtering is per-RESULT namespace (documents stay searchable
    // forever) — keying it on the query's namespace filter meant an
    // all-namespace search silently dropped knowledge:* results past the
    // stale cutoff.
    const isKnowledgeNs = namespace?.startsWith('knowledge:');
    if (!isKnowledgeNs) {
      const { staleDays } = getAutomemConfig();
      const staleCutoff = Date.now() - staleDays * 86400000;
      results = results.filter((r: any) =>
        String(r.namespace ?? '').startsWith('knowledge:')
        || !r._createdAt || r._createdAt > staleCutoff);
    }
    results.forEach((r: any) => delete r._createdAt);

    return {
      success: true,
      results,
      searchTime: Date.now() - startTime,
      searchMethod,
    };
  } catch {
    return null;
  }
}

export async function bridgeListEntries(options: {
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
    content: string;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
    tags: string[];
  }[];
  total: number;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const entries = await backend.query({
      type: 'exact' as any,
      namespace: options.namespace ?? 'default',
      limit: options.limit ?? 100,
      offset: options.offset,
    });

    return {
      success: true,
      entries: entries.map((e: any) => ({
        id: e.id,
        key: e.key,
        namespace: e.namespace,
        content: e.content,
        accessCount: e.accessCount ?? 0,
        createdAt: new Date(e.createdAt).toISOString(),
        updatedAt: new Date(e.updatedAt).toISOString(),
        hasEmbedding: !!(e.embedding && (e.embedding as any).length > 0),
        tags: e.tags ?? [],
      })),
      total: entries.length,
    };
  } catch {
    return null;
  }
}

export async function bridgeGetEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
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
  cacheHit?: boolean;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const { key, namespace = 'default' } = options;
    const entry = await backend.getByKey(namespace, key);

    if (!entry) return { success: true, found: false };

    return {
      success: true,
      found: true,
      entry: {
        id: entry.id,
        key: entry.key,
        namespace: entry.namespace,
        content: entry.content,
        accessCount: entry.accessCount ?? 0,
        createdAt: new Date(entry.createdAt).toISOString(),
        updatedAt: new Date(entry.updatedAt).toISOString(),
        hasEmbedding: !!(entry.embedding && (entry.embedding as any).length > 0),
        tags: entry.tags ?? [],
      },
    };
  } catch {
    return null;
  }
}

export async function bridgeDeleteEntry(options: {
  key?: string;
  id?: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const namespace = options.namespace ?? 'default';
    let deleted = false;

    if (options.id) {
      deleted = await backend.delete(options.id);
    } else if (options.key) {
      const entry = await backend.getByKey(namespace, options.key);
      if (entry) deleted = await backend.delete(entry.id);
    }
    if (deleted) await flushBackend(backend);

    return { success: true, deleted };
  } catch {
    return { success: false, deleted: false };
  }
}

// ===== Embeddings =====

export async function bridgeGenerateEmbedding(
  text: string,
  dbPath?: string,
): Promise<{ embedding: number[]; dimensions: number; model: string } | null> {
  await getBackend(dbPath); // ensure embedder is initialized
  if (!_embedder) return null;

  try {
    const emb = await _embedder(text);
    return { embedding: Array.from(emb), dimensions: emb.length, model: BRIDGE_EMBEDDING_MODEL };
  } catch {
    return null;
  }
}

export async function bridgeLoadEmbeddingModel(
  dbPath?: string,
): Promise<{
  success: boolean;
  dimensions: number;
  modelName: string;
  loadTime?: number;
} | null> {
  const startTime = Date.now();
  await getBackend(dbPath);

  if (!_embedder) return null;

  try {
    const test = await _embedder('test');
    if (!test) return null;
    return {
      success: true,
      dimensions: test.length,
      modelName: BRIDGE_EMBEDDING_MODEL,
      loadTime: Date.now() - startTime,
    };
  } catch {
    return null;
  }
}

export async function bridgeGetBackendStats(
  dbPath?: string,
): Promise<{ totalEntries: number; entriesByNamespace: Record<string, number>; memoryUsage: number } | null> {
  const backend = await getBackend(dbPath);
  if (!backend) return null;
  try {
    const stats = await backend.getStats();
    return {
      totalEntries: stats?.totalEntries ?? 0,
      entriesByNamespace: stats?.entriesByNamespace ?? {},
      memoryUsage: stats?.memoryUsage ?? 0,
    };
  } catch {
    return null;
  }
}

// ===== HNSW (replaced by LanceDB ANN — stubs kept for API compat) =====

export async function bridgeGetHNSWStatus(
  dbPath?: string,
): Promise<{
  built: boolean;
  size: number;
  dimensions: number;
  error?: string;
} | null> {
  const backend = await getBackend(dbPath);
  if (!backend) return null;

  try {
    const stats = await backend.getStats();
    return { built: true, size: stats?.totalEntries ?? 0, dimensions: BRIDGE_EMBEDDING_DIMS };
  } catch {
    return { built: false, size: 0, dimensions: BRIDGE_EMBEDDING_DIMS };
  }
}

export async function bridgeSearchHNSW(options: {
  query: string;
  limit?: number;
  threshold?: number;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  results: { id: string; key: string; score: number; namespace?: string }[];
  searchTime: number;
  indexSize?: number;
  error?: string;
} | null> {
  // Delegate to bridgeSearchEntries which uses LanceDB ANN
  const result = await bridgeSearchEntries({
    query: options.query,
    namespace: options.namespace,
    limit: options.limit,
    threshold: options.threshold,
    dbPath: options.dbPath,
  });
  if (!result) return null;
  return {
    success: result.success,
    results: result.results.map(r => ({ id: r.id, key: r.key, score: r.score, namespace: r.namespace })),
    searchTime: result.searchTime,
  };
}

export async function bridgeAddToHNSW(options: {
  id: string;
  embedding: number[];
  namespace?: string;
  dbPath?: string;
}): Promise<{ success: boolean; indexSize?: number; error?: string } | null> {
  // LanceDB indexes entries automatically on store — this is a no-op
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;
  try {
    const stats = await backend.getStats();
    return { success: true, indexSize: stats?.totalEntries ?? 0 };
  } catch {
    return { success: true };
  }
}

// ===== Controller stubs (LanceDB has no equivalent controllers) =====

export async function bridgeGetController(
  controllerName: string,
  dbPath?: string,
): Promise<any | null> {
  await getBackend(dbPath);
  return null;
}

export async function bridgeHasController(
  controllerName: string,
  dbPath?: string,
): Promise<boolean> {
  return false;
}

export async function bridgeListControllers(
  dbPath?: string,
): Promise<{ controllers: string[]; active: string[] } | null> {
  const backend = await getBackend(dbPath);
  if (!backend) return null;
  return { controllers: [], active: [] };
}

// ===== Availability / lifecycle =====

export async function isBridgeAvailable(dbPath?: string): Promise<boolean> {
  const backend = await getBackend(dbPath);
  return !!backend;
}

export async function getControllerRegistry(dbPath?: string): Promise<any | null> {
  return getBackend(dbPath);
}

export async function shutdownBridge(): Promise<void> {
  for (const slot of backendSlots.values()) {
    if (slot.instance) {
      try { await slot.instance.shutdown(); } catch { /* ignore */ }
    }
  }
  backendSlots.clear();
  _embedder = null;
  _embedderPromise = null;
}

// ===== Pattern store =====

export async function bridgeStorePattern(options: {
  pattern: string;
  taskType?: string;
  outcome?: string;
  confidence?: number;
  dbPath?: string;
}): Promise<{ success: boolean; id: string; error?: string } | null> {
  return bridgeStoreEntry({
    key: `pattern_${options.taskType ?? 'general'}_${generateId('p')}`,
    value: JSON.stringify({
      pattern: options.pattern,
      taskType: options.taskType,
      outcome: options.outcome,
      confidence: options.confidence ?? 0.5,
    }),
    namespace: 'patterns',
    tags: options.taskType ? [options.taskType] : [],
    generateEmbeddingFlag: true,
    dbPath: options.dbPath,
  });
}

export async function bridgeSearchPatterns(options: {
  query: string;
  taskType?: string;
  limit?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  patterns: { id: string; pattern: string; confidence: number; taskType?: string; score: number }[];
  error?: string;
} | null> {
  const result = await bridgeSearchEntries({
    query: options.query,
    namespace: 'patterns',
    limit: options.limit ?? 5,
    dbPath: options.dbPath,
  });
  if (!result) return null;

  return {
    success: result.success,
    patterns: result.results.map(r => {
      let parsed: any = {};
      try { parsed = JSON.parse(r.content); } catch { /* use raw */ }
      return {
        id: r.id,
        pattern: parsed.pattern ?? r.content,
        confidence: parsed.confidence ?? r.score,
        taskType: parsed.taskType,
        score: r.score,
      };
    }),
  };
}

// ===== Feedback =====

export async function bridgeRecordFeedback(options: {
  taskType: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial';
  confidence?: number;
  metadata?: Record<string, unknown>;
  dbPath?: string;
}): Promise<{ success: boolean; id: string; error?: string } | null> {
  return bridgeStoreEntry({
    key: `feedback_${options.taskType}_${Date.now()}`,
    value: JSON.stringify({
      taskType: options.taskType,
      action: options.action,
      outcome: options.outcome,
      confidence: options.confidence ?? 0.5,
      metadata: options.metadata ?? {},
      recordedAt: Date.now(),
    }),
    namespace: 'feedback',
    tags: [options.taskType, options.outcome],
    generateEmbeddingFlag: true,
    dbPath: options.dbPath,
  });
}

// ===== Causal edges =====

export async function bridgeRecordCausalEdge(options: {
  sourceId: string;
  targetId: string;
  relation: string;
  strength?: number;
  dbPath?: string;
}): Promise<{ success: boolean; id: string; error?: string } | null> {
  return bridgeStoreEntry({
    key: `causal_${options.sourceId}_${options.targetId}`,
    value: JSON.stringify({
      sourceId: options.sourceId,
      targetId: options.targetId,
      relation: options.relation,
      strength: options.strength ?? 1.0,
    }),
    namespace: 'causal',
    tags: ['causal', options.relation],
    generateEmbeddingFlag: false,
    dbPath: options.dbPath,
    upsert: true,
  });
}

// ===== Session lifecycle =====

export async function bridgeSessionStart(options: {
  sessionId: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  dbPath?: string;
}): Promise<{ success: boolean; id: string; error?: string } | null> {
  return bridgeStoreEntry({
    key: `session_${options.sessionId}`,
    value: JSON.stringify({
      sessionId: options.sessionId,
      agentId: options.agentId,
      startedAt: Date.now(),
      status: 'active',
      metadata: options.metadata ?? {},
    }),
    namespace: 'sessions',
    tags: ['session', 'active'],
    generateEmbeddingFlag: false,
    dbPath: options.dbPath,
    upsert: true,
  });
}

export async function bridgeSessionEnd(options: {
  sessionId: string;
  summary?: string;
  metrics?: Record<string, unknown>;
  dbPath?: string;
}): Promise<{ success: boolean; error?: string } | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const existing = await backend.getByKey('sessions', `session_${options.sessionId}`);
    if (existing) {
      let data: any = {};
      try { data = JSON.parse(existing.content); } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[memory-bridge] session content failed to parse — ending session with empty prior state:', e);
      }
      await backend.update(existing.id, {
        content: JSON.stringify({
          ...data,
          status: 'ended',
          endedAt: Date.now(),
          summary: options.summary,
          metrics: options.metrics ?? {},
        }),
        tags: ['session', 'ended'],
      });
      await flushBackend(backend);
    }
    return { success: true };
  } catch {
    return { success: false };
  }
}

// ===== Task routing =====

export async function bridgeRouteTask(options: {
  task: string;
  topK?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  routes: { agentType: string; confidence: number; pattern?: string }[];
  error?: string;
} | null> {
  const result = await bridgeSearchEntries({
    query: options.task,
    namespace: 'patterns',
    limit: options.topK ?? 3,
    dbPath: options.dbPath,
  });
  if (!result) return null;

  return {
    success: result.success,
    routes: result.results.map(r => {
      let parsed: any = {};
      try { parsed = JSON.parse(r.content); } catch { /* use raw */ }
      return {
        agentType: parsed.taskType ?? 'coder',
        confidence: r.score,
        pattern: parsed.pattern,
      };
    }),
  };
}

// ===== Health check =====

export async function bridgeHealthCheck(
  dbPath?: string,
): Promise<{
  healthy: boolean;
  backend: string;
  stats?: { totalEntries: number; namespaces: string[] };
  error?: string;
} | null> {
  const backend = await getBackend(dbPath);
  if (!backend) return { healthy: false, backend: 'lancedb', error: 'unavailable' };

  try {
    const health = await backend.healthCheck?.();
    const stats = await backend.getStats?.();
    return {
      healthy: health?.healthy ?? true,
      backend: 'lancedb',
      stats: stats ? {
        totalEntries: stats.totalEntries ?? 0,
        namespaces: Object.keys(stats.entriesByNamespace ?? {}),
      } : undefined,
    };
  } catch {
    return { healthy: false, backend: 'lancedb' };
  }
}

// ===== Hierarchical memory =====

export async function bridgeHierarchicalStore(params: {
  key: string;
  value: string;
  tier?: string;
  importance?: number;
}): Promise<any> {
  return bridgeStoreEntry({
    key: params.key,
    value: params.value,
    namespace: `tier_${params.tier ?? 'working'}`,
    tags: [params.tier ?? 'working'],
    generateEmbeddingFlag: true,
  });
}

export async function bridgeHierarchicalRecall(params: {
  query: string;
  tier?: string;
  topK?: number;
}): Promise<any> {
  return bridgeSearchEntries({
    query: params.query,
    namespace: params.tier ? `tier_${params.tier}` : undefined,
    limit: params.topK ?? 5,
  });
}

// ===== Consolidation =====

export async function bridgeConsolidate(params: {
  minAge?: number;
  maxEntries?: number;
}): Promise<any> {
  const backend = await getBackend();
  if (!backend) return { success: false, consolidated: 0 };

  try {
    const minAge = params.minAge ?? 7 * 24 * 3600 * 1000; // default: 7 days
    const cutoff = Date.now() - minAge;
    const entries = await backend.query({
      type: 'exact' as any,
      namespace: 'default',
      limit: params.maxEntries ?? 1000,
    });
    let deleted = 0;
    for (const e of entries) {
      if (e.updatedAt < cutoff && e.accessCount === 0) {
        await backend.delete(e.id).catch(() => { /* non-fatal */ });
        deleted++;
      }
    }
    if (deleted) await flushBackend(backend);
    return { success: true, consolidated: deleted };
  } catch {
    return { success: false, consolidated: 0 };
  }
}

// ===== Batch operations =====

export async function bridgeBatchOperation(params: {
  operation: string;
  entries: any[];
}): Promise<any> {
  const backend = await getBackend();
  if (!backend) return { success: false, processed: 0 };

  try {
    let processed = 0;
    if (params.operation === 'store') {
      for (const e of params.entries) {
        const result = await bridgeStoreEntry({ key: e.key, value: e.value, namespace: e.namespace });
        if (result?.success) processed++;
      }
    } else if (params.operation === 'delete') {
      for (const e of params.entries) {
        const result = await bridgeDeleteEntry({ key: e.key, namespace: e.namespace });
        if (result?.deleted) processed++;
      }
    }
    return { success: true, processed };
  } catch {
    return { success: false, processed: 0 };
  }
}

// ===== Context synthesis =====

export async function bridgeContextSynthesize(params: {
  query: string;
  maxEntries?: number;
}): Promise<any> {
  const result = await bridgeSearchEntries({
    query: params.query,
    limit: params.maxEntries ?? 5,
  });
  if (!result?.success) return null;

  const context = result.results.map(r => `[${r.key}]: ${r.content}`).join('\n');
  return { success: true, context, sources: result.results.length };
}

// ===== Semantic routing =====

export async function bridgeSemanticRoute(params: { input: string }): Promise<any> {
  return bridgeRouteTask({ task: params.input });
}
