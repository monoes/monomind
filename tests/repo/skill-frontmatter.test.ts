/**
 * Every SKILL.md frontmatter block must be valid YAML. The loaders are
 * forgiving line-scanners, so an unquoted `: ` inside a description (e.g.
 * "Mastermind inbox — unified view ...: pending tool approvals, ...") loaded
 * fine here while any strict YAML consumer — another platform's skill loader,
 * a catalog importer — rejects the whole skill. Three skills carried exactly
 * that: mastermind-agent-detail, mastermind-inbox, mastermind-routine-detail.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_TREES = [
  '.claude/skills',
  '.agents/skills',
  '.gemini/skills',
  '.kimi-code/skills',
  'packages/@monomind/cli/.claude/skills',
];

function skillFiles(): string[] {
  const out: string[] = [];
  for (const tree of SKILL_TREES) {
    const dir = join(REPO_ROOT, tree);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'SKILL.md');
      if (existsSync(file) && statSync(file).isFile()) out.push(`${tree}/${name}/SKILL.md`);
    }
  }
  return out;
}

/** The YAML error for a file's frontmatter, or null when it parses to a mapping with name + description. */
function frontmatterError(text: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return 'no frontmatter block';
  let data: unknown;
  try {
    data = parse(m[1], { strict: true, uniqueKeys: true });
  } catch (err) {
    return (err as Error).message.split('\n')[0];
  }
  if (!data || typeof data !== 'object') return 'frontmatter is not a mapping';
  const { name, description } = data as Record<string, unknown>;
  if (typeof name !== 'string' || !name) return 'missing name';
  if (typeof description !== 'string' || !description) return 'missing description';
  return null;
}

describe('SKILL.md frontmatter is strict YAML', () => {
  it('rejects an unquoted ": " in a plain-scalar description', () => {
    expect(frontmatterError('---\nname: x\ndescription: Inbox — view: approvals\n---\n')).not.toBe(
      null,
    );
    expect(frontmatterError('---\nname: x\ndescription: "Inbox — view: approvals"\n---\n')).toBe(
      null,
    );
  });

  it('every SKILL.md in every tree parses, with a name and a description', () => {
    const files = skillFiles();
    expect(files.length).toBeGreaterThan(300);
    const bad = files
      .map((rel) => [rel, frontmatterError(readFileSync(join(REPO_ROOT, rel), 'utf8'))])
      .filter(([, err]) => err !== null);
    expect(bad).toEqual([]);
  });
});
