/**
 * @fileoverview Meta-Governance Module
 *
 * Provides constitutional governance over the governance system itself.
 * Manages invariants, amendments, and optimizer constraints to prevent
 * governance drift and ensure constitutional stability.
 *
 * Features:
 * - Constitutional invariants with severity levels
 * - Amendment proposal and voting system
 * - Optimizer action validation
 * - Rate limiting and supermajority requirements
 * - Built-in constitutional protections
 *
 * Core capabilities:
 * - Constitutional invariant checking
 * - Amendment lifecycle (propose → vote → resolve → enact)
 * - Optimizer constraint enforcement
 * - Supermajority voting
 * - Emergency veto power
 * - Immutability protection
 *
 * @module @monobrain/guidance/meta-governance
 * @author Monobrain Team
 */
/**
 * Result of checking a constitutional invariant
 */
export interface InvariantCheckResult {
    /** Whether the invariant holds */
    holds: boolean;
    /** Description of violation if invariant does not hold */
    violation?: string;
    /** Additional details about the check */
    details?: Record<string, unknown>;
}
/**
 * Current state of the governance system for invariant checking
 */
export interface GovernanceState {
    /** Number of active governance rules */
    ruleCount: number;
    /** Size of constitution in lines */
    constitutionSize: number;
    /** Number of active gates */
    gateCount: number;
    /** Whether optimizer is enabled */
    optimizerEnabled: boolean;
    /** Number of active agents */
    activeAgentCount: number;
    /** Timestamp of last amendment */
    lastAmendmentTimestamp: number;
    /** Additional state metadata */
    metadata: Record<string, unknown>;
}
/**
 * Constitutional invariant that must hold
 */
export interface ConstitutionalInvariant {
    /** Unique identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of the invariant */
    description: string;
    /** Function to check if invariant holds */
    check: (state: GovernanceState) => InvariantCheckResult;
    /** Severity level */
    severity: 'critical' | 'warning';
    /** Whether this invariant can be removed */
    immutable: boolean;
}
/**
 * A specific change within an amendment
 */
export interface AmendmentChange {
    /** Type of change */
    type: 'add-rule' | 'remove-rule' | 'modify-rule' | 'adjust-threshold' | 'add-gate' | 'remove-gate';
    /** Target of the change (rule ID, gate ID, etc.) */
    target: string;
    /** State before the change (for modify operations) */
    before?: string;
    /** State after the change */
    after?: string;
}
/**
 * Amendment to the governance system
 */
export interface Amendment {
    /** Unique identifier */
    id: string;
    /** Agent or entity that proposed the amendment */
    proposedBy: string;
    /** Description of the amendment */
    description: string;
    /** Specific changes in the amendment */
    changes: AmendmentChange[];
    /** When the amendment was proposed */
    timestamp: number;
    /** Current status */
    status: 'proposed' | 'approved' | 'rejected' | 'enacted' | 'vetoed';
    /** Votes for/against (voterId → approve) */
    votes: Map<string, boolean>;
    /** Number of approvals required to pass */
    requiredApprovals: number;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Constraints on optimizer behavior
 */
export interface OptimizerConstraint {
    /** Unique identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of the constraint */
    description: string;
    /** Maximum governance drift per optimization cycle (0-1) */
    maxDriftPerCycle: number;
    /** Maximum rules promoted per cycle */
    maxPromotionRate: number;
    /** Maximum rules demoted per cycle */
    maxDemotionRate: number;
    /** Cooldown between optimizer actions (ms) */
    cooldownMs: number;
}
/**
 * Action the optimizer wants to take
 */
export interface OptimizerAction {
    /** Type of action */
    type: 'promote' | 'demote' | 'add' | 'remove' | 'reweight';
    /** Target rule identifier */
    targetRuleId: string;
    /** Magnitude of the action (interpretation depends on type) */
    magnitude: number;
    /** When the action was requested */
    timestamp: number;
}
/**
 * Validation result for an optimizer action
 */
export interface OptimizerValidation {
    /** Whether the action is allowed */
    allowed: boolean;
    /** Reason for the decision */
    reason: string;
    /** Specific constraint violations */
    constraintViolations: string[];
}
/**
 * Report of all invariant checks
 */
export interface InvariantReport {
    /** Whether all invariants hold */
    allHold: boolean;
    /** Results for each invariant */
    results: Array<{
        invariant: ConstitutionalInvariant;
        result: InvariantCheckResult;
    }>;
    /** When the report was generated */
    timestamp: number;
}
/**
 * Configuration for meta-governance
 */
export interface MetaGovernanceConfig {
    /** Threshold for supermajority (0-1, default 0.75) */
    supermajorityThreshold?: number;
    /** Maximum amendments allowed per time window */
    maxAmendmentsPerWindow?: number;
    /** Time window for amendment rate limiting (ms) */
    amendmentWindowMs?: number;
    /** Optimizer constraints (partial allows overriding defaults) */
    optimizerConstraints?: Partial<OptimizerConstraint>;
    /** Optional signing key for amendments */
    signingKey?: string;
}
/**
 * Meta-Governor: Governs the governance system itself
 *
 * Enforces constitutional invariants, manages amendments,
 * and constrains optimizer behavior to prevent governance drift.
 */
export declare class MetaGovernor {
    private invariants;
    private amendments;
    private amendmentHistory;
    private optimizerConstraints;
    private lastOptimizerAction;
    private optimizerActionsThisCycle;
    private readonly supermajorityThreshold;
    private readonly maxAmendmentsPerWindow;
    private readonly amendmentWindowMs;
    private readonly signingKey?;
    constructor(config?: MetaGovernanceConfig);
    /**
     * Add built-in constitutional invariants
     */
    private addBuiltInInvariants;
    /**
     * Add a constitutional invariant
     */
    addInvariant(invariant: ConstitutionalInvariant): void;
    /**
     * Remove an invariant (only if not immutable)
     */
    removeInvariant(id: string): boolean;
    /**
     * Check all constitutional invariants against current state
     */
    checkAllInvariants(state: GovernanceState): InvariantReport;
    /**
     * Propose a new amendment
     */
    proposeAmendment(proposal: Omit<Amendment, 'id' | 'timestamp' | 'status' | 'votes'>): Amendment;
    /**
     * Vote on an amendment
     */
    voteOnAmendment(amendmentId: string, voterId: string, approve: boolean): void;
    /**
     * Resolve an amendment (check if supermajority reached)
     */
    resolveAmendment(amendmentId: string): Amendment;
    /**
     * Enact an approved amendment
     * Returns true if enacted successfully
     */
    enactAmendment(amendmentId: string): boolean;
    /**
     * Emergency veto of an amendment
     */
    vetoAmendment(amendmentId: string, reason: string): void;
    /**
     * Get full amendment history
     */
    getAmendmentHistory(): Amendment[];
    /**
     * Validate an optimizer action against constraints
     */
    validateOptimizerAction(action: OptimizerAction): OptimizerValidation;
    /**
     * Get current optimizer constraints
     */
    getConstraints(): OptimizerConstraint;
    /**
     * Reset optimizer action tracking (call at cycle boundaries)
     */
    resetOptimizerTracking(): void;
    /**
     * Get all invariants
     */
    getInvariants(): ConstitutionalInvariant[];
    /**
     * Get pending amendments
     */
    getPendingAmendments(): Amendment[];
}
/**
 * Factory function to create a MetaGovernor instance
 */
export declare function createMetaGovernor(config?: MetaGovernanceConfig): MetaGovernor;
//# sourceMappingURL=meta-governance.d.ts.map