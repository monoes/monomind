/**
 * CLI Platforms Command
 * Install/uninstall Monograph context instructions for 14 AI coding platforms
 *
 * github.com/monoes/monomind
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { homedir } from 'os';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

export const SUPPORTED_PLATFORMS = [
  'claude', 'gemini', 'cursor', 'vscode', 'copilot',
  'opencode', 'aider', 'kiro', 'trae', 'claw',
  'droid', 'antigravity', 'hermes', 'codex',
] as const;

export type Platform = typeof SUPPORTED_PLATFORMS[number];

const PLATFORM_CONFIG_FILES: Record<Platform, string[]> = {
  claude:      ['CLAUDE.md'],
  gemini:      ['GEMINI.md'],
  cursor:      ['.cursorrules', '.cursor/rules/monomind.mdc'],
  vscode:      ['.github/copilot-instructions.md'],
  copilot:     ['.github/copilot-instructions.md'],
  opencode:    ['OpenCode.md'],
  aider:       ['.aider.conf.yml'],
  kiro:        ['.kiro/steering/monomind.md'],
  trae:        ['.trae/rules/monomind.md'],
  claw:        ['.claw/config.md'],
  droid:       ['DROID.md'],
  antigravity: ['.agents/rules/monomind.md'],
  hermes:      ['HERMES.md'],
  codex:       ['AGENTS.md'],
};

/**
 * YAML/MDC frontmatter to prepend for platform rule files that require it.
 * Cursor .mdc files use MDC YAML frontmatter; agy workspace rules use alwaysApply.
 */
const FILE_FRONTMATTER: Record<string, string> = {
  '.cursor/rules/monomind.mdc': [
    '---',
    'description: Monomind monograph knowledge graph integration',
    'alwaysApply: true',
    '---',
  ].join('\n'),
  '.agents/rules/monomind.md': [
    '---',
    'name: monomind-integration',
    'alwaysApply: true',
    'description: Enable monomind monograph knowledge graph',
    '---',
  ].join('\n'),
};

const MONOMIND_BLOCK_START = '<!-- monomind:start -->';
const MONOMIND_BLOCK_END = '<!-- monomind:end -->';

function getMonomindInstructions(relPath?: string): string {
  const body = `${MONOMIND_BLOCK_START}
# Monograph Knowledge Graph

This repository is indexed by Monograph. Before starting complex tasks:
- Use \`monograph_query\` to search the knowledge graph
- Use \`monograph_neighbors\` to explore dependencies
- Use \`monograph_impact\` to understand change blast radius

Graph is at \`.monomind/monograph.db\`. Rebuild with: \`npx monograph build\`

# Mastermind Skills

If mastermind skills are installed, invoke the matching skill BEFORE any response or action.
Even a 1% chance a skill applies means you must check first.

Skills live in \`~/.agents/skills/\` (Codex/Gemini/Copilot/Cursor) or \`~/.claude/skills/\` (Claude Code).
Load the relevant \`SKILL.md\` before acting on any non-trivial task.
${MONOMIND_BLOCK_END}
`;
  const frontmatter = relPath ? FILE_FRONTMATTER[relPath] : undefined;
  return frontmatter ? `${frontmatter}\n\n${body}` : body;
}

// The mastermind-activate script (embedded so setup can write it to platform-specific locations).
// Walks up from process.cwd() to find master.md, extracts the MASTERMIND PROTOCOL section,
// and writes it to stdout for SessionStart hook injection.
const MASTERMIND_ACTIVATE_SCRIPT = `'use strict';
const fs = require('fs');
const path = require('path');

function findMasterPath() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) candidates.push(process.env.CLAUDE_PROJECT_DIR);
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of candidates) {
    const p = path.join(base, '.claude', 'commands', 'mastermind', 'master.md');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function extractProtocol(content) {
  const marker = '\\n---\\n\\n**If $ARGUMENTS is empty:**';
  const idx = content.indexOf(marker);
  if (idx !== -1) return content.slice(0, idx).trim();
  const fallback = content.indexOf('\\n**MASTERMIND** —');
  if (fallback !== -1) return content.slice(0, fallback).trim();
  return content.trim();
}

const masterPath = findMasterPath();
if (!masterPath) process.exit(0);

try {
  let raw = fs.readFileSync(masterPath, 'utf8');
  const body = raw.replace(/^---[\\s\\S]*?---\\s*/, '');
  const protocol = extractProtocol(body);
  if (protocol) process.stdout.write(protocol + '\\n');
} catch { process.exit(0); }
`;

