import { readFileSync, existsSync } from 'fs';
import { CostRecord } from './cost-schema.js';

export interface ReportOptions {
  periodDays?: number;
  limit?: number;
  since?: string;
  until?: string;
}

export interface AgentCostSummary {
  agentSlug: string;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number | null;
  totalRetries: number;
}

export interface CostReport {
  periodDays: number;
  generatedAt: string;
  totalCostUsd: number;
  totalCalls: number;
  byAgent: AgentCostSummary[];
}

interface StoredRecord extends CostRecord {
  id: string;
  costUsd: number;
  createdAt: string;
}

export class CostReporter {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  report(options: ReportOptions = {}): CostReport {
    const { periodDays = 7, limit = 20 } = options;

    const cutoff = options.since
      ?? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const until = options.until ?? new Date().toISOString();

    const records = this.readRecords()
      .filter(r => r.createdAt >= cutoff && r.createdAt <= until);

    const totalCostUsd = records.reduce((sum, r) => sum + r.costUsd, 0);
    const totalCalls = records.length;

    // Group by agent
    const agentMap = new Map<string, StoredRecord[]>();
    for (const record of records) {
      const existing = agentMap.get(record.agentSlug) ?? [];
      existing.push(record);
      agentMap.set(record.agentSlug, existing);
    }

    const byAgent: AgentCostSummary[] = Array.from(agentMap.entries())
      .map(([agentSlug, agentRecords]) => {
        const latencies = agentRecords
          .filter(r => r.latencyMs != null)
          .map(r => r.latencyMs!);

        return {
          agentSlug,
          totalCalls: agentRecords.length,
          totalInputTokens: agentRecords.reduce((s, r) => s + r.inputTokens, 0),
          totalOutputTokens: agentRecords.reduce((s, r) => s + r.outputTokens, 0),
          totalCostUsd: agentRecords.reduce((s, r) => s + r.costUsd, 0),
          avgLatencyMs: latencies.length > 0
            ? latencies.reduce((s, l) => s + l, 0) / latencies.length
            : null,
          totalRetries: agentRecords.reduce((s, r) => s + (r.retryCount ?? 0), 0),
        };
      })
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
      .slice(0, limit);

    return {
      periodDays,
      generatedAt: new Date().toISOString(),
      totalCostUsd,
      totalCalls,
      byAgent,
    };
  }

  private readRecords(): StoredRecord[] {
    if (!existsSync(this.dbPath)) return [];
    const lines = readFileSync(this.dbPath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line) as StoredRecord);
  }

  close(): void {
    // No-op for file-based storage
  }
}
