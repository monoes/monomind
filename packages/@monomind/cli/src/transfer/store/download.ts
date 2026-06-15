/**
 * Pattern Download Service
 * Secure download and verification of patterns from IPFS
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  PatternEntry,
  DownloadOptions,
  DownloadResult,
  StoreConfig,
} from './types.js';
import { DEFAULT_STORE_CONFIG } from './registry.js';
import type { CFPFormat } from '../types.js';

/**
 * Download progress callback
 */
export type DownloadProgressCallback = (progress: {
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
}) => void;

/**
 * Pattern Downloader
 * Handles secure download and verification of patterns
 */
const MAX_DOWNLOAD_CACHE = 500;
const MAX_PATTERN_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — matches client.ts MAX_IPFS_RESPONSE_BYTES

const ALLOWED_GATEWAYS = new Set([
  'https://w3s.link',
  'https://dweb.link',
  'https://ipfs.io',
  'https://cloudflare-ipfs.com',
  'https://gateway.pinata.cloud',
]);

function isAllowedGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_GATEWAYS.has(`${parsed.protocol}//${parsed.host}`);
  } catch {
    return false;
  }
}

export class PatternDownloader {
  private config: StoreConfig;
  private downloadCache: Map<string, { path: string; downloadedAt: number }>;

  constructor(config: Partial<StoreConfig> = {}) {
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
    this.downloadCache = new Map();
  }

