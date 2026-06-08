import type { MonographDb } from '../storage/db.js';
import { upsertWikiPage, getWikiPage, listWikiPages } from './wiki-store.js';
import { type LLMConfig } from './providers.js';
export type { LLMConfig } from './providers.js';
export type { LLMProvider, LLMResponse } from './providers.js';
export interface WikiGeneratorOptions {
    repoPath: string;
    reviewOnly?: boolean;
    db?: MonographDb;
}
export interface WikiGeneratorResult {
    reviewMode?: boolean;
    proposedGroupings?: unknown[];
    pages: string[];
    pageCount: number;
}
/**
 * Top-level wiki generation entry point.
 * When reviewOnly is true, returns proposed community groupings without generating pages.
 */
export declare function generateWiki(options: WikiGeneratorOptions): Promise<WikiGeneratorResult>;
export interface LlmClient {
    generate: (prompt: string) => Promise<string>;
}
export interface GenerateWikiPageOptions {
    model?: string;
    apiKey?: string;
    /** Inject a test client instead of calling Anthropic API */
    llmClient?: LlmClient;
    /** Use a multi-provider LLM config instead of the default Anthropic SDK */
    llmConfig?: LLMConfig;
}
export interface GenerateAllWikiPagesOptions {
    force?: boolean;
    model?: string;
    communityId?: string;
    llmClient?: LlmClient;
    /** Use a multi-provider LLM config instead of the default Anthropic SDK */
    llmConfig?: LLMConfig;
}
export interface GenerateAllResult {
    generated: number;
    skipped: number;
    errors: number;
}
/**
 * Generate a wiki page for a single community using the LLM.
 * Returns the generated markdown content and persists it to the DB.
 */
export declare function generateWikiPage(db: MonographDb, communityId: string, options?: GenerateWikiPageOptions): Promise<string>;
/**
 * Generate wiki pages for all (or a filtered) communities.
 */
export declare function generateAllWikiPages(db: MonographDb, options?: GenerateAllWikiPagesOptions): Promise<GenerateAllResult>;
export { upsertWikiPage, getWikiPage, listWikiPages };
//# sourceMappingURL=wiki-generator.d.ts.map