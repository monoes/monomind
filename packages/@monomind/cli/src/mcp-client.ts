/**
 * CLI MCP Client
 *
 * Thin wrapper for calling MCP tools from CLI commands.
 * Implements ADR-005: MCP-First API Design - CLI as thin wrapper around MCP tools
 *
 * Tool modules are lazy-loaded on first use to avoid pulling ~300 tools'
 * transitive dependencies into the heap at import time.
 */

import type { MCPTool } from './mcp-tools/types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MCP Tool Registry
 * Maps tool names to their handler functions — populated lazily per category.
 */
const TOOL_REGISTRY = new Map<string, MCPTool>();

function registerTools(tools: MCPTool[], options: { override?: boolean } = {}): void {
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

const CATEGORY_LOADERS: Record<string, CategoryLoader> = {
  agent:       async () => (await import('./mcp-tools/agent-tools.js')).agentTools,
  swarm:       async () => (await import('./mcp-tools/swarm-tools.js')).swarmTools,
  memory:      async () => (await import('./mcp-tools/memory-tools.js')).memoryTools,
  config:      async () => (await import('./mcp-tools/config-tools.js')).configTools,
  hooks:       async () => (await import('./mcp-tools/hooks-tools.js')).hooksTools,
  task:        async () => (await import('./mcp-tools/task-tools.js')).taskTools,
  session:     async () => (await import('./mcp-tools/session-tools.js')).sessionTools,
  'hive-mind': async () => (await import('./mcp-tools/hive-mind-tools.js')).hiveMindTools,
  analyze:     async () => (await import('./mcp-tools/analyze-tools.js')).analyzeTools,
  embeddings:  async () => (await import('./mcp-tools/embeddings-tools.js')).embeddingsTools,
  claims:      async () => (await import('./mcp-tools/claims-tools.js')).claimsTools,
  monofence:   async () => (await import('./mcp-tools/security-tools.js')).securityTools,
  transfer:    async () => (await import('./mcp-tools/transfer-tools.js')).transferTools,
  system:      async () => (await import('./mcp-tools/system-tools.js')).systemTools,
  terminal:    async () => (await import('./mcp-tools/terminal-tools.js')).terminalTools,
  neural:      async () => (await import('./mcp-tools/neural-tools.js')).neuralTools,
  performance: async () => (await import('./mcp-tools/performance-tools.js')).performanceTools,
  github:      async () => (await import('./mcp-tools/github-tools.js')).githubTools,
  daa:         async () => (await import('./mcp-tools/daa-tools.js')).daaTools,
  browser:     async () => (await import('./mcp-tools/browser-tools.js')).browserTools,
  guidance:    async () => (await import('./mcp-tools/guidance-tools.js')).guidanceTools,
  autopilot:   async () => (await import('./mcp-tools/autopilot-tools.js')).autopilotTools,
  monograph:   async () => (await import('./mcp-tools/monograph-tools.js')).monographTools,
  graphify:    async () => (await import('./mcp-tools/graphify-tools.js')).graphifyTools,
  coverage:    async () => (await import('./monovector/coverage-tools.js')).coverageRouterTools,
  quality:     async () => (await import('./mcp-tools/quality-tools.js')).qualityTools,
  coherence:   async () => (await import('./mcp-tools/coherence-tools.js')).coherenceTools,
  knowledge:   async () => (await import('./mcp-tools/knowledge-tools.js')).knowledgeTools,
  // system-tools.ts also exports tools with mcp_ and config_ prefixes
  mcp:         async () => (await import('./mcp-tools/system-tools.js')).systemTools,
};

const loadedCategories = new Set<string>();

async function ensureCategory(category: string): Promise<void> {
  if (loadedCategories.has(category)) return;
  const loader = CATEGORY_LOADERS[category];
  if (!loader) return;
  loadedCategories.add(category);
  registerTools(await loader(), { override: true });
}

function categoryFromToolName(name: string): string {
  const idx = name.indexOf('_');
  return idx > 0 ? name.slice(0, idx) : name;
}

let _allLoaded = false;
async function ensureAllLoaded(): Promise<void> {
  if (_allLoaded) return;
  _allLoaded = true;
  await Promise.all(
    Object.keys(CATEGORY_LOADERS).map(cat => ensureCategory(cat))
  );
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
function loadDisabledTools(cwd: string = process.cwd()): Set<string> {
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

/**
 * MCP Client Error
 */
export class MCPClientError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'MCPClientError';
  }
}

/**
 * Call an MCP tool by name with input parameters
 */
export async function callMCPTool<T = unknown>(
  toolName: string,
  input: Record<string, unknown> = {},
  context?: Record<string, unknown>
): Promise<T> {
  // Lazy-load the tool's category if not yet loaded
  const cat = categoryFromToolName(toolName);
  await ensureCategory(cat);

  const tool = TOOL_REGISTRY.get(toolName);

  if (!tool) {
    throw new MCPClientError(
      `MCP tool not found: ${toolName}`,
      toolName
    );
  }

  if (isToolDisabled(toolName)) {
    throw new MCPClientError(
      `MCP tool '${toolName}' is disabled. Re-enable with: mcp toggle --enable ${toolName}`,
      toolName
    );
  }

  try {
    const result = await tool.handler(input, context);
    return result as T;
  } catch (error) {
    throw new MCPClientError(
      `Failed to execute MCP tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`,
      toolName,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get tool metadata by name
 */
export async function getToolMetadata(toolName: string): Promise<Omit<MCPTool, 'handler'> | undefined> {
  const cat = categoryFromToolName(toolName);
  await ensureCategory(cat);
  const tool = TOOL_REGISTRY.get(toolName);
  if (!tool) return undefined;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: tool.category,
    tags: tool.tags,
    version: tool.version,
    cacheable: tool.cacheable,
    cacheTTL: tool.cacheTTL,
  };
}

/**
 * List all available MCP tools (loads all categories on first call)
 */
export async function listMCPTools(category?: string): Promise<Array<Omit<MCPTool, 'handler'> & { enabled: boolean }>> {
  await ensureAllLoaded();
  const tools = Array.from(TOOL_REGISTRY.values());
  const disabled = loadDisabledTools();

  const filtered = category
    ? tools.filter(t => t.category === category)
    : tools;

  return filtered.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: tool.category,
    tags: tool.tags,
    version: tool.version,
    cacheable: tool.cacheable,
    cacheTTL: tool.cacheTTL,
    enabled: !disabled.has(tool.name),
  }));
}

