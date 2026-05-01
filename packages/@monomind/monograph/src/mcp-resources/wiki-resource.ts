import type Database from 'better-sqlite3';
import { listWikiPages, getWikiPage } from '../wiki/wiki-store.js';
import type { McpResourceDefinition } from './repos-resource.js';

export const wikiResource: McpResourceDefinition = {
  uri: 'monograph://wiki',
  name: 'wiki',
  mimeType: 'application/json',
  handler(db) {
    return listWikiPages(db as any);
  },
};

export const wikiPageResource: McpResourceDefinition = {
  uri: 'monograph://wiki/{communityId}',
  name: 'wiki-page',
  mimeType: 'application/json',
  handler(db, params) {
    const communityId = params?.['communityId'];
    if (!communityId) return null;
    return getWikiPage(db as any, communityId);
  },
};
