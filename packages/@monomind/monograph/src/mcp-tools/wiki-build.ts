import type { MonographDb } from '../storage/db.js';
import type { LlmClient, GenerateAllWikiPagesOptions } from '../wiki/wiki-generator.js';
import { generateAllWikiPages } from '../wiki/wiki-generator.js';

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
export async function runWikiBuildTool(
  db: MonographDb,
  input: WikiBuildToolInput,
): Promise<WikiBuildToolResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey && !input.llmClient) {
    return { error: 'ANTHROPIC_API_KEY not set' };
  }

  const opts: GenerateAllWikiPagesOptions = {
    force: input.force ?? false,
    model: input.model,
    communityId: input.communityId,
    llmClient: input.llmClient,
  };

  const result = await generateAllWikiPages(db, opts);
  return result;
}
