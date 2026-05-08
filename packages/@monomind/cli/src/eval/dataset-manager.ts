/**
 * DatasetManager - JSONL-based eval dataset management (Task 33)
 */
import { randomUUID } from 'crypto';
import { appendFileSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import type { EvalDataset, EvalDatasetEntry, EvalTrace } from '../../../shared/src/types/eval.js';
import { parseJsonl } from '../utils/parse-jsonl.js';

export interface CreateFromTracesOpts {
  name: string;
  description: string;
  traces: EvalTrace[];
  agentSlugs?: string[];
}

export class DatasetManager {
  private datasetsPath: string;
  private entriesPath: string;

  constructor(datasetsPath: string, entriesPath: string) {
    this.datasetsPath = datasetsPath;
    this.entriesPath = entriesPath;
  }

  /**
   * Create a dataset from a set of filtered traces.
   */
  createFromTraces(opts: CreateFromTracesOpts): EvalDataset {
    const now = new Date().toISOString();
    const agentSlugs = opts.agentSlugs ?? [...new Set(opts.traces.map((t) => t.agentSlug))];
    const dataset: EvalDataset = {
      datasetId: randomUUID(),
      name: opts.name,
      description: opts.description,
      agentSlugs,
      createdAt: now,
      updatedAt: now,
      entryCount: opts.traces.length,
    };

    appendFileSync(this.datasetsPath, JSON.stringify(dataset) + '\n', 'utf-8');

    for (const trace of opts.traces) {
      const entry: EvalDatasetEntry = {
        entryId: randomUUID(),
        datasetId: dataset.datasetId,
        traceId: trace.traceId,
        addedAt: now,
      };
      appendFileSync(this.entriesPath, JSON.stringify(entry) + '\n', 'utf-8');
    }

    return dataset;
  }

  /**
   * List all datasets.
   */
  listDatasets(): EvalDataset[] {
    if (!existsSync(this.datasetsPath)) return [];
    if (statSync(this.datasetsPath).size > 50 * 1024 * 1024) {
      throw new Error('Dataset file exceeds 50MB — run cleanup');
    }
    const content = readFileSync(this.datasetsPath, 'utf-8');
    return parseJsonl<EvalDataset>(content);
  }

  /**
   * Get entries for a specific dataset.
   */
  getEntries(datasetId: string): EvalDatasetEntry[] {
    if (!existsSync(this.entriesPath)) return [];
    if (statSync(this.entriesPath).size > 50 * 1024 * 1024) {
      throw new Error('Entries file exceeds 50MB — run cleanup');
    }
    const content = readFileSync(this.entriesPath, 'utf-8');
    return parseJsonl<EvalDatasetEntry>(content).filter((e) => e.datasetId === datasetId);
  }

  /**
   * Add a single trace to an existing dataset.
   */
  addTraceToDataset(datasetId: string, traceId: string): EvalDatasetEntry {
    const entry: EvalDatasetEntry = {
      entryId: randomUUID(),
      datasetId,
      traceId,
      addedAt: new Date().toISOString(),
    };
    appendFileSync(this.entriesPath, JSON.stringify(entry) + '\n', 'utf-8');

    // Update dataset entryCount via atomic write
    const datasets = this.listDatasets();
    const updated = datasets.map((d) => {
      if (d.datasetId === datasetId) {
        return { ...d, entryCount: d.entryCount + 1, updatedAt: new Date().toISOString() };
      }
      return d;
    });
    const tmp = `${this.datasetsPath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, updated.map((d) => JSON.stringify(d)).join('\n') + '\n', 'utf-8');
    renameSync(tmp, this.datasetsPath);

    return entry;
  }

  /**
   * Export a dataset to a JSON file. Output path must be within `allowedRoot`.
   */
  exportToFile(datasetId: string, outputPath: string, allowedRoot?: string): void {
    if (allowedRoot) {
      const resolvedOut = resolve(outputPath);
      const resolvedRoot = resolve(allowedRoot);
      if (!resolvedOut.startsWith(resolvedRoot + sep) && resolvedOut !== resolvedRoot) {
        throw new Error(`Export path escapes allowed root: ${resolvedOut}`);
      }
    }
    const datasets = this.listDatasets();
    const dataset = datasets.find((d) => d.datasetId === datasetId);
    const entries = this.getEntries(datasetId);
    writeFileSync(outputPath, JSON.stringify({ dataset, entries }, null, 2), 'utf-8');
  }
}
