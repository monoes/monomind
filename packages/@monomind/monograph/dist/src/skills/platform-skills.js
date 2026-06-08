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
// SUPPORTED PLATFORMS
// ============================================================================
export const SUPPORTED_PLATFORMS = [
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
const PLATFORM_DEFAULTS = {
    claude: { subPath: ['.claude', 'skills'], ext: '.md' },
    cursor: { subPath: ['.cursor', 'rules'], ext: '.md' },
    vscode: { subPath: ['.vscode'], ext: '.json' },
    zed: { subPath: ['.zed'], ext: '.md' },
    codex: { subPath: [], ext: '.md' },
    gemini: { subPath: [], ext: '.md' },
    aider: { subPath: [], ext: '.md' },
    copilot: { subPath: ['.github'], ext: '.md' },
    kiro: { subPath: ['.kiro', 'steering'], ext: '.md' },
};
/**
 * Fixed file names for single-file platforms (no per-community files).
 * When defined, a single skill file is written regardless of communities.
 */
const PLATFORM_FIXED_FILE = {
    codex: 'AGENTS.md',
    gemini: 'GEMINI.md',
    aider: 'AGENTS.md',
    copilot: 'copilot-instructions.md',
    kiro: 'monograph.md',
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
export function installPlatformSkill(repoPath, platform, communities) {
    const platformConfig = PLATFORM_DEFAULTS[platform];
    if (!platformConfig) {
        return { filesWritten: [] };
    }
    const outputDir = platformConfig.subPath.length > 0
        ? path.join(repoPath, ...platformConfig.subPath)
        : repoPath;
    fsSync.mkdirSync(outputDir, { recursive: true });
    const filesWritten = [];
    const fixedFileName = PLATFORM_FIXED_FILE[platform];
    if (fixedFileName) {
        // Single-file platform: write one skill overview file
        const filePath = path.join(outputDir, fixedFileName);
        const content = renderMonographSkillDoc(platform);
        fsSync.writeFileSync(filePath, content, 'utf-8');
        filesWritten.push(filePath);
    }
    else {
        // Multi-file platform: one file per community (existing behavior)
        const ext = platformConfig.ext;
        const normalised = communities.map(c => typeof c === 'string' ? { name: c, symbols: [] } : c);
        for (const community of normalised) {
            const fileName = `${community.name}-skills${ext}`;
            const filePath = path.join(outputDir, fileName);
            let content;
            if (ext === '.json') {
                content = renderVsCodeSnippet(community);
            }
            else {
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
export async function installSkillsForPlatform(repoPath, communities, config) {
    const platformConfig = PLATFORM_DEFAULTS[config.platform];
    const outputDir = config.outputDir ?? path.join(repoPath, ...platformConfig.subPath);
    if (communities.length === 0) {
        return { platform: config.platform, filesWritten: [], outputDir };
    }
    await fs.mkdir(outputDir, { recursive: true });
    const filesWritten = [];
    const ext = platformConfig.ext;
    for (const community of communities) {
        const fileName = `${community.name}-skills${ext}`;
        const filePath = path.join(outputDir, fileName);
        let content;
        if (ext === '.json') {
            content = renderVsCodeSnippet(community);
        }
        else {
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
function renderMonographSkillDoc(platform) {
    const lines = [];
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
function renderMarkdown(community) {
    const lines = [];
    lines.push(`# ${community.name} Skills`);
    lines.push('');
    for (const symbol of community.symbols) {
        lines.push(`- ${symbol}`);
    }
    lines.push('');
    return lines.join('\n');
}
function renderVsCodeSnippet(community) {
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
//# sourceMappingURL=platform-skills.js.map