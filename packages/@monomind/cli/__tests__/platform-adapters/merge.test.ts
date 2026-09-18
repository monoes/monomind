import { describe, expect, it } from 'vitest';
import {
  mergeManagedBlock,
  mergeSkillFileManagedBlock,
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

  it('does not duplicate the body when the legacy skill copier already wrote it unwrapped', () => {
    const rendered = '---\nname: mastermind-plan\ndescription: Plan safely.\n---\n\n# Plan\n';
    const marker = 'skills:claude:mastermind-plan';

    // executor.ts always runs copySkills — a raw, unwrapped copy of this same
    // canonical source — before installPlatform's managed-block install for
    // any skill that appears in both SKILLS_MAP and MASTERMIND_SKILLS. So
    // `existing` here is exactly `rendered`, not ''.
    const first = mergeSkillManagedBlock(rendered, marker, rendered);
    expect(first.diagnostics).toEqual([]);
    expect(first.content.match(/# Plan/g)).toHaveLength(1);
    expect(first.content).toContain('# monomind:start skills:claude:mastermind-plan');

    // A second `init` run: the legacy copier clobbers the file back to the
    // raw canonical source again before the merge runs, every time.
    const second = mergeSkillManagedBlock(rendered, marker, rendered);
    expect(second.content).toBe(first.content);
  });
});

describe('portable skill reference files (GH #286)', () => {
  const marker = 'skills:claude:mastermind:references/codex-tools.md';
  const reference = [
    '# Codex Tool Mapping',
    '',
    'Skills speak in actions.',
    '',
    '## Subagent dispatch',
    '',
    '`spawn_agent`.',
    '',
    '## Web access',
    '',
    '`web_search`.',
    '',
    '## Limits',
    '',
    'No native fetch tool.',
    '',
  ].join('\n');
  const wrapped = `# monomind:start ${marker}\n${reference.trimEnd()}\n# monomind:end ${marker}\n`;
  const titles = (text: string): number => text.match(/^# Codex Tool Mapping$/gm)?.length ?? 0;

  it('wraps a pre-marker file instead of appending a second copy', () => {
    const once = mergeSkillFileManagedBlock(reference, marker, reference);

    expect(titles(once)).toBe(1);
    expect(once).toBe(wrapped);
  });

  it('is byte-identical on a second run', () => {
    const once = mergeSkillFileManagedBlock(reference, marker, reference);
    const twice = mergeSkillFileManagedBlock(once, marker, reference);

    expect(twice).toBe(once);
  });

  it('heals a file an earlier version already doubled', () => {
    const doubled = `${reference}${wrapped}`;
    const healed = mergeSkillFileManagedBlock(doubled, marker, reference);

    expect(titles(healed)).toBe(1);
    expect(healed).toBe(wrapped);
  });

  it('replaces a stale same-marker block in place rather than appending beside it', () => {
    const stale = `# monomind:start ${marker}\n# Codex Tool Mapping\n\nOld mapping.\n# monomind:end ${marker}\n`;
    const migrated = mergeSkillFileManagedBlock(stale, marker, reference);

    expect(migrated).toBe(wrapped);
    expect(migrated).not.toContain('Old mapping.');
  });

  it('leaves hand-authored text on either side of the generated body in place', () => {
    const authored = `# Project notes\n\nKeep the top.\n\n${reference}# Local addendum\n\nKeep the bottom.\n`;
    const merged = mergeSkillFileManagedBlock(authored, marker, reference);

    expect(titles(merged)).toBe(1);
    expect(merged).toBe(
      `# Project notes\n\nKeep the top.\n\n${wrapped}# Local addendum\n\nKeep the bottom.\n`,
    );
  });

  it('never absorbs the same body out of another platform block in a shared root', () => {
    // .agents/skills is the skill root for opencode, kimi and codex at once,
    // so each adapter meets the others' blocks holding this exact body.
    const opencode = marker.replace('claude', 'opencode');
    const installed = `# monomind:start ${opencode}\n${reference.trimEnd()}\n# monomind:end ${opencode}\n`;
    const merged = mergeSkillFileManagedBlock(installed, marker, reference);

    expect(merged).toBe(`${installed}${wrapped}`);
    expect(mergeSkillFileManagedBlock(merged, marker, reference)).toBe(merged);
  });
});
