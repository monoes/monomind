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

