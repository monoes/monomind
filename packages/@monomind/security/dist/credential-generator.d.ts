/**
 * Credential Generator - CVE-3 Remediation
 *
 * Fixes hardcoded default credentials by providing secure random
 * credential generation for installation and runtime.
 *
 * Security Properties:
 * - Uses crypto.randomBytes for cryptographically secure randomness
 * - Configurable entropy levels
 * - No hardcoded defaults stored in code
 * - Secure credential storage recommendations
 *
 * @module v1/security/credential-generator
 */
export interface CredentialConfig {
    /**
     * Length of generated passwords.
     * Default: 32 characters
     */
    passwordLength?: number;
    /**
     * Length of generated API keys.
     * Default: 48 characters
     */
    apiKeyLength?: number;
    /**
     * Length of generated secrets (JWT, session, etc.).
     * Default: 64 characters
     */
    secretLength?: number;
    /**
     * Character set for password generation.
     * Default: alphanumeric + special
     */
    passwordCharset?: string;
    /**
     * Character set for API key generation.
     * Default: alphanumeric only (URL-safe)
     */
    apiKeyCharset?: string;
}
export interface GeneratedCredentials {
    adminPassword: string;
    servicePassword: string;
    jwtSecret: string;
    sessionSecret: string;
    encryptionKey: string;
    generatedAt: Date;
    expiresAt?: Date;
}
export interface ApiKeyCredential {
    key: string;
    prefix: string;
    keyId: string;
    createdAt: Date;
}
export declare class CredentialGeneratorError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Secure credential generator.
 *
 * This class provides cryptographically secure credential generation
 * to replace hardcoded default credentials.
 *
 * @example
 * ```typescript
 * const generator = new CredentialGenerator();
 * const credentials = generator.generateInstallationCredentials();
 * // Store credentials securely (environment variables, secrets manager)
 * ```
 */
export declare class CredentialGenerator {
    private readonly config;
    constructor(config?: CredentialConfig);
    /**
     * Validates configuration parameters.
     */
    private validateConfig;
    /**
     * Generates a cryptographically secure random string using rejection sampling
     * to eliminate modulo bias.
     *
     * @param length - Length of the string to generate
     * @param charset - Character set to use
     * @returns Random string
     */
    private generateSecureString;
    /**
     * Generates a secure random password.
     *
     * @param length - Optional custom length (default from config)
     * @returns Secure random password
     */
    generatePassword(length?: number): string;
    /**
     * Checks if password has required character types.
     */
    private hasRequiredCharacterTypes;
    /**
     * Generates a secure API key.
     *
     * @param prefix - Optional prefix for the key (e.g., 'cf_')
     * @returns API key credential with metadata
     */
    generateApiKey(prefix?: string): ApiKeyCredential;
    /**
     * Generates a secure secret for JWT, sessions, etc.
     *
     * @param length - Optional custom length (default from config)
     * @returns Hex-encoded secret
     */
    generateSecret(length?: number): string;
    /**
     * Generates an encryption key suitable for AES-256.
     *
     * @returns 32-byte key encoded as hex (64 characters)
     */
    generateEncryptionKey(): string;
    /**
     * Generates a complete set of installation credentials.
     *
     * These should be stored securely (environment variables,
     * secrets manager, etc.) and NEVER committed to version control.
     *
     * @param expirationDays - Optional expiration period in days
     * @returns Complete credential set
     */
    generateInstallationCredentials(expirationDays?: number): GeneratedCredentials;
    /**
     * Generates a secure session token.
     *
     * @returns URL-safe session token
     */
    generateSessionToken(): string;
    /**
     * Generates a secure CSRF token.
     *
     * @returns CSRF token
     */
    generateCsrfToken(): string;
    /**
     * Generates a secure nonce for one-time use.
     *
     * @returns Unique nonce value
     */
    generateNonce(): string;
    /**
     * Creates a setup script output for secure credential deployment.
     *
     * @param credentials - Generated credentials
     * @returns Environment variable export script
     */
    createEnvScript(credentials: GeneratedCredentials): string;
    /**
     * Creates a JSON configuration output for secure credential deployment.
     *
     * @param credentials - Generated credentials
     * @returns JSON configuration (for secrets manager import)
     */
    createJsonConfig(credentials: GeneratedCredentials): string;
}
/**
 * Factory function to create a production credential generator.
 *
 * @returns Configured CredentialGenerator instance
 */
export declare function createCredentialGenerator(): CredentialGenerator;
/**
 * Quick credential generation for CLI usage.
 *
 * @returns Generated installation credentials
 */
export declare function generateCredentials(): GeneratedCredentials;
//# sourceMappingURL=credential-generator.d.ts.map