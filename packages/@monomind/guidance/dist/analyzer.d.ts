/**
 * CLAUDE.md Analyzer & Auto-Optimizer
 *
 * Quantifiable, verifiable analysis of CLAUDE.md files.
 * Measures structure quality, coverage, enforceability, and produces
 * a numeric score (0-100) that can be tracked over time.
 *
 * The auto-optimizer takes analysis results and produces a concrete
 * list of changes that would improve the score. Changes can be applied
 * programmatically and the score re-measured to verify improvement.
 *
 * @module @monobrain/guidance/analyzer
 */
import type { ProofEnvelope } from './proof.js';
/** Score breakdown for a single dimension (0-100 each) */
export interface DimensionScore {
    /** Dimension name */
    name: string;
    /** Score 0-100 */
    score: number;
    /** Maximum possible score */
    max: number;
    /** Weight in composite calculation */
    weight: number;
    /** Human-readable findings */
    findings: string[];
}
/** Complete analysis result */
export interface AnalysisResult {
    /** Composite score 0-100 */
    compositeScore: number;
    /** Letter grade A-F */
    grade: string;
    /** Per-dimension scores */
    dimensions: DimensionScore[];
    /** Structural metrics */
    metrics: AnalysisMetrics;
    /** Actionable improvement suggestions */
    suggestions: Suggestion[];
    /** Timestamp */
    analyzedAt: number;
}
/** Raw metrics extracted from the file */
export interface AnalysisMetrics {
    /** Total lines */
    totalLines: number;
    /** Non-blank, non-comment lines */
    contentLines: number;
    /** Number of markdown headings */
    headingCount: number;
    /** Number of H2 sections */
    sectionCount: number;
    /** Estimated constitution lines (first section block) */
    constitutionLines: number;
    /** Number of rule-like statements (imperative sentences) */
    ruleCount: number;
    /** Number of code blocks */
    codeBlockCount: number;
    /** Number of NEVER/ALWAYS/MUST statements */
    enforcementStatements: number;
    /** Number of framework/tool mentions */
    toolMentions: number;
    /** Estimated shard count after compilation */
    estimatedShards: number;
    /** Has build command */
    hasBuildCommand: boolean;
    /** Has test command */
    hasTestCommand: boolean;
    /** Has security section */
    hasSecuritySection: boolean;
    /** Has architecture section */
    hasArchitectureSection: boolean;
    /** Lines in longest section */
    longestSectionLines: number;
    /** Has @import directives */
    hasImports: boolean;
    /** Number of domain-specific rules */
    domainRuleCount: number;
}
/** A concrete improvement suggestion */
export interface Suggestion {
    /** What to change */
    action: 'add' | 'remove' | 'restructure' | 'split' | 'strengthen';
    /** Priority */
    priority: 'high' | 'medium' | 'low';
    /** Which dimension this improves */
    dimension: string;
    /** Human-readable description */
    description: string;
    /** Estimated score improvement */
    estimatedImprovement: number;
    /** Concrete text to add/modify (if applicable) */
    patch?: string;
}
/** Before/after benchmark result */
export interface BenchmarkResult {
    before: AnalysisResult;
    after: AnalysisResult;
    delta: number;
    improvements: DimensionDelta[];
    regressions: DimensionDelta[];
}
interface DimensionDelta {
    dimension: string;
    before: number;
    after: number;
    delta: number;
}
/** Context size preset for optimization */
export type ContextSize = 'compact' | 'standard' | 'full';
/** Configuration for size-aware optimization */
export interface OptimizeOptions {
    /** Target context size */
    contextSize?: ContextSize;
    /** Optional local overlay content */
    localContent?: string;
    /** Maximum optimization iterations */
    maxIterations?: number;
    /** Target score (stop when reached) */
    targetScore?: number;
    /** HMAC key for proof chain (enables cryptographic proof of optimization) */
    proofKey?: string;
}
/** Result of headless benchmark via claude -p */
export interface HeadlessBenchmarkResult {
    /** Before optimization metrics */
    before: {
        analysis: AnalysisResult;
        suitePassRate: number;
        violationCount: number;
        taskResults: HeadlessTaskResult[];
    };
    /** After optimization metrics */
    after: {
        analysis: AnalysisResult;
        suitePassRate: number;
        violationCount: number;
        taskResults: HeadlessTaskResult[];
    };
    /** Score delta */
    delta: number;
    /** Proof chain with cryptographic verification */
    proofChain: ProofEnvelope[];
    /** Formatted report */
    report: string;
}
/** Result of a single headless task run */
export interface HeadlessTaskResult {
    taskId: string;
    prompt: string;
    passed: boolean;
    violations: string[];
    durationMs: number;
}
/**
 * Analyze a CLAUDE.md file and produce quantifiable scores.
 *
 * Scores 6 dimensions (0-100 each), weighted into a composite:
 * - Structure (20%): headings, sections, length, organization
 * - Coverage (20%): build/test/security/architecture/domain
 * - Enforceability (25%): NEVER/ALWAYS statements, concrete rules
 * - Compilability (15%): how well it compiles to constitution + shards
 * - Clarity (10%): code blocks, examples, specificity
 * - Completeness (10%): missing common sections
 */
