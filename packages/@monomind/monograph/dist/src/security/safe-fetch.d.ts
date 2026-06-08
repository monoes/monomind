/**
 * Returns true if the given URL resolves to a private, loopback, or cloud
 * metadata address that should be blocked to prevent SSRF attacks.
 */
export declare function isPrivateUrl(rawUrl: string): boolean;
/**
 * Validates that a URL is safe to fetch: must use http/https and must not
 * resolve to a private or reserved address.
 * @throws {Error} if the URL is invalid, uses an unsupported scheme, or is private
 */
export declare function validateUrl(rawUrl: string): void;
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
export declare function safeFetch(rawUrl: string, opts?: {
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<string>;
//# sourceMappingURL=safe-fetch.d.ts.map