/**
 * Multi-platform IDE Skill File Installer
 *
 * Generates and installs per-community skill files for various IDE/platform
 * targets (Claude, Cursor, VS Code, Zed). Each platform gets one file per
 * community describing exported symbols from that community.
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export type SkillPlatform = 'claude' | 'cursor' | 'vscode' | 'zed';

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

// ============================================================================
// PLATFORM CONFIG
// ============================================================================

const PLATFORM_DEFAULTS: Record<SkillPlatform, { subPath: string[]; ext: string }> = {
  claude: { subPath: ['.claude', 'skills'], ext: '.md' },
  cursor: { subPath: ['.cursor', 'rules'], ext: '.md' },
  vscode: { subPath: ['.vscode'], ext: '.json' },
  zed:    { subPath: ['.zed'], ext: '.md' },
};

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
