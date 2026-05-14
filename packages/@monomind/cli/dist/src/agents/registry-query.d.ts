/**
 * Registry Query (Task 30)
 *
 * Provides query and validation utilities over an AgentRegistry.
 * Supports loading from an in-memory object or a JSON file on disk.
 */
import type { AgentRegistry, AgentRegistryEntry } from '../../../shared/src/types/agent-registry.js';
/** Validation issue found during registry validation. */
export interface RegistryValidationResult {
    slug: string;
    field: string;
    message: string;
    severity: 'error' | 'warning';
}
/** Conflict entry for duplicate slug detection. */
export interface RegistryConflict {
    slug: string;
    entries: AgentRegistryEntry[];
}
/**
 * Query engine for the Central Agent Registry.
 */
export declare class RegistryQuery {
    private agents;
    private constructor();
    /**
     * Create a RegistryQuery from an in-memory AgentRegistry object.
     */
    static loadFromJSON(registry: AgentRegistry): RegistryQuery;
    /**
     * Create a RegistryQuery by reading a registry JSON file from disk.
     */
    static loadFromFile(path: string): RegistryQuery;
    /**
     * Find all agents that list the given capability.
     */
    findByCapability(capability: string): AgentRegistryEntry[];
    /**
     * Find all agents that handle the given task type.
     */
    findByTaskType(taskType: string): AgentRegistryEntry[];
    /**
     * Find an agent by its unique slug. Returns undefined if not found.
     */
    findBySlug(slug: string): AgentRegistryEntry | undefined;
    /**
     * Find all agents that list the given tool.
     */
    findByTool(tool: string): AgentRegistryEntry[];
    /**
     * Find micro-agents — agents that have at least one trigger pattern.
     */
    findMicroAgents(): AgentRegistryEntry[];
    /**
     * Return all agent slugs in the registry.
     */
    allSlugs(): string[];
    /**
     * Validate the registry, returning a list of validation issues.
     * Checks:
     * - version must be valid semver (X.Y.Z pattern)
     * - slug must be non-empty
     * - name must be non-empty
     */
    validate(): RegistryValidationResult[];
    /**
     * Detect duplicate slugs across registry entries.
     */
    conflicts(): RegistryConflict[];
}
//# sourceMappingURL=registry-query.d.ts.map