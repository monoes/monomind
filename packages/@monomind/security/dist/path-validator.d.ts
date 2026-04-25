/**
 * Path Validator - HIGH-2 Remediation
 *
 * Fixes path traversal vulnerabilities by:
 * - Validating all file paths against allowed prefixes
 * - Using path.resolve() for canonicalization
 * - Blocking traversal patterns (../, etc.)
 * - Enforcing path length limits
 *
 * Security Properties:
 * - Path canonicalization
 * - Prefix validation
 * - Symlink resolution (optional)
 * - Traversal pattern detection
 *
 * @module v1/security/path-validator
 */
export interface PathValidatorConfig {
    /**
     * Allowed directory prefixes.
     * Paths must start with one of these after resolution.
     */
    allowedPrefixes: string[];
    /**
     * Blocked file extensions.
     * Files with these extensions are rejected.
     */
    blockedExtensions?: string[];
    /**
     * Blocked file names.
     * Files matching these names are rejected.
     */
    blockedNames?: string[];
    /**
     * Maximum path length.
     * Default: 4096 characters
     */
    maxPathLength?: number;
    /**
     * Whether to resolve symlinks.
     * Default: true
     */
    resolveSymlinks?: boolean;
    /**
     * Whether to allow paths that don't exist.
     * Default: true (for write operations)
     */
    allowNonExistent?: boolean;
    /**
     * Whether to allow hidden files/directories.
     * Default: false
     */
    allowHidden?: boolean;
}
export interface PathValidationResult {
    isValid: boolean;
    resolvedPath: string;
    relativePath: string;
    matchedPrefix: string;
    errors: string[];
}
export declare class PathValidatorError extends Error {
    readonly code: string;
    readonly path?: string | undefined;
    constructor(message: string, code: string, path?: string | undefined);
}
/**
 * Path validator that prevents traversal attacks.
 *
 * This class validates file paths to ensure they stay within
 * allowed directories and don't access sensitive files.
 *
 * @example
 * ```typescript
 * const validator = new PathValidator({
 *   allowedPrefixes: ['/workspaces/project']
 * });
 *
 * const result = await validator.validate('/workspaces/project/src/file.ts');
 * if (result.isValid) {
 *   // Safe to use result.resolvedPath
 * }
 * ```
 */
export declare class PathValidator {
    private readonly config;
    private readonly resolvedPrefixes;
    constructor(config: PathValidatorConfig);
    /**
     * Validates a path against security rules.
     *
     * @param inputPath - The path to validate
     * @returns Validation result with resolved path
     */
    validate(inputPath: string): Promise<PathValidationResult>;
    /**
     * Validates and returns resolved path, throwing on failure.
     *
     * @param inputPath - The path to validate
     * @returns Resolved path if valid
     * @throws PathValidatorError if validation fails
     */
    validateOrThrow(inputPath: string): Promise<string>;
    /**
     * Synchronous validation (without symlink resolution).
     *
     * @param inputPath - The path to validate
     * @returns Validation result
     */
    validateSync(inputPath: string): PathValidationResult;
    /**
     * Securely joins path segments within allowed directories.
     *
     * @param prefix - Base directory (must be in allowedPrefixes)
     * @param segments - Path segments to join
     * @returns Validated resolved path
     */
    securePath(prefix: string, ...segments: string[]): Promise<string>;
    /**
     * Adds a prefix to the allowed list at runtime.
     *
     * @param prefix - Prefix to add
     */
    addPrefix(prefix: string): void;
    /**
     * Returns the current allowed prefixes.
     */
    getAllowedPrefixes(): readonly string[];
    /**
     * Checks if a path is within allowed prefixes (quick check).
     */
    isWithinAllowed(inputPath: string): boolean;
}
/**
 * Factory function to create a path validator for a project directory.
 *
 * @param projectRoot - Root directory of the project
 * @returns Configured PathValidator
 */
export declare function createProjectPathValidator(projectRoot: string): PathValidator;
/**
 * Factory function to create a path validator for the entire project.
 *
 * @param projectRoot - Root directory of the project
 * @returns Configured PathValidator
 */
export declare function createFullProjectPathValidator(projectRoot: string): PathValidator;
//# sourceMappingURL=path-validator.d.ts.map