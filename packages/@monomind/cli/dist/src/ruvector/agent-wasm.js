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
 * @module @monomind/cli/ruvector/agent-wasm
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// ── WASM Module Detection & Init ─────────────────────────────
let _wasmReady = false;
/**
 * Check if @ruvector/rvagent-wasm is installed and loadable.
 */
export async function isAgentWasmAvailable() {
    try {
        const mod = await import('@ruvector/rvagent-wasm');
        return typeof mod.WasmAgent === 'function';
    }
    catch {
        return false;
    }
}
/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with file-loaded WASM bytes (browser fetch doesn't work in Node).
 */
export async function initAgentWasm() {
    if (_wasmReady)
        return;
    try {
        const mod = await import('@ruvector/rvagent-wasm');
        // In Node.js, load WASM bytes from disk and use initSync
        const require_ = createRequire(import.meta.url);
        const wasmPath = require_.resolve('@ruvector/rvagent-wasm/rvagent_wasm_bg.wasm');
        const wasmBytes = readFileSync(wasmPath);
        mod.initSync({ module: wasmBytes });
        _wasmReady = true;
    }
    catch (err) {
        throw new Error(`Failed to initialize @ruvector/rvagent-wasm: ${err}`);
    }
}
// ── Agent Registry ───────────────────────────────────────────
const agents = new Map();
let nextId = 1;
function generateId() {
    return `wasm-agent-${nextId++}-${Date.now().toString(36)}`;
}
// ── Agent Lifecycle ──────────────────────────────────────────
/**
 * Create a new sandboxed WASM agent.
 */
export async function createWasmAgent(config = {}) {
    await initAgentWasm();
    const mod = await import('@ruvector/rvagent-wasm');
    const configJson = JSON.stringify({
        model: config.model ?? 'anthropic:claude-sonnet-4-20250514',
        instructions: config.instructions ?? 'You are a helpful coding assistant.',
        max_turns: config.maxTurns ?? 50,
    });
    const agent = new mod.WasmAgent(configJson);
    const id = generateId();
    const info = {
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
export async function promptWasmAgent(agentId, input) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
    entry.info.state = 'running';
    try {
        const result = await entry.agent.prompt(input);
        entry.info.state = 'idle';
        syncAgentInfo(entry);
        return result;
    }
    catch (err) {
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
export async function executeWasmTool(agentId, toolCall) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
    // Validate tool name to prevent WASM panics on unknown tools
    const toolName = toolCall.tool;
    if (toolName && !VALID_WASM_TOOLS.includes(toolName)) {
        return { success: false, output: `Unknown tool: ${toolName}. Available: ${VALID_WASM_TOOLS.join(', ')}` };
    }
    const result = await entry.agent.execute_tool(JSON.stringify(toolCall));
    syncAgentInfo(entry);
    return result;
}
function syncAgentInfo(entry) {
    try {
        entry.info.turnCount = entry.agent.turn_count();
        entry.info.fileCount = entry.agent.file_count();
        entry.info.isStopped = entry.agent.is_stopped();
    }
    catch { /* best-effort */ }
}
/**
 * Get agent info.
 */
export function getWasmAgent(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        return null;
    syncAgentInfo(entry);
    return entry.info;
}
/**
 * List all active WASM agents.
 */
export function listWasmAgents() {
    return Array.from(agents.values()).map(e => {
        syncAgentInfo(e);
        return e.info;
    });
}
/**
 * Terminate a WASM agent and free resources.
 */
export function terminateWasmAgent(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        return false;
    try {
        entry.agent.free();
    }
    catch { /* already freed */ }
    agents.delete(agentId);
    return true;
}
/**
 * Get agent state (messages, turn count, etc.)
 */
export function getWasmAgentState(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
    return entry.agent.get_state();
}
/**
 * Get agent tools list.
 */
export function getWasmAgentTools(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
    return entry.agent.get_tools();
}
/**
 * Get agent todos.
 */
export function getWasmAgentTodos(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
    return entry.agent.get_todos();
}
/**
 * Export the full agent state as JSON (for persistence).
 */
export function exportWasmState(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
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
export async function createWasmMcpServer(agentId) {
    const entry = agents.get(agentId);
    if (!entry)
        throw new Error(`WASM agent not found: ${agentId}`);
    const mod = await import('@ruvector/rvagent-wasm');
    const server = new mod.WasmMcpServer(entry.agent);
    return (jsonRpc) => server.handle_request(jsonRpc);
}
// ── Gallery Templates ────────────────────────────────────────
let _gallery = null;
async function getGallery() {
    if (_gallery)
        return _gallery;
    await initAgentWasm();
    const mod = await import('@ruvector/rvagent-wasm');
    _gallery = new mod.WasmGallery();
    return _gallery;
}
/**
 * List all available gallery templates.
 * Returns objects directly (Gallery.list() returns parsed objects in v0.1.0).
 */
export async function listGalleryTemplates() {
    const gallery = await getGallery();
    return gallery.list();
}
/**
 * Get gallery template count.
 */
export async function getGalleryCount() {
    const gallery = await getGallery();
    return gallery.count();
}
/**
 * Get gallery categories with counts.
 */
export async function getGalleryCategories() {
    const gallery = await getGallery();
    return gallery.getCategories();
}
/**
 * Search gallery templates by query. Returns results with relevance scores.
 */
export async function searchGalleryTemplates(query) {
    const gallery = await getGallery();
    return gallery.search(query);
}
/**
 * Get a gallery template by id.
 * Wraps in try/catch because WasmGallery.get() panics on unknown IDs in v0.1.0.
 */
export async function getGalleryTemplate(id) {
    const gallery = await getGallery();
    try {
        return gallery.get(id) ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Create an agent from a gallery template.
 */
export async function createAgentFromTemplate(templateId) {
    const template = await getGalleryTemplate(templateId);
    if (!template)
        throw new Error(`Gallery template not found: ${templateId}`);
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
export async function buildRvfContainer(opts) {
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
export async function buildRvfFromTemplate(templateId) {
    const template = await getGalleryTemplate(templateId);
    if (!template)
        throw new Error(`Gallery template not found: ${templateId}`);
    return buildRvfContainer({
        prompts: template.prompts,
        tools: template.tools,
        skills: template.skills,
    });
}
//# sourceMappingURL=agent-wasm.js.map