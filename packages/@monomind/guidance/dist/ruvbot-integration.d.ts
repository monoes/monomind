/**
 * RuvBot Integration Bridge
 *
 * Bridges ruvbot (npm: ruvbot@0.1.8) with the @monobrain/guidance control
 * plane. Wires ruvbot events to guidance hooks, wraps AIDefence as an
 * enforcement gate, governs memory operations, and feeds trust accumulation.
 *
 * ruvbot is an optional peer dependency. All types and classes are exported
 * regardless of whether ruvbot is installed. Runtime calls that require the
 * ruvbot package will throw a clear error if the package is missing.
 *
 * Components:
 * 1. RuvBotGuidanceBridge  - Event wiring, gate delegation, trust tracking
 * 2. AIDefenceGate         - Prompt injection, jailbreak, PII detection gate
 * 3. RuvBotMemoryAdapter   - Governed memory read/write with proof logging
 *
 * @module @monobrain/guidance/ruvbot-integration
 */
import type { GateResult } from './types.js';
import type { MemoryAuthority, MemoryEntry, WriteDecision } from './memory-gate.js';
/**
 * Minimal interface for a ruvbot instance. Mirrors the event-emitter surface
 * exposed by `createRuvBot()` without importing the package at compile time.
 */
export interface RuvBotInstance {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit?(event: string, ...args: unknown[]): void;
}
/**
 * Minimal interface for ruvbot's AIDefence guard returned by
 * `createAIDefenceGuard()`.
 */
export interface RuvBotAIDefenceGuard {
    check(input: string): Promise<{
        safe: boolean;
        threats: Array<{
            type: string;
            severity: string;
            detail: string;
        }>;
        sanitizedInput?: string;
    }>;
}
/**
 * Minimal interface for ruvbot's memory subsystem.
 */
