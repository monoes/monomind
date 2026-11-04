/**
 * CLI MCP Client
 *
 * Thin wrapper for calling MCP tools from CLI commands.
 * Implements ADR-005: MCP-First API Design - CLI as thin wrapper around MCP tools
 *
 * Tool modules are lazy-loaded on first use to avoid pulling ~300 tools'
 * transitive dependencies into the heap at import time.
 *
 * File-size sweep: split into sibling modules (mcp-client-registry.ts,
 * mcp-client-roster.ts, mcp-client-validation.ts). This file remains the
 * entry point and re-exports everything that used to live here so every
 * existing import keeps working.
 */

import {
  categoryFromToolName,
  ensureAllLoaded,
  ensureCategory,
  isToolDisabled,
  loadDisabledTools,
  TOOL_REGISTRY,
} from './mcp-client-registry.js';
import { ensureCoreLoaded, FULL_ROSTER, isCoreAdvertised } from './mcp-client-roster.js';
import { MCPClientError, warnOnTypeMismatch } from './mcp-client-validation.js';
import type { MCPTool } from './mcp-tools/types.js';
import { recordUsage } from './services/usage-counters.js';

export { isToolDisabled } from './mcp-client-registry.js';
export { MCPClientError } from './mcp-client-validation.js';

/**
 * Call an MCP tool by name with input parameters
 */
export async function callMCPTool<T = unknown>(
  toolName: string,
  input: Record<string, unknown> = {},
  context?: Record<string, unknown>,
): Promise<T> {
  // Lazy-load the tool's category if not yet loaded
  const cat = categoryFromToolName(toolName);
  await ensureCategory(cat);

  const tool = TOOL_REGISTRY.get(toolName);

  if (!tool) {
    throw new MCPClientError(`MCP tool not found: ${toolName}`, toolName);
  }

  if (isToolDisabled(toolName)) {
    throw new MCPClientError(
      `MCP tool '${toolName}' is disabled. Re-enable with: mcp toggle --enable ${toolName}`,
      toolName,
    );
  }

  // Opt-in, local-only usage counter (off by default). Only calls that came
  // through an MCP server (or `mcp exec`) carry a sessionId; in-process calls
  // a CLI command makes are already counted as that command. Fire-and-forget.
  if (typeof context?.sessionId === 'string') void recordUsage('mcp', toolName);

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
    const missing = required.filter((key) => input[key] === undefined || input[key] === null);
    if (missing.length > 0) {
      throw new MCPClientError(
        `MCP tool '${toolName}' missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
        toolName,
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
      error instanceof Error ? error : undefined,
    );
  }
}

/**
 * Get tool metadata by name
 */
export async function getToolMetadata(
  toolName: string,
): Promise<Omit<MCPTool, 'handler'> | undefined> {
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
export async function listMCPTools(
  category?: string,
): Promise<Array<Omit<MCPTool, 'handler'> & { enabled: boolean }>> {
  if (FULL_ROSTER) {
    await ensureAllLoaded();
  } else {
    await ensureCoreLoaded();
  }
  const tools = Array.from(TOOL_REGISTRY.values());
  const disabled = loadDisabledTools();

  // Advertise only the core roster unless MONOMIND_MCP_FULL=1. Non-core tools
  // stay callable via callMCPTool/hasTool and discoverable via monomind_tool_search.
  const advertised = FULL_ROSTER ? tools : tools.filter(isCoreAdvertised);

  const filtered = category ? advertised.filter((t) => t.category === category) : advertised;

  return filtered.map((tool) => ({
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
  return Array.from(TOOL_REGISTRY.values()).filter((t) => !disabled.has(t.name));
}

/**
 * On-demand discovery of hidden MCP tools — backs the `monomind_tool_search`
 * MCP tool. Loads every category, then returns full schemas for tools not in
 * the default advertised roster (non-core categories plus tools hidden by
 * CORE_HIDDEN_TOOLS), ranked by relevance to `query`. This is what keeps the
 * roster shrink from becoming a capability loss: a tool hidden from
 * `tools/list` remains findable (and directly callable) by keyword.
 */
export async function searchNonCoreTools(
  query: string,
  category?: string,
  limit = 10,
): Promise<Array<Omit<MCPTool, 'handler'> & { category: string }>> {
  await ensureAllLoaded();
  const disabled = loadDisabledTools();
  const q = (query || '').toLowerCase();
  const qTokens = q.split(/[\s_-]+/).filter(Boolean);

  const candidates = Array.from(TOOL_REGISTRY.values())
    .filter((t) => !disabled.has(t.name) && !isCoreAdvertised(t))
    .filter((t) => (category ? categoryFromToolName(t.name) === category : true));

  const scored = candidates.map((t) => {
    const name = t.name.toLowerCase();
    const desc = (t.description || '').toLowerCase();
    let score = 0;
    if (name.includes(q)) score += 50;
    if (desc.includes(q)) score += 20;
    for (const tok of qTokens) {
      if (name.includes(tok)) score += 8;
      if (desc.includes(tok)) score += 3;
    }
    return { t, score };
  });

  return scored
    .filter((s) => s.score > 0 || !q)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((s) => ({
      name: s.t.name,
      description: s.t.description,
      inputSchema: s.t.inputSchema,
      category: categoryFromToolName(s.t.name),
    }));
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
  TOOL_REGISTRY.forEach((tool) => {
    if (tool.category) categories.add(tool.category);
  });
  return Array.from(categories).sort();
}

/**
 * Validate tool input against schema
 */
export async function validateToolInput(
  toolName: string,
  input: Record<string, unknown>,
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