  /**
   * Download a pattern from IPFS
   */
  async downloadPattern(
    pattern: PatternEntry,
    options: DownloadOptions = {},
    onProgress?: DownloadProgressCallback
  ): Promise<DownloadResult> {
    console.log(`[Download] Starting download: ${pattern.displayName}`);
    console.log(`[Download] CID: ${pattern.cid}`);
    console.log(`[Download] Size: ${pattern.size} bytes`);

    // Check cache
    const cached = this.downloadCache.get(pattern.cid);
    if (cached && fs.existsSync(cached.path)) {
      console.log(`[Download] Found in cache: ${cached.path}`);
      return {
        success: true,
        pattern,
        outputPath: cached.path,
        imported: false,
        verified: true,
        size: pattern.size,
      };
    }

    try {
      // Determine output path
      const outputPath = this.resolveOutputPath(pattern, options);
      console.log(`[Download] Output path: ${outputPath}`);

      // Ensure directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Fetch from IPFS
      const content = await this.fetchFromIPFS(pattern.cid, onProgress);

      if (!content) {
        return {
          success: false,
          pattern,
          verified: false,
          size: 0,
        };
      }

      // Verify checksum
      let verified = false;
      if (options.verify !== false) {
        verified = this.verifyChecksum(content, pattern.checksum);
        if (!verified) {
          console.warn(`[Download] Warning: Checksum verification failed!`);
          if (this.config.requireVerification) {
            return {
              success: false,
              pattern,
              verified: false,
              size: content.length,
            };
          }
        } else {
          console.log(`[Download] Checksum verified!`);
        }
      }

      // Verify signature if available — fail closed when requireVerification is set
      if (pattern.signature && pattern.publicKey) {
        const sigVerified = await this.verifySignature(content, pattern.signature, pattern.publicKey);
        if (!sigVerified) {
          console.warn(`[Download] Warning: Signature verification failed!`);
          if (this.config.requireVerification) {
            return {
              success: false,
              pattern,
              verified: false,
              size: content.length,
            };
          }
        } else {
          console.log(`[Download] Signature verified!`);
        }
      } else if (this.config.requireVerification) {
        // No signature/key fields supplied while strict verification is on — fail closed
        console.warn(`[Download] Pattern lacks signature; requireVerification rejected`);
        return {
          success: false,
          pattern,
          verified: false,
          size: content.length,
        };
      }

      // Write to file atomically
      const tmp = outputPath + '.tmp';
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, outputPath);
      console.log(`[Download] Written to: ${outputPath}`);

      // Update cache (evict oldest when at capacity)
      if (this.downloadCache.size >= MAX_DOWNLOAD_CACHE) {
        const oldestKey = this.downloadCache.keys().next().value;
        if (oldestKey !== undefined) this.downloadCache.delete(oldestKey);
      }
      this.downloadCache.set(pattern.cid, {
        path: outputPath,
        downloadedAt: Date.now(),
      });

      // Import if requested
      let imported = false;
      if (options.import) {
        imported = await this.importPattern(outputPath, options.importStrategy);
      }

      return {
        success: true,
        pattern,
        outputPath,
        imported,
        verified,
        size: content.length,
      };
    } catch (error) {
      console.error(`[Download] Failed:`, error);
      return {
        success: false,
        pattern,
        verified: false,
        size: 0,
      };
    }
  }

  /**
   * Fetch content from IPFS gateway or GCS
   */
  private async fetchFromIPFS(
    cid: string,
    onProgress?: DownloadProgressCallback
  ): Promise<Buffer | null> {
    // Check if this is a GCS URI
    if (cid.startsWith('gs://')) {
      return this.fetchFromGCS(cid, onProgress);
    }

    if (!isAllowedGatewayUrl(this.config.gateway)) {
      console.error(`[Download] Gateway not in allowlist: ${this.config.gateway}`);
      return null;
    }
    const url = `${this.config.gateway}/ipfs/${cid}`;
    console.log(`[Download] Fetching: ${url}`);

    const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // match client.ts MAX_IPFS_RESPONSE_BYTES

    try {
      // Real HTTP fetch with progress
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

      if (!response.ok) {
        console.error(`[Download] HTTP ${response.status}: ${response.statusText}`);
        return null;
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

      // Stream the response for progress tracking
      if (response.body && onProgress && contentLength > 0) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let downloaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          downloaded += value.length;
          if (downloaded > MAX_DOWNLOAD_BYTES) {
            await reader.cancel();
            throw new Error(`Response too large: exceeded ${MAX_DOWNLOAD_BYTES} bytes`);
          }
          onProgress({
            bytesDownloaded: downloaded,
            totalBytes: contentLength,
            percentage: Math.round((downloaded / contentLength) * 100),
          });
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        console.log(`[Download] Downloaded ${buffer.length} bytes from IPFS gateway`);
        return buffer;
      }

      // Fallback for responses without content-length or progress
      const cl = parseInt(response.headers.get('content-length') ?? '0', 10);
      if (Number.isFinite(cl) && cl > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Response too large: ${cl} bytes`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Response too large: ${arrayBuffer.byteLength} bytes`);
      }
      const buffer = Buffer.from(arrayBuffer);
      console.log(`[Download] Downloaded ${buffer.length} bytes from IPFS gateway`);
      return buffer;
    } catch (error) {
      console.error(`[Download] Fetch failed:`, error);

      // Try alternative gateways
      const alternativeGateways = [
        'https://ipfs.io',
        'https://cloudflare-ipfs.com',
        'https://dweb.link',
        'https://gateway.pinata.cloud',
      ];

      for (const gateway of alternativeGateways) {
        if (gateway === this.config.gateway) continue;
        try {
          console.log(`[Download] Trying alternative gateway: ${gateway}`);
          const altResponse = await fetch(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(15000) });
          if (altResponse.ok) {
            const altCl = parseInt(altResponse.headers.get('content-length') ?? '0', 10);
            if (Number.isFinite(altCl) && altCl > MAX_DOWNLOAD_BYTES) {
              throw new Error(`Response too large: ${altCl} bytes`);
            }
            const arrayBuffer = await altResponse.arrayBuffer();
            if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
              throw new Error(`Response too large: ${arrayBuffer.byteLength} bytes`);
            }
            const buffer = Buffer.from(arrayBuffer);
            console.log(`[Download] Downloaded ${buffer.length} bytes from ${gateway}`);
            return buffer;
          }
        } catch {
          // Continue to next gateway
        }
      }

      return null;
    }
  }

  /**
   * Fetch content from Google Cloud Storage
   */
  private async fetchFromGCS(
    uri: string,
    onProgress?: DownloadProgressCallback
  ): Promise<Buffer | null> {
    console.log(`[Download] Fetching from GCS: ${uri}`);

    try {
      const { downloadFromGCS, hasGCSCredentials } = await import('../storage/gcs.js');

      if (!hasGCSCredentials()) {
        console.error(`[Download] GCS not configured`);
        return null;
      }

      const buffer = await downloadFromGCS(uri);

      if (buffer && onProgress) {
        onProgress({
          bytesDownloaded: buffer.length,
          totalBytes: buffer.length,
          percentage: 100,
        });
      }

      return buffer;
    } catch (error) {
      console.error(`[Download] GCS fetch failed:`, error);
      return null;
    }
  }

  /**
   * Verify content checksum
   */
  private verifyChecksum(content: Buffer, expectedChecksum: string): boolean {
    const actualChecksum = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
    return actualChecksum === expectedChecksum;
  }

  /**
   * Verify content signature using real Ed25519.
   *
   * CRITICAL FIX: Previously this used HMAC-SHA256 keyed with the *public* key —
   * which is a no-op for security since the key is, by definition, public.
   * Anyone reading the registry could recompute a valid "signature".
   * The fallback at the bottom returned true for length>20, which made the
   * function effectively a length check rather than a signature check.
   * Now uses @noble/ed25519 verifyAsync, the same library used in publish.ts,
   * and fails closed on any error.
   */
  private async verifySignature(
    content: Buffer,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    // Check signature format
    if (!signature.startsWith('ed25519:') || !publicKey.startsWith('ed25519:')) {
      return false;
    }

    try {
      const ed = await import('@noble/ed25519');
      const sigHex = signature.replace('ed25519:', '');
      const keyHex = publicKey.replace('ed25519:', '');

      // Real Ed25519 signature verification — fail-closed on any mismatch
      const isValid = await ed.verifyAsync(
        Buffer.from(sigHex, 'hex'),
        content,
        Buffer.from(keyHex, 'hex')
      );
      return isValid === true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve output path for pattern.
   *
   * CRITICAL: pattern.name and pattern.version come from registry data fetched
   * over the network. Without strict validation, an attacker who controls the
   * registry response can write to arbitrary paths (e.g. ~/.claude/helpers/
   * hook-handler.cjs) via traversal sequences in pattern.name.
   */
  private resolveOutputPath(pattern: PatternEntry, options: DownloadOptions): string {
    // Strict allowlist — no slashes, no dots-only, no traversal
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,63}$/.test(pattern.name) || pattern.name.includes('..')) {
      throw new Error(`Invalid pattern name: ${pattern.name}`);
    }
    if (!/^[a-zA-Z0-9._-]{1,32}$/.test(pattern.version) || pattern.version.includes('..')) {
      throw new Error(`Invalid pattern version: ${pattern.version}`);
    }

    if (options.output) {
      // If output is a directory, append filename
      if (fs.existsSync(options.output) && fs.statSync(options.output).isDirectory()) {
        const candidate = path.resolve(path.join(options.output, `${pattern.name}.cfp.json`));
        const root = path.resolve(options.output);
        if (!candidate.startsWith(root + path.sep)) {
          throw new Error('Output path escapes target directory');
        }
        return candidate;
      }
      return path.resolve(options.output);
    }

    // Default: cache directory — must remain within cacheDir
    const cacheDir = path.resolve(this.config.cacheDir);
    const candidate = path.resolve(path.join(cacheDir, `${pattern.name}-${pattern.version}.cfp.json`));
    if (!candidate.startsWith(cacheDir + path.sep)) {
      throw new Error('Output path escapes cache directory');
    }
    return candidate;
  }

  /**
   * Import downloaded pattern
   */
  private async importPattern(
    filePath: string,
    strategy: 'replace' | 'merge' | 'append' = 'merge'
  ): Promise<boolean> {
    console.log(`[Download] Importing pattern with strategy: ${strategy}`);

    try {
      if (fs.statSync(filePath).size > MAX_PATTERN_FILE_BYTES) {
        console.error(`[Download] Pattern file exceeds size limit (${MAX_PATTERN_FILE_BYTES} bytes)`);
        return false;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const cfp: CFPFormat = JSON.parse(content);

      // In production: Import to local pattern store
      // For demo: Just validate
      if (cfp.magic !== 'CFP1') {
        console.error(`[Download] Invalid CFP format`);
        return false;
      }

      console.log(`[Download] Pattern imported: ${cfp.metadata.name}`);
      return true;
    } catch (error) {
      console.error(`[Download] Import failed:`, error);
      return false;
    }
  }

  // NOTE: generateMockContent removed - using real HTTP fetch from IPFS gateways or GCS

  /**
   * Clear download cache
   */
  clearCache(): void {
    this.downloadCache.clear();
    console.log(`[Download] Cache cleared`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; totalSize: number } {
    let totalSize = 0;

    for (const { path: cachedPath } of this.downloadCache.values()) {
      if (fs.existsSync(cachedPath)) {
        totalSize += fs.statSync(cachedPath).size;
      }
    }

    return {
      count: this.downloadCache.size,
      totalSize,
    };
  }
}

/**
 * Batch download multiple patterns
 */
export async function batchDownload(
  patterns: PatternEntry[],
  options: DownloadOptions = {},
  config?: Partial<StoreConfig>
): Promise<DownloadResult[]> {
  const downloader = new PatternDownloader(config);
  const results: DownloadResult[] = [];

  for (const pattern of patterns) {
    const result = await downloader.downloadPattern(pattern, options);
    results.push(result);
  }

  return results;
}

/**
 * Create downloader with default config
 */
export function createDownloader(config?: Partial<StoreConfig>): PatternDownloader {
  return new PatternDownloader(config);
}
