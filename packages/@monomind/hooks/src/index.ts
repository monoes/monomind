/**
 * @monobrain/hooks - V1 Hooks System
 *
 * Event-driven lifecycle hooks with ReasoningBank learning integration.
 *
 * Features:
 * - Hook registration and execution
 * - Background daemons for metrics and learning
 * - Statusline integration
 * - MCP tool definitions
 * - V2 compatibility layer
 *
 * @packageDocumentation
 */

// Types
export * from './types.js';

// ReasoningBank - Vector-based pattern learning
export {
  ReasoningBank,
  reasoningBank,
  type GuidancePattern,
  type GuidanceResult,
  type RoutingResult,
  type ReasoningBankConfig,
  type ReasoningBankMetrics,
} from './reasoningbank/index.js';

// Guidance Provider - Claude-visible output generation
export {
  GuidanceProvider,
  guidanceProvider,
  type ClaudeHookOutput,
} from './reasoningbank/guidance-provider.js';

// Registry
export {
  HookRegistry,
  defaultRegistry,
  registerHook,
  unregisterHook,
} from './registry/index.js';

// Executor
export {
  HookExecutor,
  defaultExecutor,
  executeHooks,
} from './executor/index.js';

// Daemons
export {
  DaemonManager,
  MetricsDaemon,
  SwarmMonitorDaemon,
  HooksLearningDaemon,
  defaultDaemonManager,
  initDefaultWorkers,
} from './daemons/index.js';

// Statusline
export {
  StatuslineGenerator,
  createShellStatusline,
  parseStatuslineData,
  defaultStatuslineGenerator,
} from './statusline/index.js';

// MCP Tools
export {
  hooksMCPTools,
  getHooksTool,
  preEditTool,
  postEditTool,
  routeTaskTool,
  metricsTool,
  preCommandTool,
  postCommandTool,
  daemonStatusTool,
  statuslineTool,
  evoAgentXTool,
  modelOutcomeTool,
  type MCPTool,
  // Trace tools (GAP-010)
  listTracesTool,
  getTraceTool,
  traceMCPTools,
  // Interrupt checkpoint tools (GAP-008)
  listPendingCheckpointsTool,
  approveCheckpointTool,
  rejectCheckpointTool,
  getCheckpointTool,
  checkpointMCPTools,
} from './mcp/index.js';

// Official Claude Code Hooks Bridge
export {
  OfficialHooksBridge,
  HOOK_TO_OFFICIAL_MAP,
  TOOL_MATCHERS,
  processOfficialHookInput,
  outputOfficialHookResult,
  executeWithBridge,
  type OfficialHookEvent,
  type OfficialHookInput,
  type OfficialHookOutput,
} from './bridge/official-hooks-bridge.js';

// Swarm Communication
export {
  SwarmCommunication,
  swarmComm,
  type SwarmMessage,
  type PatternBroadcast,
  type ConsensusRequest,
  type TaskHandoff,
  type SwarmAgentState,
  type SwarmConfig,
} from './swarm/index.js';

// Workers - Cross-platform background workers
export {
  WorkerManager,
  WorkerPriority,
  AlertSeverity,
  WORKER_CONFIGS,
  DEFAULT_THRESHOLDS,
  createWorkerManager,
  workerManager,
  // Worker factories
  createPerformanceWorker,
  createHealthWorker,
  createSwarmWorker,
  createGitWorker,
  createLearningWorker,
  createADRWorker,
  createDDDWorker,
  createSecurityWorker,
  createPatternsWorker,
  createCacheWorker,
  // Types
  type WorkerConfig,
  type WorkerResult,
  type WorkerMetrics,
  type WorkerManagerStatus,
  type WorkerHandler,
  type WorkerAlert,
  type AlertThreshold,
  type PersistedWorkerState,
  type HistoricalMetric,
  type StatuslineData,
} from './workers/index.js';

// Workers - MCP Tools
export {
  workerMCPTools,
  createWorkerToolHandler,
  workerRunTool,
  workerStatusTool,
  workerAlertsTool,
  workerHistoryTool,
  workerStatuslineTool,
  workerRunAllTool,
  workerStartTool,
  workerStopTool,
  type MCPToolDefinition,
  type MCPToolResult,
} from './workers/mcp-tools.js';

// Workers - Session Integration
export {
  onSessionStart,
  onSessionEnd,
  formatSessionStartOutput,
  generateShellHook,
  getGlobalManager,
  setGlobalManager,
  initializeGlobalManager,
  type SessionHookConfig,
  type SessionHookResult,
} from './workers/session-hook.js';

