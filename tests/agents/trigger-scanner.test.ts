/**
 * Tests for MicroAgent Trigger Patterns (Task 32).
 *
 * Uses vitest globals (describe, it, expect, vi, beforeEach).
 * Run: npx vitest run tests/agents/trigger-scanner.test.ts --globals
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  TriggerPattern,
  TriggerIndex as TriggerIndexType,
} from '../../packages/@monomind/shared/src/types/trigger.js';
import { TriggerScanner } from '../../packages/@monomind/cli/src/agents/trigger-scanner.js';
import {
  save,
  load,
  DEFAULT_TRIGGER_INDEX_PATH,
} from '../../packages/@monomind/cli/src/agents/trigger-index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'trigger-test-'));
}

function makePattern(overrides: Partial<TriggerPattern> = {}): TriggerPattern {
  return {
    pattern: '\\btest\\b',
    mode: 'inject',
    priority: 0,
    agentSlug: 'test-agent',
    ...overrides,
  };
}

function writeAgentMd(dir: string, filename: string, frontmatter: string): void {
  writeFileSync(
    join(dir, filename),
    `---\n${frontmatter}\n---\n\n# Agent\n\nBody text.\n`,
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// TriggerScanner — scan()
// ---------------------------------------------------------------------------

describe('TriggerScanner', () => {
  describe('scan()', () => {
    it('returns empty array when no patterns match', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bfoo\\b', agentSlug: 'foo-agent' }),
      ]);
      const result = scanner.scan('nothing relevant here');
      expect(result).toEqual([]);
    });

    it('returns matching agents when pattern matches', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\b(auth|jwt)\\b', agentSlug: 'security-agent' }),
      ]);
      const result = scanner.scan('Review the JWT validation in auth.ts');
      expect(result).toHaveLength(1);
      expect(result[0].agentSlug).toBe('security-agent');
      expect(result[0].matchedText).toBe('JWT');
    });

    it('takeover mode short-circuits and returns only that agent', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bsolidity\\b', mode: 'takeover', priority: 10, agentSlug: 'solidity-agent' }),
        makePattern({ pattern: '\\bcontract\\b', mode: 'inject', priority: 5, agentSlug: 'contract-agent' }),
      ]);
      const result = scanner.scan('Fix the solidity contract');
      expect(result).toHaveLength(1);
      expect(result[0].agentSlug).toBe('solidity-agent');
      expect(result[0].mode).toBe('takeover');
    });

    it('inject mode adds agent to candidates without removing others', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bauth\\b', mode: 'inject', priority: 10, agentSlug: 'auth-agent' }),
        makePattern({ pattern: '\\bjwt\\b', mode: 'inject', priority: 5, agentSlug: 'jwt-agent' }),
      ]);
      const result = scanner.scan('Review JWT auth handler');
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.agentSlug)).toContain('auth-agent');
      expect(result.map((m) => m.agentSlug)).toContain('jwt-agent');
    });

    it('patterns are tested in priority order (descending)', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bfix\\b', mode: 'inject', priority: 1, agentSlug: 'low-prio' }),
        makePattern({ pattern: '\\bfix\\b', mode: 'inject', priority: 100, agentSlug: 'high-prio' }),
        makePattern({ pattern: '\\bfix\\b', mode: 'inject', priority: 50, agentSlug: 'mid-prio' }),
      ]);
      const result = scanner.scan('fix the bug');
      // All three match "fix" — verify ordering
      expect(result[0].agentSlug).toBe('high-prio');
      expect(result[1].agentSlug).toBe('mid-prio');
      expect(result[2].agentSlug).toBe('low-prio');
    });

    it('takeover at lower priority still short-circuits once reached', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bbug\\b', mode: 'inject', priority: 100, agentSlug: 'inject-first' }),
        makePattern({ pattern: '\\bbug\\b', mode: 'takeover', priority: 50, agentSlug: 'takeover-agent' }),
        makePattern({ pattern: '\\bbug\\b', mode: 'inject', priority: 1, agentSlug: 'never-reached' }),
      ]);
      const result = scanner.scan('fix the bug');
      // inject-first matches first (priority 100), then takeover at 50 fires
      // The takeover short-circuits, so only takeover is returned
      expect(result).toHaveLength(1);
      expect(result[0].agentSlug).toBe('takeover-agent');
      expect(result[0].mode).toBe('takeover');
    });

    it('regex patterns support case-insensitive matching', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bDOCKER\\b', agentSlug: 'docker-agent' }),
      ]);
      const result = scanner.scan('Fix the docker image');
      expect(result).toHaveLength(1);
      expect(result[0].agentSlug).toBe('docker-agent');
    });

    it('regex patterns with word boundaries work correctly', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bgit\\b', agentSlug: 'git-agent' }),
      ]);
      // "git" should match, "digital" should not
      expect(scanner.scan('run git rebase')).toHaveLength(1);
      expect(scanner.scan('digital transformation')).toHaveLength(0);
    });

    it('invalid regex patterns are skipped gracefully', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '[invalid(regex', agentSlug: 'bad-agent' }),
        makePattern({ pattern: '\\bgood\\b', agentSlug: 'good-agent' }),
      ]);
      // The invalid pattern should be silently dropped
      expect(scanner.size).toBe(1);
      const result = scanner.scan('this is good');
      expect(result).toHaveLength(1);
      expect(result[0].agentSlug).toBe('good-agent');
    });

    it('handles empty task description', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bfoo\\b', agentSlug: 'foo-agent' }),
      ]);
      expect(scanner.scan('')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // buildIndex()
  // ---------------------------------------------------------------------------

  describe('buildIndex()', () => {
    it('extracts triggers from agent markdown frontmatter', () => {
      const dir = makeTmpDir();
      writeAgentMd(dir, 'security-agent.md', [
        'name: Security Agent',
        'triggers:',
        '  - pattern: "\\\\b(auth|jwt)\\\\b"',
        '    mode: "inject"',
        '    priority: 10',
      ].join('\n'));

      const scanner = new TriggerScanner();
      const index = scanner.buildIndex(dir);

      expect(index.totalAgentsScanned).toBe(1);
      expect(index.patterns).toHaveLength(1);
      expect(index.patterns[0].agentSlug).toBe('security-agent');
      expect(index.patterns[0].mode).toBe('inject');
      expect(index.patterns[0].priority).toBe(10);
      expect(typeof index.builtAt).toBe('string');

      rmSync(dir, { recursive: true, force: true });
    });

    it('scans nested directories for .md files', () => {
      const dir = makeTmpDir();
      const sub = join(dir, 'engineering');
      mkdirSync(sub);
      writeAgentMd(sub, 'devops.md', [
        'name: DevOps',
        'triggers:',
        '  - pattern: "\\\\bdocker\\\\b"',
        '    mode: "inject"',
      ].join('\n'));
      writeAgentMd(dir, 'coder.md', [
        'name: Coder',
        'triggers:',
        '  - pattern: "\\\\bcode\\\\b"',
        '    mode: "inject"',
      ].join('\n'));

      const scanner = new TriggerScanner();
      const index = scanner.buildIndex(dir);

      expect(index.totalAgentsScanned).toBe(2);
      expect(index.patterns).toHaveLength(2);

      rmSync(dir, { recursive: true, force: true });
    });

    it('skips .md files with no triggers in frontmatter', () => {
      const dir = makeTmpDir();
      writeAgentMd(dir, 'plain.md', 'name: Plain Agent');

      const scanner = new TriggerScanner();
      const index = scanner.buildIndex(dir);

      expect(index.totalAgentsScanned).toBe(1);
      expect(index.patterns).toHaveLength(0);

      rmSync(dir, { recursive: true, force: true });
    });

    it('defaults mode to inject and priority to 0 when omitted', () => {
      const dir = makeTmpDir();
      writeAgentMd(dir, 'minimal.md', [
        'name: Minimal',
        'triggers:',
        '  - pattern: "\\\\bfoo\\\\b"',
      ].join('\n'));

      const scanner = new TriggerScanner();
      const index = scanner.buildIndex(dir);

      expect(index.patterns).toHaveLength(1);
      expect(index.patterns[0].mode).toBe('inject');
      expect(index.patterns[0].priority).toBe(0);

      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ---------------------------------------------------------------------------
  // addPattern() / removePattern()
  // ---------------------------------------------------------------------------

  describe('addPattern()', () => {
    it('adds to the index and is findable by scan', () => {
      const scanner = new TriggerScanner();
      expect(scanner.size).toBe(0);

      scanner.addPattern(makePattern({ pattern: '\\bhelm\\b', agentSlug: 'k8s-agent' }));
      expect(scanner.size).toBe(1);

      const result = scanner.scan('deploy with helm');
      expect(result).toHaveLength(1);
      expect(result[0].agentSlug).toBe('k8s-agent');
    });
  });

  describe('removePattern()', () => {
    it('removes a specific pattern by agentSlug and pattern', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bfoo\\b', agentSlug: 'foo-agent' }),
        makePattern({ pattern: '\\bbar\\b', agentSlug: 'bar-agent' }),
      ]);

      const removed = scanner.removePattern('foo-agent', '\\bfoo\\b');
      expect(removed).toBe(true);
      expect(scanner.size).toBe(1);
      expect(scanner.scan('foo bar')).toHaveLength(1);
      expect(scanner.scan('foo bar')[0].agentSlug).toBe('bar-agent');
    });

    it('returns false when pattern is not found', () => {
      const scanner = new TriggerScanner([
        makePattern({ pattern: '\\bfoo\\b', agentSlug: 'foo-agent' }),
      ]);
      expect(scanner.removePattern('nonexistent', '\\bfoo\\b')).toBe(false);
      expect(scanner.removePattern('foo-agent', '\\bnonexistent\\b')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Trigger Index persistence (save / load)
  // ---------------------------------------------------------------------------

  describe('trigger-index persistence', () => {
    it('save() and load() round-trip correctly', () => {
      const dir = makeTmpDir();
      const path = join(dir, 'trigger-index.json');

      const index: TriggerIndexType = {
        patterns: [
          makePattern({ pattern: '\\bauth\\b', agentSlug: 'auth-agent', priority: 10 }),
        ],
        builtAt: '2026-04-01T00:00:00.000Z',
        totalAgentsScanned: 5,
      };

      save(index, path);
      const loaded = load(path);

      expect(loaded.patterns).toHaveLength(1);
      expect(loaded.patterns[0].agentSlug).toBe('auth-agent');
      expect(loaded.builtAt).toBe('2026-04-01T00:00:00.000Z');
      expect(loaded.totalAgentsScanned).toBe(5);

      rmSync(dir, { recursive: true, force: true });
    });

    it('load() throws on missing file', () => {
      expect(() => load('/nonexistent/path/trigger-index.json')).toThrow();
    });
  });
});
