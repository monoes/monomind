/**
 * IPFS Client Module
 * Low-level IPFS operations for discovery and fetching
 *
 * Supports multiple gateways with automatic fallback:
 * - Pinata (recommended for pinned content)
 * - Cloudflare IPFS
 * - Protocol Labs ipfs.io
 * - dweb.link (LibP2P)
 */
import * as crypto from 'crypto';
/**
 * Available IPFS gateways in priority order
 */
export const IPFS_GATEWAYS = [
    'https://gateway.pinata.cloud',
    'https://cloudflare-ipfs.com',
    'https://ipfs.io',
    'https://dweb.link',
    'https://w3s.link', // web3.storage gateway
];
/** Maximum response size for IPFS fetches — prevents OOM on attacker-controlled response bodies */
const MAX_IPFS_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB
/**
 * Allowlist gateway hosts to prevent SSRF when user-supplied gateways are passed in.
 * Any preferredGateway must match this allowlist.
 */
const ALLOWED_GATEWAY_HOSTS = new Set([
    'gateway.pinata.cloud',
    'cloudflare-ipfs.com',
    'ipfs.io',
    'dweb.link',
    'w3s.link',
]);
function isAllowedGatewayUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && ALLOWED_GATEWAY_HOSTS.has(parsed.hostname);
    }
    catch {
        return false;
    }
}
/**
 * Fetch a response body with a hard byte cap. Aborts the stream if the limit is exceeded
 * to prevent OOM from attacker-controlled response bodies.
 */
async function readBodyWithLimit(response, maxBytes) {
    // Fast-path: trust Content-Length when present
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader) {
        const declared = parseInt(lengthHeader, 10);
        if (Number.isFinite(declared) && declared > maxBytes) {
            throw new Error(`Response too large: ${declared} bytes (max ${maxBytes})`);
        }
    }
    const reader = response.body?.getReader();
    if (!reader)
        return '';
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
    // Concatenate and decode as UTF-8
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        combined.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder('utf-8').decode(combined);
}
/**
 * IPNS resolvers
 */
export const IPNS_RESOLVERS = [
    'https://gateway.pinata.cloud',
    'https://dweb.link',
    'https://ipfs.io',
];
/**
 * Resolve IPNS name to CID with fallback across multiple gateways
 *
 * @param ipnsName - IPNS key or DNSLink domain
 * @param preferredGateway - Optional preferred gateway to try first
 * @returns CID string or null if resolution fails
 */
export async function resolveIPNS(ipnsName, preferredGateway) {
    if (!isValidIPNS(ipnsName))
        return null;
    if (preferredGateway && !isAllowedGatewayUrl(preferredGateway))
        return null;
    const resolvers = preferredGateway
        ? [preferredGateway, ...IPNS_RESOLVERS.filter(r => r !== preferredGateway)]
        : IPNS_RESOLVERS;
    console.log(`[IPFS] Resolving IPNS: ${ipnsName}`);
    for (const gateway of resolvers) {
        try {
            const startTime = Date.now();
            let cid = null;
            // Method 1: DNSLink resolution for domain names
            if (ipnsName.includes('.')) {
                const response = await fetch(`${gateway}/api/v0/name/resolve?arg=/ipns/${ipnsName}`, {
                    signal: AbortSignal.timeout(10000),
                    headers: { 'Accept': 'application/json' },
                });
                if (response.ok) {
                    const text = await readBodyWithLimit(response, 64 * 1024); // IPNS resolve is tiny
                    const data = JSON.parse(text);
                    cid = data.Path?.replace('/ipfs/', '') || null;
                }
            }
            // Method 2: Direct IPNS key resolution via gateway redirect.
            // Final URL must still be on a trusted gateway host (SSRF / open-redirect defense)
            // and the extracted CID must pass `isValidCID` to prevent injection.
            if (!cid) {
                const response = await fetch(`${gateway}/ipns/${ipnsName}`, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(10000),
                    redirect: 'follow',
                });
                if (response.ok && isAllowedGatewayUrl(response.url)) {
                    const finalUrl = response.url;
                    const cidMatch = finalUrl.match(/\/ipfs\/([a-zA-Z0-9]+)/);
                    if (cidMatch && isValidCID(cidMatch[1])) {
                        cid = cidMatch[1];
                    }
                }
            }
            if (cid) {
                const latency = Date.now() - startTime;
                console.log(`[IPFS] Resolved ${ipnsName} -> ${cid} via ${gateway} (${latency}ms)`);
                return cid;
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[IPFS] Gateway ${gateway} failed: ${errorMsg}`);
            continue;
        }
    }
    console.warn(`[IPFS] IPNS resolution failed for ${ipnsName} on all gateways`);
    return null;
}
/**
 * Fetch content from IPFS by CID with fallback across multiple gateways
 *
 * @param cid - Content Identifier
 * @param preferredGateway - Optional preferred gateway to try first
 * @returns Parsed JSON content or null if fetch fails
 */
export async function fetchFromIPFS(cid, preferredGateway) {
    if (!isValidCID(cid))
        return null;
    // Reject preferred gateways outside the allowlist (SSRF defense)
    if (preferredGateway && !isAllowedGatewayUrl(preferredGateway))
        return null;
    const gateways = preferredGateway
        ? [preferredGateway, ...IPFS_GATEWAYS.filter(g => g !== preferredGateway)]
        : IPFS_GATEWAYS;
    console.log(`[IPFS] Fetching CID: ${cid}`);
    for (const gateway of gateways) {
        try {
            const startTime = Date.now();
            const url = `${gateway}/ipfs/${cid}`;
            const response = await fetch(url, {
                signal: AbortSignal.timeout(30000),
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'max-age=3600',
                },
            });
            if (response.ok) {
                const text = await readBodyWithLimit(response, MAX_IPFS_RESPONSE_BYTES);
                const data = JSON.parse(text);
                const latency = Date.now() - startTime;
                console.log(`[IPFS] Fetched ${cid} from ${gateway} (${latency}ms)`);
                return data;
            }
            // Handle specific error codes
            if (response.status === 504) {
                console.warn(`[IPFS] Gateway timeout on ${gateway}, trying next...`);
            }
            else if (response.status === 429) {
                console.warn(`[IPFS] Rate limited on ${gateway}, trying next...`);
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[IPFS] Gateway ${gateway} failed: ${errorMsg}`);
            continue;
        }
    }
    console.warn(`[IPFS] Fetch failed for ${cid} on all gateways`);
    return null;
}
/**
 * Fetch with full result metadata
 */
