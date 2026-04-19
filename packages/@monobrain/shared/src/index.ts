/**
 * @monobrain/shared - Shared Module
 * Common types and core interfaces for Monobrain
 *
 * Based on ADR-002 (DDD) and ADR-006 (Unified Memory Service)
 *
 * NOTE: 62+ dead exports were removed on 2026-04-19 (round 2 audit).
 * Only SystemConfig has confirmed external consumers (@monobrain/cli config-adapter).
 * See docs/tododeleted.md for the full list of removed exports with revival instructions.
 */

// =============================================================================
// Types - Primary type definitions
// =============================================================================
export * from './types.js';

// =============================================================================
// Events - Event bus and basic event interfaces
// =============================================================================
export { EventBus } from './events.js';
export type { IEventBus, EventFilter } from './events.js';

// =============================================================================
// SystemConfig — the only type confirmed imported by external packages
// (by @monobrain/cli config-adapter)
// =============================================================================
export interface SystemConfig {
  orchestrator?: {
    lifecycle?: { maxConcurrentAgents?: number; spawnTimeout?: number; terminateTimeout?: number; maxSpawnRetries?: number };
    session?: { dataDir?: string; persistSessions?: boolean; sessionRetentionMs?: number };
    health?: { checkInterval?: number; historyLimit?: number; degradedThreshold?: number; unhealthyThreshold?: number };
  };
  swarm?: {
    topology?: string;
    maxAgents?: number;
    autoScale?: { enabled?: boolean; minAgents?: number; maxAgents?: number; scaleUpThreshold?: number; scaleDownThreshold?: number };
    coordination?: { consensusRequired?: boolean; timeoutMs?: number; retryPolicy?: { maxRetries?: number; backoffMs?: number } };
    communication?: { protocol?: string; batchSize?: number; flushIntervalMs?: number };
  };
  memory?: {
    type?: string;
    path?: string;
    maxSize?: number;
    agentdb?: { dimensions?: number; indexType?: string; efConstruction?: number; m?: number; quantization?: string };
  };
  mcp?: {
    name?: string;
    version?: string;
    transport?: { type?: string; host?: string; port?: number };
    capabilities?: { tools?: boolean; resources?: boolean; prompts?: boolean; logging?: boolean };
  };
}

// =============================================================================
// Hooks System — re-exported for @monobrain/hooks internal use
// =============================================================================
export * from './hooks/index.js';
