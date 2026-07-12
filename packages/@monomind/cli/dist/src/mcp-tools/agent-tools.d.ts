/**
 * Agent MCP Tools for CLI
 *
 * Tool definitions for agent lifecycle management with file persistence.
 * Includes model routing integration for intelligent model selection.
 */
import { type MCPTool } from './types.js';
type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';
interface AgentRecord {
    agentId: string;
    agentType: string;
    status: 'idle' | 'busy' | 'terminated';
    health: number;
    taskCount: number;
    config: Record<string, unknown>;
    createdAt: string;
    domain?: string;
    model?: ClaudeModel;
    modelRoutedBy?: 'explicit' | 'router' | 'agent-booster' | 'default';
    lastResult?: Record<string, unknown>;
}
interface AgentStore {
    agents: Record<string, AgentRecord>;
    version: string;
}
export declare function loadAgentStore(): AgentStore;
export declare const agentTools: MCPTool[];
export {};
//# sourceMappingURL=agent-tools.d.ts.map