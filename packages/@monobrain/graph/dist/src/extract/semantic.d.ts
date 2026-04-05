/**
 * Semantic extraction via the Anthropic Claude API.
 *
 * Mirrors graphify's skill.md Step B1-B3 pipeline:
 * - Groups files into chunks of ~20
 * - Sends each chunk to Claude with the graphify extraction prompt
 * - Merges results into a single ExtractionResult
 *
 * Gracefully returns empty results if ANTHROPIC_API_KEY is not set
 * or the API call fails.
 */
import type { ExtractionResult } from '../types.js';
export interface SemanticFile {
    path: string;
    relPath: string;
    content: string;
}
export interface SemanticOptions {
    apiKey?: string;
    model?: string;
    chunkSize?: number;
    mode?: 'fast' | 'deep';
    maxTokens?: number;
    timeBudget?: number;
    targetChunkTokens?: number;
}
/**
 * Run semantic extraction on a set of files using the Anthropic Claude API.
 *
 * Returns an empty ExtractionResult (not an error) when:
 * - No API key is available
 * - The API call fails
 *
 * Only document/paper files benefit from semantic extraction.
 * Code files may be included but the prompt instructs Claude not to re-extract imports.
 */
export declare function extractSemantic(files: SemanticFile[], options?: SemanticOptions): Promise<ExtractionResult>;
//# sourceMappingURL=semantic.d.ts.map