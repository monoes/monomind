/**
 * CLAUDE.md Generator
 * Generates enforceable, analyzer-optimized Claude Code configuration
 * with template variants for different usage patterns.
 *
 * Templates: minimal | standard | full | security | performance | solo
 * All templates use bullet-format rules with imperative keywords for enforceability.
 */
import type { InitOptions, ClaudeMdTemplate } from './types.js';
/**
 * Generate CLAUDE.md content based on init options and template.
 * Template is determined by: options.runtime.claudeMdTemplate > explicit param > 'standard'
 */
export declare function generateClaudeMd(options: InitOptions, template?: ClaudeMdTemplate): string;
/**
 * Generate minimal CLAUDE.md content (backward-compatible alias).
 */
export declare function generateMinimalClaudeMd(options: InitOptions): string;
/** Available template names for CLI wizard */
export declare const CLAUDE_MD_TEMPLATES: Array<{
    name: ClaudeMdTemplate;
    description: string;
}>;
export default generateClaudeMd;
//# sourceMappingURL=claudemd-generator.d.ts.map