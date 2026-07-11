/**
 * IPFS-Based Pattern Discovery
 * Secure discovery mechanism for finding patterns in decentralized environment
 */
import * as crypto from 'crypto';
/** Maximum bytes read from any IPFS gateway response to prevent OOM */
const MAX_DISCOVERY_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
/**
 * Read a fetch response body with a hard byte cap.
 * Aborts the stream early if the limit is exceeded.
 */
async function readBodyCapped(response, maxBytes = MAX_DISCOVERY_RESPONSE_BYTES) {
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
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        combined.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder('utf-8').decode(combined);
}
import { DEFAULT_STORE_CONFIG, } from './registry.js';
/**
 * Pattern Store Discovery Service
 * Handles secure discovery of pattern registries via IPFS/IPNS
 */
export class PatternDiscovery {
    config;
    cache;
    ipnsCache;
    constructor(config = {}) {
        this.config = { ...DEFAULT_STORE_CONFIG, ...config };
        this.cache = new Map();
        this.ipnsCache = new Map();
    }
    /**
     * Discover and load the pattern registry
     */
    async discoverRegistry(registryName) {
        const targetRegistry = registryName || this.config.defaultRegistry;
        const knownRegistry = this.config.registries.find(r => r.name === targetRegistry);
        if (!knownRegistry) {
            return {
                success: false,
                source: targetRegistry,
                fromCache: false,
                error: `Unknown registry: ${targetRegistry}`,
            };
        }
        console.log(`[Discovery] Looking for registry: ${knownRegistry.name}`);
        // Check cache first
        const cached = this.getCachedRegistry(knownRegistry.ipnsName);
        if (cached) {
            console.log(`[Discovery] Found in cache`);
            return {
                success: true,
                registry: cached,
                source: knownRegistry.name,
                fromCache: true,
            };
        }
        // Resolve IPNS to get current CID
        console.log(`[Discovery] Resolving IPNS: ${knownRegistry.ipnsName}`);
        const resolution = await this.resolveIPNS(knownRegistry.ipnsName);
        if (!resolution) {
            return {
                success: false,
                source: knownRegistry.name,
                fromCache: false,
                error: 'Failed to resolve IPNS name',
            };
        }
        // Fetch registry from IPFS
        console.log(`[Discovery] Fetching from IPFS: ${resolution.cid}`);
        const registry = await this.fetchRegistry(resolution.cid, knownRegistry.gateway);
        if (!registry) {
            return {
                success: false,
                source: knownRegistry.name,
                fromCache: false,
                cid: resolution.cid,
                error: 'Failed to fetch registry from IPFS',
            };
        }
        // Verify registry — fail closed for trusted registries.
        // Previously this only warn-and-continued, and the `&& registry.registrySignature`
        // guard meant an attacker could simply omit the signature to bypass verification entirely.
        if (knownRegistry.trusted) {
            // Use the real Ed25519 verifier from registry.ts, not the stub length-check below
            const { verifyRegistrySignature } = await import('./registry.js');
            const expected = knownRegistry.publicKey;
            if (!registry.registrySignature || !registry.registryPublicKey) {
                return {
                    success: false,
                    source: knownRegistry.name,
                    fromCache: false,
                    cid: resolution.cid,
                    error: 'Trusted registry response is missing required signature/publicKey fields',
                };
            }
            // Pin the public key to the known registry's expected key
            if (registry.registryPublicKey !== expected) {
                return {
                    success: false,
                    source: knownRegistry.name,
                    fromCache: false,
                    cid: resolution.cid,
                    error: 'Registry public key does not match pinned trusted key',
                };
            }
            const verified = await verifyRegistrySignature(registry);
            if (!verified) {
                return {
                    success: false,
                    source: knownRegistry.name,
                    fromCache: false,
                    cid: resolution.cid,
                    error: 'Registry signature verification failed',
                };
            }
        }
        // Cache the result
        this.cacheRegistry(knownRegistry.ipnsName, registry);
        return {
            success: true,
            registry,
            source: knownRegistry.name,
            fromCache: false,
            cid: resolution.cid,
        };
    }
    /**
     * Resolve IPNS name to CID via real IPFS gateway
     */
    async resolveIPNS(ipnsName) {
        // Check cache
        const cached = this.ipnsCache.get(ipnsName);
        if (cached && new Date(cached.expiresAt) > new Date()) {
            return cached;
        }
        const gateways = [
            'https://ipfs.io',
            'https://dweb.link',
            'https://cloudflare-ipfs.com',
        ];
        for (const gateway of gateways) {
            try {
                console.log(`[Discovery] Resolving IPNS via ${gateway}...`);
                // Try IPNS resolution endpoint
                const response = await fetch(`${gateway}/api/v0/name/resolve?arg=${ipnsName}`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(10000),
                });
                if (response.ok) {
                    const text = await readBodyCapped(response, 64 * 1024); // IPNS resolve is tiny
                    const data = JSON.parse(text);
                    const cid = data.Path?.replace('/ipfs/', '') || '';
                    if (cid) {
                        const resolution = {
                            ipnsName,
                            cid,
                            resolvedAt: new Date().toISOString(),
                            expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
                        };
                        if (this.ipnsCache.size >= PatternDiscovery.MAX_IPNS_CACHE && !this.ipnsCache.has(ipnsName)) {
                            const oldest = this.ipnsCache.keys().next().value;
                            if (oldest !== undefined)
                                this.ipnsCache.delete(oldest);
                        }
                        this.ipnsCache.set(ipnsName, resolution);
                        console.log(`[Discovery] Resolved IPNS to CID: ${cid}`);
                        return resolution;
                    }
                }
                // Fallback: Try fetching content directly via IPNS gateway URL
                const ipnsResponse = await fetch(`${gateway}/ipns/${ipnsName}`, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(10000),
                    redirect: 'follow',
                });
                if (ipnsResponse.ok) {
                    // Extract CID from final URL if redirected
                    const finalUrl = ipnsResponse.url;
                    const cidMatch = finalUrl.match(/\/ipfs\/([a-zA-Z0-9]+)/);
                    if (cidMatch) {
                        const cid = cidMatch[1];
                        const resolution = {
                            ipnsName,
                            cid,
                            resolvedAt: new Date().toISOString(),
                            expiresAt: new Date(Date.now() + 3600000).toISOString(),
                        };
                        if (this.ipnsCache.size >= PatternDiscovery.MAX_IPNS_CACHE && !this.ipnsCache.has(ipnsName)) {
                            const oldest = this.ipnsCache.keys().next().value;
                            if (oldest !== undefined)
                                this.ipnsCache.delete(oldest);
                        }
                        this.ipnsCache.set(ipnsName, resolution);
                        console.log(`[Discovery] Resolved IPNS via redirect to CID: ${cid}`);
                        return resolution;
                    }
                }
            }
            catch (error) {
                console.warn(`[Discovery] IPNS resolution via ${gateway} failed:`, error);
                // Continue to next gateway
            }
        }
        // Fallback: Generate deterministic CID for well-known registries
        console.warn(`⚠ [Discovery] OFFLINE MODE - Could not resolve IPNS: ${ipnsName}`);
        console.warn(`⚠ [Discovery] Using built-in fallback registry (may be outdated)`);
        const fallbackCid = this.generateFallbackCID(ipnsName);
        const resolution = {
            ipnsName,
            cid: fallbackCid,
            resolvedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
        this.ipnsCache.set(ipnsName, resolution);
        return resolution;
    }
    /**
     * Generate deterministic fallback CID for offline/demo mode
     */
    generateFallbackCID(input) {
        const hash = crypto.createHash('sha256').update(input + 'registry').digest();
        const prefix = 'bafybei';
        const base32Chars = 'abcdefghijklmnopqrstuvwxyz234567';
        let result = prefix;
        for (let i = 0; i < 44; i++) {
            result += base32Chars[hash[i % hash.length] % 32];
        }
        return result;
    }
    /**
     * Fetch registry from IPFS gateway
     */
    async fetchRegistry(cid, gateway) {
        const url = `${gateway}/ipfs/${cid}`;
        console.log(`[Discovery] Fetching: ${url}`);
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(30000),
            });
            if (response.ok) {
                const text = await readBodyCapped(response);
                try {
                    const registry = JSON.parse(text);
                    console.log(`[Discovery] Fetched registry with ${registry.patterns?.length || 0} patterns`);
                    return registry;
                }
                catch {
                    console.error(`[Discovery] Invalid registry JSON`);
                }
            }
        }
        catch (error) {
            console.warn(`[Discovery] Fetch from ${gateway} failed:`, error);
        }
        // Try alternative gateways
        const alternativeGateways = [
            'https://ipfs.io',
            'https://dweb.link',
            'https://cloudflare-ipfs.com',
            'https://gateway.pinata.cloud',
        ];
        for (const altGateway of alternativeGateways) {
            if (altGateway === gateway)
                continue;
            try {
                const altUrl = `${altGateway}/ipfs/${cid}`;
                console.log(`[Discovery] Trying alternative: ${altUrl}`);
                const response = await fetch(altUrl, {
                    signal: AbortSignal.timeout(15000),
                });
                if (response.ok) {
                    const altText = await readBodyCapped(response);
                    const registry = JSON.parse(altText);
                    console.log(`[Discovery] Fetched registry from ${altGateway}`);
                    return registry;
                }
            }
            catch {
                // Continue to next gateway
            }
        }
        // Check for GCS-hosted registry
        try {
            const { hasGCSCredentials, downloadFromGCS } = await import('../storage/gcs.js');
            if (hasGCSCredentials()) {
                const gcsUri = `gs://monomind-patterns/registry/${cid}.json`;
                console.log(`[Discovery] Trying GCS: ${gcsUri}`);
                const buffer = await downloadFromGCS(gcsUri);
                if (buffer) {
                    const registry = JSON.parse(buffer.toString());
                    console.log(`[Discovery] Fetched registry from GCS`);
                    return registry;
                }
            }
        }
        catch {
            // GCS not available
        }
        // No registry could be reached. Previously this fell back to a built-in
        // "genesis registry" that invented a pattern with fabricated stats
        // (1,000 downloads, 5.0 rating, 42 reviews). Return an honest empty
        // registry instead.
        console.log(`[Discovery] No registry reachable — transfer store requires a configured registry`);
        return this.getEmptyRegistry();
    }
    /**
     * Honest empty registry returned when no registry is reachable.
     * Contains no patterns and no fabricated stats.
     */
    getEmptyRegistry() {
        return {
            version: '1.0.0',
            updatedAt: new Date().toISOString(),
            ipnsName: '',
            previousCid: undefined,
            patterns: [],
            categories: [],
            authors: [],
            totalPatterns: 0,
            totalDownloads: 0,
            totalAuthors: 0,
            featured: [],
            trending: [],
            newest: [],
            // No signature — trusted-registry callers must reject this fallback
            // (the verification path requires `registrySignature` to be present
            // and verified against a pinned public key).
        };
    }
    /**
     * Verify registry signature.
     *
     * DEPRECATED: Do not use this method. It was a length-only stub. Real
     * verification must use `verifyRegistrySignature` from registry.ts which
     * performs Ed25519 verification. This stub is preserved only to avoid
     * breaking callers that imported it; it now always returns false.
     */
    verifyRegistry(_registry, _expectedPublicKey) {
        // Always return false — the call site at line 117 was already migrated to
        // the real verifier. Any other caller using this stub is treated as a
        // verification failure (fail-closed).
        return false;
    }
    /**
     * Get cached registry
     */
    getCachedRegistry(ipnsName) {
        const cached = this.cache.get(ipnsName);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.registry;
        }
        return null;
    }
    /**
     * Cache registry
     */
    static MAX_REGISTRY_CACHE = 50;
    static MAX_IPNS_CACHE = 200;
    cacheRegistry(ipnsName, registry) {
        if (this.cache.size >= PatternDiscovery.MAX_REGISTRY_CACHE && !this.cache.has(ipnsName)) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined)
                this.cache.delete(oldest);
        }
        this.cache.set(ipnsName, {
            registry,
            expiresAt: Date.now() + this.config.cacheExpiry,
        });
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        this.ipnsCache.clear();
    }
    /**
     * List all known registries
     */
    listRegistries() {
        return this.config.registries;
    }
    /**
     * Add a custom registry
     */
    addRegistry(registry) {
        const existing = this.config.registries.findIndex(r => r.name === registry.name);
        if (existing >= 0) {
            this.config.registries[existing] = registry;
        }
        else {
            this.config.registries.push(registry);
        }
    }
}
/**
 * Create discovery service with default config
 */
export function createDiscoveryService(config) {
    return new PatternDiscovery(config);
}
//# sourceMappingURL=discovery.js.map