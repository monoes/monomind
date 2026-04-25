/**
 * Plugins System - ADR-004 Implementation
 *
 * Plugin architecture for extending Monobrain functionality.
 *
 * @module v1/shared/plugins
 */

// Types
export type {
  PluginConfig,
  PluginContext,
  PluginEvent,
  PluginEventHandler,
  MonobrainPlugin,
  PluginMetadata,
  IPluginRegistry,
  IPluginLoader,
} from './types.js';

// Official Plugins
export {
  HiveMindPlugin,
  createHiveMindPlugin,
  type HiveMindConfig,
  type CollectiveDecision,
  type EmergentPattern,
  MaestroPlugin,
  createMaestroPlugin,
  type MaestroConfig,
  type WorkflowStep,
  type Workflow,
  type OrchestrationResult,
} from './official/index.js';
