/**
 * Registry Query (Task 30)
 *
 * Provides query and validation utilities over an AgentRegistry.
 * Supports loading from an in-memory object or a JSON file on disk.
 */
import { readFileSync } from 'fs';
/**
 * Query engine for the Central Agent Registry.
 */
export class RegistryQuery {
    agents;
    constructor(agents) {
        this.agents = agents;
    }
    /**
     * Create a RegistryQuery from an in-memory AgentRegistry object.
     */
    static loadFromJSON(registry) {
        return new RegistryQuery(registry.agents ?? []);
    }
    /**
     * Create a RegistryQuery by reading a registry JSON file from disk.
     */
    static loadFromFile(path) {
        const raw = readFileSync(path, 'utf-8');
        const registry = JSON.parse(raw);
        return RegistryQuery.loadFromJSON(registry);
    }
    /**
     * Find all agents that list the given capability.
     */
    findByCapability(capability) {
        return this.agents.filter((a) => a.capabilities.includes(capability));
    }
    /**
     * Find all agents that handle the given task type.
     */
    findByTaskType(taskType) {
        return this.agents.filter((a) => a.taskTypes.includes(taskType));
    }
    /**
     * Find an agent by its unique slug. Returns undefined if not found.
     */
    findBySlug(slug) {
        return this.agents.find((a) => a.slug === slug);
    }
    /**
     * Find all agents that list the given tool.
     */
    findByTool(tool) {
        return this.agents.filter((a) => a.tools.includes(tool));
    }
    /**
     * Find micro-agents — agents that have at least one trigger pattern.
     */
    findMicroAgents() {
        return this.agents.filter((a) => a.triggers.length > 0);
    }
    /**
     * Return all agent slugs in the registry.
     */
    allSlugs() {
        return this.agents.map((a) => a.slug);
    }
    /**
     * Validate the registry, returning a list of validation issues.
     * Checks:
     * - version must be valid semver (X.Y.Z pattern)
     * - slug must be non-empty
     * - name must be non-empty
     */
    validate() {
        const results = [];
        const semverRe = /^\d+\.\d+\.\d+/;
        for (const agent of this.agents) {
            if (!agent.slug) {
                results.push({ slug: agent.slug ?? '(empty)', field: 'slug', message: 'Slug is empty', severity: 'error' });
            }
            if (!agent.name) {
                results.push({ slug: agent.slug, field: 'name', message: 'Name is empty', severity: 'error' });
            }
            if (!semverRe.test(agent.version)) {
                results.push({
                    slug: agent.slug,
                    field: 'version',
                    message: `Invalid semver: "${agent.version}"`,
                    severity: 'error',
                });
            }
            if (agent.deprecated && !agent.deprecatedBy) {
                results.push({
                    slug: agent.slug,
                    field: 'deprecatedBy',
                    message: 'Agent is deprecated but deprecatedBy is not set',
                    severity: 'warning',
                });
            }
        }
        return results;
    }
    /**
     * Detect duplicate slugs across registry entries.
     */
    conflicts() {
        const map = new Map();
        for (const agent of this.agents) {
            const existing = map.get(agent.slug);
            if (existing) {
                existing.push(agent);
            }
            else {
                map.set(agent.slug, [agent]);
            }
        }
        const result = [];
        for (const [slug, entries] of map) {
            if (entries.length > 1) {
                result.push({ slug, entries });
            }
        }
        return result;
    }
}
//# sourceMappingURL=registry-query.js.map