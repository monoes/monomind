/**
 * Every slash command must carry a one-line `description:` in valid YAML
 * frontmatter. 97 of 133 had none: the 41 mastermind commands put theirs in a
 * leading HTML comment and the analysis/hooks/agents/... commands had only a
 * `name:`. Claude Code's command list, the kimi converters (which then invent
 * "<category> <name> command (monomind)") and the pick index all read the
 * frontmatter description.
 *
 * READMEs, `_`-prefixed includes and `references/` notes are not commands
 * (see isConvertibleCommand in src/init/write-kimicode.ts) and are exempt.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMAND_TREES = ['.claude/commands', 'packages/@monomind/cli/.claude/commands'];

function commandFiles(tree: string): string[] {
  const root = join(REPO_ROOT, tree);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith('.md') && !e.name.startsWith('._')
          ? [join(dir, e.name)]
          : [],
    );
  return walk(root)
    .map((f) => relative(root, f))
    .filter((rel) => {
      const segs = rel.split('/');
      const base = segs[segs.length - 1];
      return (
        base.toLowerCase() !== 'readme.md' && !base.startsWith('_') && !segs.includes('references')
      );
    })
    .map((rel) => `${tree}/${rel}`);
}

function descriptionProblem(text: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return 'no frontmatter';
  let data: Record<string, unknown>;
  try {
    data = parse(m[1], { strict: true }) ?? {};
  } catch (err) {
    return `invalid YAML: ${(err as Error).message.split('\n')[0]}`;
  }
  const d = data.description;
  if (typeof d !== 'string' || d.trim() === '') return 'no description';
  if (d.includes('\n')) return 'description is not one line';
  return null;
}

describe('slash command frontmatter', () => {
  for (const tree of COMMAND_TREES) {
    it(`every command in ${tree} has a one-line description`, () => {
      const files = commandFiles(tree);
      expect(files.length).toBeGreaterThan(100);
      const bad = files
        .map((rel) => [rel, descriptionProblem(readFileSync(join(REPO_ROOT, rel), 'utf8'))])
        .filter(([, problem]) => problem !== null);
      expect(bad).toEqual([]);
    });
  }
});
