/**
 * Tests for Central Agent Registry (Task 30).
 *
 * Uses vitest globals (describe, it, expect).
 * Run: npx vitest run tests/agents/registry-query.test.ts --globals
 */

import { describe, it, expect } from 'vitest';

import type {
  AgentRegistry,
  AgentRegistryEntry,
} from '../../packages/@monomind/shared/src/types/agent-registry.js';
import {
  RegistryQuery,
} from '../../packages/@monomind/cli/src/agents/registry-query.js';

/** Helper to create a minimal valid agent entry. */
function makeAgent(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    slug: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    category: 'core',
    capabilities: [],
    taskTypes: [],
    tools: [],
    triggers: [],
    deprecated: false,
    dependencies: [],
    filePath: '/agents/core/test-agent.md',
    registeredAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(agents: AgentRegistryEntry[]): AgentRegistry {
  return {
    version: '1.0.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    totalAgents: agents.length,
    agents,
  };
}

describe('RegistryQuery', () => {
  describe('loadFromJSON', () => {
    it('loads an empty registry without errors', () => {
      const rq = RegistryQuery.loadFromJSON(makeRegistry([]));
      expect(rq.allSlugs()).toEqual([]);
    });

    it('loads agents and exposes allSlugs', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'coder' }), makeAgent({ slug: 'tester' })]),
      );
      expect(rq.allSlugs()).toEqual(['coder', 'tester']);
    });
  });

  describe('findByCapability', () => {
    it('returns agents matching the given capability', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([
          makeAgent({ slug: 'coder', capabilities: ['code-generation', 'refactoring'] }),
          makeAgent({ slug: 'reviewer', capabilities: ['code-review'] }),
          makeAgent({ slug: 'tester', capabilities: ['testing', 'code-generation'] }),
        ]),
      );
      const found = rq.findByCapability('code-generation');
      expect(found.map((a) => a.slug)).toEqual(['coder', 'tester']);
    });

    it('returns empty array when no agents match', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'coder', capabilities: ['code-generation'] })]),
      );
      expect(rq.findByCapability('nonexistent')).toEqual([]);
    });
  });

  describe('findByTaskType', () => {
    it('returns agents that handle the given task type', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([
          makeAgent({ slug: 'coder', taskTypes: ['feature', 'bugfix'] }),
          makeAgent({ slug: 'reviewer', taskTypes: ['review'] }),
        ]),
      );
      const found = rq.findByTaskType('bugfix');
      expect(found.map((a) => a.slug)).toEqual(['coder']);
    });
  });

  describe('findBySlug', () => {
    it('returns the agent with matching slug', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'coder' }), makeAgent({ slug: 'tester' })]),
      );
      const agent = rq.findBySlug('tester');
      expect(agent).toBeDefined();
      expect(agent!.slug).toBe('tester');
    });

    it('returns undefined for unknown slug', () => {
      const rq = RegistryQuery.loadFromJSON(makeRegistry([makeAgent({ slug: 'coder' })]));
      expect(rq.findBySlug('unknown')).toBeUndefined();
    });
  });

  describe('findByTool', () => {
    it('returns agents that use the given tool', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([
          makeAgent({ slug: 'coder', tools: ['Edit', 'Write', 'Bash'] }),
          makeAgent({ slug: 'researcher', tools: ['Read', 'Grep', 'Glob'] }),
          makeAgent({ slug: 'devops', tools: ['Bash', 'Read'] }),
        ]),
      );
      const found = rq.findByTool('Bash');
      expect(found.map((a) => a.slug)).toEqual(['coder', 'devops']);
    });
  });

  describe('findMicroAgents', () => {
    it('returns only agents with trigger patterns', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([
          makeAgent({ slug: 'normal-agent', triggers: [] }),
          makeAgent({
            slug: 'micro-lint',
            triggers: [{ pattern: '**/*.ts', mode: 'glob' }],
          }),
          makeAgent({
            slug: 'micro-test',
            triggers: [{ pattern: 'tests/**', mode: 'glob' }],
          }),
        ]),
      );
      const micros = rq.findMicroAgents();
      expect(micros.map((a) => a.slug)).toEqual(['micro-lint', 'micro-test']);
    });

    it('returns empty array when no micro-agents exist', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'plain', triggers: [] })]),
      );
      expect(rq.findMicroAgents()).toEqual([]);
    });
  });

  describe('validate', () => {
    it('returns no errors for a valid registry', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'coder', version: '1.0.0' })]),
      );
      expect(rq.validate()).toEqual([]);
    });

    it('returns error for invalid semver version', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'bad-ver', version: 'not-a-version' })]),
      );
      const results = rq.validate();
      expect(results.length).toBeGreaterThanOrEqual(1);
      const verError = results.find((r) => r.field === 'version');
      expect(verError).toBeDefined();
      expect(verError!.severity).toBe('error');
      expect(verError!.message).toContain('not-a-version');
    });

    it('returns warning for deprecated agent without deprecatedBy', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'old-agent', deprecated: true })]),
      );
      const results = rq.validate();
      const warning = results.find((r) => r.field === 'deprecatedBy');
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
    });

    it('does not warn when deprecated agent has deprecatedBy set', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([
          makeAgent({ slug: 'old-agent', deprecated: true, deprecatedBy: 'new-agent' }),
        ]),
      );
      const results = rq.validate();
      const warning = results.find((r) => r.field === 'deprecatedBy');
      expect(warning).toBeUndefined();
    });
  });

  describe('conflicts', () => {
    it('detects duplicate slugs', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([
          makeAgent({ slug: 'coder', filePath: '/agents/core/coder.md' }),
          makeAgent({ slug: 'coder', filePath: '/agents/alt/coder.md' }),
          makeAgent({ slug: 'tester' }),
        ]),
      );
      const conflicts = rq.conflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].slug).toBe('coder');
      expect(conflicts[0].entries).toHaveLength(2);
    });

    it('returns empty array when no duplicates exist', () => {
      const rq = RegistryQuery.loadFromJSON(
        makeRegistry([makeAgent({ slug: 'a' }), makeAgent({ slug: 'b' })]),
      );
      expect(rq.conflicts()).toEqual([]);
    });
  });
});
