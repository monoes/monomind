/**
 * Semantic side of monograph search, as seen by the MCP tools: the local
 * embedding model, the background job that fills the vector index, and the
 * decision of when a query may use it. Everything degrades to lexical search —
 * no model, no vectors yet, or `MONOGRAPH_EMBED=0` — never to an error.
 */

import type { Embedder } from '@monoes/monograph';

let embedderPromise: Promise<Embedder | null> | null = null;

/** The local sentence-embedding model, loaded once per process; null if unavailable. */
export function getEmbedder(): Promise<Embedder | null> {
  embedderPromise ??= import('@monoes/monograph').then(({ createTransformersEmbedder }) =>
    createTransformersEmbedder(() => import('@huggingface/transformers' as string)),
  );
  return embedderPromise;
}

const MAX_EMBED_MS = 30 * 60 * 1000;
let embedInFlight = false;

/**
 * Fire-and-forget: embed whatever summaries lack a current vector. Runs in
 * this (long-lived) process behind a guard so repeated tool calls and builds
 * don't stack jobs; resumable, so an interrupted run loses at most one batch.
 */
export function triggerBackgroundEmbed(dbPath: string): boolean {
  if (embedInFlight || process.env.MONOGRAPH_EMBED === '0') return false;
  embedInFlight = true;
  void (async () => {
    const embedder = await getEmbedder();
    if (!embedder) return;
    const { openDb, closeDb, embedPending } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      await embedPending(db, embedder, { maxMs: MAX_EMBED_MS });
    } finally {
      closeDb(db);
    }
  })()
    .catch((e) => {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[triggerBackgroundEmbed] embedding failed:', e);
    })
    .finally(() => {
      embedInFlight = false;
    });
  return true;
}

const kickedOff = new Set<string>();

/**
 * The embedder to search with, or null when semantic search can't help yet:
 * nothing embedded (the job is started once per process and lexical search
 * answers meanwhile) or no model on this machine.
 */
export async function semanticEmbedder(
  db: Parameters<typeof import('@monoes/monograph').embeddingStatus>[0],
  dbPath: string,
): Promise<Embedder | null> {
  const { embeddingStatus } = await import('@monoes/monograph');
  const status = embeddingStatus(db);
  if (status.total === 0) return null;
  if (status.embedded < status.total && !kickedOff.has(dbPath)) {
    kickedOff.add(dbPath);
    triggerBackgroundEmbed(dbPath);
  }
  return status.embedded > 0 ? getEmbedder() : null;
}
