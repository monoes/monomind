import type { MonographDb } from '../storage/db.js';
import type { PipelineProgress } from '../types.js';
import type Graph from 'graphology';

export interface PipelineContext {
  repoPath: string;
  db: MonographDb;
  graph: Graph;
  onProgress: (p: PipelineProgress) => void;
  options: PipelineOptions;
}

export interface PipelineOptions {
  codeOnly: boolean;
  maxFileSizeBytes: number;
  workerPoolThreshold: number;
  workerChunkBudgetBytes: number;
  ignore: string[];
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  codeOnly: false,
  maxFileSizeBytes: 524288,
  workerPoolThreshold: 15,
  workerChunkBudgetBytes: 20971520,
  ignore: [],
};

export interface PipelinePhase<TOutput> {
  name: string;
  deps: string[];
  execute(ctx: PipelineContext, depOutputs: Map<string, unknown>): Promise<TOutput>;
}
