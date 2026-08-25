import { describe, expect, it } from 'vitest';
import {
  mergeManagedBlock,
  mergeSkillManagedBlock,
  mergeNamedEntry,
  removeManagedBlock,
  removeNamedEntry,
  safeJsonMerge,
} from '../../src/platform-adapters/merge.js';

describe('managed marker blocks', () => {
  it('replaces only the matching managed block and is idempotent', () => {
    const current = '[features]\nhooks = true\n\n# user comment\n';
    const once = mergeManagedBlock(current, 'hooks:codex', '[[hooks.PreToolUse]]\n');
    const twice = mergeManagedBlock(once, 'hooks:codex', '[[hooks.PreToolUse]]\n');

    expect(twice).toBe(once);
    expect(twice).toContain('[features]\nhooks = true');
    expect(twice).toContain('# user comment');
    expect(twice).toContain('# monomind:start hooks:codex');
    expect(twice).toContain('[[hooks.PreToolUse]]');
  });

  it('keeps sibling platform blocks when removing one managed block', () => {
    let content = '# repo intro\n';
    content = mergeManagedBlock(content, 'instructions:codex', 'codex rules\n');
    content = mergeManagedBlock(content, 'instructions:opencode', 'opencode rules\n');

    const afterUninstall = removeManagedBlock(content, 'instructions', 'codex');
    expect(afterUninstall).not.toContain('codex rules');
    expect(afterUninstall).toContain('opencode rules');
    expect(afterUninstall).toContain('# repo intro');
  });

  it('removes exactly its owned content without disturbing surrounding lines', () => {
    const content = '# before\n# monomind:start x:claude\nowned\n# monomind:end x:claude\n# after\n';

    expect(removeManagedBlock(content, 'x', 'claude')).toBe('# before\n# after\n');
  });

  it('leaves blocks with incomplete or mismatched markers untouched', () => {
    const incomplete = '# monomind:start x:claude\nuser content\n';
    const mismatched = '# monomind:start x:claude\nowned\n# monomind:end x:codex\n';

    expect(removeManagedBlock(incomplete, 'x', 'claude')).toBe(incomplete);
    expect(removeManagedBlock(mismatched, 'x', 'claude')).toBe(mismatched);
  });
});

describe('JSON named entries', () => {
  it('merges and removes a named entry idempotently while preserving foreign values', () => {
    const user = JSON.stringify({ mcpServers: { other: { command: 'x' } }, editor: { font: 12 } });
    const once = mergeNamedEntry(user, ['mcpServers', 'monomind'], { command: 'npx' });
    const twice = mergeNamedEntry(once, ['mcpServers', 'monomind'], { command: 'npx' });

    expect(twice).toBe(once);
    expect(JSON.parse(twice)).toMatchObject({
      mcpServers: { other: { command: 'x' }, monomind: { command: 'npx' } },
      editor: { font: 12 },
    });

    const removed = removeNamedEntry(twice, ['mcpServers'], 'monomind');
    expect(JSON.parse(removed)).toEqual({
      mcpServers: { other: { command: 'x' } },
      editor: { font: 12 },
    });
  });

  it('reports malformed JSON without mutating it', () => {
    const source = '{ broken';
    const result = safeJsonMerge(source, ['mcpServers', 'monomind'], {});

    expect(result.diagnostics[0]).toMatch(/^ERROR:/);
    expect(result.content).toBe(source);
  });

  it('does not mutate a scalar path segment', () => {
    const source = '{"mcpServers":false}';
    const result = safeJsonMerge(source, ['mcpServers', 'monomind'], { command: 'npx' });

    expect(result.content).toBe(source);
    expect(result.diagnostics[0]).toMatch(/^ERROR:/);
  });
});

describe('portable skill packages', () => {
  it('keeps SKILL.md frontmatter first while updating only its managed body', () => {
    const rendered = '---\nname: mastermind-plan\ndescription: Plan safely.\n---\n\n# Plan\n';
    const once = mergeSkillManagedBlock('', 'skills:codex:mastermind-plan', rendered);
    const twice = mergeSkillManagedBlock(
      `${once.content}\nUser guidance\n`,
      'skills:codex:mastermind-plan',
      rendered,
    );

    expect(twice.diagnostics).toEqual([]);
    expect(twice.content).toMatch(/^---\nname: mastermind-plan\ndescription: Plan safely\.\n---\n/);
    expect(twice.content).toContain('# monomind:start skills:codex:mastermind-plan');
    expect(twice.content).toContain('User guidance');
  });

  it('does not overwrite a foreign skill package', () => {
    const foreign = '---\nname: user-workflow\ndescription: User-owned.\n---\n\ncontent\n';
    const rendered = '---\nname: mastermind-plan\ndescription: Plan safely.\n---\n\n# Plan\n';
    const result = mergeSkillManagedBlock(foreign, 'skills:codex:mastermind-plan', rendered);

    expect(result.content).toBe(foreign);
    expect(result.diagnostics[0]).toMatch(/^ERROR: foreign SKILL\.md/);
  });
});