// ──────────────────────────────────────────────────────────────
// Skills packaging helpers
// ──────────────────────────────────────────────────────────────

/** Walk up from cwd to find the mastermind commands directory. */
function findMastermindSourceDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, '.claude', 'commands', 'mastermind');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Copy mastermind skill files into targetDir as <skill-name>/SKILL.md packages.
 * Files starting with _ are internal helpers and are skipped.
 * master.md → targetDir/mastermind/SKILL.md (root routing skill)
 * build.md  → targetDir/mastermind-build/SKILL.md
 *
 * Also copies the references/ subdir alongside mastermind/SKILL.md so
 * platforms that follow relative links (e.g. agy's antigravity-tools.md) can resolve them.
 */
function installMastermindSkills(targetDir: string, sourceDir: string): string[] {
  const written: string[] = [];
  const files = readdirSync(sourceDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));

  for (const file of files) {
    const name = basename(file, '.md');
    const skillDir = name === 'master'
      ? join(targetDir, 'mastermind')
      : join(targetDir, `mastermind-${name}`);

    const destFile = join(skillDir, 'SKILL.md');
    if (!existsSync(destFile)) {
      mkdirSync(skillDir, { recursive: true });
      const content = readFileSync(join(sourceDir, file), 'utf8');
      writeFileSync(destFile, content, 'utf8');
      written.push(destFile);
    }

    // Copy references/ alongside the mastermind umbrella skill (checked independently)
    if (name === 'master') {
      const refSrc = join(sourceDir, 'references');
      if (existsSync(refSrc)) {
        const refDest = join(skillDir, 'references');
        mkdirSync(refDest, { recursive: true });
        for (const ref of readdirSync(refSrc).filter(f => f.endsWith('.md'))) {
          const destRef = join(refDest, ref);
          if (!existsSync(destRef)) {
            writeFileSync(destRef, readFileSync(join(refSrc, ref), 'utf8'), 'utf8');
            written.push(destRef);
          }
        }
      }
    }
  }

  return written;
}

// ──────────────────────────────────────────────────────────────
// Global setup helpers (platform-specific, user-level config)
// ──────────────────────────────────────────────────────────────

function setupCodex(activateScriptPath: string): string[] {
  const home = homedir();
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });

  // Write the activate script
  writeFileSync(activateScriptPath, MASTERMIND_ACTIVATE_SCRIPT, 'utf8');

  // Merge a [[hooks]] entry into ~/.codex/config.toml
  const configPath = join(codexDir, 'config.toml');
  const hookBlock = [
    '',
    '# monomind:start',
    '[[hooks]]',
    'event = "SessionStart"',
    'matcher = ""',
    '[[hooks.hooks]]',
    'type = "command"',
    `command = "node ${activateScriptPath}"`,
    'statusMessage = "Loading mastermind protocol"',
    'timeout = 5000',
    '# monomind:end',
  ].join('\n');

  let config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const written: string[] = [];
  if (!config.includes('# monomind:start')) {
    writeFileSync(configPath, config + hookBlock, 'utf8');
    written.push(configPath, activateScriptPath);
  }

  // Install mastermind skills to ~/.agents/skills/ (shared cross-runtime dir)
  const sourceDir = findMastermindSourceDir();
  if (sourceDir) {
    const skillsDir = join(home, '.agents', 'skills');
    written.push(...installMastermindSkills(skillsDir, sourceDir));
  }

  return written;
}

function setupCursor(activateScriptPath: string, repoPath: string): string[] {
  // Write the activate script to ~/.cursor/
  writeFileSync(activateScriptPath, MASTERMIND_ACTIVATE_SCRIPT, 'utf8');

  // Merge SessionStart hook into .cursor/settings.json (project-level)
  const settingsPath = join(repoPath, '.cursor', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* keep empty */ }
  }

  const hooks = (settings['hooks'] as Record<string, unknown[]> | undefined) ?? {};
  const sessionStart = (hooks['SessionStart'] as unknown[] | undefined) ?? [];

  const alreadyAdded = sessionStart.some(
    (h: unknown) =>
      typeof h === 'object' && h !== null &&
      (h as Record<string, unknown[]>)['hooks']?.some?.(
        (inner: unknown) =>
          typeof inner === 'object' && inner !== null &&
          (inner as Record<string, string>)['command']?.includes('monomind-activate')
      )
  );

  const written: string[] = [];
  if (!alreadyAdded) {
    sessionStart.push({
      matcher: '',
      hooks: [{ type: 'command', command: `node "${activateScriptPath}"`, timeout: 5000 }],
    });
    hooks['SessionStart'] = sessionStart;
    settings['hooks'] = hooks;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    written.push(settingsPath, activateScriptPath);
  }

  // Install mastermind skills to ~/.agents/skills/ (Cursor shares the cross-runtime dir)
  const sourceDir = findMastermindSourceDir();
  if (sourceDir) {
    const skillsDir = join(homedir(), '.agents', 'skills');
    written.push(...installMastermindSkills(skillsDir, sourceDir));
  }

  return written;
}

