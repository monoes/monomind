/**
 * @monobrain/shared - Shared Module
 * Common types, events, utilities, and core interfaces for V1 Monobrain
 *
 * Based on ADR-002 (DDD) and ADR-006 (Unified Memory Service)
 */

// =============================================================================
// Types - Primary type definitions (from ./types.js)
// =============================================================================
export * from './types.js';

// =============================================================================
// Events - Event bus and basic event interfaces (from ./events.js)
// =============================================================================
export { EventBus } from './events.js';
export type { IEventBus, EventFilter } from './events.js';

// =============================================================================
// Event Sourcing - ADR-007 Domain events and event store
// (from ./events/index.js - no duplicates with ./events.js)
// =============================================================================
export type {
  DomainEvent,
  AllDomainEvents,
  AgentSpawnedEvent,
  AgentStartedEvent,
  AgentStoppedEvent,
  AgentFailedEvent,
  AgentStatusChangedEvent,
  AgentTaskAssignedEvent,
  AgentTaskCompletedEvent,
  TaskCreatedEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskBlockedEvent,
  TaskQueuedEvent,
  MemoryStoredEvent,
  MemoryRetrievedEvent,
  MemoryDeletedEvent,
  MemoryExpiredEvent,
  SwarmInitializedEvent,
  SwarmScaledEvent,
  SwarmTerminatedEvent,
  SwarmPhaseChangedEvent,
  SwarmMilestoneReachedEvent,
  SwarmErrorEvent,
  EventStoreConfig,
  EventSnapshot,
  EventStoreStats,
  AgentProjectionState,
  TaskProjectionState,
  MemoryProjectionState,
  AggregateRoot,
  ReconstructorOptions,
} from './events/index.js';

export {
  createAgentSpawnedEvent,
  createAgentStartedEvent,
  createAgentStoppedEvent,
  createAgentFailedEvent,
  createTaskCreatedEvent,
  createTaskStartedEvent,
  createTaskCompletedEvent,
  createTaskFailedEvent,
  createMemoryStoredEvent,
  createMemoryRetrievedEvent,
  createMemoryDeletedEvent,
  createSwarmInitializedEvent,
  createSwarmScaledEvent,
  createSwarmTerminatedEvent,
  EventStore,
  Projection,
  AgentStateProjection,
  TaskHistoryProjection,
  MemoryIndexProjection,
  StateReconstructor,
  createStateReconstructor,
  AgentAggregate,
  TaskAggregate,
} from './events/index.js';

// =============================================================================
// Plugin System - ADR-004
// =============================================================================
export * from './plugin-loader.js';
export * from './plugin-registry.js';

// =============================================================================
// Core - DDD interfaces, config, orchestrator
// Note: Only export non-overlapping items from core to avoid duplicates with types.js
// =============================================================================
export {
  // Event Bus
  createEventBus,
  // Orchestrator
  createOrchestrator,
  TaskManager,
  SessionManager,
  HealthMonitor,
  LifecycleManager,
  EventCoordinator,
  // Config validation/loading
  ConfigLoader,
  loadConfig,
  ConfigValidator,
  validateAgentConfig,
  validateTaskConfig,
  validateSwarmConfig,
  validateMemoryConfig,
  validateMCPServerConfig,
  validateOrchestratorConfig,
  validateSystemConfig,
  // Defaults
  defaultAgentConfig,
  defaultTaskConfig,
  defaultSwarmConfigCore,
  defaultMemoryConfig,
  defaultMCPServerConfig,
  defaultOrchestratorConfig,
  defaultSystemConfig,
  agentTypePresets,
  mergeWithDefaults,
} from './core/index.js';

export type {
  // Config types
  LoadedConfig,
  ConfigSource,
  ValidationResult,
  ValidationError,
  // Orchestrator types
  OrchestratorFacadeConfig,
  OrchestratorComponents,
  SessionManagerConfig,
  HealthMonitorConfig,
  LifecycleManagerConfig,
  // Schema types (from config - note these extend the basic types from types.js)
  AgentConfig,
  TaskConfig,
  SwarmConfig as SwarmConfigSchema,
  MemoryConfig,
  MCPServerConfig,
  OrchestratorConfig,
  SystemConfig,
  AgentConfigInput,
  TaskConfigInput,
  SwarmConfigInput,
  MemoryConfigInput,
  MCPServerConfigInput,
  OrchestratorConfigInput,
  SystemConfigInput,
  // Interface types
  ITask,
  ITaskCreate,
  ITaskResult,
  IAgent,
  IAgentConfig,
  IEventBus as ICoreEventBus,
  IMemoryBackend as ICoreMemoryBackend,
  ISwarmConfig,
  ISwarmState,
  ICoordinator,
  ICoordinationManager,
  IHealthStatus,
  IComponentHealth,
  IHealthMonitor,
  IMetricsCollector,
  IOrchestratorMetrics,
  IOrchestrator,
  SwarmTopology,
  CoordinationStatus,
} from './core/index.js';

