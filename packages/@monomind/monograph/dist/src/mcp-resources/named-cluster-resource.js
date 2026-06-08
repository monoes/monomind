/**
 * Returns a named community cluster with its member nodes.
 * Looks up the community by label and returns all nodes that belong to it.
 */
export const namedClusterResource = {
    uri: 'monograph://cluster/{name}',
    name: 'named-cluster',
    mimeType: 'application/json',
    handler(db, params) {
        const name = params?.['name'];
        if (!name)
            return null;
        try {
            const row = db
                .prepare('SELECT id, label FROM communities WHERE label = ?')
                .get(name);
            if (!row)
                return null;
            const members = db
                .prepare('SELECT id, name, label, file_path FROM nodes WHERE community_id = ?')
                .all(row.id);
            return { id: row.id, label: row.label, members };
        }
        catch {
            return null;
        }
    },
};
//# sourceMappingURL=named-cluster-resource.js.map