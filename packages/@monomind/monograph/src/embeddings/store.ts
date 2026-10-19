// ── Semantic index: symbol-summary embeddings ────────────────────────────────
//
// Vectors are L2-normalised, stored as int8 (x * 127) — 1 byte per dimension,
// about a quarter of float32, with a cosine error far below the gap between a
// good and a bad match. Embedding is incremental (keyed by a hash of the text)
// and resumable (one transaction per batch), because a cold run over a large
// repository takes minutes and must never block a build.

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { NOT_ANONYMOUS_CLOSURE_SQL } from '../storage/anonymous-closure.js';
import { type FtsResult, type LabelFilter, labelClause } from '../storage/fts-store-search.js';

/** Turns text into L2-normalised vectors. Supplied by the host; monograph has no model dependency. */
export interface Embedder {
  /** Identifies the model; a change invalidates every stored vector. */
  model: string;
  dim: number;
  embedPassages(texts: string[]): Promise<Float32Array[]>;
  embedQuery(query: string): Promise<Float32Array>;
}

const MODEL_KEY = 'embedding_model';
const MAX_TEXT_CHARS = 400;

const hashText = (text: string): string =>
  createHash('sha1').update(text).digest('hex').slice(0, 16);

export function quantize(vec: Float32Array): Buffer {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, vec[i])) * 127);
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

export interface EmbeddingStatus {
  /** Symbols and files with a summary — the number that can be embedded. */
  total: number;
  embedded: number;
  model: string | null;
}

export function embeddingStatus(db: Database.Database): EmbeddingStatus {
  try {
    const total = (
      db.prepare('SELECT COUNT(*) AS n FROM node_summaries_fts').get() as { n: number }
    ).n;
    const embedded = (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM node_embeddings e JOIN node_summaries_fts s ON s.node_id = e.node_id',
        )
        .get() as { n: number }
    ).n;
    const row = db.prepare('SELECT value FROM index_meta WHERE key = ?').get(MODEL_KEY) as
      | { value: string }
      | undefined;
    return { total, embedded, model: row?.value ?? null };
  } catch {
    return { total: 0, embedded: 0, model: null };
  }
}

export interface EmbedOptions {
  batchSize?: number;
  /** Stop after roughly this long; the next call resumes where this one stopped. */
  maxMs?: number;
  onProgress?: (done: number, pending: number) => void;
}

export interface EmbedResult {
  embedded: number;
  /** Still without a current vector after this call. */
  remaining: number;
}

const isBusy = (e: unknown): boolean => /SQLITE_BUSY|database is locked/i.test(String(e));

