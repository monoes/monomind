/**
 * Latency Percentile Monitoring Per Agent — Task 13
 *
 * Computes p50/p95/p99/max/avg latency stats per agent from TraceStore spans.
 * Generates alerts when thresholds are exceeded.
 *
 * No native dependencies — uses TraceStore's JSONL-based querySpans.
 */

import { TraceStore } from './trace.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AgentLatencyStats {
  agentSlug: string;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
  windowHours: number;
}

export interface LatencyReport {
  generatedAt: number;
  windowHours: number;
  agents: AgentLatencyStats[];
  alerts: LatencyAlert[];
}

export interface LatencyAlert {
  agentSlug: string;
  metric: 'p95' | 'p99';
  observedMs: number;
  thresholdMs: number;
  severity: 'warning' | 'critical';
}

export interface LatencyThreshold {
  agentSlug: string;       // '*' matches all agents
  p95ThresholdMs: number;
  p99ThresholdMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(pct * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(
  agentSlug: string,
  latencies: number[],
  windowHours: number,
): AgentLatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    agentSlug,
    sampleCount: sorted.length,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1] ?? 0,
    avgMs: sorted.length > 0 ? sum / sorted.length : 0,
    windowHours,
  };
}

// ---------------------------------------------------------------------------
// LatencyReporter
// ---------------------------------------------------------------------------

export class LatencyReporter {
  constructor(
    private readonly store: TraceStore,
    private readonly thresholds: LatencyThreshold[],
  ) {}

  /**
   * Generate a full latency report across all agents within the window.
   */
  report(windowHours = 24): LatencyReport {
    const spans = this.store.database.querySpans(windowHours);

    // Group latencies by agent slug
    const grouped = new Map<string, number[]>();
    for (const span of spans) {
      const startMs = new Date(span.started_at).getTime();
      const endMs = new Date(span.ended_at).getTime();
      const latencyMs = endMs - startMs;
      const list = grouped.get(span.agent_slug) ?? [];
      list.push(latencyMs);
      grouped.set(span.agent_slug, list);
    }

    // Compute stats per agent
    const agents: AgentLatencyStats[] = [];
    for (const [slug, latencies] of grouped) {
      agents.push(computeStats(slug, latencies, windowHours));
    }

    // Sort by p95 descending (worst offenders first)
    agents.sort((a, b) => b.p95Ms - a.p95Ms);

    // Check thresholds and generate alerts
    const alerts = this.checkThresholds(agents);

    return {
      generatedAt: Date.now(),
      windowHours,
      agents,
      alerts,
    };
  }

  /**
   * Generate a report filtered to a single agent.
   * Returns undefined if the agent has no spans in the window.
   */
  reportAgent(agentSlug: string, windowHours = 24): AgentLatencyStats | undefined {
    const full = this.report(windowHours);
    return full.agents.find((a) => a.agentSlug === agentSlug);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private checkThresholds(agents: AgentLatencyStats[]): LatencyAlert[] {
    const alerts: LatencyAlert[] = [];

    for (const stats of agents) {
      for (const threshold of this.thresholds) {
        if (threshold.agentSlug !== '*' && threshold.agentSlug !== stats.agentSlug) {
          continue;
        }

        // Check p95
        if (stats.p95Ms > threshold.p95ThresholdMs) {
          alerts.push({
            agentSlug: stats.agentSlug,
            metric: 'p95',
            observedMs: stats.p95Ms,
            thresholdMs: threshold.p95ThresholdMs,
            severity: stats.p95Ms > threshold.p95ThresholdMs * 2 ? 'critical' : 'warning',
          });
        }

        // Check p99 (if threshold specified)
        if (threshold.p99ThresholdMs !== undefined && stats.p99Ms > threshold.p99ThresholdMs) {
          alerts.push({
            agentSlug: stats.agentSlug,
            metric: 'p99',
            observedMs: stats.p99Ms,
            thresholdMs: threshold.p99ThresholdMs,
            severity: stats.p99Ms > threshold.p99ThresholdMs * 2 ? 'critical' : 'warning',
          });
        }
      }
    }

    return alerts;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLatencyReporter(
  store: TraceStore,
  thresholds: LatencyThreshold[] = [],
): LatencyReporter {
  return new LatencyReporter(store, thresholds);
}
