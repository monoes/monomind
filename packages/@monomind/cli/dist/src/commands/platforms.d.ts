/**
 * CLI Platforms Command
 * Install/uninstall Monograph context instructions for 14 AI coding platforms
 *
 * github.com/monoes/monomind
 */
import type { Command } from '../types.js';
export declare const SUPPORTED_PLATFORMS: readonly ["claude", "gemini", "cursor", "vscode", "copilot", "opencode", "aider", "kiro", "trae", "claw", "droid", "antigravity", "hermes", "codex"];
export type Platform = typeof SUPPORTED_PLATFORMS[number];
export declare const platformsCommand: Command;
//# sourceMappingURL=platforms.d.ts.map