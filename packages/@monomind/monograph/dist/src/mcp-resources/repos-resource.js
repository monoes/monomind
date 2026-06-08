/**
 * Returns the list of indexed repositories.
 * When no repo registry is available, returns an empty array as a safe default.
 */
export const reposResource = {
    uri: 'monograph://repos',
    name: 'repos',
    mimeType: 'application/json',
    handler(_db) {
        return [];
    },
};
//# sourceMappingURL=repos-resource.js.map