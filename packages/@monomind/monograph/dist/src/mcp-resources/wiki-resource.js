import { listWikiPages, getWikiPage } from '../wiki/wiki-store.js';
export const wikiResource = {
    uri: 'monograph://wiki',
    name: 'wiki',
    mimeType: 'application/json',
    handler(db) {
        return listWikiPages(db);
    },
};
export const wikiPageResource = {
    uri: 'monograph://wiki/{communityId}',
    name: 'wiki-page',
    mimeType: 'application/json',
    handler(db, params) {
        const communityId = params?.['communityId'];
        if (!communityId)
            return null;
        return getWikiPage(db, communityId);
    },
};
//# sourceMappingURL=wiki-resource.js.map