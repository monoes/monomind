// Types and stub for fetching production runtime coverage from a remote API.
/** Build the URL for a cloud runtime context request. */
export function buildCloudRequestUrl(base, req) {
    const params = new URLSearchParams();
    if (req.environment)
        params.set('environment', req.environment);
    if (req.commitSha)
        params.set('commit_sha', req.commitSha);
    if (req.period)
        params.set('period', req.period);
    const qs = params.toString();
    const encoded = encodeURIComponent(req.projectId);
    return `${base}/projects/${encoded}/runtime-context${qs ? '?' + qs : ''}`;
}
/** Fetch runtime coverage context from the cloud API (stub — real impl requires HTTP client). */
export async function fetchRuntimeContext(req) {
    const base = req.apiBase ?? 'https://api.fallow.cloud/v1';
    const url = buildCloudRequestUrl(base, req);
    let res;
    try {
        res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${req.apiKey ?? ''}`,
                Accept: 'application/json',
            },
        });
    }
    catch (e) {
        return { kind: 'NetworkError', message: String(e), exitCode: 3 };
    }
    if (res.status === 401)
        return { kind: 'AuthError', message: 'Invalid API key', exitCode: 4 };
    if (res.status === 402)
        return { kind: 'TierRequired', message: 'Feature requires paid tier', exitCode: 5 };
    if (res.status === 429)
        return { kind: 'RateLimited', message: 'Rate limit exceeded', exitCode: 6 };
    if (res.status === 404)
        return { kind: 'NotFound', message: `Project ${req.projectId} not found`, exitCode: 7 };
    if (!res.ok)
        return { kind: 'ValidationError', message: `HTTP ${res.status}`, exitCode: 8 };
    return (await res.json());
}
export function isCloudError(v) {
    return v.kind !== undefined && v.exitCode !== undefined;
}
//# sourceMappingURL=cloud-client.js.map