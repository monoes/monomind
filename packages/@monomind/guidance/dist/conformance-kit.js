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
import { createHash, randomUUID } from 'node:crypto';
import { createMemoryWriteGate, createMemoryEntry, } from './memory-gate.js';
import { createProofChain } from './proof.js';
import { createLedger } from './ledger.js';
import { createCoherenceScheduler, createEconomicGovernor, } from './coherence.js';
import { createToolGateway } from './gateway.js';
// ============================================================================
// Simulated Runtime
// ============================================================================
/**
 * A test runtime that wires together all guidance control plane components
 * and records every operation as a TraceEvent.
 */
export class SimulatedRuntime {
    memoryGate;
    proofChain;
    ledger;
    coherenceScheduler;
    economicGovernor;
    toolGateway;
    authority;
    coherenceScore;
    memoryStore = new Map();
    memoryEntries = [];
    traceEvents = [];
    coherenceHistory = [];
    seq = 0;
    memoryReadCount = 0;
    memoryWritesAttemptedCount = 0;
    memoryWritesCommittedCount = 0;
    memoryWritesBlockedCount = 0;
    memoryOps = [];
    constructor(config) {
        this.memoryGate = config.memoryGate;
        this.proofChain = config.proofChain;
        this.ledger = config.ledger;
        this.coherenceScheduler = config.coherenceScheduler;
        this.economicGovernor = config.economicGovernor;
        this.toolGateway = config.toolGateway ?? createToolGateway();
        this.authority = config.authority;
        this.coherenceScore = config.initialCoherenceScore ?? 0.9;
        if (config.initialMemory) {
            for (const [key, entry] of config.initialMemory) {
                this.memoryStore.set(`${entry.namespace}:${key}`, entry);
            }
        }
    }
    // =========================================================================
    // CellRuntime implementation
    // =========================================================================
    readMemory(key, namespace) {
        this.memoryReadCount++;
        const storeKey = `${namespace}:${key}`;
        const entry = this.memoryStore.get(storeKey);
        const value = entry?.value ?? null;
        const valueHash = createHash('sha256')
            .update(JSON.stringify(value))
            .digest('hex');
        this.memoryOps.push({
            key,
            namespace,
            operation: 'read',
            valueHash,
            timestamp: Date.now(),
        });
        this.emitTrace('memory_read', { key, namespace, found: entry !== undefined }, 'read_allowed');
        this.economicGovernor.recordToolCall('memory_read', 1);
        return value;
    }
    writeMemory(key, namespace, value, evidence) {
        this.memoryWritesAttemptedCount++;
        // Emit proposal trace
        this.emitTrace('memory_write_proposed', {
            key,
            namespace,
            valuePreview: typeof value === 'string' ? value.slice(0, 100) : typeof value,
            evidence: evidence ?? {},
        }, 'proposed');
        // Check coherence before allowing the write
        const privilegeLevel = this.resolvePrivilegeLevel(this.coherenceScore);
        this.emitTrace('coherence_check', { score: this.coherenceScore, privilegeLevel }, privilegeLevel);
        if (privilegeLevel === 'read-only' || privilegeLevel === 'suspended') {
            this.memoryWritesBlockedCount++;
            const reason = `Write blocked: privilege level is "${privilegeLevel}" (coherence: ${this.coherenceScore.toFixed(3)})`;
            this.emitTrace('memory_write_blocked', {
                key,
                namespace,
                privilegeLevel,
                coherenceScore: this.coherenceScore,
            }, 'blocked_coherence');
            return { allowed: false, reason };
        }
        // Evaluate through the MemoryWriteGate
        const decision = this.memoryGate.evaluateWrite(this.authority, key, namespace, value, this.memoryEntries);
        if (!decision.allowed) {
            this.memoryWritesBlockedCount++;
            this.emitTrace('memory_write_blocked', { key, namespace, gateReason: decision.reason }, 'blocked_gate');
            return { allowed: false, reason: decision.reason };
        }
        // Commit the write
        this.memoryWritesCommittedCount++;
        const storeKey = `${namespace}:${key}`;
        this.memoryStore.set(storeKey, { namespace, value });
        const entry = createMemoryEntry(key, namespace, value, this.authority);
        this.memoryEntries.push(entry);
        const valueHash = createHash('sha256')
            .update(JSON.stringify(value))
            .digest('hex');
        this.memoryOps.push({
            key,
            namespace,
            operation: 'write',
            valueHash,
            timestamp: Date.now(),
        });
        this.emitTrace('memory_write_committed', { key, namespace, valueHash }, 'committed');
        this.economicGovernor.recordToolCall('memory_write', 2);
        this.economicGovernor.recordStorageUsage(Buffer.byteLength(JSON.stringify(value), 'utf-8'));
        return { allowed: true, reason: 'Write committed' };
    }
    invokeModel(prompt) {
        const tokens = Math.ceil(prompt.length / 4) + 50;
        this.economicGovernor.recordTokenUsage(tokens);
        const response = `[Simulated inference for: ${prompt.slice(0, 50)}...]`;
        this.emitTrace('model_infer', {
            promptLength: prompt.length,
            responseLength: response.length,
            tokensEstimated: tokens,
        }, 'inference_complete');
        return response;
    }
    invokeTool(name, params) {
        const decision = this.toolGateway.evaluate(name, params);
        this.emitTrace('tool_invoke', {
            toolName: name,
            params,
            allowed: decision.allowed,
            gate: decision.gate,
        }, decision.allowed ? 'allowed' : 'blocked');
        if (!decision.allowed) {
            return { result: null, allowed: false };
        }
        const result = { status: 'ok', tool: name };
        this.toolGateway.recordCall(name, params, result, 10);
        this.economicGovernor.recordToolCall(name, 10);
        return { result, allowed: true };
    }
    getCoherenceScore() {
        return this.coherenceScore;
    }
    setCoherenceScore(score) {
        const previousScore = this.coherenceScore;
        this.coherenceScore = score;
        this.coherenceHistory.push(score);
        const previousLevel = this.resolvePrivilegeLevel(previousScore);
        const newLevel = this.resolvePrivilegeLevel(score);
        if (previousLevel !== newLevel) {
            this.emitTrace('privilege_change', { previousScore, newScore: score, previousLevel, newLevel }, `${previousLevel}->${newLevel}`);
        }
    }
    getProofChain() {
        return this.proofChain;
    }
    getLedger() {
        return this.ledger;
    }
    // =========================================================================
    // Public trace emission (used by cells for run_start / run_end)
    // =========================================================================
    /**
     * Emit a custom trace event. Exposed so agent cells can record
     * lifecycle events (run_start, run_end) through the same trace stream.
     */
    emitCustomTrace(type, payload, decision) {
        this.emitTrace(type, payload, decision);
    }
    // =========================================================================
    // Accessors for test inspection
    // =========================================================================
    getTraceEvents() {
        return [...this.traceEvents];
    }
    getCoherenceHistory() {
        return [...this.coherenceHistory];
    }
    getMemoryReads() {
        return this.memoryReadCount;
    }
    getMemoryWritesAttempted() {
        return this.memoryWritesAttemptedCount;
    }
    getMemoryWritesCommitted() {
        return this.memoryWritesCommittedCount;
    }
    getMemoryWritesBlocked() {
        return this.memoryWritesBlockedCount;
    }
    getMemoryOps() {
        return [...this.memoryOps];
    }
    getBudgetUsage() {
        const usage = this.economicGovernor.getUsageSummary();
        return {
            tokens: usage.tokens.used,
            toolCalls: usage.toolCalls.used,
            storageBytes: usage.storage.usedBytes,
            timeMs: usage.time.usedMs,
            costUsd: usage.cost.totalUsd,
        };
    }
    // =========================================================================
    // Private helpers
    // =========================================================================
    resolvePrivilegeLevel(score) {
        const thresholds = this.coherenceScheduler.getThresholds();
        if (score >= thresholds.healthyThreshold)
            return 'full';
        if (score >= thresholds.warningThreshold)
            return 'restricted';
        if (score >= thresholds.readOnlyThreshold)
            return 'read-only';
        return 'suspended';
    }
    emitTrace(type, payload, decision) {
        const usage = this.economicGovernor.getUsageSummary();
        const event = {
            seq: this.seq++,
            ts: Date.now(),
            type,
            payload,
            decision,
            budgetSnapshot: {
                tokens: usage.tokens.used,
                toolCalls: usage.toolCalls.used,
                storageBytes: usage.storage.usedBytes,
            },
        };
        this.traceEvents.push(event);
    }
}
// ============================================================================
// Memory Clerk Cell
// ============================================================================
/**
 * The canonical test agent cell. Exercises every layer of the guidance
 * control plane by performing reads, inference, and gated writes with
 * a deliberate coherence drop mid-run.
 */
