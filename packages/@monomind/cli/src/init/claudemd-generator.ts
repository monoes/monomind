/**
 * CLAUDE.md Generator
 * Generates enforceable, analyzer-optimized Claude Code configuration
 * with template variants for different usage patterns.
 *
 * Templates: minimal | standard | full | security | performance | solo
 * All templates use bullet-format rules with imperative keywords for enforceability.
 */

import { _resetOptionalPackageCache } from './claudemd-detect.js';
import {
  autoStartProtocol,
  behavioralRules,
  codingPrinciples,
  concurrencyRules,
  executionRules,
  fileOrganization,
  projectArchitecture,
} from './claudemd-sections-core.js';
import {
  agentPicking,
  agentTypes,
  buildAndTest,
  cliCommandsTable,
  hooksSystem,
  intelligenceSystem,
  learningProtocol,
  memoryCommands,
  monographSection,
  performanceSection,
  secondBrainSection,
  securityRulesLight,
  securitySection,
  setupAndBoundary,
} from './claudemd-sections-reference.js';
import type { ClaudeMdTemplate, InitOptions } from './types.js';

export { _resetOptionalPackageCache };

// i-041/i-117 §4: MONOMIND_MEMORY_BACKEND and MONOMIND_MEMORY_PATH had no
// `process.env` reader anywhere in the repo (grepped — see claudemd-truth.test.ts
// and the developer report for the exact commands run). MONOMIND_CONFIG
// (services/config-file-manager.ts) does; MONOMIND_LOG_LEVEL lost its only
// src/ reader with monoswarm (#418); ANTHROPIC_API_KEY is read by the SDK,
// not by us. Keep only vars with a real reader — a var nobody reads is the
// same class of lie as a wrong count.
function envVars(): string {
  return `## Environment Variables

\`\`\`bash
MONOMIND_CONFIG=./monomind.config.json
ANTHROPIC_API_KEY=sk-ant-...
\`\`\``;
}

// --- Template Composers ---

/** The [PICK] line comes from the UserPromptSubmit route hook; without that
 * hook installed, rules about following it are dead text. */
function pickingRules(opts: InitOptions): string {
  const hooked = opts.components.settings && opts.components.helpers && opts.hooks.userPromptSubmit;
  return hooked ? agentPicking() : '';
}

const LEAN_SECTIONS: Array<(opts: InitOptions) => string> = [
  behavioralRules,
  (_opts) => codingPrinciples(),
  fileOrganization,
  projectArchitecture,
  buildAndTest,
  (_opts) => securityRulesLight(),
  concurrencyRules,
  pickingRules,
  secondBrainSection,
  (_opts) => monographSection(),
];

/**
 * Template section map — defines which sections are included per template.
 */
const TEMPLATE_SECTIONS: Record<ClaudeMdTemplate, Array<(opts: InitOptions) => string>> = {
  // GH #412: minimal/standard/solo carry only rules that change what the
  // model does in the user's project. The CLI tables, curated agent list,
  // memory commands and setup/support boilerplate stay in the opt-in
  // full/security/performance templates.
  minimal: LEAN_SECTIONS,
  standard: LEAN_SECTIONS,
  full: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    pickingRules,
    (_opts) => autoStartProtocol(),
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => hooksSystem(),
    (_opts) => learningProtocol(),
    (_opts) => memoryCommands(),
    secondBrainSection,
    (_opts) => monographSection(),
    (_opts) => intelligenceSystem(),
    (_opts) => envVars(),
    setupAndBoundary,
  ],
  security: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    concurrencyRules,
    pickingRules,
    executionRules,
    (_opts) => securitySection(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    secondBrainSection,
    (_opts) => monographSection(),
    setupAndBoundary,
  ],
  performance: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    pickingRules,
    executionRules,
    (_opts) => performanceSection(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    secondBrainSection,
    (_opts) => monographSection(),
    (_opts) => intelligenceSystem(),
    setupAndBoundary,
  ],
  solo: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    pickingRules,
    executionRules,
    (_opts) => monographSection(),
  ],
};

// --- Public API ---

/**
 * Generate CLAUDE.md content based on init options and template.
 * Template is determined by: options.runtime.claudeMdTemplate > explicit param > 'standard'
 */
export function generateClaudeMd(options: InitOptions, template?: ClaudeMdTemplate): string {
  const tmpl = template ?? options.runtime.claudeMdTemplate ?? 'standard';
  const sections = TEMPLATE_SECTIONS[tmpl] ?? TEMPLATE_SECTIONS.standard;

  const header = `# Claude Code Configuration - Monomind\n`;
  // A conditional section returns '' when it does not apply to this project.
  const body = sections
    .map((fn) => fn(options))
    .filter(Boolean)
    .join('\n\n');

  return `${header}\n${body}\n`;
}

/**
 * Generate minimal CLAUDE.md content (backward-compatible alias).
 */
export function generateMinimalClaudeMd(options: InitOptions): string {
  return generateClaudeMd(options, 'minimal');
}

/** Available template names for CLI wizard */
export const CLAUDE_MD_TEMPLATES: Array<{ name: ClaudeMdTemplate; description: string }> = [
  { name: 'minimal', description: 'Quick start — same lean rules as standard (~60 lines)' },
  {
    name: 'standard',
    description: 'Recommended — project rules, graph-first navigation, agent picking (~60 lines)',
  },
  {
    name: 'full',
    description: 'Everything — hooks, memory protocol, intelligence system (~400 lines)',
  },
  {
    name: 'security',
    description: 'Security-focused — adds security scanning, audit protocols, CVE checks',
  },
  {
    name: 'performance',
    description: 'Performance-focused — adds benchmarking, profiling, optimization protocols',
  },
  {
    name: 'solo',
    description: 'Solo developer — lean rules plus background-agent execution rules (~65 lines)',
  },
];

export default generateClaudeMd;
