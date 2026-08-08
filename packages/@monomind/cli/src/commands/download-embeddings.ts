/**
 * CLI Download-Embeddings Command
 * Explicitly fetch the semantic-routing embedding model (opt-in pre-seed).
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_SIZE_LABEL,
  downloadEmbeddingModel,
  isEmbeddingModelCached,
} from '../routing/model-download.js';

const downloadEmbeddingsAction = async (_ctx: CommandContext): Promise<CommandResult> => {
  if (isEmbeddingModelCached()) {
    output.printInfo(`Embedding model already cached — nothing to download.`);
    return { success: true, message: 'already cached' };
  }

  output.printInfo(`Downloading ${EMBEDDING_MODEL_ID} (${EMBEDDING_MODEL_SIZE_LABEL})...`);

  try {
    await downloadEmbeddingModel((line) => output.writeln(output.dim(`  ${line}`)));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    output.printError(`Embedding model download failed: ${message}`);
    return { success: false, exitCode: 1, message };
  }

  output.printSuccess('Embedding model cached — semantic routing is now available.');
  return { success: true };
};

export const downloadEmbeddingsCommand: Command = {
  name: 'download-embeddings',
  description: 'Download the semantic-routing embedding model (opt-in, ~88 MB)',
  options: [],
  examples: [
    { command: 'monomind download-embeddings', description: 'Fetch and cache the embedding model' },
  ],
  action: downloadEmbeddingsAction,
};

export default downloadEmbeddingsCommand;
