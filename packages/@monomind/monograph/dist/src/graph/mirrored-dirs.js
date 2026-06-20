/**
 * Detect directory subtrees that are structural mirrors of each other.
 * Uses Jaccard similarity of file basenames within each directory.
 *
 * @param db - monograph database
 * @param minSimilarity - minimum Jaccard similarity threshold (default 0.7)
 */
export function detectMirroredDirs(db, minSimilarity = 0.7) {
    // Query all File nodes with a file_path
    const rows = db.prepare(`SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`).all();
    // Build map: dirPath → Set<basename>
    const dirMap = new Map();
    for (const { file_path } of rows) {
        const lastSlash = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'));
        if (lastSlash === -1)
            continue;
        const dir = file_path.slice(0, lastSlash);
        const base = file_path.slice(lastSlash + 1);
        if (!dirMap.has(dir))
            dirMap.set(dir, new Set());
        dirMap.get(dir).add(base);
    }
    const dirs = [...dirMap.keys()];
    const pairs = [];
    // Compare each pair of directories
    for (let i = 0; i < dirs.length; i++) {
        for (let j = i + 1; j < dirs.length; j++) {
            const dirA = dirs[i];
            const dirB = dirs[j];
            const setA = dirMap.get(dirA);
            const setB = dirMap.get(dirB);
            // Only compare directories that share a parent OR one is a suffix of the other
            const parentA = dirA.slice(0, Math.max(dirA.lastIndexOf('/'), dirA.lastIndexOf('\\')));
            const parentB = dirB.slice(0, Math.max(dirB.lastIndexOf('/'), dirB.lastIndexOf('\\')));
            const relatedDirs = parentA === parentB
                || dirA.endsWith(dirB)
                || dirB.endsWith(dirA)
                || dirA.includes(dirB)
                || dirB.includes(dirA);
            if (!relatedDirs)
                continue;
            // Compute Jaccard similarity
            const shared = [];
            for (const name of setA) {
                if (setB.has(name))
                    shared.push(name);
            }
            const union = setA.size + setB.size - shared.length;
            if (union === 0)
                continue;
            const similarity = shared.length / union;
            if (similarity >= minSimilarity) {
                pairs.push({
                    dirA,
                    dirB,
                    similarity,
                    sharedFileNames: shared.sort(),
                    uniqueToA: setA.size - shared.length,
                    uniqueToB: setB.size - shared.length,
                });
            }
        }
    }
    // Sort by similarity descending
    pairs.sort((a, b) => b.similarity - a.similarity);
    return {
        pairs,
        totalDirsAnalyzed: dirs.length,
    };
}
export function detectMirroredFamilies(families, root) {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
    function dirOf(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        const rel = normalized.startsWith(normalizedRoot + '/')
            ? normalized.slice(normalizedRoot.length + 1)
            : normalized;
        const lastSlash = rel.lastIndexOf('/');
        return lastSlash === -1 ? '' : rel.slice(0, lastSlash);
    }
    function baseName(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        return normalized.slice(normalized.lastIndexOf('/') + 1);
    }
    const mirrored = [];
    const remainingIndices = new Set(families.map((_, i) => i));
    for (let i = 0; i < families.length; i++) {
        for (let j = i + 1; j < families.length; j++) {
            if (!remainingIndices.has(i) || !remainingIndices.has(j))
                continue;
            const fa = families[i];
            const fb = families[j];
            // Single pass: extract dir and basename together to avoid two separate .map() iterations
            let firstDirA;
            let singleDirA = true;
            let firstDirB;
            let singleDirB = true;
            const namesA = new Set();
            const namesB = new Set();
            for (const f of fa.files) {
                const d = dirOf(f);
                if (firstDirA === undefined)
                    firstDirA = d;
                else if (d !== firstDirA) {
                    singleDirA = false;
                }
                namesA.add(baseName(f));
            }
            for (const f of fb.files) {
                const d = dirOf(f);
                if (firstDirB === undefined)
                    firstDirB = d;
                else if (d !== firstDirB) {
                    singleDirB = false;
                }
                namesB.add(baseName(f));
            }
            if (!singleDirA || !singleDirB)
                continue;
            const dirA = firstDirA;
            const dirB = firstDirB;
            const shared = [];
            for (const n of namesA) {
                if (namesB.has(n))
                    shared.push(n);
            }
            const union = namesA.size + namesB.size - shared.length;
            if (union === 0)
                continue;
            const similarity = shared.length / union;
            if (similarity >= 0.5) {
                mirrored.push({
                    dirA,
                    dirB,
                    similarity,
                    sharedFileNames: shared.sort(),
                    uniqueToA: namesA.size - shared.length,
                    uniqueToB: namesB.size - shared.length,
                });
                remainingIndices.delete(i);
                remainingIndices.delete(j);
            }
        }
    }
    mirrored.sort((a, b) => b.similarity - a.similarity);
    const remaining = [];
    for (const i of remainingIndices)
        remaining.push(families[i]);
    return { mirrored, remaining };
}
/**
 * Format a MirroredDirsReport as structured text for LLM consumption.
 */
export function formatMirroredDirs(report) {
    if (report.pairs.length === 0) {
        return `No mirrored directories found (${report.totalDirsAnalyzed} dirs analyzed).`;
    }
    const lines = [
        `Mirrored directories: ${report.pairs.length} pair(s) of ${report.totalDirsAnalyzed} analyzed`,
        '',
    ];
    for (const p of report.pairs) {
        lines.push(`  ${p.dirA} <-> ${p.dirB}  similarity=${(p.similarity * 100).toFixed(0)}%  shared=${p.sharedFileNames.length}  uniqueA=${p.uniqueToA}  uniqueB=${p.uniqueToB}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=mirrored-dirs.js.map