export interface RuvBotMemory {
    read(key: string, namespace?: string): Promise<unknown>;
    write(key: string, value: unknown, namespace?: string): Promise<void>;
    delete?(key: string, namespace?: string): Promise<void>;
    search?(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
}
/**
 * Threat detected by the AIDefence layer.
 */
export interface AIDefenceThreat {
    type: 'prompt-injection' | 'jailbreak' | 'pii' | 'control-chars' | 'homoglyph';
    severity: 'low' | 'medium' | 'high' | 'critical';
    detail: string;
}
/**
 * Result of an AIDefence evaluation.
 */
export interface AIDefenceResult {
    safe: boolean;
    threats: AIDefenceThreat[];
    sanitizedInput?: string;
    latencyMs: number;
}
/**
 * Configuration for the AIDefenceGate.
 */
export interface AIDefenceGateConfig {
    detectPromptInjection: boolean;
    detectJailbreak: boolean;
    detectPII: boolean;
    blockThreshold: 'low' | 'medium' | 'high';
}
/**
 * Configuration for the RuvBotGuidanceBridge.
 */
export interface RuvBotBridgeConfig {
    enableAIDefence: boolean;
    enableMemoryGovernance: boolean;
    enableTrustTracking: boolean;
    enableProofChain: boolean;
    /** HMAC signing key for proof chains. Required when enableProofChain is true. */
    proofSigningKey?: string;
}
/**
 * A normalized ruvbot event for internal processing.
 */
export interface RuvBotEvent {
    type: string;
    timestamp: number;
    sessionId?: string;
    agentId?: string;
    data: Record<string, unknown>;
}
/**
 * Wraps ruvbot's 6-layer AIDefence as an enforcement gate compatible with the
 * guidance control plane's GateResult / GateDecision interface.
 *
 * Supports:
 * - Prompt injection detection
 * - Jailbreak detection
 * - PII detection
 * - Control character and homoglyph detection (via ruvbot internals)
 * - Configurable sensitivity / block threshold
 *
 * Evaluates both input (pre-processing) and output (post-processing) text.
 */
export declare class AIDefenceGate {
    private config;
    private guard;
    private guardInitPromise;
    constructor(config?: Partial<AIDefenceGateConfig>);
    /**
     * Lazily initialize the underlying ruvbot AIDefence guard.
     * Safe to call multiple times; only the first call creates the guard.
     */
    private ensureGuard;
    /**
     * Evaluate input text for threats (pre-processing gate).
     *
     * Checks for prompt injection, jailbreak attempts, and PII based
     * on the configured sensitivity.
     */
    evaluateInput(input: string): Promise<AIDefenceResult>;
    /**
     * Evaluate output text for threats (post-processing gate).
     *
     * Primarily checks for PII leakage and secret exposure in responses.
     */
    evaluateOutput(output: string): Promise<AIDefenceResult>;
    /**
     * Convert an AIDefenceResult into a GateResult compatible with the
     * guidance enforcement pipeline.
     *
     * Decision logic:
     * - If no threats: 'allow'
     * - If threats above block threshold: 'block'
     * - Otherwise: 'warn'
     */
    toGateResult(result: AIDefenceResult, context?: string): GateResult;
    /**
     * Get the current configuration.
     */
    getConfig(): AIDefenceGateConfig;
    /**
     * Update configuration. Resets the guard so the next evaluation
     * re-initializes with the new settings.
     */
    updateConfig(config: Partial<AIDefenceGateConfig>): void;
    private normalizeThreats;
    private buildRemediation;
}
/**
 * Wraps ruvbot's memory read/write operations with guidance control plane
 * governance. Every write passes through the MemoryWriteGate for authority
 * and coherence checks. All operations are logged to a proof chain.
 */
export declare class RuvBotMemoryAdapter {
    private readonly memoryGate;
    private readonly coherenceScheduler;
    private proofChain;
    private ruvbotMemory;
    private operationLog;
    constructor(memoryGate: import('./memory-gate.js').MemoryWriteGate, coherenceScheduler: import('./coherence.js').CoherenceScheduler);
    /**
     * Attach a ruvbot memory instance for proxied operations.
     */
    attachMemory(memory: RuvBotMemory): void;
    /**
     * Attach a proof chain for operation logging.
     */
    attachProofChain(proofChain: import('./proof.js').ProofChain): void;
    /**
     * Governed read: reads through ruvbot memory, logs to proof chain.
     */
    read(key: string, namespace?: string): Promise<unknown>;
    /**
     * Governed write: runs through MemoryWriteGate, checks coherence,
     * logs to proof chain, then delegates to ruvbot memory.
     *
     * Returns the WriteDecision. If denied, the write is not performed.
     */
    write(key: string, namespace: string, value: unknown, authority: MemoryAuthority, existingEntries?: MemoryEntry[]): Promise<WriteDecision>;
    /**
     * Governed delete: checks authority, logs, then delegates.
     */
    delete(key: string, namespace: string, authority: MemoryAuthority): Promise<{
        allowed: boolean;
        reason: string;
    }>;
    /**
     * Get the operation log for audit/proof purposes.
     */
    getOperationLog(): ReadonlyArray<{
        operation: 'read' | 'write' | 'delete';
        key: string;
        namespace: string;
        timestamp: number;
        decision?: WriteDecision;
    }>;
    /**
     * Get the count of governed operations.
     */
    get operationCount(): number;
    /**
     * Clear the operation log.
     */
    clearLog(): void;
    private ensureMemoryAttached;
}
/**
 * Bridges a ruvbot instance with the @monobrain/guidance control plane.
 *
 * Wires ruvbot event hooks to guidance enforcement and trust systems:
 *
 * - `message`        -> EnforcementGates (secrets, destructive ops) + AIDefence
 * - `agent:spawn`    -> ManifestValidator
 * - `session:create` -> ProofChain initialization
 * - `session:end`    -> ProofChain finalization and ledger persistence
 * - `ready`          -> Trust accumulator initialization
 * - `error`          -> Trust 'deny' outcome recording
 *
 * All gate outcomes are fed into the TrustAccumulator so that ruvbot agents
 * build (or lose) trust over time.
 */
export declare class RuvBotGuidanceBridge {
    private readonly config;
    private ruvbot;
    private gates;
    private manifestValidator;
    private trustSystem;
    private aiDefenceGate;
    private memoryAdapter;
    private sessionChains;
    private boundHandlers;
    private eventLog;
    private static readonly MAX_EVENT_LOG;
    constructor(config?: Partial<RuvBotBridgeConfig>);
    /**
     * Attach guidance control plane components.
     *
     * Accepts either a full GuidanceControlPlane instance (from which
     * sub-components are extracted) or individual components.
     */
    attachGuidance(components: {
        gates?: import('./gates.js').EnforcementGates;
        manifestValidator?: import('./manifest-validator.js').ManifestValidator;
        trustSystem?: import('./trust.js').TrustSystem;
        aiDefenceGate?: AIDefenceGate;
        memoryAdapter?: RuvBotMemoryAdapter;
    }): void;
    /**
     * Connect to a ruvbot instance and wire all event handlers.
     *
     * This is the primary entry point. Once called, the bridge will
     * intercept ruvbot events and route them through guidance gates.
     */
    connect(ruvbot: RuvBotInstance): void;
    /**
     * Disconnect from the ruvbot instance, removing all event handlers.
     */
    disconnect(): void;
    /**
     * Evaluate a ruvbot AIDefence result and return a GateResult-compatible
     * decision. Can be called independently of event wiring.
     */
    evaluateAIDefence(input: string): Promise<GateResult>;
    /**
     * Get the proof chain for a specific session.
     */
    getSessionProofChain(sessionId: string): import('./proof.js').ProofChain | undefined;
    /**
     * Get all active session IDs.
     */
    getActiveSessionIds(): string[];
    /**
     * Get the event log for diagnostics.
     */
    getEventLog(): ReadonlyArray<RuvBotEvent>;
    /**
     * Get the current bridge configuration.
     */
    getConfig(): RuvBotBridgeConfig;
    /**
     * Whether the bridge is currently connected to a ruvbot instance.
     */
    get connected(): boolean;
    /**
     * Handle `message` events: run content through enforcement gates
     * and optionally through AIDefence.
     */
    private handleMessage;
    /**
     * Handle `agent:spawn` events: validate agent manifest.
     */
    private handleAgentSpawn;
    /**
     * Handle `session:create` events: initialize a proof chain for the session.
     */
    private handleSessionCreate;
    /**
     * Handle `session:end` events: finalize the proof chain and persist.
     */
    private handleSessionEnd;
    /**
     * Handle `ready` events: log bridge activation.
     */
    private handleReady;
    /**
     * Handle `shutdown` events: clean up all session proof chains.
     */
    private handleShutdown;
    /**
     * Handle `error` events: record a deny outcome in trust tracking.
     */
    private handleError;
    /**
     * Handle `agent:stop` events: record final trust snapshot.
     */
    private handleAgentStop;
    private wireEvent;
    private logEvent;
}
/**
 * Create a fully wired RuvBotGuidanceBridge.
 *
 * Connects the bridge to a ruvbot instance and attaches the guidance
 * control plane components. The bridge immediately begins intercepting
 * ruvbot events.
 *
 * @param ruvbotInstance - A ruvbot instance (from createRuvBot())
 * @param guidancePlane - A GuidanceControlPlane or individual components
 * @param config - Optional bridge configuration
 * @returns The connected RuvBotGuidanceBridge
 */
export declare function createRuvBotBridge(ruvbotInstance: RuvBotInstance, guidancePlane: {
    gates?: import('./gates.js').EnforcementGates;
    manifestValidator?: import('./manifest-validator.js').ManifestValidator;
    trustSystem?: import('./trust.js').TrustSystem;
    aiDefenceGate?: AIDefenceGate;
    memoryAdapter?: RuvBotMemoryAdapter;
}, config?: Partial<RuvBotBridgeConfig>): RuvBotGuidanceBridge;
/**
 * Create an AIDefenceGate with optional configuration.
 *
 * The gate lazily initializes the underlying ruvbot AIDefence guard
 * on the first evaluation call.
 *
 * @param config - Optional gate configuration
 * @returns A new AIDefenceGate instance
 */
export declare function createAIDefenceGate(config?: Partial<AIDefenceGateConfig>): AIDefenceGate;
/**
 * Create a RuvBotMemoryAdapter with governance components.
 *
 * The adapter wraps ruvbot memory operations with MemoryWriteGate authority
 * checks and CoherenceScheduler tracking.
 *
 * @param memoryGate - The MemoryWriteGate for authority/rate/contradiction checks
 * @param coherenceScheduler - The CoherenceScheduler for drift tracking
 * @returns A new RuvBotMemoryAdapter instance
 */
export declare function createRuvBotMemoryAdapter(memoryGate: import('./memory-gate.js').MemoryWriteGate, coherenceScheduler: import('./coherence.js').CoherenceScheduler): RuvBotMemoryAdapter;
//# sourceMappingURL=ruvbot-integration.d.ts.map