/**
 * Safe Executor - HIGH-1 Remediation
 *
 * Fixes command injection vulnerabilities by:
 * - Using execFile instead of exec with shell
 * - Validating all command arguments
 * - Implementing command allowlist
 * - Sanitizing command inputs
 *
 * Security Properties:
 * - No shell interpretation
 * - Argument validation
 * - Command allowlist enforcement
 * - Timeout controls
 * - Resource limits
 *
 * @module v1/security/safe-executor
 */
import { ChildProcess } from 'child_process';
export interface ExecutorConfig {
    /**
     * Allowed commands (allowlist).
     * Only commands in this list can be executed.
     */
    allowedCommands: string[];
    /**
     * Blocked argument patterns (regex strings).
     * Arguments matching these patterns are rejected.
     */
    blockedPatterns?: string[];
    /**
     * Maximum execution timeout in milliseconds.
     * Default: 30000 (30 seconds)
     */
    timeout?: number;
    /**
     * Maximum buffer size for stdout/stderr.
     * Default: 10MB
     */
    maxBuffer?: number;
    /**
     * Working directory for command execution.
     * Default: process.cwd()
     */
    cwd?: string;
    /**
     * Environment variables to include.
     * Default: process.env
     */
    env?: NodeJS.ProcessEnv;
    /**
     * Whether to allow sudo commands.
     * Default: false
     */
    allowSudo?: boolean;
}
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    command: string;
    args: string[];
    duration: number;
}
export interface StreamingExecutor {
    process: ChildProcess;
    stdout: NodeJS.ReadableStream | null;
    stderr: NodeJS.ReadableStream | null;
    promise: Promise<ExecutionResult>;
}
export declare class SafeExecutorError extends Error {
    readonly code: string;
    readonly command?: string | undefined;
    readonly args?: string[] | undefined;
    constructor(message: string, code: string, command?: string | undefined, args?: string[] | undefined);
}
/**
 * Safe command executor that prevents command injection.
 *
 * This class replaces unsafe exec() and spawn({shell: true}) calls
 * with validated execFile() calls.
 *
 * @example
 * ```typescript
 * const executor = new SafeExecutor({
 *   allowedCommands: ['git', 'npm', 'node']
 * });
 *
 * const result = await executor.execute('git', ['status']);
 * ```
 */
export declare class SafeExecutor {
    private readonly config;
    private readonly blockedPatterns;
    constructor(config: ExecutorConfig);
    /**
     * Escapes special regex characters.
     */
    private escapeRegExp;
    /**
     * Validates executor configuration.
     */
    private validateConfig;
    /**
     * Validates a command against the allowlist.
     *
     * @param command - Command to validate
     * @throws SafeExecutorError if command is not allowed
     */
    private validateCommand;
    /**
     * Validates command arguments for injection patterns.
     *
     * @param args - Arguments to validate
     * @throws SafeExecutorError if arguments contain dangerous patterns
     */
    private validateArguments;
    /**
     * Sanitizes a single argument.
     *
     * @param arg - Argument to sanitize
     * @returns Sanitized argument
     */
    sanitizeArgument(arg: string): string;
    /**
     * Executes a command safely.
     *
     * @param command - Command to execute (must be in allowlist)
     * @param args - Command arguments
     * @returns Execution result
     * @throws SafeExecutorError on validation failure or execution error
     */
    execute(command: string, args?: string[]): Promise<ExecutionResult>;
    /**
     * Executes a command with streaming output.
     *
     * @param command - Command to execute
     * @param args - Command arguments
     * @returns Streaming executor with process handles
     */
    executeStreaming(command: string, args?: string[]): StreamingExecutor;
    /**
     * Adds a command to the allowlist at runtime.
     *
     * @param command - Command to add
     */
    allowCommand(command: string): void;
    /**
     * Checks if a command is allowed.
     *
     * @param command - Command to check
     * @returns True if command is allowed
     */
    isCommandAllowed(command: string): boolean;
    /**
     * Returns the current allowlist.
     */
    getAllowedCommands(): readonly string[];
}
/**
 * Factory function to create a safe executor for common development tasks.
 *
 * @returns Configured SafeExecutor for git, npm, and node
 */
export declare function createDevelopmentExecutor(): SafeExecutor;
/**
 * Factory function to create a read-only executor.
 * Only allows commands that read without modifying.
 *
 * @returns Configured SafeExecutor for read operations
 */
export declare function createReadOnlyExecutor(): SafeExecutor;
//# sourceMappingURL=safe-executor.d.ts.map