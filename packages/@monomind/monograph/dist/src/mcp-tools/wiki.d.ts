import type { MonographDb } from '../storage/db.js';
export interface WikiToolInput {
    communityId?: string;
}
export interface WikiPage {
    communityId: string;
    content: string;
    generatedAt: string;
}
export interface WikiToolResult {
    pages: WikiPage[];
}
/**
 * monograph_wiki MCP tool handler.
 * Returns one wiki page (by communityId) or all pages.
 */
export declare function getWikiToolResult(db: MonographDb, input: WikiToolInput): WikiToolResult;
//# sourceMappingURL=wiki.d.ts.map