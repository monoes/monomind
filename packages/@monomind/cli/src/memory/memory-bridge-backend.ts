/**
 * Memory Bridge — the lazy per-path backend cache, the process-wide local
 * models (embedder + cross-encoder reranker) and their kill switch, and
 * bridge lifecycle. Owns all of that module-level state; other bridge
 * modules only read it. Split out of memory-bridge.ts, which re-exports the
 * public symbols.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BRIDGE_EMBEDDING_MODEL, logBridgeError } from './memory-bridge-core.js';
import {
  getDbPath,
  getGlobalBrainDir,
  getProjectRoot,
  projectDataDir,
} from './memory-bridge-paths.js';
import { ettinHeadLogit, loadEttinHead, resolveRerankerSource } from './reranker-head.js';

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
export let _embedder: ((text: string) => Promise<Float32Array>) | null = null;
let _embedderPromise: Promise<void> | null = null;
const MAX_INIT_ATTEMPTS = 3;

// Process-local kill switch for both local ONNX models (embedder + reranker):
// the in-process equivalent of MONOMIND_NO_LOCAL_EMBEDDINGS=1 plus
// MONOMIND_RERANKER=0. Org runs flip this instead of setting those env vars,
// because process.env is inherited by every child — each role's CLI and every
// command a role runs through Bash — which silently degraded a role's own
// `monomind memory search` to keyword-only (#249).
let _localModelsDisabled = false;

/** Disable local model loads for THIS process only (see `org run`/`org serve`). */
export function disableLocalModels(): void {
  _localModelsDisabled = true;
}

export function localEmbeddingsDisabled(): boolean {
  return _localModelsDisabled || process.env.MONOMIND_NO_LOCAL_EMBEDDINGS === '1';
}

export function rerankerDisabled(): boolean {
  return _localModelsDisabled || process.env.MONOMIND_RERANKER === '0';
}

// ===== Lazy cross-encoder reranker (ettin-32m) =====
//
// Same ORT constraints as the embedder (ADR-R001). Loaded only when the first
// search with >1 candidate completes — never on store, never on startup.
// Disabled with MONOMIND_RERANKER=0.
//
// The upstream HF ONNX file for ettin-reranker-32m-v1 only contains the base
// ModernBERT encoder (outputs last_hidden_state, no logits). The classifier
// head lives in separate sentence-transformers module safetensors files
// (2_Dense, 3_LayerNorm, 4_Dense). Two ways to score, in order of preference:
//  - a self-exported ONNX with the head baked in (scripts/export-ettin-onnx.py,
//    needs PyTorch) under ~/.monomind/models/ettin-reranker-32m-v1-onnx/
//  - the upstream encoder plus the head applied in JS (reranker-head.ts), from
//    head files fetched by `doc eval --provision-model` into
//    ~/.monomind/models/ettin-reranker-32m-v1-head/
// With neither, the reranker does not load: the upstream encoder alone cannot
// score, and loading it anyway ran the model on every search for nothing.

export const BRIDGE_RERANKER_MODEL = 'cross-encoder/ettin-reranker-32m-v1';

/** Where reranker export / head files live. */
export function rerankerModelsDir(): string {
  return path.join(os.homedir(), '.monomind', 'models');
}

/** How the reranker is scoring, or null when it is not loaded. */
let _rerankerKind: 'export' | 'head' | null = null;
export function rerankerKind(): 'export' | 'head' | null {
  return _rerankerKind;
}

export let _reranker: ((query: string, passage: string) => Promise<number>) | null = null;
export let _rerankerPromise: Promise<void> | null = null;

/** Pre-load the cross-encoder reranker model. Idempotent, no-op when
 *  MONOMIND_RERANKER=0. Exported so the eval harness can force-load before
 *  the network guard blocks model downloads. */
