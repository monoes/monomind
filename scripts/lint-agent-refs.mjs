#!/usr/bin/env node

/**
 * Agent / skill reference lint.
 *
 * Shipped text told Claude to spawn agents that do not exist (`backend-dev`,
 * `security-architect`, `code-review-swarm`, ...) and to load skills that do
 * not exist (`Skill("mastermind-do")` when only the `/mastermind:do` command
 * exists). A Task call with an unknown `subagent_type` fails at spawn time and
 * a Skill call with an unknown name fails at load time, so every such
 * reference is a dead end for whoever follows the text.
 *
 * WHAT IT CHECKS
 * --------------
 * In every scanned file it finds these call shapes and resolves the quoted
 * name:
 *
 *   subagent_type: "X"   subagent_type="X"   subagent_type 'X'   → agent
 *   agentSlug: 'X'                                               → agent
 *   Skill("X")  Skill('X', args)                                 → skill
 *
 * An agent name is valid when it is the frontmatter `name:` of a definition
 * under packages/@monomind/cli/.claude/agents/** (that is the value Claude
 * Code's Task tool accepts as `subagent_type`), or one of Claude Code's
 * built-in agents (BUILTIN_AGENTS).
 *
 * A skill name is valid when it is a skill directory (holding SKILL.md) in any
 * of the skill trees, a command file exposed as a skill (`a:b` for
 * commands/a/b.md, `x` for commands/x.md) in the root or shipped command
 * tree, or one of Claude Code's built-in skills (BUILTIN_SKILLS, which also
 * lists `monodesign`, installed from its own package). Files in a platform
 * tree (.agents, .gemini, .kimi-code) may also name that tree's own skill
 * dirs, since those trees carry commands converted to skills.
 *
 * CLAUDE.md files (the repo root's and each package's) also carry prose
 * rosters. Under a heading that mentions agents, a line made only of
 * backticked names (`coder`, `Security Engineer` — optionally followed by a
 * dash or parenthesised note) names agents, and so does the last column of a
 * table whose last header cell is "Agents" or "Recommended agents".
 *
 * Placeholders are skipped: any name containing < > $ { } [ ] or |, and the
 * literal example names in PLACEHOLDERS ("Agent Name", "mastermind-X", ...).
 *
 * WHAT IT SCANS
 * -------------
 *   - skill and command markdown: the root `.claude/` tree, the shipped
 *     `packages/@monomind/cli/.claude/` tree and the platform skill trees;
 *   - string literals in TypeScript sources under packages/<pkg>/src and
 *     packages/@scope/<pkg>/src (the init generators that write CLAUDE.md
 *     and capability docs live there), test files excluded.
 *
 * EXCLUDED PATHS (explicit, documented)
 * -------------------------------------
 * EXCLUDED_PATHS lists path prefixes that are not scanned:
 *   - packages/@monomind/routing — its route tables are maintained in their
 *     own change and checked by that package's tests, not by this lint.
 *   - .claude/skills/mastermind-createorg, .claude/skills/mastermind-new-agent
 *     (and their mirrors) — role/agent templates in those skills are owned
 *     and validated by the createorg/new-agent change.
 *
 * Run:   node scripts/lint-agent-refs.mjs [--root <dir>] [--list]
 * Exit:  0 when every reference resolves, 1 otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
const LIST = args.includes('--list');

const BUILTIN_AGENTS = new Set([
  'general-purpose',
  'Explore',
  'Plan',
  'statusline-setup',
  'claude-code-guide',
]);
const BUILTIN_SKILLS = new Set([
  'loop',
  'schedule',
  'dataviz',
  'simplify',
  'code-review',
  'security-review',
  'init',
  'claude-api',
  'update-config',
  // Installed from the @monoes/monodesign package, not from a .claude tree.
  'monodesign',
]);
const PLACEHOLDERS = new Set([
  'Agent Name',
  'agent',
  'slug',
  'name',
  'X',
  'mastermind-X',
  'mastermind-x',
]);
const EXCLUDED_PATHS = [
  'packages/@monomind/routing',
  '.claude/skills/mastermind-createorg',
  '.claude/skills/mastermind-new-agent',
  'packages/@monomind/cli/.claude/skills/mastermind-createorg',
  'packages/@monomind/cli/.claude/skills/mastermind-new-agent',
  '.agents/skills/mastermind-createorg',
  '.agents/skills/mastermind-new-agent',
  '.gemini/skills/mastermind-createorg',
  '.gemini/skills/mastermind-new-agent',
  '.kimi-code/skills/mastermind-createorg',
  '.kimi-code/skills/mastermind-new-agent',
];

const AGENT_TREE = 'packages/@monomind/cli/.claude/agents';
const SKILL_TREES = [
  '.claude/skills',
  '.agents/skills',
  '.gemini/skills',
  '.kimi-code/skills',
  'packages/@monomind/cli/.claude/skills',
];
const COMMAND_TREES = ['.claude/commands', 'packages/@monomind/cli/.claude/commands'];

function isExcluded(rel) {
  return EXCLUDED_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));
}

function walk(dir, pred, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const rel = `${dir}/${entry}`;
    if (isExcluded(rel)) continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, pred, out);
    else if (pred(entry)) out.push(rel);
  }
  return out;
}

// --- Known names ---
const AGENTS = new Set(BUILTIN_AGENTS);
for (const f of walk(AGENT_TREE, (e) => e.endsWith('.md'))) {
  const m = readFileSync(join(ROOT, f), 'utf8').match(
    /^---\n[\s\S]*?^name:\s*["']?(.+?)["']?\s*$/m,
  );
  if (m) AGENTS.add(m[1]);
}
function skillDirs(tree) {
  const abs = join(ROOT, tree);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((d) => existsSync(join(abs, d, 'SKILL.md')));
}
// Claude Code sees the Claude skill trees and the command trees. A platform
// tree (.agents, .gemini, .kimi-code) additionally sees its own skill dirs,
// which include commands converted to skills (e.g. kimi's `mastermind-do`).
const CLAUDE_SKILL_TREES = ['.claude/skills', 'packages/@monomind/cli/.claude/skills'];
const SKILLS = new Set([...BUILTIN_SKILLS, ...CLAUDE_SKILL_TREES.flatMap(skillDirs)]);
const PLATFORM_SKILLS = new Map(
  SKILL_TREES.filter((t) => !CLAUDE_SKILL_TREES.includes(t)).map((t) => [t, new Set(skillDirs(t))]),
);
function knownSkill(name, file) {
  if (SKILLS.has(name)) return true;
  for (const [tree, set] of PLATFORM_SKILLS)
    if (file.startsWith(`${tree}/`) && set.has(name)) return true;
  return false;
}
for (const tree of COMMAND_TREES) {
  for (const f of walk(tree, (e) => e.endsWith('.md'))) {
    const parts = relative(tree, f).replace(/\.md$/, '').split('/');
    SKILLS.add(parts.join(':'));
  }
}

// --- Scan ---
const PATTERNS = [
  // `subagent_type: "X"`, `"subagent_type": "X"`, `subagent_type="X"`,
  // `subagent_type 'X'` (also with \" escapes inside a JS string). Backticks
  // are not value quotes: in markdown they are code spans around prose.
  { kind: 'agent', re: /subagent_type["']?(?:\s*[:=]\s*|[ \t]+)\\?["']([^"'\\\n]+)\\?["']/g },
  { kind: 'agent', re: /agentSlug\s*:\s*["']([^"'\n]+)["']/g },
  { kind: 'skill', re: /\bSkill\(\s*\\?["']([^"'\\\n]+)\\?["']/g },
];

function isPlaceholder(name) {
  return /[<>${}[\]|]/.test(name) || PLACEHOLDERS.has(name.trim());
}

const files = [
  ...SKILL_TREES.flatMap((t) => walk(t, (e) => e.endsWith('.md'))),
  ...COMMAND_TREES.flatMap((t) => walk(t, (e) => e.endsWith('.md'))),
];
for (const scope of ['packages', 'packages/@monomind', 'packages/@monoes']) {
  const abs = join(ROOT, scope);
  if (!existsSync(abs)) continue;
  for (const pkg of readdirSync(abs)) {
    if (pkg.startsWith('@')) continue;
    const src = `${scope}/${pkg}/src`;
    if (isExcluded(`${scope}/${pkg}`)) continue;
    files.push(
      ...walk(
        src,
        (e) =>
          /\.(ts|mts|js|mjs)$/.test(e) &&
          !/\.(test|spec)\.[mc]?[tj]s$/.test(e) &&
          !e.endsWith('.d.ts'),
      ).filter((f) => !f.includes('/__tests__/')),
    );
  }
}

/** Agent names in a CLAUDE.md's prose rosters, with their offsets. */
function rosterRefs(text) {
  const refs = [];
  let agentLevel = 0; // heading level of the enclosing agents section, 0 = none
  let tableAgents = false;
  let offset = 0;
  for (const line of text.split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (agentLevel && level <= agentLevel) agentLevel = 0;
      if (!agentLevel && /\bagents?\b/i.test(heading[2])) agentLevel = level;
    } else if (line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const last = cells[cells.length - 1] ?? '';
      if (/^(recommended )?agents$/i.test(last)) tableAgents = true;
      else if (tableAgents && !/^-+$/.test(last)) {
        for (const name of last
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean))
          refs.push({ name, index: offset + line.lastIndexOf(name) });
      }
    } else {
      tableAgents = false;
      const roster = line.match(/^(`[^`]+`(?:\s*,\s*`[^`]+`)*)\s*(?:(?:—|--).*|\(.*\))?$/);
      if (agentLevel && roster) {
        for (const m of roster[1].matchAll(/`([^`]+)`/g))
          refs.push({ name: m[1], index: offset + m.index });
      }
    }
    offset += line.length + 1;
  }
  return refs;
}

const claudeMds = ['CLAUDE.md'];
for (const scope of ['packages', 'packages/@monomind', 'packages/@monoes']) {
  const abs = join(ROOT, scope);
  if (!existsSync(abs)) continue;
  for (const pkg of readdirSync(abs))
    if (!pkg.startsWith('@') && existsSync(join(abs, pkg, 'CLAUDE.md')))
      claudeMds.push(`${scope}/${pkg}/CLAUDE.md`);
}

const problems = [];
let checked = 0;
for (const file of claudeMds.filter((f) => existsSync(join(ROOT, f)))) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  for (const { name, index } of rosterRefs(text)) {
    if (isPlaceholder(name)) continue;
    checked++;
    const ok = AGENTS.has(name);
    const line = text.slice(0, index).split('\n').length;
    if (LIST) console.log(`${ok ? 'ok ' : 'BAD'} agent ${JSON.stringify(name)} ${file}:${line}`);
    if (!ok) problems.push(`${file}:${line}: unknown agent ${JSON.stringify(name)}`);
  }
}
for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const name = m[1].trim();
      if (isPlaceholder(name)) continue;
      checked++;
      const ok = kind === 'agent' ? AGENTS.has(name) : knownSkill(name, file);
      const line = text.slice(0, m.index).split('\n').length;
      if (LIST)
        console.log(`${ok ? 'ok ' : 'BAD'} ${kind} ${JSON.stringify(name)} ${file}:${line}`);
      if (!ok) problems.push(`${file}:${line}: unknown ${kind} ${JSON.stringify(name)}`);
    }
  }
}

if (problems.length) {
  console.error(`✗ Agent/skill reference lint: ${problems.length} unresolved reference(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '  Agents must be a frontmatter name under packages/@monomind/cli/.claude/agents; skills a skill dir or command (a:b).',
  );
  process.exit(1);
}
console.log(
  `✓ Agent/skill reference lint passed — ${checked} reference(s) in ${files.length} file(s)`,
);
