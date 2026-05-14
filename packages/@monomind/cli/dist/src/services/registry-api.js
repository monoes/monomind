/**
 * Registry API Client
 * Secure integration with Monomind Cloud Functions
 *
 * Security:
 * - HTTPS only
 * - No credentials stored in code
 * - Rate limiting respected
 * - Input validation
 */
const REGISTRY_API_URL = 'https://us-central1-monomind.cloudfunctions.net/publish-registry';
/**
 * Read a fetch response body with a hard byte cap. AbortSignal.timeout bounds
 * time, NOT bytes — a hijacked endpoint or MITM (TLS without pinning) can
 * stream a multi-GB body that the CLI buffers into memory and OOMs. Cap the
 * read here so all downstream JSON.parse / .text() calls are bounded.
 */
async function readBoundedText(response, maxBytes) {
    const lenHdr = response.headers.get('content-length');
    if (lenHdr) {
        const declared = parseInt(lenHdr, 10);
        if (Number.isFinite(declared) && declared > maxBytes) {
            throw new Error(`Response too large: ${declared} bytes (max ${maxBytes})`);
        }
    }
    if (!response.body)
        return '';
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error(`Response too large: exceeded ${maxBytes} bytes`);
            }
            chunks.push(value);
        }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
    }
    return new TextDecoder('utf-8').decode(buf);
}
async function readBoundedJson(response, maxBytes = 1_048_576) {
    const text = await readBoundedText(response, maxBytes);
    return JSON.parse(text);
}
/**
 * Strip control chars and cap length on attacker-controlled error body before
 * inlining into a thrown Error.message. Without this, a malicious or
 * compromised endpoint can deliver multi-MB error bodies that flow into log
 * aggregators via unhandled-rejection traces.
 */
function safeErrText(s) {
    return s.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 512);
}
/**
 * Validate item ID to prevent injection
 */
function validateItemId(itemId) {
    // Scoped packages (@scope/name) or plain identifiers — no other slashes allowed
    return /^(@[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]*|[a-zA-Z0-9][a-zA-Z0-9_-]*)$/.test(itemId) && itemId.length < 100;
}
/**
 * Validate rating value
 */
function validateRating(rating) {
    return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}
/**
 * Rate a plugin or model
 */
export async function rateItem(itemId, rating, itemType = 'plugin', userId) {
    if (!validateItemId(itemId)) {
        throw new Error('Invalid item ID');
    }
    if (!validateRating(rating)) {
        throw new Error('Rating must be integer 1-5');
    }
    const response = await fetch(`${REGISTRY_API_URL}?action=rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            itemId,
            rating,
            itemType,
            ...(userId && { userId }),
        }),
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
        const error = await readBoundedText(response, 64 * 1024).catch(() => 'unreadable');
        throw new Error(`Rating failed: ${safeErrText(error)}`);
    }
    return readBoundedJson(response);
}
/**
 * Get ratings for a single item
 */
export async function getRating(itemId, itemType = 'plugin') {
    if (!validateItemId(itemId)) {
        throw new Error('Invalid item ID');
    }
    const params = new URLSearchParams({
        action: 'get-ratings',
        itemId,
        itemType,
    });
    const response = await fetch(`${REGISTRY_API_URL}?${params}`, {
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
        throw new Error('Failed to get ratings');
    }
    return readBoundedJson(response);
}
/**
 * Get ratings for multiple items (batch)
 */
export async function getBulkRatings(itemIds, itemType = 'plugin') {
    // Validate all IDs
    for (const id of itemIds) {
        if (!validateItemId(id)) {
            throw new Error(`Invalid item ID: ${id}`);
        }
    }
    // Limit batch size
    const limitedIds = itemIds.slice(0, 50);
    const response = await fetch(`${REGISTRY_API_URL}?action=bulk-ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            itemIds: limitedIds,
            itemType,
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        throw new Error('Failed to get bulk ratings');
    }
    return readBoundedJson(response, 4 * 1024 * 1024);
}
/**
 * Get analytics data
 */
export async function getAnalytics() {
    const response = await fetch(`${REGISTRY_API_URL}?action=analytics`, {
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
        throw new Error('Failed to get analytics');
    }
    return readBoundedJson(response);
}
/**
 * Track a download event
 */
export async function trackDownload(pluginId) {
    if (!validateItemId(pluginId)) {
        return; // Silently fail for invalid IDs
    }
    try {
        await fetch(`${REGISTRY_API_URL}?action=track-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluginId }),
            signal: AbortSignal.timeout(5000),
        });
    }
    catch {
        // Non-critical, don't throw
    }
}
/**
 * Check API health
 */
export async function checkHealth() {
    try {
        const response = await fetch(`${REGISTRY_API_URL}?action=status`, {
            signal: AbortSignal.timeout(5000),
        });
        return readBoundedJson(response, 64 * 1024);
    }
    catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
//# sourceMappingURL=registry-api.js.map