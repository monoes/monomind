/**
 * Memory Bridge — Routes CLI memory operations through SQLite
 *
 * Uses SQLiteBackend (better-sqlite3, sql.js WASM fallback) from @monoes/memory.
 * LanceDB was replaced by this SQLite engine 2026-07; the on-disk data
 * directory is still named `lancedb` for legacy/back-compat path resolution
 * (see getDbPath below) but no longer holds LanceDB data.
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

/**
 * R1: surface swallowed errors when DEBUG/MONOMIND_DEBUG is on. The bridge
 * has ~12 `} catch { return null; }` sites that collapse SQLITE_BUSY,
 * EACCES, disk-full, and schema mismatches into "no matches" with zero
 * diagnostic. Behavior contract (return null on failure) is unchanged;
 * observability is added. Caller passes the bridge fn name + the thrown
 * value so the log is greppable per call site.
 */
function logBridgeError(label: string, err: unknown): void {
  if (!(process.env.DEBUG || process.env.MONOMIND_DEBUG)) return;
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[bridge:${label}] ${msg}`);
}

export function safeParseEmbedding(raw: string | null | undefined): number[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length > MAX_EMBEDDING_JSON_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    logBridgeError('safeParseEmbedding', e);
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0 || parsed.length > MAX_EMBEDDING_DIMS) return null;
  for (let i = 0; i < parsed.length; i++) {
    const v = parsed[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  }
  return parsed as number[];
}

// ===== Constants =====

export const BRIDGE_EMBEDDING_MODEL = 'Alibaba-NLP/gte-modernbert-base';
export const BRIDGE_EMBEDDING_DIMS = 768;
const BRIDGE_MAX_KEY_LEN = 4 * 1024;
const BRIDGE_MAX_VALUE_LEN = 16 * 1024;
const MAX_TAGS = 32;
const MAX_TAG_LEN = 64;
// Search results serve the head of the stored content only — full values bloat
// every MCP payload. Entries needing the full text can read the entry by key.
const BRIDGE_RESULT_CONTENT_CAP = 500;

function capResultContent(content: string): string {
  return content.length > BRIDGE_RESULT_CONTENT_CAP
    ? content.slice(0, BRIDGE_RESULT_CONTENT_CAP) + '…'
    : content;
}

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
function walkToProjectRoot(start: string): string {
  const home = path.resolve(os.homedir());
  let dir = start;
  for (;;) {
    if (dir === home) break;
    try {
      if (fs.existsSync(path.join(dir, '.monomind')) || fs.existsSync(path.join(dir, '.git')))
        return dir;
    } catch (e) {
      logBridgeError('walkToProjectRoot', e); /* unreadable dir — keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

// getBackend() resolves the store path on every store/search, so a bulk ingest
// would otherwise repeat the stat walk thousands of times. A project does not
// gain or lose its markers mid-process; the key is the starting directory, so a
// chdir still re-resolves.
let _rootCacheKey: string | undefined;
let _rootCacheVal: string | undefined;

/** The directory that identifies "this project" for every Second Brain store.
 *
 * Deliberately NOT the raw cwd: keying on cwd forked the brain per directory —
 * `doc ingest ./docs` from a package subdir wrote to a different store, and a
 * different metadata file, than the identical command at the repo root, and
 * neither could see the other. We walk up to the nearest ancestor carrying a
 * `.monomind` or `.git` marker, so every directory inside one project resolves
 * to one brain. Nested projects still win (the walk stops at the FIRST marker),
 * which keeps worktrees and vendored sub-repos independent.
 *
 * The walk never crosses the home directory: a dotfiles repo at `~` would
 * otherwise swallow every loose project underneath it into one shared brain.
 *
 * For anyone who already ran from the project root — the normal case — the
 * resolved path is identical to before, so their store does not move.
 *
 * `MONOMIND_CWD` wins over the real cwd, matching `getProjectCwd()` in
 * mcp-tools/types.ts — an MCP server is launched with whatever cwd the client
 * chose, and that env var is already how monograph and swarm state learn which
 * project they belong to. Inlined rather than imported to keep this module on
 * node builtins only (see the static import in document-pipeline.ts).
 */
export function getProjectRoot(from: string = process.env.MONOMIND_CWD || process.cwd()): string {
  const start = path.resolve(from);
  if (start === _rootCacheKey && _rootCacheVal !== undefined) return _rootCacheVal;
  const resolved = walkToProjectRoot(start);
  _rootCacheKey = start;
  _rootCacheVal = resolved;
  return resolved;
}

function projectDataDir(): string {
  const resolved = path.resolve(getProjectRoot());
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const readable =
    path
      .basename(resolved)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 40) || 'project';
  return path.join(os.homedir(), '.monomind', 'projects', `${readable}-${hash}`);
}

/** Resolve symlinks so the traversal check below can't be bypassed by a link
 * that lexically resolves inside the allowed trees but points outside them. */
function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    logBridgeError('realOrResolved', e);
    return p;
  }
}

/** The personal, cross-project knowledge store. Deliberately a SIBLING of
 *  ~/.monomind/projects (never inside it) so per-project pruning heuristics
 *  (`cleanup --data`) can never touch it. Env-overridable for tests and for
 *  users who keep their brain on a synced/external location. Resolved lazily
 *  so the override works regardless of import order. */
export function getGlobalBrainDir(): string {
  return (
    process.env.MONOMIND_GLOBAL_BRAIN_DIR || path.join(os.homedir(), '.monomind', 'global-brain')
  );
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
  const relCwd = path.relative(realOrResolved(getProjectRoot()), resolved);
  const relHome = path.relative(realOrResolved(projectDataDir()), resolved);
  const relGlobal = path.relative(realOrResolved(getGlobalBrainDir()), resolved);
  if (!relCwd.startsWith('..') && !path.isAbsolute(relCwd)) return resolved;
  if (!relHome.startsWith('..') && !path.isAbsolute(relHome)) return resolved;
  if (!relGlobal.startsWith('..') && !path.isAbsolute(relGlobal)) return resolved;
  return defaultDir;
}

/** Resolve the real on-disk SQLite data-dir path for a given custom path (or the
 *  default) — the dir is still named `lancedb` for legacy path back-compat. */
export function bridgeGetDbPath(customPath?: string): string {
  return getDbPath(customPath);
}

function getAutomemConfig(): {
  dedupThreshold: number;
  staleDays: number;
  feedbackInfluence: number;
} {
  const defaults = { dedupThreshold: 0.85, staleDays: 7, feedbackInfluence: 0.2 };
  try {
    const configPath = path.join(process.cwd(), '.monomind', 'automem-config.json');
    if (!fs.existsSync(configPath)) return defaults;
    const stat = fs.statSync(configPath);
    if (stat.size > 64 * 1024) return defaults;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      dedupThreshold:
        typeof config?.scaffold?.dedupThreshold === 'number'
          ? config.scaffold.dedupThreshold
          : defaults.dedupThreshold,
      staleDays:
        typeof config?.scaffold?.staleDays === 'number'
          ? config.scaffold.staleDays
          : defaults.staleDays,
      feedbackInfluence:
        typeof config?.scaffold?.feedbackInfluence === 'number'
          ? Math.max(0, Math.min(1, config.scaffold.feedbackInfluence))
          : defaults.feedbackInfluence,
    };
  } catch (e) {
    logBridgeError('loadBridgeConfig', e);
    return defaults;
  }
}

// ===== Usage/feedback weights (cognee-style, stored in entry metadata) =====
//
// feedback_weight (0..1, default 0.5): EWMA of explicit/auto ratings applied to
// the entries actually used to produce an answer. frequency_weight (>=0): how
// often the entry was returned by a search. Both live in the entry's metadata
// JSON — deliberately NOT backend schema columns, so no @monoes/memory publish
// is needed and both backends work unchanged.

const DEFAULT_FEEDBACK_WEIGHT = 0.5;
const FEEDBACK_EWMA_ALPHA = 0.1;
/** frequency_weight normalization ceiling: 10+ uses counts as fully reinforced. */
const FREQUENCY_NORM_CAP = 10;

function entryWeights(metadata: unknown): { feedback: number; frequency: number } {
  const md = (metadata ?? {}) as Record<string, unknown>;
  const fw =
    typeof md.feedback_weight === 'number' && Number.isFinite(md.feedback_weight)
      ? Math.max(0, Math.min(1, md.feedback_weight))
      : DEFAULT_FEEDBACK_WEIGHT;
  const freq =
    typeof md.frequency_weight === 'number' && Number.isFinite(md.frequency_weight)
      ? Math.max(0, md.frequency_weight)
      : 0;
  return { feedback: fw, frequency: freq };
}

/** Blend learned usefulness into a GENUINE embedding-similarity score.
 *  Cognee guard: never applied to keyword-fallback scores — those carry no
 *  real relevance signal, and blending there lets a high-feedback stale entry
 *  outrank relevant matches and self-reinforce (rich-get-richer). */
function blendScore(
  cosineSim: number,
  weights: { feedback: number; frequency: number },
  influence: number,
): number {
  if (influence <= 0) return cosineSim;
  const usefulness =
    0.7 * weights.feedback + 0.3 * Math.min(1, weights.frequency / FREQUENCY_NORM_CAP);
  return (1 - influence) * cosineSim + influence * usefulness;
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
const MAX_BACKEND_SLOTS = 5;
let _embedder: ((text: string) => Promise<Float32Array>) | null = null;
let _embedderPromise: Promise<void> | null = null;
const MAX_INIT_ATTEMPTS = 3;

// ===== Lazy cross-encoder reranker (ettin-32m) =====
//
// Same ORT constraints as the embedder (ADR-R001). Loaded only when the first
// search with >1 candidate completes — never on store, never on startup.
// Disabled with MONOMIND_RERANKER=0.
//
// The upstream HF ONNX file for ettin-reranker-32m-v1 only contains the base
// ModernBERT encoder (outputs last_hidden_state, no logits). The classifier
// head lives in separate sentence-transformers module safetensors files
// (2_Dense, 3_LayerNorm, 4_Dense). We use a self-exported ONNX that bakes the
// full pipeline (base + CLS pooling + head) into one file with `logits` output.
// The export script is at scripts/export-ettin-onnx.py; the result is cached
// under ~/.monomind/models/ettin-reranker-32m-v1-onnx/.

export const BRIDGE_RERANKER_MODEL = 'cross-encoder/ettin-reranker-32m-v1';

/** Local path to the self-exported ONNX model with classifier head baked in. */
function rerankerModelDir(): string {
  return path.join(os.homedir(), '.monomind', 'models', 'ettin-reranker-32m-v1-onnx');
}

let _reranker: ((query: string, passage: string) => Promise<number>) | null = null;
let _rerankerPromise: Promise<void> | null = null;

/** Pre-load the cross-encoder reranker model. Idempotent, no-op when
 *  MONOMIND_RERANKER=0. Exported so the eval harness can force-load before
 *  the network guard blocks model downloads. */
export async function loadReranker(): Promise<void> {
  if (_reranker) return;
  if (process.env.MONOMIND_RERANKER === '0') return;
  if (!_rerankerPromise) {
    _rerankerPromise = (async () => {
      try {
        // Use the self-exported ONNX with classifier head baked in.
        // Falls back to the upstream HF model id if the local export doesn't
        // exist (will fail with local_files_only unless the user has previously
        // downloaded an ONNX with logits output).
        const modelDir = rerankerModelDir();
        const localOnnx = path.join(modelDir, 'onnx', 'model.onnx');
        const modelId = fs.existsSync(localOnnx) ? modelDir : BRIDGE_RERANKER_MODEL;

        const hf = await import('@huggingface/transformers' as string);
        const opts = { local_files_only: true };
        const tokenizer = await (hf as any).AutoTokenizer.from_pretrained(modelId, opts);
        const model = await (hf as any).AutoModelForSequenceClassification.from_pretrained(
          modelId,
          opts,
        );
        _reranker = async (query: string, passage: string) => {
          const inputs = await tokenizer(query, {
            text_pair: passage,
            padding: true,
            truncation: true,
          });
          const output = await model(inputs);
          const logits: Float32Array = output.logits.data;
          // num_labels=1 → [1,1] regression score, apply sigmoid
          return 1 / (1 + Math.exp(-logits[0]));
        };
      } catch (e) {
        _rerankerPromise = null; // allow retry
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[memory-bridge] reranker failed to load:', e);
      }
    })();
  }
  await _rerankerPromise;
}

/** Rerank an array of results using the cross-encoder. Mutates nothing; returns
 *  a new sorted array with reranker scores in provenance. */
async function rerankResults(
  query: string,
  results: any[],
  limit: number,
): Promise<{ reranked: any[]; applied: boolean }> {
  if (!_reranker || results.length <= 1) return { reranked: results, applied: false };
  try {
    const scored = await Promise.all(
      results.map(async (r) => {
        const rerankerScore = await _reranker!(query, r.content || '');
        return {
          ...r,
          score: rerankerScore,
          provenance: `${r.provenance ?? ''}→rerank:${rerankerScore.toFixed(3)}`,
        };
      }),
    );
    scored.sort((a, b) => b.score - a.score);
    return { reranked: scored.slice(0, limit), applied: true };
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[memory-bridge] reranking failed — returning original order:', e);
    return { reranked: results, applied: false };
  }
}

/** Flush after mutations: the sql.js fallback backend is in-memory WASM and
 *  only reaches disk via persist(); the CLI process is short-lived, so waiting
 *  for an auto-persist interval would lose writes. No-op on better-sqlite3. */
async function flushBackend(backend: any): Promise<void> {
  try {
    await backend?.persist?.();
  } catch (e) {
    logBridgeError('flushBackend', e); /* best effort */
  }
}

/** Loads the local embedding model.
 *
 *  This is the single point where `onnxruntime-node` enters the CLI process
 *  (via @huggingface/transformers). Once it has run, the process is subject to
 *  docs/adrs/ADR-R001-onnxruntime-process-teardown.md: calling process.exit()
 *  will abort with SIGABRT ("mutex lock failed") instead of exiting cleanly,
 *  and disposing the pipeline first does not help.
 *
 *  Anything that reaches this — `doctor`, `memory store`, `memory search`, the
 *  MCP memory tools — inherits that constraint, which is why it bit commands
 *  that look nothing like ML work. Adding a new caller is fine; adding a new
 *  process-exit path is not. */
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
        const extractor = await (hf as any).pipeline('feature-extraction', BRIDGE_EMBEDDING_MODEL, {
          revision: 'main',
          dtype: 'q8',
          local_files_only: true,
        });
        _embedder = async (text: string) => {
          const output = await extractor(text, { pooling: 'cls', normalize: true });
          return new Float32Array(output.data);
        };
      } catch (e) {
        _embedderPromise = null; // allow retry (e.g. first call offline)
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error(
            '[memory-bridge] embedding model failed to load — store and search without vectors:',
            e,
          );
      }
    })();
  }
  await _embedderPromise;
}

async function getBackend(dbPath?: string): Promise<any | null> {
  const dir = getDbPath(dbPath);
  let slot = backendSlots.get(dir);
  if (!slot) {
    if (backendSlots.size >= MAX_BACKEND_SLOTS) {
      const oldest = backendSlots.keys().next().value!;
      const evicted = backendSlots.get(oldest);
      // shutdownBridge() below uses .shutdown() — that's the real method these
      // backends expose. .close() doesn't exist on either backend class, so this
      // resolved to undefined via the optional chain every time and never actually
      // released the connection: every 6th distinct database path opened in this
      // process leaked the oldest slot's connection for the process lifetime.
      try {
        await evicted?.instance?.shutdown?.();
      } catch (e) {
        logBridgeError('getBackend.evictedShutdown', e); /* best effort */
      }
      backendSlots.delete(oldest);
    }
    slot = { promise: null, instance: null, available: null, attempts: 0 };
    backendSlots.set(dir, slot);
  }
  if (slot.available === false) return null;
  if (slot.attempts >= MAX_INIT_ATTEMPTS) {
    slot.available = false;
    return null;
  }
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
            // MUST be the same path projectDataDir() hashed into the slug. If
            // this recorded the raw cwd, running any memory command from a
            // package subdirectory would stamp that subdirectory into the
            // project-root-keyed dir — and deleting the subdirectory later
            // would make `cleanup --data` prune the WHOLE project's brain as
            // orphaned.
            const originFile = path.join(projectDataDir(), 'origin.json');
            fs.writeFileSync(
              originFile,
              JSON.stringify({ path: getProjectRoot(), updatedAt: new Date().toISOString() }) +
                '\n',
              'utf-8',
            );
          } catch (e) {
            logBridgeError('getBackend.originWrite', e); /* non-fatal */
          }
        }
        const cfg = {
          databasePath: path.join(dir, 'memory.db'),
          walMode: true,
          optimize: true,
          defaultNamespace: 'default',
          embeddingGenerator: _embedder ?? undefined,
          // R3: when the MCP server and a CLI hook subprocess hit the same
          // memory.db at the same time, SQLite returns SQLITE_BUSY and the
          // bridge silently no-ops. busy_timeout tells SQLite to wait up to
          // 5s for a lock before giving up, which covers the normal handoff
          // window. The native @monoes/memory backend reads this key.
          busyTimeoutMs: 5000,
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
            if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
              console.error(
                '[memory-bridge] better-sqlite3 unavailable — using sql.js backend:',
                e,
              );
            backend = new mod.SqlJsBackend(cfg);
            await backend.initialize();
          }
        } finally {
          console.log = origLog;
        }

        slot.instance = backend;
        slot.available = true;
        return backend;
      } catch (e) {
        slot.attempts++;
        slot.promise = null;
        if (slot.attempts >= MAX_INIT_ATTEMPTS) slot.available = false;
        logBridgeError('getBackend', e);
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
  /** Structured metadata persisted on the entry (KG nodes/edges, weights, provenance). */
  metadata?: Record<string, unknown>;
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
    const key =
      typeof options.key === 'string' && options.key.length > BRIDGE_MAX_KEY_LEN
        ? options.key.slice(0, BRIDGE_MAX_KEY_LEN)
        : options.key;
    if (typeof options.value === 'string' && options.value.length > BRIDGE_MAX_VALUE_LEN) {
      return {
        success: false,
        id: '',
        error: `Value exceeds the ${BRIDGE_MAX_VALUE_LEN}-character cap (BRIDGE_MAX_VALUE_LEN = 16 KB); got ${options.value.length}. Split the content into smaller entries.`,
      };
    }
    const value = options.value;
    const namespace = options.namespace ?? 'default';
    const tags = Array.isArray(options.tags)
      ? // src: tags carry the ingest source path for excerpt provenance — paths
        // routinely exceed the general 64-char tag cap, so they get 512.
        options.tags
          .filter(
            (t) =>
              typeof t === 'string' &&
              t.length > 0 &&
              t.length <= (t.startsWith('src:') ? 512 : MAX_TAG_LEN),
          )
          .slice(0, MAX_TAGS)
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
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error(
            '[memory-bridge] embedding generation failed — storing entry without embedding:',
            e,
          );
      }
    }

    const mod = await import('@monoes/memory' as string);
    const entry = mod.createDefaultEntry({
      key,
      content: value,
      namespace,
      tags,
      metadata: options.metadata,
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
      } catch (e) {
        logBridgeError('bridgeStoreEntry.upsertLookup', e); /* treat as no existing entry */
      }
    }

    // Dedup gate: skip if a near-duplicate already exists IN THIS NAMESPACE —
    // an unscoped search let a similar entry in some other namespace swallow
    // the store entirely (returned duplicate:true, nothing written where asked).
    const automemCfg = getAutomemConfig();
    if (embedding && !options.upsert) {
      try {
        const similar = await backend.search(embedding, {
          k: 1,
          threshold: automemCfg.dedupThreshold,
          filters: { type: 'exact', namespace },
        });
        if (similar.length > 0 && similar[0].score >= automemCfg.dedupThreshold) {
          // Re-storing near-identical content is a usage signal: the fact keeps
          // being worth remembering. Reinforce the surviving entry.
          await recordUsageOnBackend(backend, [similar[0].entry.id]).catch(() => {
            /* best effort */
          });
          return { success: true, id: similar[0].entry.id, duplicate: true };
        }
      } catch (e) {
        logBridgeError('bridgeStoreEntry.dedupSearch', e); /* non-fatal — store anyway */
      }
    }

    await backend.store(entry);
    if (upsertVictim && upsertVictim.id !== id) {
      try {
        await backend.delete(upsertVictim.id);
      } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error(
            '[memory-bridge] upsert stored new entry but failed to delete the old one — duplicate may remain:',
            e,
          );
      }
    }
    await flushBackend(backend);

    return { success: true, id, embedding: embeddingInfo };
  } catch (err: unknown) {
    logBridgeError('bridgeStoreEntry', err);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, id: '', error: message };
  }
}

export async function bridgeSearchEntries(options: {
  query: string;
  namespace?: string;
  limit?: number;
  threshold?: number;
  dbPath?: string;
  /** Skip cross-encoder reranking even if the model is loaded. */
  skipRerank?: boolean;
  /** When true, superseded knowledge chunks are kept in the results
   *  (flagged by the caller). Default false — removed documents are
   *  filtered out for security. */
  includeSuperseded?: boolean;
  /** Project root to read document metadata from for the knowledge-superseded
   *  check (default: getProjectRoot(), i.e. process.cwd()-derived). Callers
   *  operating on an explicit project directory that differs from cwd — e.g.
   *  searchKnowledge({ rootDir }) — must pass the SAME root here, or every
   *  freshly-ingested doc in that directory reads as superseded (its content
   *  hash won't be found in metadata read from the wrong place) and gets
   *  filtered out despite matching the query. */
  rootDir?: string;
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
  /** What actually ran, never what was requested. 'keyword-fallback' means the
   *  vector path was attempted and did not produce the results. */
  searchMethod?: 'semantic' | 'keyword' | 'keyword-fallback';
  /** Whether a cross-encoder reranker was applied to the final results. */
  reranked?: boolean;
  /** Why the vector path did not serve these results (absent when it did). */
  fallbackReason?:
    | 'no-embedding-model'
    | 'empty-query'
    | 'embedding-failed'
    | 'no-semantic-matches';
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const { query: queryStr, limit = 10, threshold = 0.3 } = options;
    // CLI callers pass 'all' as a no-filter sentinel — never treat it as a literal namespace
    const namespace =
      options.namespace && options.namespace !== 'all' ? options.namespace : undefined;
    const startTime = Date.now();

    // ── Knowledge removal support (issue #106) ──────────────────────
    // Pre-compute live document hashes for knowledge namespaces so we can
    // (a) over-fetch to compensate for superseded entries being filtered,
    // (b) filter them out after retrieval — ensuring removed documents
    //     are invisible to EVERY caller, not just searchKnowledge.
    // Dynamic import breaks the circular dependency: document-pipeline
    // imports getProjectRoot from this module.
    let _knowledgeLive: Set<string> | null = null;
    let _knowledgeHasMeta = false;
    let _isSupersededKey:
      | ((key: string, live: Set<string>, metaPresent: boolean) => boolean)
      | null = null;
    const knowledgeFilterActive = namespace?.startsWith('knowledge:') && !options.includeSuperseded;
    if (knowledgeFilterActive) {
      try {
        const dp = await import('../knowledge/document-pipeline.js');
        const rootDir = options.dbPath === GLOBAL_BRAIN
          ? getGlobalBrainDir()
          : (options.rootDir ?? getProjectRoot());
        _knowledgeLive = dp.liveContentHashes(rootDir);
        _knowledgeHasMeta = dp.hasKnowledgeMetadata(rootDir);
        _isSupersededKey = dp.isSupersededKey;
      } catch (e) {
        logBridgeError(
          'bridgeSearchEntries.knowledgeFilter',
          e,
        ); /* non-fatal: skip filtering when pipeline is unavailable */
      }
    }

    // Over-retrieve when the reranker is available: fetch more candidates so the
    // cross-encoder can reshuffle them. The reranker trims back to `limit`.
    // For knowledge namespaces, also over-fetch to compensate for superseded
    // document versions that will be filtered out below.
    const rerankerActive =
      !options.skipRerank && _reranker !== null && process.env.MONOMIND_RERANKER !== '0';
    const knowledgeLimit =
      _knowledgeLive && _knowledgeLive.size > 0
        ? Math.min(Math.max(limit * 20, limit), 300)
        : limit;
    const retrieveK = rerankerActive
      ? Math.min(knowledgeLimit * 3, Math.max(20, knowledgeLimit))
      : knowledgeLimit;

    let results: any[] = [];
    let searchMethod: 'semantic' | 'keyword' | 'keyword-fallback' = 'keyword';
    // Reported to callers so "(semantic)" can never be printed over keyword hits.
    // The two reasons for skipping the vector path are distinct and must not be
    // conflated: a healthy model given an empty query is not a missing model.
    let fallbackReason:
      | 'no-embedding-model'
      | 'empty-query'
      | 'embedding-failed'
      | 'no-semantic-matches'
      | undefined = !_embedder
      ? 'no-embedding-model'
      : queryStr.length === 0
        ? 'empty-query'
        : undefined;
    let semanticAttempted = false;

    if (_embedder && queryStr.length > 0) {
      semanticAttempted = true;
      try {
        const queryEmbedding = await _embedder(queryStr);
        const searchResults = await backend.search(queryEmbedding, {
          k: retrieveK,
          threshold,
          filters: namespace ? { type: 'exact', namespace } : undefined,
        });
        const { feedbackInfluence } = getAutomemConfig();
        results = searchResults
          .map((r: any) => {
            const weights = entryWeights(r.entry.metadata);
            // Blend only here (semantic path): r.score is a genuine cosine similarity.
            const blended = blendScore(r.score, weights, feedbackInfluence);
            return {
              id: r.entry.id,
              key: r.entry.key,
              content: capResultContent(r.entry.content || ''),
              score: blended,
              namespace: r.entry.namespace,
              provenance: `semantic:${r.score.toFixed(3)}${blended !== r.score ? `→${blended.toFixed(3)}` : ''}`,
              tags: r.entry.tags ?? [],
              _createdAt: r.entry.createdAt || 0,
            };
          })
          .sort((a: any, b: any) => b.score - a.score);
        searchMethod = 'semantic';
        fallbackReason = undefined;
      } catch (e) {
        // fall through to keyword search — but never claim this was semantic
        fallbackReason = 'embedding-failed';
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error(
            '[memory-bridge] semantic search failed — falling back to keyword matching:',
            e,
          );
      }
    }

    // Keyword search — always runs (not just as a fallback).
    // Entries stored without embeddings are invisible to the vector path,
    // so keyword results are merged into semantic results (union, deduplicated
    // by key) to ensure every findable entry surfaces regardless of whether
    // it has an embedding.  Semantic hits take priority on score.
    //
    // Issue #66: When the backend has FTS5, keyword matching runs inside
    // SQLite via MATCH — orders of magnitude faster than the old path that
    // loaded up to 50k rows and scanned them in JS. The JS fallback is
    // kept for sql.js WASM builds that lack the FTS5 extension.
    {
      const tokens = queryStr
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
      let keywordHits: any[] = [];

      if (tokens.length) {
        // ── FTS5 fast path ──────────────────────────────────────────
        const fts5Results: any[] | null =
          typeof backend.keywordSearch === 'function'
            ? await backend.keywordSearch(queryStr, { namespace, limit }).catch(() => null)
            : null;

        if (fts5Results !== null && fts5Results.length > 0) {
          // FTS5 rank is negative (lower = better); normalise to 0–1.
          const maxRank = Math.max(...fts5Results.map((r: any) => Math.abs(r.rank)), 1);
          keywordHits = fts5Results.map((r: any) => ({
            id: r.id,
            key: r.key,
            content: capResultContent(r.content || ''),
            score: Math.abs(r.rank) / maxRank, // normalised 0–1
            namespace: r.namespace,
            provenance: `keyword-fts5:${(Math.abs(r.rank) / maxRank).toFixed(2)}`,
            tags: [] as string[],
            _createdAt: 0,
          }));
        } else {
          // ── JS fallback (no FTS5 or empty FTS5 result) ────────────
          const entries = await backend.query({
            type: 'exact',
            ...(namespace ? { namespace } : {}),
            limit: 50000,
          });

          // #126: Bm25Index.build() costs real time at scale (measured in
          // bm25-index.ts's own header: ~113ms/673 chunks, ~1.7s/12.5k
          // chunks) — this fallback can be handed up to 50,000 entries, so
          // building a fresh index on every call without a cap would make
          // large stores' searches slower, not better. Below the cap, BM25
          // (proper IDF weighting) replaces the naive token-overlap-fraction
          // scan; above it, the fast scan keeps running so latency never
          // regresses. MONOMIND_BM25=0 disables this arm entirely (mirrors
          // the MONOMIND_RERANKER kill-switch).
          const BM25_ENTRY_CAP = 1500;
          const bm25Enabled = (process.env.MONOMIND_BM25 ?? '1') !== '0';

          let bm25Ok = false;
          if (bm25Enabled && entries.length > 0 && entries.length <= BM25_ENTRY_CAP) {
            try {
              const { Bm25Index } = await import('./bm25-index.js');
              // #126-review: index by the entry's ARRAY POSITION, not e.key —
              // memory_entries only enforces UNIQUE(namespace, key), so a bare
              // key string can legitimately repeat across namespaces (e.g. two
              // agents each storing a 'summary' key in their own namespace).
              // Keying by e.key alone collided in that case: every BM25 hit
              // sharing that key string resolved to whichever entry happened
              // to be inserted last into the lookup map, silently returning
              // the wrong entry's id/content/namespace.
              const chunks = entries.map((e: any, i: number) => ({
                key: String(i),
                text: `${e.key || ''} ${e.content || ''}`,
              }));
              const idx = Bm25Index.build(chunks, () => false); // no superseded concept at this generic KV level — filtered later by callers that care
              const hits = idx.search(queryStr, limit);
              // #126-review: Math.max(..., 1) as a divide-by-zero guard also
              // silently floors the normalization divisor whenever every real
              // score is < 1 (common for small/sparse corpora — exactly the
              // regime this capped fallback runs in), so the top hit stopped
              // normalizing to 1.0 as the comment below claims. Only fall
              // back to 1 when there is no positive score to divide by.
              const rawMax = hits.length ? Math.max(...hits.map((h) => h.score)) : 0;
              const maxScore = rawMax > 0 ? rawMax : 1;
              keywordHits = hits.map((h) => {
                const e = entries[Number(h.key)];
                const normalized = h.score / maxScore; // BM25 scores aren't comparable across queries/corpora — normalise 0-1 like the FTS5 path does
                return {
                  id: e.id,
                  key: e.key,
                  content: capResultContent(e.content || ''),
                  score: normalized,
                  namespace: e.namespace,
                  provenance: `keyword-bm25:${normalized.toFixed(2)}`,
                  tags: e.tags ?? [],
                  _createdAt: e.createdAt || 0,
                };
              });
              bm25Ok = true;
            } catch (e) {
              // #126-review: BM25 build/search had no local try/catch, unlike
              // every other sub-path in this function — an exception here
              // used to propagate to the function's single outer catch,
              // discarding the whole call (including already-computed
              // semantic results) instead of degrading to the naive scan
              // below, which is what every other keyword-path failure does.
              if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
                console.error(
                  '[memory-bridge] BM25 keyword search failed — falling back to token-overlap scan:',
                  e,
                );
            }
          }
          if (!bm25Ok) {
            keywordHits = entries
              .map((e: any) => {
                const haystack = `${e.key || ''} ${e.content || ''}`.toLowerCase();
                const hits = tokens.filter((t) => haystack.includes(t)).length;
                return { e, score: hits / tokens.length };
              })
              .filter((x: any) => x.score > 0)
              .sort((a: any, b: any) => b.score - a.score)
              .slice(0, limit)
              .map(({ e, score }: any) => ({
                id: e.id,
                key: e.key,
                content: capResultContent(e.content || ''),
                // Raw token-overlap fraction, NOT rescaled to look like a cosine.
                score,
                namespace: e.namespace,
                provenance: `keyword:${score.toFixed(2)}`,
                tags: e.tags ?? [],
                _createdAt: e.createdAt || 0,
              }));
          }
        }

        if (results.length === 0) {
          // No semantic results — keyword is all we have.
          results = keywordHits;
          searchMethod = semanticAttempted ? 'keyword-fallback' : 'keyword';
          if (semanticAttempted && !fallbackReason) fallbackReason = 'no-semantic-matches';
        } else {
          // Merge: union deduplicated by key, semantic wins on duplicates.
          // Extras are flagged _keywordOnly so the reranking step below can
          // skip them — the cross-encoder scores r.content, and an entry
          // findable ONLY by keyword (e.g. a placeholder/near-empty content
          // whose relevance lives in the key) reranks as noise and gets
          // sliced off by the final `limit`, silently defeating the whole
          // point of merging it in. Guaranteed inclusion has to survive
          // reranking, not just the merge.
          const seenKeys = new Set(results.map((r: any) => r.key));
          const extras = keywordHits.filter((kh: any) => !seenKeys.has(kh.key));
          if (extras.length) {
            results = [...results, ...extras.map((e: any) => ({ ...e, _keywordOnly: true }))];
            // searchMethod stays 'semantic' — the primary path succeeded;
            // keyword only supplemented entries that lacked embeddings.
          }
        }
      } else if (results.length === 0) {
        // Empty token list AND no semantic results — nothing to search.
        searchMethod = semanticAttempted ? 'keyword-fallback' : 'keyword';
        if (semanticAttempted && !fallbackReason) fallbackReason = 'no-semantic-matches';
      }
    }

    // Filter stale entries based on automem config — skip for knowledge
    // namespaces (documents should remain searchable indefinitely)
    // Stale filtering is per-RESULT namespace (documents stay searchable
    // forever) — keying it on the query's namespace filter meant an
    // all-namespace search silently dropped knowledge:* results past the
    // stale cutoff.
    // org:* (cross-run org memory) and rules are durable learned state like
    // documents — the stale cliff silently erased org recall after a week.
    const durableNs = (ns: string) =>
      ns.startsWith('knowledge:') ||
      ns.startsWith('org:') ||
      ns.startsWith('agent:') ||
      ns.startsWith('kg:') ||
      ns === 'rules';
    const isKnowledgeNs = namespace ? durableNs(namespace) : false;
    if (!isKnowledgeNs) {
      const { staleDays } = getAutomemConfig();
      const staleCutoff = Date.now() - staleDays * 86400000;
      results = results.filter(
        (r: any) =>
          durableNs(String(r.namespace ?? '')) || !r._createdAt || r._createdAt > staleCutoff,
      );
    }
    results.forEach((r: any) => delete r._createdAt);

    // ── Knowledge superseded filtering (issue #106) ─────────────────
    // Remove document chunks whose content hash is no longer current
    // (i.e. the document was removed via `knowledge_remove` or replaced
    // by a newer ingest). This runs inside the bridge so every caller —
    // embeddings_search, CLI `memory search`, and searchKnowledge — gets
    // the same removal guarantee.
    if (_knowledgeLive && _isSupersededKey && results.length > 0) {
      results = results.filter(
        (r: any) => !_isSupersededKey!(String(r.key ?? ''), _knowledgeLive!, _knowledgeHasMeta),
      );
      // Trim back to the originally requested limit after overfetch — but
      // never let this blind size-based cut drop a _keywordOnly extra (see
      // the merge above): reserve its slot and trim the rest first.
      if (results.length > limit) {
        const extras = results.filter((r: any) => r._keywordOnly);
        const main = results.filter((r: any) => !r._keywordOnly);
        const keep = Math.max(0, limit - extras.length);
        results = [...main.slice(0, keep), ...extras.slice(0, limit)];
      }
    }

    // Keyword-only extras are guaranteed to survive to the final result —
    // pull them out before reranking so the cross-encoder (which scores
    // r.content only) can't outrank them into oblivion, then reserve their
    // slots when re-merging below.
    const keywordOnlyResults = results.filter((r: any) => r._keywordOnly);
    let rerankPool = results.filter((r: any) => !r._keywordOnly);

    // ── Cross-encoder reranking ──────────────────────────────────────
    // Fires only when: reranker loaded, >1 result, not explicitly skipped.
    // Lazy-load on first qualifying search so startup stays fast.
    let reranked = false;
    if (!options.skipRerank && process.env.MONOMIND_RERANKER !== '0' && rerankPool.length > 1) {
      if (!_reranker && !_rerankerPromise) {
        // First qualifying search — kick off the lazy load. This search
        // proceeds without reranking; the NEXT search will use it.
        loadReranker().catch(() => {
          /* swallowed — retry next time */
        });
      }
      if (_reranker) {
        const rr = await rerankResults(queryStr, rerankPool, limit);
        rerankPool = rr.reranked;
        reranked = rr.applied;
      }
    }

    if (keywordOnlyResults.length) {
      const keep = Math.max(0, limit - keywordOnlyResults.length);
      results = [...rerankPool.slice(0, keep), ...keywordOnlyResults.slice(0, limit)];
    } else {
      results = rerankPool;
    }
    results.forEach((r: any) => delete r._keywordOnly);

    return {
      success: true,
      results,
      searchTime: Date.now() - startTime,
      searchMethod,
      reranked,
      ...(searchMethod === 'semantic' ? {} : { fallbackReason }),
    };
  } catch (e) {
    logBridgeError('bridgeSearchEntries', e);
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
    metadata: Record<string, unknown>;
  }[];
  total: number;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const entries = await backend.query({
      type: 'exact' as any,
      // No namespace means "all namespaces" — the query builder (sql-backend.ts)
      // already skips its filter clause on a falsy namespace. Defaulting to the
      // literal string 'default' here (as this used to) overrode that legitimate
      // "no filter" signal and silently scoped every unfiltered list/search to a
      // namespace that's usually near-empty in practice.
      namespace: options.namespace,
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
        metadata: e.metadata ?? {},
      })),
      total: entries.length,
    };
  } catch (e) {
    logBridgeError('bridgeListEntries', e);
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
    metadata: Record<string, unknown>;
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
        metadata: entry.metadata ?? {},
      },
    };
  } catch (e) {
    logBridgeError('bridgeGetEntry', e);
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
  } catch (e) {
    logBridgeError('bridgeDeleteEntry', e);
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
  } catch (e) {
    logBridgeError('bridgeEmbedText', e);
    return null;
  }
}

export async function bridgeLoadEmbeddingModel(dbPath?: string): Promise<{
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
  } catch (e) {
    logBridgeError('bridgeLoadEmbeddingModel', e);
    return null;
  }
}

export async function bridgeGetBackendStats(
  dbPath?: string,
): Promise<{
  totalEntries: number;
  entriesByNamespace: Record<string, number>;
  memoryUsage: number;
} | null> {
  const backend = await getBackend(dbPath);
  if (!backend) return null;
  try {
    const stats = await backend.getStats();
    return {
      totalEntries: stats?.totalEntries ?? 0,
      entriesByNamespace: stats?.entriesByNamespace ?? {},
      memoryUsage: stats?.memoryUsage ?? 0,
    };
  } catch (e) {
    logBridgeError('bridgeGetBackendStats', e);
    return null;
  }
}

// ===== HNSW (real ANN status/build; search itself runs inside SqlBackend.search()) =====

export async function bridgeAddToHNSW(options: {
  id: string;
  embedding: number[];
  namespace?: string;
  dbPath?: string;
}): Promise<{ success: boolean; indexSize?: number; error?: string } | null> {
  // The SQLite backend indexes entries automatically on store — this is a no-op
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;
  try {
    const stats = await backend.getStats();
    return { success: true, indexSize: stats?.totalEntries ?? 0 };
  } catch (e) {
    logBridgeError('bridgeAddToHNSW', e);
    return { success: true };
  }
}

/**
 * Real status for the ANN (HNSW) fast path inside SqlBackend.search() —
 * whether the corpus is big enough to use it, whether it's currently built,
 * and where its on-disk cache lives. Read-only; does not build anything.
 */
export async function bridgeGetHNSWStatus(dbPath?: string): Promise<{
  available: boolean;
  thresholdEntries: number;
  activeEmbeddedEntries: number;
  built: boolean;
  entryCount: number;
  dimensions: number;
  cachePath: string | null;
} | null> {
  const backend = await getBackend(dbPath);
  if (!backend || typeof backend.getAnnStatus !== 'function') return null;
  try {
    return { available: true, ...backend.getAnnStatus() };
  } catch (e) {
    logBridgeError('bridgeGetHNSWStatus', e);
    return null;
  }
}

/**
 * Force-build (or reload from disk cache) the ANN index regardless of
 * MONOMIND_HNSW_THRESHOLD — the real implementation behind
 * `memory search --build-hnsw`.
 */
export async function bridgeForceBuildHNSW(dbPath?: string): Promise<{
  entryCount: number;
  dimensions: number;
  cachePath: string | null;
} | null> {
  const backend = await getBackend(dbPath);
  if (!backend || typeof backend.forceBuildAnnIndex !== 'function') return null;
  try {
    return await backend.forceBuildAnnIndex(BRIDGE_EMBEDDING_DIMS);
  } catch (e) {
    logBridgeError('bridgeForceBuildHNSW', e);
    return null;
  }
}

// ===== Availability / lifecycle =====

export async function isBridgeAvailable(dbPath?: string): Promise<boolean> {
  const backend = await getBackend(dbPath);
  return !!backend;
}

export async function shutdownBridge(): Promise<void> {
  for (const slot of backendSlots.values()) {
    if (slot.instance) {
      try {
        await slot.instance.shutdown();
      } catch (e) {
        logBridgeError('bridgeShutdown.slotShutdown', e); /* ignore */
      }
    }
  }
  backendSlots.clear();
  _embedder = null;
  _embedderPromise = null;
  _reranker = null;
  _rerankerPromise = null;
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
    patterns: result.results.map((r) => {
      let parsed: any = {};
      try {
        parsed = JSON.parse(r.content);
      } catch (e) {
        logBridgeError('bridgeSearchPatterns.parseContent', e); /* use raw */
      }
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

// ===== Usage capture & feedback weighting (closed loop) =====

async function recordUsageOnBackend(backend: any, entryIds: string[]): Promise<number> {
  let updated = 0;
  for (const id of entryIds) {
    if (typeof id !== 'string' || !id) continue;
    try {
      const entry = await backend.get(id);
      if (!entry) continue;
      const { frequency } = entryWeights(entry.metadata);
      await backend.update(id, {
        metadata: { frequency_weight: frequency + 1 },
        lastAccessedAt: Date.now(),
      });
      updated++;
    } catch (e) {
      logBridgeError('recordUsageOnBackend.entryUpdate', e); /* skip unreadable entries */
    }
  }
  return updated;
}

/** Record that these entries were actually USED (returned to and consumed by a
 *  caller) — increments frequency_weight, which feeds the ranking blend. */
export async function bridgeRecordUsage(options: {
  entryIds: string[];
  dbPath?: string;
}): Promise<{ success: boolean; updated: number } | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;
  try {
    const updated = await recordUsageOnBackend(backend, (options.entryIds ?? []).slice(0, 100));
    if (updated) await flushBackend(backend);
    return { success: true, updated };
  } catch (e) {
    logBridgeError('bridgeRecordUsage', e);
    return { success: false, updated: 0 };
  }
}

/** Apply a usefulness rating to the entries that produced an answer:
 *  EWMA feedback_weight' = w + alpha*(score - w), clipped [0,1] (cognee's
 *  apply_feedback_weights). `ledgerKey` makes application idempotent — a
 *  daemon retry or duplicate MCP call must never compound the update. */
export async function bridgeApplyFeedback(options: {
  entryIds: string[];
  score: number; // 0..1 usefulness
  ledgerKey?: string;
  alpha?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  applied: number;
  alreadyApplied?: boolean;
  error?: string;
} | null> {
  const backend = await getBackend(options.dbPath);
  if (!backend) return null;

  try {
    const score = Math.max(0, Math.min(1, options.score));
    const alpha =
      typeof options.alpha === 'number'
        ? Math.max(0, Math.min(1, options.alpha))
        : FEEDBACK_EWMA_ALPHA;
    const ledgerEntryKey = options.ledgerKey ? `applied_${options.ledgerKey.slice(0, 500)}` : null;

    if (ledgerEntryKey) {
      const existing = await backend.getByKey('feedback', ledgerEntryKey).catch(() => null);
      if (existing) return { success: true, applied: 0, alreadyApplied: true };
    }

    let applied = 0;
    for (const id of (options.entryIds ?? []).slice(0, 100)) {
      if (typeof id !== 'string' || !id) continue;
      try {
        const entry = await backend.get(id);
        if (!entry) continue;
        const { feedback } = entryWeights(entry.metadata);
        const next = Math.max(0, Math.min(1, feedback + alpha * (score - feedback)));
        await backend.update(id, { metadata: { feedback_weight: next } });
        applied++;
      } catch (e) {
        logBridgeError('bridgeApplyFeedback.entryUpdate', e); /* skip unreadable entries */
      }
    }

    if (ledgerEntryKey) {
      await bridgeStoreEntry({
        key: ledgerEntryKey,
        value: JSON.stringify({
          score,
          entryIds: options.entryIds.slice(0, 100),
          appliedAt: Date.now(),
          applied,
        }),
        namespace: 'feedback',
        generateEmbeddingFlag: false,
        dbPath: options.dbPath,
        upsert: true,
      });
    }
    if (applied) await flushBackend(backend);
    return { success: true, applied };
  } catch (err: unknown) {
    logBridgeError('bridgeApplyFeedback', err);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, applied: 0, error: message };
  }
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
      try {
        data = JSON.parse(existing.content);
      } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error(
            '[memory-bridge] session content failed to parse — ending session with empty prior state:',
            e,
          );
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
  } catch (e) {
    logBridgeError('bridgeSessionEnd', e);
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
    routes: result.results.map((r) => {
      let parsed: any = {};
      try {
        parsed = JSON.parse(r.content);
      } catch (e) {
        logBridgeError('bridgeRouteTask.parseContent', e); /* use raw */
      }
      return {
        agentType: parsed.taskType ?? 'coder',
        confidence: r.score,
        pattern: parsed.pattern,
      };
    }),
  };
}

// ===== Health check =====

export async function bridgeHealthCheck(dbPath?: string): Promise<{
  healthy: boolean;
  backend: string;
  stats?: { totalEntries: number; namespaces: string[] };
  error?: string;
} | null> {
  const backend = await getBackend(dbPath);
  if (!backend) return { healthy: false, backend: 'sqlite', error: 'unavailable' };

  try {
    const health = await backend.healthCheck?.();
    const stats = await backend.getStats?.();
    return {
      healthy: health?.healthy ?? true,
      backend: 'sqlite',
      stats: stats
        ? {
            totalEntries: stats.totalEntries ?? 0,
            namespaces: Object.keys(stats.entriesByNamespace ?? {}),
          }
        : undefined,
    };
  } catch (e) {
    logBridgeError('bridgeHealthCheck', e);
    return { healthy: false, backend: 'sqlite' };
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

/** Namespaces GC must never touch: durable knowledge/org/rule state, and the
 *  feedback ledger (deleting it would un-idempotent past ratings). */
const GC_PROTECTED_NS = /^(knowledge:|org:|agent:|kg:|rules$|feedback$)/;

export async function bridgeConsolidate(params: {
  /** Minimum age in MILLISECONDS since last update (default 7 days). */
  minAge?: number;
  maxEntries?: number;
  /** Namespace to GC; 'all' scans every non-protected namespace (default 'default'). */
  namespace?: string;
  dbPath?: string;
}): Promise<any> {
  const backend = await getBackend(params.dbPath);
  if (!backend) return { success: false, consolidated: 0 };

  try {
    const minAge = params.minAge ?? 7 * 24 * 3600 * 1000; // default: 7 days
    const cutoff = Date.now() - minAge;
    const ns = params.namespace ?? 'default';
    const entries = await backend.query({
      type: 'exact' as any,
      ...(ns === 'all' ? {} : { namespace: ns }),
      limit: params.maxEntries ?? 1000,
    });
    let deleted = 0;
    let kept = 0;
    for (const e of entries) {
      if (GC_PROTECTED_NS.test(String(e.namespace ?? ''))) continue;
      if (e.updatedAt >= cutoff) continue;
      const { feedback, frequency } = entryWeights(e.metadata);
      // Weight-aware GC (first real consumer of the closed loop): entries the
      // system learned are useful never age out; unused, unrated ones do.
      if (feedback > 0.6 || frequency >= 3) {
        kept++;
        continue;
      }
      if ((e.accessCount ?? 0) === 0) {
        await backend.delete(e.id).catch(() => {
          /* non-fatal */
        });
        deleted++;
      }
    }
    if (deleted) await flushBackend(backend);
    return { success: true, consolidated: deleted, preserved: kept };
  } catch (e) {
    logBridgeError('bridgeConsolidate', e);
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
        const result = await bridgeStoreEntry({
          key: e.key,
          value: e.value,
          namespace: e.namespace,
        });
        if (result?.success) processed++;
      }
    } else if (params.operation === 'delete') {
      for (const e of params.entries) {
        const result = await bridgeDeleteEntry({ key: e.key, namespace: e.namespace });
        if (result?.deleted) processed++;
      }
    }
    return { success: true, processed };
  } catch (e) {
    logBridgeError('bridgeBatchOperation', e);
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

  // Per-entry head cap plus a total budget — this block is injected verbatim
  // into prompts, so unbounded entries here were a token sink.
  const CONTEXT_TOTAL_CAP = 2560; // ~2.5 KB
  let total = 0;
  const lines: string[] = [];
  for (const r of result.results) {
    const line = `[${r.key}]: ${capResultContent(r.content)}`;
    if (total + line.length > CONTEXT_TOTAL_CAP) break;
    lines.push(line);
    total += line.length + 1;
  }
  const context = lines.join('\n');
  return { success: true, context, sources: result.results.length };
}

// ===== Semantic routing =====

export async function bridgeSemanticRoute(params: { input: string }): Promise<any> {
  return bridgeRouteTask({ task: params.input });
}