export declare function analyze(content: string, localContent?: string): AnalysisResult;
/**
 * Run a before/after benchmark.
 * Returns the delta and per-dimension changes.
 */
export declare function benchmark(before: string, after: string, localContent?: string): BenchmarkResult;
/**
 * Auto-optimize a CLAUDE.md file by applying high-priority suggestions.
 * Returns the optimized content and the benchmark result.
 */
export declare function autoOptimize(content: string, localContent?: string, maxIterations?: number): {
    optimized: string;
    benchmark: BenchmarkResult;
    appliedSuggestions: Suggestion[];
};
/**
 * Context-size-aware optimization that restructures content to reach 90%+.
 *
 * Unlike autoOptimize (which only appends), this function:
 * 1. Splits oversized sections into subsections
 * 2. Extracts enforcement prose into list-format rules
 * 3. Trims the constitution to budget
 * 4. Removes redundant content
 * 5. Adds missing coverage sections
 * 6. Applies iterative patch suggestions
 *
 * @param content - CLAUDE.md content
 * @param options - Optimization options with contextSize and targetScore
 * @returns Optimized content, benchmark, and proof chain
 */
export declare function optimizeForSize(content: string, options?: OptimizeOptions): {
    optimized: string;
    benchmark: BenchmarkResult;
    appliedSteps: string[];
    proof: ProofEnvelope[];
};
/**
 * Run a headless benchmark using `claude -p` to measure actual agent
 * compliance before and after optimization.
 *
 * Requires `claude` CLI to be installed. Uses the proof chain to create
 * tamper-evident records of each test run.
 *
 * @param originalContent - Original CLAUDE.md
 * @param optimizedContent - Optimized CLAUDE.md
 * @param options - Options including proof key and executor
 */
export declare function headlessBenchmark(originalContent: string, optimizedContent: string, options?: {
    proofKey?: string;
    executor?: IHeadlessExecutor;
    tasks?: HeadlessBenchmarkTask[];
    workDir?: string;
}): Promise<HeadlessBenchmarkResult>;
/** Executor interface for headless claude commands */
export interface IHeadlessExecutor {
    execute(prompt: string, workDir: string): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
}
/**
 * Content-aware executor that adapts behavior based on CLAUDE.md content.
 *
 * When `validateEffect()` detects this interface, it calls `setContext()`
 * before each phase (before/after) so the executor can vary its responses
 * based on the quality of the loaded CLAUDE.md. This is the key mechanism
 * that makes the empirical validation meaningful — without it, the same
 * executor produces identical adherence for both phases.
 */
export interface IContentAwareExecutor extends IHeadlessExecutor {
    /** Set the CLAUDE.md content that the executor should use as behavioral context */
    setContext(claudeMdContent: string): void;
}
/** Benchmark task definition */
interface HeadlessBenchmarkTask {
    id: string;
    prompt: string;
    expectForbidden: string[];
    expectPresent: string[];
}
/**
 * Format analysis result as a human-readable report.
 */
export declare function formatReport(result: AnalysisResult): string;
/**
 * Format benchmark result as a comparison table.
 */
export declare function formatBenchmark(result: BenchmarkResult): string;
/**
 * An assertion about expected agent behavior.
 */
export interface ValidationAssertion {
    /** What to check */
    type: 'must-contain' | 'must-not-contain' | 'must-match-pattern' | 'must-mention-tool';
    /** The value to check (string literal or regex pattern for must-match-pattern) */
    value: string;
    /** How bad is a failure? */
    severity: 'critical' | 'major' | 'minor';
}
/**
 * A compliance task that tests whether the agent adheres to a specific
 * dimension's expected behavior.
 */