// =============================================================================
// Hooks System
// =============================================================================
export * from './hooks/index.js';

// =============================================================================
// Security Utilities
// =============================================================================
export * from './security/index.js';

// =============================================================================
// Resilience Patterns
// =============================================================================
export * from './resilience/index.js';

// =============================================================================
// Services
// =============================================================================
export * from './services/index.js';

// =============================================================================
// Schema Validation (Task 05)
// =============================================================================
export { SchemaValidator } from './schema-validator.js';
export type { ValidationResult as SchemaValidationResult, ValidationError as SchemaValidationError } from './schema-validator.js';
export { AgentContract } from './agent-contract.js';
export type { CompatibilityReport, AgentContractConfig } from './agent-contract.js';

// =============================================================================
// Auto-Retry (Task 06)
// =============================================================================
export { runAgentWithRetry } from './retry-runner.js';
export type { RetryRunnerConfig } from './retry-runner.js';
export { isAgentErrorResult, createAgentErrorResult } from './agent-error-result.js';
export type { AgentErrorResult } from './agent-error-result.js';
export { DEFAULT_RETRY_POLICY, STRICT_RETRY_POLICY, LENIENT_RETRY_POLICY } from './retry-policy.js';
export type { RetryPolicy } from './retry-policy.js';

// =============================================================================
// Agent Version Types (Task 29)
// =============================================================================
export type { AgentVersion, AgentVersionRecord, DiffResult } from './types/agent-version.js';

// =============================================================================
// Termination Types (Task 35)
// =============================================================================
export type { TerminationPolicy, TerminationReason, TerminationEvent } from './types/termination.js';
export { DEFAULT_TERMINATION_POLICY } from './types/termination.js';

// =============================================================================
// Dead Letter Queue Types (Task 37)
// =============================================================================
export type { DeliveryAttempt, DLQEntry, DLQEntryStatus, DLQReplayResult } from './types/dlq.js';

// =============================================================================
// Eval Dataset Types (Task 33)
// =============================================================================
export type {
  EvalTrace,
  EvalDatasetEntry,
  EvalDataset,
  EvalRunResult,
  RegressionDetail,
} from './types/eval.js';

// =============================================================================
// Testing Utilities (Task 18)
// =============================================================================
export { TestModel, hashPrompt, type Model, type TestModelConfig, type PromptHash } from './testing/index.js';

// =============================================================================
// Reducers & Swarm State (Task 20)
// =============================================================================
export {
  appendReducer,
  lastWriteReducer,
  mergeUniqueReducer,
  deepMergeReducer,
  raftMergeReducer,
  REDUCERS,
} from './reducers.js';

export {
  createDefaultSwarmState,
} from './swarm-state.js';
export type {
  ReducerName,
  SwarmStateField,
  Message,
  Finding,
  AgentError,
  ConsensusVote,
  SwarmState,
} from './swarm-state.js';

export { StateManager } from './state-manager.js';

export { validateSwarmState } from './state-validator.js';
export type {
  StateValidationError,
  ValidationResult as StateValidationResult,
} from './state-validator.js';

// =============================================================================
// Agent Registry Types (Task 30)
// =============================================================================
export type { AgentRegistryEntry, TriggerPattern, AgentRegistry } from './types/agent-registry.js';

// =============================================================================
// Scratchpad (Task 22)
// =============================================================================
export { SharedScratchpad } from './scratchpad.js';
export type { ScratchpadEntry } from './scratchpad.js';

// =============================================================================
// Consensus Audit (Task 36)
// =============================================================================
export type {
  ConsensusProtocol,
  VoteRecord,
  QuorumProof,
  ConsensusAuditRecord,
} from './types/consensus-audit.js';
