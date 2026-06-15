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
        // Return fallback genesis registry if all else fails
        console.log(`[Discovery] Using built-in genesis registry`);
        return this.getGenesisRegistry(cid);
    }
    /**
     * Get built-in genesis registry (always available offline)
     */
    getGenesisRegistry(cid) {
        return {
            version: '1.0.0',
            updatedAt: new Date().toISOString(),
            ipnsName: 'k51qzi5uqu5dj0w8q1xvqn8ql2g4p7x8qpk9vz3xm1y2n3o4p5q6r7s8t9u0v',
            previousCid: undefined,
            patterns: [
                {
                    id: 'seraphine-genesis-v1',
                    name: 'seraphine-genesis',
                    displayName: 'Seraphine Genesis',
                    description: 'The foundational Monomind pattern model. Contains core routing patterns, complexity heuristics, and coordination trajectories for multi-agent swarms.',
                    version: '1.0.0',
                    cid: 'bafybeibqsa442vty2cvhku4ujlrkupyl75536ene7ybqsa442v',
                    size: 8808,
                    checksum: '8df766b89d044815c84796e7f33ba30d7806bff7eb2a75e2a0b7d26b64c45231',
                    author: {
                        id: 'monomind-team',
                        displayName: 'Monomind Team',
                        verified: true,
                        patterns: 1,
                        totalDownloads: 1000,
                    },
                    license: 'MIT',
                    categories: ['routing', 'coordination'],
                    tags: ['genesis', 'foundational', 'routing', 'swarm', 'coordination', 'multi-agent', 'hello-world'],
                    language: 'typescript',
                    framework: 'monomind',
                    downloads: 1000,
                    rating: 5.0,
                    ratingCount: 42,
                    lastUpdated: new Date().toISOString(),
                    createdAt: '2026-01-08T18:42:31.126Z',
                    minMonomindVersion: '3.0.0',
                    verified: true,
                    trustLevel: 'verified',
                    signature: 'ed25519:genesis-pattern-signature',
                    publicKey: 'ed25519:monomind-team-key',
                },
            ],
            categories: [
                { id: 'routing', name: 'Task Routing', description: 'Task routing patterns', patternCount: 1, icon: '🔀' },
                { id: 'coordination', name: 'Swarm Coordination', description: 'Multi-agent coordination', patternCount: 1, icon: '🐝' },
                { id: 'security', name: 'Security', description: 'Security patterns', patternCount: 0, icon: '🔒' },
                { id: 'performance', name: 'Performance', description: 'Performance patterns', patternCount: 0, icon: '⚡' },
                { id: 'testing', name: 'Testing', description: 'Testing patterns', patternCount: 0, icon: '🧪' },
            ],
            authors: [
                {
                    id: 'monomind-team',
                    displayName: 'Monomind Team',
                    publicKey: 'ed25519:monomind-team-key',
                    verified: true,
                    patterns: 1,
                    totalDownloads: 1000,
                },
            ],
            totalPatterns: 1,
            totalDownloads: 1000,
            totalAuthors: 1,
            featured: ['seraphine-genesis-v1'],
            trending: ['seraphine-genesis-v1'],
            newest: ['seraphine-genesis-v1'],
            // No signature on the genesis fallback. Previously this slot used
            // `crypto.randomBytes(32)` which is meaningless by construction — every
            // call would produce a different "valid" signature that no real key
            // signed. Trusted-registry callers must reject this fallback (the
            // verification path requires `registrySignature` to be present and
            // verified against a pinned public key).
            registryPublicKey: 'ed25519:monomind-registry-key',
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