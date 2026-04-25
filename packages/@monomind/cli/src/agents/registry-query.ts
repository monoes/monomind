/**
 * Registry Query (Task 30)
 *
 * Provides query and validation utilities over an AgentRegistry.
 * Supports loading from an in-memory object or a JSON file on disk.
 */

import { readFileSync } from 'fs';
import type {
  AgentRegistry,
  AgentRegistryEntry,
} from '../../../shared/src/types/agent-registry.js';

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
export class RegistryQuery {
  private agents: AgentRegistryEntry[];

  private constructor(agents: AgentRegistryEntry[]) {
    this.agents = agents;
  }

  /**
   * Create a RegistryQuery from an in-memory AgentRegistry object.
   */
  static loadFromJSON(registry: AgentRegistry): RegistryQuery {
    return new RegistryQuery(registry.agents ?? []);
  }

  /**
   * Create a RegistryQuery by reading a registry JSON file from disk.
   */
  static loadFromFile(path: string): RegistryQuery {
    const raw = readFileSync(path, 'utf-8');
    const registry: AgentRegistry = JSON.parse(raw);
    return RegistryQuery.loadFromJSON(registry);
  }

  /**
   * Find all agents that list the given capability.
   */
  findByCapability(capability: string): AgentRegistryEntry[] {
    return this.agents.filter((a) => a.capabilities.includes(capability));
  }

  /**
   * Find all agents that handle the given task type.
   */
  findByTaskType(taskType: string): AgentRegistryEntry[] {
    return this.agents.filter((a) => a.taskTypes.includes(taskType));
  }

  /**
   * Find an agent by its unique slug. Returns undefined if not found.
   */
  findBySlug(slug: string): AgentRegistryEntry | undefined {
    return this.agents.find((a) => a.slug === slug);
  }

  /**
   * Find all agents that list the given tool.
   */
  findByTool(tool: string): AgentRegistryEntry[] {
    return this.agents.filter((a) => a.tools.includes(tool));
  }

  /**
   * Find micro-agents — agents that have at least one trigger pattern.
   */
  findMicroAgents(): AgentRegistryEntry[] {
    return this.agents.filter((a) => a.triggers.length > 0);
  }

  /**
   * Return all agent slugs in the registry.
   */
  allSlugs(): string[] {
    return this.agents.map((a) => a.slug);
  }

  /**
   * Validate the registry, returning a list of validation issues.
   * Checks:
   * - version must be valid semver (X.Y.Z pattern)
   * - slug must be non-empty
   * - name must be non-empty
   */
  validate(): RegistryValidationResult[] {
    const results: RegistryValidationResult[] = [];
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
  conflicts(): RegistryConflict[] {
    const map = new Map<string, AgentRegistryEntry[]>();
    for (const agent of this.agents) {
      const existing = map.get(agent.slug);
      if (existing) {
        existing.push(agent);
      } else {
        map.set(agent.slug, [agent]);
      }
    }
    const result: RegistryConflict[] = [];
    for (const [slug, entries] of map) {
      if (entries.length > 1) {
        result.push({ slug, entries });
      }
    }
    return result;
  }
}
