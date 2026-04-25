/**
 * Manifest Validator & Conformance Suite
 *
 * Validates AgentCellManifest documents against the Agentic Container spec,
 * computes risk scores, selects execution lanes, and fails closed on any
 * validation error. The ConformanceSuite runs golden traces through an
 * evaluator to prove the platform behaves as specified.
 *
 * @module @monobrain/guidance/manifest-validator
 */
/** Data sensitivity levels ordered by severity */
declare const DATA_SENSITIVITY_LEVELS: readonly ["public", "internal", "confidential", "restricted"];
type DataSensitivity = typeof DATA_SENSITIVITY_LEVELS[number];
/** Write modes for memory policy */
declare const WRITE_MODES: readonly ["append", "overwrite", "merge"];
type WriteMode = typeof WRITE_MODES[number];
/** Authority scopes for memory policy */
declare const AUTHORITY_SCOPES: readonly ["self", "team", "tenant", "global"];
type AuthorityScope = typeof AUTHORITY_SCOPES[number];
/** Trace levels for observability */
declare const TRACE_LEVELS: readonly ["none", "errors", "decisions", "full"];
/** Execution lanes ordered by privilege (lowest to highest) */
declare const LANES: readonly ["wasm", "sandboxed", "native"];
type Lane = typeof LANES[number];
/**
 * The manifest describing an agent cell per the Agentic Container spec.
 */
export interface AgentCellManifest {
    /** API version string (must be 'agentic_cells.v0_1') */
    apiVersion: string;
    /** Cell identity */
    cell: {
        name: string;
        purpose: string;
        ownerTenant: string;
        codeRef: {
            kind: string;
            digest: string;
            entry: string;
        };
    };
    /** Lane execution policy */
    lanePolicy: {
        portabilityRequired: boolean;
        needsNativeThreads: boolean;
        preferredLane: Lane;
        maxRiskScore: number;
    };
    /** Resource budgets */
    budgets: {
        maxWallClockSeconds: number;
        maxToolCalls: number;
        maxBytesEgress: number;
        maxTokensInMtok: number;
        maxTokensOutMtok: number;
        maxMemoryWrites: number;
    };
    /** Data handling policy */
    dataPolicy: {
        dataSensitivity: DataSensitivity;
        piiAllowed: boolean;
        retentionDays: number;
        exportControls: {
            allowedRegions: string[];
            blockedRegions: string[];
        };
    };
    /** Tool usage policy */
    toolPolicy: {
        toolsAllowed: string[];
        networkAllowlist: string[];
        writeActionsRequireConfirmation: boolean;
    };
    /** Memory system policy */
    memoryPolicy: {
        namespace: string;
        authorityScope: AuthorityScope;
        writeMode: WriteMode;
        requiresCoherenceGate: boolean;
        requiresAntiHallucinationGate: boolean;
    };
    /** Observability configuration */
    observability: {
        traceLevel: typeof TRACE_LEVELS[number];
        emitArtifacts: boolean;
        artifactBucket: string;
    };
}
/**
 * A single validation error or warning.
 */
export interface ValidationError {
    /** Error code (e.g., 'MISSING_FIELD', 'INVALID_DIGEST', 'BUDGET_EXCEED') */
    code: string;
    /** JSON path to the problematic field */
    field: string;
    /** Human-readable description */
    message: string;
    /** Severity level */
    severity: 'error';
}
/**
 * A single validation warning.
 */
export interface ValidationWarning {
    /** Warning code */
    code: string;
    /** JSON path to the problematic field */
    field: string;
    /** Human-readable description */
    message: string;
    /** Severity level */
    severity: 'warning';
}
/**
 * Complete validation result for a manifest.
 */
export interface ValidationResult {
    /** Whether the manifest passed all validation checks */
    valid: boolean;
    /** Validation errors (each causes rejection) */
    errors: ValidationError[];
    /** Validation warnings (informational, do not block admission) */
    warnings: ValidationWarning[];
    /** Admission decision: admit, reject, or review */
    admissionDecision: 'admit' | 'reject' | 'review';
    /** Selected execution lane (null if rejected) */
    laneSelection: Lane | null;
    /** Computed risk score (0-100) */
    riskScore: number;
}
/**
 * Validates AgentCellManifest documents against the Agentic Container spec.
 *
 * Fails closed: any validation error results in a 'reject' decision.
 * Warnings alone do not block admission but may trigger a 'review' decision
 * when the risk score is between thresholds.
 */
