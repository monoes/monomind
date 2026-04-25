/**
 * Guidance Compiler
 *
 * Parses root CLAUDE.md and optional CLAUDE.local.md into a compiled policy bundle:
 * 1. A small always-loaded constitution (first 30-60 lines of invariants)
 * 2. A set of task-scoped rule shards tagged by intent, risk, domain, repo path, tool class
 * 3. A machine-readable manifest with rule IDs, triggers, and verifiers
 *
 * @module @monobrain/guidance/compiler
 */
import type { GuidanceRule, PolicyBundle, RiskClass } from './types.js';
export interface CompilerConfig {
    /** Maximum lines for constitution */
    maxConstitutionLines: number;
    /** Default risk class */
    defaultRiskClass: RiskClass;
    /** Default priority */
    defaultPriority: number;
    /** Auto-generate rule IDs for untagged rules */
    autoGenerateIds: boolean;
}
export declare class GuidanceCompiler {
    private config;
    private nextAutoId;
    constructor(config?: Partial<CompilerConfig>);
    /**
     * Compile guidance files into a policy bundle
     */
    compile(rootContent: string, localContent?: string): PolicyBundle;
    /**
     * Parse a guidance markdown file into rules
     */
    parseGuidanceFile(content: string, source: 'root' | 'local'): GuidanceRule[];
    /**
     * Extract rules from a content block
     */
    private extractRulesFromBlock;
    /**
     * Extract implicit rules from bullet points and paragraphs
     */
    private extractImplicitRules;
    /**
     * Check if text represents an actionable rule
     */
    private isActionableRule;
    /**
     * Parse a single rule from its text content
     */
    private parseRule;
    /**
     * Infer intents from rule text
     */
    private inferIntents;
    /**
     * Infer domains from rule text
     */
    private inferDomains;
    /**
     * Merge root and local rules, local overrides root for same ID
     */
    private mergeRules;
    /**
     * Build the constitution from constitution-class rules
     */
    private buildConstitution;
    /**
     * Build shards from non-constitution rules
     */
    private buildShards;
    /**
     * Build compact text for a shard
     */
    private buildCompactShardText;
    /**
     * Build the manifest
     */
    private buildManifest;
    /**
     * Hash content for change detection
     */
    private hashContent;
}
/**
 * Create a compiler instance
 */
export declare function createCompiler(config?: Partial<CompilerConfig>): GuidanceCompiler;
//# sourceMappingURL=compiler.d.ts.map