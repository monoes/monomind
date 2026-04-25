/**
 * Headless Test Harness
 *
 * Integrates with Claude Code headless mode (claude -p --output-format json)
 * to run automated evaluation suites against guidance rules.
 *
 * Usage:
 * 1. Define a task suite (list of tasks with expected behaviors)
 * 2. Run each task in headless mode
 * 3. Parse JSON output
 * 4. Evaluate against active rules
 * 5. Store results in the run ledger
 *
 * @module @monobrain/guidance/headless
 */
import type { RunEvent, TaskIntent, Violation, EvaluatorResult } from './types.js';
import type { RunLedger } from './ledger.js';
/**
 * A test task in the suite
 */
export interface TestTask {
    /** Unique task ID */
    id: string;
    /** Task description (the prompt to send) */
    prompt: string;
    /** Expected intent classification */
    expectedIntent: TaskIntent;
    /** Expected behavior assertions */
    assertions: TaskAssertion[];
    /** Maximum allowed violations */
    maxViolations: number;
    /** Timeout in ms */
    timeoutMs: number;
    /** Tags for filtering */
    tags: string[];
}
/**
 * An assertion about expected behavior
 */
export interface TaskAssertion {
    /** Assertion type */
    type: 'output-contains' | 'output-not-contains' | 'files-touched' | 'no-forbidden-commands' | 'tests-pass' | 'custom';
    /** Expected value or pattern */
    expected: string;
    /** Assertion description */
    description: string;
}
/**
 * Result of running a single test task
 */
export interface TaskRunResult {
    /** The task that was run */
    task: TestTask;
    /** Whether the run succeeded */
    success: boolean;
    /** Claude Code output (parsed JSON) */
    output: HeadlessOutput | null;
    /** Assertion results */
    assertionResults: Array<{
        assertion: TaskAssertion;
        passed: boolean;
        details: string;
    }>;
    /** Violations detected */
    violations: Violation[];
    /** Evaluator results */
    evaluatorResults: EvaluatorResult[];
    /** Run event logged to ledger */
    runEvent: RunEvent | null;
    /** Duration in ms */
    durationMs: number;
    /** Error if any */
    error?: string;
}
/**
 * Parsed output from Claude Code headless mode
 */
export interface HeadlessOutput {
    /** The response text */
    result: string;
    /** Tools that were used */
    toolsUsed: string[];
    /** Files that were modified */
    filesModified: string[];
    /** Whether any errors occurred */
    hasErrors: boolean;
    /** Session metadata */
    metadata: Record<string, unknown>;
}
/**
 * Suite run summary
 */
export interface SuiteRunSummary {
    /** Total tasks run */
    totalTasks: number;
    /** Tasks passed */
    tasksPassed: number;
    /** Tasks failed */
    tasksFailed: number;
    /** Total violations */
    totalViolations: number;
    /** Total assertions checked */
    totalAssertions: number;
    /** Assertions passed */
    assertionsPassed: number;
    /** Overall pass rate */
    passRate: number;
    /** Duration in ms */
    durationMs: number;
    /** Per-task results */
    results: TaskRunResult[];
}
/**
 * Command executor interface (injectable for testing)
 */
export interface ICommandExecutor {
    execute(command: string, timeoutMs: number): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
}
/**
 * Default command executor using child_process
 */
export declare class ProcessExecutor implements ICommandExecutor {
    execute(command: string, timeoutMs: number): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    /** Parse a buildCommand() result into [executable, ...args] without shell. */
    private parseCommand;
}
export declare class HeadlessRunner {
    private executor;
    private ledger;
    private guidanceHash;
    constructor(executor?: ICommandExecutor, ledger?: RunLedger, guidanceHash?: string);
    /**
     * Set the run ledger for logging
     */
    setLedger(ledger: RunLedger): void;
    /**
     * Run a single test task in headless mode
     */
    runTask(task: TestTask): Promise<TaskRunResult>;
    /**
     * Run an entire test suite
     */
    runSuite(tasks: TestTask[], tags?: string[]): Promise<SuiteRunSummary>;
    /**
     * Build the Claude Code headless command
     */
    private buildCommand;
    /**
     * Parse Claude Code JSON output
     */
    private parseOutput;
    /**
     * Check assertions against output
     */
    private checkAssertions;
    /**
     * Detect violations from task output
     */
    private detectViolations;
}
/**
 * Create a basic compliance test suite
 */
export declare function createComplianceSuite(): TestTask[];
/**
 * Create a headless runner instance
 */
export declare function createHeadlessRunner(executor?: ICommandExecutor, ledger?: RunLedger, guidanceHash?: string): HeadlessRunner;
//# sourceMappingURL=headless.d.ts.map