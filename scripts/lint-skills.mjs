#!/usr/bin/env node

// Skill lint script (P1-11): validates every `monomind <cmd>` and `npx monomind <cmd>`
// reference in skill and command files resolves to a real command. Also checks for
// `monomind@alpha` dist-tags and cross-tree drift between root and packages skill
// directories.
//
// Commands are resolved against the BUILT CLI's command registry
// (packages/@monomind/cli/dist/src/commands/index.js — names, aliases and
// subcommands), so build first: `pnpm -r run build`. Only code is scanned —
// fenced blocks and inline code spans — because prose ("monomind for teams")
// is not a command reference.
//
// Run: node scripts/lint-skills.mjs
// CI: fails on any unresolved command or subcommand, any @alpha dist-tag,
// cross-tree drift, or a shipped skill/command/agent description over
// DESCRIPTION_MAX_CHARS (GH #411). A word after a command that has no subcommands is taken as
// a positional argument and not checked.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = process.cwd();
const SKILL_TREES = [
  join(ROOT, '.claude/skills'),
  join(ROOT, '.agents/skills'),
  join(ROOT, '.gemini/skills'),
  join(ROOT, '.kimi-code/skills'),
  join(ROOT, 'packages/@monomind/cli/.claude/skills'),
];
// Skills confirmed (2026-09-05 mastermind pipeline repair plan) to be maintained
// byte-identical across all five trees. Cross-tree content drift is an ERROR for
// these; for every other skill it stays the existing directory-presence WARNING
// below, since not every skill in this repo is synced across all five trees.
const SYNCED_SKILLS = new Set([
  'mastermind',
  'mastermind-plan',
  'mastermind-execute',
  'mastermind-debug',
  'mastermind-issues',
  'mastermind-issue-detail',
  'mastermind-my-issues',
  'mastermind-liveness',
  'mastermind-plan-to-tasks',
  'mastermind-org',
  'mastermind-runorg',
  'mastermind-createorg',
]);
// Repo-only by design (same list as tests/repo/claude-tree-parity.test.ts):
// monoagent-image is tied to the local "monoes" browser profile and monodoc is
// a repo authoring aid, so neither ships in the package.
const ROOT_ONLY_SKILLS = new Set(['monoagent-image', 'monodoc']);
const ALPHA_NEEDLE = 'monomind@alpha';
const errors = [];
const warnings = [];

// Union of skill directory names across all five trees — used to validate
// every Skill("...") reference resolves to a real skill package.
const KNOWN_SKILLS = new Set();
for (const tree of SKILL_TREES) {
  if (!existsSync(tree)) continue;
  for (const d of readdirSync(tree)) {
    if (existsSync(join(tree, d, 'SKILL.md'))) KNOWN_SKILLS.add(d);
  }
}

const CLI_COMMANDS_MODULE = 'packages/@monomind/cli/dist/src/commands/index.js';

/**
 * Map of every top-level command name and alias in the built CLI to the set of
 * its subcommand names and aliases. Throws when the CLI is not built — a
 * reference check that silently skips is how 1,098 unresolved references piled
 * up as warnings nobody read.
 */
export async function loadCliCommands(root = ROOT) {
  const modPath = join(root, CLI_COMMANDS_MODULE);
  if (!existsSync(modPath)) {
    throw new Error(`${CLI_COMMANDS_MODULE} is missing — build the CLI first (pnpm -r run build)`);
  }
  const registry = await import(pathToFileURL(modPath).href);
  const commands = new Map();
  for (const cmd of await registry.loadAllCommands()) {
    const subs = new Set();
    for (const sub of cmd.subcommands ?? []) {
      subs.add(sub.name);
      for (const alias of sub.aliases ?? []) subs.add(alias);
    }
    for (const name of [cmd.name, ...(cmd.aliases ?? [])]) commands.set(name, subs);
  }
  for (const name of registry.getCommandNames()) {
    if (!commands.has(name)) commands.set(name, new Set());
  }
  return commands;
}

// `monomind` / `monomind@tag` as a word of its own (not `.monomind/`,
// `@monoes/monomind`, `monomind-foo`, `monomind:start`), then the command
// word, then an optional subcommand word (not a flag or placeholder).
const CMD_REF = /(?<![\w./@-])monomind(?:@[\w.-]+)?[ \t]+([a-z][\w-]*)(?:[ \t]+([a-z][\w-]*))?/g;

