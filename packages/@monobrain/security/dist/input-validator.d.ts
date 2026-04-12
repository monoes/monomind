/**
 * Input Validator - Comprehensive Input Validation
 *
 * Provides Zod-based validation schemas for all security-critical inputs.
 *
 * Security Properties:
 * - Type-safe validation
 * - Custom error messages
 * - Sanitization transforms
 * - Reusable schemas
 *
 * @module v1/security/input-validator
 */
import { z } from 'zod';
/**
 * Custom error map for security-focused messages
 */
declare const securityErrorMap: z.ZodErrorMap;
export { securityErrorMap };
/**
 * Common validation patterns as reusable regex
 */
declare const PATTERNS: {
    SAFE_IDENTIFIER: RegExp;
    SAFE_FILENAME: RegExp;
    SAFE_PATH_SEGMENT: RegExp;
    NO_SHELL_CHARS: RegExp;
    SEMVER: RegExp;
};
/**
 * Validation limits
 */
declare const LIMITS: {
    MIN_PASSWORD_LENGTH: number;
    MAX_PASSWORD_LENGTH: number;
    MAX_EMAIL_LENGTH: number;
    MAX_IDENTIFIER_LENGTH: number;
    MAX_PATH_LENGTH: number;
    MAX_CONTENT_LENGTH: number;
    MAX_ARRAY_LENGTH: number;
    MAX_OBJECT_KEYS: number;
};
/**
 * Safe string that cannot contain shell metacharacters
 */
export declare const SafeStringSchema: z.ZodString;
/**
 * Safe identifier for IDs, names, etc.
 */
export declare const IdentifierSchema: z.ZodString;
/**
 * Safe filename
 */
export declare const FilenameSchema: z.ZodString;
/**
 * Email schema with length limit
 */
export declare const EmailSchema: z.ZodString;
/**
 * Password schema with complexity requirements
 */
export declare const PasswordSchema: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, string, string>;
/**
 * UUID schema
 */
export declare const UUIDSchema: z.ZodString;
/**
 * URL schema with HTTPS enforcement
 */
export declare const HttpsUrlSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * URL schema (allows HTTP for development)
 */
export declare const UrlSchema: z.ZodString;
/**
 * Semantic version schema
 */
export declare const SemverSchema: z.ZodString;
/**
 * Port number schema
 */
export declare const PortSchema: z.ZodNumber;
/**
 * IP address schema (v4)
 */
export declare const IPv4Schema: z.ZodString;
/**
 * IP address schema (v4 or v6)
 */
export declare const IPSchema: z.ZodString;
/**
 * User role schema
 */
export declare const UserRoleSchema: z.ZodEnum<["admin", "operator", "developer", "viewer", "service"]>;
/**
 * Permission schema
 */
export declare const PermissionSchema: z.ZodEnum<["swarm.create", "swarm.read", "swarm.update", "swarm.delete", "swarm.scale", "agent.spawn", "agent.read", "agent.terminate", "task.create", "task.read", "task.cancel", "metrics.read", "system.admin", "api.access"]>;
/**
 * Login request schema
 */
export declare const LoginRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    mfaCode: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
    mfaCode?: string | undefined;
}, {
    email: string;
    password: string;
    mfaCode?: string | undefined;
}>;
/**
 * User creation schema
 */
export declare const CreateUserSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, string, string>;
    role: z.ZodEnum<["admin", "operator", "developer", "viewer", "service"]>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<["swarm.create", "swarm.read", "swarm.update", "swarm.delete", "swarm.scale", "agent.spawn", "agent.read", "agent.terminate", "task.create", "task.read", "task.cancel", "metrics.read", "system.admin", "api.access"]>, "many">>;
    isActive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
    role: "admin" | "operator" | "developer" | "viewer" | "service";
    isActive: boolean;
    permissions?: ("swarm.create" | "swarm.read" | "swarm.update" | "swarm.delete" | "swarm.scale" | "agent.spawn" | "agent.read" | "agent.terminate" | "task.create" | "task.read" | "task.cancel" | "metrics.read" | "system.admin" | "api.access")[] | undefined;
}, {
    email: string;
    password: string;
    role: "admin" | "operator" | "developer" | "viewer" | "service";
    permissions?: ("swarm.create" | "swarm.read" | "swarm.update" | "swarm.delete" | "swarm.scale" | "agent.spawn" | "agent.read" | "agent.terminate" | "task.create" | "task.read" | "task.cancel" | "metrics.read" | "system.admin" | "api.access")[] | undefined;
    isActive?: boolean | undefined;
}>;
/**
 * API key creation schema
 */
