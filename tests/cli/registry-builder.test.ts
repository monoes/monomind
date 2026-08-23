/**
 * Tests for registry-builder.ts — frontmatter parsing and trigger extraction.
 *
 * Covers the fix for GitHub issue #113: nested YAML trigger lists were silently
 * dropped because parseFrontmatter only understood flat key:value lines and
 * inline bracket arrays.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRegistry } from '../../packages/@monomind/cli/src/agents/registry-builder.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-builder-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Helper: write an agent .md file and build the registry from tmpDir. */
function writeAndBuild(filename: string, content: string) {
  fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');
  return buildRegistry(tmpDir);
}

// ── Nested YAML triggers (issue #113) ───────────────────────────────────────

describe('nested YAML trigger parsing (issue #113)', () => {
  it('parses triggers with nested - pattern: / mode: lines', () => {
    const registry = writeAndBuild(
      'test-agent.md',
      [
        '---',
        'name: Test Agent',
        'triggers:',
        '  - pattern: "(foo|bar)"',
        '    mode: "regex"',
        '  - pattern: "(baz)"',
        '    mode: "exact"',
        '---',
        '',
        '# Test Agent',
      ].join('\n'),
    );

    expect(registry.agents).toHaveLength(1);
    const agent = registry.agents[0];
    expect(agent.triggers).toHaveLength(2);
    expect(agent.triggers[0]).toEqual({
      pattern: '(foo|bar)',
      mode: 'regex',
    });
    expect(agent.triggers[1]).toEqual({
      pattern: '(baz)',
      mode: 'exact',
    });
  });

  it('parses nested triggers that are indented under a capability block', () => {
    const registry = writeAndBuild(
      'nested-capability.md',
      [
        '---',
        'name: Nested Capability Agent',
        'capability:',
        '  role: tester',
        '  triggers:',
        '    - pattern: "(test|spec)"',
        '      mode: "glob"',
        '    - pattern: "(jest|vitest)"',
        '      mode: "regex"',
        '---',
        '',
        '# Agent',
      ].join('\n'),
    );

    expect(registry.agents).toHaveLength(1);
    const agent = registry.agents[0];
    // The triggers key inside capability: is parsed at the same flat level
    expect(agent.triggers).toHaveLength(2);
    expect(agent.triggers[0].pattern).toBe('(test|spec)');
    expect(agent.triggers[1].pattern).toBe('(jest|vitest)');
  });

  it('defaults mode to glob when nested trigger omits mode', () => {
    const registry = writeAndBuild(
      'no-mode.md',
      [
        '---',
        'name: No Mode Agent',
        'triggers:',
        '  - pattern: "hello"',
        '---',
        '',
        '# Agent',
      ].join('\n'),
    );

    expect(registry.agents[0].triggers).toHaveLength(1);
    expect(registry.agents[0].triggers[0]).toEqual({
      pattern: 'hello',
      mode: 'glob',
    });
  });
});

// ── Backward compatibility ──────────────────────────────────────────────────

describe('backward compatibility', () => {
  it('parses inline bracket-array triggers', () => {
    const registry = writeAndBuild(
      'bracket.md',
      ['---', 'name: Bracket Agent', 'triggers: [alpha, beta, gamma]', '---', '', '# Agent'].join(
        '\n',
      ),
    );

    const agent = registry.agents[0];
    expect(agent.triggers).toHaveLength(3);
    expect(agent.triggers.map((t) => t.pattern)).toEqual(['alpha', 'beta', 'gamma']);
    // Bracket-array items default to glob mode
    agent.triggers.forEach((t) => expect(t.mode).toBe('glob'));
  });

  it('parses a single-string trigger value', () => {
    const registry = writeAndBuild(
      'single.md',
      ['---', 'name: Single Agent', 'triggers: my-trigger', '---', '', '# Agent'].join('\n'),
    );

    expect(registry.agents[0].triggers).toEqual([{ pattern: 'my-trigger', mode: 'glob' }]);
  });

  it('returns empty triggers when triggers key is absent', () => {
    const registry = writeAndBuild(
      'no-triggers.md',
      ['---', 'name: No Triggers Agent', '---', '', '# Agent'].join('\n'),
    );

    expect(registry.agents[0].triggers).toEqual([]);
  });

  it('parses flat key-value pairs without disrupting them', () => {
    const registry = writeAndBuild(
      'flat.md',
      [
        '---',
        'name: Flat Agent',
        'version: "1.2.3"',
        'deprecated: true',
        'tools: [Read, Write, Bash]',
        '---',
        '',
        '# Agent',
      ].join('\n'),
    );

    const agent = registry.agents[0];
    expect(agent.name).toBe('Flat Agent');
    expect(agent.version).toBe('1.2.3');
    expect(agent.deprecated).toBe(true);
    expect(agent.tools).toEqual(['Read', 'Write', 'Bash']);
  });
});

// ── Simple nested string lists ──────────────────────────────────────────────

describe('nested simple string lists', () => {
  it('parses a key with simple - value list items', () => {
    const registry = writeAndBuild(
      'simple-list.md',
      [
        '---',
        'name: Simple List Agent',
        'capabilities:',
        '  - code-review',
        '  - testing',
        '  - deployment',
        '---',
        '',
        '# Agent',
      ].join('\n'),
    );

    const agent = registry.agents[0];
    expect(agent.capabilities).toEqual(['code-review', 'testing', 'deployment']);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles keys after a nested block correctly', () => {
    const registry = writeAndBuild(
      'after-nested.md',
      [
        '---',
        'name: After Nested Agent',
        'triggers:',
        '  - pattern: "foo"',
        '    mode: "glob"',
        'deprecated: false',
        '---',
        '',
        '# Agent',
      ].join('\n'),
    );

    const agent = registry.agents[0];
    expect(agent.triggers).toHaveLength(1);
    expect(agent.triggers[0].pattern).toBe('foo');
    expect(agent.deprecated).toBe(false);
  });

  it('handles blank lines within nested blocks', () => {
    const registry = writeAndBuild(
      'blank-lines.md',
      [
        '---',
        'name: Blank Lines Agent',
        'triggers:',
        '  - pattern: "alpha"',
        '    mode: "glob"',
        '',
        '  - pattern: "beta"',
        '    mode: "regex"',
        '---',
        '',
        '# Agent',
      ].join('\n'),
    );

    const agent = registry.agents[0];
    expect(agent.triggers).toHaveLength(2);
    expect(agent.triggers[0].pattern).toBe('alpha');
    expect(agent.triggers[1].pattern).toBe('beta');
  });
});
