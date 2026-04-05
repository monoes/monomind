/**
 * Official Plugins - ADR-004 Implementation
 *
 * Exports all official @monobrain plugins.
 *
 * @module v1/shared/plugins/official
 */

export {
  HiveMindPlugin,
  createHiveMindPlugin,
  type HiveMindConfig,
  type CollectiveDecision,
  type EmergentPattern,
} from './hive-mind-plugin.js';

export {
  MaestroPlugin,
  createMaestroPlugin,
  type MaestroConfig,
  type WorkflowStep,
  type Workflow,
  type OrchestrationResult,
} from './maestro-plugin.js';
