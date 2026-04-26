import { describe, it, expect, beforeEach } from 'vitest';

import { KeywordPreFilter, DEFAULT_KEYWORD_ROUTES } from '../../packages/@monomind/routing/src/keyword-pre-filter.js';
import { RouteLayer } from '../../packages/@monomind/routing/src/route-layer.js';

describe('KeywordPreFilter', () => {
  let filter: KeywordPreFilter;

  beforeEach(() => {
    filter = new KeywordPreFilter();
  });

  describe('match()', () => {
    it('returns null for generic tasks with no keyword match', () => {
      expect(filter.match('implement the login endpoint')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(filter.match('')).toBeNull();
    });

    it('returns method=keyword and confidence=1.0 on match', () => {
      const result = filter.match('Fix CVE-2024-12345 in auth module');
      expect(result).not.toBeNull();
      expect(result!.method).toBe('keyword');
      expect(result!.confidence).toBe(1.0);
    });

    // CVE
    it('routes CVE identifiers to engineering-security-engineer', () => {
      const result = filter.match('Patch CVE-2024-00001 vulnerability');
      expect(result!.agentSlug).toBe('engineering-security-engineer');
      expect(result!.routeName).toBe('cve-remediation');
    });

    // OWASP
    it('routes OWASP references to engineering-security-engineer', () => {
      const result = filter.match('Check for OWASP top 10 violations');
      expect(result!.agentSlug).toBe('engineering-security-engineer');
      expect(result!.routeName).toBe('owasp-security');
    });

    // Threat modeling
    it('routes threat model tasks to engineering-security-engineer', () => {
      const result = filter.match('Perform a threat model for the API');
      expect(result!.agentSlug).toBe('engineering-security-engineer');
    });

    // Test files
    it('routes .test.ts files to tdd-london-swarm', () => {
      const result = filter.match('Fix auth.test.ts failing tests');
      expect(result!.agentSlug).toBe('tdd-london-swarm');
    });

    it('routes .spec.js files to tdd-london-swarm', () => {
      const result = filter.match('Update user.spec.js with new assertions');
      expect(result!.agentSlug).toBe('tdd-london-swarm');
    });

    // Dockerfile
    it('routes Dockerfile tasks to engineering-devops-automator', () => {
      const result = filter.match('Optimize the Dockerfile for production');
      expect(result!.agentSlug).toBe('engineering-devops-automator');
      expect(result!.routeName).toBe('dockerfile');
    });

    // docker-compose
    it('routes docker-compose.yml to engineering-devops-automator', () => {
      const result = filter.match('Update docker-compose.yml to add Redis service');
      expect(result!.agentSlug).toBe('engineering-devops-automator');
      expect(result!.routeName).toBe('docker-compose');
    });

    // Solidity
    it('routes .sol files to engineering-solidity-smart-contract-engineer', () => {
      const result = filter.match('Audit Token.sol for reentrancy bugs');
      expect(result!.agentSlug).toBe('engineering-solidity-smart-contract-engineer');
    });

    // Git operations
    it('routes git blame to engineering-git-workflow-master', () => {
      const result = filter.match('Run git blame on src/auth.ts');
      expect(result!.agentSlug).toBe('engineering-git-workflow-master');
    });

    it('routes git rebase to engineering-git-workflow-master', () => {
      const result = filter.match('Perform git rebase onto main');
      expect(result!.agentSlug).toBe('engineering-git-workflow-master');
    });

    // Terraform
    it('routes terraform tasks to engineering-devops-automator', () => {
      const result = filter.match('Write terraform module for VPC');
      expect(result!.agentSlug).toBe('engineering-devops-automator');
      expect(result!.routeName).toBe('terraform');
    });

    // GitHub Actions
    it('routes GitHub Actions to engineering-devops-automator', () => {
      const result = filter.match('Set up GitHub Actions CI pipeline');
      expect(result!.agentSlug).toBe('engineering-devops-automator');
      expect(result!.routeName).toBe('github-actions');
    });

    // Kubernetes
    it('routes Kubernetes tasks to engineering-devops-automator', () => {
      const result = filter.match('Deploy to Kubernetes cluster');
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });

    it('routes k8s shorthand to engineering-devops-automator', () => {
      const result = filter.match('Fix k8s deployment manifest');
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });

    // MCP
    it('routes MCP server tasks to specialized-mcp-builder', () => {
      const result = filter.match('Build an MCP server for data pipeline');
      expect(result!.agentSlug).toBe('specialized-mcp-builder');
    });

    // ZK proofs
    it('routes zkp/circom tasks to zk-steward', () => {
      const result = filter.match('Write a circom circuit for age verification');
      expect(result!.agentSlug).toBe('zk-steward');
    });

    it('routes zkp keyword to zk-steward', () => {
      const result = filter.match('Implement ZKP verification logic');
      expect(result!.agentSlug).toBe('zk-steward');
    });

    // React Native
    it('routes React Native tasks to engineering-react-native-developer', () => {
      const result = filter.match('Build React Native login screen');
      expect(result!.agentSlug).toBe('engineering-react-native-developer');
    });

    // iOS / Swift
    it('routes Swift tasks to engineering-ios-swift-developer', () => {
      const result = filter.match('Implement SwiftUI navigation');
      expect(result!.agentSlug).toBe('engineering-ios-swift-developer');
    });

    // Android / Kotlin
    it('routes Kotlin tasks to engineering-android-kotlin-developer', () => {
      const result = filter.match('Write Kotlin data class for user model');
      expect(result!.agentSlug).toBe('engineering-android-kotlin-developer');
    });

    // Embedded / Firmware
    it('routes firmware tasks to engineering-embedded-firmware-engineer', () => {
      const result = filter.match('Flash firmware to the microcontroller');
      expect(result!.agentSlug).toBe('engineering-embedded-firmware-engineer');
    });

    // Blender
    it('routes Blender tasks to specialized-blender-3d-artist', () => {
      const result = filter.match('Create a blender model for the character');
      expect(result!.agentSlug).toBe('specialized-blender-3d-artist');
    });

    // Unreal Engine
    it('routes Unreal Engine tasks to specialized-unreal-engine-developer', () => {
      const result = filter.match('Set up Unreal Engine project');
      expect(result!.agentSlug).toBe('specialized-unreal-engine-developer');
    });

    // Unity
    it('routes Unity tasks to specialized-unity-developer', () => {
      const result = filter.match('Build Unity game level');
      expect(result!.agentSlug).toBe('specialized-unity-developer');
    });

    // Godot
    it('routes Godot tasks to specialized-godot-developer', () => {
      const result = filter.match('Write GDScript for player movement in Godot');
      expect(result!.agentSlug).toBe('specialized-godot-developer');
    });

    // SEO
    it('routes SEO tasks to specialized-seo-strategist', () => {
      const result = filter.match('Improve SEO for the landing page');
      expect(result!.agentSlug).toBe('specialized-seo-strategist');
    });

    // Supply chain
    it('routes supply chain tasks to engineering-supply-chain-security', () => {
      const result = filter.match('Generate SBOM for the project');
      expect(result!.agentSlug).toBe('engineering-supply-chain-security');
    });

    // Salesforce
    it('routes Salesforce tasks to specialized-salesforce-developer', () => {
      const result = filter.match('Write Apex trigger for Salesforce');
      expect(result!.agentSlug).toBe('specialized-salesforce-developer');
    });

    // Case insensitivity
    it('matches case insensitively for CVE', () => {
      const result = filter.match('fix cve-2024-99999 now');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-security-engineer');
    });

    it('matches case insensitively for Dockerfile', () => {
      const result = filter.match('update the DOCKERFILE');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-devops-automator');
    });

    it('matches case insensitively for owasp', () => {
      const result = filter.match('check owasp compliance');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('engineering-security-engineer');
    });
  });

  describe('addRule()', () => {
    it('custom rule takes priority over defaults', () => {
      filter.addRule({
        pattern: /\bDockerfile\b/i,
        agentSlug: 'my-custom-docker-agent',
        routeName: 'custom-docker',
        description: 'Custom Docker rule',
      });
      const result = filter.match('Update the Dockerfile');
      expect(result!.agentSlug).toBe('my-custom-docker-agent');
      expect(result!.routeName).toBe('custom-docker');
    });

    it('added rule matches before default rules', () => {
      filter.addRule({
        pattern: /\bmy-keyword\b/i,
        agentSlug: 'custom-agent',
        routeName: 'custom-route',
        description: 'Custom rule',
      });
      const result = filter.match('Handle my-keyword task');
      expect(result).not.toBeNull();
      expect(result!.agentSlug).toBe('custom-agent');
    });
  });

  describe('getRules()', () => {
    it('returns at least 30 default rules', () => {
      const rules = filter.getRules();
      expect(rules.length).toBeGreaterThanOrEqual(30);
    });

    it('returns a copy (mutating it does not affect the filter)', () => {
      const rules = filter.getRules();
      const originalLength = rules.length;
      // getRules returns ReadonlyArray but we cast to test immutability
      (rules as any).push({ pattern: /test/, agentSlug: 'x', routeName: 'x', description: 'x' });
      expect(filter.getRules().length).toBe(originalLength);
    });

    it('includes custom rules when constructed with them', () => {
      const customFilter = new KeywordPreFilter([
        { pattern: /\bfoo\b/, agentSlug: 'foo-agent', routeName: 'foo-route', description: 'Foo' },
      ]);
      const rules = customFilter.getRules();
      expect(rules.length).toBe(DEFAULT_KEYWORD_ROUTES.length + 1);
      expect(rules[0].routeName).toBe('foo-route');
    });
  });

  describe('DEFAULT_KEYWORD_ROUTES', () => {
    it('exports at least 30 rules', () => {
      expect(DEFAULT_KEYWORD_ROUTES.length).toBeGreaterThanOrEqual(30);
    });

    it('each rule has required fields', () => {
      for (const rule of DEFAULT_KEYWORD_ROUTES) {
        expect(rule.pattern).toBeInstanceOf(RegExp);
        expect(typeof rule.agentSlug).toBe('string');
        expect(typeof rule.routeName).toBe('string');
        expect(typeof rule.description).toBe('string');
      }
    });
  });
});

describe('RouteLayer keyword integration', () => {
  it('returns method=keyword for Dockerfile task with empty routes', async () => {
    const layer = new RouteLayer({ routes: [] });
    const result = await layer.route('Optimize the Dockerfile for production');
    expect(result.method).toBe('keyword');
    expect(result.agentSlug).toBe('engineering-devops-automator');
    expect(result.confidence).toBe(1.0);
  });

  it('does NOT return keyword match when enableKeywordFilter=false', async () => {
    // Use a real route so semantic routing can function
    const layer = new RouteLayer({
      routes: [{
        name: 'fallback-coder',
        agentSlug: 'coder',
        utterances: ['write code', 'implement feature', 'build module'],
        threshold: 0.1,
        fallbackToLLM: false,
      }],
      enableKeywordFilter: false,
    });
    const result = await layer.route('Optimize the Dockerfile for production');
    expect(result.method).not.toBe('keyword');
  });

  it('keyword match skips semantic initialization', async () => {
    const layer = new RouteLayer({ routes: [] });
    // Should return immediately from keyword filter without needing routes
    const result = await layer.route('Fix CVE-2024-12345');
    expect(result.method).toBe('keyword');
    expect(result.agentSlug).toBe('engineering-security-engineer');
  });
});