export declare class ManifestValidator {
    /** Risk score threshold: below this, admit. Above reject threshold, reject. Between, review. */
    private readonly admitThreshold;
    private readonly rejectThreshold;
    constructor(options?: {
        admitThreshold?: number;
        rejectThreshold?: number;
    });
    /**
     * Validate a manifest, compute its risk score, select a lane, and decide admission.
     *
     * FAILS CLOSED: any validation error leads to reject.
     */
    validate(manifest: AgentCellManifest): ValidationResult;
    /**
     * Compute a risk score (0-100) from tool risk, data sensitivity, and privilege surface.
     *
     * Components:
     * - tool_risk (0-40): based on tool types and network access
     * - data_sensitivity (0-30): based on sensitivity level and PII
     * - privilege_surface (0-30): based on memory scope, write mode, native threads
     */
    computeRiskScore(manifest: AgentCellManifest): number;
    /**
     * Select the execution lane based on risk score and manifest policy.
     *
     * Lane selection rules:
     * - If portabilityRequired or risk <= 30: wasm
     * - If needsNativeThreads and risk > 50: native
     * - Otherwise: sandboxed
     * - Always respect preferredLane if risk score allows it
     * - Risk exceeding maxRiskScore forces the most restrictive lane
     */
    selectLane(manifest: AgentCellManifest, riskScore: number): Lane;
    /**
     * Validate budget values: no negatives, within sanity limits.
     */
    validateBudgets(budgets: AgentCellManifest['budgets']): ValidationError[];
    /**
     * Validate tool policy: network allowlist must not contain wildcards
     * unless the cell explicitly has Bash (privileged).
     */
    validateToolPolicy(toolPolicy: AgentCellManifest['toolPolicy']): ValidationError[];
    /**
     * Validate data policy fields.
     */
    validateDataPolicy(dataPolicy: AgentCellManifest['dataPolicy']): ValidationError[];
    private validateRequiredFields;
    private validateApiVersion;
    private validateDigest;
    private validateWarnings;
}
/**
 * A single event within a golden trace.
 */
export interface GoldenTraceEvent {
    /** Sequence number within the trace */
    seq: number;
    /** Type of event (e.g., 'command', 'tool-use', 'memory-write', 'budget-check') */
    eventType: string;
    /** Event payload */
    payload: Record<string, unknown>;
    /** Expected outcome from the platform */
    expectedOutcome: 'allow' | 'deny' | 'warn';
}
/**
 * A complete golden trace including events and expected decisions.
 */
export interface GoldenTrace {
    /** Unique trace identifier */
    traceId: string;
    /** Human-readable name */
    name: string;
    /** Description of what the trace verifies */
    description: string;
    /** Ordered sequence of events */
    events: GoldenTraceEvent[];
    /** Map from event seq (as string) to expected decision string */
    expectedDecisions: Record<string, string>;
    /** Map from memory key to expected parent chain for lineage verification */
    expectedMemoryLineage: Record<string, string[]>;
}
/**
 * Result of running the conformance suite.
 */
export interface ConformanceResult {
    /** Whether all events matched their expected outcomes */
    passed: boolean;
    /** Total number of events evaluated */
    totalEvents: number;
    /** Number of events that matched expectations */
    matchedEvents: number;
    /** Details of any mismatches */
    mismatches: Array<{
        traceId: string;
        seq: number;
        expected: string;
        actual: string;
        details: unknown;
    }>;
}
/**
 * Runs golden traces through an evaluator and reports conformance.
 *
 * Each trace contains events with expected outcomes. The suite feeds every
 * event to the evaluator and compares the actual decision to the expectation.
 */
export declare class ConformanceSuite {
    private traces;
    /**
     * Add a golden trace to the suite.
     */
    addTrace(trace: GoldenTrace): void;
    /**
     * Run every event in every trace through the evaluator and compare
     * actual decisions against expected outcomes.
     */
    run(evaluator: (event: GoldenTraceEvent) => {
        decision: string;
        details: unknown;
    }): ConformanceResult;
    /**
     * Get all registered traces.
     */
    getTraces(): GoldenTrace[];
    /**
     * Create built-in default golden traces that verify core platform invariants:
     *
     * 1. Destructive command blocked
     * 2. Secret detected and blocked
     * 3. Budget exceeded and denied
     * 4. Memory write without evidence blocked
     * 5. Valid operation allowed
     */
    createDefaultTraces(): GoldenTrace[];
}
/**
 * Create a new ManifestValidator instance.
 */
export declare function createManifestValidator(options?: {
    admitThreshold?: number;
    rejectThreshold?: number;
}): ManifestValidator;
/**
 * Create a new ConformanceSuite instance, optionally pre-loaded with default traces.
 */
export declare function createConformanceSuite(options?: {
    includeDefaults?: boolean;
}): ConformanceSuite;
export {};
//# sourceMappingURL=manifest-validator.d.ts.map