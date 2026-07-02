import { generateAllWikiPages } from '../wiki/wiki-generator.js';
/**
 * monograph_wiki_build MCP tool handler.
 * Generates wiki pages for communities using the LLM.
 */
export async function runWikiBuildTool(db, input) {
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