import type { MonographDb } from '../storage/db.js';
import { getWikiPage, listWikiPages } from '../wiki/wiki-store.js';

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
export function getWikiToolResult(db: MonographDb, input: WikiToolInput): WikiToolResult {
  if (input.communityId != null) {
    const page = getWikiPage(db, String(input.communityId));
    return { pages: page ? [page] : [] };
  }
  return { pages: listWikiPages(db) };
}
