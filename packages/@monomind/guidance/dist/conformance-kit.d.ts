/**
 * Agent Cell Conformance Kit
 *
 * Canonical acceptance test proving the entire guidance control plane works
 * end-to-end. Implements the "Memory Clerk" agent cell pattern:
 *
 * 1. Read 20 memory entries (knowledge retrieval)
 * 2. Run 1 model inference (reasoning)
 * 3. Propose 5 memory writes based on inference
 * 4. Inject a coherence drop at write #3
 * 5. Verify the system switches to read-only and blocks remaining writes
 * 6. Emit a signed proof envelope
 * 7. Return a complete, replayable trace
 *
 * @module @monobrain/guidance/conformance-kit
 */
import { MemoryWriteGate } from './memory-gate.js';
import type { MemoryAuthority } from './memory-gate.js';
import { ProofChain } from './proof.js';
import type { MemoryOperation } from './proof.js';
import { RunLedger } from './ledger.js';
import { CoherenceScheduler, EconomicGovernor } from './coherence.js';
import { DeterministicToolGateway } from './gateway.js';
/**
 * A single event in the agent cell execution trace.
 */
export interface TraceEvent {
    /** Monotonically increasing sequence number starting at 0 */
    seq: number;
    /** Epoch-ms timestamp when the event was recorded */
    ts: number;
    /** Event classification */
    type: 'memory_read' | 'memory_write_proposed' | 'memory_write_committed' | 'memory_write_blocked' | 'model_infer' | 'tool_invoke' | 'coherence_check' | 'privilege_change' | 'run_start' | 'run_end';
    /** Arbitrary structured data describing the event */
    payload: Record<string, unknown>;
    /** Human-readable decision string for replay verification */
    decision: string;
    /** Snapshot of budget counters at event time */
    budgetSnapshot: Record<string, number>;
}
/**
 * Complete result of an agent cell run including the full trace,
 * memory operation counts, proof hash, and budget usage.
 */
export interface CellRunResult {
    cellId: string;
    runId: string;
    traceEvents: TraceEvent[];
    memoryReads: number;
    memoryWritesAttempted: number;
    memoryWritesCommitted: number;
    memoryWritesBlocked: number;
    proofEnvelopeHash: string;
    coherenceHistory: number[];
    budgetUsage: Record<string, number>;
    outcome: 'completed' | 'restricted' | 'suspended';
}
/**
 * Runtime services provided to an agent cell.
 */
export interface CellRuntime {
    readMemory(key: string, namespace: string): unknown;
    writeMemory(key: string, namespace: string, value: unknown, evidence?: Record<string, unknown>): {
        allowed: boolean;
        reason: string;
    };
    invokeModel(prompt: string): string;
    invokeTool(name: string, params: Record<string, unknown>): {
        result: unknown;
        allowed: boolean;
    };
    getCoherenceScore(): number;
    setCoherenceScore(score: number): void;
    getProofChain(): ProofChain;
    getLedger(): RunLedger;
}
/**
 * An agent cell is a self-contained unit of work that executes against
 * a CellRuntime, producing a fully traced CellRunResult.
 */
export interface AgentCell {
    cellId: string;
    name: string;
    run(runtime: CellRuntime): CellRunResult;
}
export interface SimulatedRuntimeConfig {
    memoryGate: MemoryWriteGate;
    proofChain: ProofChain;
    ledger: RunLedger;
    coherenceScheduler: CoherenceScheduler;
    economicGovernor: EconomicGovernor;
    toolGateway?: DeterministicToolGateway;
    authority: MemoryAuthority;
    initialCoherenceScore?: number;
    initialMemory?: Map<string, {
        namespace: string;
        value: unknown;
    }>;
}
/**
 * A test runtime that wires together all guidance control plane components
 * and records every operation as a TraceEvent.
 */
