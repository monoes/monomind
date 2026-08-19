/**
 * Per-model-routing-decision outcome records — append-only JSONL ledger,
 * mirroring route-outcomes.ts's structure (same guards, same trim strategy).
 * This is what closes the loop between `hooks model-outcome` (writer) and
 * `hooks model-stats` (reader): before this file, model-outcome recorded
 * nothing and model-stats always reported `available: false`.
 */
import { promises as fs, statSync } from 'node:fs';
import { join } from 'node:path';

/** Refuse to read files larger than this to prevent OOM. */
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Cap string fields stored in each record to prevent file bloat. */
const MAX_FIELD_LEN = 500;

export interface ModelOutcomeRecord {
  ts: number;
  task: string;
  model: string; // 'haiku' | 'sonnet' | 'opus'
  outcome: string; // 'success' | 'failure' | 'escalated'
  quality?: number;
}

function storePath(baseDir: string): string {
  return join(baseDir, 'model-outcomes.jsonl');
}

/** Maximum number of records to keep in model-outcomes.jsonl. Mirrors
 *  MAX_ROUTE_RECORDS in route-outcomes.ts. */
const MAX_MODEL_RECORDS = 500;

/** Conservative estimate of bytes per record (capped fields + JSON overhead). */
const APPROX_BYTES_PER_RECORD = 300;

/** Append a model routing outcome. Opportunistically trims the file to
 *  MAX_MODEL_RECORDS lines to prevent unbounded growth. */
export async function recordModelOutcome(baseDir: string, rec: ModelOutcomeRecord): Promise<void> {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    const path = storePath(baseDir);
    const safeRec: ModelOutcomeRecord = {
      ...rec,
      task: rec.task.slice(0, MAX_FIELD_LEN),
      model: rec.model.slice(0, 32),
      outcome: rec.outcome.slice(0, 32),
    };
    await fs.appendFile(path, JSON.stringify(safeRec) + '\n', 'utf8');
    const fileStat = await fs.stat(path).catch(() => null);
    if (fileStat && fileStat.size > MAX_MODEL_RECORDS * APPROX_BYTES_PER_RECORD) {
      const content = await fs.readFile(path, 'utf8').catch(() => '');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length > MAX_MODEL_RECORDS) {
        await fs.writeFile(path, lines.slice(-MAX_MODEL_RECORDS).join('\n') + '\n', 'utf8');
      }
    }
  } catch {
    // Non-fatal — telemetry must never break routing
  }
}

/** Read all outcome records (for stats). */
export async function readModelOutcomes(baseDir: string): Promise<ModelOutcomeRecord[]> {
  try {
    const p = storePath(baseDir);
    try {
      if (statSync(p).size > MAX_FILE_BYTES) return [];
    } catch {
      /* file absent */
    }
    const content = await fs.readFile(p, 'utf8').catch(() => '');
    if (!content) return [];
    return content
      .trim()
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l) as ModelOutcomeRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is ModelOutcomeRecord => r !== null);
  } catch {
    return [];
  }
}

export interface ModelStats {
  totalDecisions: number;
  modelDistribution: Record<string, number>;
  successRate: number | null;
  byModel: Record<string, { count: number; successRate: number | null }>;
  avgQuality: number | null;
}

/** Compute real aggregate statistics from the recorded outcomes. */
export async function computeModelStats(baseDir: string): Promise<ModelStats> {
  const all = await readModelOutcomes(baseDir);

  const modelDistribution: Record<string, number> = {};
  const byModelCounts: Record<string, { success: number; total: number }> = {};
  let successCount = 0;
  let qualitySum = 0;
  let qualityCount = 0;

  for (const rec of all) {
    modelDistribution[rec.model] = (modelDistribution[rec.model] || 0) + 1;

    if (!byModelCounts[rec.model]) byModelCounts[rec.model] = { success: 0, total: 0 };
    byModelCounts[rec.model].total++;
    if (rec.outcome === 'success') {
      successCount++;
      byModelCounts[rec.model].success++;
    }

    if (typeof rec.quality === 'number' && Number.isFinite(rec.quality)) {
      qualitySum += rec.quality;
      qualityCount++;
    }
  }

  const byModel: Record<string, { count: number; successRate: number | null }> = {};
  for (const [model, { success, total }] of Object.entries(byModelCounts)) {
    byModel[model] = { count: total, successRate: total > 0 ? success / total : null };
  }

  return {
    totalDecisions: all.length,
    modelDistribution,
    successRate: all.length > 0 ? successCount / all.length : null,
    byModel,
    avgQuality: qualityCount > 0 ? qualitySum / qualityCount : null,
  };
}
