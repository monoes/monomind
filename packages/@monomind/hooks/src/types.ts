/**
 * Hooks System Types
 *
 * Core type definitions for the hooks system including:
 * - Hook events and priorities
 * - Hook handlers and context
 * - Execution results
 * - Statusline configuration
 */

/**
 * Hook event types
 */
export enum HookEvent {
  // Tool lifecycle
  PreToolUse = 'pre-tool-use',
  PostToolUse = 'post-tool-use',

  // File operations
  PreEdit = 'pre-edit',
  PostEdit = 'post-edit',
  PreRead = 'pre-read',
  PostRead = 'post-read',

  // Command execution
  PreCommand = 'pre-command',
  PostCommand = 'post-command',

  // Task lifecycle
  PreTask = 'pre-task',
  PostTask = 'post-task',
  TaskProgress = 'task-progress',

  // Session lifecycle
  SessionStart = 'session-start',
  SessionEnd = 'session-end',
  SessionRestore = 'session-restore',

  // Agent lifecycle
  AgentSpawn = 'agent-spawn',
  AgentTerminate = 'agent-terminate',

  // Routing
  PreRoute = 'pre-route',
  PostRoute = 'post-route',

  // Learning
  PatternLearned = 'pattern-learned',
  PatternConsolidated = 'pattern-consolidated',
}

/**
 * Hook priority levels
 */
export enum HookPriority {
  Critical = 1000, // Security, validation - runs first
  High = 100, // Pre-processing, preparation
  Normal = 50, // Standard hooks
  Low = 10, // Logging, metrics
  Background = 1, // Async operations - runs last
}

/**
 * Hook handler function type
 */
export type HookHandler<T = unknown> = (
  context: HookContext<T>,
) => Promise<HookResult> | HookResult;

/**
 * Hook context passed to handlers
 */
export interface HookContext<T = unknown> {
  /** The event that triggered this hook */
  event: HookEvent;

  /** Timestamp when the event occurred */
  timestamp: Date;

  /** Distributed trace correlation ID */
  traceId?: string;

  /** Span ID for the specific agent/operation */
  spanId?: string;

  /** Tool information (for tool hooks) */
  tool?: {
    name: string;
    parameters: Record<string, unknown>;
  };

  /** File information (for file hooks) */
  file?: {
    path: string;
    operation: 'create' | 'modify' | 'delete' | 'read';
  };

  /** Command information (for command hooks) */
  command?: {
    raw: string;
    workingDirectory?: string;
    exitCode?: number;
    output?: string;
    error?: string;
  };

  /** Task information (for task hooks) */
  task?: {
    id: string;
    description: string;
    agent?: string;
    status?: string;
  };

  /** Session information */
  session?: {
    id: string;
    startedAt: Date;
  };

  /** Agent information (for agent hooks) */
  agent?: {
    id: string;
    type: string;
    status?: string;
  };

  /** Routing information (for routing hooks) */
  routing?: {
    task: string;
    recommendedAgent?: string;
    confidence?: number;
  };

  /** Execution duration in milliseconds */
  duration?: number;

  /** Custom metadata */
  metadata?: Record<string, unknown>;

  /** Custom payload data */
  data?: T;
}

/**
 * Hook execution result
 */
export interface HookResult {
  /** Whether the hook executed successfully */
  success: boolean;

  /** Whether to abort subsequent hooks and/or the operation */
  abort?: boolean;

  /** Error message if failed */
  error?: string;

  /** Custom data to pass to subsequent hooks */
  data?: Record<string, unknown>;

  /** Message to display to user */
  message?: string;

  /** Warnings to display */
  warnings?: string[];
}

/**
 * Registered hook entry
 */
export interface HookEntry {
  /** Unique hook identifier */
  id: string;

  /** Event this hook is registered for */
  event: HookEvent;

  /** Handler function */
  handler: HookHandler;

  /** Execution priority */
  priority: HookPriority;

  /** Whether the hook is enabled */
  enabled: boolean;

  /** Hook name for display */
  name?: string;

  /** Hook description */
  description?: string;

  /** Registration timestamp */
  registeredAt: Date;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook registration options
 */
export interface HookRegistrationOptions {
  /** Whether the hook is initially enabled */
  enabled?: boolean;

