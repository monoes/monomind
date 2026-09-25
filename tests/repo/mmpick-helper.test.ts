/**
 * `mmpick` is a shell helper (local `monomind pick` only, never npx, with a
 * version check) that mastermind skills paste into their bash blocks. It was
 * defined in mastermind-agent-select, mastermind-idea (twice) and
 * commands/mastermind/master.md, while mastermind-review, -research and
 * -release CALLED it without defining it — each bash block runs in a fresh
 * shell, so the call failed with "command not found" and silently fell back
 * to the default agent.
 *
 * Shell state does not survive between Bash tool calls, so the rule is: a
 * fenced block that calls mmpick defines it, and every definition is
 * byte-identical to the canonical one in mastermind-agent-select/SKILL.md.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TREES = [
  '.claude/skills',
  '.claude/commands',
  '.agents/skills',
  '.gemini/skills',
  '.kimi-code/skills',
  '.kimi-code/plugin/commands',
  'packages/@monomind/cli/.claude/skills',
  'packages/@monomind/cli/.claude/commands',
];

const DEFINITION = /^mmpick\(\) \{[\s\S]*?done; return 127; \}$/m;

function markdownFiles(rel: string): string[] {
  const root = join(REPO_ROOT, rel);
  if (!existsSync(root)) return [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
    );
  return walk(root);
}

function fencedBlocks(text: string): string[] {
  // A closing fence carries no info string (CommonMark), so ```bash inside a
  // JS template string does not close the ```javascript block around it.
  return [...text.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)].map((m) => m[1]);
}

/** True when a block runs mmpick (outside a shell or JS comment). */
function callsMmpick(block: string): boolean {
  return block
    .split('\n')
    .some((line) => /\bmmpick\s+-/.test(line.replace(/(^|\s)(#|\/\/).*$/, '')));
}

const canonical = DEFINITION.exec(
  readFileSync(join(REPO_ROOT, '.claude/skills/mastermind-agent-select/SKILL.md'), 'utf8'),
)?.[0];

describe('mmpick helper', () => {
  it('has a canonical definition in mastermind-agent-select', () => {
    expect(canonical).toBeTruthy();
  });

  it('every code block that calls mmpick defines it, identically to the canonical one', () => {
    const problems: string[] = [];
    for (const tree of TREES) {
      for (const file of markdownFiles(tree)) {
        const rel = file.slice(REPO_ROOT.length + 1);
        for (const block of fencedBlocks(readFileSync(file, 'utf8'))) {
          const def = DEFINITION.exec(block)?.[0];
          if (def !== undefined && def !== canonical) problems.push(`${rel}: definition differs`);
          if (callsMmpick(block) && def === undefined) {
            problems.push(`${rel}: calls mmpick in a block that does not define it`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
