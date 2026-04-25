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
// ============================================================================
// Constants
// ============================================================================
const SUPPORTED_API_VERSION = 'agentic_cells.v0_1';
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
/** Maximum budget limits (sanity caps) */
const MAX_BUDGET_LIMITS = {
    maxWallClockSeconds: 86_400, // 24 hours
    maxToolCalls: 100_000,
    maxBytesEgress: 10_737_418_240, // 10 GiB
    maxTokensInMtok: 100, // 100M tokens
    maxTokensOutMtok: 100, // 100M tokens
    maxMemoryWrites: 1_000_000,
};
/** Data sensitivity levels ordered by severity */
const DATA_SENSITIVITY_LEVELS = ['public', 'internal', 'confidential', 'restricted'];
/** Write modes for memory policy */
const WRITE_MODES = ['append', 'overwrite', 'merge'];
/** Authority scopes for memory policy */
const AUTHORITY_SCOPES = ['self', 'team', 'tenant', 'global'];
/** Known tool names the system recognizes */
const KNOWN_TOOLS = new Set([
    'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep',
    'Bash', 'Task', 'TodoWrite', 'NotebookEdit', 'WebFetch', 'WebSearch',
    'mcp_memory', 'mcp_swarm', 'mcp_hooks', 'mcp_agent',
]);
/** Trace levels for observability */
const TRACE_LEVELS = ['none', 'errors', 'decisions', 'full'];
/** Execution lanes ordered by privilege (lowest to highest) */
const LANES = ['wasm', 'sandboxed', 'native'];
// ============================================================================
// ManifestValidator
// ============================================================================
/**
 * Validates AgentCellManifest documents against the Agentic Container spec.
 *
 * Fails closed: any validation error results in a 'reject' decision.
 * Warnings alone do not block admission but may trigger a 'review' decision
 * when the risk score is between thresholds.
 */
