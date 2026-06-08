import type { MonographDb } from '../storage/db.js';
import type { LlmClient } from '../wiki/wiki-generator.js';
export interface WikiBuildToolInput {
    communityId?: string;
    force?: boolean;
    model?: string;
    /** Injected LLM client for testing (not part of MCP schema) */
    llmClient?: LlmClient;
}
export interface WikiBuildToolResult {
    generated?: number;
    skipped?: number;
    errors?: number;
    error?: string;
}
/**
 * monograph_wiki_build MCP tool handler.
 * Generates wiki pages for communities using the LLM.
 */
export declare function runWikiBuildTool(db: MonographDb, input: WikiBuildToolInput): Promise<WikiBuildToolResult>;
//# sourceMappingURL=wiki-build.d.ts.map