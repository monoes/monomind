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
 * @module @monoes/cli/ruvector/agent-wasm
 */
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
    tools: Array<{
        name: string;
        description: string;
        parameters: unknown[];
        returns: string;
    }>;
    prompts: Array<{
        name: string;
        system_prompt: string;
        version: string;
    }>;
    skills: Array<{
        name: string;
        description: string;
        trigger: string;
        content: string;
    }>;
    mcp_tools: Array<{
        name: string;
        description: string;
        input_schema: unknown;
        group: string;
    }>;
    capabilities: Array<{
        name: string;
        rights: string[];
        scope: string;
        delegation_depth: number;
    }>;
}
export interface ToolResult {
    success: boolean;
    output: string;
}
/**
 * Check if @ruvector/rvagent-wasm is installed and loadable.
 */
export declare function isAgentWasmAvailable(): Promise<boolean>;
/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with file-loaded WASM bytes (browser fetch doesn't work in Node).
 */
export declare function initAgentWasm(): Promise<void>;
/**
 * Create a new sandboxed WASM agent.
 */
export declare function createWasmAgent(config?: WasmAgentConfig): Promise<WasmAgentInfo>;
/**
 * Send a prompt to a WASM agent. Requires a model provider to be set.
 */
export declare function promptWasmAgent(agentId: string, input: string): Promise<string>;
export declare function executeWasmTool(agentId: string, toolCall: Record<string, unknown>): Promise<ToolResult>;
/**
 * Get agent info.
 */
export declare function getWasmAgent(agentId: string): WasmAgentInfo | null;
/**
 * List all active WASM agents.
 */
export declare function listWasmAgents(): WasmAgentInfo[];
/**
 * Terminate a WASM agent and free resources.
 */
export declare function terminateWasmAgent(agentId: string): boolean;
/**
 * Get agent state (messages, turn count, etc.)
 */
export declare function getWasmAgentState(agentId: string): unknown;
/**
 * Get agent tools list.
 */
export declare function getWasmAgentTools(agentId: string): string[];
/**
 * Get agent todos.
 */
export declare function getWasmAgentTodos(agentId: string): unknown[];
/**
 * Export the full agent state as JSON (for persistence).
 */
export declare function exportWasmState(agentId: string): string;
/**
 * Create a WASM-based MCP server for an agent.
 * Returns a handler function for JSON-RPC requests.
 *
 * Note: WasmMcpServer may have stability issues in v0.1.0 for
 * certain agent configurations. Use with a fully configured agent.
 */
export declare function createWasmMcpServer(agentId: string): Promise<(jsonRpc: string) => Promise<string>>;
/**
 * List all available gallery templates.
 * Returns objects directly (Gallery.list() returns parsed objects in v0.1.0).
 */
export declare function listGalleryTemplates(): Promise<GalleryTemplate[]>;
/**
 * Get gallery template count.
 */
export declare function getGalleryCount(): Promise<number>;
/**
 * Get gallery categories with counts.
 */
export declare function getGalleryCategories(): Promise<Record<string, number>>;
/**
 * Search gallery templates by query. Returns results with relevance scores.
 */
export declare function searchGalleryTemplates(query: string): Promise<Array<GalleryTemplate & {
    relevance: number;
}>>;
/**
 * Get a gallery template by id.
 * Wraps in try/catch because WasmGallery.get() panics on unknown IDs in v0.1.0.
 */
export declare function getGalleryTemplate(id: string): Promise<GalleryTemplateDetail | null>;
/**
 * Create an agent from a gallery template.
 */
export declare function createAgentFromTemplate(templateId: string): Promise<WasmAgentInfo>;
/**
 * Build an RVF container with prompts, tools, and skills.
 * Uses the high-level RVF builder API (addPrompt, addTool, addSkill).
 */
export declare function buildRvfContainer(opts: {
    prompts?: Array<{
        name: string;
        system_prompt: string;
        version: string;
    }>;
    tools?: Array<{
        name: string;
        description: string;
        parameters: unknown[];
        returns: string;
    }>;
    skills?: Array<{
        name: string;
        description: string;
        trigger: string;
        content: string;
    }>;
}): Promise<Uint8Array>;
/**
 * Build an RVF container from a gallery template.
 */
export declare function buildRvfFromTemplate(templateId: string): Promise<Uint8Array>;
//# sourceMappingURL=agent-wasm.d.ts.map