export class ManifestValidator {
    /** Risk score threshold: below this, admit. Above reject threshold, reject. Between, review. */
    admitThreshold;
    rejectThreshold;
    constructor(options) {
        this.admitThreshold = options?.admitThreshold ?? 30;
        this.rejectThreshold = options?.rejectThreshold ?? 70;
    }
    /**
     * Validate a manifest, compute its risk score, select a lane, and decide admission.
     *
     * FAILS CLOSED: any validation error leads to reject.
     */
    validate(manifest) {
        const errors = [];
        const warnings = [];
        // Structural validation
        errors.push(...this.validateRequiredFields(manifest));
        errors.push(...this.validateApiVersion(manifest));
        errors.push(...this.validateDigest(manifest));
        errors.push(...this.validateBudgets(manifest.budgets));
        errors.push(...this.validateToolPolicy(manifest.toolPolicy));
        errors.push(...this.validateDataPolicy(manifest.dataPolicy));
        warnings.push(...this.validateWarnings(manifest));
        // Compute risk score (even if there are errors, for diagnostics)
        const riskScore = this.computeRiskScore(manifest);
        // FAIL CLOSED: any error means reject
        if (errors.length > 0) {
            return {
                valid: false,
                errors,
                warnings,
                admissionDecision: 'reject',
                laneSelection: null,
                riskScore,
            };
        }
        // Lane selection
        const laneSelection = this.selectLane(manifest, riskScore);
        // Admission decision based on risk score
        let admissionDecision;
        if (riskScore > this.rejectThreshold) {
            admissionDecision = 'reject';
        }
        else if (riskScore > this.admitThreshold) {
            admissionDecision = 'review';
        }
        else {
            admissionDecision = 'admit';
        }
        return {
            valid: true,
            errors,
            warnings,
            admissionDecision,
            laneSelection,
            riskScore,
        };
    }
    /**
     * Compute a risk score (0-100) from tool risk, data sensitivity, and privilege surface.
     *
     * Components:
     * - tool_risk (0-40): based on tool types and network access
     * - data_sensitivity (0-30): based on sensitivity level and PII
     * - privilege_surface (0-30): based on memory scope, write mode, native threads
     */
    computeRiskScore(manifest) {
        let toolRisk = 0;
        let dataSensitivity = 0;
        let privilegeSurface = 0;
        // --- Tool risk (0-40) ---
        const tools = manifest.toolPolicy?.toolsAllowed ?? [];
        const networkList = manifest.toolPolicy?.networkAllowlist ?? [];
        // Bash/command execution is high risk
        if (tools.includes('Bash') || tools.includes('bash')) {
            toolRisk += 15;
        }
        // Task spawning
        if (tools.includes('Task') || tools.includes('task')) {
            toolRisk += 8;
        }
        // Write operations
        if (tools.some(t => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(t))) {
            toolRisk += 5;
        }
        // MCP tools
        if (tools.some(t => t.startsWith('mcp_'))) {
            toolRisk += 5;
        }
        // Network access
        if (networkList.length > 0) {
            toolRisk += 5;
        }
        // Wildcard in network (already caught as error if not privileged, but score anyway)
        if (networkList.some(h => h === '*' || h.startsWith('*.'))) {
            toolRisk += 10;
        }
        // No confirmation on writes
        if (manifest.toolPolicy && !manifest.toolPolicy.writeActionsRequireConfirmation) {
            toolRisk += 3;
        }
        toolRisk = Math.min(toolRisk, 40);
        // --- Data sensitivity (0-30) ---
        const sensitivityIndex = DATA_SENSITIVITY_LEVELS.indexOf(manifest.dataPolicy?.dataSensitivity);
        if (sensitivityIndex >= 0) {
            dataSensitivity += sensitivityIndex * 8; // 0, 8, 16, 24
        }
        if (manifest.dataPolicy?.piiAllowed) {
            dataSensitivity += 6;
        }
        dataSensitivity = Math.min(dataSensitivity, 30);
        // --- Privilege surface (0-30) ---
        const scopeIndex = AUTHORITY_SCOPES.indexOf(manifest.memoryPolicy?.authorityScope);
        if (scopeIndex >= 0) {
            privilegeSurface += scopeIndex * 5; // 0, 5, 10, 15
        }
        if (manifest.memoryPolicy?.writeMode === 'overwrite') {
            privilegeSurface += 5;
        }
        if (manifest.lanePolicy?.needsNativeThreads) {
            privilegeSurface += 8;
        }
        if (manifest.memoryPolicy && !manifest.memoryPolicy.requiresCoherenceGate) {
            privilegeSurface += 3;
        }
        if (manifest.memoryPolicy && !manifest.memoryPolicy.requiresAntiHallucinationGate) {
            privilegeSurface += 3;
        }
        privilegeSurface = Math.min(privilegeSurface, 30);
        return Math.min(toolRisk + dataSensitivity + privilegeSurface, 100);
    }
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
    selectLane(manifest, riskScore) {
        const policy = manifest.lanePolicy;
        // If risk exceeds the manifest's own maxRiskScore, force wasm
        if (riskScore > policy.maxRiskScore) {
            return 'wasm';
        }
        // Portability requirement forces wasm
        if (policy.portabilityRequired) {
            return 'wasm';
        }
        // Native threads require native lane
        if (policy.needsNativeThreads) {
            // Only grant native if risk is acceptable
            if (riskScore <= 50) {
                return 'native';
            }
            return 'sandboxed';
        }
        // Low risk can go to wasm
        if (riskScore <= 20) {
            return policy.preferredLane;
        }
        // Medium risk gets sandboxed
        if (riskScore <= 50) {
            // Respect preference if it's not native
            if (policy.preferredLane !== 'native') {
                return policy.preferredLane;
            }
            return 'sandboxed';
        }
        // High risk gets wasm
        return 'wasm';
    }
    /**
     * Validate budget values: no negatives, within sanity limits.
     */
    validateBudgets(budgets) {
        const errors = [];
        if (!budgets) {
            errors.push({
                code: 'MISSING_FIELD',
                field: 'budgets',
                message: 'Budget configuration is required',
                severity: 'error',
            });
            return errors;
        }
        const budgetFields = [
            { key: 'maxWallClockSeconds', max: MAX_BUDGET_LIMITS.maxWallClockSeconds },
            { key: 'maxToolCalls', max: MAX_BUDGET_LIMITS.maxToolCalls },
            { key: 'maxBytesEgress', max: MAX_BUDGET_LIMITS.maxBytesEgress },
            { key: 'maxTokensInMtok', max: MAX_BUDGET_LIMITS.maxTokensInMtok },
            { key: 'maxTokensOutMtok', max: MAX_BUDGET_LIMITS.maxTokensOutMtok },
            { key: 'maxMemoryWrites', max: MAX_BUDGET_LIMITS.maxMemoryWrites },
        ];
        for (const { key, max } of budgetFields) {
            const value = budgets[key];
            if (value === undefined || value === null) {
                errors.push({
                    code: 'MISSING_FIELD',
                    field: `budgets.${key}`,
                    message: `Budget field "${key}" is required`,
                    severity: 'error',
                });
                continue;
            }
            if (typeof value !== 'number' || Number.isNaN(value)) {
                errors.push({
                    code: 'INVALID_TYPE',
                    field: `budgets.${key}`,
                    message: `Budget field "${key}" must be a number`,
                    severity: 'error',
                });
                continue;
            }
            if (value < 0) {
                errors.push({
                    code: 'BUDGET_NEGATIVE',
                    field: `budgets.${key}`,
                    message: `Budget field "${key}" must not be negative (got ${value})`,
                    severity: 'error',
                });
            }
            if (value > max) {
                errors.push({
                    code: 'BUDGET_EXCEED',
                    field: `budgets.${key}`,
                    message: `Budget field "${key}" exceeds maximum (${value} > ${max})`,
                    severity: 'error',
                });
            }
        }
        return errors;
    }
    /**
     * Validate tool policy: network allowlist must not contain wildcards
     * unless the cell explicitly has Bash (privileged).
     */
    validateToolPolicy(toolPolicy) {
        const errors = [];
        if (!toolPolicy) {
            errors.push({
                code: 'MISSING_FIELD',
                field: 'toolPolicy',
                message: 'Tool policy is required',
                severity: 'error',
            });
            return errors;
        }
        if (!Array.isArray(toolPolicy.toolsAllowed)) {
            errors.push({
                code: 'INVALID_TYPE',
                field: 'toolPolicy.toolsAllowed',
                message: 'toolsAllowed must be an array',
                severity: 'error',
            });
        }
        if (!Array.isArray(toolPolicy.networkAllowlist)) {
            errors.push({
                code: 'INVALID_TYPE',
                field: 'toolPolicy.networkAllowlist',
                message: 'networkAllowlist must be an array',
                severity: 'error',
            });
        }
        // Check for wildcards in network allowlist
        const isPrivileged = Array.isArray(toolPolicy.toolsAllowed) &&
            toolPolicy.toolsAllowed.includes('Bash');
        if (Array.isArray(toolPolicy.networkAllowlist)) {
            for (let i = 0; i < toolPolicy.networkAllowlist.length; i++) {
                const entry = toolPolicy.networkAllowlist[i];
                if (entry === '*' || entry.startsWith('*.')) {
                    if (!isPrivileged) {
                        errors.push({
                            code: 'WILDCARD_NETWORK',
                            field: `toolPolicy.networkAllowlist[${i}]`,
                            message: `Wildcard "${entry}" in network allowlist requires privileged access (Bash tool)`,
                            severity: 'error',
                        });
                    }
                }
            }
        }
        return errors;
    }
    /**
     * Validate data policy fields.
     */
    validateDataPolicy(dataPolicy) {
        const errors = [];
        if (!dataPolicy) {
            errors.push({
                code: 'MISSING_FIELD',
                field: 'dataPolicy',
                message: 'Data policy is required',
                severity: 'error',
            });
            return errors;
        }
        if (!DATA_SENSITIVITY_LEVELS.includes(dataPolicy.dataSensitivity)) {
            errors.push({
                code: 'INVALID_ENUM',
                field: 'dataPolicy.dataSensitivity',
                message: `dataSensitivity must be one of: ${DATA_SENSITIVITY_LEVELS.join(', ')} (got "${dataPolicy.dataSensitivity}")`,
                severity: 'error',
            });
        }
        if (typeof dataPolicy.retentionDays !== 'number' || dataPolicy.retentionDays < 0) {
            errors.push({
                code: 'INVALID_VALUE',
                field: 'dataPolicy.retentionDays',
                message: 'retentionDays must be a non-negative number',
                severity: 'error',
            });
        }
        if (!dataPolicy.exportControls) {
            errors.push({
                code: 'MISSING_FIELD',
                field: 'dataPolicy.exportControls',
                message: 'exportControls is required in data policy',
                severity: 'error',
            });
        }
        else {
            if (!Array.isArray(dataPolicy.exportControls.allowedRegions)) {
                errors.push({
                    code: 'INVALID_TYPE',
                    field: 'dataPolicy.exportControls.allowedRegions',
                    message: 'allowedRegions must be an array',
                    severity: 'error',
                });
            }
            if (!Array.isArray(dataPolicy.exportControls.blockedRegions)) {
                errors.push({
                    code: 'INVALID_TYPE',
                    field: 'dataPolicy.exportControls.blockedRegions',
                    message: 'blockedRegions must be an array',
                    severity: 'error',
                });
            }
            // Check for overlap between allowed and blocked regions
            if (Array.isArray(dataPolicy.exportControls.allowedRegions) &&
                Array.isArray(dataPolicy.exportControls.blockedRegions)) {
                const overlap = dataPolicy.exportControls.allowedRegions.filter(r => dataPolicy.exportControls.blockedRegions.includes(r));
                if (overlap.length > 0) {
                    errors.push({
                        code: 'REGION_CONFLICT',
                        field: 'dataPolicy.exportControls',
                        message: `Regions appear in both allowed and blocked lists: ${overlap.join(', ')}`,
                        severity: 'error',
                    });
                }
            }
        }
        return errors;
    }
    // ===== Private validation helpers =====
    validateRequiredFields(manifest) {
        const errors = [];
        if (!manifest) {
            errors.push({
                code: 'MISSING_FIELD',
                field: '',
                message: 'Manifest is required',
                severity: 'error',
            });
            return errors;
        }
        // Top-level required sections
        const requiredSections = [
            'apiVersion', 'cell', 'lanePolicy', 'budgets',
            'dataPolicy', 'toolPolicy', 'memoryPolicy', 'observability',
        ];
        for (const section of requiredSections) {
            if (manifest[section] === undefined || manifest[section] === null) {
                errors.push({
                    code: 'MISSING_FIELD',
                    field: section,
                    message: `Required field "${section}" is missing`,
                    severity: 'error',
                });
            }
        }
        // Cell sub-fields
        if (manifest.cell) {
            for (const field of ['name', 'purpose', 'ownerTenant']) {
                if (!manifest.cell[field]) {
                    errors.push({
                        code: 'MISSING_FIELD',
                        field: `cell.${field}`,
                        message: `Required field "cell.${field}" is missing`,
                        severity: 'error',
                    });
                }
            }
            if (!manifest.cell.codeRef) {
                errors.push({
                    code: 'MISSING_FIELD',
                    field: 'cell.codeRef',
                    message: 'Required field "cell.codeRef" is missing',
                    severity: 'error',
                });
            }
            else {
                for (const field of ['kind', 'digest', 'entry']) {
                    if (!manifest.cell.codeRef[field]) {
                        errors.push({
                            code: 'MISSING_FIELD',
                            field: `cell.codeRef.${field}`,
                            message: `Required field "cell.codeRef.${field}" is missing`,
                            severity: 'error',
                        });
                    }
                }
            }
        }
        // Memory policy sub-fields
        if (manifest.memoryPolicy) {
            if (!manifest.memoryPolicy.namespace) {
                errors.push({
                    code: 'MISSING_FIELD',
                    field: 'memoryPolicy.namespace',
                    message: 'Required field "memoryPolicy.namespace" is missing',
                    severity: 'error',
                });
            }
            if (!AUTHORITY_SCOPES.includes(manifest.memoryPolicy.authorityScope)) {
                errors.push({
                    code: 'INVALID_ENUM',
                    field: 'memoryPolicy.authorityScope',
                    message: `authorityScope must be one of: ${AUTHORITY_SCOPES.join(', ')}`,
                    severity: 'error',
                });
            }
            if (!WRITE_MODES.includes(manifest.memoryPolicy.writeMode)) {
                errors.push({
                    code: 'INVALID_ENUM',
                    field: 'memoryPolicy.writeMode',
                    message: `writeMode must be one of: ${WRITE_MODES.join(', ')}`,
                    severity: 'error',
                });
            }
        }
        // Observability sub-fields
        if (manifest.observability) {
            if (!TRACE_LEVELS.includes(manifest.observability.traceLevel)) {
                errors.push({
                    code: 'INVALID_ENUM',
                    field: 'observability.traceLevel',
                    message: `traceLevel must be one of: ${TRACE_LEVELS.join(', ')}`,
                    severity: 'error',
                });
            }
        }
        return errors;
    }
    validateApiVersion(manifest) {
        if (!manifest.apiVersion)
            return []; // caught by requiredFields
        if (manifest.apiVersion !== SUPPORTED_API_VERSION) {
            return [{
                    code: 'UNSUPPORTED_API_VERSION',
                    field: 'apiVersion',
                    message: `API version "${manifest.apiVersion}" is not supported (expected "${SUPPORTED_API_VERSION}")`,
                    severity: 'error',
                }];
        }
        return [];
    }
    validateDigest(manifest) {
        if (!manifest.cell?.codeRef?.digest)
            return []; // caught by requiredFields
        if (!SHA256_DIGEST_RE.test(manifest.cell.codeRef.digest)) {
            return [{
                    code: 'INVALID_DIGEST',
                    field: 'cell.codeRef.digest',
                    message: `Digest must match "sha256:<64 hex chars>" format (got "${manifest.cell.codeRef.digest}")`,
                    severity: 'error',
                }];
        }
        return [];
    }
    validateWarnings(manifest) {
        const warnings = [];
        // Warn about unknown tools
        if (manifest.toolPolicy?.toolsAllowed) {
            for (const tool of manifest.toolPolicy.toolsAllowed) {
                if (!KNOWN_TOOLS.has(tool)) {
                    warnings.push({
                        code: 'UNKNOWN_TOOL',
                        field: 'toolPolicy.toolsAllowed',
                        message: `Tool "${tool}" is not a recognized system tool`,
                        severity: 'warning',
                    });
                }
            }
        }
        // Warn if both coherence and anti-hallucination gates are disabled
        if (manifest.memoryPolicy &&
            !manifest.memoryPolicy.requiresCoherenceGate &&
            !manifest.memoryPolicy.requiresAntiHallucinationGate) {
            warnings.push({
                code: 'NO_MEMORY_GATES',
                field: 'memoryPolicy',
                message: 'Both coherence and anti-hallucination gates are disabled; memory writes are ungated',
                severity: 'warning',
            });
        }
        // Warn about high retention with sensitive data
        if (manifest.dataPolicy &&
            manifest.dataPolicy.dataSensitivity === 'restricted' &&
            manifest.dataPolicy.retentionDays > 30) {
            warnings.push({
                code: 'HIGH_RETENTION_SENSITIVE',
                field: 'dataPolicy.retentionDays',
                message: `Retention of ${manifest.dataPolicy.retentionDays} days is high for restricted data`,
                severity: 'warning',
            });
        }
        // Warn if no trace level is set to full but artifacts are emitted
        if (manifest.observability &&
            manifest.observability.emitArtifacts &&
            manifest.observability.traceLevel === 'none') {
            warnings.push({
                code: 'ARTIFACTS_WITHOUT_TRACING',
                field: 'observability',
                message: 'Artifact emission is enabled but trace level is "none"',
                severity: 'warning',
            });
        }
        return warnings;
    }
}
// ============================================================================
// ConformanceSuite
// ============================================================================
/**
 * Runs golden traces through an evaluator and reports conformance.
 *
 * Each trace contains events with expected outcomes. The suite feeds every
 * event to the evaluator and compares the actual decision to the expectation.
 */
