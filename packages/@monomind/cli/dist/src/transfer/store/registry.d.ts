/**
 * Decentralized Pattern Registry
 * IPFS-based registry with IPNS for mutable references
 */
import type { PatternRegistry, PatternEntry, PatternCategory, KnownRegistry, StoreConfig } from './types.js';
/**
 * Registry version
 */
export declare const REGISTRY_VERSION = "1.0.0";
/**
 * Default bootstrap registries for discovery
 */
export declare const BOOTSTRAP_REGISTRIES: KnownRegistry[];
/**
 * Default store configuration
 */
export declare const DEFAULT_STORE_CONFIG: StoreConfig;
/**
 * Create a new empty registry
 */
export declare function createRegistry(ipnsName: string): PatternRegistry;
/**
 * Default pattern categories
 */
export declare function getDefaultCategories(): PatternCategory[];
/**
 * Add a pattern to the registry
 */
export declare function addPatternToRegistry(registry: PatternRegistry, entry: PatternEntry): PatternRegistry;
/**
 * Remove a pattern from the registry
 */
export declare function removePatternFromRegistry(registry: PatternRegistry, patternId: string): PatternRegistry;
/**
 * Serialize registry to JSON
 */
export declare function serializeRegistry(registry: PatternRegistry): string;
/**
 * Deserialize registry from JSON
 *
 * Caps the input string length before parsing to prevent OOM on a malicious or
 * oversized registry fetched from IPFS / Pinata. The in-flight body is already
 * capped by readBodyWithLimit (50 MB), but deserializeRegistry is also called
 * with locally-cached data, so we add a 10 MB guard here too.
 *
 * We also reject non-semver and suspiciously long version strings to prevent
 * version fields being used as a side-channel for large-payload injection.
 */
export declare function deserializeRegistry(json: string): PatternRegistry;
/**
 * Sign registry with private key
 */
export declare function signRegistry(registry: PatternRegistry, privateKey: string): Promise<PatternRegistry>;
/**
 * Verify registry signature using real Ed25519
 */
export declare function verifyRegistrySignature(registry: PatternRegistry): Promise<boolean>;
/**
 * Merge two registries (for sync)
 */
export declare function mergeRegistries(local: PatternRegistry, remote: PatternRegistry): PatternRegistry;
/**
 * Generate pattern ID from name
 */
export declare function generatePatternId(name: string): string;
//# sourceMappingURL=registry.d.ts.map