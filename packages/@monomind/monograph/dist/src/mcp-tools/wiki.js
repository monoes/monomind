import { getWikiPage, listWikiPages } from '../wiki/wiki-store.js';
/**
 * monograph_wiki MCP tool handler.
 * Returns one wiki page (by communityId) or all pages.
 */
export function getWikiToolResult(db, input) {
    if (input.communityId != null) {
        const page = getWikiPage(db, String(input.communityId));
        return { pages: page ? [page] : [] };
    }
    return { pages: listWikiPages(db) };
}
//# sourceMappingURL=wiki.js.map