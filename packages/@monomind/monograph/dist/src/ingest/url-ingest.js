import { createHash } from 'crypto';
import { validateUrl } from '../security/safe-fetch.js';
import { classifyFile } from '../analysis/file-classifier.js';
const URL_TYPE_PATTERNS = [
    [/arxiv\.org|semanticscholar\.org|openreview\.net/, 'paper'],
    [/github\.com/, 'github'],
    [/youtube\.com|youtu\.be/, 'video'],
    [/\.pdf($|\?)/, 'pdf'],
];
export function classifyUrlType(url) {
    for (const [pattern, type] of URL_TYPE_PATTERNS) {
        if (pattern.test(url))
            return type;
    }
    const fileType = classifyFile(url);
    if (fileType === 'IMAGE')
        return 'image';
    if (fileType === 'PAPER')
        return 'paper';
    return 'webpage';
}
function extractTitle(html) {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    return m ? m[1].trim() : 'Untitled';
}
function extractSnippet(html, maxLen = 500) {
    const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, maxLen);
}
export async function ingestUrl(url, options = {}) {
    validateUrl(url);
    const { fetch: fetchFn = globalThis.fetch, maxBytes = 10 * 1024 * 1024 } = options;
    const response = await fetchFn(url, { redirect: 'follow' });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} fetching ${url}`);
    // Re-validate the final URL after redirects to prevent SSRF via open redirects.
    // Only validate when response.url is truthy (some fetch impls omit it on same-URL responses).
    if (response.url)
        validateUrl(response.url);
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
        throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxBytes}`);
    }
    const text = await response.text();
    if (text.length > maxBytes)
        throw new Error(`Response too large: body exceeds ${maxBytes} bytes`);
    const type = classifyUrlType(url);
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('text/html') || text.trimStart().startsWith('<');
    const title = isHtml ? extractTitle(text) : (url.split('/').pop() ?? url);
    const snippet = isHtml ? extractSnippet(text) : text.slice(0, 500);
    return {
        id: createHash('sha256').update(url).digest('hex').slice(0, 16),
        url,
        type,
        title,
        snippet,
        fetchedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=url-ingest.js.map