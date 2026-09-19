/**
 * o-09: `mastermind/SKILL.md` is the router every platform loads first — it
 * tells a model which Mastermind workflow to load for a given task. Commit
 * `61396db8d` appended a second, stale router block instead of replacing the
 * first one. It was not a harmless duplicate: the new block (last in the
 * file, the position a model weights most) omitted `mastermind-idea` and
 * `mastermind-design` — the two gates the FIRST block itself calls
 * "mandatory" — and re-added a self-referential `mastermind` entry. It also
 * pointed at `.claude/commands/mastermind-master.md`, a path that has never
 * existed (the real file is `.claude/commands/mastermind/master.md`, and
 * only in two of the five trees).
 *
 * `claude-tree-parity.test.ts` (and `lint-skills.mjs`'s SYNCED_SKILLS check)
 * already guard CROSS-TREE byte-identity — that a fix applied to one tree
 * reaches all five. Neither says anything about the file's INTERNAL
 * consistency, which is what let a self-contradicting router ship
 * byte-identically into all five trees at once. This file is that guard.
 *
 * Five trees, enforced byte-identical by lint-skills.mjs's SYNCED_SKILLS set
 * (mirrors scripts/lint-skills.mjs's own SKILL_TREES list — kept in sync by
 * hand since importing an .mjs script's internal const into a .ts test is
 * more fragile than one more copy of five well-known paths).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveMastermindSkill } from '../../packages/@monomind/cli/src/mastermind/manifest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TREES = [
  { name: '.claude', skillsDir: join(REPO_ROOT, '.claude/skills') },
  { name: '.agents', skillsDir: join(REPO_ROOT, '.agents/skills') },
  { name: '.gemini', skillsDir: join(REPO_ROOT, '.gemini/skills') },
  { name: '.kimi-code', skillsDir: join(REPO_ROOT, '.kimi-code/skills') },
  {
    name: 'packages/@monomind/cli/.claude',
    skillsDir: join(REPO_ROOT, 'packages/@monomind/cli/.claude/skills'),
  },
];

function routerPath(tree: { skillsDir: string }): string {
  return join(tree.skillsDir, 'mastermind', 'SKILL.md');
}

/** Body text after the `---`-delimited YAML frontmatter. */
function bodyOf(content: string): string {
  const end = content.indexOf('\n---', content.indexOf('---') + 3);
  return end === -1 ? content : content.slice(end + 4);
}

/** Split the body into sections at each `# `-level heading (the router
 *  "blocks" — one per top-level heading, in file order). */
function sectionsOf(body: string): string[] {
  const lines = body.split('\n');
  const sections: string[] = [];
  let current: string[] = [];
  let started = false;
  for (const line of lines) {
    if (/^# /.test(line)) {
      if (started) sections.push(current.join('\n'));
      current = [line];
      started = true;
    } else if (started) {
      current.push(line);
    }
    // lines before the first `# ` heading (blank lines after frontmatter)
    // are not part of any section and are discarded.
  }
  if (started) sections.push(current.join('\n'));
  return sections;
}

describe.each(TREES)('mastermind router internal consistency — $name', (tree) => {
  const file = routerPath(tree);

  it('SKILL.md exists in this tree', () => {
    expect(existsSync(file), `${file} is missing`).toBe(true);
  });

  const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const body = bodyOf(content);
  const sections = sectionsOf(body);

  it('exactly one router block: one top-level heading, one "Load only the workflow" line', () => {
    expect(
      sections.length,
      `expected exactly one "# "-level heading, found ${sections.length}`,
    ).toBe(1);

    const loadLineCount = body
      .split('\n')
      .filter((l) => l.includes('Load only the workflow')).length;
    expect(
      loadLineCount,
      `expected the literal "Load only the workflow" line exactly once, found ${loadLineCount}`,
    ).toBe(1);
  });

  it('does not list a self-referential `mastermind` entry', () => {
    // A bullet naming bare `mastermind` (not `mastermind-x`) routes the
    // router to itself, which is meaningless.
    const selfRefs = body.split('\n').filter((l) => /^-\s+`mastermind`(?!-)/.test(l.trim()));
    expect(selfRefs, `self-referential bullet(s):\n${selfRefs.join('\n')}`).toEqual([]);
  });

  it('every named `mastermind-*` workflow resolves to a real skill directory in this tree', () => {
    // o-09 round 2: the bogus `mastermind-master` reference that replaced
    // the dead-path one was written in plain prose ("the mastermind-master
    // table"), not backtick-wrapped like every other name in this file — a
    // backtick-only regex missed it. Bare tokens are matched too now.
    const names = new Set<string>();
    for (const m of body.matchAll(/\bmastermind-[\w-]+\b/g)) names.add(m[0]);

    const missing = [...names].filter(
      (name) => !existsSync(join(tree.skillsDir, name, 'SKILL.md')),
    );
    expect(
      missing,
      `named workflow(s) with no real skill directory under ${tree.skillsDir}: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every `monomind mastermind run <x>` command in the body resolves to a real, non-router skill', () => {
    // The specific shape MAJOR 1 was: `run master --print` DOES resolve
    // (`master` is an alias of the router itself, manifest-data.ts:15) but
    // circularly — it prints the exact page the reader is already on. A
    // plain "resolves" check misses that; also assert the resolved skill
    // isn't the router (`mastermind`) unless the command literally names it.
    for (const m of body.matchAll(/`monomind mastermind run ([\w-]+)(?: --print)?`/g)) {
      const arg = m[1];
      const resolved = resolveMastermindSkill(arg);
      expect(
        resolved,
        `\`monomind mastermind run ${arg}\` resolves to no known skill`,
      ).toBeDefined();
      if (arg !== 'mastermind' && arg !== 'router' && arg !== 'master') {
        expect(
          resolved?.name,
          `\`monomind mastermind run ${arg}\` resolves to the router itself (circular) instead of a distinct workflow`,
        ).not.toBe('mastermind');
      }
    }
  });

  it('names no dead .md path', () => {
    // The router historically named a repo-root-relative .md path
    // (`.claude/commands/mastermind-master.md`) that never existed. Any such
    // reference must resolve relative to the repo root, in every tree —
    // which in practice means the router should name none at all, since a
    // path literal cannot be simultaneously correct in five differently
    // laid-out trees (three of which have no `.claude/` prefix at all).
    const paths = new Set<string>();
    for (const m of body.matchAll(/`?(\.[\w./-]*\.md)`?/g)) paths.add(m[1]);

    const dead = [...paths].filter((p) => !existsSync(join(REPO_ROOT, p)));
    expect(dead, `dead .md path reference(s): ${dead.join(', ')}`).toEqual([]);
  });

  it('the LAST (effective, highest-weighted) block lists the mandatory gates mastermind-idea and mastermind-design', () => {
    // The file's own first block calls these two gates "mandatory and
    // ordered" for build/feature work. Whichever block sits last is the one
    // a model weights most — this is the exact assertion that would have
    // failed the moment 61396db8d appended a block omitting them.
    const lastBlock = sections[sections.length - 1] ?? '';
    for (const gate of ['mastermind-idea', 'mastermind-design']) {
      expect(
        lastBlock.includes(`\`${gate}\``),
        `the last router block does not list \`${gate}\`, a gate the file itself calls mandatory:\n${lastBlock}`,
      ).toBe(true);
    }
  });
});
