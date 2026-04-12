/**
 * Shared Cryptographic Utilities
 *
 * Centralises timing-safe comparison so every module that verifies
 * HMAC signatures uses the same constant-time implementation.
 *
 * @module @monobrain/guidance/crypto-utils
 */
/**
 * Constant-time string comparison to prevent timing attacks on HMAC signatures.
 *
 * Delegates to Node.js `crypto.timingSafeEqual` via `Buffer.from` for
 * encoding-safe comparison. Falls back to a manual XOR loop when the
 * buffers have different byte lengths (which the native function rejects).
 */
export declare function timingSafeEqual(a: string, b: string): boolean;
//# sourceMappingURL=crypto-utils.d.ts.map