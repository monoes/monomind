/**
 * V1 Init Module
 * Comprehensive initialization system for Claude Code integration
 */

export {
  CLAUDE_MD_TEMPLATES,
  generateClaudeMd,
  generateMinimalClaudeMd,
} from './claudemd-generator.js';
export {
  CODEX_STATUS_LINE_ITEMS,
  generateCodexAgentsMd,
  generateCodexConfig,
  generateCodexStatusLineConfig,
} from './codex-generator.js';
export type { UpgradeResult } from './executor.js';
// Main executor
export {
  default,
  executeInit,
  executeUpgrade,
  executeUpgradeWithMissing,
  findMonomindProjects,
} from './executor.js';

export {
  generateAgentRouter,
  generateAutoMemoryHook,
  generateHookHandler,
  generateIntelligenceStub,
  generateMemoryHelper,
  generatePostCommitHook,
  generatePreCommitHook,
  generateSessionManager,
} from './helpers-generator.js';
export {
  generateMCPConfig,
  generateMCPJson,
} from './mcp-generator.js';
// Generators
export {
  generateSettings,
  generateSettingsJson,
} from './settings-generator.js';
export {
  generateStatuslineHook,
  generateStatuslineScript,
} from './statusline-generator.js';
// Types
export {
  type AgentsConfig,
  type CommandsConfig,
  DEFAULT_INIT_OPTIONS,
  detectPlatform,
  type EmbeddingsConfig,
  FULL_INIT_OPTIONS,
  type HooksConfig,
  type InitComponents,
  type InitOptions,
  type InitResult,
  type MCPConfig,
  MINIMAL_INIT_OPTIONS,
  type PlatformInfo,
  type RuntimeConfig,
  type SkillsConfig,
  type StatuslineConfig,
} from './types.js';
