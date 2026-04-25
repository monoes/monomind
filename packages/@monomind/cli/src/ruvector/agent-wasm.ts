/**
 * RuVector Agent WASM Integration
 *
 * Wraps @ruvector/rvagent-wasm for sandboxed AI agent execution.
 * Provides WasmAgent lifecycle, gallery templates, RVF container building,
 * and MCP server bridge — all running in WASM without OS access.
 *
 * Published API (v0.1.0): WasmAgent, WasmGallery, WasmMcpServer,
 * WasmRvfBuilder, JsModelProvider, initSync.
 *
 * @module @monobrain/cli/ruvector/agent-wasm
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// ── Types ────────────────────────────────────────────────────

export interface WasmAgentConfig {
  model?: string;
  instructions?: string;
  maxTurns?: number;
}

export interface WasmAgentInfo {
  id: string;
  state: 'idle' | 'running' | 'error';
  config: WasmAgentConfig;
  model: string;
  turnCount: number;
  fileCount: number;
  isStopped: boolean;
  createdAt: string;
}

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  author: string;
  builtin: boolean;
}

export interface GalleryTemplateDetail extends GalleryTemplate {
  tools: Array<{ name: string; description: string; parameters: unknown[]; returns: string }>;
  prompts: Array<{ name: string; system_prompt: string; version: string }>;
  skills: Array<{ name: string; description: string; trigger: string; content: string }>;
  mcp_tools: Array<{ name: string; description: string; input_schema: unknown; group: string }>;
  capabilities: Array<{ name: string; rights: string[]; scope: string; delegation_depth: number }>;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

// ── WASM Module Detection & Init ─────────────────────────────

let _wasmReady = false;

/**
 * Check if @ruvector/rvagent-wasm is installed and loadable.
 */
export async function isAgentWasmAvailable(): Promise<boolean> {
  try {
    const mod = await import('@ruvector/rvagent-wasm');
    return typeof mod.WasmAgent === 'function';
  } catch {
    return false;
  }
}

/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with file-loaded WASM bytes (browser fetch doesn't work in Node).
 */
export async function initAgentWasm(): Promise<void> {
  if (_wasmReady) return;
  try {
    const mod = await import('@ruvector/rvagent-wasm');
    // In Node.js, load WASM bytes from disk and use initSync
    const require_ = createRequire(import.meta.url);
    const wasmPath = require_.resolve('@ruvector/rvagent-wasm/rvagent_wasm_bg.wasm');
    const wasmBytes = readFileSync(wasmPath);
    mod.initSync(wasmBytes);
    _wasmReady = true;
  } catch (err) {
    throw new Error(`Failed to initialize @ruvector/rvagent-wasm: ${err}`);
  }
}

// ── Agent Registry ───────────────────────────────────────────

const agents = new Map<string, { agent: any; info: WasmAgentInfo }>();
let nextId = 1;

function generateId(): string {
  return `wasm-agent-${nextId++}-${Date.now().toString(36)}`;
}

// ── Agent Lifecycle ──────────────────────────────────────────

/**
 * Create a new sandboxed WASM agent.
 */
export async function createWasmAgent(config: WasmAgentConfig = {}): Promise<WasmAgentInfo> {
  await initAgentWasm();
  const mod = await import('@ruvector/rvagent-wasm');

  const configJson = JSON.stringify({
    model: config.model ?? 'anthropic:claude-sonnet-4-20250514',
    instructions: config.instructions ?? 'You are a helpful coding assistant.',
    max_turns: config.maxTurns ?? 50,
  });

  const agent = new mod.WasmAgent(configJson);
  const id = generateId();

  const info: WasmAgentInfo = {
    id,
    state: 'idle',
    config,
    model: agent.model(),
    turnCount: agent.turn_count(),
    fileCount: agent.file_count(),
    isStopped: agent.is_stopped(),
    createdAt: new Date().toISOString(),
  };

  agents.set(id, { agent, info });
  return info;
}

/**
 * Send a prompt to a WASM agent. Requires a model provider to be set.
 */
export async function promptWasmAgent(agentId: string, input: string): Promise<string> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);

  entry.info.state = 'running';
  try {
    const result = await entry.agent.prompt(input);
    entry.info.state = 'idle';
    syncAgentInfo(entry);
    return result;
  } catch (err) {
    entry.info.state = 'error';
    throw err;
  }
}

/**
 * Execute a tool directly on a WASM agent's sandbox.
 * Tool format: {tool: 'write_file', path: '...', content: '...'} (flat, snake_case).
 * Available tools: read_file, write_file, edit_file, write_todos, list_files.
 */
const VALID_WASM_TOOLS = ['read_file', 'write_file', 'edit_file', 'write_todos', 'list_files'];

export async function executeWasmTool(agentId: string, toolCall: Record<string, unknown>): Promise<ToolResult> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  // Validate tool name to prevent WASM panics on unknown tools
  const toolName = toolCall.tool as string;
  if (toolName && !VALID_WASM_TOOLS.includes(toolName)) {
    return { success: false, output: `Unknown tool: ${toolName}. Available: ${VALID_WASM_TOOLS.join(', ')}` };
  }
  const result = await entry.agent.execute_tool(JSON.stringify(toolCall));
  syncAgentInfo(entry);
  return result as ToolResult;
}

function syncAgentInfo(entry: { agent: any; info: WasmAgentInfo }): void {
  try {
    entry.info.turnCount = entry.agent.turn_count();
    entry.info.fileCount = entry.agent.file_count();
    entry.info.isStopped = entry.agent.is_stopped();
  } catch { /* best-effort */ }
}