// Cost Tracking
export {
  CostTracker,
  CostReporter,
  calculateCostUsd,
  MODEL_PRICING,
  CREATE_TABLE_SQL,
  CREATE_INDEXES_SQL,
  type BudgetAlert,
  type CostTrackerConfig,
  type ReportOptions,
  type AgentCostSummary,
  type CostReport,
  type ModelPrice,
  type CostRecord,
} from './cost/index.js';

// Entity Workers (Task 10)
export { EntityExtractorWorker, buildExtractionPrompt, parseEntityFacts } from './workers/entity-extractor.js';
export { EntityCleanupWorker } from './workers/entity-cleanup.js';
// FOREVER forgetting curve replay scheduler (newinnovation.md §2.6)
export {
  ForgettingCurveWorker,
  type ForgettingCurveEntry,
  type ForgettingCurveResult,
  type ForgettingCurveConfig,
} from './workers/forgetting-curve-worker.js';

// ERL — Experiential Reflective Learning heuristic extraction (arXiv:2603.24639)
export {
  ERLWorker,
  type ERLTrajectory,
  type ERLHeuristic,
  type ERLResult,
  type ERLConfig,
  type TrajectoryStep,
} from './workers/erl-worker.js';

// TextGrad — backward pass via textual gradients (arXiv:2406.07496)
export {
  TextGradWorker,
  type TextGradInput,
  type TextualGradient,
  type TextGradResult,
  type TextGradConfig,
} from './workers/textgrad-worker.js';

// MAR — Multi-Agent Reflexion structured reflection (arXiv:2512.20845)
export {
  MARWorker,
  type MARInput,
  type MARReflection,
  type MARResult,
  type MARConfig,
  type DiagnosisReport,
  type CriticPerspective,
} from './workers/mar-worker.js';

// RAPTOR — Recursive Abstractive Tree Indexing (arXiv:2401.18059)
export {
  RaptorWorker,
  type RaptorEntry,
  type RaptorCluster,
  type RaptorResult,
  type RaptorConfig,
} from './workers/raptor-worker.js';

// Episode Binner (Task 11)
export { EpisodeBinnerWorker } from './workers/episode-binner.js';

// Interrupt / Human-in-the-Loop (Task 16)
export {
  InterruptCheckpointer,
  type InterruptCheckpoint,
  type AgentSpawnPayload,
} from './interrupt/index.js';

// Observability (Task 12)
export {
  TraceStore,
  TraceCollector,
  type Trace,
  type AgentSpan,
  type ToolCallEvent,
  type TokenUsage,
} from './observability/index.js';

// Session Replay (Task 14)
export {
  ReplayReader,
  type TimelineEvent,
  type TimelineEventKind,
  type ReplayTimeline,
} from './observability/index.js';

// Latency Reporting (Task 13)
export {
  LatencyReporter,
  createLatencyReporter,
  type AgentLatencyStats,
  type LatencyReport,
  type LatencyAlert,
  type LatencyThreshold,
} from './observability/index.js';

// Observability Bus (Task 15)
export {
  ObservabilityBus,
  globalObservabilityBus,
  BusHookBridge,
  CLISink,
  AgentDBSink,
  OTelSink,
  type ObservabilityEvent,
  type TokenUsageEvent,
  type ObservabilityBusSink,
} from './observability/index.js';

// Optimization - Few-Shot Prompt Optimization (Task 25) + EvoAgentX (Tier 4)
export {
  type QualityMetric,
  LengthBasedMetric,
  JSONValidityMetric,
  LLMJudgeMetric,
  // Agent-as-a-Judge (arXiv:2410.10934)
  TraceAwareJudgeMetric,
  type TraceStep,
  BootstrapFewShot,
  type TraceRecord,
  type FewShotExample,
  type BootstrapFewShotConfig,
  TraceQualityStore,
  PromptOptimizer,
  type OptimizationResult,
  type OptimizeOptions,
  GEPAOptimizer,
  type GEPAConfig,
  type GEPACandidate,
  type GEPAResult,
  EvoAgentXCoordinator,
  type EvoAgentXConfig,
  type EvoAgentXResult,
} from './optimization/index.js';

// Planning Step (Task 42) + LATS coordinator planning (Tier 4, arXiv:2310.04406)
export {
  buildPlanningPrompt,
  validatePlan,
  PlanStore,
  DEFAULT_PLANNING_CONFIG,
  type PlanFormat,
  type PlanningConfig,
  type AgentPlan,
  type PlanValidationResult,
  buildLATSPlan,
  type LATSConfig,
} from './planning/index.js';

