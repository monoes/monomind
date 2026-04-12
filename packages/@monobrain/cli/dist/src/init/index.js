/**
 * V1 Init Module
 * Comprehensive initialization system for Claude Code integration
 */
// Types
export { DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS, FULL_INIT_OPTIONS, detectPlatform, } from './types.js';
// Generators
export { generateSettings, generateSettingsJson, } from './settings-generator.js';
export { generateMCPConfig, generateMCPJson, } from './mcp-generator.js';
export { generateStatuslineScript, generateStatuslineHook, } from './statusline-generator.js';
export { generatePreCommitHook, generatePostCommitHook, generateSessionManager, generateAgentRouter, generateMemoryHelper, generateHookHandler, generateIntelligenceStub, generateAutoMemoryHook, } from './helpers-generator.js';
export { generateClaudeMd, generateMinimalClaudeMd, CLAUDE_MD_TEMPLATES, } from './claudemd-generator.js';
// Main executor
export { executeInit, executeUpgrade, executeUpgradeWithMissing, default } from './executor.js';
//# sourceMappingURL=index.js.map