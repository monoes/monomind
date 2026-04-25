import { randomBytes } from 'crypto';
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { CostRecord } from './cost-schema.js';
import { calculateCostUsd } from './model-pricing.js';

export interface BudgetAlert {
  agentSlug: string;
  totalCostUsd: number;
  maxCostUsd: number;
  exceedance: number;
}

export interface CostTrackerConfig {
  /** Path to JSON-lines cost data file */
  dbPath: string;
}

interface StoredRecord extends CostRecord {
  id: string;
  costUsd: number;
  createdAt: string;
}

/**
 * Records per-agent cost data to a JSON-lines file.
 * Uses append-only file storage for zero-dependency operation.
 */
export class CostTracker {
  private dbPath: string;

  constructor(config: CostTrackerConfig) {
    this.dbPath = config.dbPath;
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Record a cost entry.
   * costUsd is computed from model pricing if not provided.
   */
  record(entry: CostRecord): void {
    const costUsd = entry.costUsd ?? calculateCostUsd(
      entry.model,
      entry.inputTokens,
      entry.outputTokens
    );

    const record: StoredRecord = {
      id: entry.id || randomBytes(8).toString('hex'),
      agentSlug: entry.agentSlug,
      taskType: entry.taskType,
      taskId: entry.taskId,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd,
      latencyMs: entry.latencyMs,
      retryCount: entry.retryCount ?? 0,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };

    appendFileSync(this.dbPath, JSON.stringify(record) + '\n', 'utf8');
  }

  /**
   * Read all records, optionally filtered by agent slug.
   */
  readAll(agentSlug?: string): StoredRecord[] {
    if (!existsSync(this.dbPath)) return [];
    const lines = readFileSync(this.dbPath, 'utf8').trim().split('\n').filter(Boolean);
    const records = lines.map(line => JSON.parse(line) as StoredRecord);
    if (agentSlug) {
      return records.filter(r => r.agentSlug === agentSlug);
    }
    return records;
  }

  /**
   * Check if an agent has exceeded its budget in the last 24 hours.
   */
  checkBudget(agentSlug: string, maxCostUsd: number): BudgetAlert | null {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const records = this.readAll(agentSlug).filter(r => r.createdAt >= cutoff);
    const total = records.reduce((sum, r) => sum + r.costUsd, 0);

    if (total > maxCostUsd) {
      return {
        agentSlug,
        totalCostUsd: total,
        maxCostUsd,
        exceedance: total - maxCostUsd,
      };
    }
    return null;
  }

  close(): void {
    // No-op for file-based storage
  }
}