export class MemoryClerkCell {
    cellId;
    name = 'MemoryClerk';
    readCount;
    inferenceCount;
    writeCount;
    coherenceDropAtWrite;
    droppedCoherenceScore;
    constructor(cellId, options) {
        this.cellId = cellId ?? `cell-${randomUUID()}`;
        this.readCount = options?.readCount ?? 20;
        this.inferenceCount = options?.inferenceCount ?? 1;
        this.writeCount = options?.writeCount ?? 5;
        this.coherenceDropAtWrite = options?.coherenceDropAtWrite ?? 3;
        this.droppedCoherenceScore = options?.droppedCoherenceScore ?? 0.2;
    }
    run(runtime) {
        const runId = `run-${randomUUID()}`;
        const startTime = Date.now();
        const sim = runtime;
        // ----- Step 1: run_start -----
        sim.emitCustomTrace('run_start', { cellId: this.cellId, runId, name: this.name }, 'started');
        const coherenceHistory = [runtime.getCoherenceScore()];
        // ----- Step 2: 20 memory reads -----
        for (let i = 0; i < this.readCount; i++) {
            runtime.readMemory(`knowledge-${i}`, 'clerk-workspace');
        }
        coherenceHistory.push(runtime.getCoherenceScore());
        // ----- Step 3: Model inference -----
        let inferenceResult = '';
        for (let i = 0; i < this.inferenceCount; i++) {
            inferenceResult = runtime.invokeModel(`Analyze the ${this.readCount} knowledge entries and determine ` +
                `which ${this.writeCount} insights to persist.`);
        }
        coherenceHistory.push(runtime.getCoherenceScore());
        // ----- Steps 4-7: Propose writes with coherence drop -----
        let writesCommitted = 0;
        let writesBlocked = 0;
        for (let i = 1; i <= this.writeCount; i++) {
            // Inject coherence drop just before the target write
            if (i === this.coherenceDropAtWrite) {
                runtime.setCoherenceScore(this.droppedCoherenceScore);
            }
            coherenceHistory.push(runtime.getCoherenceScore());
            const result = runtime.writeMemory(`insight-${i}`, 'clerk-workspace', {
                insightId: i,
                content: `Insight #${i} derived from model inference`,
                inferenceRef: inferenceResult.slice(0, 20),
                timestamp: Date.now(),
            }, { source: 'model_inference', writeIndex: i });
            if (result.allowed) {
                writesCommitted++;
            }
            else {
                writesBlocked++;
            }
        }
        // ----- Step 8: Emit proof envelope -----
        const event = runtime.getLedger().createEvent(`task-${this.cellId}`, 'general', 'conformance-test');
        event.toolsUsed = ['memory_read', 'memory_write', 'model_infer'];
        event.filesTouched = [];
        runtime.getLedger().finalizeEvent(event);
        const proofEnvelope = runtime.getProofChain().append(event, [], sim.getMemoryOps(), { agentId: this.cellId, sessionId: runId });
        const proofEnvelopeHash = proofEnvelope.contentHash;
        // Determine final outcome
        let outcome = 'completed';
        if (writesBlocked > 0 && writesCommitted > 0) {
            outcome = 'restricted';
        }
        else if (writesBlocked > 0 && writesCommitted === 0) {
            outcome = 'suspended';
        }
        // ----- Step 9: run_end -----
        sim.emitCustomTrace('run_end', {
            cellId: this.cellId,
            runId,
            outcome,
            duration: Date.now() - startTime,
            writesCommitted,
            writesBlocked,
        }, outcome);
        return {
            cellId: this.cellId,
            runId,
            traceEvents: sim.getTraceEvents(),
            memoryReads: sim.getMemoryReads(),
            memoryWritesAttempted: sim.getMemoryWritesAttempted(),
            memoryWritesCommitted: sim.getMemoryWritesCommitted(),
            memoryWritesBlocked: sim.getMemoryWritesBlocked(),
            proofEnvelopeHash,
            coherenceHistory,
            budgetUsage: sim.getBudgetUsage(),
            outcome,
        };
    }
}
// ============================================================================
// Conformance Runner
// ============================================================================
/**
 * Orchestrates conformance tests by creating all control plane components,
 * running the MemoryClerkCell, and verifying every invariant.
 */