export async function fetchFromIPFSWithMetadata(cid, preferredGateway) {
    if (!isValidCID(cid))
        return null;
    if (preferredGateway && !isAllowedGatewayUrl(preferredGateway))
        return null;
    const gateways = preferredGateway
        ? [preferredGateway, ...IPFS_GATEWAYS.filter(g => g !== preferredGateway)]
        : IPFS_GATEWAYS;
    for (const gateway of gateways) {
        try {
            const startTime = Date.now();
            const url = `${gateway}/ipfs/${cid}`;
            const response = await fetch(url, {
                signal: AbortSignal.timeout(30000),
                headers: {
                    'Accept': 'application/json',
                },
            });
            if (response.ok) {
                const text = await readBodyWithLimit(response, MAX_IPFS_RESPONSE_BYTES);
                const data = JSON.parse(text);
                const latencyMs = Date.now() - startTime;
                const cached = response.headers.get('X-Cache')?.includes('HIT') ||
                    response.headers.get('CF-Cache-Status') === 'HIT';
                return {
                    data,
                    gateway,
                    cid,
                    cached,
                    latencyMs,
                };
            }
        }
        catch {
            continue;
        }
    }
    return null;
}
/**
 * Check if CID is pinned/available on a gateway
 */
export async function isPinned(cid, gateway = 'https://ipfs.io') {
    if (!isValidCID(cid))
        return false;
    if (!isAllowedGatewayUrl(gateway))
        return false;
    try {
        const response = await fetch(`${gateway}/ipfs/${cid}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
/**
 * Check availability across multiple gateways
 */
export async function checkAvailability(cid) {
    if (!isValidCID(cid))
        return { available: false, gateways: [] };
    const results = await Promise.all(IPFS_GATEWAYS.map(async (gateway) => {
        const startTime = Date.now();
        try {
            const response = await fetch(`${gateway}/ipfs/${cid}`, {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000),
            });
            return {
                url: gateway,
                available: response.ok,
                latencyMs: Date.now() - startTime,
            };
        }
        catch {
            return {
                url: gateway,
                available: false,
                latencyMs: Date.now() - startTime,
            };
        }
    }));
    return {
        available: results.some(r => r.available),
        gateways: results,
    };
}
/**
 * Get IPFS gateway URL for a CID
 */
export function getGatewayUrl(cid, gateway = 'https://ipfs.io') {
    return `${gateway}/ipfs/${cid}`;
}
/**
 * Get multiple gateway URLs for redundancy
 */
export function getGatewayUrls(cid) {
    return IPFS_GATEWAYS.map(gateway => `${gateway}/ipfs/${cid}`);
}
/**
 * Validate CID format (CIDv0 and CIDv1)
 */
export function isValidCID(cid) {
    // CIDv0 starts with 'Qm' and is 46 characters (base58btc)
    // CIDv1 starts with 'b' (base32) or 'z' (base58btc) or 'f' (base16)
    return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|f[0-9a-f]{50,})$/i.test(cid);
}
/**
 * Validate IPNS name format
 */
export function isValidIPNS(ipnsName) {
    // IPNS key format (k51...) or DNSLink domain
    return /^(k51[a-z0-9]{59,}|[a-z0-9.-]+\.[a-z]{2,})$/i.test(ipnsName);
}
/**
 * Generate content hash for verification
 */
export function hashContent(content) {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    return crypto.createHash('sha256').update(buffer).digest('hex');
}
/**
 * Verify Ed25519 signature (async import to avoid bundling issues)
 */
export async function verifyEd25519Signature(message, signature, publicKey) {
    try {
        // Dynamic import to avoid bundling @noble/ed25519 if not used
        const ed = await import('@noble/ed25519');
        // Handle prefixed public key (e.g., "ed25519:abc123...")
        const pubKeyHex = publicKey.replace(/^ed25519:/, '');
        const isValid = await ed.verifyAsync(Buffer.from(signature, 'hex'), new TextEncoder().encode(message), Buffer.from(pubKeyHex, 'hex'));
        return isValid;
    }
    catch (error) {
        console.warn('[IPFS] Signature verification failed:', error);
        return false;
    }
}
/**
 * Parse CID to extract metadata
 */
export function parseCID(cid) {
    if (!isValidCID(cid)) {
        return null;
    }
    if (cid.startsWith('Qm')) {
        return {
            version: 0,
            codec: 'dag-pb',
            hash: cid,
        };
    }
    // CIDv1 - simplified parsing
    return {
        version: 1,
        codec: 'dag-cbor', // Most common for JSON
        hash: cid,
    };
}
/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
//# sourceMappingURL=client.js.map