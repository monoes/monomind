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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** Every `SKILL.md` under `dir`, at any depth — o-09 review MINOR 2/3:
 *  `routerPath()` above hardcodes `mastermind/SKILL.md`, so a second router
 *  planted under any other name is invisible to every check in this file.
 *  This is how `.kimi-code/skills/monomind-mastermind/SKILL.md` — a 141-line
 *  second intent router, in that tree only — went unseen. */
function findSkillFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkillFiles(full));
    else if (entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

/** Strip fenced code blocks before classifying — o-09 review round 2 finding
 *  A3: a canonical trigger phrase quoted inside a documentation code fence
 *  (an "anti-pattern example", say) is not a live router and must not
 *  falsely classify the file that quotes it. */
function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** The router shape `mastermind/SKILL.md` and its four siblings share: at
 *  least two `- \`mastermind-*\`` list items ANYWHERE in the body.
 *  Structural, not lexical — o-09 review round 2 finding A1: a
 *  literal-substring check on the "Load only the workflow" sentence passed
 *  a near-exact reconstruction of the deleted second router with just that
 *  one sentence reworded ("Load JUST the workflow"). Counting the actual
 *  bullet shape survives a wording change the substring check could not.
 *
 *  o-09 review round 3: round 2's version required a `# `-level heading to
 *  even start a section (`sectionsOf` yields zero sections for a body with
 *  none), so a shadow router written with only `##` headings — or none —
 *  produced zero sections and was invisible to this check regardless of
 *  content: a `##`-only duplicate with 3 bullets, planted unmirrored at
 *  `.kimi-code/skills/mm-shadow/SKILL.md`, passed 61/61 green. Dropped the
 *  heading requirement entirely and lowered the threshold from 3 to 2.
 *  Measured selectivity of this looser rule across all five shipped trees:
 *  exactly one file matches per tree, always the canonical
 *  `mastermind/SKILL.md` (9 bullets) — zero false positives today. */
function hasBulletRouterSection(body: string): boolean {
  const bulletCount = stripFencedCode(body)
    .split('\n')
    .filter((l) => /^-\s+`mastermind-[\w-]+`/.test(l.trim())).length;
  return bulletCount >= 2;
}

/** A structurally different second router shape (o-09 review finding 2): a
 *  multi-domain capability-catalog table whose header row has both an
 *  "Intent" cell and a "primary route" cell, case- and spacing-tolerant —
 *  finding A2: the literal-substring check missed a header spelled with a
 *  capital "Route". No tree should have one of these under `skills/` —
 *  multi-domain routing already lives in the bullet router's
 *  `run <skill> --print` fallback. */
function hasCatalogRouterTable(body: string): boolean {
  for (const line of stripFencedCode(body).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim().toLowerCase());
    if (cells.some((c) => c === 'intent') && cells.some((c) => /^primary\s+route$/.test(c))) {
      return true;
    }
  }
  return false;
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

/** o-09 round 2 (reviewer MAJOR): matches a backtick-wrapped
 *  `` `monomind mastermind run <arg>[ --print]` `` command, where `<arg>` is
 *  either a real skill/alias name or the literal placeholder form `<skill>`
 *  (angle brackets included) the router's own body uses generically. The v1
 *  regex (`[\w-]+` only) matched neither the placeholder — `<`/`>` are not
 *  word characters, so it matched **zero times** in every shipped tree, and
 *  the circularity check below it never ran — nor would it have narrowed
 *  Case B/C below even if it had, since those match `[\w-]+` fine but the
 *  exemption (now removed) skipped them by name. */
const RUN_COMMAND_RE = /`monomind mastermind run (<[\w-]+>|[\w-]+)(?: --print)?`/g;

/** Every run-command argument found in `body`, backtick-wrapped commands only. */
function runCommandArgs(body: string): string[] {
  return [...body.matchAll(RUN_COMMAND_RE)].map((m) => m[1]);
}

/** A literal `<word>` placeholder (e.g. `<skill>`) — documentation shorthand
 *  for "fill in a real name here", not itself a name to resolve. */
function isPlaceholderArg(arg: string): boolean {
  return /^<[\w-]+>$/.test(arg);
}

/** Asserts every non-placeholder run-command argument in `body` resolves to a
 *  real skill, and that resolution is never the router itself (`mastermind`,
 *  by any of its names — canonical or alias). No exemption: `mastermind`,
 *  `router` and `master` all name the same skill, so a `run <any of them>
 *  --print` line is circular regardless of which of the three spellings is
 *  used — exempting one and not the others was the round-1 hole (Case B/C:
 *  the reviewer's synthetic regressions using `master`/`router` passed
 *  silently because the exemption matched them by name). */
function assertRunCommandsNotCircular(body: string): void {
  for (const arg of runCommandArgs(body)) {
    if (isPlaceholderArg(arg)) continue;
    const resolved = resolveMastermindSkill(arg);
    expect(resolved, `\`monomind mastermind run ${arg}\` resolves to no known skill`).toBeDefined();
    expect(
      resolved?.name,
      `\`monomind mastermind run ${arg}\` resolves to the router itself (circular) instead of a distinct workflow`,
    ).not.toBe('mastermind');
  }
}

describe.each(TREES)('mastermind router internal consistency — $name', (tree) => {
  const skillFiles = findSkillFiles(tree.skillsDir);
  const bulletRouters = skillFiles.filter((f) =>
    hasBulletRouterSection(bodyOf(readFileSync(f, 'utf8'))),
  );
  const catalogRouters = skillFiles.filter((f) =>
    hasCatalogRouterTable(bodyOf(readFileSync(f, 'utf8'))),
  );

  it("the bullet-list routers under this tree's skills/ are EXACTLY {mastermind/SKILL.md} — the reviewed canonical set, not a count", () => {
    // o-09 review round 3: a count (`toHaveLength(1)`) passes when one
    // router is swapped for another at a different path; an exact-set
    // assertion against a reviewed constant does not.
    expect(bulletRouters).toEqual([routerPath(tree)]);
  });

  it("no second, contradicting router style (an Intent/primary-route capability table) exists anywhere under this tree's skills/", () => {
    // Renamed from "...anywhere in this tree" (o-09 review round 2, MAJOR 2):
    // that claim overclaimed its real scope. findSkillFiles only walks
    // `tree.skillsDir`, so `.kimi-code/plugin/commands/monomind-mastermind.md`
    // — a file with the exact catalog shape this check forbids, two
    // directories outside `skills/` — was invisible to it twice over. The
    // file itself is independently confirmed dead/unshipped (dev-lead is
    // ledgering its removal separately); this check's name now says only
    // what it actually verifies.
    expect(
      catalogRouters,
      `catalog-style router(s) found — a second, contradicting router surface: ${catalogRouters.join(', ')}`,
    ).toEqual([]);
  });

  const file = bulletRouters[0] ?? routerPath(tree);

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

  it('names at least one run-command — the check below is not vacuous', () => {
    // o-09 round 2: the v1 regex required `[\w-]+` only, which cannot match
    // the shipped body's actual placeholder form (`<skill>` — `<`/`>` are
    // not word characters), so this found zero commands in every tree and
    // the circularity check below never ran. RUN_COMMAND_RE now also
    // matches the placeholder form, so a router body that names no
    // run-command at all (accidentally deleting the fallback instruction)
    // fails here instead of the next check silently doing nothing.
    expect(runCommandArgs(body).length).toBeGreaterThan(0);
  });

  it('every `monomind mastermind run <x>` command in the body resolves to a real, non-router skill', () => {
    // The specific shape MAJOR 1 was: `run master --print` DOES resolve
    // (`master` is an alias of the router itself, manifest-data.ts:15) but
    // circularly — it prints the exact page the reader is already on. A
    // plain "resolves" check misses that; also assert the resolved skill
    // isn't the router (`mastermind`), by any of its names.
    assertRunCommandsNotCircular(body);
  });

  it('names no dead path reference', () => {
    // The router historically named a repo-root-relative .md path
    // (`.claude/commands/mastermind-master.md`) that never existed. Any such
    // backtick-wrapped bare path is this file's convention for a
    // repo-root-relative reference, in every tree — which in practice means
    // the router should name none at all, since a path literal cannot be
    // simultaneously correct in five differently laid-out trees (three of
    // which have no `.claude/` prefix at all).
    const dead: string[] = [];
    const barePaths = new Set<string>();
    for (const m of body.matchAll(/`?(\.[\w./-]*\.md)`?/g)) barePaths.add(m[1]);
    for (const p of barePaths) {
      if (!existsSync(join(REPO_ROOT, p))) dead.push(`${p} (repo-root-relative)`);
    }

    // o-09 review round 3 (MAJOR): a markdown LINK target — `[text](target)`,
    // e.g. `[references/](references/)` — resolves relative to the linking
    // file's own directory per normal markdown semantics, not the repo root.
    // The bare-path check above requires a leading `.` and a `.md` suffix,
    // so it cannot match a relative directory link; this is what let
    // `.kimi-code/skills/mastermind/references/` (missing, unlike the other
    // four trees) ship as a dead reference undetected.
    const linkTargets = new Set<string>();
    for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) linkTargets.add(m[1]);
    for (const target of linkTargets) {
      if (/^(https?:|mailto:|#)/.test(target)) continue; // external / in-page, not a file
      if (!existsSync(join(dirname(file), target))) dead.push(`${target} (relative to ${file})`);
    }

    expect(dead, `dead path reference(s): ${dead.join(', ')}`).toEqual([]);
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

describe('assertRunCommandsNotCircular — synthetic regressions the v1 exemption missed (o-09 round 2)', () => {
  // These exercise the CHECKING LOGIC directly against synthetic bodies, not
  // the real shipped trees (which, post-MAJOR-1, contain no circular
  // sentence to catch) — the reviewer's three cases, reproduced exactly:
  //   A: the exact historical sentence (`run master --print` in prose) —
  //      already caught elsewhere (dead-path / prose-token checks); not
  //      re-tested here, this file is scoped to the circularity check only.
  //   B: same circular pointer, phrased so no OTHER check in this file would
  //      catch it (no dead .md path, a real backtick-wrapped command) —
  //      this is the one the v1 exemption let through silently.
  //   C: circular via the `router` alias instead of `master` — same hole,
  //      different spelling of the same underlying skill.
  it('Case B: `run master --print` is caught as circular (v1 exempted it by name)', () => {
    const body = 'For the full routing table, run `monomind mastermind run master --print`.';
    expect(() => assertRunCommandsNotCircular(body)).toThrow(/circular/);
  });

  it('Case C: `run router --print` is caught as circular (same alias hole)', () => {
    const body = 'For the full routing table, run `monomind mastermind run router --print`.';
    expect(() => assertRunCommandsNotCircular(body)).toThrow(/circular/);
  });

  it('the literal canonical name `run mastermind --print` is also caught (no self-reference exemption)', () => {
    // Round 1 exempted `mastermind`, `router` and `master` alike, all by
    // literal name — none is more legitimate than another as a target of
    // "run <name> --print", since all three resolve to the same router
    // skill. No exemption is used here.
    const body = 'See `monomind mastermind run mastermind --print` for the routing table.';
    expect(() => assertRunCommandsNotCircular(body)).toThrow(/circular/);
  });

  it('a command naming a real, distinct workflow is NOT flagged (no false positive)', () => {
    const body = 'Before multi-file work, run `monomind mastermind run plan --print`.';
    expect(() => assertRunCommandsNotCircular(body)).not.toThrow();
  });

  it('the placeholder form `<skill>` is not treated as a broken reference', () => {
    const body = 'Without native skills, run `monomind mastermind run <skill> --print`.';
    expect(() => assertRunCommandsNotCircular(body)).not.toThrow();
  });

  it('a body with no run-command at all is unaffected (no false positive, and see the non-vacuity guard above)', () => {
    expect(() => assertRunCommandsNotCircular('No run-command here.')).not.toThrow();
  });
});
