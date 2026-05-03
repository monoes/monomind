import { resolve, join } from 'path';
import Graph from 'graphology';
import { openDb, closeDb } from '../storage/db.js';
import { PipelineRunner } from './runner.js';
import { scanPhase } from './phases/scan.js';
import { structurePhase } from './phases/structure.js';
import { parsePhase } from './phases/parse.js';
import { crossFilePhase } from './phases/cross-file.js';
import { reExportPropagationPhase } from './phases/re-export-propagation.js';
import { mroPhase } from './phases/mro.js';
import { communitiesPhase } from './phases/communities.js';
import { godNodesPhase } from './phases/god-nodes.js';
import { surprisesPhase } from './phases/surprises.js';
import { suggestPhase } from './phases/suggest.js';
import { embeddingsPhase } from './phases/embeddings.js';
import { docsParsePhase } from './phases/docs-parse.js';
import { pdfParsePhase } from './phases/pdf-parse.js';
import { contextualProximityPhase } from './phases/contextual-proximity.js';
import { llmExtractPhase } from './phases/llm-extract.js';
import { classifyReachability } from './phases/reachability.js';
import type { PipelineOptions, PipelineContext } from './types.js';
import { DEFAULT_OPTIONS } from './types.js';
import type { PipelineProgress } from '../types.js';

export interface BuildOptions extends Partial<PipelineOptions> {
  onProgress?: (p: PipelineProgress) => void;
  force?: boolean;
}

export async function buildAsync(repoPath: string, options: BuildOptions = {}): Promise<void> {
  const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
  const fullOptions: PipelineOptions = { ...DEFAULT_OPTIONS, ...options };
  const db = openDb(dbPath);

  try {
    const graph = new Graph({ multi: true, type: 'directed' });
    const ctx: PipelineContext = {
      repoPath: resolve(repoPath),
      db, graph,
      onProgress: options.onProgress ?? (() => {}),
      options: fullOptions,
    };

    const runner = new PipelineRunner([
      scanPhase, structurePhase, parsePhase, crossFilePhase,
      reExportPropagationPhase,
      mroPhase, communitiesPhase, godNodesPhase, surprisesPhase, suggestPhase,
      docsParsePhase, pdfParsePhase, contextualProximityPhase, llmExtractPhase,
      embeddingsPhase,
    ]);

    await runner.run(ctx);

    // Post-pipeline: classify every File node's reachability role
    ctx.onProgress?.({ phase: 'reachability', message: 'Classifying file reachability roles...' });
    const reachCounts = classifyReachability(db, resolve(repoPath));
    ctx.onProgress?.({
      phase: 'reachability',
      message: `Reachability classification complete — runtime:${reachCounts.runtime} test:${reachCounts.test} support:${reachCounts.support} unreachable:${reachCounts.unreachable}`,
    });
  } finally {
    closeDb(db);
  }
}
