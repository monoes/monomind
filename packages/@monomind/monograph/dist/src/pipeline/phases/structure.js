import { relative, dirname, basename } from 'path';
import { makeId, toNormLabel, CONFIDENCE_SCORE } from '../../types.js';
export const structurePhase = {
    name: 'structure',
    deps: ['scan'],
    async execute(ctx, deps) {
        const { filePaths } = deps.get('scan');
        const fileNodes = [];
        const folderNodes = [];
        const containsEdges = [];
        const seenFolders = new Set();
        for (const absPath of filePaths) {
            const rel = relative(ctx.repoPath, absPath);
            const fileId = makeId(rel.replace(/\//g, '_'), 'file');
            fileNodes.push({
                id: fileId, label: 'File',
                name: basename(rel), normLabel: toNormLabel(basename(rel)),
                filePath: rel, isExported: false,
            });
            const parts = dirname(rel).split('/');
            let current = '';
            let parentFolderId = null;
            for (const part of parts) {
                if (part === '.')
                    continue;
                current = current ? `${current}/${part}` : part;
                const folderId = makeId(current.replace(/\//g, '_'), 'folder');
                if (!seenFolders.has(folderId)) {
                    seenFolders.add(folderId);
                    folderNodes.push({
                        id: folderId, label: 'Folder',
                        name: part, normLabel: toNormLabel(part),
                        filePath: current, isExported: false,
                    });
                    if (parentFolderId) {
                        containsEdges.push({
                            id: makeId(parentFolderId, folderId, 'contains'),
                            sourceId: parentFolderId, targetId: folderId,
                            relation: 'CONTAINS', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
                        });
                    }
                }
                parentFolderId = folderId;
            }
            if (parentFolderId) {
                containsEdges.push({
                    id: makeId(parentFolderId, fileId, 'contains'),
                    sourceId: parentFolderId, targetId: fileId,
                    relation: 'CONTAINS', confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
                });
            }
        }
        return { fileNodes, folderNodes, containsEdges };
    },
};
//# sourceMappingURL=structure.js.map