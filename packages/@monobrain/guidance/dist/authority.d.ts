/**
 * Human Authority Gate + Irreversibility Classification
 *
 * Provides typed boundaries between agent, human, and institutional authority,
 * along with irreversibility classification for actions that require elevated
 * proof and pre-commit simulation.
 *
 * AuthorityGate:
 * - Defines authority levels (agent, human, institutional, regulatory)
 * - Maintains a registry of authority scopes and permissions
 * - Checks if a given authority level can perform an action
 * - Determines if escalation is required
 * - Records signed human interventions for audit trails
 *
 * IrreversibilityClassifier:
 * - Classifies actions as reversible, costly-reversible, or irreversible
 * - Uses configurable pattern matching (regex arrays)
 * - Determines required proof levels (standard, elevated, maximum)
 * - Identifies actions requiring pre-commit simulation
 *
 * Human interventions are cryptographically signed using HMAC-SHA256 to
 * create an immutable audit trail of override decisions.
 *
 * @module @monobrain/guidance/authority
 */
/**
 * Authority levels in the decision hierarchy.
 *
 * - 'agent': Autonomous agent decisions
 * - 'human': Human operator approval required
 * - 'institutional': Organizational policy/compliance required
 * - 'regulatory': External regulatory approval required
 */
export type AuthorityLevel = 'agent' | 'human' | 'institutional' | 'regulatory';
/**
 * Classification of action reversibility.
 *
 * - 'reversible': Can be undone easily with no or minimal cost
 * - 'costly-reversible': Can be undone but with significant cost/effort
 * - 'irreversible': Cannot be undone once executed
 */
export type IrreversibilityClass = 'reversible' | 'costly-reversible' | 'irreversible';
/**
 * Required proof level based on action irreversibility.
 *
 * - 'standard': Normal verification (reversible actions)
 * - 'elevated': Enhanced verification (costly-reversible actions)
 * - 'maximum': Maximum verification (irreversible actions)
 */
export type ProofLevel = 'standard' | 'elevated' | 'maximum';
/**
 * Defines the scope of authority for a given level.
 */
export interface AuthorityScope {
    /** The authority level this scope applies to */
    level: AuthorityLevel;
    /** Actions this authority level is permitted to perform */
    permissions: string[];
    /** Actions this level can override from lower levels */
    overrideScope: string[];
    /** Whether this level requires escalation to a higher level */
    escalationRequired: boolean;
}
/**
 * Record of a human intervention/override decision.
 */