export declare const CreateApiKeySchema: z.ZodObject<{
    name: z.ZodString;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<["swarm.create", "swarm.read", "swarm.update", "swarm.delete", "swarm.scale", "agent.spawn", "agent.read", "agent.terminate", "task.create", "task.read", "task.cancel", "metrics.read", "system.admin", "api.access"]>, "many">>;
    expiresAt: z.ZodOptional<z.ZodDate>;
}, "strip", z.ZodTypeAny, {
    name: string;
    permissions?: ("swarm.create" | "swarm.read" | "swarm.update" | "swarm.delete" | "swarm.scale" | "agent.spawn" | "agent.read" | "agent.terminate" | "task.create" | "task.read" | "task.cancel" | "metrics.read" | "system.admin" | "api.access")[] | undefined;
    expiresAt?: Date | undefined;
}, {
    name: string;
    permissions?: ("swarm.create" | "swarm.read" | "swarm.update" | "swarm.delete" | "swarm.scale" | "agent.spawn" | "agent.read" | "agent.terminate" | "task.create" | "task.read" | "task.cancel" | "metrics.read" | "system.admin" | "api.access")[] | undefined;
    expiresAt?: Date | undefined;
}>;
/**
 * Agent type schema
 */
export declare const AgentTypeSchema: z.ZodEnum<["coder", "reviewer", "tester", "planner", "researcher", "security-architect", "security-auditor", "memory-specialist", "swarm-specialist", "integration-architect", "performance-engineer", "core-architect", "test-architect", "queen-coordinator", "project-coordinator"]>;
/**
 * Agent spawn request schema
 */
export declare const SpawnAgentSchema: z.ZodObject<{
    type: z.ZodEnum<["coder", "reviewer", "tester", "planner", "researcher", "security-architect", "security-auditor", "memory-specialist", "swarm-specialist", "integration-architect", "performance-engineer", "core-architect", "test-architect", "queen-coordinator", "project-coordinator"]>;
    id: z.ZodOptional<z.ZodString>;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "coder" | "reviewer" | "tester" | "planner" | "researcher" | "security-architect" | "security-auditor" | "memory-specialist" | "swarm-specialist" | "integration-architect" | "performance-engineer" | "core-architect" | "test-architect" | "queen-coordinator" | "project-coordinator";
    config?: Record<string, unknown> | undefined;
    timeout?: number | undefined;
    id?: string | undefined;
}, {
    type: "coder" | "reviewer" | "tester" | "planner" | "researcher" | "security-architect" | "security-auditor" | "memory-specialist" | "swarm-specialist" | "integration-architect" | "performance-engineer" | "core-architect" | "test-architect" | "queen-coordinator" | "project-coordinator";
    config?: Record<string, unknown> | undefined;
    timeout?: number | undefined;
    id?: string | undefined;
}>;
/**
 * Task input schema
 */
