/**
 * Multi-platform IDE Skill File Installer
 *
 * Generates and installs per-community skill files for various IDE/platform
 * targets (Claude, Cursor, VS Code, Zed, Codex, Gemini, Aider, Copilot, Kiro).
 * Each platform gets one file per community describing exported symbols from
 * that community.
 */
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
export declare const SUPPORTED_PLATFORMS: string[];
/**
 * Synchronously install a skill file for a specific platform into the repo.
 * Returns { filesWritten } where filesWritten contains absolute paths to written files.
 *
 * New single-file platforms (codex, gemini, aider, copilot, kiro) always write
 * one file regardless of communities. Existing multi-file platforms write one
 * file per community entry.
 */
export declare function installPlatformSkill(repoPath: string, platform: string, communities: Array<{
    name: string;
    symbols: string[];
} | string>): SyncSkillInstallResult;
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
export declare function installSkillsForPlatform(repoPath: string, communities: Array<{
    name: string;
    symbols: string[];
}>, config: PlatformSkillConfig): Promise<SkillInstallResult>;
//# sourceMappingURL=platform-skills.d.ts.map