/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */
/**
 * Returns the effective project working directory.
 * Prefers MONOMIND_CWD (set by the install script for global/MCP installs
 * where process.cwd() may resolve to '/') over the real process.cwd().
 */
export function getProjectCwd() {
    return process.env.MONOMIND_CWD || process.cwd();
}
//# sourceMappingURL=types.js.map