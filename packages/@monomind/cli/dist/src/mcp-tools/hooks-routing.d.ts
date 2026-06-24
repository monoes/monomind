/**
 * Hooks Routing MCP Tools
 * MCP tool implementations for pre/post edit/command, route, explain, pretrain,
 * build-agents, transfer, session, list, metrics, pre-task, post-task, intelligence.
 * Extracted from hooks-tools.ts.
 */
import { type MCPTool } from './types.js';
export declare const hooksPreEdit: MCPTool;
export declare const hooksPostEdit: MCPTool;
export declare const hooksPreCommand: MCPTool;
export declare const hooksPostCommand: MCPTool;
export declare const hooksRoute: MCPTool;
export declare const hooksMetrics: MCPTool;
export declare const hooksList: MCPTool;
export declare const hooksPreTask: MCPTool;
export declare const hooksPostTask: MCPTool;
export declare const hooksExplain: MCPTool;
export declare const hooksPretrain: MCPTool;
export declare const hooksBuildAgents: MCPTool;
export declare const hooksTransfer: MCPTool;
export declare const hooksSessionStart: MCPTool;
export declare const hooksSessionEnd: MCPTool;
export declare const hooksSessionRestore: MCPTool;
export declare const hooksNotify: MCPTool;
export declare const hooksInit: MCPTool;
export declare const hooksIntelligence: MCPTool;
//# sourceMappingURL=hooks-routing.d.ts.map