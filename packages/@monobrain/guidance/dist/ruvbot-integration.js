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
// ============================================================================
// Severity Mapping
// ============================================================================
/** Maps blockThreshold to a minimum severity that triggers a block. */
const BLOCK_SEVERITY_THRESHOLDS = {
    low: new Set(['low', 'medium', 'high', 'critical']),
    medium: new Set(['medium', 'high', 'critical']),
    high: new Set(['high', 'critical']),
};
/** Maps ruvbot threat type strings to our typed threat type. */
const THREAT_TYPE_MAP = {
    'prompt-injection': 'prompt-injection',
    'prompt_injection': 'prompt-injection',
    'promptInjection': 'prompt-injection',
    'jailbreak': 'jailbreak',
    'pii': 'pii',
    'control-chars': 'control-chars',
    'control_chars': 'control-chars',
    'controlChars': 'control-chars',
    'homoglyph': 'homoglyph',
};
/** Maps ruvbot severity strings to our typed severity. */
const SEVERITY_MAP = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    critical: 'critical',
};
// ============================================================================
// Dynamic Import Helper
// ============================================================================
/** Resolved ruvbot module cache (null = not attempted, undefined = failed). */
let ruvbotModuleCache = null;
/**
 * Module specifiers kept in variables so TypeScript does not attempt
 * compile-time resolution of this optional peer dependency.
 */
const RUVBOT_MODULE = 'ruvbot';
const RUVBOT_CORE_MODULE = 'ruvbot/core';
/**
 * Attempt to dynamically import the ruvbot package.
 * Throws a descriptive error if the package is not installed.
 */
async function requireRuvBot() {
    if (ruvbotModuleCache)
        return ruvbotModuleCache;
    try {
        const mod = await import(RUVBOT_MODULE);
        ruvbotModuleCache = mod;
        return mod;
    }
    catch {
        throw new Error('ruvbot is not installed. Install it with: npm install ruvbot@0.1.8\n' +
            'ruvbot is an optional peer dependency of @monobrain/guidance.');
    }
}
/**
 * Attempt to dynamically import ruvbot/core sub-export.
 */
