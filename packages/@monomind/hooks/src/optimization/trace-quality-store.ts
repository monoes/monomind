/**
 * TraceQualityStore - JSONL-based trace quality persistence
 *
 * Stores trace quality records as append-only JSONL files.
 * Supports querying by agent, date range, and quality threshold.
 *
 * @module @monobrain/hooks/optimization/trace-quality-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TraceRecord } from './bootstrap-fewshot.js';

// ===== Serialisation =====

interface TraceRecordJSON {
  traceId: string;
  agentSlug: string;
  input: string;
  output: string;
  qualityScore: number;
  createdAt: string;
}

function toJSON(r: TraceRecord): TraceRecordJSON {
  return {
    traceId: r.traceId,
    agentSlug: r.agentSlug,
    input: r.input,
    output: r.output,
    qualityScore: r.qualityScore,
    createdAt: r.createdAt.toISOString(),
  };
}

function fromJSON(j: TraceRecordJSON): TraceRecord {
  return {
    traceId: j.traceId,
    agentSlug: j.agentSlug,
    input: j.input,
    output: j.output,
    qualityScore: j.qualityScore,
    createdAt: new Date(j.createdAt),
  };
}

// ===== Store =====

export class TraceQualityStore {
  private readonly filePath: string;

  constructor(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
    this.filePath = path.join(dirPath, 'trace-quality.jsonl');
  }

  /** Append a trace record to the JSONL file. */
  saveScore(record: TraceRecord): void {
    const line = JSON.stringify(toJSON(record)) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
  }

  /** Query traces filtered by agent slug, date, and minimum quality. */
  query(agentSlug: string, fromDate: Date, minQuality: number): TraceRecord[] {
    const all = this.readAll();
    return all.filter(
      (r) =>
        r.agentSlug === agentSlug &&
        r.createdAt.getTime() >= fromDate.getTime() &&
        r.qualityScore >= minQuality,
    );
  }

  /** Get aggregate stats for an agent. */
  getStats(agentSlug: string): { count: number; avgQuality: number } {
    const records = this.readAll().filter((r) => r.agentSlug === agentSlug);
    if (records.length === 0) return { count: 0, avgQuality: 0 };
    const sum = records.reduce((acc, r) => acc + r.qualityScore, 0);
    return { count: records.length, avgQuality: sum / records.length };
  }

  // ---- private I/O ----

  private readAll(): TraceRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => fromJSON(JSON.parse(line)));
  }
}
