/** Cheap, cached check that the `claude` CLI is installed and on PATH. */
export declare function isClaudeCodeAvailable(): boolean;
export interface ClaudeLLMCallerOptions {
    /** Routing model alias passed to `claude --model` (default: "haiku"). */
    model?: 'haiku' | 'sonnet' | 'opus';
    /** Per-call timeout in milliseconds (default: 45s — see DEFAULT_TIMEOUT_MS). */
    timeoutMs?: number;
    /**
     * Working directory for the spawned process. Defaults to the OS temp dir so
     * the child does NOT inherit the host project's `.claude/` hooks (e.g.
     * monomind's own SessionStart graph build), which would add seconds of
     * unrelated startup work to every fallback classification.
     */
    cwd?: string;
}
/**
 * Build an `llmCaller` that delegates a classification prompt to a headless
 * Claude Code agent (`claude --print --model <model> -- <prompt>`).
 *
 * Returns `null` when the `claude` CLI is not available, so callers can omit
 * `llmFallback` entirely and let routing run keyword + semantic only.
 */
export declare function createClaudeLLMCaller(options?: ClaudeLLMCallerOptions): ((prompt: string) => Promise<string>) | null;
//# sourceMappingURL=llm-caller.d.ts.map