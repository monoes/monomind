/**
 * MCP Configuration Generator
 * Creates .mcp.json for Claude Code MCP server integration
 * Handles cross-platform compatibility (Windows requires cmd /c wrapper)
 */
import type { InitOptions } from './types.js';
/**
 * Generate MCP configuration
 */
export declare function generateMCPConfig(options: InitOptions): object;
/**
 * Generate .mcp.json as formatted string
 */
export declare function generateMCPJson(options: InitOptions): string;
/**
 * Generate MCP server add commands for manual setup
 */
export declare function generateMCPCommands(options: InitOptions): string[];
/**
 * Get platform-specific setup instructions
 */
export declare function getPlatformInstructions(): {
    platform: string;
    note: string;
};
//# sourceMappingURL=mcp-generator.d.ts.map