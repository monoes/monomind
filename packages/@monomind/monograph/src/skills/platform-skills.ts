/**
 * Multi-platform IDE Skill File Installer
 *
 * Generates and installs per-community skill files for various IDE/platform
 * targets (Claude, Cursor, VS Code, Zed, Codex, Gemini, Aider, Copilot, Kiro).
 * Each platform gets one file per community describing exported symbols from
 * that community.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export type SkillPlatform = 'claude' | 'cursor' | 'vscode' | 'zed' | 'codex' | 'gemini' | 'aider' | 'copilot' | 'kiro';

export interface PlatformSkillConfig {
  platform: SkillPlatform;
  /** Override output directory. Default: platform-specific. */
  outputDir?: string;
}

export interface SkillInstallResult {
  platform: SkillPlatform;
  filesWritten: string[];
  outputDir: string;
}

export interface SyncSkillInstallResult {
  filesWritten: string[];
}

// ============================================================================
// SUPPORTED PLATFORMS
// ============================================================================

export const SUPPORTED_PLATFORMS: string[] = [
  'claude',
  'cursor',
  'vscode',
  'zed',
  'codex',
  'gemini',
  'aider',
  'copilot',
  'kiro',
];

// ============================================================================
// PLATFORM CONFIG
// ============================================================================

const PLATFORM_DEFAULTS: Record<SkillPlatform, { subPath: string[]; ext: string }> = {
  claude:  { subPath: ['.claude', 'skills'], ext: '.md' },
  cursor:  { subPath: ['.cursor', 'rules'], ext: '.md' },
  vscode:  { subPath: ['.vscode'], ext: '.json' },
  zed:     { subPath: ['.zed'], ext: '.md' },
  codex:   { subPath: [], ext: '.md' },
  gemini:  { subPath: [], ext: '.md' },
  aider:   { subPath: [], ext: '.md' },
  copilot: { subPath: ['.github'], ext: '.md' },
  kiro:    { subPath: ['.kiro', 'steering'], ext: '.md' },
};

/**
 * Fixed file names for single-file platforms (no per-community files).
 * When defined, a single skill file is written regardless of communities.
 */
const PLATFORM_FIXED_FILE: Partial<Record<SkillPlatform, string>> = {
  codex:   'AGENTS.md',
  gemini:  'GEMINI.md',
  aider:   'AGENTS.md',
  copilot: 'copilot-instructions.md',
  kiro:    'monograph.md',
};

// ============================================================================
// SYNC INSTALLER (for new platforms + compatibility)
// ============================================================================

/**
 * Synchronously install a skill file for a specific platform into the repo.
 * Returns { filesWritten } where filesWritten contains absolute paths to written files.
 *
 * New single-file platforms (codex, gemini, aider, copilot, kiro) always write
 * one file regardless of communities. Existing multi-file platforms write one
 * file per community entry.
 */
export function installPlatformSkill(
  repoPath: string,
  platform: string,
  communities: Array<{ name: string; symbols: string[] } | string>,
): SyncSkillInstallResult {
  const platformConfig = PLATFORM_DEFAULTS[platform as SkillPlatform];
  if (!platformConfig) {
    return { filesWritten: [] };
  }

  const outputDir = platformConfig.subPath.length > 0
    ? path.join(repoPath, ...platformConfig.subPath)
    : repoPath;

  fsSync.mkdirSync(outputDir, { recursive: true });

  const filesWritten: string[] = [];
  const fixedFileName = PLATFORM_FIXED_FILE[platform as SkillPlatform];

  if (fixedFileName) {
    // Single-file platform: write one skill overview file
    const filePath = path.join(outputDir, fixedFileName);
    const content = renderMonographSkillDoc(platform);
    fsSync.writeFileSync(filePath, content, 'utf-8');
    filesWritten.push(filePath);
  } else {
    // Multi-file platform: one file per community (existing behavior)
    const ext = platformConfig.ext;
    const normalised = communities.map(c =>
      typeof c === 'string' ? { name: c, symbols: [] } : c,
    );
    for (const community of normalised) {
      const fileName = `${community.name}-skills${ext}`;
      const filePath = path.join(outputDir, fileName);
      let content: string;
      if (ext === '.json') {
        content = renderVsCodeSnippet(community);
      } else {
        content = renderMarkdown(community);
      }
      fsSync.writeFileSync(filePath, content, 'utf-8');
      filesWritten.push(filePath);
    }
  }

  return { filesWritten };
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Install skill files for a specific platform into the repo.
 *
 * Platform output directories (relative to repoPath):
 *   claude  → .claude/skills/
 *   cursor  → .cursor/rules/
 *   vscode  → .vscode/
 *   zed     → .zed/
 *
 * Each platform gets one file per community. File names use the community name.
 * Format:
 *   claude/cursor/zed → <communityName>-skills.md
 *   vscode            → <communityName>-skills.json (VS Code snippets format)
 */
export async function installSkillsForPlatform(
  repoPath: string,
  communities: Array<{ name: string; symbols: string[] }>,
  config: PlatformSkillConfig,
): Promise<SkillInstallResult> {
  const platformConfig = PLATFORM_DEFAULTS[config.platform];
  const outputDir = config.outputDir ?? path.join(repoPath, ...platformConfig.subPath);

  if (communities.length === 0) {
    return { platform: config.platform, filesWritten: [], outputDir };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const filesWritten: string[] = [];
  const ext = platformConfig.ext;

  for (const community of communities) {
    const fileName = `${community.name}-skills${ext}`;
    const filePath = path.join(outputDir, fileName);

    let content: string;
    if (ext === '.json') {
      content = renderVsCodeSnippet(community);
    } else {
      content = renderMarkdown(community);
    }

    await fs.writeFile(filePath, content, 'utf-8');
    filesWritten.push(filePath);
  }

  return { platform: config.platform, filesWritten, outputDir };
}

// ============================================================================
// RENDERERS
// ============================================================================

function renderMonographSkillDoc(platform: string): string {
  const lines: string[] = [];
  lines.push(`# Monograph Skills — ${platform.charAt(0).toUpperCase() + platform.slice(1)}`);
  lines.push('');
  lines.push('This file was generated by Monograph to document available skills for this platform.');
  lines.push('');
  lines.push('## Usage');
  lines.push('');
  lines.push('Monograph indexes your codebase and exposes symbol-level knowledge to AI assistants.');
  lines.push('Run `monograph build` to update the knowledge graph and regenerate skill files.');
  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(community: { name: string; symbols: string[] }): string {
  const lines: string[] = [];
  lines.push(`# ${community.name} Skills`);
  lines.push('');
  for (const symbol of community.symbols) {
    lines.push(`- ${symbol}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderVsCodeSnippet(community: { name: string; symbols: string[] }): string {
  const snippetKey = community.name;
  const body = community.symbols;
  const snippet = {
    [snippetKey]: {
      prefix: community.name,
      body,
      description: `${community.name} monograph skill`,
    },
  };
  return JSON.stringify(snippet, null, 2);
}
