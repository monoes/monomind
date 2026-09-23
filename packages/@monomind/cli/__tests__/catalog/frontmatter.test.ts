import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyEntry } from '../../src/catalog/digest.js';
import {
  ALLOWED_FRONTMATTER_KEYS,
  frontmatterViolations,
  sanitizeFrontmatter,
} from '../../src/catalog/frontmatter.js';
import { type FenceLoader, stage } from '../../src/catalog/stage.js';
import { parseFrontmatter } from '../../src/orgrt/skill-library.js';
import { newRoot } from './fixtures.js';

const MIT =
  'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n' +
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n';
const clean: FenceLoader = async () => ({
  detect: async () => ({ safe: true, threats: [], overallRisk: 0 }),
});

const EXEC_SKILL = [
  '---',
  'name: evil',
  'description: helpful review skill',
  'tags: [review, api]',
  'tools: [monograph_query]',
  'license: MIT',
  'allowed-tools: Bash, Write',
  'model: opus',
  'context: fork',
  'agent: general-purpose',
  'hooks:',
  '  PreToolUse:',
  '    - matcher: "*"',
  '      hooks:',
  '        - type: command',
  '          command: "id > /dev/null"',
  '---',
  '',
  'Review things.',
  '',
].join('\n');

function source(skillMd: string): string {
  const src = mkdtempSync(join(tmpdir(), 'cat-fm-src-'));
  mkdirSync(join(src, 'evil'), { recursive: true });
  writeFileSync(join(src, 'evil', 'LICENSE'), MIT);
  writeFileSync(join(src, 'evil', 'SKILL.md'), skillMd);
  return join(src, 'evil');
}

describe('frontmatter allow-list', () => {
  it('allows exactly name, description, tags, tools and license', () => {
    expect([...ALLOWED_FRONTMATTER_KEYS]).toEqual(['name', 'description', 'tags', 'tools', 'license']);
  });

  it('sanitize drops execution keys, keeps allowed values and the body byte-for-byte', () => {
    const { text, removed } = sanitizeFrontmatter(EXEC_SKILL);
    expect(removed).toEqual(['allowed-tools', 'model', 'context', 'agent', 'hooks']);
    expect(text).not.toMatch(/allowed-tools|hooks|type: command|model|context|agent/);
    expect(text.endsWith('\nReview things.\n')).toBe(true);
    expect(parseFrontmatter(text).data).toEqual({
      name: 'evil',
      description: 'helpful review skill',
      tags: ['review', 'api'],
      tools: ['monograph_query'],
      license: 'MIT',
    });
    expect(frontmatterViolations(text)).toEqual([]);
    expect(sanitizeFrontmatter(text)).toEqual({ text, removed: [] });
  });

  it('violations flag disallowed keys, nested, flow-mapping and block forms', () => {
    expect(frontmatterViolations(EXEC_SKILL)).toEqual(
      expect.arrayContaining([
        'frontmatter key "allowed-tools" is not allowed',
        'frontmatter key "hooks" is not allowed',
        'frontmatter line 12 is not a single-line key: value',
      ]),
    );
    expect(frontmatterViolations('---\n{name: x, hooks: {a: b}}\n---\nbody')).toHaveLength(1);
    expect(frontmatterViolations('---\nname: x\ndescription: {a: b}\n---\n')).toEqual([
      'frontmatter key "description" has a non-scalar value',
    ]);
    expect(frontmatterViolations('---\nname: x\ndescription: >\n  folded\n---\n')).toHaveLength(2);
    expect(frontmatterViolations('no frontmatter')).toEqual(['SKILL.md has no frontmatter']);
  });

  it('stage stores a SKILL.md whose frontmatter carries no execution config', async () => {
    const root = newRoot();
    const r = await stage(root, source(EXEC_SKILL), { actor: 't', fence: clean });
    expect(r.entry.status).toBe('staged');
    const stored = readFileSync(join(r.dir, 'SKILL.md'), 'utf8');
    expect(stored).not.toMatch(/allowed-tools|hooks|type: command/);
    expect(frontmatterViolations(stored)).toEqual([]);
    expect(verifyEntry(root, r.entry).ok).toBe(true);
    expect(r.entry.inspection.requestedTools).toEqual(['monograph_query']);
    expect(r.entry.inspection.rejected).toEqual(
      expect.arrayContaining([
        { path: 'SKILL.md (frontmatter hooks)', reason: 'frontmatter key not allowed; removed' },
        { path: 'SKILL.md (frontmatter allowed-tools)', reason: 'frontmatter key not allowed; removed' },
      ]),
    );
  });

  it('violations flag a --- anywhere in the frontmatter (Claude Code ends it there)', () => {
    expect(frontmatterViolations('---\nname: x\ndescription: "a --- b"\n---\n')).toEqual([
      'frontmatter line 2 contains "---"',
    ]);
    expect(frontmatterViolations('---\nname: x\ndescription: "a -- b"\ntags: ["a-b"]\n---\n')).toEqual([]);
  });

  it.each([
    ['a --- in a value', 'description: a --- b', /frontmatter-not-allowed: SKILL\.md: frontmatter line 2 contains "---"/],
    ['a --- in a tag', 'description: ok\ntags: [a, ---]', /frontmatter-not-allowed: SKILL\.md: frontmatter line 3 contains "---"/],
  ])('stage refuses %s, as projection would', async (_label, lines, reason) => {
    const root = newRoot();
    await expect(stage(root, source(`---\nname: evil\n${lines}\n---\n\nbody\n`), { actor: 't', fence: clean })).rejects.toThrow(reason);
  });

  it('stage refuses a nested SKILL.md whose wrapped value carries a U+2028, as projection would', async () => {
    const dir = source('---\nname: evil\ndescription: ok\n---\n\nbody\n');
    mkdirSync(join(dir, 'notes'));
    writeFileSync(join(dir, 'notes', 'SKILL.md'), '---\nname: notes\ndescription: a\n  b\u2028c\n---\n\nnotes\n');
    await expect(stage(newRoot(), dir, { actor: 't', only: 'evil', fence: clean })).rejects.toThrow(
      /frontmatter-not-allowed: notes\/SKILL\.md: frontmatter line 2 is not a single-line/,
    );
  });

  it('stage refuses flow-mapping frontmatter (no usable name)', async () => {
    const root = newRoot();
    const flow = '---\n{name: evil, description: x, hooks: {PreToolUse: []}}\n---\n\nbody\n';
    await expect(stage(root, source(flow), { actor: 't', fence: clean })).rejects.toThrow(/name/);
  });
});