/**
 * Return all registered tools including their handler functions, excluding
 * any disabled via `mcp toggle`. Loads all categories on first call.
 */
export async function getAllMCPTools(): Promise<MCPTool[]> {
  await ensureAllLoaded();
  const disabled = loadDisabledTools();
  return Array.from(TOOL_REGISTRY.values()).filter(t => !disabled.has(t.name));
}

/**
 * Check if an MCP tool exists (checks loaded categories + known prefixes)
 */
export async function hasTool(toolName: string): Promise<boolean> {
  const cat = categoryFromToolName(toolName);
  await ensureCategory(cat);
  return TOOL_REGISTRY.has(toolName);
}

/**
 * Get all tool categories
 */
export async function getToolCategories(): Promise<string[]> {
  await ensureAllLoaded();
  const categories = new Set<string>();
  TOOL_REGISTRY.forEach(tool => {
    if (tool.category) categories.add(tool.category);
  });
  return Array.from(categories).sort();
}

/**
 * Validate tool input against schema
 */
export async function validateToolInput(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ valid: boolean; errors?: string[] }> {
  const cat = categoryFromToolName(toolName);
  await ensureCategory(cat);
  const tool = TOOL_REGISTRY.get(toolName);

  if (!tool) {
    return {
      valid: false,
      errors: [`Tool '${toolName}' not found`],
    };
  }

  const schema = tool.inputSchema;
  const errors: string[] = [];

  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredField of schema.required) {
      if (!(requiredField in input)) {
        errors.push(`Missing required field: ${requiredField}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export default {
  callMCPTool,
  getToolMetadata,
  listMCPTools,
  hasTool,
  getToolCategories,
  validateToolInput,
  MCPClientError,
};
