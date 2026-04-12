/**
 * Capability Algebra
 *
 * All permissions become typed objects that can be composed, restricted,
 * delegated, revoked, and reasoned about. Supports delegation chains,
 * attestations, constraint evaluation, and set-theoretic composition
 * (intersection for actions, union for constraints).
 *
 * @module @monobrain/guidance/capabilities
 */
/**
 * Scope categories for capabilities
 */
export type CapabilityScope = 'tool' | 'memory' | 'network' | 'file' | 'model' | 'system';
/**
 * Constraint applied to a capability
 */
export interface CapabilityConstraint {
    /** Constraint type */
    type: 'rate-limit' | 'budget' | 'time-window' | 'condition' | 'scope-restriction';
    /** Type-specific parameters */
    params: Record<string, unknown>;
}
/**
 * Cryptographic attestation for a capability
 */
export interface Attestation {
    /** ID of the attesting agent or authority */
    attesterId: string;
    /** When the attestation was made (ms since epoch) */
    attestedAt: number;
    /** Claim being attested (e.g., "agent passed security audit") */
    claim: string;
    /** Optional evidence supporting the claim */
    evidence: string | null;
    /** Signature over the claim (hex-encoded) */
    signature: string;
}
/**
 * A typed permission object representing a granted capability
 */
export interface Capability {
    /** Unique capability identifier (UUID) */
    id: string;
    /** Scope category */
    scope: CapabilityScope;
    /** Target resource (tool name, namespace, path pattern, etc.) */
    resource: string;
    /** Allowed actions (e.g., 'read', 'write', 'execute', 'delete') */
    actions: string[];
    /** Active constraints on this capability */
    constraints: CapabilityConstraint[];
    /** Agent or authority that granted this capability */
    grantedBy: string;
    /** Agent this capability is granted to */
    grantedTo: string;
    /** When the capability was granted (ms since epoch) */
    grantedAt: number;
    /** When the capability expires, or null for no expiry */
    expiresAt: number | null;
    /** Whether this capability can be delegated to sub-agents */
    delegatable: boolean;
    /** Whether this capability has been revoked */
    revoked: boolean;
    /** When the capability was revoked, or null if not revoked */
    revokedAt: number | null;
    /** Attestations attached to this capability */
    attestations: Attestation[];
    /** Parent capability ID for delegation chains, or null for root grants */
    parentCapabilityId: string | null;
}
/**
 * Result of evaluating a capability check
 */
export interface CapabilityCheckResult {
    /** Whether the requested action is allowed */
    allowed: boolean;
    /** Capabilities that matched the check criteria */
    capabilities: Capability[];
    /** Human-readable reason for the decision */
    reason: string;
    /** Active constraints that applied during evaluation */
    constraints: CapabilityConstraint[];
}
/**
 * Capability Algebra
 *
 * Manages the lifecycle of typed capabilities: granting, restricting,
 * delegating, revoking, attesting, checking, and composing permissions.
 * All mutations produce new capability objects; the original is never
 * modified in place (except for revocation which is a state change).
 */
export declare class CapabilityAlgebra {
    /** All capabilities indexed by ID */
    private readonly capabilities;
    /** Index: agentId -> set of capability IDs */
    private readonly agentIndex;
    /** Index: parentCapabilityId -> set of child capability IDs */
    private readonly delegationIndex;
    /**
     * Grant a new root capability.
     *
     * Creates a capability with no parent (it is a root grant from an
     * authority to an agent).
     */
    grant(params: {
        scope: CapabilityScope;
        resource: string;
        actions: string[];
        grantedBy: string;
        grantedTo: string;
        constraints?: CapabilityConstraint[];
        expiresAt?: number | null;
        delegatable?: boolean;
    }): Capability;
    /**
     * Restrict a capability, producing a new capability with tighter constraints.
     *
     * Restrictions can only narrow permissions, never widen them:
     * - Actions can only be removed, never added
     * - Constraints can only be added, never removed
     * - Expiry can only be shortened, never extended
     * - Delegatable can only be set to false, never promoted to true
     */
    restrict(capability: Capability, restrictions: Partial<Capability>): Capability;
    /**
     * Delegate a capability to another agent.
     *
     * Creates a child capability with the new grantedTo agent. The parent
     * capability must have delegatable=true. Optional further restrictions
     * can be applied during delegation.
     *
     * @throws Error if the capability is not delegatable
     */
    delegate(capability: Capability, toAgentId: string, restrictions?: Partial<Capability>): Capability;
    /**
     * Expire a capability immediately by setting expiresAt to now.
     */
    expire(capabilityId: string): void;
    /**
     * Revoke a capability and cascade revocation to all delegated children.
     */
    revoke(capabilityId: string, _reason?: string): void;
    /**
     * Add an attestation to a capability.
     */
    attest(capabilityId: string, attestation: Omit<Attestation, 'attestedAt'>): void;
    /**
     * Check whether an agent is allowed to perform an action on a resource.
     *
     * Finds all non-revoked, non-expired capabilities for the agent that
     * match the requested scope and resource, checks if the requested action
     * is allowed, and verifies all constraints are satisfied.
     */
    check(agentId: string, scope: CapabilityScope, resource: string, action: string, context?: Record<string, unknown>): CapabilityCheckResult;
    /**
     * Get all capabilities granted to a specific agent.
     */
    getCapabilities(agentId: string): Capability[];
    /**
     * Get a capability by ID.
     */
    getCapability(id: string): Capability | undefined;
    /**
     * Get the full delegation chain from root to the given capability.
     *
     * Returns an array ordered from the root ancestor to the given capability.
     */
    getDelegationChain(capabilityId: string): Capability[];
    /**
     * Compose two capabilities via intersection.
     *
     * - Actions = intersection of both action sets
     * - Constraints = union of both constraint sets
     * - Expiry = the tighter (earlier) of the two
     * - Delegatable = true only if both are delegatable
     * - Scope and resource must match; throws if they differ
     *
     * @throws Error if scope or resource do not match
     */
    compose(cap1: Capability, cap2: Capability): Capability;
    /**
     * Check if inner's permission set is a subset of outer's.
     *
     * Returns true if:
     * - inner.scope === outer.scope
     * - inner.resource === outer.resource
     * - Every action in inner is present in outer
     * - inner.expiresAt is <= outer.expiresAt (or outer has no expiry)
     */
    isSubset(inner: Capability, outer: Capability): boolean;
    /**
     * Evaluate whether all constraints on a capability are satisfied.
     */
    private satisfiesConstraints;
    /**
     * Cascade revocation to all delegated children of a capability.
     */
    private cascadeRevoke;
    /**
     * Store a capability and update indices.
     */
    private store;
}
/**
 * Create a CapabilityAlgebra instance
 */
export declare function createCapabilityAlgebra(): CapabilityAlgebra;
//# sourceMappingURL=capabilities.d.ts.map