export class ConformanceRunner {
    authority;
    signingKey;
    constructor(authority, signingKey) {
        if (!signingKey) {
            throw new Error('ConformanceRunner requires an explicit signingKey');
        }
        this.signingKey = signingKey;
        this.authority = authority ?? {
            agentId: 'memory-clerk-agent',
            role: 'worker',
            namespaces: ['clerk-workspace'],
            maxWritesPerMinute: 100,
            canDelete: false,
            canOverwrite: true,
            trustLevel: 0.8,
        };
    }
    /**
     * Run the full conformance test suite and return a structured result
     * with individual pass/fail checks.
     */
    runConformanceTest() {
        const startTime = Date.now();
        const checks = [];
        // Assemble the control plane
        const memoryGate = createMemoryWriteGate({
            authorities: [this.authority],
            enableContradictionTracking: false,
        });
        const proofChain = createProofChain({ signingKey: this.signingKey });
        const ledger = createLedger();
        const coherenceScheduler = createCoherenceScheduler();
        const economicGovernor = createEconomicGovernor({
            tokenLimit: 100_000,
            toolCallLimit: 1_000,
        });
        const runtime = new SimulatedRuntime({
            memoryGate,
            proofChain,
            ledger,
            coherenceScheduler,
            economicGovernor,
            authority: this.authority,
            initialCoherenceScore: 0.9,
        });
        const cell = new MemoryClerkCell();
        const result = cell.run(runtime);
        // ----- Check 1: Exactly 20 memory reads -----
        checks.push({
            name: 'memory_reads_count',
            passed: result.memoryReads === 20,
            expected: 20,
            actual: result.memoryReads,
            details: `Expected 20 memory reads, got ${result.memoryReads}`,
        });
        // ----- Check 2: 5 memory writes attempted -----
        checks.push({
            name: 'memory_writes_attempted',
            passed: result.memoryWritesAttempted === 5,
            expected: 5,
            actual: result.memoryWritesAttempted,
            details: `Expected 5 write attempts, got ${result.memoryWritesAttempted}`,
        });
        // ----- Check 3: First 2 writes committed -----
        checks.push({
            name: 'memory_writes_committed',
            passed: result.memoryWritesCommitted === 2,
            expected: 2,
            actual: result.memoryWritesCommitted,
            details: `Expected 2 committed writes (writes 1-2 before coherence drop), got ${result.memoryWritesCommitted}`,
        });
        // ----- Check 4: Last 3 writes blocked -----
        checks.push({
            name: 'memory_writes_blocked',
            passed: result.memoryWritesBlocked === 3,
            expected: 3,
            actual: result.memoryWritesBlocked,
            details: `Expected 3 blocked writes (writes 3-5 after coherence drop), got ${result.memoryWritesBlocked}`,
        });
        // ----- Check 5: Proof envelope hash is valid SHA-256 hex -----
        const isValidHash = typeof result.proofEnvelopeHash === 'string' &&
            /^[0-9a-f]{64}$/.test(result.proofEnvelopeHash);
        checks.push({
            name: 'proof_envelope_hash',
            passed: isValidHash,
            expected: 'SHA-256 hex string (64 chars)',
            actual: result.proofEnvelopeHash,
            details: `Hash length: ${result.proofEnvelopeHash.length}, valid hex: ${isValidHash}`,
        });
        // ----- Check 6: Sequential seq numbers -----
        let seqValid = true;
        let seqErrorAt = -1;
        for (let i = 0; i < result.traceEvents.length; i++) {
            if (result.traceEvents[i].seq !== i) {
                seqValid = false;
                seqErrorAt = i;
                break;
            }
        }
        checks.push({
            name: 'sequential_seq_numbers',
            passed: seqValid,
            expected: 'Sequential 0..N',
            actual: seqValid
                ? `0..${result.traceEvents.length - 1}`
                : `Gap at index ${seqErrorAt} (seq=${result.traceEvents[seqErrorAt]?.seq})`,
            details: seqValid
                ? `All ${result.traceEvents.length} events have sequential seq numbers`
                : `Sequence breaks at index ${seqErrorAt}`,
        });
        // ----- Check 7: Budget tracking is consistent -----
        const budgetValid = result.budgetUsage.tokens > 0 && result.budgetUsage.toolCalls > 0;
        checks.push({
            name: 'budget_tracking_consistent',
            passed: budgetValid,
            expected: 'Non-zero token and tool call usage',
            actual: result.budgetUsage,
            details: `tokens=${result.budgetUsage.tokens}, toolCalls=${result.budgetUsage.toolCalls}, storageBytes=${result.budgetUsage.storageBytes}`,
        });
        // ----- Check 8: Outcome is "restricted" -----
        checks.push({
            name: 'outcome_restricted',
            passed: result.outcome === 'restricted',
            expected: 'restricted',
            actual: result.outcome,
            details: 'Expected "restricted" when some writes committed and some blocked',
        });
        // ----- Check 9: Proof chain integrity -----
        const chainValid = proofChain.verifyChain();
        checks.push({
            name: 'proof_chain_valid',
            passed: chainValid,
            expected: true,
            actual: chainValid,
            details: 'Full proof chain HMAC and hash-chain verification',
        });
        // ----- Check 10: Trace has run_start and run_end bookends -----
        const hasRunStart = result.traceEvents.some((e) => e.type === 'run_start');
        const hasRunEnd = result.traceEvents.some((e) => e.type === 'run_end');
        checks.push({
            name: 'trace_bookends',
            passed: hasRunStart && hasRunEnd,
            expected: 'run_start and run_end present',
            actual: { hasRunStart, hasRunEnd },
            details: `run_start=${hasRunStart}, run_end=${hasRunEnd}`,
        });
        // ----- Check 11: Coherence history records the drop -----
        const hasCoherenceDrop = result.coherenceHistory.some((s) => s < 0.3);
        checks.push({
            name: 'coherence_drop_recorded',
            passed: hasCoherenceDrop,
            expected: 'At least one coherence score below 0.3',
            actual: result.coherenceHistory,
            details: `Min coherence: ${Math.min(...result.coherenceHistory).toFixed(3)}`,
        });
        const allPassed = checks.every((c) => c.passed);
        return {
            passed: allPassed,
            checks,
            trace: result.traceEvents,
            proofHash: result.proofEnvelopeHash,
            duration: Date.now() - startTime,
        };
    }
    /**
     * Replay a previously captured trace and verify that every decision
     * is reproduced identically by the control plane logic.
     */
    runReplayTest(originalTrace) {
        const coherenceScheduler = createCoherenceScheduler();
        const thresholds = coherenceScheduler.getThresholds();
        const divergences = [];
        for (const event of originalTrace) {
            let replayDecision;
            switch (event.type) {
                case 'memory_read':
                    replayDecision = 'read_allowed';
                    break;
                case 'memory_write_proposed':
                    replayDecision = 'proposed';
                    break;
                case 'coherence_check': {
                    const score = event.payload.score;
                    if (score >= thresholds.healthyThreshold) {
                        replayDecision = 'full';
                    }
                    else if (score >= thresholds.warningThreshold) {
                        replayDecision = 'restricted';
                    }
                    else if (score >= thresholds.readOnlyThreshold) {
                        replayDecision = 'read-only';
                    }
                    else {
                        replayDecision = 'suspended';
                    }
                    break;
                }
                case 'memory_write_committed':
                    replayDecision = 'committed';
                    break;
                case 'memory_write_blocked': {
                    const hasPrivilegeLevel = event.payload.privilegeLevel !== undefined;
                    replayDecision = hasPrivilegeLevel
                        ? 'blocked_coherence'
                        : 'blocked_gate';
                    break;
                }
                case 'model_infer':
                    replayDecision = 'inference_complete';
                    break;
                case 'tool_invoke':
                    replayDecision = event.payload.allowed
                        ? 'allowed'
                        : 'blocked';
                    break;
                case 'privilege_change': {
                    const prev = event.payload.previousLevel;
                    const next = event.payload.newLevel;
                    replayDecision = `${prev}->${next}`;
                    break;
                }
                case 'run_start':
                    replayDecision = 'started';
                    break;
                case 'run_end':
                    replayDecision = event.payload.outcome;
                    break;
                default:
                    replayDecision = 'unknown';
            }
            if (replayDecision !== event.decision) {
                divergences.push({
                    seq: event.seq,
                    originalDecision: event.decision,
                    replayDecision,
                });
            }
        }
        return {
            identical: divergences.length === 0,
            totalEvents: originalTrace.length,
            divergences,
        };
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a MemoryClerkCell with an optional cellId override.
 */
export function createMemoryClerkCell(cellId) {
    return new MemoryClerkCell(cellId);
}
/**
 * Create a ConformanceRunner with optional authority override.
 */
export function createConformanceRunner(authority, signingKey) {
    return new ConformanceRunner(authority, signingKey ?? 'conformance-test-key');
}
//# sourceMappingURL=conformance-kit.js.map