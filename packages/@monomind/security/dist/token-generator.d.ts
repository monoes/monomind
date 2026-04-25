/**
 * Token Generator - Secure Token Generation
 *
 * Provides cryptographically secure token generation for:
 * - JWT tokens
 * - Session tokens
 * - CSRF tokens
 * - API tokens
 * - Verification codes
 *
 * Security Properties:
 * - Uses crypto.randomBytes for all randomness
 * - Configurable entropy levels
 * - Timing-safe comparison
 * - Token expiration handling
 *
 * @module v1/security/token-generator
 */
export interface TokenConfig {
    /**
     * Default token length in bytes.
     * Default: 32 (256 bits)
     */
    defaultLength?: number;
    /**
     * Token encoding format.
     * Default: 'base64url'
     */
    encoding?: 'hex' | 'base64' | 'base64url';
    /**
     * HMAC secret for signed tokens.
     */
    hmacSecret?: string;
    /**
     * Default expiration time in seconds.
     * Default: 3600 (1 hour)
     */
    defaultExpiration?: number;
}
export interface Token {
    value: string;
    createdAt: Date;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
}
export interface SignedToken {
    token: string;
    signature: string;
    combined: string;
    createdAt: Date;
    expiresAt: Date;
}
export interface VerificationCode {
    code: string;
    createdAt: Date;
    expiresAt: Date;
    attempts: number;
    maxAttempts: number;
}
export declare class TokenGeneratorError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Secure token generator.
 *
 * @example
 * ```typescript
 * const generator = new TokenGenerator({ hmacSecret: 'secret' });
 *
 * // Generate session token
 * const session = generator.generateSessionToken();
 *
 * // Generate signed token
 * const signed = generator.generateSignedToken({ userId: '123' });
 *
 * // Verify signed token
 * const isValid = generator.verifySignedToken(signed.combined);
 * ```
 */
export declare class TokenGenerator {
    private readonly config;
    constructor(config?: TokenConfig);
    /**
     * Generates a random token.
     *
     * @param length - Token length in bytes
     * @returns Random token string
     */
    generate(length?: number): string;
    /**
     * Generates a token with expiration.
     *
     * @param expirationSeconds - Expiration time in seconds
     * @param metadata - Optional metadata to attach
     * @returns Token with expiration
     */
    generateWithExpiration(expirationSeconds?: number, metadata?: Record<string, unknown>): Token;
    /**
     * Generates a session token (URL-safe).
     *
     * @param length - Token length in bytes (default: 32)
     * @returns Session token
     */
    generateSessionToken(length?: number): Token;
    /**
     * Generates a CSRF token.
     *
     * @returns CSRF token (shorter expiration)
     */
    generateCsrfToken(): Token;
    /**
     * Generates an API token with prefix.
     *
     * @param prefix - Token prefix (e.g., 'cf_')
     * @returns Prefixed API token
     */
    generateApiToken(prefix?: string): Token;
    /**
     * Generates a numeric verification code.
     *
     * @param length - Number of digits (default: 6)
     * @param expirationMinutes - Expiration in minutes (default: 10)
     * @param maxAttempts - Maximum verification attempts (default: 3)
     * @returns Verification code
     */
    generateVerificationCode(length?: number, expirationMinutes?: number, maxAttempts?: number): VerificationCode;
    /**
     * Generates a signed token using HMAC.
     *
     * @param payload - Data to include in token
     * @param expirationSeconds - Token expiration
     * @returns Signed token
     */
    generateSignedToken(payload: Record<string, unknown>, expirationSeconds?: number): SignedToken;
    /**
     * Verifies a signed token.
     *
     * @param combined - Combined token string (token.signature)
     * @returns Decoded payload if valid, null otherwise
     */
    verifySignedToken(combined: string): Record<string, unknown> | null;
    /**
     * Generates a refresh token pair.
     *
     * @returns Access and refresh tokens
     */
    generateTokenPair(): {
        accessToken: Token;
        refreshToken: Token;
    };
    /**
     * Generates a password reset token.
     *
     * @returns Password reset token (short expiration)
     */
    generatePasswordResetToken(): Token;
    /**
     * Generates an email verification token.
     *
     * @returns Email verification token
     */
    generateEmailVerificationToken(): Token;
    /**
     * Generates a unique request ID.
     *
     * @returns Request ID (shorter, for logging)
     */
    generateRequestId(): string;
    /**
     * Generates a correlation ID for distributed tracing.
     *
     * @returns Correlation ID
     */
    generateCorrelationId(): string;
    /**
     * Checks if a token has expired.
     *
     * @param token - Token to check
     * @returns True if expired
     */
    isExpired(token: Token | VerificationCode): boolean;
    /**
     * Compares two tokens in constant time.
     *
     * @param a - First token
     * @param b - Second token
     * @returns True if equal
     */
    compare(a: string, b: string): boolean;
    /**
     * Signs data using HMAC-SHA256.
     */
    private sign;
    /**
     * Encodes bytes according to configuration.
     */
    private encode;
}
/**
 * Factory function to create a production token generator.
 *
 * @param hmacSecret - HMAC secret for signed tokens
 * @returns Configured TokenGenerator
 */
export declare function createTokenGenerator(hmacSecret: string): TokenGenerator;
/**
 * Gets or creates the default token generator.
 * Note: Does not support signed tokens without configuration.
 */
export declare function getDefaultGenerator(): TokenGenerator;
/**
 * Quick token generation functions.
 */
export declare const quickGenerate: {
    token: (length?: number) => string;
    sessionToken: () => Token;
    csrfToken: () => Token;
    apiToken: (prefix?: string) => Token;
    verificationCode: (length?: number) => VerificationCode;
    requestId: () => string;
    correlationId: () => string;
};
//# sourceMappingURL=token-generator.d.ts.map