// Confidence-Gated Human Input (Task 43)
export {
  injectConfidencePrompt,
  parseScore,
  evaluateConfidenceGate,
  InputRequestStore,
  DEFAULT_CONFIDENCE_CONFIG,
  type HumanInputMode,
  type ConfidenceConfig,
  type InputRequest,
  type InputRequestStatus,
  type GateAction,
  type GateResult,
} from './confidence/index.js';

// SubGraph Composition (Task 48) + AFLOW workflow search (arXiv:2410.10762) + DAGLearner (Tier 4)
export {
  compile as compileSubGraph,
  SubGraphRegistry,
  validateKeyContracts,
  compose as composeSubGraphs,
  AFLOWSearch,
  type AFLOWConfig,
  type AFLOWResult,
  type SequenceRewardFn,
  type StateKey,
  type AgentNode,
  type Edge,
  type SubGraph,
  type CompiledSubGraph,
  type SubGraphManifest,
  type ComposedTopology,
  DAGLearner,
  type DAGLearnerConfig,
  type DAGLearnerResult,
} from './subgraph/index.js';

// Messaging — Per-Agent-Pair Conversation Threading (Task 41) + μACP (Tier 4)
export {
  ConversationThread,
  ThreadedMessageBus,
  threadedMessageBus,
  type AgentId,
  type Message,
  type ThreadStats,
  MuACP,
  type MuACPVerb,
  type MuACPEvent,
  type MuACPSession,
  type MuACPCommitResult,
} from './messaging/index.js';

// Dynamic Agent Synthesis (Task 47) + DGM MAP-Elites archive (arXiv:2505.22954)
export {
  type AgentDefinition,
  type AgentCapability,
  type SynthesisRequest,
  type EphemeralAgentRecord,
  type CleanupResult,
  agentDefinitionSchema,
  SynthesisPromptTemplate,
  EphemeralRegistry,
  TTLCleanup,
  AgentPromoter,
  DGMArchive,
  type DGMArchiveEntry,
} from './synthesis/index.js';

// Nested Swarms (Task 44)
export {
  NestedSwarmEnvelope,
  SummaryGenerator,
  SubSwarmManager,
  subSwarmManager,
} from './nested-swarm/index.js';

// Version
export const VERSION = '3.0.0-alpha.1';

/**
 * Initialize hooks system with default configuration
 */
export async function initializeHooks(options?: {
  enableDaemons?: boolean;
  enableStatusline?: boolean;
}): Promise<{
  registry: import('./registry/index.js').HookRegistry;
  executor: import('./executor/index.js').HookExecutor;
  statusline: import('./statusline/index.js').StatuslineGenerator;
}> {
  const { HookRegistry } = await import('./registry/index.js');
  const { HookExecutor } = await import('./executor/index.js');
  const { StatuslineGenerator } = await import('./statusline/index.js');
  const { DaemonManager, MetricsDaemon, SwarmMonitorDaemon, HooksLearningDaemon } = await import('./daemons/index.js');

  const registry = new HookRegistry();
  const executor = new HookExecutor(registry);
  const statusline = new StatuslineGenerator();

  // Start daemons if enabled
  if (options?.enableDaemons !== false) {
    const daemonManager = new DaemonManager();
    const metricsDaemon = new MetricsDaemon(daemonManager);
    const swarmDaemon = new SwarmMonitorDaemon(daemonManager);
    const learningDaemon = new HooksLearningDaemon(daemonManager);

    await Promise.all([
      metricsDaemon.start(),
      swarmDaemon.start(),
      learningDaemon.start(),
    ]);
  }

  return { registry, executor, statusline };
}

/**
 * Quick hooks execution helper
 */
export async function runHook(
  event: import('./types.js').HookEvent,
  context: Partial<import('./types.js').HookContext>
): Promise<import('./types.js').HookExecutionResult> {
  const { executeHooks } = await import('./executor/index.js');
  return executeHooks(event, context);
}

/**
 * Register a new hook with simplified API
 */
export async function addHook(
  event: import('./types.js').HookEvent,
  handler: import('./types.js').HookHandler,
  options?: {
    priority?: import('./types.js').HookPriority;
    name?: string;
  }
): Promise<string> {
  const { registerHook: register } = await import('./registry/index.js');
  const { HookPriority } = await import('./types.js');

  return register(
    event,
    handler,
    options?.priority ?? HookPriority.Normal,
    { name: options?.name }
  );
}
