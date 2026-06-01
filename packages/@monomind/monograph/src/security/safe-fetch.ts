const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$|\[::1\]/,
  /^fc00:|^\[fc00:/i,
  /^fe80:|^\[fe80:/i,
];

const CLOUD_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
]);

/**
 * Returns true if the given URL resolves to a private, loopback, or cloud
 * metadata address that should be blocked to prevent SSRF attacks.
 */
export function isPrivateUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (host === 'localhost') return true;
  if (CLOUD_METADATA_HOSTS.has(host)) return true;
  return PRIVATE_IP_PATTERNS.some(p => p.test(host));
}

/**
 * Validates that a URL is safe to fetch: must use http/https and must not
 * resolve to a private or reserved address.
 * @throws {Error} if the URL is invalid, uses an unsupported scheme, or is private
 */
export function validateUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported scheme: ${url.protocol}`);
  }
  if (isPrivateUrl(rawUrl)) {
    throw new Error(`URL resolves to private/reserved address: ${url.hostname}`);
  }
}

/**
 * Fetches the content of a URL after validating it is safe (not private/internal).
 * Enforces a maximum response size and request timeout.
 *
 * @param rawUrl - The URL to fetch
 * @param opts.maxBytes - Maximum allowed response size in bytes (default 10 MB)
 * @param opts.timeoutMs - Request timeout in milliseconds (default 10 000)
 * @returns The response body as a string
 * @throws {Error} if the URL is unsafe, the request fails, or the response is too large
 */
export async function safeFetch(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<string> {
  validateUrl(rawUrl);
  const { maxBytes = 10 * 1024 * 1024, timeoutMs = 10_000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawUrl}`);

    // Stream the body incrementally so we can enforce maxBytes before
    // the full response is loaded into memory (prevents memory exhaustion
    // on large/malicious payloads).
    if (!res.body) {
      throw new Error(`Response body is missing: ${rawUrl}`);
    }
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            throw new Error(`Response exceeds ${maxBytes} bytes: ${rawUrl}`);
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }
      // Flush any remaining bytes held in the decoder
      chunks.push(decoder.decode());
    } finally {
      reader.releaseLock();
    }

    return chunks.join('');
  } finally {
    clearTimeout(timer);
  }
}
