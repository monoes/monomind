/**
 * MCP Configuration Generator
 * Creates .mcp.json for Claude Code MCP server integration
 * Handles cross-platform compatibility (Windows requires cmd /c wrapper)
 */
/**
 * Check if running on Windows
 */
function isWindows() {
    return process.platform === 'win32';
}
/**
 * Generate platform-specific MCP server entry
 * - Windows: uses 'cmd /c npx' directly
 * - Unix: uses 'npx' directly (simple, reliable)
 */
function createMCPServerEntry(npxArgs, env, additionalProps = {}) {
    if (isWindows()) {
        return {
            command: 'cmd',
            args: ['/c', 'npx', '-y', ...npxArgs],
            env,
            ...additionalProps,
        };
    }
    // Unix: direct npx invocation — simple and reliable
    return {
        command: 'npx',
        args: ['-y', ...npxArgs],
        env,
        ...additionalProps,
    };
}
/**
 * Generate MCP configuration
 */
export function generateMCPConfig(options) {
    const config = options.mcp;
    const mcpServers = {};
    const npmEnv = {
        npm_config_update_notifier: 'false',
    };
    // Monomind MCP server (core)
    if (config.monomind) {
        mcpServers['monomind'] = createMCPServerEntry(['monomind@latest', 'mcp', 'start'], {
            ...npmEnv,
            MONOMIND_MODE: 'v1',
            MONOMIND_HOOKS_ENABLED: 'true',
            MONOMIND_TOPOLOGY: options.runtime.topology,
            MONOMIND_MAX_AGENTS: String(options.runtime.maxAgents),
            MONOMIND_MEMORY_BACKEND: options.runtime.memoryBackend,
        }, { autoStart: config.autoStart });
    }
    // Graphify knowledge graph — built into monomind MCP server since v1.3.0.
    // Available as mcp__monomind__graphify_build, graphify_report, graphify_suggest, graphify_health.
    // No separate server needed — the monomind entry above provides all graphify tools.
    return { mcpServers };
}
/**
 * Generate .mcp.json as formatted string
 */
export function generateMCPJson(options) {
    const config = generateMCPConfig(options);
    return JSON.stringify(config, null, 2);
}
/**
 * Generate MCP server add commands for manual setup
 */
export function generateMCPCommands(options) {
    const commands = [];
    const config = options.mcp;
    if (isWindows()) {
        if (config.monomind) {
            commands.push('claude mcp add monomind -- cmd /c npx -y monomind@latest mcp start');
        }
    }
    else {
        if (config.monomind) {
            commands.push("claude mcp add monomind -- npx -y monomind@latest mcp start");
        }
    }
    return commands;
}
/**
 * Get platform-specific setup instructions
 */
export function getPlatformInstructions() {
    if (isWindows()) {
        return {
            platform: 'Windows',
            note: 'MCP configuration uses cmd /c wrapper for npx compatibility.',
        };
    }
    return {
        platform: process.platform === 'darwin' ? 'macOS' : 'Linux',
        note: 'MCP configuration uses npx directly.',
    };
}
//# sourceMappingURL=mcp-generator.js.map