export interface ValidationTask {
    /** Unique task identifier */
    id: string;
    /** Which scoring dimension this task validates */
    dimension: string;
    /** The prompt to send to the agent */
    prompt: string;
    /** Assertions about the agent's output */
    assertions: ValidationAssertion[];
    /** Importance weight within its dimension (0-1) */
    weight: number;
}
/**
 * Result of running a single validation task.
 */
export interface ValidationTaskResult {
    taskId: string;
    dimension: string;
    passed: boolean;
    assertionResults: {
        assertion: ValidationAssertion;
        passed: boolean;
        detail: string;
    }[];
    output: string;
    durationMs: number;
}
/**
 * A single validation run against one CLAUDE.md version.
 */
export interface ValidationRun {
    /** Analysis of the CLAUDE.md used */
    analysis: AnalysisResult;
    /** Per-task results */
    taskResults: ValidationTaskResult[];
    /** Overall adherence rate (0-1) — weighted by severity */
    adherenceRate: number;
    /** Per-dimension adherence rates */
    dimensionAdherence: Record<string, number>;
    /** Timestamp */
    timestamp: number;
}
/**
 * Statistical correlation between score changes and behavioral changes.
 */
export interface CorrelationResult {
    /** Per-dimension score vs adherence comparison */
    dimensionCorrelations: {
        dimension: string;
        scoreBefore: number;
        scoreAfter: number;
        scoreDelta: number;
        adherenceBefore: number;
        adherenceAfter: number;
        adherenceDelta: number;
        /** Did score and adherence move in the same direction? */
        concordant: boolean;
    }[];
    /** Pearson correlation coefficient (-1 to 1) */
    pearsonR: number;
    /** Spearman rank correlation coefficient (-1 to 1) — more robust for small samples */
    spearmanRho: number;
    /** Cohen's d effect size (null if insufficient data) */
    cohensD: number | null;
    /** Human-readable effect size label */
    effectSizeLabel: string;
    /** Number of data points */
    n: number;
    /** Is the correlation statistically significant? (|r| > threshold for n) */
    significant: boolean;
    /** Overall verdict */
    verdict: 'positive-effect' | 'negative-effect' | 'no-effect' | 'inconclusive';
}
/**
 * Complete validation report proving (or disproving) that score improvements
 * lead to behavioral improvements.
 */
export interface ValidationReport {
    /** Run against original CLAUDE.md */
    before: ValidationRun;
    /** Run against optimized CLAUDE.md */
    after: ValidationRun;
    /** Statistical correlation analysis */
    correlation: CorrelationResult;
    /** Cryptographic proof chain */
    proofChain: ProofEnvelope[];
    /** Formatted human-readable report */
    report: string;
}
/**
 * Empirically validate that score improvements produce behavioral improvements.
 *
 * Runs a suite of compliance tasks against both the original and optimized
 * CLAUDE.md, then computes statistical correlations between per-dimension
 * score deltas and per-dimension adherence rate deltas.
 *
 * **Content-aware executors**: If the executor implements `IContentAwareExecutor`,
 * `setContext()` is called before each phase with the corresponding CLAUDE.md
 * content. This is the key mechanism that allows the executor to vary its
 * behavior based on the quality of the loaded guidance — without it, the same
 * executor produces identical adherence for both phases.
 *
 * The result includes:
 * - Per-dimension concordance (did score and adherence move together?)
 * - Pearson r and Spearman rho correlation coefficients
 * - Cohen's d effect size with interpretation
 * - A verdict: positive-effect, negative-effect, no-effect, or inconclusive
 * - A formatted report with full task breakdown
 * - Optional proof chain for tamper-evident audit trail
 *
 * @param originalContent - Original CLAUDE.md content
 * @param optimizedContent - Optimized CLAUDE.md content
 * @param options - Executor, tasks, proof key, work directory, trials
 * @returns ValidationReport with statistical evidence
 */
