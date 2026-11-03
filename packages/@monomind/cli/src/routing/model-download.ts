/**
 * Opt-in download of the semantic-routing embedding model.
 *
 * The semantic router (`routing/embedder.ts`) needs the weights of
 * Snowflake/snowflake-arctic-embed-xs (~88 MB) cached on disk by
 * `@huggingface/transformers`. On a fresh install they are absent, so the
 * router silently falls back to keyword + hash routing. Nothing may download
 * them implicitly — this module exists so `monomind init` can ASK first, and
 * so users can fetch the model later via `monomind download-embeddings` (or
 * `scripts/download-embedding-model.mjs` on a source checkout).
 *
 * Kept dependency-light and free of CLI I/O so it is unit-testable: the
 * prompt/TTY decisions live in `embeddingDownloadDecision()`, the actual
 * download in `downloadEmbeddingModel()`.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadTransformers, transformersCacheDir } from '../utils/transformers-loader.js';

/** HuggingFace model id — kept in sync with `routing/embedder.ts`. */
export const EMBEDDING_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';

/** Approximate download size, used only for prompt/UX copy. */
export const EMBEDDING_MODEL_SIZE_LABEL = '~88 MB';

/**
 * Locate the cache directory `@huggingface/transformers` writes model weights
 * into (`~/.monomind/models` for the runtime installed in the deps dir, the
 * package's own `.cache` in a checkout), or null when the runtime is not
 * installed.
 */
export function findTransformersCacheDir(): string | null {
  return transformersCacheDir();
}

/** True when the embedding model weights are already cached on disk. */
export function isEmbeddingModelCached(): boolean {
  const cache = findTransformersCacheDir();
  if (!cache) return false;
  // 'Xenova' covers checkouts where a Xenova-mirrored model populated the
  // same cache (same check the semantic-routing tests use).
  return existsSync(join(cache, 'Snowflake')) || existsSync(join(cache, 'Xenova'));
}

export type EmbeddingDownloadReason =
  | 'already-cached' // weights on disk — never prompt, never download
  | 'non-interactive' // no TTY or CI — skip silently apart from a hint
  | 'prompt'; // interactive and missing — ask the user

/**
 * Pure decision for the init-time download prompt, kept separate from I/O so
 * tests can drive it with stubbed TTY/CI values.
 */
export function embeddingDownloadDecision(input: {
  cached: boolean;
  stdinTTY: boolean;
  stdoutTTY: boolean;
  ci: boolean;
}): EmbeddingDownloadReason {
  if (input.cached) return 'already-cached';
  if (!input.stdinTTY || !input.stdoutTTY || input.ci) return 'non-interactive';
  return 'prompt';
}

/**
 * Download the embedding model by loading the feature-extraction pipeline
 * once, which populates the transformers.js cache. Progress is reported via
 * the optional `onProgress` callback (human-readable lines).
 *
 * Throws when `@huggingface/transformers` is not installed or the download
 * fails — callers decide how to present that.
 */
export async function downloadEmbeddingModel(onProgress?: (line: string) => void): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hf: any;
  try {
    hf = await loadTransformers();
  } catch (err) {
    throw new Error(
      `The embedding runtime (@huggingface/transformers) is not available: ${(err as Error).message}`,
    );
  }

  const seen = new Set<string>();
  await hf.pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
    dtype: 'fp32',
    progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
      if (!onProgress || !p) return;
      if (p.status === 'downloading' && p.file && !seen.has(p.file)) {
        seen.add(p.file);
        onProgress(`Downloading ${p.file}...`);
      } else if (p.status === 'progress' && p.file && typeof p.progress === 'number') {
        onProgress(`Downloading ${p.file}... ${Math.floor(p.progress)}%`);
      } else if (p.status === 'done' && p.file) {
        onProgress(`Downloaded ${p.file}`);
      }
    },
  });
}