  /** Hook name for display */
  name?: string;

  /** Hook description */
  description?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook execution options
 */
export interface HookExecutionOptions {
  /** Continue executing hooks even if one fails */
  continueOnError?: boolean;

  /** Timeout for individual hook execution (ms) */
  timeout?: number;

  /** Whether to emit events to the event bus */
  emitEvents?: boolean;
}

/**
 * Aggregated hook execution result
 */
export interface HookExecutionResult {
  /** Overall success (all hooks passed) */
  success: boolean;

  /** Whether execution was aborted */
  aborted?: boolean;

  /** Number of hooks executed */
  hooksExecuted: number;

  /** Number of hooks that failed */
  hooksFailed: number;

  /** Total execution time in milliseconds */
  executionTime: number;

  /** Individual hook results */
  results: Array<{
    hookId: string;
    hookName?: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;

  /** Final context after all hooks */
  finalContext?: HookContext;

  /** Aggregated warnings from all hooks */
  warnings?: string[];

  /** Aggregated messages from all hooks */
  messages?: string[];
}

/**
 * Hook registry statistics
 */
export interface HookRegistryStats {
  /** Total registered hooks */
  totalHooks: number;

  /** Enabled hooks */
  enabledHooks: number;

  /** Disabled hooks */
  disabledHooks: number;

  /** Hooks by event type */
  hooksByEvent: Record<string, number>;

  /** Total executions */
  totalExecutions: number;

  /** Total failures */
  totalFailures: number;

  /** Average execution time (ms) */
  avgExecutionTime: number;
}

/**
 * Hook list filter options
 */
export interface HookListFilter {
  /** Filter by event type */
  event?: HookEvent;

  /** Filter by enabled status */
  enabled?: boolean;

  /** Filter by minimum priority */
  minPriority?: HookPriority;

  /** Filter by name pattern */
  namePattern?: RegExp;
}

// ============================================================================
// Statusline Types
// ============================================================================

/**
 * Statusline configuration
 */
export interface StatuslineConfig {
  /** Enable statusline */
  enabled: boolean;

  /** Refresh on hook execution */
  refreshOnHook: boolean;

  /** Show hooks metrics */
  showHooksMetrics: boolean;

  /** Show swarm activity */
  showSwarmActivity: boolean;

  /** Show performance targets */
  showPerformance: boolean;

  /** Custom format template */
  formatTemplate?: string;
}

// ============================================================================
// Metrics Database Types
// ============================================================================

/**
 * Hook stats record
 */
export interface HookStatsRecord {
  hookName: string;
  category: string;
  executionCount: number;
  successRate: number;
  avgTimeMs: number;
  lastExecuted: string;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * Pre-edit hook result
 */
export interface PreEditResult {
  filePath: string;
  operation: string;
  context?: {
    fileExists: boolean;
    fileType?: string;
    relatedFiles?: string[];
    similarPatterns?: Array<{
      pattern: string;
      confidence: number;
      description: string;
    }>;
  };
  suggestions?: Array<{
    agent: string;
    suggestion: string;
    confidence: number;
    rationale: string;
  }>;
  warnings?: string[];
}

/**
 * Post-edit hook input
 */
export interface PostEditInput {
  filePath: string;
  operation?: 'create' | 'modify' | 'delete';
  success: boolean;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Route task result
 */
export interface RouteTaskResult {
  task: string;
  recommendedAgent: string;
  confidence: number;
  alternativeAgents?: Array<{
    agent: string;
    confidence: number;
  }>;
  explanation?: string;
  reasoning?: {
    factors: Array<{
      factor: string;
      weight: number;
      value: number;
    }>;
    historicalPerformance?: Array<{
      agent: string;
      successRate: number;
      avgQuality: number;
      tasksSimilar: number;
    }>;
  };
}

/**
 * Metrics query input
 */
export interface MetricsQueryInput {
  category?: 'all' | 'routing' | 'edits' | 'commands' | 'patterns';
  timeRange?: 'hour' | 'day' | 'week' | 'month' | 'all';
  includeDetailedStats?: boolean;
  format?: 'json' | 'summary';
}