export declare class SimulatedRuntime implements CellRuntime {
    private readonly memoryGate;
    private readonly proofChain;
    private readonly ledger;
    private readonly coherenceScheduler;
    private readonly economicGovernor;
    private readonly toolGateway;
    private readonly authority;
    private coherenceScore;
    private readonly memoryStore;
    private readonly memoryEntries;
    private readonly traceEvents;
    private readonly coherenceHistory;
    private seq;
    private memoryReadCount;
    private memoryWritesAttemptedCount;
    private memoryWritesCommittedCount;
    private memoryWritesBlockedCount;
    private readonly memoryOps;
    constructor(config: SimulatedRuntimeConfig);
    readMemory(key: string, namespace: string): unknown;
    writeMemory(key: string, namespace: string, value: unknown, evidence?: Record<string, unknown>): {
        allowed: boolean;
        reason: string;
    };
    invokeModel(prompt: string): string;
    invokeTool(name: string, params: Record<string, unknown>): {
        result: unknown;
        allowed: boolean;
    };
    getCoherenceScore(): number;
    setCoherenceScore(score: number): void;
    getProofChain(): ProofChain;
    getLedger(): RunLedger;
    /**
     * Emit a custom trace event. Exposed so agent cells can record
     * lifecycle events (run_start, run_end) through the same trace stream.
     */
    emitCustomTrace(type: TraceEvent['type'], payload: Record<string, unknown>, decision: string): void;
    getTraceEvents(): TraceEvent[];
    getCoherenceHistory(): number[];
    getMemoryReads(): number;
    getMemoryWritesAttempted(): number;
    getMemoryWritesCommitted(): number;
    getMemoryWritesBlocked(): number;
    getMemoryOps(): MemoryOperation[];
    getBudgetUsage(): Record<string, number>;
    private resolvePrivilegeLevel;
    private emitTrace;
}
/**
 * The canonical test agent cell. Exercises every layer of the guidance
 * control plane by performing reads, inference, and gated writes with
 * a deliberate coherence drop mid-run.
 */
export declare class MemoryClerkCell implements AgentCell {
    readonly cellId: string;
    readonly name = "MemoryClerk";
    private readonly readCount;
    private readonly inferenceCount;
    private readonly writeCount;
    private readonly coherenceDropAtWrite;
    private readonly droppedCoherenceScore;
    constructor(cellId?: string, options?: {
        readCount?: number;
        inferenceCount?: number;
        writeCount?: number;
        coherenceDropAtWrite?: number;
        droppedCoherenceScore?: number;
    });
    run(runtime: CellRuntime): CellRunResult;
}
export interface ConformanceTestResult {
    passed: boolean;
    checks: Array<{
        name: string;
        passed: boolean;
        expected: unknown;
        actual: unknown;
        details: string;
    }>;
    trace: TraceEvent[];
    proofHash: string;
    duration: number;
}
export interface ReplayTestResult {
    identical: boolean;
    totalEvents: number;
    divergences: Array<{
        seq: number;
        originalDecision: string;
        replayDecision: string;
    }>;
}
/**
 * Orchestrates conformance tests by creating all control plane components,
 * running the MemoryClerkCell, and verifying every invariant.
 */
export declare class ConformanceRunner {
    private readonly authority;
    private readonly signingKey;
    constructor(authority?: MemoryAuthority, signingKey?: string);
    /**
     * Run the full conformance test suite and return a structured result
     * with individual pass/fail checks.
     */
    runConformanceTest(): ConformanceTestResult;
    /**
     * Replay a previously captured trace and verify that every decision
     * is reproduced identically by the control plane logic.
     */
    runReplayTest(originalTrace: TraceEvent[]): ReplayTestResult;
}
/**
 * Create a MemoryClerkCell with an optional cellId override.
 */
export declare function createMemoryClerkCell(cellId?: string): MemoryClerkCell;
/**
 * Create a ConformanceRunner with optional authority override.
 */
export declare function createConformanceRunner(authority?: MemoryAuthority, signingKey?: string): ConformanceRunner;
//# sourceMappingURL=conformance-kit.d.ts.map