/**
 * Embedding model management
 *
 * List and download ONNX embedding models via agentic-flow when present.
 * (The former "neural substrate" wrapper — drift / memory-physics / swarm /
 * coherence — was removed: it had zero callers anywhere in the repo. These two
 * functions remain because the `monomind embeddings` CLI command uses them.)
 */

/**
 * List available ONNX embedding models.
 * Falls back to a static default list when agentic-flow is not installed.
 */
export async function listEmbeddingModels(): Promise<Array<{
  id: string;
  dimension: number;
  size: string;
  quantized: boolean;
  downloaded: boolean;
}>> {
  try {
    // agentic-flow is an optional peer dep; its types aren't guaranteed present.
    const mod = (await import('agentic-flow/embeddings')) as any;
    if (typeof mod.listAvailableModels === 'function') {
      return mod.listAvailableModels();
    }
  } catch {
    // not installed — fall through to defaults
  }
  return [
    { id: 'all-MiniLM-L6-v2', dimension: 384, size: '23MB', quantized: false, downloaded: false },
    { id: 'all-mpnet-base-v2', dimension: 768, size: '110MB', quantized: false, downloaded: false },
  ];
}

/**
 * Download an embedding model via agentic-flow.
 * Throws if agentic-flow is not installed (the caller surfaces a clear message).
 */
export async function downloadEmbeddingModel(
  modelId: string,
  targetDir?: string,
  onProgress?: (progress: { percent: number; bytesDownloaded: number; totalBytes: number }) => void
): Promise<string> {
  const mod = (await import('agentic-flow/embeddings')) as any;
  if (typeof mod.downloadModel !== 'function') {
    throw new Error('Model download requires the optional "agentic-flow" package to be installed.');
  }
  return mod.downloadModel(modelId, targetDir ?? '.models', onProgress);
}