export declare function validateEffect(originalContent: string, optimizedContent: string, options?: {
    executor?: IHeadlessExecutor;
    tasks?: ValidationTask[];
    proofKey?: string;
    workDir?: string;
    /** Number of trials per phase (default 1). Higher values average out noise. */
    trials?: number;
}): Promise<ValidationReport>;
/** Task class categories for the A/B benchmark */
export type ABTaskClass = 'bug-fix' | 'feature' | 'refactor' | 'security' | 'deployment' | 'test' | 'performance';
/** A single benchmark task representing a real Monobrain scenario */
export interface ABTask {
    /** Unique task identifier */
    id: string;
    /** Human-readable description */
    description: string;
    /** Task class for grouping results */
    taskClass: ABTaskClass;
    /** Prompt sent to the executor */
    prompt: string;
    /** Assertions to evaluate pass/fail */
    assertions: ValidationAssertion[];
    /** Violation patterns to detect via gate simulation */
    gatePatterns: ABGatePattern[];
}
/** A pattern the gate simulator checks for in executor output */
export interface ABGatePattern {
    /** What kind of violation this detects */
    category: 'destructive-command' | 'hardcoded-secret' | 'force-push' | 'unsafe-type' | 'skipped-hook' | 'missing-test' | 'policy-violation';
    /** Regex pattern to match in output */
    pattern: string;
    /** Severity of the violation */
    severity: 'critical' | 'major' | 'minor';
}
/** Result for a single task in either config A or config B */
export interface ABTaskResult {
    /** Task ID */
    taskId: string;
    /** Task class */
    taskClass: ABTaskClass;
    /** Did all assertions pass? */
    passed: boolean;
    /** Assertion evaluation details */
    assertionResults: {
        assertion: ValidationAssertion;
        passed: boolean;
        detail: string;
    }[];
    /** Gate violations detected */
    violations: {
        category: string;
        pattern: string;
        severity: string;
    }[];
    /** Would a human need to intervene? (any critical violation) */
    humanIntervention: boolean;
    /** Simulated tool call count (extracted from output) */
    toolCalls: number;
    /** Simulated token spend (estimated from output length) */
    tokenSpend: number;
    /** Raw executor output */
    output: string;
    /** Execution duration in ms */
    durationMs: number;
}
/** Aggregated KPIs for one config (A or B) */
export interface ABMetrics {
    /** Fraction of tasks that passed (0-1) */
    successRate: number;
    /** Total wall clock time in ms */
    wallClockMs: number;
    /** Average tool calls per task */
    avgToolCalls: number;
    /** Average token spend per task */
    avgTokenSpend: number;
    /** Total gate violations */
    totalViolations: number;
    /** Tasks requiring human intervention */
    humanInterventions: number;
    /** Per-task-class success rates */
    classSuccessRates: Record<ABTaskClass, number>;
    /** Composite score: success_rate - 0.1*norm_cost - 0.2*violations - 0.1*interventions */
    compositeScore: number;
}
/** Complete A/B benchmark report */
export interface ABReport {
    /** Config A results (no control plane) */
    configA: {
        label: string;
        taskResults: ABTaskResult[];
        metrics: ABMetrics;
    };
    /** Config B results (with Phase 1 control plane) */
    configB: {
        label: string;
        taskResults: ABTaskResult[];
        metrics: ABMetrics;
    };
    /** Composite score delta (B - A) */
    compositeDelta: number;
    /** Per-task-class deltas */
    classDeltas: Record<ABTaskClass, number>;
    /** Does B beat A by ≥0.2 on composite across ≥3 task classes? */
    categoryShift: boolean;
    /** Proof chain envelopes */
    proofChain: ProofEnvelope[];
    /** Formatted human-readable report */
    report: string;
}
/**
 * Run an A/B benchmark comparing agent performance with and without
 * the Guidance Control Plane.
 *
 * **Config A** (baseline): No guidance — executor runs without setContext()
 * **Config B** (treatment): With guidance — executor gets setContext(claudeMd) +
 *   gate simulation on every output
 *
 * The 20 tasks span 7 task classes drawn from real Monobrain repo history:
 * bug-fix (3), feature (5), refactor (3), security (3), deployment (2),
 * test (2), performance (2).
 *
 * KPIs tracked per task:
 * - success rate, tool calls, token spend, violations, human interventions
 *
 * Composite score: `success_rate - 0.1*norm_cost - 0.2*violations - 0.1*interventions`
 *
 * **Success criterion**: B beats A by ≥0.2 on composite across ≥3 task classes
 * = "category shift"
 *
 * @param claudeMdContent - The CLAUDE.md content used for Config B
 * @param options - Executor, tasks, proof key, work directory
 * @returns ABReport with full per-task and per-class breakdown
 */
export declare function abBenchmark(claudeMdContent: string, options?: {
    executor?: IHeadlessExecutor;
    tasks?: ABTask[];
    proofKey?: string;
    workDir?: string;
}): Promise<ABReport>;
/**
 * Get the default 20 A/B benchmark tasks.
 * Exported for test customization and documentation.
 */
export declare function getDefaultABTasks(): ABTask[];
export {};
//# sourceMappingURL=analyzer.d.ts.map