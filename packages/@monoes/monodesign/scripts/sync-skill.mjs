#!/usr/bin/env node
/**
 * sync-skill.mjs — build and deploy the monodesign skill from this package
 * (the source of truth) into the repo's .claude trees:
 *
 *   <repo>/.claude/skills/monodesign/
 *   <repo>/packages/@monomind/cli/.claude/skills/monodesign/
 *
 * What it does:
 *   1. Compiles skill/SKILL.src.md → SKILL.md
 *      - {{scripts_path}}   → .claude/skills/monodesign/scripts
 *      - {{command_prefix}} → "/"  (the source text appends "monodesign"
 *        itself, e.g. `{{command_prefix}}monodesign audit` → `/monodesign audit`,
 *        matching the original engine semantics where the placeholder is the
 *        harness slash prefix, not the full command name)
 *      - {{command_hint}}   → command names from skill/scripts/command-metadata.json
 *      - {{model}} / {{config_file}} / {{ask_instruction}} / {{available_commands}}
 *        → Claude Code values (see PLACEHOLDERS below)
 *      - <claude>/<claude-code> conditional blocks: content kept, tags dropped;
 *        other known provider blocks (<codex>, <gemini>, …) are removed entirely
 *      - <!-- rule:… --> markers stripped
 *      - any leftover {{…}} placeholder is stripped with a warning
 *   2. Copies skill/reference/, skill/scripts/, skill/agents/ into the deploy
 *      dirs (markdown gets the same placeholder pipeline; scripts are verbatim)
 *   3. Copies cli/engine/ → <deploy>/scripts/detector/ so detect.mjs and
 *      hook-lib.mjs resolve the detector via their first candidate path
 *   4. Deploys skill/commands/*.md as top-level command stub files when that
 *      directory exists
 *   5. Only ever touches the files/dirs it manages (SKILL.md, reference/,
 *      scripts/, agents/, and the command stubs it copies) — other top-level
 *      files in the deployed skill dir are left alone
 *
 * Usage:  node scripts/sync-skill.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..', '..');

const SKILL_SRC = path.join(PKG_ROOT, 'skill');
const ENGINE_SRC = path.join(PKG_ROOT, 'cli', 'engine');

const DEPLOY_TARGETS = [
  path.join(REPO_ROOT, '.claude', 'skills', 'monodesign'),
  path.join(REPO_ROOT, 'packages', '@monomind', 'cli', '.claude', 'skills', 'monodesign'),
];

const SCRIPTS_PATH = '.claude/skills/monodesign/scripts';

const PLACEHOLDERS = {
  scripts_path: SCRIPTS_PATH,
  command_prefix: '/',
  model: 'Claude',
  config_file: 'CLAUDE.md',
  ask_instruction: 'STOP and call the AskUserQuestion tool to clarify.',
};

// Harness-conditional block tags recognized by the original engine. Blocks for
// ACTIVE_TAGS keep their content (tags dropped); the rest are removed.
const PROVIDER_BLOCK_TAGS = new Set([
  'agents', 'claude', 'claude-code', 'codex', 'cursor', 'gemini', 'github',
  'kiro', 'opencode', 'pi', 'qoder', 'rovo-dev', 'trae', 'trae-cn',
]);
const ACTIVE_TAGS = new Set(['claude', 'claude-code']);

const dryRun = process.argv.includes('--dry-run');
const warnings = [];

function log(msg) {
  console.log(`${dryRun ? '[dry-run] ' : ''}${msg}`);
}

// ─── markdown transforms ─────────────────────────────────────────────────────

function compileProviderBlocks(content) {
  const pattern = /(^|\r?\n)[ \t]*<([a-z][a-z0-9-]*)>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/\2>[ \t]*(?=\r?\n|$)/g;
  let didCompile = false;
  const compiled = content.replace(pattern, (match, prefix, tag, body) => {
    if (!PROVIDER_BLOCK_TAGS.has(tag)) return match;
    didCompile = true;
    return ACTIVE_TAGS.has(tag) ? `${prefix}${body}` : prefix;
  });
  return didCompile ? compiled.replace(/(?:\r?\n){3,}/g, '\n\n') : compiled;
}

function stripRuleMarkers(content) {
  return content.replace(/[ \t]*<!--\s*rule:[a-z0-9-]+\s*-->/g, '');
}

function loadCommandNames() {
  try {
    const raw = fs.readFileSync(path.join(SKILL_SRC, 'scripts', 'command-metadata.json'), 'utf-8');
    return Object.keys(JSON.parse(raw));
  } catch (err) {
    warnings.push(`could not read command-metadata.json (${err.message}); {{command_hint}} left empty`);
    return [];
  }
}

const commandNames = loadCommandNames();

function transformMarkdown(content, sourceLabel) {
  let out = compileProviderBlocks(content);
  out = stripRuleMarkers(out);
  out = out
    .replace(/\{\{command_hint\}\}/g, commandNames.join('|'))
    .replace(/\{\{available_commands\}\}/g, commandNames.map((n) => `/monodesign ${n}`).join(', '));
  for (const [key, value] of Object.entries(PLACEHOLDERS)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  // Strip anything unresolved, but tell the operator about it.
  out = out.replace(/\{\{([a-z0-9_]+)\}\}/g, (_m, name) => {
    warnings.push(`${sourceLabel}: unknown placeholder {{${name}}} stripped`);
    return '';
  });
  return out;
}

// ─── file operations (dry-run aware) ─────────────────────────────────────────

function writeFileManaged(dest, content) {
  log(`write  ${path.relative(REPO_ROOT, dest)}`);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

function copyTreeManaged(srcDir, destDir, { markdownTransform = false, merge = false } = {}) {
  if (!fs.existsSync(srcDir)) return;
  log(`sync   ${path.relative(PKG_ROOT, srcDir)}/ → ${path.relative(REPO_ROOT, destDir)}/${merge ? ' (merge)' : ''}`);
  if (!dryRun) {
    if (!merge) fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
  }
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue; // exFAT junk
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeManaged(src, dest, { markdownTransform, merge });
      continue;
    }
    if (markdownTransform && entry.name.endsWith('.md')) {
      const content = transformMarkdown(fs.readFileSync(src, 'utf-8'), path.relative(PKG_ROOT, src));
      if (!dryRun) fs.writeFileSync(dest, content);
    } else if (!dryRun) {
      fs.copyFileSync(src, dest);
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

const skillSrcPath = path.join(SKILL_SRC, 'SKILL.src.md');
if (!fs.existsSync(skillSrcPath)) {
  console.error(`Error: ${skillSrcPath} not found`);
  process.exit(1);
}

const compiledSkill = transformMarkdown(fs.readFileSync(skillSrcPath, 'utf-8'), 'skill/SKILL.src.md');

for (const target of DEPLOY_TARGETS) {
  // Deploy trees are generated (gitignored) — regenerate only inside a
  // monomind checkout. Outside it (standalone install, prepare hook) skip
  // rather than creating stray directories above the package.
  if (!fs.existsSync(path.dirname(path.dirname(target)))) {
    log(`skip   ${target} (not in a monomind checkout)`);
    continue;
  }
  log(`deploy → ${path.relative(REPO_ROOT, target)}`);

  // (a) compiled SKILL.md
  writeFileManaged(path.join(target, 'SKILL.md'), compiledSkill);

  // (b) reference/, scripts/, agents/
  copyTreeManaged(path.join(SKILL_SRC, 'reference'), path.join(target, 'reference'), { markdownTransform: true });
  copyTreeManaged(path.join(SKILL_SRC, 'scripts'), path.join(target, 'scripts'));
  copyTreeManaged(path.join(SKILL_SRC, 'agents'), path.join(target, 'agents'), { markdownTransform: true });

  // (c) detector engine as a sibling of the deployed scripts, where
  // detect.mjs / hook-lib.mjs look first (<scripts>/detector/…)
  copyTreeManaged(ENGINE_SRC, path.join(target, 'scripts', 'detector'));

  // (c2) cli/lib helpers merged into scripts/lib — the engine's cli/main.mjs
  // and bin/commands import ../../lib/monodesign-config.mjs, which from the
  // deployed scripts/detector/ layout resolves to scripts/lib/ (upstream
  // ships its config lib the same way)
  copyTreeManaged(path.join(PKG_ROOT, 'cli', 'lib'), path.join(target, 'scripts', 'lib'), { merge: true });

  // (d) optional top-level command stubs
  const commandsDir = path.join(SKILL_SRC, 'commands');
  if (fs.existsSync(commandsDir)) {
    for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('._')) continue;
      const content = transformMarkdown(
        fs.readFileSync(path.join(commandsDir, entry.name), 'utf-8'),
        `skill/commands/${entry.name}`,
      );
      writeFileManaged(path.join(target, entry.name), content);
    }
  }
}

if (warnings.length > 0) {
  console.warn('\nWarnings:');
  for (const w of [...new Set(warnings)]) console.warn(`  - ${w}`);
}

log(dryRun ? 'dry run complete — no files written' : 'sync complete');
