// Uploads .map source map files to the cloud for bundled runtime coverage remapping.
/** Strip a path prefix from a file path. */
export function applyStripPath(filePath, strip) {
    const normalized = filePath.replace(/\\/g, '/');
    const s = strip.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    return normalized.startsWith(s) ? normalized.slice(s.length) : normalized;
}
/** Collect .map files from a directory (shallow heuristic — no actual fs walk in library mode). */
export function collectSourceMaps(files, include = ['**/*.map'], exclude = ['node_modules'], stripPath) {
    return files
        .filter(f => f.endsWith('.map'))
        .filter(f => !exclude.some(e => f.includes(e)))
        .filter(f => include.length === 0 || include.some(_p => f.endsWith('.map')))
        .map(f => ({
        originalPath: f,
        uploadPath: stripPath ? applyStripPath(f, stripPath) : f,
        sizeBytes: 0,
    }));
}
/** Upload source map files to the cloud API. */
export async function uploadSourceMaps(args, files) {
    const base = args.apiBase ?? 'https://api.fallow.cloud/v1';
    const concurrency = args.concurrency ?? 4;
    let uploaded = 0;
    let failed = 0;
    const warnings = [];
    const chunks = [];
    for (let i = 0; i < files.length; i += concurrency) {
        chunks.push(files.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
        const results = await Promise.allSettled(chunk.map(async (f) => {
            const res = await fetch(`${base}/projects/${encodeURIComponent(args.projectId)}/source-maps`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${args.apiKey ?? ''}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ path: f.uploadPath }),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status} for ${f.uploadPath}`);
        }));
        for (const r of results) {
            if (r.status === 'fulfilled')
                uploaded++;
            else {
                failed++;
                warnings.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
                if (args.failFast)
                    break;
            }
        }
        if (args.failFast && failed > 0)
            break;
    }
    return { uploaded, failed, skipped: 0, warnings };
}
//# sourceMappingURL=upload-source-maps.js.map