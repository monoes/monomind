/**
 * Run Ledger + Evaluators
 *
 * Logs every run as an event with a minimum schema, then runs evaluators
 * to assess compliance and quality.
 *
 * Objective evaluators:
 * 1. Tests pass
 * 2. Lint pass
 * 3. Forbidden dependency scan
 * 4. Forbidden command scan
 * 5. Required sections present in plan
 *
 * Subjective evaluators:
 * 1. Reviewer rating (pass/fail)
 * 2. Architecture compliance (pass/fail)
 *
 * @module @monobrain/guidance/ledger
 */
import type { RunEvent, EvaluatorResult, TaskIntent, OptimizationMetrics, ViolationRanking } from './types.js';
export interface IEvaluator {
    /** Evaluator name */
    name: string;
    /** Whether this is objective (automated) or subjective (human) */
    type: 'objective' | 'subjective';
    /** Run the evaluation */
    evaluate(event: RunEvent): Promise<EvaluatorResult>;
}
/**
 * Tests Pass evaluator - checks test results
 */
export declare class TestsPassEvaluator implements IEvaluator {
    name: string;
    type: "objective";
    evaluate(event: RunEvent): Promise<EvaluatorResult>;
}
/**
 * Forbidden command scan evaluator
 */
export declare class ForbiddenCommandEvaluator implements IEvaluator {
    name: string;
    type: "objective";
    private forbiddenPatterns;
    constructor(forbiddenPatterns?: RegExp[]);
    evaluate(event: RunEvent): Promise<EvaluatorResult>;
}
/**
 * Forbidden dependency scan evaluator
 */
export declare class ForbiddenDependencyEvaluator implements IEvaluator {
    name: string;
    type: "objective";
    private forbiddenPackages;
    constructor(forbiddenPackages?: string[]);
    evaluate(event: RunEvent): Promise<EvaluatorResult>;
}
/**
 * Violation rate evaluator - checks violation count
 */
export declare class ViolationRateEvaluator implements IEvaluator {
    name: string;
    type: "objective";
    private maxViolations;
    constructor(maxViolations?: number);
    evaluate(event: RunEvent): Promise<EvaluatorResult>;
}
/**
 * Diff quality evaluator - checks rework ratio
 */
export declare class DiffQualityEvaluator implements IEvaluator {
    name: string;
    type: "objective";
    private maxReworkRatio;
    constructor(maxReworkRatio?: number);
    evaluate(event: RunEvent): Promise<EvaluatorResult>;
}
export declare class RunLedger {
    private events;
    private evaluators;
    private readonly maxEvents;
    /**
     * @param maxEvents - Maximum events to retain in memory (0 = unlimited).
     *   When the limit is exceeded the oldest events are evicted.
     */
    constructor(maxEvents?: number);
    /**
     * Add a custom evaluator
     */
    addEvaluator(evaluator: IEvaluator): void;
    /**
     * Remove an evaluator by name
     */
    removeEvaluator(name: string): void;
    /**
     * Log a run event
     */
    logEvent(event: RunEvent | Omit<RunEvent, 'eventId'>): RunEvent;
    /**
     * Create a new run event with defaults
     */
    createEvent(taskId: string, intent: TaskIntent, guidanceHash: string): RunEvent;
    /**
     * Finalize and store an event
     */
    finalizeEvent(event: RunEvent): RunEvent;
    /**
     * Evict oldest events when maxEvents is exceeded.
     * Trims 10% in a batch to amortize the O(n) splice cost.
     */
    private evictIfNeeded;
    /**
     * Run all evaluators against an event
     */
    evaluate(event: RunEvent): Promise<EvaluatorResult[]>;
    /**
     * Get all events
     */
    getEvents(): RunEvent[];
    /**
     * Get events by task ID
     */
    getEventsByTask(taskId: string): RunEvent[];
    /**
     * Get events within a time range
     */
    getEventsInRange(startMs: number, endMs: number): RunEvent[];
    /**
     * Get recent events
     */
    getRecentEvents(count: number): RunEvent[];
    /**
     * Compute optimization metrics from events
     */
    computeMetrics(events?: RunEvent[]): OptimizationMetrics;
    /**
     * Rank violations by frequency and cost (rework lines)
     */
    rankViolations(windowEvents?: RunEvent[]): ViolationRanking[];
    /**
     * Get event count
     */
    get eventCount(): number;
    /**
     * Export events for persistence
     */
    exportEvents(): RunEvent[];
    /**
     * Import events from persistence
     */
    importEvents(events: RunEvent[]): void;
    /**
     * Clear all events
     */
    clear(): void;
}
/**
 * Create a run ledger instance
 *
 * @param maxEvents - Maximum events to retain in memory (0 = unlimited).
 */
export declare function createLedger(maxEvents?: number): RunLedger;
//# sourceMappingURL=ledger.d.ts.map