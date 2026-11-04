/**
 * Memory Bridge — the write path: bridgeStoreEntry (upsert identity, dedup
 * gate, compare-and-swap) and the usage-recording helper it shares with the
 * feedback loop. Split out of memory-bridge.ts, which re-exports the public
 * symbols.
 */

import { _embedder, flushBackend, getBackend } from './memory-bridge-backend.js';
import {
  BRIDGE_EMBEDDING_MODEL,
  BRIDGE_MAX_KEY_LEN,
  BRIDGE_MAX_VALUE_LEN,
  entryWeights,
  generateId,
  getAutomemConfig,
  logBridgeError,
  MAX_TAG_LEN,
  MAX_TAGS,
} from './memory-bridge-core.js';

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
  /** Compare-and-swap guard for a read-merge-write caller (memory-kg.ts's
   *  claim-ledger merge, K5). `'absent'` requires no row to exist yet at this
   *  key; a number requires the row's CURRENT stored version to still equal
   *  it. Either way, the check and the write are one atomic SQL statement
   *  (see SqlBackend.storeIfVersion/storeIfAbsent) — a caller that read this
   *  row (or found it absent) moments ago finds out here, via `conflict`,
   *  whether a concurrent writer beat it, instead of silently overwriting (or
   *  being overwritten by) that writer's update. Omit for the plain
   *  last-write-wins upsert every other caller already relies on. */
  ifVersion?: number | 'absent';
}): Promise<{
  success: boolean;
  id: string;
  embedding?: { dimensions: number; model: string };
  guarded?: boolean;
  cached?: boolean;
  attested?: boolean;
  duplicate?: boolean;
  /** True when `ifVersion` did not match the row's current state — the row
   *  changed (or was created) concurrently. `success` is false alongside this;
   *  nothing was written. The caller must re-read and retry, not treat this
   *  as a transient error. */
  conflict?: boolean;
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

    // Upsert resolves the EXISTING identity BEFORE minting anything: a
    // re-ingest must update the row in place and keep the id the caller was
    // already handed. The old store-new-then-delete-old order silently
    // orphaned every outstanding reference — feedback against a
    // previously-returned id then matched nothing and reported
    // `success: true, applied: 0`, i.e. success while training nothing (K5).
    let existing: {
      id: string;
      createdAt: number;
      metadata?: Record<string, unknown>;
      version?: number;
      accessCount?: number;
      lastAccessedAt?: number;
    } | null = null;
    if (options.upsert) {
      try {
        existing = await backend.getByKey(namespace, key);
      } catch (e) {
        logBridgeError('bridgeStoreEntry.upsertLookup', e); /* treat as no existing entry */
      }
    }
    const id = existing?.id ?? generateId('entry');

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

    const mod = await import('@monoes/memory');
    const entry = mod.createDefaultEntry({
      key,
      content: value,
      namespace,
      tags,
      // On a revision the stored metadata merges UNDER the caller's, so
      // learned signal (feedback_weight, frequency_weight) survives while every
      // field the caller states explicitly still wins. Same merge semantics the
      // backend's own update() uses.
      metadata: existing
        ? { ...(existing.metadata ?? {}), ...(options.metadata ?? {}) }
        : options.metadata,
      expiresAt: options.ttl ? now + options.ttl * 1000 : undefined,
    });
    // Override id and set embedding
    entry.id = id;
    if (embedding) entry.embedding = embedding;
    if (existing) {
      // Carry the record's history forward. createdAt in particular anchors the
      // entry in the backend's `created_at DESC` ordering: a revision keeps its
      // position instead of jumping to the head of every scan.
      entry.createdAt = existing.createdAt;
      entry.updatedAt = now;
      entry.version = (existing.version ?? 1) + 1;
      entry.accessCount = existing.accessCount ?? 0;
      entry.lastAccessedAt = existing.lastAccessedAt ?? now;
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

    // Compare-and-swap path (K5): a caller merging onto a row it read earlier
    // (or asserting the row is still absent) asks for that check to be part of
    // the write, atomically, instead of trusting its own stale read.
    if (options.ifVersion !== undefined) {
      if (options.ifVersion === 'absent') {
        if (existing)
          return {
            success: false,
            id: existing.id,
            conflict: true,
            error: 'ifVersion=absent but entry already exists',
          };
        const created =
          typeof backend.storeIfAbsent === 'function' ? await backend.storeIfAbsent(entry) : null;
        if (created === null) {
          // Backend predates storeIfAbsent (or is a test double) — fall back to
          // the plain unconditional write rather than fail every caller.
          await backend.store(entry);
        } else if (!created) {
          return { success: false, id: '', conflict: true, error: 'entry created concurrently' };
        }
      } else {
        if (!existing)
          return { success: false, id: '', conflict: true, error: 'entry no longer exists' };
        const written =
          typeof backend.storeIfVersion === 'function'
            ? await backend.storeIfVersion(entry, options.ifVersion)
            : null;
        if (written === null) {
          await backend.store(entry);
        } else if (!written) {
          return {
            success: false,
            id,
            conflict: true,
            error: `version conflict: entry changed concurrently (expected version ${options.ifVersion})`,
          };
        }
      }
      await flushBackend(backend);
      return { success: true, id, embedding: embeddingInfo };
    }

    // store() is INSERT OR REPLACE keyed on id, so reusing the existing id
    // rewrites that row in place — there is no old row left to delete, and no
    // window in which a failed store leaves the previous data destroyed.
    await backend.store(entry);
    await flushBackend(backend);

    return { success: true, id, embedding: embeddingInfo };
  } catch (err: unknown) {
    logBridgeError('bridgeStoreEntry', err);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, id: '', error: message };
  }
}

/** Ids a usage/feedback pass could not train, with why — so `updated: 0` and
 *  `applied: 0` are never a silent success. `not_found` means the id resolved
 *  to no entry (deleted, or orphaned by an older re-ingest); `error` means the
 *  entry existed but could not be updated. */
export type SkippedEntry = { id: string; reason: 'not_found' | 'error' };

export async function recordUsageOnBackend(
  backend: any,
  entryIds: string[],
): Promise<{ updated: number; skipped: SkippedEntry[] }> {
  let updated = 0;
  const skipped: SkippedEntry[] = [];
  for (const id of entryIds) {
    if (typeof id !== 'string' || !id) continue;
    try {
      const entry = await backend.get(id);
      if (!entry) {
        skipped.push({ id, reason: 'not_found' });
        continue;
      }
      const { frequency } = entryWeights(entry.metadata);
      await backend.update(id, {
        metadata: { frequency_weight: frequency + 1 },
        lastAccessedAt: Date.now(),
      });
      updated++;
    } catch (e) {
      logBridgeError('recordUsageOnBackend.entryUpdate', e);
      skipped.push({ id, reason: 'error' });
    }
  }
  return { updated, skipped };
}