export interface HumanIntervention {
    /** Unique identifier for this intervention */
    id: string;
    /** Unix timestamp (ms) when the intervention occurred */
    timestamp: number;
    /** Authority level that performed the intervention */
    authorityLevel: AuthorityLevel;
    /** The action that was authorized or denied */
    action: string;
    /** Human-readable reason for the intervention */
    reason: string;
    /** Identifier of the person/entity who signed off */
    signedBy: string;
    /** HMAC-SHA256 signature for integrity verification */
    signature: string;
    /** Additional context or metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Result of an authority check.
 */
export interface AuthorityCheckResult {
    /** Whether the action is allowed at the current authority level */
    allowed: boolean;
    /** The minimum authority level required for this action */
    requiredLevel: AuthorityLevel;
    /** The authority level being checked */
    currentLevel: AuthorityLevel;
    /** Human-readable explanation of the decision */
    reason: string;
}
/**
 * Result of an irreversibility classification.
 */
export interface IrreversibilityResult {
    /** The classification of the action */
    classification: IrreversibilityClass;
    /** Patterns that matched this action */
    matchedPatterns: string[];
    /** Required proof level for this action */
    requiredProofLevel: ProofLevel;
    /** Whether pre-commit simulation is required */
    requiresSimulation: boolean;
}
/**
 * Configuration for the AuthorityGate.
 */
export interface AuthorityGateConfig {
    /** Authority scopes to register (defaults provided if not specified) */
    scopes?: AuthorityScope[];
    /** Secret key for HMAC signing (generated if not provided) */
    signatureSecret?: string;
}
/**
 * Configuration for the IrreversibilityClassifier.
 */
export interface IrreversibilityClassifierConfig {
    /** Patterns for irreversible actions (regex strings) */
    irreversiblePatterns?: string[];
    /** Patterns for costly-reversible actions (regex strings) */
    costlyReversiblePatterns?: string[];
    /** Patterns for reversible actions (regex strings) */
    reversiblePatterns?: string[];
}
/**
 * Gate that enforces authority boundaries and records human interventions.
 *
 * Maintains a registry of authority scopes, checks permissions, determines
 * escalation requirements, and creates cryptographically signed intervention
 * records for audit trails.
 */
export declare class AuthorityGate {
    private readonly scopes;
    private readonly interventions;
    private readonly signatureSecret;
    constructor(config?: AuthorityGateConfig);
    /**
     * Check if a given authority level can perform an action.
     *
     * Returns a result indicating whether the action is allowed, the required
     * authority level, and a human-readable explanation.
     */
    canPerform(level: AuthorityLevel, action: string): AuthorityCheckResult;
    /**
     * Check if an action requires escalation from the current authority level.
     */
    requiresEscalation(level: AuthorityLevel, action: string): boolean;
    /**
     * Get the minimum authority level required to perform an action.
     *
     * Returns the lowest authority level that has permission for this action.
     * If no level has permission, returns 'regulatory' as the highest level.
     */
    getMinimumAuthority(action: string): AuthorityLevel;
    /**
     * Record a human intervention with cryptographic signature.
     *
     * Creates an immutable audit record of the intervention decision.
     * The signature is computed using HMAC-SHA256 over the intervention details.
     */
    recordIntervention(intervention: Omit<HumanIntervention, 'id' | 'signature'>): HumanIntervention;
    /**
     * Get all recorded interventions.
     */
    getInterventions(): HumanIntervention[];
    /**
     * Get interventions for a specific action.
     */
    getInterventionsForAction(action: string): HumanIntervention[];
    /**
     * Get interventions by authority level.
     */
    getInterventionsByLevel(level: AuthorityLevel): HumanIntervention[];
    /**
     * Verify the signature of an intervention.
     */
    verifyIntervention(intervention: HumanIntervention): boolean;
    /**
     * Get the number of recorded interventions.
     */
    get interventionCount(): number;
    /**
     * Get all registered authority levels.
     */
    getAuthorityLevels(): AuthorityLevel[];
    /**
     * Get the scope for a specific authority level.
     */
    getScope(level: AuthorityLevel): AuthorityScope | undefined;
    /**
     * Add or update an authority scope.
     */
    registerScope(scope: AuthorityScope): void;
    /**
     * Check if a scope has permission for an action.
     *
     * Uses exact match and pattern matching (with wildcards).
     */
    private hasPermission;
    /**
     * Check if an action matches a permission pattern.
     *
     * Supports simple wildcard patterns (e.g., "deploy_*").
     */
    private matchesPattern;
    /**
     * Sign an intervention using HMAC-SHA256.
     */
    private signIntervention;
}
/**
 * Classifies actions by their reversibility to determine required proof levels
 * and whether pre-commit simulation is needed.
 *
 * Uses configurable regex patterns to identify irreversible, costly-reversible,
 * and reversible actions. Irreversible actions require maximum proof and
 * pre-commit simulation.
 */
export declare class IrreversibilityClassifier {
    private readonly irreversiblePatterns;
    private readonly costlyReversiblePatterns;
    private readonly reversiblePatterns;
    constructor(config?: IrreversibilityClassifierConfig);
    /**
     * Classify an action by its reversibility.
     *
     * Checks patterns in order: irreversible → costly-reversible → reversible.
     * If no patterns match, defaults to 'costly-reversible' as a safe default.
     */
    classify(action: string): IrreversibilityResult;
    /**
     * Get the required proof level for an action.
     *
     * - 'maximum' for irreversible actions
     * - 'elevated' for costly-reversible actions
     * - 'standard' for reversible actions
     */
    getRequiredProofLevel(action: string): ProofLevel;
    /**
     * Check if an action requires pre-commit simulation.
     *
     * Returns true for irreversible and costly-reversible actions.
     */
    requiresPreCommitSimulation(action: string): boolean;
    /**
     * Get all configured patterns for a classification.
     */
    getPatterns(classification: IrreversibilityClass): string[];
    /**
     * Add a pattern to a classification.
     *
     * Validates the pattern against ReDoS heuristics before accepting it.
     * Rejects patterns with nested quantifiers (e.g., `(a+)+`) that can
     * cause catastrophic backtracking.
     *
     * @throws Error if the pattern is invalid regex or contains ReDoS-prone constructs
     */
    addPattern(classification: IrreversibilityClass, pattern: string): void;
    /**
     * Find all patterns that match an action.
     */
    private findMatches;
}
/**
 * Create an AuthorityGate with optional configuration.
 */
export declare function createAuthorityGate(config?: AuthorityGateConfig): AuthorityGate;
/**
 * Create an IrreversibilityClassifier with optional configuration.
 */
export declare function createIrreversibilityClassifier(config?: IrreversibilityClassifierConfig): IrreversibilityClassifier;
/**
 * Check if one authority level is higher than another.
 */
export declare function isHigherAuthority(level1: AuthorityLevel, level2: AuthorityLevel): boolean;
/**
 * Get the next higher authority level, if any.
 */
export declare function getNextHigherAuthority(level: AuthorityLevel): AuthorityLevel | null;
/**
 * Get the authority hierarchy as an ordered array.
 */
export declare function getAuthorityHierarchy(): AuthorityLevel[];
//# sourceMappingURL=authority.d.ts.map