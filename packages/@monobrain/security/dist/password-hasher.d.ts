/**
 * Password Hasher - CVE-2 Remediation
 *
 * Fixes weak password hashing by replacing SHA-256 with hardcoded salt
 * with bcrypt using 12 rounds (configurable).
 *
 * Security Properties:
 * - bcrypt with adaptive cost factor (12 rounds)
 * - Automatic salt generation per password
 * - Timing-safe comparison
 * - Minimum password length enforcement
 *
 * @module v1/security/password-hasher
 */
export interface PasswordHasherConfig {
    /**
     * Number of bcrypt rounds (cost factor).
     * Default: 12 (recommended minimum for production)
     * Each increment doubles the computation time.
     */
    rounds?: number;
    /**
     * Minimum password length.
     * Default: 8 characters
     */
    minLength?: number;
    /**
     * Maximum password length.
     * Default: 128 characters (bcrypt limit is 72 bytes)
     */
    maxLength?: number;
    /**
     * Require at least one uppercase letter.
     * Default: true
     */
    requireUppercase?: boolean;
    /**
     * Require at least one lowercase letter.
     * Default: true
     */
    requireLowercase?: boolean;
    /**
     * Require at least one digit.
     * Default: true
     */
    requireDigit?: boolean;
    /**
     * Require at least one special character.
     * Default: false
     */
    requireSpecial?: boolean;
}
export interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}
export declare class PasswordHashError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Secure password hasher using bcrypt.
 *
 * This class replaces the vulnerable SHA-256 + hardcoded salt implementation
 * with industry-standard bcrypt hashing.
 *
 * @example
 * ```typescript
 * const hasher = new PasswordHasher({ rounds: 12 });
 * const hash = await hasher.hash('securePassword123');
 * const isValid = await hasher.verify('securePassword123', hash);
 * ```
 */
export declare class PasswordHasher {
    private readonly config;
    constructor(config?: PasswordHasherConfig);
    /**
     * Validates password against configured requirements.
     *
     * @param password - The password to validate
     * @returns Validation result with errors if any
     */
    validate(password: string): PasswordValidationResult;
    /**
     * Hashes a password using bcrypt.
     *
     * @param password - The plaintext password to hash
     * @returns The bcrypt hash
     * @throws PasswordHashError if password is invalid
     */
    hash(password: string): Promise<string>;
    /**
     * Verifies a password against a bcrypt hash.
     * Uses timing-safe comparison internally.
     *
     * @param password - The plaintext password to verify
     * @param hash - The bcrypt hash to compare against
     * @returns True if password matches, false otherwise
     */
    verify(password: string, hash: string): Promise<boolean>;
    /**
     * Checks if a hash needs to be rehashed with updated parameters.
     * Useful for upgrading hash strength over time.
     *
     * @param hash - The bcrypt hash to check
     * @returns True if hash should be updated
     */
    needsRehash(hash: string): boolean;
    /**
     * Validates bcrypt hash format.
     *
     * @param hash - The hash to validate
     * @returns True if valid bcrypt hash format
     */
    private isValidBcryptHash;
    /**
     * Returns current configuration (without sensitive defaults).
     */
    getConfig(): Readonly<Omit<Required<PasswordHasherConfig>, never>>;
}
/**
 * Factory function to create a production-ready password hasher.
 *
 * @param rounds - Bcrypt rounds (default: 12)
 * @returns Configured PasswordHasher instance
 */
export declare function createPasswordHasher(rounds?: number): PasswordHasher;
//# sourceMappingURL=password-hasher.d.ts.map