export class ConformanceSuite {
    traces = [];
    /**
     * Add a golden trace to the suite.
     */
    addTrace(trace) {
        this.traces.push(trace);
    }
    /**
     * Run every event in every trace through the evaluator and compare
     * actual decisions against expected outcomes.
     */
    run(evaluator) {
        let totalEvents = 0;
        let matchedEvents = 0;
        const mismatches = [];
        for (const trace of this.traces) {
            for (const event of trace.events) {
                totalEvents++;
                const { decision, details } = evaluator(event);
                const expected = trace.expectedDecisions[String(event.seq)] ?? event.expectedOutcome;
                if (decision === expected) {
                    matchedEvents++;
                }
                else {
                    mismatches.push({
                        traceId: trace.traceId,
                        seq: event.seq,
                        expected,
                        actual: decision,
                        details,
                    });
                }
            }
        }
        return {
            passed: mismatches.length === 0,
            totalEvents,
            matchedEvents,
            mismatches,
        };
    }
    /**
     * Get all registered traces.
     */
    getTraces() {
        return [...this.traces];
    }
    /**
     * Create built-in default golden traces that verify core platform invariants:
     *
     * 1. Destructive command blocked
     * 2. Secret detected and blocked
     * 3. Budget exceeded and denied
     * 4. Memory write without evidence blocked
     * 5. Valid operation allowed
     */
    createDefaultTraces() {
        const traces = [
            // Trace 1: Destructive command must be blocked
            {
                traceId: 'default-destructive-blocked',
                name: 'Destructive command blocked',
                description: 'Verifies that destructive commands (rm -rf, DROP TABLE) are denied',
                events: [
                    {
                        seq: 1,
                        eventType: 'command',
                        payload: { command: 'rm -rf /', tool: 'Bash' },
                        expectedOutcome: 'deny',
                    },
                    {
                        seq: 2,
                        eventType: 'command',
                        payload: { command: 'DROP TABLE users', tool: 'Bash' },
                        expectedOutcome: 'deny',
                    },
                    {
                        seq: 3,
                        eventType: 'command',
                        payload: { command: 'git push --force origin main', tool: 'Bash' },
                        expectedOutcome: 'deny',
                    },
                ],
                expectedDecisions: { '1': 'deny', '2': 'deny', '3': 'deny' },
                expectedMemoryLineage: {},
            },
            // Trace 2: Secret detected and blocked
            {
                traceId: 'default-secret-blocked',
                name: 'Secret detected and blocked',
                description: 'Verifies that secrets in tool parameters are detected and blocked',
                events: [
                    {
                        seq: 1,
                        eventType: 'tool-use',
                        payload: {
                            tool: 'Write',
                            params: { content: 'api_key = "sk-abc123456789012345678901234567890"' },
                        },
                        expectedOutcome: 'deny',
                    },
                    {
                        seq: 2,
                        eventType: 'tool-use',
                        payload: {
                            tool: 'Edit',
                            params: { content: '-----BEGIN RSA PRIVATE KEY-----' },
                        },
                        expectedOutcome: 'deny',
                    },
                ],
                expectedDecisions: { '1': 'deny', '2': 'deny' },
                expectedMemoryLineage: {},
            },
            // Trace 3: Budget exceeded and denied
            {
                traceId: 'default-budget-exceeded',
                name: 'Budget exceeded and denied',
                description: 'Verifies that operations exceeding budget limits are denied',
                events: [
                    {
                        seq: 1,
                        eventType: 'budget-check',
                        payload: {
                            resource: 'toolCalls',
                            current: 999,
                            limit: 1000,
                            requested: 5,
                        },
                        expectedOutcome: 'deny',
                    },
                    {
                        seq: 2,
                        eventType: 'budget-check',
                        payload: {
                            resource: 'wallClockSeconds',
                            current: 3500,
                            limit: 3600,
                            requested: 200,
                        },
                        expectedOutcome: 'deny',
                    },
                ],
                expectedDecisions: { '1': 'deny', '2': 'deny' },
                expectedMemoryLineage: {},
            },
            // Trace 4: Memory write without evidence blocked
            {
                traceId: 'default-memory-no-evidence',
                name: 'Memory write without evidence blocked',
                description: 'Verifies that memory writes without proof/evidence trail are denied',
                events: [
                    {
                        seq: 1,
                        eventType: 'memory-write',
                        payload: {
                            key: 'critical-decision',
                            namespace: 'coordination',
                            hasEvidence: false,
                            coherenceScore: 0.3,
                        },
                        expectedOutcome: 'deny',
                    },
                    {
                        seq: 2,
                        eventType: 'memory-write',
                        payload: {
                            key: 'hallucinated-data',
                            namespace: 'facts',
                            hasEvidence: false,
                            antiHallucinationPassed: false,
                        },
                        expectedOutcome: 'deny',
                    },
                ],
                expectedDecisions: { '1': 'deny', '2': 'deny' },
                expectedMemoryLineage: {
                    'critical-decision': ['initial-assessment', 'root-task'],
                },
            },
            // Trace 5: Valid operation allowed
            {
                traceId: 'default-valid-allowed',
                name: 'Valid operation allowed',
                description: 'Verifies that well-formed, safe operations are allowed through',
                events: [
                    {
                        seq: 1,
                        eventType: 'command',
                        payload: { command: 'git status', tool: 'Bash' },
                        expectedOutcome: 'allow',
                    },
                    {
                        seq: 2,
                        eventType: 'tool-use',
                        payload: {
                            tool: 'Read',
                            params: { file_path: '/home/user/project/src/index.ts' },
                        },
                        expectedOutcome: 'allow',
                    },
                    {
                        seq: 3,
                        eventType: 'memory-write',
                        payload: {
                            key: 'agent-status',
                            namespace: 'coordination',
                            hasEvidence: true,
                            coherenceScore: 0.95,
                            antiHallucinationPassed: true,
                        },
                        expectedOutcome: 'allow',
                    },
                ],
                expectedDecisions: { '1': 'allow', '2': 'allow', '3': 'allow' },
                expectedMemoryLineage: {},
            },
        ];
        return traces;
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a new ManifestValidator instance.
 */
export function createManifestValidator(options) {
    return new ManifestValidator(options);
}
/**
 * Create a new ConformanceSuite instance, optionally pre-loaded with default traces.
 */
export function createConformanceSuite(options) {
    const suite = new ConformanceSuite();
    if (options?.includeDefaults) {
        for (const trace of suite.createDefaultTraces()) {
            suite.addTrace(trace);
        }
    }
    return suite;
}
//# sourceMappingURL=manifest-validator.js.map