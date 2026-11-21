/**
 * Shared worker types, enums, alert thresholds and the WORKER_CONFIGS table.
 *
 * Re-exported by worker-manager.ts, so existing imports keep working.
 */

// ============================================================================
// Types
// ============================================================================

export interface WorkerConfig {
  name: string;
  description: string;
  interval: number; // milliseconds
  enabled: boolean;
  priority: WorkerPriority;
  timeout: number;
  platforms?: ('linux' | 'darwin' | 'win32')[];
}

export enum WorkerPriority {
  Critical = 0,
  High = 1,
  Normal = 2,
  Low = 3,
  Background = 4,
}

export interface WorkerResult {
  worker: string;
  success: boolean;
  duration: number;
  data?: Record<string, unknown>;
  error?: string;
  alerts?: WorkerAlert[];
  timestamp: Date;
}

export interface WorkerMetrics {
  name: string;
  status: 'running' | 'idle' | 'error' | 'disabled';
  lastRun?: Date;
  lastDuration?: number;
  runCount: number;
  errorCount: number;
  avgDuration: number;
  lastResult?: Record<string, unknown>;
}

export interface WorkerManagerStatus {
  running: boolean;
  platform: string;
  workers: WorkerMetrics[];
  uptime: number;
  totalRuns: number;
  lastUpdate: Date;
}

export type WorkerHandler = () => Promise<WorkerResult>;

// ============================================================================
// Alert System Types
// ============================================================================

export enum AlertSeverity {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}

export interface WorkerAlert {
  worker: string;
  severity: AlertSeverity;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
  timestamp: Date;
}

export interface AlertThreshold {
  metric: string;
  warning: number;
  critical: number;
  comparison: 'gt' | 'lt' | 'eq';
}

export const DEFAULT_THRESHOLDS: Record<string, AlertThreshold[]> = {
  health: [
    { metric: 'memory.usedPct', warning: 80, critical: 95, comparison: 'gt' },
    { metric: 'disk.usedPct', warning: 85, critical: 95, comparison: 'gt' },
  ],
  security: [
    { metric: 'secrets', warning: 1, critical: 5, comparison: 'gt' },
    { metric: 'vulnerabilities', warning: 10, critical: 50, comparison: 'gt' },
  ],
};

// ============================================================================
// Persistence Types
// ============================================================================

export interface PersistedWorkerState {
  version: string;
  lastSaved: string;
  workers: Record<
    string,
    {
      lastRun?: string;
      lastResult?: Record<string, unknown>;
      runCount: number;
      errorCount: number;
      avgDuration: number;
    }
  >;
  history: HistoricalMetric[];
}

export interface HistoricalMetric {
  timestamp: string;
  worker: string;
  metrics: Record<string, number>;
}

// ============================================================================
// Statusline Types
// ============================================================================

/**
 * Verdicts the security worker can report.
 *
 * 'incomplete' is deliberately NOT a flavour of 'clean': it means at least one
 * candidate path could not be read, so the absence of findings proves nothing.
 * Anything that renders this union must give it a non-reassuring treatment.
 */
export type SecurityStatus = 'clean' | 'warning' | 'critical' | 'incomplete';

const SECURITY_STATUSES: readonly SecurityStatus[] = ['clean', 'warning', 'critical', 'incomplete'];

/**
 * Narrow an untyped worker result field to SecurityStatus.
 *
 * Worker results are `Record<string, unknown>`, so a plain `as` cast is
 * unsound — it silently admitted 'incomplete' into a union that did not list
 * it. Unrecognised values fall back to 'incomplete' rather than 'clean':
 * a verdict we cannot interpret is not evidence of safety.
 */
export function toSecurityStatus(value: unknown): SecurityStatus {
  // No security result at all (worker never ran) keeps the pre-existing
  // 'clean' default; the statusline separately shows 0 issues in that case.
  if (value === undefined || value === null) return 'clean';
  return SECURITY_STATUSES.includes(value as SecurityStatus)
    ? (value as SecurityStatus)
    : 'incomplete';
}

export interface StatuslineData {
  workers: {
    active: number;
    total: number;
    errors: number;
  };
  health: {
    status: 'healthy' | 'warning' | 'critical';
    memory: number;
    disk: number;
  };
  security: {
    /**
     * 'incomplete' means the scan could not read every candidate path, so
     * `issues` is a lower bound — NOT the same claim as 'clean'.
     */
    status: SecurityStatus;
    issues: number;
  };
  ddd: {
    progress: number;
  };
  alerts: WorkerAlert[];
  lastUpdate: string;
}

// ============================================================================
// Worker Definitions
// ============================================================================

// All workers are on-demand only (enabled: false = no setInterval timer).
// Run via `hooks worker run <name>` or triggered by session-restore-handler's
// freshness check at session start. 7 workers with zero consumers were deleted
// (performance, patterns, adr, learning, git, swarm, optimize) — see the
// 2026-07-17 audit plan for the full analysis.
export const WORKER_CONFIGS: Record<string, WorkerConfig> = {
  health: {
    name: 'health',
    description: 'Monitor disk, memory, CPU, processes',
    interval: 300_000,
    enabled: false,
    priority: WorkerPriority.High,
    timeout: 10_000,
  },
  ddd: {
    name: 'ddd',
    description: 'Track DDD domain implementation progress',
    interval: 600_000,
    enabled: false,
    priority: WorkerPriority.Low,
    timeout: 30_000,
  },
  security: {
    name: 'security',
    description: 'Scan for secrets, vulnerabilities, CVEs',
    interval: 1_800_000,
    enabled: false,
    priority: WorkerPriority.High,
    timeout: 120_000,
  },
  cache: {
    name: 'cache',
    description: 'Clean temp files, old logs, stale cache',
    interval: 3_600_000,
    enabled: false,
    priority: WorkerPriority.Background,
    timeout: 30_000,
  },
  map: {
    name: 'map',
    description: 'Codebase mapping — writes .monomind/metrics/codebase-map.json',
    interval: 21_600_000,
    enabled: false,
    priority: WorkerPriority.Normal,
    timeout: 30_000,
  },
  audit: {
    name: 'audit',
    description: 'Security audit — writes .monomind/metrics/security-audit.json',
    interval: 21_600_000,
    enabled: false,
    priority: WorkerPriority.High,
    timeout: 30_000,
  },
  consolidate: {
    name: 'consolidate',
    description: 'RAPTOR memory consolidation — writes .monomind/metrics/consolidation.json',
    interval: 21_600_000,
    enabled: false,
    priority: WorkerPriority.Low,
    timeout: 30_000,
  },
  progress: {
    name: 'progress',
    description: 'Implementation metrics — writes .monomind/metrics/progress.json',
    interval: 21_600_000,
    enabled: false,
    priority: WorkerPriority.Normal,
    timeout: 30_000,
  },
  reflexion: {
    name: 'reflexion',
    description:
      'Turns failed routed tasks from .monomind/route-outcomes.jsonl into templated keyword notes in .monomind/reflexion-store.json (run it with hooks worker run reflexion; the CLI/MCP hooks pre-task then shows matches, the live hooks do not)',
    interval: 3_600_000,
    enabled: false,
    priority: WorkerPriority.Normal,
    timeout: 30_000,
  },
};

// Worker alias map (legacy daemon-era alias → canonical internal name).
// map/audit/consolidate are real workers now, and the remaining
// daemon-only worker names (predict, document, refactor, preload, ultralearn,
// deepdive, benchmark, testgaps) were deleted with the daemon.
export const WORKER_ALIAS_MAP: Record<string, string> = {};