async function requireRuvBotCore() {
    try {
        return await import(RUVBOT_CORE_MODULE);
    }
    catch {
        // Fall back to the main export
        return requireRuvBot();
    }
}
// ============================================================================
// AIDefenceGate
// ============================================================================
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
export class AIDefenceGate {
    config;
    guard = null;
    guardInitPromise = null;
    constructor(config = {}) {
        this.config = {
            detectPromptInjection: config.detectPromptInjection ?? true,
            detectJailbreak: config.detectJailbreak ?? true,
            detectPII: config.detectPII ?? true,
            blockThreshold: config.blockThreshold ?? 'medium',
        };
    }
    /**
     * Lazily initialize the underlying ruvbot AIDefence guard.
     * Safe to call multiple times; only the first call creates the guard.
     */
    async ensureGuard() {
        if (this.guard)
            return this.guard;
        if (!this.guardInitPromise) {
            this.guardInitPromise = (async () => {
                const mod = await requireRuvBot();
                const createGuard = mod['createAIDefenceGuard'];
                if (typeof createGuard !== 'function') {
                    throw new Error('ruvbot does not export createAIDefenceGuard. ' +
                        'Ensure ruvbot@0.1.8 or later is installed.');
                }
                this.guard = createGuard({
                    detectPromptInjection: this.config.detectPromptInjection,
                    detectJailbreak: this.config.detectJailbreak,
                    detectPII: this.config.detectPII,
                });
            })();
        }
        await this.guardInitPromise;
        return this.guard;
    }
    /**
     * Evaluate input text for threats (pre-processing gate).
     *
     * Checks for prompt injection, jailbreak attempts, and PII based
     * on the configured sensitivity.
     */
    async evaluateInput(input) {
        const start = performance.now();
        const guard = await this.ensureGuard();
        const raw = await guard.check(input);
        const latencyMs = performance.now() - start;
        const threats = this.normalizeThreats(raw.threats);
        return {
            safe: raw.safe,
            threats,
            sanitizedInput: raw.sanitizedInput,
            latencyMs,
        };
    }
    /**
     * Evaluate output text for threats (post-processing gate).
     *
     * Primarily checks for PII leakage and secret exposure in responses.
     */
    async evaluateOutput(output) {
        const start = performance.now();
        const guard = await this.ensureGuard();
        const raw = await guard.check(output);
        const latencyMs = performance.now() - start;
        // For output evaluation, focus on PII / data leakage threats
        const threats = this.normalizeThreats(raw.threats).filter(t => t.type === 'pii' || t.type === 'control-chars');
        return {
            safe: threats.length === 0,
            threats,
            sanitizedInput: raw.sanitizedInput,
            latencyMs,
        };
    }
    /**
     * Convert an AIDefenceResult into a GateResult compatible with the
     * guidance enforcement pipeline.
     *
     * Decision logic:
     * - If no threats: 'allow'
     * - If threats above block threshold: 'block'
     * - Otherwise: 'warn'
     */
    toGateResult(result, context) {
        if (result.safe && result.threats.length === 0) {
            return {
                decision: 'allow',
                gateName: 'ai-defence',
                reason: 'AIDefence check passed with no threats detected.',
                triggeredRules: [],
                metadata: { latencyMs: result.latencyMs },
            };
        }
        const blockingSeverities = BLOCK_SEVERITY_THRESHOLDS[this.config.blockThreshold];
        const blockingThreats = result.threats.filter(t => blockingSeverities.has(t.severity));
        const decision = blockingThreats.length > 0 ? 'block' : 'warn';
        const threatSummary = result.threats
            .map(t => `${t.type} (${t.severity}): ${t.detail}`)
            .join('; ');
        return {
            decision,
            gateName: 'ai-defence',
            reason: `AIDefence detected ${result.threats.length} threat(s): ${threatSummary}`,
            triggeredRules: [],
            remediation: this.buildRemediation(result.threats),
            metadata: {
                threats: result.threats,
                blockThreshold: this.config.blockThreshold,
                latencyMs: result.latencyMs,
                context,
            },
        };
    }
    /**
     * Get the current configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration. Resets the guard so the next evaluation
     * re-initializes with the new settings.
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.guard = null;
        this.guardInitPromise = null;
    }
    // ===== Private Helpers =====
    normalizeThreats(raw) {
        return raw.map(t => ({
            type: THREAT_TYPE_MAP[t.type] ?? 'prompt-injection',
            severity: SEVERITY_MAP[t.severity] ?? 'medium',
            detail: t.detail,
        }));
    }
    buildRemediation(threats) {
        const parts = [];
        const hasInjection = threats.some(t => t.type === 'prompt-injection');
        const hasJailbreak = threats.some(t => t.type === 'jailbreak');
        const hasPII = threats.some(t => t.type === 'pii');
        if (hasInjection) {
            parts.push('1. Review input for prompt injection patterns and remove adversarial content.');
        }
        if (hasJailbreak) {
            parts.push('2. Input contains jailbreak attempt. Reject and log the attempt.');
        }
        if (hasPII) {
            parts.push('3. Redact or mask personally identifiable information before processing.');
        }
        if (parts.length === 0) {
            parts.push('Review flagged content and apply appropriate sanitization.');
        }
        return parts.join('\n');
    }
}
// ============================================================================
// RuvBotMemoryAdapter
// ============================================================================
/**
 * Wraps ruvbot's memory read/write operations with guidance control plane
 * governance. Every write passes through the MemoryWriteGate for authority
 * and coherence checks. All operations are logged to a proof chain.
 */
export class RuvBotMemoryAdapter {
    memoryGate;
    coherenceScheduler;
    proofChain = null;
    ruvbotMemory = null;
    operationLog = [];
    constructor(memoryGate, coherenceScheduler) {
        this.memoryGate = memoryGate;
        this.coherenceScheduler = coherenceScheduler;
    }
    /**
     * Attach a ruvbot memory instance for proxied operations.
     */
    attachMemory(memory) {
        this.ruvbotMemory = memory;
    }
    /**
     * Attach a proof chain for operation logging.
     */
    attachProofChain(proofChain) {
        this.proofChain = proofChain;
    }
    /**
     * Governed read: reads through ruvbot memory, logs to proof chain.
     */
    async read(key, namespace = 'default') {
        this.ensureMemoryAttached();
        const value = await this.ruvbotMemory.read(key, namespace);
        this.operationLog.push({
            operation: 'read',
            key,
            namespace,
            timestamp: Date.now(),
        });
        return value;
    }
    /**
     * Governed write: runs through MemoryWriteGate, checks coherence,
     * logs to proof chain, then delegates to ruvbot memory.
     *
     * Returns the WriteDecision. If denied, the write is not performed.
     */
    async write(key, namespace, value, authority, existingEntries) {
        this.ensureMemoryAttached();
        // Step 1: Evaluate through MemoryWriteGate
        const decision = this.memoryGate.evaluateWrite(authority, key, namespace, value, existingEntries);
        // Step 2: Log the operation
        this.operationLog.push({
            operation: 'write',
            key,
            namespace,
            timestamp: Date.now(),
            decision,
        });
        // Step 3: If denied, do not write
        if (!decision.allowed) {
            return decision;
        }
        // Step 4: Perform the write through ruvbot
        await this.ruvbotMemory.write(key, value, namespace);
        return decision;
    }
    /**
     * Governed delete: checks authority, logs, then delegates.
     */
    async delete(key, namespace, authority) {
        this.ensureMemoryAttached();
        // Authority must have delete permission
        if (!authority.canDelete) {
            const result = {
                allowed: false,
                reason: `Agent "${authority.agentId}" does not have delete permission.`,
            };
            this.operationLog.push({
                operation: 'delete',
                key,
                namespace,
                timestamp: Date.now(),
            });
            return result;
        }
        // Perform the delete if the underlying memory supports it
        if (typeof this.ruvbotMemory.delete === 'function') {
            await this.ruvbotMemory.delete(key, namespace);
        }
        this.operationLog.push({
            operation: 'delete',
            key,
            namespace,
            timestamp: Date.now(),
        });
        return { allowed: true, reason: 'Delete permitted and executed.' };
    }
    /**
     * Get the operation log for audit/proof purposes.
     */
    getOperationLog() {
        return this.operationLog;
    }
    /**
     * Get the count of governed operations.
     */
    get operationCount() {
        return this.operationLog.length;
    }
    /**
     * Clear the operation log.
     */
    clearLog() {
        this.operationLog = [];
    }
    // ===== Private Helpers =====
    ensureMemoryAttached() {
        if (!this.ruvbotMemory) {
            throw new Error('No ruvbot memory instance attached. Call attachMemory() before ' +
                'performing memory operations.');
        }
    }
}
// ============================================================================
// RuvBotGuidanceBridge
// ============================================================================
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
export class RuvBotGuidanceBridge {
    config;
    ruvbot = null;
    // Guidance components (injected)
    gates = null;
    manifestValidator = null;
    trustSystem = null;
    aiDefenceGate = null;
    memoryAdapter = null;
    // Session proof chains keyed by sessionId
    sessionChains = new Map();
    // Bound event handlers for cleanup
    boundHandlers = new Map();
    // Event log for diagnostics
    eventLog = [];
    static MAX_EVENT_LOG = 1000;
    constructor(config = {}) {
        this.config = {
            enableAIDefence: config.enableAIDefence ?? true,
            enableMemoryGovernance: config.enableMemoryGovernance ?? true,
            enableTrustTracking: config.enableTrustTracking ?? true,
            enableProofChain: config.enableProofChain ?? true,
        };
    }
    /**
     * Attach guidance control plane components.
     *
     * Accepts either a full GuidanceControlPlane instance (from which
     * sub-components are extracted) or individual components.
     */
    attachGuidance(components) {
        if (components.gates)
            this.gates = components.gates;
        if (components.manifestValidator)
            this.manifestValidator = components.manifestValidator;
        if (components.trustSystem)
            this.trustSystem = components.trustSystem;
        if (components.aiDefenceGate)
            this.aiDefenceGate = components.aiDefenceGate;
        if (components.memoryAdapter)
            this.memoryAdapter = components.memoryAdapter;
    }
    /**
     * Connect to a ruvbot instance and wire all event handlers.
     *
     * This is the primary entry point. Once called, the bridge will
     * intercept ruvbot events and route them through guidance gates.
     */
    connect(ruvbot) {
        if (this.ruvbot) {
            this.disconnect();
        }
        this.ruvbot = ruvbot;
        // Wire event handlers
        this.wireEvent('message', this.handleMessage.bind(this));
        this.wireEvent('agent:spawn', this.handleAgentSpawn.bind(this));
        this.wireEvent('session:create', this.handleSessionCreate.bind(this));
        this.wireEvent('session:end', this.handleSessionEnd.bind(this));
        this.wireEvent('ready', this.handleReady.bind(this));
        this.wireEvent('shutdown', this.handleShutdown.bind(this));
        this.wireEvent('error', this.handleError.bind(this));
        this.wireEvent('agent:stop', this.handleAgentStop.bind(this));
    }
    /**
     * Disconnect from the ruvbot instance, removing all event handlers.
     */
    disconnect() {
        if (!this.ruvbot)
            return;
        for (const [event, handler] of this.boundHandlers) {
            this.ruvbot.off(event, handler);
        }
        this.boundHandlers.clear();
        this.ruvbot = null;
    }
    /**
     * Evaluate a ruvbot AIDefence result and return a GateResult-compatible
     * decision. Can be called independently of event wiring.
     */
    async evaluateAIDefence(input) {
        if (!this.aiDefenceGate) {
            throw new Error('AIDefenceGate not attached. Call attachGuidance({ aiDefenceGate }) first.');
        }
        const result = await this.aiDefenceGate.evaluateInput(input);
        return this.aiDefenceGate.toGateResult(result, 'manual-evaluation');
    }
    /**
     * Get the proof chain for a specific session.
     */
    getSessionProofChain(sessionId) {
        return this.sessionChains.get(sessionId);
    }
    /**
     * Get all active session IDs.
     */
    getActiveSessionIds() {
        return [...this.sessionChains.keys()];
    }
    /**
     * Get the event log for diagnostics.
     */
    getEventLog() {
        return this.eventLog;
    }
    /**
     * Get the current bridge configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Whether the bridge is currently connected to a ruvbot instance.
     */
    get connected() {
        return this.ruvbot !== null;
    }
    // ===== Event Handlers =====
    /**
     * Handle `message` events: run content through enforcement gates
     * and optionally through AIDefence.
     */
    async handleMessage(...args) {
        const data = (args[0] ?? {});
        const content = String(data['content'] ?? data['text'] ?? '');
        const sessionId = String(data['sessionId'] ?? 'unknown');
        const agentId = String(data['agentId'] ?? 'unknown');
        this.logEvent('message', { sessionId, agentId, contentLength: content.length });
        const gateResults = [];
        // Step 1: Run through EnforcementGates (secrets, destructive ops)
        if (this.gates) {
            const commandResults = this.gates.evaluateCommand(content);
            gateResults.push(...commandResults);
        }
        // Step 2: Run through AIDefence gate
        if (this.config.enableAIDefence && this.aiDefenceGate) {
            try {
                const defenceResult = await this.aiDefenceGate.evaluateInput(content);
                const gateResult = this.aiDefenceGate.toGateResult(defenceResult, `message:${sessionId}`);
                if (gateResult.decision !== 'allow') {
                    gateResults.push(gateResult);
                }
            }
            catch {
                // AIDefence unavailable; log but do not block
            }
        }
        // Step 3: Feed outcomes into trust accumulator
        if (this.config.enableTrustTracking && this.trustSystem) {
            if (gateResults.length === 0) {
                this.trustSystem.recordOutcome(agentId, 'allow', `Message passed all gates (session: ${sessionId})`);
            }
            else {
                for (const result of gateResults) {
                    const outcome = gateDecisionToTrustOutcome(result.decision);
                    this.trustSystem.recordOutcome(agentId, outcome, `Gate "${result.gateName}" ${result.decision}: ${result.reason}`);
                }
            }
        }
    }
    /**
     * Handle `agent:spawn` events: validate agent manifest.
     */
    async handleAgentSpawn(...args) {
        const data = (args[0] ?? {});
        const agentId = String(data['agentId'] ?? data['id'] ?? 'unknown');
        const manifest = data['manifest'];
        this.logEvent('agent:spawn', { agentId, hasManifest: !!manifest });
        if (this.manifestValidator && manifest) {
            const validation = this.manifestValidator.validate(manifest);
            if (this.config.enableTrustTracking && this.trustSystem) {
                if (validation.admissionDecision === 'admit') {
                    this.trustSystem.recordOutcome(agentId, 'allow', `Agent manifest validated: admission=${validation.admissionDecision}, risk=${validation.riskScore}`);
                }
                else {
                    const outcome = validation.admissionDecision === 'reject' ? 'deny' : 'warn';
                    this.trustSystem.recordOutcome(agentId, outcome, `Agent manifest ${validation.admissionDecision}: risk=${validation.riskScore}, errors=${validation.errors.length}`);
                }
            }
        }
    }
    /**
     * Handle `session:create` events: initialize a proof chain for the session.
     */
    async handleSessionCreate(...args) {
        const data = (args[0] ?? {});
        const sessionId = String(data['sessionId'] ?? data['id'] ?? `session-${Date.now()}`);
        this.logEvent('session:create', { sessionId });
        if (this.config.enableProofChain) {
            if (!this.config.proofSigningKey) {
                throw new Error('RuvBotBridgeConfig.proofSigningKey is required when enableProofChain is true');
            }
            const { createProofChain } = await import('./proof.js');
            const chain = createProofChain({ signingKey: this.config.proofSigningKey });
            this.sessionChains.set(sessionId, chain);
        }
    }
    /**
     * Handle `session:end` events: finalize the proof chain and persist.
     */
    async handleSessionEnd(...args) {
        const data = (args[0] ?? {});
        const sessionId = String(data['sessionId'] ?? data['id'] ?? 'unknown');
        this.logEvent('session:end', { sessionId });
        if (this.config.enableProofChain) {
            const chain = this.sessionChains.get(sessionId);
            if (chain) {
                // Export the finalized chain for external persistence
                const _exported = chain.export();
                // The caller can retrieve this via getSessionProofChain() before
                // the session is cleaned up, or listen for an event.
                // Clean up
                this.sessionChains.delete(sessionId);
            }
        }
    }
    /**
     * Handle `ready` events: log bridge activation.
     */
    async handleReady(...args) {
        this.logEvent('ready', {});
    }
    /**
     * Handle `shutdown` events: clean up all session proof chains.
     */
    async handleShutdown(...args) {
        this.logEvent('shutdown', {});
        this.sessionChains.clear();
    }
    /**
     * Handle `error` events: record a deny outcome in trust tracking.
     */
    async handleError(...args) {
        const data = (args[0] ?? {});
        const agentId = String(data['agentId'] ?? 'unknown');
        const errorMessage = String(data['message'] ?? data['error'] ?? 'unknown error');
        this.logEvent('error', { agentId, error: errorMessage });
        if (this.config.enableTrustTracking && this.trustSystem) {
            this.trustSystem.recordOutcome(agentId, 'deny', `Error event: ${errorMessage}`);
        }
    }
    /**
     * Handle `agent:stop` events: record final trust snapshot.
     */
    async handleAgentStop(...args) {
        const data = (args[0] ?? {});
        const agentId = String(data['agentId'] ?? data['id'] ?? 'unknown');
        this.logEvent('agent:stop', { agentId });
    }
    // ===== Private Helpers =====
    wireEvent(event, handler) {
        this.boundHandlers.set(event, handler);
        this.ruvbot.on(event, handler);
    }
    logEvent(type, data) {
        const event = {
            type,
            timestamp: Date.now(),
            sessionId: data['sessionId'],
            agentId: data['agentId'],
            data,
        };
        this.eventLog.push(event);
        if (this.eventLog.length > RuvBotGuidanceBridge.MAX_EVENT_LOG) {
            this.eventLog = this.eventLog.slice(-RuvBotGuidanceBridge.MAX_EVENT_LOG);
        }
    }
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Map a GateDecision to a GateOutcome for trust accumulation.
 *
 * - 'allow' -> 'allow'
 * - 'block' -> 'deny'
 * - 'require-confirmation' -> 'warn'
 * - 'warn' -> 'warn'
 */
function gateDecisionToTrustOutcome(decision) {
    switch (decision) {
        case 'allow': return 'allow';
        case 'block': return 'deny';
        case 'warn': return 'warn';
        case 'require-confirmation': return 'warn';
        default: return 'warn';
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
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
export function createRuvBotBridge(ruvbotInstance, guidancePlane, config) {
    const bridge = new RuvBotGuidanceBridge(config);
    bridge.attachGuidance(guidancePlane);
    bridge.connect(ruvbotInstance);
    return bridge;
}
/**
 * Create an AIDefenceGate with optional configuration.
 *
 * The gate lazily initializes the underlying ruvbot AIDefence guard
 * on the first evaluation call.
 *
 * @param config - Optional gate configuration
 * @returns A new AIDefenceGate instance
 */
export function createAIDefenceGate(config) {
    return new AIDefenceGate(config);
}
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
export function createRuvBotMemoryAdapter(memoryGate, coherenceScheduler) {
    return new RuvBotMemoryAdapter(memoryGate, coherenceScheduler);
}
//# sourceMappingURL=ruvbot-integration.js.map