export async function loadReranker(): Promise<void> {
  if (_reranker) return;
  if (rerankerDisabled()) return;
  if (!_rerankerPromise) {
    _rerankerPromise = (async () => {
      try {
        const source = resolveRerankerSource(rerankerModelsDir());
        if (!source) return; // nothing that can score — stay unloaded (no per-search cost)

        const hf = await import('@huggingface/transformers' as string);
        const opts = { local_files_only: true };
        const sigmoid = (logit: number) => 1 / (1 + Math.exp(-logit));
        if (source.kind === 'export') {
          const tokenizer = await (hf as any).AutoTokenizer.from_pretrained(source.dir, opts);
          const model = await (hf as any).AutoModelForSequenceClassification.from_pretrained(
            source.dir,
            opts,
          );
          _reranker = async (query: string, passage: string) => {
            const inputs = await tokenizer(query, {
              text_pair: passage,
              padding: true,
              truncation: true,
            });
            const output = await model(inputs);
            // num_labels=1 → [1,1] regression score, apply sigmoid
            return sigmoid((output.logits.data as Float32Array)[0]);
          };
        } else {
          const head = loadEttinHead(source.dir);
          const tokenizer = await (hf as any).AutoTokenizer.from_pretrained(
            BRIDGE_RERANKER_MODEL,
            opts,
          );
          const model = await (hf as any).AutoModel.from_pretrained(BRIDGE_RERANKER_MODEL, {
            ...opts,
            dtype: 'fp32',
          });
          _reranker = async (query: string, passage: string) => {
            const inputs = await tokenizer(query, {
              text_pair: passage,
              padding: true,
              truncation: true,
            });
            const output = await model(inputs);
            return sigmoid(ettinHeadLogit(head, output.last_hidden_state.data as Float32Array));
          };
        }
        _rerankerKind = source.kind;
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
export async function rerankResults(
  query: string,
  results: any[],
  limit: number,
): Promise<{ reranked: any[]; applied: boolean }> {
  const reranker = _reranker;
  if (!reranker || results.length <= 1) return { reranked: results, applied: false };
  try {
    const scored = await Promise.all(
      results.map(async (r) => {
        const rerankerScore = await reranker(query, r.content || '');
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
export async function flushBackend(backend: any): Promise<void> {
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
  // MONOMIND_NO_LOCAL_EMBEDDINGS: skip the native pipeline() load entirely.
  // On some machines @huggingface/transformers' ONNX runtime crashes the
  // whole process with a native `libc++abi terminate` (a mutex failure
  // inside the tokenizer backend) rather than throwing a catchable JS
  // error — the try/catch below only protects against normal failures
  // (missing cache, bad revision, offline), not that. Everything that
  // reads _embedder already tolerates it being unset (keyword-only
  // fallback), so skipping the call is the only way to actually avoid the
  // crash rather than just failing to catch it. Org runs disable it
  // in-process (disableLocalModels()) since a crashed org is much worse than
  // degraded search; anyone else can opt in with the env var.
  if (localEmbeddingsDisabled()) return;
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

/** Fetches the local embedding model into the transformers cache so later
 *  loadEmbedder() calls (local_files_only) find it. Same model, revision and
 *  dtype as loadEmbedder() — only the network is allowed here, which is why it
 *  is reserved for explicit opt-in steps (`init --with-embeddings`). Throws
 *  when the model cannot be fetched (offline, disabled, package missing);
 *  callers degrade. Loads onnxruntime, so ADR-R001 applies to the caller. */
export async function downloadEmbeddingModel(): Promise<void> {
  if (localEmbeddingsDisabled())
    throw new Error('local embeddings are disabled (MONOMIND_NO_LOCAL_EMBEDDINGS=1)');
  const hf = await import('@huggingface/transformers' as string);
  await (hf as any).pipeline('feature-extraction', BRIDGE_EMBEDDING_MODEL, {
    revision: 'main',
    dtype: 'q8',
  });
}

/**
 * Open the native SQLite backend, falling back to sql.js only when better-sqlite3
 * itself cannot be loaded. Any other failure (locked, corrupt, unwritable database)
 * is about the database, not the engine: sql.js would open a stale in-memory copy of
 * the same file and later overwrite it, so the error is surfaced instead.
 */
export async function openBackendWithFallback(mod: any, cfg: object): Promise<any> {
  try {
    const backend = new mod.SQLiteBackend(cfg);
    await backend.initialize();
    return backend;
  } catch (e) {
    if ((e as { code?: string })?.code !== 'MEMORY_NATIVE_UNAVAILABLE') throw e;
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[memory-bridge] better-sqlite3 unavailable — using sql.js backend:', e);
    const backend = new mod.SqlJsBackend(cfg);
    await backend.initialize();
    return backend;
  }
}

export async function getBackend(dbPath?: string): Promise<any | null> {
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
          backend = await openBackendWithFallback(mod, cfg);
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