function setupAntigravity(): string[] {
  const home = homedir();
  const pluginDir = join(home, '.gemini', 'antigravity-cli', 'plugins', 'monomind');
  const rulesDir = join(pluginDir, 'rules');
  mkdirSync(rulesDir, { recursive: true });

  const pluginJson = join(pluginDir, 'plugin.json');
  const ruleFile = join(rulesDir, 'mastermind.md');

  const written: string[] = [];

  if (!existsSync(pluginJson)) {
    writeFileSync(pluginJson, JSON.stringify({
      name: 'monomind',
      version: '1.0.0',
      description: 'Monomind monograph knowledge graph and mastermind skills for Antigravity CLI',
    }, null, 2), 'utf8');
    written.push(pluginJson);
  }

  if (!existsSync(ruleFile)) {
    writeFileSync(ruleFile, [
      '---',
      'name: monomind-integration',
      'alwaysApply: true',
      'description: Enable monomind monograph and mastermind skills',
      '---',
      '',
      '# Monomind Integration',
      '',
      'This project uses Monograph for knowledge graph navigation.',
      'Before starting complex tasks, use `view_file` on `.monomind/monograph.db` context',
      'and invoke the relevant mastermind skill SKILL.md before acting.',
      '',
      '## Monograph',
      '- `monograph_query` — BM25 search the knowledge graph',
      '- `monograph_impact` — blast radius before any change',
      '- `monograph_neighbors` — explore dependencies',
      '',
      '## Mastermind Skills',
      'Check `~/.gemini/skills/` for installed mastermind skills.',
      'Load SKILL.md with `view_file` (IsSkillFile: true) before acting on non-trivial tasks.',
    ].join('\n'), 'utf8');
    written.push(ruleFile);
  }

  // Install mastermind skills to ~/.gemini/skills/ (agy's skill dir)
  const sourceDir = findMastermindSourceDir();
  if (sourceDir) {
    const skillsDir = join(home, '.gemini', 'skills');
    written.push(...installMastermindSkills(skillsDir, sourceDir));
  }

  return written;
}

