import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Embedder } from './store.js';

/**
 * Same model the semantic router uses, so the weights are normally already on
 * disk (`monomind download-embeddings`). 384-dim, ~22M parameters.
 */
export const EMBEDDING_MODEL = 'Snowflake/snowflake-arctic-embed-xs';
const DIM = 384;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

// biome-ignore lint/suspicious/noExplicitAny: transformers.js has no stable public pipeline type
type Pipeline = (input: string | string[], opts: Record<string, unknown>) => Promise<any>;

/** Whether the model's files are already on disk under transformers.js' cache directory. */
export function isModelCached(cacheDir: string | undefined): boolean {
  return !!cacheDir && existsSync(join(cacheDir, EMBEDDING_MODEL));
}

/**
 * Builds an {@link Embedder} on `@huggingface/transformers`. The caller supplies
 * the module loader (`() => import('@huggingface/transformers')`) so the
 * dependency resolves from the host package; monograph itself does not depend
 * on it. Returns null when the module or the model is unavailable, and
 * `MONOGRAPH_EMBED=0` turns the semantic index off. The model is never
 * downloaded implicitly (~88 MB): without it on disk this returns null —
 * `monomind download-embeddings` fetches it, or set `MONOGRAPH_ALLOW_DOWNLOAD=1`.
 */
export async function createTransformersEmbedder(
  load: () => Promise<unknown>,
): Promise<Embedder | null> {
  if (process.env.MONOGRAPH_EMBED === '0') return null;
  let pipe: Pipeline;
  try {
    const hf = (await load()) as {
      pipeline: (task: string, model: string, opts: object) => Promise<Pipeline>;
      env?: { cacheDir?: string };
    };
    if (process.env.MONOGRAPH_ALLOW_DOWNLOAD !== '1' && !isModelCached(hf.env?.cacheDir))
      return null;
    pipe = await hf.pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' });
  } catch {
    return null;
  }
  const run = async (texts: string[]): Promise<Float32Array[]> => {
    const out = await pipe(texts, { pooling: 'cls', normalize: true });
    const data = out.data as Float32Array;
    return texts.map((_, i) => data.slice(i * DIM, (i + 1) * DIM));
  };
  return {
    model: EMBEDDING_MODEL,
    dim: DIM,
    embedPassages: run,
    embedQuery: async (q) => (await run([QUERY_PREFIX + q]))[0],
  };
}
