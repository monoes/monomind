/**
 * CLI MCP Client — tool registry and lazy category loading
 * Split out of mcp-client.ts (file-size sweep). Pure move.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MCPTool } from './mcp-tools/types.js';

/**
 * MCP Tool Registry
 * Maps tool names to their handler functions — populated lazily per category.
 */
export const TOOL_REGISTRY = new Map<string, MCPTool>();

export function registerTools(tools: MCPTool[], options: { override?: boolean } = {}): void {
  for (const tool of tools) {
    if (TOOL_REGISTRY.has(tool.name) && !options.override) {
      throw new Error(`Tool name collision: ${tool.name} already registered`);
    }
    TOOL_REGISTRY.set(tool.name, tool);
  }
}

// ---------------------------------------------------------------------------
// Lazy category loaders — each returns a promise that resolves the MCPTool[]
// for that category. Cached after first load.
// ---------------------------------------------------------------------------
type CategoryLoader = () => Promise<MCPTool[]>;

export const CATEGORY_LOADERS: Record<string, CategoryLoader> = {
  agent: async () => (await import('./mcp-tools/agent-tools.js')).agentTools,
  memory: async () => (await import('./mcp-tools/memory-tools.js')).memoryTools,
  config: async () => (await import('./mcp-tools/config-tools.js')).configTools,
  hooks: async () => (await import('./mcp-tools/hooks-tools.js')).hooksTools,
  task: async () => (await import('./mcp-tools/task-tools.js')).taskTools,
  session: async () => (await import('./mcp-tools/session-tools.js')).sessionTools,
  analyze: async () => (await import('./mcp-tools/analyze-tools.js')).analyzeTools,
  embeddings: async () => (await import('./mcp-tools/embeddings-tools.js')).embeddingsTools,
  claims: async () => (await import('./mcp-tools/claims-tools.js')).claimsTools,
  monofence: async () => (await import('./mcp-tools/security-tools.js')).securityTools,
  transfer: async () => (await import('./mcp-tools/transfer-tools.js')).transferTools,
  system: async () => (await import('./mcp-tools/system-tools.js')).systemTools,
  terminal: async () => (await import('./mcp-tools/terminal-tools.js')).terminalTools,
  performance: async () => (await import('./mcp-tools/performance-tools.js')).performanceTools,
  platforms: async () => (await import('./mcp-tools/platforms-tools.js')).platformsTools,
  github: async () => (await import('./mcp-tools/github-tools.js')).githubTools,
  browser: async () => (await import('./mcp-tools/browser-tools.js')).browserTools,
  guidance: async () => (await import('./mcp-tools/guidance-tools.js')).guidanceTools,
  monograph: async () => (await import('./mcp-tools/monograph-tools.js')).monographTools,
  coverage: async () => (await import('./monovector/coverage-tools.js')).coverageRouterTools,
  quality: async () => (await import('./mcp-tools/quality-tools.js')).qualityTools,
  knowledge: async () => (await import('./mcp-tools/knowledge-tools.js')).knowledgeTools,
  monomind: async () => (await import('./mcp-tools/monomind-tools.js')).monomindTools,
  monodesign: async () => (await import('./mcp-tools/monodesign-tools.js')).monodesignTools,
  pick: async () => (await import('./mcp-tools/pick-tools.js')).pickTools,
  mesh: async () => (await import('./mcp-tools/mesh-tools.js')).meshTools,
  org: async () => (await import('./mcp-tools/org-skill-tools.js')).orgSkillTools,
  // system-tools.ts also exports tools with mcp_ and config_ prefixes
  mcp: async () => (await import('./mcp-tools/system-tools.js')).systemTools,
};

const loadedCategories = new Set<string>();

export async function ensureCategory(category: string): Promise<void> {
  if (loadedCategories.has(category)) return;
  const loader = CATEGORY_LOADERS[category];
  if (!loader) return;
  loadedCategories.add(category);
  registerTools(await loader(), { override: true });
}

export function categoryFromToolName(name: string): string {
  const idx = name.indexOf('_');
  return idx > 0 ? name.slice(0, idx) : name;
}

let _allLoaded = false;
export async function ensureAllLoaded(): Promise<void> {
  if (_allLoaded) return;
  _allLoaded = true;
  await Promise.all(Object.keys(CATEGORY_LOADERS).map((cat) => ensureCategory(cat)));
}

/**
 * Disabled-tools registry (`mcp toggle`)
 *
 * Read fresh on every check (the file is tiny and toggles are infrequent) so a
 * `mcp toggle` run in another process/session takes effect without restarting
 * this one. Filters both direct invocation (callMCPTool) and MCP server
 * registration (getAllMCPTools) so a disabled tool is actually excluded, not
 * just cosmetically hidden.
 */
export function loadDisabledTools(cwd: string = process.cwd()): Set<string> {
  const stateFile = join(cwd, '.monomind', 'mcp-disabled-tools.json');
  if (!existsSync(stateFile)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function isToolDisabled(toolName: string, cwd?: string): boolean {
  return loadDisabledTools(cwd).has(toolName);
}
