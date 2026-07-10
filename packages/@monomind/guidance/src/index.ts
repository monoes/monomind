/**
 * @monomind/guidance - Enforcement Gates
 *
 * Hook-based enforcement gates that check commands for destructive
 * operations and content for leaked secrets. The gates serialize to
 * JSON so out-of-process CJS hook handlers can read the same patterns.
 *
 * @module @monomind/guidance
 */

// Re-export gate types
export type {
  RiskClass,
  ToolClass,
  TaskIntent,
  GuidanceRule,
  GateDecision,
  GateResult,
  GateConfig,
} from './types.js';

// Re-export gate implementation
export { EnforcementGates, createGates } from './gates.js';
export type { SerializedGateConfig, SerializedRegExp } from './gates.js';
