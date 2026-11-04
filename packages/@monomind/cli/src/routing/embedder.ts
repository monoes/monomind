/**
 * Real semantic embedding backend for routing.
 *
 * Replaces the hash-based `LocalEncoder` (which scored ~12% top-1 routing
 * accuracy — barely above noise) with a genuine local sentence-embedding model
 * (~58% top-1). The model runs entirely on-device via `@huggingface/transformers`
 * — no API key, consistent with monomind running on top of Claude Code.
 *
 * Model: Snowflake/snowflake-arctic-embed-xs (384-dim, L2-normalized, the same
 * model `@monoes/monograph` uses for code search — so the weights are typically
 * already cached on disk).
 *
 * `@huggingface/transformers` is an OPTIONAL dependency: if it can't be loaded,
 * `createSemanticRouting()` returns null and routing transparently falls back to
 * keyword + LocalEncoder semantic routing.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadTransformers } from '../utils/transformers-loader.js';

/** HuggingFace model id — kept in sync with @monoes/monograph's embedder. */
const MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';

/**
 * Calibrated similarity threshold for the arctic-embed space.
 *
 * Empirically (leave-one-out over the route utterances): genuine task matches
 * score ~0.85–0.91 against the correct route centroid, while off-topic / nonsense
 * input tops out around ~0.74. 0.80 sits in that gap — real tasks route
 * `semantic`, junk falls through to the LLM fallback.
 */
export const SEMANTIC_EMBEDDING_THRESHOLD = 0.8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = (text: string, opts?: Record<string, unknown>) => Promise<any>;

let cachedEmbedderPromise: Promise<Pipeline | null> | null = null;

/** Lazily load (and cache) the feature-extraction pipeline; null if unavailable. */
async function getEmbedder(): Promise<Pipeline | null> {
  if (cachedEmbedderPromise) return cachedEmbedderPromise;
  cachedEmbedderPromise = (async () => {
    try {
      const hf = await loadTransformers({ install: false });
      const pipe = (await hf.pipeline('feature-extraction', MODEL_ID, {
        dtype: 'fp32',
      })) as Pipeline;
      return pipe;
    } catch {
      return null;
    }
  })();
  return cachedEmbedderPromise;
}

export interface SemanticRouting {
  /** Embeds one text → 384-dim L2-normalized vector. */
  embeddingGenerator: (text: string) => Promise<number[]>;
  /** Route centroids aligned 1:1 with the input routes (cached on disk). */
  centroids: number[][];
  /** Calibrated `globalThreshold` for this embedder. */
  globalThreshold: number;
}

interface RouteLike {
  name: string;
  utterances: string[];
}

function cacheDir(): string {
  return join(homedir(), '.monomind', 'cache');
}

/**
 * Cache key binds the centroids to BOTH the model and the exact route set, so a
 * model change or any utterance edit invalidates the cache — preventing a stale
 * 256-dim hash centroid from ever being cosine-compared to a 384-dim vector.
 */
function centroidCacheKey(routes: RouteLike[]): string {
  const sig = routes.map((r) => `${r.name}\x00${r.utterances.join('\x01')}`).join('\x02');
  const hash = createHash('sha256').update(`${MODEL_ID}\x03${sig}`).digest('hex').slice(0, 32);
  return `route-centroids-${hash}.json`;
}

/**
 * Validate a parsed cache payload before trusting it for cosine scoring. The
 * cache lives under the user's home dir, but a corrupt/truncated/hand-edited
 * file (wrong length, ragged dimensions, NaN/null) would silently poison
 * routing — so check shape AND that every component is finite.
 */
function isValidCentroids(value: unknown, expectedCount: number): value is number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount || value.length === 0) return false;
  const dim = Array.isArray(value[0]) ? value[0].length : -1;
  if (dim <= 0) return false;
  return value.every(
    (v) =>
      Array.isArray(v) &&
      v.length === dim &&
      v.every((n) => typeof n === 'number' && Number.isFinite(n)),
  );
}

/**
 * Build the real-embedding routing config for a route set, or null when the
 * embedding model can't be loaded (caller then routes keyword + LocalEncoder).
 *
 * Route centroids are computed once (~6s for ~500 utterances) and cached to
 * `~/.monomind/cache`; subsequent calls load them in milliseconds.
 */
export async function createSemanticRouting(routes: RouteLike[]): Promise<SemanticRouting | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;

  const embeddingGenerator = async (text: string): Promise<number[]> => {
    const out = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data as Float32Array);
  };

  const cacheFile = join(cacheDir(), centroidCacheKey(routes));

  // Try the disk cache first.
  try {
    // Guard against a crafted/runaway cache file causing OOM.
    // A genuine arctic-embed-xs centroid file for ~60 routes is well under 2MB.
    const { size } = await fs.stat(cacheFile);
    if (size > 10 * 1024 * 1024) throw new Error('cache file too large');
    const raw = await fs.readFile(cacheFile, 'utf-8');
    const centroids = JSON.parse(raw) as unknown;
    // Cosine scores a length mismatch as 0, so a cache whose dimension no
    // longer matches the model's output (weights changed under the same id)
    // would score every route 0. Check explicitly and rebuild instead.
    if (
      isValidCentroids(centroids, routes.length) &&
      centroids[0].length === (await embeddingGenerator('dimension check')).length
    ) {
      return { embeddingGenerator, centroids, globalThreshold: SEMANTIC_EMBEDDING_THRESHOLD };
    }
  } catch {
    /* cache miss or corrupt — recompute below */
  }

  // Compute centroids (cold path). @monoes/routing is an optionalDependency of
  // the cli, so it is imported lazily; the embed worker already loaded it.
  const { computeCentroid } = await import('@monoes/routing');
  const centroids: number[][] = [];
  for (const route of routes) {
    const vecs: number[][] = [];
    for (const u of route.utterances) vecs.push(await embeddingGenerator(u));
    centroids.push(computeCentroid(vecs));
  }

  // Best-effort persist; failure to cache must not break routing. Write to a
  // pid-scoped temp file then atomically rename, so two concurrent processes
  // (e.g. `route` + `agent --task`) on a cold cache can't leave a torn file.
  try {
    await fs.mkdir(cacheDir(), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(centroids), 'utf-8');
    await fs.rename(tmp, cacheFile);
  } catch {
    /* ignore cache write errors */
  }

  return { embeddingGenerator, centroids, globalThreshold: SEMANTIC_EMBEDDING_THRESHOLD };
}