async function handleSetup(ctx: CommandContext): Promise<CommandResult> {
  const platform = ctx.flags['platform'] as string | undefined;
  const all = ctx.flags['all'] as boolean | undefined;
  let repoPath: string;
  try {
    repoPath = resolveRepoPath((ctx.flags['path'] as string | undefined) ?? '.');
  } catch (err) {
    output.error(`Invalid --path: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, exitCode: 1 };
  }

  if (!platform && !all) {
    output.error('Specify --platform <name> or --all');
    output.info(`Platforms with global setup: cursor, codex, antigravity`);
    return { success: false, exitCode: 1 };
  }

  const targets: Platform[] = all ? [...SUPPORTED_PLATFORMS] : [platform as Platform];
  const home = homedir();
  let totalFiles = 0;

  for (const p of targets) {
    let written: string[] = [];
    try {
      if (p === 'codex') {
        written = setupCodex(join(home, '.codex', 'monomind-activate.cjs'));
      } else if (p === 'cursor') {
        written = setupCursor(join(home, '.cursor', 'monomind-activate.cjs'), repoPath);
      } else if (p === 'antigravity') {
        written = setupAntigravity();
      } else {
        output.info(`[${p}] No global setup needed — use \`platforms install\``);
        continue;
      }
    } catch (err) {
      output.error(`[${p}] Setup failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (written.length > 0) {
      for (const f of written) output.success(`[${p}] ✓ ${f}`);
      totalFiles += written.length;
    } else {
      output.info(`[${p}] Already set up — skipped`);
    }
  }

  output.success(`Done. ${totalFiles} file(s) written.`);
  return { success: true };
}

/**
 * Maximum size for a platform config file we will read or append to.
 * Platform config files (CLAUDE.md, .cursorrules, etc.) are never legitimately
 * larger than a few hundred KB — a 1 MB cap prevents OOM when the flag points
 * at an enormous file such as a binary or a DB dump.
 */
const MAX_CONFIG_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Resolve and validate the user-supplied --path flag.
 *
 * SECURITY: the flag is attacker-controlled. Without validation an adversary can
 *   pass --path /etc to overwrite system files, or --path "../../.." to escape
 *   the project. We resolve to an absolute path and reject anything that isn't
 *   a directory (or doesn't exist yet under a parent that does exist).
 *   We do NOT further restrict the path to cwd because a legitimate use case is
 *   "install into another repo at an absolute path", but we do require the
 *   resolved path to be a directory (or the parent to exist) so that the caller
 *   cannot aim the flag at a file.
 */
function resolveRepoPath(rawPath: string): string {
  // Prevent shell-injection via null bytes or unusual separators
  if (rawPath.includes('\0')) throw new Error('Invalid path: contains null byte');
  const resolved = resolve(rawPath);
  // If the path exists it must be a directory
  if (existsSync(resolved)) {
    const st = statSync(resolved);
    if (!st.isDirectory()) throw new Error(`--path must be a directory, got a file: ${resolved}`);
  }
  return resolved;
}

/**
 * Validate that fullPath is contained within repoRoot (path traversal defence).
 * relPath comes from our own PLATFORM_CONFIG_FILES map, but we validate anyway
 * to guard against future changes that introduce dynamic paths.
 */
function assertWithinRoot(fullPath: string, repoRoot: string): void {
  if (!fullPath.startsWith(repoRoot + '/') && fullPath !== repoRoot) {
    throw new Error(`Path escapes repository root: ${fullPath}`);
  }
}

function installPlatform(platform: Platform, repoPath: string): string[] {
  const files = PLATFORM_CONFIG_FILES[platform];
  const written: string[] = [];

  for (const relPath of files) {
    const instructions = getMonomindInstructions(relPath);
    const fullPath = resolve(join(repoPath, relPath));
    assertWithinRoot(fullPath, repoPath);
    const dir = dirname(fullPath);
    mkdirSync(dir, { recursive: true });

    if (existsSync(fullPath)) {
      // Guard against reading oversized files (e.g. the flag points at a data file)
      const fileStat = statSync(fullPath);
      if (fileStat.size > MAX_CONFIG_FILE_BYTES) {
        throw new Error(`Config file too large to read (${fileStat.size} bytes): ${relPath}`);
      }
      const existing = readFileSync(fullPath, 'utf8');
      if (existing.includes(MONOMIND_BLOCK_START)) continue;
      writeFileSync(fullPath, existing + '\n' + instructions, 'utf8');
    } else {
      writeFileSync(fullPath, instructions, 'utf8');
    }
    written.push(relPath);
  }

  return written;
}

function uninstallPlatform(platform: Platform, repoPath: string): string[] {
  const files = PLATFORM_CONFIG_FILES[platform];
  const blockRe = new RegExp(
    `\\n?${MONOMIND_BLOCK_START}[\\s\\S]*?${MONOMIND_BLOCK_END}\\n?`, 'g'
  );
  const cleaned: string[] = [];

  for (const relPath of files) {
    const fullPath = resolve(join(repoPath, relPath));
    assertWithinRoot(fullPath, repoPath);
    if (!existsSync(fullPath)) continue;
    // Guard against reading oversized files
    const fileStat = statSync(fullPath);
    if (fileStat.size > MAX_CONFIG_FILE_BYTES) {
      throw new Error(`Config file too large to read (${fileStat.size} bytes): ${relPath}`);
    }
    const content = readFileSync(fullPath, 'utf8');
    writeFileSync(fullPath, content.replace(blockRe, ''), 'utf8');
    cleaned.push(relPath);
  }

  return cleaned;
}

async function handleInstall(ctx: CommandContext): Promise<CommandResult> {
  const platform = ctx.flags['platform'] as string | undefined;
  const all = ctx.flags['all'] as boolean | undefined;
  let repoPath: string;
  try {
    repoPath = resolveRepoPath((ctx.flags['path'] as string | undefined) ?? '.');
  } catch (err) {
    output.error(`Invalid --path: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, exitCode: 1 };
  }

  if (!platform && !all) {
    output.error('Specify --platform <name> or --all');
    output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
    return { success: false, exitCode: 1 };
  }

  const targets: Platform[] = all
    ? [...SUPPORTED_PLATFORMS]
    : [platform as Platform];

  const invalid = targets.filter(p => !(SUPPORTED_PLATFORMS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    output.error(`Unknown platform(s): ${invalid.join(', ')}`);
    output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
    return { success: false, exitCode: 1 };
  }

  let totalFiles = 0;
  for (const p of targets) {
    let written: string[];
    try {
      written = installPlatform(p, repoPath);
    } catch (err) {
      output.error(`[${p}] Install failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (written.length > 0) {
      output.success(`[${p}] Installed Monograph context → ${written.join(', ')}`);
      totalFiles += written.length;
    } else {
      output.info(`[${p}] Already installed — skipped`);
    }
  }

  output.success(`Done. ${totalFiles} file(s) updated.`);
  return { success: true };
}

async function handleUninstall(ctx: CommandContext): Promise<CommandResult> {
  const platform = ctx.flags['platform'] as string | undefined;
  const all = ctx.flags['all'] as boolean | undefined;
  let repoPath: string;
  try {
    repoPath = resolveRepoPath((ctx.flags['path'] as string | undefined) ?? '.');
  } catch (err) {
    output.error(`Invalid --path: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, exitCode: 1 };
  }

  if (!platform && !all) {
    output.error('Specify --platform <name> or --all');
    output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
    return { success: false, exitCode: 1 };
  }

  const targets: Platform[] = all
    ? [...SUPPORTED_PLATFORMS]
    : [platform as Platform];

  const invalid = targets.filter(p => !(SUPPORTED_PLATFORMS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    output.error(`Unknown platform(s): ${invalid.join(', ')}`);
    output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
    return { success: false, exitCode: 1 };
  }

  let totalFiles = 0;
  for (const p of targets) {
    let cleaned: string[];
    try {
      cleaned = uninstallPlatform(p, repoPath);
    } catch (err) {
      output.error(`[${p}] Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (cleaned.length > 0) {
      output.success(`[${p}] Removed Monograph context from ${cleaned.join(', ')}`);
      totalFiles += cleaned.length;
    } else {
      output.info(`[${p}] Nothing to remove — skipped`);
    }
  }

  output.success(`Done. ${totalFiles} file(s) cleaned.`);
  return { success: true };
}

const platformOptions = [
  {
    name: 'platform',
    description: `Target platform (${SUPPORTED_PLATFORMS.join(', ')})`,
    type: 'string' as const,
  },
  {
    name: 'all',
    description: 'Apply to all 14 supported platforms',
    type: 'boolean' as const,
    default: false,
  },
  {
    name: 'path',
    description: 'Path to the repository root (default: current directory)',
    type: 'string' as const,
    default: '.',
  },
];

export const platformsCommand: Command = {
  name: 'platforms',
  description: 'Install or uninstall Monograph context instructions for AI coding platforms',
  subcommands: [
    {
      name: 'install',
      description: 'Inject Monograph knowledge-graph instructions into platform config file(s)',
      options: platformOptions,
      examples: [
        { command: 'monomind platforms install --platform claude', description: 'Install for Claude' },
        { command: 'monomind platforms install --all', description: 'Install for all 14 platforms' },
        { command: 'monomind platforms install --platform cursor --path /path/to/repo', description: 'Install for Cursor in a specific repo' },
      ],
      action: handleInstall,
    },
    {
      name: 'uninstall',
      description: 'Remove Monograph knowledge-graph instructions from platform config file(s)',
      options: platformOptions,
      examples: [
        { command: 'monomind platforms uninstall --platform claude', description: 'Uninstall for Claude' },
        { command: 'monomind platforms uninstall --all', description: 'Uninstall from all 14 platforms' },
      ],
      action: handleUninstall,
    },
    {
      name: 'setup',
      description: 'Write global (user-level) SessionStart hooks and plugin packages for cursor, codex, and antigravity',
      options: platformOptions,
      examples: [
        { command: 'monomind platforms setup --platform codex', description: 'Wire SessionStart hook into ~/.codex/config.toml' },
        { command: 'monomind platforms setup --platform cursor', description: 'Wire SessionStart hook into .cursor/settings.json' },
        { command: 'monomind platforms setup --platform antigravity', description: 'Install monomind plugin into ~/.gemini/antigravity-cli/plugins/' },
      ],
      action: handleSetup,
    },
  ],
  examples: [
    { command: 'monomind platforms install --all', description: 'Install Monograph context for all platforms' },
    { command: 'monomind platforms setup --platform codex', description: 'Wire Codex SessionStart hook (run once per machine)' },
    { command: 'monomind platforms uninstall --platform cursor', description: 'Remove context from Cursor config' },
  ],
};
