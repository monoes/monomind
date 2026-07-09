import { describe, it, expect } from 'vitest';
import { KeywordPreFilter, DEFAULT_KEYWORD_ROUTES } from '../keyword-pre-filter.js';

describe('KeywordPreFilter', () => {
  const filter = new KeywordPreFilter();

  describe('CVE / security patterns', () => {
    it('matches CVE identifiers', () => {
      const result = filter.match('Fix CVE-2024-12345 vulnerability');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-security-engineer');
      expect(result!.routeName).toBe('cve-remediation');
    });

    it('matches OWASP references', () => {
      const result = filter.match('Check OWASP top 10 compliance');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-security-engineer');
    });

    it('matches threat modeling tasks', () => {
      const result = filter.match('Perform threat model analysis');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-security-engineer');
    });
  });

  describe('test file patterns', () => {
    it('matches .test.ts files', () => {
      const result = filter.match('Fix the user.test.ts file');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('tdd-london-swarm');
    });

    it('matches .spec.js files', () => {
      const result = filter.match('Update auth.spec.js');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('tdd-london-swarm');
    });

    it('matches "write unit tests" requests', () => {
      const result = filter.match('write unit tests for the auth module');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('tdd-london-swarm');
    });

    it('matches "create integration tests"', () => {
      const result = filter.match('create integration tests');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('tdd-london-swarm');
    });
  });

  describe('Docker / DevOps patterns', () => {
    it('matches Dockerfile', () => {
      const result = filter.match('Update the Dockerfile');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });

    it('matches docker-compose', () => {
      const result = filter.match('Fix docker-compose.yml');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });

    it('matches terraform', () => {
      const result = filter.match('Write terraform for the VPC');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });

    it('matches kubernetes/k8s/helm', () => {
      expect(filter.match('Deploy to kubernetes')!.agentSlug).toBe('engineering-devops-automator');
      expect(filter.match('Update k8s manifests')!.agentSlug).toBe('engineering-devops-automator');
      expect(filter.match('Create helm chart')!.agentSlug).toBe('engineering-devops-automator');
    });

    it('matches github actions', () => {
      const result = filter.match('Set up GitHub Actions workflow');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });
  });

  describe('routing result properties', () => {
    it('always returns method "keyword"', () => {
      const result = filter.match('Fix CVE-2024-99999');
      expect(result!.method).toBe('keyword');
    });

    it('always returns confidence 1.0', () => {
      const result = filter.match('Fix CVE-2024-99999');
      expect(result!.confidence).toBe(1.0);
    });
  });

  describe('no match', () => {
    it('returns null when no keyword matches', () => {
      const result = filter.match('Refactor the user service for clarity');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(filter.match('')).toBeNull();
    });
  });

  describe('first-match wins', () => {
    it('CVE match takes priority over test match when both could match', () => {
      // CVE rules come before test rules in DEFAULT_KEYWORD_ROUTES
      const result = filter.match('Fix CVE-2024-1234 in auth.test.ts');
      expect(result!.routeName).toBe('cve-remediation');
    });
  });

  describe('custom rules', () => {
    it('custom rules take priority over defaults', () => {
      const custom = new KeywordPreFilter([
        { pattern: /\bcustom-match\b/, agentSlug: 'custom-agent', routeName: 'custom', description: 'Custom rule' },
      ]);
      const result = custom.match('Run custom-match here');
      expect(result!.agentSlug).toBe('custom-agent');
    });

    it('custom rules are prepended (take priority)', () => {
      const custom = new KeywordPreFilter([
        { pattern: /CVE-\d+/i, agentSlug: 'my-cve-handler', routeName: 'my-cve', description: 'Override CVE' },
      ]);
      const result = custom.match('Fix CVE-2024-99999');
      expect(result!.agentSlug).toBe('my-cve-handler');
    });
  });

  describe('addRule', () => {
    it('adds a rule at highest priority', () => {
      const f = new KeywordPreFilter();
      f.addRule({ pattern: /\bmy-special-task\b/, agentSlug: 'special', routeName: 'special', description: 'Special' });
      const result = f.match('Handle my-special-task now');
      expect(result!.agentSlug).toBe('special');
    });
  });

  describe('getRules', () => {
    it('returns a copy of all rules', () => {
      const rules = filter.getRules();
      expect(rules.length).toBeGreaterThanOrEqual(DEFAULT_KEYWORD_ROUTES.length);
      // Verify it is a copy, not the same array
      expect(rules).not.toBe((filter as any).rules);
    });
  });

  describe('additional route patterns', () => {
    it('matches solidity / smart contract', () => {
      expect(filter.match('Deploy contract.sol')!.agentSlug).toBe('engineering-solidity-smart-contract-engineer');
      expect(filter.match('Write a smart contract')!.agentSlug).toBe('engineering-solidity-smart-contract-engineer');
    });

    it('matches graphql', () => {
      expect(filter.match('Create graphql schema')!.agentSlug).toBe('engineering-graphql-developer');
    });

    it('matches database keywords', () => {
      expect(filter.match('Optimize postgres query')!.agentSlug).toBe('engineering-database-engineer');
      expect(filter.match('Set up redis caching')!.agentSlug).toBe('engineering-database-engineer');
    });

    it('matches git operations', () => {
      expect(filter.match('git rebase main')!.agentSlug).toBe('engineering-git-workflow-master');
    });

    it('matches MCP server/builder', () => {
      expect(filter.match('Build an MCP server')!.agentSlug).toBe('specialized-mcp-builder');
    });

    it('matches react-native', () => {
      expect(filter.match('Create a React Native screen')!.agentSlug).toBe('engineering-react-native-developer');
    });

    it('matches embedded/firmware', () => {
      expect(filter.match('Write firmware for the sensor')!.agentSlug).toBe('engineering-embedded-firmware-engineer');
    });
  });
});
