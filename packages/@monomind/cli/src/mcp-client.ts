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
  browser:     async () => (await import('./mcp-tools/browser-tools.js')).browserTools,
  guidance:    async () => (await import('./mcp-tools/guidance-tools.js')).guidanceTools,
  autopilot:   async () => (await import('./mcp-tools/autopilot-tools.js')).autopilotTools,
  monograph:   async () => (await import('./mcp-tools/monograph-tools.js')).monographTools,
  graphify:    async () => (await import('./mcp-tools/graphify-tools.js')).graphifyTools,
  coverage:    async () => (await import('./monovector/coverage-tools.js')).coverageRouterTools,
  quality:     async () => (await import('./mcp-tools/quality-tools.js')).qualityTools,
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
 * Runtime JSON-Schema type name for a JS value, or undefined for values we do
 * not model (functions, symbols, bigint). `null` is reported as 'null' so a
 * declared `type: 'object'` does not silently accept it.
 *
 * Note the two JS/JSON mismatches this has to paper over: arrays are objects
 * in JS but a distinct type in JSON Schema, and JSON has no integer type —
 * `integer` is a *number* with a constraint, so `3` satisfies both `number`
 * and `integer` while `3.5` satisfies only `number`.
 */
function jsonTypeOf(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'number': return Number.isInteger(value) ? 'integer' : 'number';
    case 'object': return 'object';
    default: return undefined;
  }
}

function matchesDeclaredType(declared: string, actual: string): boolean {
  if (declared === actual) return true;
  // Every integer is a valid number; the reverse is not true.
  if (declared === 'number' && actual === 'integer') return true;
  return false;
}

/**
 * Check present arguments against the `type` each property declares in the
 * tool's inputSchema and WARN on a mismatch — deliberately non-fatal for now.
 *
 * `required` is already hard-enforced above; `type` is not, because nothing
 * ever checked it, so a tool declaring `{type: 'string'}` has always been free
 * to receive a number and reach its handler. Turning that into a throw without
 * knowing how many real callers violate their own schemas would break working
 * code, so this logs first: run the suite, count the warnings, then decide.
 *
 * Absent properties are ignored — that is `required`'s job, not this one's.
 * Explicit null is also ignored here for the same reason (the required check
 * already rejects it for required params, and an optional param set to null is
 * an "unset" idiom, not a type error).
 */
function warnOnTypeMismatch(
  toolName: string,
  schema: MCPTool['inputSchema'] | undefined,
  input: Record<string, unknown>
): void {
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object') return;

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;

    const prop = (properties as Record<string, unknown>)[key];
    if (!prop || typeof prop !== 'object') continue;

    const declared = (prop as { type?: unknown }).type;
    // Union types (`type: ['string','number']`) pass if any branch matches.
    const declaredList = typeof declared === 'string'
      ? [declared]
      : Array.isArray(declared) && declared.every(t => typeof t === 'string')
        ? (declared as string[])
        : undefined;
    if (!declaredList || declaredList.length === 0) continue;

    const actual = jsonTypeOf(value);
    if (!actual) continue;
    if (declaredList.some(d => matchesDeclaredType(d, actual))) continue;

    // Report `integer` as `number` — the distinction is an artefact of how we
    // classify JS numbers, not something the caller passed.
    const reported = actual === 'integer' ? 'number' : actual;
    console.error(
      `[mcp] tool '${toolName}' param '${key}': schema declares ` +
      `${declaredList.join('|')}, got ${reported}`
    );
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

  // Enforce the `required` contract each tool advertises in its inputSchema.
  // 120 of the ~254 tools declare required params, but nothing used to check
  // them: handlers were invoked with whatever arrived, so a missing argument
  // surfaced as whatever the handler happened to hit first — e.g.
  // `monograph_agent_record` leaked a raw `SqliteError: NOT NULL constraint
  // failed: agent_interactions.session_id` instead of naming the parameter.
  // This is the single choke point for both the stdio server and the
  // in-process CLI path, so validating here covers every tool at once.
  //
  // Only missing/undefined/null is rejected — empty strings and 0 are left
  // alone, since some tools legitimately accept them.
  const required = tool.inputSchema?.required;
  if (Array.isArray(required) && required.length > 0) {
    const missing = required.filter(
      key => input[key] === undefined || input[key] === null
    );
    if (missing.length > 0) {
      throw new MCPClientError(
        `MCP tool '${toolName}' missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
        toolName
      );
    }
  }

  warnOnTypeMismatch(toolName, tool.inputSchema, input);

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
