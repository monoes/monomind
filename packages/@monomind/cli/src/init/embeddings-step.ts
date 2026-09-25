/**
 * `monomind init --with-embeddings`: record the embeddings config and fetch
 * the local model memory embeds with, so semantic search works from the first
 * query instead of silently falling back to keyword matching.
 *
 * It used to shell out to `npx monomind@latest embeddings init`, a command
 * that does not exist, so the step always printed "skipped".
 */

import { output } from '../output.js';
import { DEFAULT_EMBEDDING_MODEL } from './types.js';

export interface EmbeddingsStepDeps {
  /** Writes .monomind/embeddings.json (the embeddings_init MCP tool). */
  writeConfig(model: string): Promise<{ success: boolean; error?: string }>;
  /** Fetches the memory bridge's embedding model; throws when it can't. */
  downloadModel(): Promise<void>;
}

const defaultDeps: EmbeddingsStepDeps = {
  async writeConfig(model) {
    const { embeddingsTools } = await import('../mcp-tools/embeddings-tools.js');
    const tool = embeddingsTools.find((t) => t.name === 'embeddings_init');
    if (!tool) return { success: false, error: 'embeddings_init tool unavailable' };
    return (await tool.handler({ model, hyperbolic: true, force: true })) as {
      success: boolean;
      error?: string;
    };
  },
  async downloadModel() {
    const { downloadEmbeddingModel } = await import('../memory/memory-bridge.js');
    await downloadEmbeddingModel();
  },
};

/** Never throws: an offline or failed download degrades to a warning. */
export async function runEmbeddingsStep(
  model: string,
  deps: EmbeddingsStepDeps = defaultDeps,
): Promise<{ configured: boolean; modelReady: boolean }> {
  let configured = false;
  try {
    const r = await deps.writeConfig(model);
    configured = r.success;
    if (r.success)
      output.writeln(output.success(`  ✓ Embeddings config written (model: ${model})`));
    else output.writeln(output.warning(`  Embeddings config not written: ${r.error ?? 'unknown'}`));
  } catch (e) {
    output.writeln(
      output.warning(
        `  Embeddings config not written: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  if (model !== DEFAULT_EMBEDDING_MODEL) {
    output.writeln(
      output.dim(
        `    Memory and document search always embed with ${DEFAULT_EMBEDDING_MODEL}; ${model} is recorded for the embeddings_* tools only.`,
      ),
    );
  }

  output.writeln(
    output.dim(`  Preparing ${DEFAULT_EMBEDDING_MODEL} (downloaded once, then cached)...`),
  );
  try {
    await deps.downloadModel();
    output.writeln(output.success(`  ✓ Embedding model ready (${DEFAULT_EMBEDDING_MODEL})`));
    return { configured, modelReady: true };
  } catch (e) {
    output.writeln(
      output.warning(
        `  Embedding model not downloaded (${e instanceof Error ? e.message : String(e)}) — search uses keyword matching until it is.`,
      ),
    );
    output.writeln(output.dim('    Run once while online: monomind doc eval --provision-model'));
    return { configured, modelReady: false };
  }
}