// Text allowed right before `monomind` for it to be in command position: the
// start of the line or a shell/quote boundary, optionally followed by an
// `npx [-y]` / `pnpm` / `bunx` runner. Anything else ("is monomind
// installed?", "with monomind integration") is prose inside code.
const COMMAND_POSITION =
  /(?:^|[$;|&(`'"=>]|\brun:)\s*(?:(?:npx|bunx|pnpm(?:\s+dlx)?)\s+(?:-y\s+|--yes\s+)?)?$/;

/** Code regions of a markdown document: fenced block bodies and inline code spans. */
function codeRegions(content) {
  const regions = [];
  const prose = content.replace(
    /^([ \t]*)(```|~~~)[^\n]*\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm,
    (_m, _i, _f, body) => {
      // Shell comments inside a block are prose too.
      regions.push(body.replace(/(^|[ \t])#.*$/gm, '$1'));
      return '';
    },
  );
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) regions.push(m[1]);
  return regions;
}

/** Every `monomind <command> [<sub>]` reference inside the code of `content`. */
export function extractCommandRefs(content) {
  const refs = [];
  for (const region of codeRegions(content)) {
    for (const m of region.matchAll(CMD_REF)) {
      const lineStart = region.lastIndexOf('\n', m.index) + 1;
      if (!COMMAND_POSITION.test(region.slice(lineStart, m.index))) continue;
      refs.push({ command: m[1], sub: m[2], text: m[0].trim() });
    }
  }
  return refs;
}

/**
 * Why `ref` does not resolve against `cli`, or null when it does. An unknown
 * subcommand is only reported for commands that have subcommands — for the
 * rest the next word is a positional argument.
 */
export function unresolvedReason(ref, cli) {
  const subs = cli.get(ref.command);
  if (!subs) return `'monomind ${ref.command}' is not a command of the built CLI`;
  if (ref.sub && subs.size > 0 && !subs.has(ref.sub)) {
    return `'${ref.sub}' is not a subcommand of 'monomind ${ref.command}'`;
  }
  return null;
}

/** Check one file's command references; push errors. */
function checkCommandRefs(content, label, cli) {
  for (const ref of extractCommandRefs(content)) {
    const reason = unresolvedReason(ref, cli);
    if (reason) errors.push(`${label}: '${ref.text}' — ${reason}`);
  }
}

// --- Lint each skill tree ---
function lintTree(treePath, label, cli) {
  if (!existsSync(treePath)) return;
  const skills = readdirSync(treePath).filter(
    (d) => statSync(join(treePath, d)).isDirectory() && existsSync(join(treePath, d, 'SKILL.md')),
  );

  for (const skill of skills) {
    const skillFile = join(treePath, skill, 'SKILL.md');
    const content = readFileSync(skillFile, 'utf8');

    // Check for @alpha dist-tag (but allow "Never use monomind@alpha" warnings).
    // Plain string search, not a global regex .test() — a global regex here
    // retains lastIndex across calls, so one match on an earlier line (in
    // this file or a prior one, since ALPHA_PATTERN was module-scoped)
    // silently suppressed detection on later lines. Confirmed reproducible.
    const lines = content.split('\n');
    const alphaLines = lines.filter(
      (l) => l.includes(ALPHA_NEEDLE) && !/never\s+use/i.test(l) && !/do\s+not\s+use/i.test(l),
    );
    if (alphaLines.length > 0) {
      errors.push(
        `[${label}] ${skill}/SKILL.md: ${alphaLines.length} instance(s) of 'monomind@alpha' (excluding 'Never use' warnings) — use 'monomind@latest'`,
      );
    }

    // Every Skill("mastermind-x") reference must name a real skill package.
    // Scoped to mastermind-* names — Skill() calls to other Claude Code
    // platform skills (loop, dataviz, schedule, ...) aren't in these trees
    // and this linter has no visibility into that catalog. Also skip
    // uppercase/placeholder names (e.g. "mastermind-X" in documentation
    // showing the call syntax, not an actual invocation). Matches both
    // Skill("name") and Skill("name", extraArgs...) — a trailing comma
    // (e.g. Skill("mastermind-ideate", $ARGUMENTS)) previously made the
    // whole call invisible to this check.
    for (const m of content.matchAll(/Skill\(["'](mastermind(?:-[\w-]+)?)["'][,)]/g)) {
      if (/[A-Z]/.test(m[1])) continue;
      if (!KNOWN_SKILLS.has(m[1])) {
        errors.push(
          `[${label}] ${skill}/SKILL.md: Skill("${m[1]}") does not exist in any skill tree`,
        );
      }
    }

    // A SKILL.md must never contain its own body twice (managed-block append bug).
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    const half = body.slice(0, Math.floor(body.length / 2)).trimEnd();
    if (half.length > 200 && body.indexOf(half, half.length) !== -1) {
      errors.push(
        `[${label}] ${skill}/SKILL.md: body appears duplicated — managed-block merge appended instead of replacing`,
      );
    }

    checkCommandRefs(content, `[${label}] ${skill}/SKILL.md`, cli);
  }
}

// --- Lint command files (flat/nested .md, not skill packages) ---
// Found 2026-09-05: a dangling Skill("mastermind-taskdev") etc. reference can
// live in a .claude/commands/*.md file, not just a SKILL.md — lintTree() above
// never sees these (it only walks SKILL_TREES' skill-package directories), so
// this class of regression was structurally invisible to the guard even after
// it was wired into CI. monomind-mastermind-master.md carried all 8 dangling
// names for a full commit before this check existed.
const COMMAND_TREES = [
  join(ROOT, '.claude/commands'),
  join(ROOT, 'packages/@monomind/cli/.claude/commands'),
  join(ROOT, '.kimi-code/plugin/commands'),
];

function walkMarkdownFiles(dirPath) {
  if (!existsSync(dirPath)) return [];
  const out = [];
  for (const entry of readdirSync(dirPath)) {
    const full = join(dirPath, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkMarkdownFiles(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

function lintCommandTree(treePath, cli) {
  for (const file of walkMarkdownFiles(treePath)) {
    const content = readFileSync(file, 'utf8');
    const rel = file.replace(`${ROOT}/`, '');
    checkCommandRefs(content, rel, cli);
    for (const m of content.matchAll(/Skill\(["'](mastermind(?:-[\w-]+)?)["'][,)]/g)) {
      if (/[A-Z]/.test(m[1])) continue;
      if (!KNOWN_SKILLS.has(m[1])) {
        errors.push(`${rel}: Skill("${m[1]}") does not exist in any skill tree`);
      }
    }
  }
}

// --- Check cross-tree drift ---
// Directory-presence drift stays a warning (root vs. the npm-shipped package
// tree only — many skills are legitimately root-only, e.g. local dev tooling).
// Content drift for SYNCED_SKILLS is an error, checked across all five trees.
function checkDrift() {
  const tree1 = join(SKILL_TREES[0]);
  const tree2 = SKILL_TREES[SKILL_TREES.length - 1];
  if (existsSync(tree1) && existsSync(tree2)) {
    const skills1 = new Set(
      readdirSync(tree1).filter((d) => existsSync(join(tree1, d, 'SKILL.md'))),
    );
    const skills2 = new Set(
      readdirSync(tree2).filter((d) => existsSync(join(tree2, d, 'SKILL.md'))),
    );

    const only1 = [...skills1].filter((s) => !skills2.has(s) && !ROOT_ONLY_SKILLS.has(s));
    const only2 = [...skills2].filter((s) => !skills1.has(s));

    if (only1.length > 0) {
      warnings.push(`Cross-tree drift: ${only1.length} skill(s) only in root: ${only1.join(', ')}`);
    }
    if (only2.length > 0) {
      warnings.push(
        `Cross-tree drift: ${only2.length} skill(s) only in packages: ${only2.join(', ')}`,
      );
    }
  }

  for (const skill of SYNCED_SKILLS) {
    const contents = new Map();
    for (const tree of SKILL_TREES) {
      const f = join(tree, skill, 'SKILL.md');
      if (existsSync(f)) contents.set(tree, readFileSync(f, 'utf8'));
    }
    const distinct = new Set(contents.values());
    if (distinct.size > 1) {
      const trees = [...contents.keys()].map((t) => t.replace(`${ROOT}/`, ''));
      errors.push(
        `${skill}/SKILL.md content differs across skill trees (checked: ${trees.join(', ')}) — this skill is expected to be byte-identical everywhere. ` +
          'Fix: run `pnpm run sync:claude-trees` (regenerates the derived trees from the root .claude/). ' +
          'Usual cause: `monomind init --force` run inside this repo, which rewrites .claude/ and .agents/skills but no other tree.',
      );
    }
  }
}

// --- Description length cap (GH #411) ---
// Claude Code lists every skill and command with its description in a budget
// of ~1% of the context window (~8k chars on a 200k model) and drops
// descriptions past it; agents are listed the same way in the Agent tool.
// 8,000 chars over the ~40 entries the default install lists is 200 per
// entry. Keep in step with DESCRIPTION_MAX_CHARS in
// packages/@monomind/cli/src/init/listing-size.ts.
export const DESCRIPTION_MAX_CHARS = 200;

// The trees that ship: the root source of truth and the npm package copy.
const SHIPPED_DESCRIPTION_TREES = ['.claude', 'packages/@monomind/cli/.claude'];

/** Listing description of a markdown file: frontmatter `description` plus a
 *  skill's `when_to_use` (Claude Code shows both). Null without frontmatter. */
export function listingDescription(content, { skill = false } = {}) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return null;
  let data;
  try {
    data = parseYaml(m[1]);
  } catch {
    return null; // invalid YAML is reported by skill-frontmatter/command-frontmatter tests
  }
  if (!data || typeof data !== 'object') return null;
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  return [text(data.description), skill ? text(data.when_to_use) : ''].filter(Boolean).join(' ');
}

/** Why `content`'s description is over the cap, or null. */
export function descriptionTooLong(content, opts) {
  const desc = listingDescription(content, opts);
  if (desc === null || desc.length <= DESCRIPTION_MAX_CHARS) return null;
  return `description is ${desc.length} chars (max ${DESCRIPTION_MAX_CHARS}) — shorten it in the root .claude/ copy, then run pnpm run sync:claude-trees`;
}

/** Same filter as isCommandDoc in src/init/asset-maps.ts: not a command. */
const isCommandDoc = (rel) => {
  const segs = rel.split('/');
  const base = segs[segs.length - 1];
  return base === 'README.md' || base.startsWith('_') || segs.includes('references');
};

function checkDescriptionLengths() {
  for (const tree of SHIPPED_DESCRIPTION_TREES) {
    const skillsDir = join(ROOT, tree, 'skills');
    if (existsSync(skillsDir)) {
      for (const d of readdirSync(skillsDir)) {
        const file = join(skillsDir, d, 'SKILL.md');
        if (!existsSync(file) || ROOT_ONLY_SKILLS.has(d)) continue;
        const why = descriptionTooLong(readFileSync(file, 'utf8'), { skill: true });
        if (why) errors.push(`${tree}/skills/${d}/SKILL.md: ${why}`);
      }
    }
    for (const kind of ['commands', 'agents']) {
      const dir = join(ROOT, tree, kind);
      for (const file of walkMarkdownFiles(dir)) {
        const rel = file
          .slice(dir.length + 1)
          .split('\\')
          .join('/');
        if (kind === 'commands' && isCommandDoc(rel)) continue;
        const why = descriptionTooLong(readFileSync(file, 'utf8'));
        if (why) errors.push(`${tree}/${kind}/${rel}: ${why}`);
      }
    }
  } // monodesign's SKILL.md is compiled from this source at pack time.
  const monodesign = 'packages/@monoes/monodesign/skill/SKILL.src.md';
  const why = descriptionTooLong(readFileSync(join(ROOT, monodesign), 'utf8'), { skill: true });
  if (why) errors.push(`${monodesign}: ${why}`);
}

// --- Run ---
async function main() {
  let cli;
  try {
    cli = await loadCliCommands();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 1;
  }
  for (const tree of SKILL_TREES) {
    lintTree(tree, tree.replace(`${ROOT}/`, ''), cli);
  }
  for (const tree of COMMAND_TREES) {
    lintCommandTree(tree, cli);
  }
  checkDrift();
  checkDescriptionLengths();

  // --- Report ---
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    for (const w of warnings) console.log(`  ${w}`);
  }
  if (errors.length > 0) {
    console.error('\n❌ Errors:');
    for (const e of errors) console.error(`  ${e}`);
    console.error(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
    return 1;
  }
  console.log(`✓ Skill lint passed — 0 errors, ${warnings.length} warning(s)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
