import { generateAllWikiPages } from '../wiki/wiki-generator.js';
/**
 * monograph_wiki_build MCP tool handler.
 * Generates wiki pages for communities using the LLM.
 */
export async function runWikiBuildTool(db, input) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey && !input.llmClient) {
        return { error: 'ANTHROPIC_API_KEY not set' };
    }
    const opts = {
        force: input.force ?? false,
        model: input.model,
        communityId: input.communityId,
        llmClient: input.llmClient,
    };
    const result = await generateAllWikiPages(db, opts);
    return result;
}
//# sourceMappingURL=wiki-build.js.map