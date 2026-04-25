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
import { randomUUID } from 'node:crypto';
// ============================================================================
// Capability Algebra
// ============================================================================
/**
 * Capability Algebra
 *
 * Manages the lifecycle of typed capabilities: granting, restricting,
 * delegating, revoking, attesting, checking, and composing permissions.
 * All mutations produce new capability objects; the original is never
 * modified in place (except for revocation which is a state change).
 */
export class CapabilityAlgebra {
    /** All capabilities indexed by ID */
    capabilities = new Map();
    /** Index: agentId -> set of capability IDs */
    agentIndex = new Map();
    /** Index: parentCapabilityId -> set of child capability IDs */
    delegationIndex = new Map();
    // =========================================================================
    // Public API
    // =========================================================================
    /**
     * Grant a new root capability.
     *
     * Creates a capability with no parent (it is a root grant from an
     * authority to an agent).
     */
    grant(params) {
        const capability = {
            id: randomUUID(),
            scope: params.scope,
            resource: params.resource,
            actions: [...params.actions],
            constraints: params.constraints ? [...params.constraints] : [],
            grantedBy: params.grantedBy,
            grantedTo: params.grantedTo,
            grantedAt: Date.now(),
            expiresAt: params.expiresAt ?? null,
            delegatable: params.delegatable ?? false,
            revoked: false,
            revokedAt: null,
            attestations: [],
            parentCapabilityId: null,
        };
        this.store(capability);
        return capability;
    }
    /**
     * Restrict a capability, producing a new capability with tighter constraints.
     *
     * Restrictions can only narrow permissions, never widen them:
     * - Actions can only be removed, never added
     * - Constraints can only be added, never removed
     * - Expiry can only be shortened, never extended
     * - Delegatable can only be set to false, never promoted to true
     */
    restrict(capability, restrictions) {
        const restricted = {
            ...capability,
            id: randomUUID(),
            grantedAt: Date.now(),
            attestations: [],
            parentCapabilityId: capability.id,
        };
        // Actions: only allow narrowing (intersection with original)
        if (restrictions.actions) {
            const originalSet = new Set(capability.actions);
            restricted.actions = restrictions.actions.filter(a => originalSet.has(a));
        }
        // Constraints: only allow adding more (union)
        if (restrictions.constraints) {
            restricted.constraints = [
                ...capability.constraints,
                ...restrictions.constraints,
            ];
        }
        // Expiry: only allow shortening (pick earlier)
        if (restrictions.expiresAt !== undefined) {
            if (restrictions.expiresAt !== null) {
                if (capability.expiresAt === null) {
                    restricted.expiresAt = restrictions.expiresAt;
                }
                else {
                    restricted.expiresAt = Math.min(capability.expiresAt, restrictions.expiresAt);
                }
            }
            // If restriction tries to set null (no expiry) but original has expiry, keep original
        }
        // Delegatable: can only be downgraded to false
        if (restrictions.delegatable !== undefined) {
            if (!restrictions.delegatable) {
                restricted.delegatable = false;
            }
            // Cannot promote to delegatable if original is not
        }
        this.store(restricted);
        return restricted;
    }
    /**
     * Delegate a capability to another agent.
     *
     * Creates a child capability with the new grantedTo agent. The parent
     * capability must have delegatable=true. Optional further restrictions
     * can be applied during delegation.
     *
     * @throws Error if the capability is not delegatable
     */
    delegate(capability, toAgentId, restrictions) {
        if (!capability.delegatable) {
            throw new Error(`Capability ${capability.id} is not delegatable`);
        }
        if (capability.revoked) {
            throw new Error(`Cannot delegate revoked capability ${capability.id}`);
        }
        if (capability.expiresAt !== null && capability.expiresAt <= Date.now()) {
            throw new Error(`Cannot delegate expired capability ${capability.id}`);
        }
        const delegated = {
            ...capability,
            id: randomUUID(),
            grantedBy: capability.grantedTo,
            grantedTo: toAgentId,
            grantedAt: Date.now(),
            attestations: [],
            parentCapabilityId: capability.id,
        };
        // Apply optional further restrictions
        if (restrictions?.actions) {
            const originalSet = new Set(capability.actions);
            delegated.actions = restrictions.actions.filter(a => originalSet.has(a));
        }
        if (restrictions?.constraints) {
            delegated.constraints = [
                ...capability.constraints,
                ...restrictions.constraints,
            ];
        }
        if (restrictions?.expiresAt !== undefined && restrictions.expiresAt !== null) {
            if (capability.expiresAt === null) {
                delegated.expiresAt = restrictions.expiresAt;
            }
            else {
                delegated.expiresAt = Math.min(capability.expiresAt, restrictions.expiresAt);
            }
        }
        if (restrictions?.delegatable === false) {
            delegated.delegatable = false;
        }
        this.store(delegated);
        // Track delegation relationship
        const children = this.delegationIndex.get(capability.id) ?? new Set();
        children.add(delegated.id);
        this.delegationIndex.set(capability.id, children);
        return delegated;
    }
    /**
     * Expire a capability immediately by setting expiresAt to now.
     */
    expire(capabilityId) {
        const capability = this.capabilities.get(capabilityId);
        if (!capability)
            return;
        capability.expiresAt = Date.now();
    }
    /**
     * Revoke a capability and cascade revocation to all delegated children.
     */
    revoke(capabilityId, _reason) {
        const capability = this.capabilities.get(capabilityId);
        if (!capability)
            return;
        capability.revoked = true;
        capability.revokedAt = Date.now();
        this.cascadeRevoke(capabilityId);
    }
    /**
     * Add an attestation to a capability.
     */
    attest(capabilityId, attestation) {
        const capability = this.capabilities.get(capabilityId);
        if (!capability)
            return;
        capability.attestations.push({
            ...attestation,
            attestedAt: Date.now(),
        });
    }
    /**
     * Check whether an agent is allowed to perform an action on a resource.
     *
     * Finds all non-revoked, non-expired capabilities for the agent that
     * match the requested scope and resource, checks if the requested action
     * is allowed, and verifies all constraints are satisfied.
     */
    check(agentId, scope, resource, action, context) {
        const agentCapIds = this.agentIndex.get(agentId);
        if (!agentCapIds || agentCapIds.size === 0) {
            return {
                allowed: false,
                capabilities: [],
                reason: `No capabilities found for agent "${agentId}"`,
                constraints: [],
            };
        }
        const now = Date.now();
        const matchingCapabilities = [];
        const activeConstraints = [];
        for (const capId of agentCapIds) {
            const cap = this.capabilities.get(capId);
            if (!cap)
                continue;
            // Skip revoked
            if (cap.revoked)
                continue;
            // Skip expired
            if (cap.expiresAt !== null && cap.expiresAt <= now)
                continue;
            // Match scope and resource
            if (cap.scope !== scope)
                continue;
            if (cap.resource !== resource && cap.resource !== '*')
                continue;
            // Check action
            if (!cap.actions.includes(action) && !cap.actions.includes('*'))
                continue;
            // Check constraints
            if (!this.satisfiesConstraints(cap, context))
                continue;
            matchingCapabilities.push(cap);
            activeConstraints.push(...cap.constraints);
        }
        if (matchingCapabilities.length === 0) {
            return {
                allowed: false,
                capabilities: [],
                reason: `No matching capability for agent "${agentId}" to "${action}" on ${scope}:${resource}`,
                constraints: [],
            };
        }
        return {
            allowed: true,
            capabilities: matchingCapabilities,
            reason: `Allowed by ${matchingCapabilities.length} capability(ies)`,
            constraints: activeConstraints,
        };
    }
    /**
     * Get all capabilities granted to a specific agent.
     */
    getCapabilities(agentId) {
        const capIds = this.agentIndex.get(agentId);
        if (!capIds)
            return [];
        const result = [];
        for (const id of capIds) {
            const cap = this.capabilities.get(id);
            if (cap)
                result.push(cap);
        }
        return result;
    }
    /**
     * Get a capability by ID.
     */
    getCapability(id) {
        return this.capabilities.get(id);
    }
    /**
     * Get the full delegation chain from root to the given capability.
     *
     * Returns an array ordered from the root ancestor to the given capability.
     */
    getDelegationChain(capabilityId) {
        const chain = [];
        let current = this.capabilities.get(capabilityId);
        while (current) {
            chain.unshift(current);
            if (current.parentCapabilityId === null)
                break;
            current = this.capabilities.get(current.parentCapabilityId);
        }
        return chain;
    }
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
    compose(cap1, cap2) {
        if (cap1.scope !== cap2.scope) {
            throw new Error(`Cannot compose capabilities with different scopes: "${cap1.scope}" vs "${cap2.scope}"`);
        }
        if (cap1.resource !== cap2.resource) {
            throw new Error(`Cannot compose capabilities with different resources: "${cap1.resource}" vs "${cap2.resource}"`);
        }
        // Actions: intersection
        const actionSet1 = new Set(cap1.actions);
        const intersectedActions = cap2.actions.filter(a => actionSet1.has(a));
        // Constraints: union
        const combinedConstraints = [...cap1.constraints, ...cap2.constraints];
        // Expiry: tightest
        let expiresAt = null;
        if (cap1.expiresAt !== null && cap2.expiresAt !== null) {
            expiresAt = Math.min(cap1.expiresAt, cap2.expiresAt);
        }
        else if (cap1.expiresAt !== null) {
            expiresAt = cap1.expiresAt;
        }
        else if (cap2.expiresAt !== null) {
            expiresAt = cap2.expiresAt;
        }
        const composed = {
            id: randomUUID(),
            scope: cap1.scope,
            resource: cap1.resource,
            actions: intersectedActions,
            constraints: combinedConstraints,
            grantedBy: cap1.grantedBy,
            grantedTo: cap1.grantedTo,
            grantedAt: Date.now(),
            expiresAt,
            delegatable: cap1.delegatable && cap2.delegatable,
            revoked: false,
            revokedAt: null,
            attestations: [],
            parentCapabilityId: null,
        };
        this.store(composed);
        return composed;
    }
    /**
     * Check if inner's permission set is a subset of outer's.
     *
     * Returns true if:
     * - inner.scope === outer.scope
     * - inner.resource === outer.resource
     * - Every action in inner is present in outer
     * - inner.expiresAt is <= outer.expiresAt (or outer has no expiry)
     */
    isSubset(inner, outer) {
        if (inner.scope !== outer.scope)
            return false;
        if (inner.resource !== outer.resource)
            return false;
        const outerActions = new Set(outer.actions);
        for (const action of inner.actions) {
            if (!outerActions.has(action))
                return false;
        }
        // Expiry: inner must expire no later than outer (or outer has no expiry)
        if (outer.expiresAt !== null) {
            if (inner.expiresAt === null)
                return false; // inner never expires but outer does
            if (inner.expiresAt > outer.expiresAt)
                return false;
        }
        return true;
    }
    // =========================================================================
    // Private Methods
    // =========================================================================
    /**
     * Evaluate whether all constraints on a capability are satisfied.
     */
    satisfiesConstraints(capability, context) {
        for (const constraint of capability.constraints) {
            switch (constraint.type) {
                case 'time-window': {
                    const now = Date.now();
                    const start = constraint.params['start'];
                    const end = constraint.params['end'];
                    if (start !== undefined && now < start)
                        return false;
                    if (end !== undefined && now > end)
                        return false;
                    break;
                }
                case 'rate-limit': {
                    // Rate-limit constraints are informational; enforcement is external.
                    // If context provides current usage, check it.
                    if (context) {
                        const max = constraint.params['max'];
                        const current = context['currentUsage'];
                        if (max !== undefined && current !== undefined && current >= max) {
                            return false;
                        }
                    }
                    break;
                }
                case 'budget': {
                    if (context) {
                        const limit = constraint.params['limit'];
                        const used = context['budgetUsed'];
                        if (limit !== undefined && used !== undefined && used >= limit) {
                            return false;
                        }
                    }
                    break;
                }
                case 'condition': {
                    // Condition constraints require a truthy context value at the specified key
                    const key = constraint.params['key'];
                    const expectedValue = constraint.params['value'];
                    if (key && context) {
                        if (expectedValue !== undefined) {
                            if (context[key] !== expectedValue)
                                return false;
                        }
                        else {
                            if (!context[key])
                                return false;
                        }
                    }
                    break;
                }
                case 'scope-restriction': {
                    // Scope restrictions limit to specific sub-resources
                    const allowedPattern = constraint.params['pattern'];
                    if (allowedPattern && context) {
                        const targetResource = context['targetResource'];
                        if (targetResource && !targetResource.startsWith(allowedPattern)) {
                            return false;
                        }
                    }
                    break;
                }
            }
        }
        return true;
    }
    /**
     * Cascade revocation to all delegated children of a capability.
     */
    cascadeRevoke(capabilityId) {
        const children = this.delegationIndex.get(capabilityId);
        if (!children)
            return;
        const now = Date.now();
        for (const childId of children) {
            const child = this.capabilities.get(childId);
            if (child && !child.revoked) {
                child.revoked = true;
                child.revokedAt = now;
                // Recurse into grandchildren
                this.cascadeRevoke(childId);
            }
        }
    }
    /**
     * Store a capability and update indices.
     */
    store(capability) {
        this.capabilities.set(capability.id, capability);
        const agentCaps = this.agentIndex.get(capability.grantedTo) ?? new Set();
        agentCaps.add(capability.id);
        this.agentIndex.set(capability.grantedTo, agentCaps);
    }
}
// ============================================================================
// Factory
// ============================================================================
/**
 * Create a CapabilityAlgebra instance
 */
export function createCapabilityAlgebra() {
    return new CapabilityAlgebra();
}
//# sourceMappingURL=capabilities.js.map