/** Embeds every summary that has no vector yet, or whose text changed since its vector was made. */
export async function embedPending(
  db: Database.Database,
  embedder: Embedder,
  options: EmbedOptions = {},
): Promise<EmbedResult> {
  const batchSize = options.batchSize ?? 32;
  const deadline = options.maxMs ? Date.now() + options.maxMs : Infinity;

  const storedModel = (
    db.prepare('SELECT value FROM index_meta WHERE key = ?').get(MODEL_KEY) as
      | { value: string }
      | undefined
  )?.value;
  if (storedModel !== embedder.model) {
    db.exec('DELETE FROM node_embeddings');
    db.prepare('INSERT OR REPLACE INTO index_meta VALUES (?, ?)').run(MODEL_KEY, embedder.model);
  }
  // Vectors of nodes that no longer have a summary are dead weight.
  db.exec(
    'DELETE FROM node_embeddings WHERE node_id NOT IN (SELECT node_id FROM node_summaries_fts)',
  );

  const have = new Map(
    (
      db.prepare('SELECT node_id, text_hash FROM node_embeddings').all() as {
        node_id: string;
        text_hash: string;
      }[]
    ).map((r) => [r.node_id, r.text_hash]),
  );
  const pending = (
    db.prepare('SELECT node_id, text FROM node_summaries_fts').all() as {
      node_id: string;
      text: string;
    }[]
  )
    .map((r) => ({ id: r.node_id, text: r.text.slice(0, MAX_TEXT_CHARS) }))
    .filter((r) => have.get(r.id) !== hashText(r.text));

  const insert = db.prepare(
    'INSERT OR REPLACE INTO node_embeddings (node_id, text_hash, vec) VALUES (?, ?, ?)',
  );
  let embedded = 0;
  for (let i = 0; i < pending.length && Date.now() < deadline; i += batchSize) {
    const chunk = pending.slice(i, i + batchSize);
    const vecs = await embedder.embedPassages(chunk.map((c) => c.text));
    for (let attempt = 0; ; attempt++) {
      try {
        db.transaction(() => {
          chunk.forEach((c, j) => insert.run(c.id, hashText(c.text), quantize(vecs[j])));
        })();
        break;
      } catch (e) {
        // A build holds the write lock for its whole run; wait it out rather than lose the batch.
        if (!isBusy(e) || attempt >= 6) throw e;
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
    embedded += chunk.length;
    options.onProgress?.(embedded, pending.length);
  }
  return { embedded, remaining: pending.length - embedded };
}

// ── Search ───────────────────────────────────────────────────────────────────

interface VectorCache {
  version: string;
  dim: number;
  ids: string[];
  mat: Int8Array;
}
const caches = new Map<string, VectorCache>();

function loadVectors(db: Database.Database, dim: number): VectorCache | null {
  const v = db.prepare('SELECT COUNT(*) AS c, MAX(rowid) AS m FROM node_embeddings').get() as {
    c: number;
    m: number | null;
  };
  if (!v.c) return null;
  const key = db.name;
  const version = `${v.c}:${v.m}:${dim}`;
  const hit = caches.get(key);
  if (hit?.version === version) return hit;
  const ids: string[] = [];
  const mat = new Int8Array(v.c * dim);
  let i = 0;
  for (const row of db.prepare('SELECT node_id, vec FROM node_embeddings').iterate() as Iterable<{
    node_id: string;
    vec: Buffer;
  }>) {
    if (i >= v.c || row.vec.length !== dim) continue;
    mat.set(new Int8Array(row.vec.buffer, row.vec.byteOffset, dim), i * dim);
    ids.push(row.node_id);
    i++;
  }
  const cache = { version, dim, ids, mat };
  caches.set(key, cache);
  return cache;
}

export interface SemanticHit extends FtsResult {
  /** Cosine similarity to the query, roughly -1..1. */
  similarity: number;
}

/** Nearest summaries to `queryVec` by cosine similarity, optionally restricted to some node labels. */
export function semanticSearch(
  db: Database.Database,
  queryVec: Float32Array,
  limit: number,
  label?: LabelFilter,
): SemanticHit[] {
  const dim = queryVec.length;
  const cache = loadVectors(db, dim);
  if (!cache || cache.ids.length === 0) return [];
  const { ids, mat } = cache;
  const n = ids.length;
  const scores = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += dim) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += queryVec[d] * mat[o + d];
    scores[i] = s / 127;
  }
  // Over-fetch: the label, closure and existence filters below drop some candidates.
  const want = Math.min(n, Math.max(limit * 4, 100));
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, want);

  const sim = new Map(order.map((i) => [ids[i], scores[i]]));
  const chunkIds = [...sim.keys()];
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < chunkIds.length; i += 400) {
    const part = chunkIds.slice(i, i + 400);
    let sql = `SELECT n.id, n.name, n.norm_label, n.file_path, n.label, n.start_line, n.end_line
      FROM nodes n WHERE n.id IN (${part.map(() => '?').join(',')}) AND ${NOT_ANONYMOUS_CLOSURE_SQL}`;
    const params: unknown[] = [...part];
    if (label) {
      const lc = labelClause(label);
      sql += lc.sql;
      params.push(...lc.params);
    }
    rows.push(
      ...(db.prepare(sql).all(...(params as [string, ...unknown[]])) as Record<string, unknown>[]),
    );
  }
  return rows
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      normLabel: r.norm_label as string,
      filePath: (r.file_path as string | null) ?? null,
      label: r.label as string,
      rank: 0,
      startLine: (r.start_line as number | null) ?? null,
      endLine: (r.end_line as number | null) ?? null,
      similarity: sim.get(r.id as string) ?? 0,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
