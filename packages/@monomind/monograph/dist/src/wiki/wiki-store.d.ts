import type { MonographDb } from '../storage/db.js';
export interface WikiPage {
    communityId: string;
    content: string;
    generatedAt: string;
}
/**
 * Upsert a wiki page for a community.
 * community_id is stored as TEXT (coerced from integer community_id in nodes).
 */
export declare function upsertWikiPage(db: MonographDb, communityId: string, content: string): void;
/**
 * Get a single wiki page by community ID.
 */
export declare function getWikiPage(db: MonographDb, communityId: string): WikiPage | null;
/**
 * List all wiki pages.
 */
export declare function listWikiPages(db: MonographDb): WikiPage[];
//# sourceMappingURL=wiki-store.d.ts.map