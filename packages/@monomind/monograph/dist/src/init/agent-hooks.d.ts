export type AgentHooksTarget = 'claude-code' | 'codex' | 'auto';
export interface SetupHooksOptions {
    root: string;
    target?: AgentHooksTarget;
    command?: string;
    uninstall?: boolean;
}
export interface SetupHooksResult {
    target: AgentHooksTarget;
    installed: boolean;
    modifiedFiles: string[];
    message: string;
}
export declare const AGENTS_BLOCK_START = "<!-- monograph-gate-start -->";
export declare const AGENTS_BLOCK_END = "<!-- monograph-gate-end -->";
export declare const MONOGRAPH_GATE_SCRIPT = "npx monograph check --since $(git merge-base HEAD main)";
/** Build the AGENTS.md block content. */
export declare function buildAgentsMdBlock(command: string): string;
/** Merge the monograph gate block into AGENTS.md content (idempotent). */
export declare function mergeAgentsMdBlock(existing: string, block: string): string;
/** Remove the managed block from AGENTS.md. */
export declare function removeAgentsMdBlock(content: string): string;
/** Build a Claude Code settings.json PreToolUse hook entry. */
export declare function buildClaudeCodeHookEntry(command: string): Record<string, unknown>;
/** Merge a hook entry into an existing Claude Code settings object (idempotent). */
export declare function mergeClaudeCodeSettings(existing: Record<string, unknown>, entry: Record<string, unknown>): Record<string, unknown>;
export declare const DEFAULT_SETUP_RESULT: SetupHooksResult;
//# sourceMappingURL=agent-hooks.d.ts.map