export declare const TaskInputSchema: z.ZodObject<{
    taskId: z.ZodString;
    content: z.ZodString;
    agentType: z.ZodEnum<["coder", "reviewer", "tester", "planner", "researcher", "security-architect", "security-auditor", "memory-specialist", "swarm-specialist", "integration-architect", "performance-engineer", "core-architect", "test-architect", "queen-coordinator", "project-coordinator"]>;
    priority: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    content: string;
    agentType: "coder" | "reviewer" | "tester" | "planner" | "researcher" | "security-architect" | "security-auditor" | "memory-specialist" | "swarm-specialist" | "integration-architect" | "performance-engineer" | "core-architect" | "test-architect" | "queen-coordinator" | "project-coordinator";
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    taskId: string;
    content: string;
    agentType: "coder" | "reviewer" | "tester" | "planner" | "researcher" | "security-architect" | "security-auditor" | "memory-specialist" | "swarm-specialist" | "integration-architect" | "performance-engineer" | "core-architect" | "test-architect" | "queen-coordinator" | "project-coordinator";
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
/**
 * Command argument schema
 */
export declare const CommandArgumentSchema: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
/**
 * Path schema
 */
export declare const PathSchema: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
/**
 * Security configuration schema
 */
export declare const SecurityConfigSchema: z.ZodObject<{
    bcryptRounds: z.ZodDefault<z.ZodNumber>;
    jwtExpiresIn: z.ZodDefault<z.ZodString>;
    sessionTimeout: z.ZodDefault<z.ZodNumber>;
    maxLoginAttempts: z.ZodDefault<z.ZodNumber>;
    lockoutDuration: z.ZodDefault<z.ZodNumber>;
    requireMFA: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    bcryptRounds: number;
    jwtExpiresIn: string;
    sessionTimeout: number;
    maxLoginAttempts: number;
    lockoutDuration: number;
    requireMFA: boolean;
}, {
    bcryptRounds?: number | undefined;
    jwtExpiresIn?: string | undefined;
    sessionTimeout?: number | undefined;
    maxLoginAttempts?: number | undefined;
    lockoutDuration?: number | undefined;
    requireMFA?: boolean | undefined;
}>;
/**
 * Executor configuration schema
 */
export declare const ExecutorConfigSchema: z.ZodObject<{
    allowedCommands: z.ZodArray<z.ZodString, "many">;
    blockedPatterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    timeout: z.ZodDefault<z.ZodNumber>;
    maxBuffer: z.ZodDefault<z.ZodNumber>;
    cwd: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>>;
    allowSudo: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    allowedCommands: string[];
    timeout: number;
    maxBuffer: number;
    allowSudo: boolean;
    blockedPatterns?: string[] | undefined;
    cwd?: string | undefined;
}, {
    allowedCommands: string[];
    blockedPatterns?: string[] | undefined;
    timeout?: number | undefined;
    maxBuffer?: number | undefined;
    cwd?: string | undefined;
    allowSudo?: boolean | undefined;
}>;
/**
 * Sanitizes a string by removing dangerous characters
 */
export declare function sanitizeString(input: string): string;
/**
 * Sanitizes HTML entities
 */
export declare function sanitizeHtml(input: string): string;
/**
 * Sanitizes a path by removing traversal patterns
 */
export declare function sanitizePath(input: string): string;
export declare class InputValidator {
    /**
     * Validates input against a schema
     */
    static validate<T>(schema: z.ZodSchema<T>, input: unknown): T;
    /**
     * Safely validates input, returning result
     */
    static safeParse<T>(schema: z.ZodSchema<T>, input: unknown): z.SafeParseReturnType<unknown, T>;
    /**
     * Validates email
     */
    static validateEmail(email: string): string;
    /**
     * Validates password
     */
    static validatePassword(password: string): string;
    /**
     * Validates identifier
     */
    static validateIdentifier(id: string): string;
    /**
     * Validates path
     */
    static validatePath(path: string): string;
    /**
     * Validates command argument
     */
    static validateCommandArg(arg: string): string;
    /**
     * Validates login request
     */
    static validateLoginRequest(data: unknown): z.infer<typeof LoginRequestSchema>;
    /**
     * Validates user creation request
     */
    static validateCreateUser(data: unknown): z.infer<typeof CreateUserSchema>;
    /**
     * Validates task input
     */
    static validateTaskInput(data: unknown): z.infer<typeof TaskInputSchema>;
}
export { z, PATTERNS, LIMITS, };
//# sourceMappingURL=input-validator.d.ts.map