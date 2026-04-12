/**
 * V1 Security Module
 *
 * Comprehensive security module addressing all identified vulnerabilities:
 * - CVE-2: Weak Password Hashing (password-hasher.ts)
 * - CVE-3: Hardcoded Default Credentials (credential-generator.ts)
 * - HIGH-1: Command Injection (safe-executor.ts)
 * - HIGH-2: Path Traversal (path-validator.ts)
 *
 * Also provides:
 * - Input validation with Zod schemas
 * - Secure token generation
 *
 * @module v1/security
 */
export { PasswordHasher, PasswordHashError, createPasswordHasher, type PasswordHasherConfig, type PasswordValidationResult, } from './password-hasher.js';
export { CredentialGenerator, CredentialGeneratorError, createCredentialGenerator, generateCredentials, type CredentialConfig, type GeneratedCredentials, type ApiKeyCredential, } from './credential-generator.js';
export { SafeExecutor, SafeExecutorError, createDevelopmentExecutor, createReadOnlyExecutor, type ExecutorConfig, type ExecutionResult, type StreamingExecutor, } from './safe-executor.js';
export { PathValidator, PathValidatorError, createProjectPathValidator, createFullProjectPathValidator, type PathValidatorConfig, type PathValidationResult, } from './path-validator.js';
export { InputValidator, sanitizeString, sanitizeHtml, sanitizePath, SafeStringSchema, IdentifierSchema, FilenameSchema, EmailSchema, PasswordSchema, UUIDSchema, HttpsUrlSchema, UrlSchema, SemverSchema, PortSchema, IPv4Schema, IPSchema, UserRoleSchema, PermissionSchema, LoginRequestSchema, CreateUserSchema, CreateApiKeySchema, AgentTypeSchema, SpawnAgentSchema, TaskInputSchema, CommandArgumentSchema, PathSchema, SecurityConfigSchema, ExecutorConfigSchema, PATTERNS, LIMITS, z, } from './input-validator.js';
export { TokenGenerator, TokenGeneratorError, createTokenGenerator, getDefaultGenerator, quickGenerate, type TokenConfig, type Token, type SignedToken, type VerificationCode, } from './token-generator.js';
import { PasswordHasher } from './password-hasher.js';
import { CredentialGenerator } from './credential-generator.js';
import { SafeExecutor } from './safe-executor.js';
import { PathValidator } from './path-validator.js';
import { TokenGenerator } from './token-generator.js';
/**
 * Security module configuration
 */
export interface SecurityModuleConfig {
    /**
     * Project root directory for path validation
     */
    projectRoot: string;
    /**
     * HMAC secret for token signing
     */
    hmacSecret: string;
    /**
     * Bcrypt rounds for password hashing
     * Default: 12
     */
    bcryptRounds?: number;
    /**
     * Allowed commands for safe executor
     * Default: ['git', 'npm', 'node']
     */
    allowedCommands?: string[];
}
/**
 * Complete security module instance
 */
export interface SecurityModule {
    passwordHasher: PasswordHasher;
    credentialGenerator: CredentialGenerator;
    safeExecutor: SafeExecutor;
    pathValidator: PathValidator;
    tokenGenerator: TokenGenerator;
}
/**
 * Creates a complete security module with all components configured.
 *
 * @param config - Module configuration
 * @returns Complete security module
 *
 * @example
 * ```typescript
 * const security = createSecurityModule({
 *   projectRoot: '/workspaces/project',
 *   hmacSecret: process.env.HMAC_SECRET!,
 * });
 *
 * // Hash password
 * const hash = await security.passwordHasher.hash('password');
 *
 * // Validate path
 * const result = await security.pathValidator.validate('/workspaces/project/src/file.ts');
 *
 * // Execute command safely
 * const output = await security.safeExecutor.execute('git', ['status']);
 * ```
 */
export declare function createSecurityModule(config: SecurityModuleConfig): SecurityModule;
/**
 * Minimum recommended bcrypt rounds for production
 */
export declare const MIN_BCRYPT_ROUNDS = 12;
/**
 * Maximum recommended bcrypt rounds (performance consideration)
 */
export declare const MAX_BCRYPT_ROUNDS = 14;
/**
 * Minimum password length
 */
export declare const MIN_PASSWORD_LENGTH = 8;
/**
 * Maximum password length (bcrypt limitation)
 */
export declare const MAX_PASSWORD_LENGTH = 72;
/**
 * Default token expiration in seconds (1 hour)
 */
export declare const DEFAULT_TOKEN_EXPIRATION = 3600;
/**
 * Default session expiration in seconds (24 hours)
 */
export declare const DEFAULT_SESSION_EXPIRATION = 86400;
/**
 * Checks security configuration for common issues.
 *
 * @param config - Configuration to audit
 * @returns Array of security warnings
 */
export declare function auditSecurityConfig(config: Partial<SecurityModuleConfig>): string[];
/**
 * Security module version
 */
export declare const SECURITY_MODULE_VERSION = "3.0.0-alpha.1";
export { WasmSandbox, DockerSandbox, provision, register, get as getSandbox, cleanup, cleanupAll, listActive, validateSandboxConfig, type SandboxType, type NetworkMode, type SandboxConfig, type SandboxExecResult, type SandboxRuntime, } from './sandbox/index.js';
//# sourceMappingURL=index.d.ts.map