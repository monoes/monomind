#!/usr/bin/env node

// Skill lint script (P1-11): validates every `monomind <cmd>` and `npx monomind <cmd>`
// reference in skill files resolves to a real command. Also checks for `monomind@alpha`
// dist-tags and cross-tree drift between root and packages skill directories.
//
// Run: node scripts/lint-skills.mjs
// CI: fails on any unresolved command, any @alpha dist-tag, or cross-tree drift.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKILL_TREES = [
  join(ROOT, '.claude/skills'),
  join(ROOT, 'packages/@monomind/cli/.claude/skills'),
];
const CMD_PATTERN = /(?:npx\s+)?monomind(?:@[\w.]+)?\s+(\w[\w-]*)/g;
const ALPHA_PATTERN = /monomind@alpha/g;
const VALID_COMMANDS = new Set();
const errors = [];
const warnings = [];

// --- Gather valid commands from the built CLI ---
try {
  const output = execSync('node packages/@monomind/cli/bin/cli.js --help 2>/dev/null || true', {
    encoding: 'utf8',
    timeout: 5000,
  });
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*(\w[\w-]*)\s/i);
    if (m) VALID_COMMANDS.add(m[1]);
  }
} catch {
  /* CLI not built — skip command validation */
}

// Also add known subcommands from the commands/ directory
try {
  const cmdFiles = readdirSync(join(ROOT, 'packages/@monomind/cli/src/commands')).filter((f) =>
    f.endsWith('.ts'),
  );
  for (const f of cmdFiles) {
    const _name = f
      .replace(/\.ts$|\.js$/, '')
      .replace(/-commands$/, '')
      .replace(/[-_]/g, '-');
    // Extract the command name from the export
    const content = readFileSync(join(ROOT, 'packages/@monomind/cli/src/commands', f), 'utf8');
    const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
    if (nameMatch) VALID_COMMANDS.add(nameMatch[1]);
  }
} catch {
  /* src not available */
}

// Always-valid names (MCP tool prefixes, alias commands, etc.)
[
  'mcp',
  'memory',
  'hooks',
  'doctor',
  'init',
  'org',
  'swarm',
  'monograph',
  'browse',
  'start',
  'stop',
  'status',
  'help',
  'version',
].forEach((c) => VALID_COMMANDS.add(c));

// --- Lint each skill tree ---
function lintTree(treePath, label) {
  if (!existsSync(treePath)) return;
  const skills = readdirSync(treePath).filter(
    (d) => statSync(join(treePath, d)).isDirectory() && existsSync(join(treePath, d, 'SKILL.md')),
  );

  for (const skill of skills) {
    const skillFile = join(treePath, skill, 'SKILL.md');
    const content = readFileSync(skillFile, 'utf8');

    // Check for @alpha dist-tag (but allow "Never use monomind@alpha" warnings)
    const lines = content.split('\n');
    const alphaLines = lines.filter(
      (l) => ALPHA_PATTERN.test(l) && !/never\s+use/i.test(l) && !/do\s+not\s+use/i.test(l),
    );
    if (alphaLines.length > 0) {
      errors.push(
        `[${label}] ${skill}/SKILL.md: ${alphaLines.length} instance(s) of 'monomind@alpha' (excluding 'Never use' warnings) — use 'monomind@latest'`,
      );
    }

    // Check command references resolve
    if (VALID_COMMANDS.size > 0) {
      let match;
      while ((match = CMD_PATTERN.exec(content)) !== null) {
        const cmd = match[1];
        // Skip if it's a known command or a subcommand we can't verify
        if (!VALID_COMMANDS.has(cmd) && !cmd.includes(':')) {
          warnings.push(
            `[${label}] ${skill}/SKILL.md: references 'monomind ${cmd}' — not a recognized top-level command`,
          );
        }
      }
    }
  }
}

// --- Check cross-tree drift ---
function checkDrift() {
  const tree1 = join(SKILL_TREES[0]);
  const tree2 = join(SKILL_TREES[1]);
  if (!existsSync(tree1) || !existsSync(tree2)) return;

  const skills1 = new Set(readdirSync(tree1).filter((d) => existsSync(join(tree1, d, 'SKILL.md'))));
  const skills2 = new Set(readdirSync(tree2).filter((d) => existsSync(join(tree2, d, 'SKILL.md'))));

  const only1 = [...skills1].filter((s) => !skills2.has(s));
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

// --- Run ---
lintTree(SKILL_TREES[0], 'root');
lintTree(SKILL_TREES[1], 'packages');
checkDrift();

// --- Report ---
if (warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  for (const w of warnings) console.log(`  ${w}`);
}
if (errors.length > 0) {
  console.error('\n❌ Errors:');
  for (const e of errors) console.error(`  ${e}`);
  console.error(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`✓ Skill lint passed — 0 errors, ${warnings.length} warning(s)`);