/**
 * Get agent info.
 */
export function getWasmAgent(agentId: string): WasmAgentInfo | null {
  const entry = agents.get(agentId);
  if (!entry) return null;
  syncAgentInfo(entry);
  return entry.info;
}

/**
 * List all active WASM agents.
 */
export function listWasmAgents(): WasmAgentInfo[] {
  return Array.from(agents.values()).map(e => {
    syncAgentInfo(e);
    return e.info;
  });
}

/**
 * Terminate a WASM agent and free resources.
 */
export function terminateWasmAgent(agentId: string): boolean {
  const entry = agents.get(agentId);
  if (!entry) return false;
  try { entry.agent.free(); } catch { /* already freed */ }
  agents.delete(agentId);
  return true;
}

/**
 * Get agent state (messages, turn count, etc.)
 */
export function getWasmAgentState(agentId: string): unknown {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return entry.agent.get_state();
}

/**
 * Get agent tools list.
 */
export function getWasmAgentTools(agentId: string): string[] {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return entry.agent.get_tools();
}

/**
 * Get agent todos.
 */
export function getWasmAgentTodos(agentId: string): unknown[] {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return entry.agent.get_todos();
}

/**
 * Export the full agent state as JSON (for persistence).
 */
export function exportWasmState(agentId: string): string {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return JSON.stringify({
    agentState: entry.agent.get_state(),
    tools: entry.agent.get_tools(),
    todos: entry.agent.get_todos(),
    info: entry.info,
  });
}

// ── MCP Server Bridge ────────────────────────────────────────

/**
 * Create a WASM-based MCP server for an agent.
 * Returns a handler function for JSON-RPC requests.
 *
 * Note: WasmMcpServer may have stability issues in v0.1.0 for
 * certain agent configurations. Use with a fully configured agent.
 */
export async function createWasmMcpServer(agentId: string): Promise<(jsonRpc: string) => Promise<string>> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);

  const mod = await import('@ruvector/rvagent-wasm');
  const server = new mod.WasmMcpServer(entry.agent);

  return (jsonRpc: string) => server.handle_request(jsonRpc);
}

// ── Gallery Templates ────────────────────────────────────────

let _gallery: any | null = null;

async function getGallery(): Promise<any> {
  if (_gallery) return _gallery;
  await initAgentWasm();
  const mod = await import('@ruvector/rvagent-wasm');
  _gallery = new mod.WasmGallery();
  return _gallery;
}

/**
 * List all available gallery templates.
 * Returns objects directly (Gallery.list() returns parsed objects in v0.1.0).
 */
export async function listGalleryTemplates(): Promise<GalleryTemplate[]> {
  const gallery = await getGallery();
  return gallery.list();
}

/**
 * Get gallery template count.
 */
export async function getGalleryCount(): Promise<number> {
  const gallery = await getGallery();
  return gallery.count();
}

/**
 * Get gallery categories with counts.
 */
export async function getGalleryCategories(): Promise<Record<string, number>> {
  const gallery = await getGallery();
  return gallery.getCategories();
}

/**
 * Search gallery templates by query. Returns results with relevance scores.
 */
export async function searchGalleryTemplates(query: string): Promise<Array<GalleryTemplate & { relevance: number }>> {
  const gallery = await getGallery();
  return gallery.search(query);
}

/**
 * Get a gallery template by id.
 * Wraps in try/catch because WasmGallery.get() panics on unknown IDs in v0.1.0.
 */
export async function getGalleryTemplate(id: string): Promise<GalleryTemplateDetail | null> {
  const gallery = await getGallery();
  try {
    return gallery.get(id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Create an agent from a gallery template.
 */
export async function createAgentFromTemplate(templateId: string): Promise<WasmAgentInfo> {
  const template = await getGalleryTemplate(templateId);
  if (!template) throw new Error(`Gallery template not found: ${templateId}`);

  const systemPrompt = template.prompts?.[0]?.system_prompt;
  return createWasmAgent({
    instructions: systemPrompt ?? `You are a ${template.name}.`,
    model: undefined, // Use default
  });
}

// ── RVF Container Operations ─────────────────────────────────

/**
 * Build an RVF container with prompts, tools, and skills.
 * Uses the high-level RVF builder API (addPrompt, addTool, addSkill).
 */
export async function buildRvfContainer(opts: {
  prompts?: Array<{ name: string; system_prompt: string; version: string }>;
  tools?: Array<{ name: string; description: string; parameters: unknown[]; returns: string }>;
  skills?: Array<{ name: string; description: string; trigger: string; content: string }>;
}): Promise<Uint8Array> {
  await initAgentWasm();
  const mod = await import('@ruvector/rvagent-wasm');
  const builder = new mod.WasmRvfBuilder();

  for (const p of opts.prompts ?? []) {
    builder.addPrompt(JSON.stringify(p));
  }
  for (const t of opts.tools ?? []) {
    builder.addTool(JSON.stringify(t));
  }
  for (const s of opts.skills ?? []) {
    builder.addSkill(JSON.stringify(s));
  }

  return builder.build();
}

/**
 * Build an RVF container from a gallery template.
 */
export async function buildRvfFromTemplate(templateId: string): Promise<Uint8Array> {
  const template = await getGalleryTemplate(templateId);
  if (!template) throw new Error(`Gallery template not found: ${templateId}`);

  return buildRvfContainer({
    prompts: template.prompts,
    tools: template.tools,
    skills: template.skills,
  });
}
