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
export declare const PasswordSchema: z.ZodString;
/**
 * UUID schema
 */
export declare const UUIDSchema: z.ZodString;
/**
 * URL schema with HTTPS enforcement
 */
export declare const HttpsUrlSchema: z.ZodString;
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
export declare const IPv4Schema: any;
/**
 * IP address schema (v4 or v6)
 */
export declare const IPSchema: any;
/**
 * User role schema
 */
export declare const UserRoleSchema: z.ZodEnum<{
    admin: "admin";
    operator: "operator";
    developer: "developer";
    viewer: "viewer";
    service: "service";
}>;
/**
 * Permission schema
 */
export declare const PermissionSchema: z.ZodEnum<{
    "swarm.create": "swarm.create";
    "swarm.read": "swarm.read";
    "swarm.update": "swarm.update";
    "swarm.delete": "swarm.delete";
    "swarm.scale": "swarm.scale";
    "agent.spawn": "agent.spawn";
    "agent.read": "agent.read";
    "agent.terminate": "agent.terminate";
    "task.create": "task.create";
    "task.read": "task.read";
    "task.cancel": "task.cancel";
    "metrics.read": "metrics.read";
    "system.admin": "system.admin";
    "api.access": "api.access";
}>;
/**
 * Login request schema
 */
export declare const LoginRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    mfaCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * User creation schema
 */
export declare const CreateUserSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        operator: "operator";
        developer: "developer";
        viewer: "viewer";
        service: "service";
    }>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "swarm.create": "swarm.create";
        "swarm.read": "swarm.read";
        "swarm.update": "swarm.update";
        "swarm.delete": "swarm.delete";
        "swarm.scale": "swarm.scale";
        "agent.spawn": "agent.spawn";
        "agent.read": "agent.read";
        "agent.terminate": "agent.terminate";
        "task.create": "task.create";
        "task.read": "task.read";
        "task.cancel": "task.cancel";
        "metrics.read": "metrics.read";
        "system.admin": "system.admin";
        "api.access": "api.access";
    }>>>;
    isActive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
/**
 * API key creation schema
 */
export declare const CreateApiKeySchema: z.ZodObject<{
    name: z.ZodString;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "swarm.create": "swarm.create";
        "swarm.read": "swarm.read";
        "swarm.update": "swarm.update";
        "swarm.delete": "swarm.delete";
        "swarm.scale": "swarm.scale";
        "agent.spawn": "agent.spawn";
        "agent.read": "agent.read";
        "agent.terminate": "agent.terminate";
        "task.create": "task.create";
        "task.read": "task.read";
        "task.cancel": "task.cancel";
        "metrics.read": "metrics.read";
        "system.admin": "system.admin";
        "api.access": "api.access";
    }>>>;
    expiresAt: z.ZodOptional<z.ZodDate>;
}, z.core.$strip>;
/**
 * Agent type schema
 */
export declare const AgentTypeSchema: z.ZodEnum<{
    coder: "coder";
    reviewer: "reviewer";
    tester: "tester";
    planner: "planner";
    researcher: "researcher";
    "security-architect": "security-architect";
    "security-auditor": "security-auditor";
    "memory-specialist": "memory-specialist";
    "swarm-specialist": "swarm-specialist";
    "integration-architect": "integration-architect";
    "performance-engineer": "performance-engineer";
    "core-architect": "core-architect";
    "test-architect": "test-architect";
    "queen-coordinator": "queen-coordinator";
    "project-coordinator": "project-coordinator";
}>;
/**
 * Agent spawn request schema
 */
export declare const SpawnAgentSchema: z.ZodObject<{
    type: z.ZodEnum<{
        coder: "coder";
        reviewer: "reviewer";
        tester: "tester";
        planner: "planner";
        researcher: "researcher";
        "security-architect": "security-architect";
        "security-auditor": "security-auditor";
        "memory-specialist": "memory-specialist";
        "swarm-specialist": "swarm-specialist";
        "integration-architect": "integration-architect";
        "performance-engineer": "performance-engineer";
        "core-architect": "core-architect";
        "test-architect": "test-architect";
        "queen-coordinator": "queen-coordinator";
        "project-coordinator": "project-coordinator";
    }>;
    id: z.ZodOptional<z.ZodString>;
    config: z.ZodOptional<z.ZodRecord<z.core.$ZodRecordKey, z.core.SomeType>>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/**
 * Task input schema
 */
export declare const TaskInputSchema: z.ZodObject<{
    taskId: z.ZodString;
    content: z.ZodString;
    agentType: z.ZodEnum<{
        coder: "coder";
        reviewer: "reviewer";
        tester: "tester";
        planner: "planner";
        researcher: "researcher";
        "security-architect": "security-architect";
        "security-auditor": "security-auditor";
        "memory-specialist": "memory-specialist";
        "swarm-specialist": "swarm-specialist";
        "integration-architect": "integration-architect";
        "performance-engineer": "performance-engineer";
        "core-architect": "core-architect";
        "test-architect": "test-architect";
        "queen-coordinator": "queen-coordinator";
        "project-coordinator": "project-coordinator";
    }>;
    priority: z.ZodOptional<z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>>;
    metadata: z.ZodOptional<z.ZodRecord<z.core.$ZodRecordKey, z.core.SomeType>>;
}, z.core.$strip>;
/**
 * Command argument schema
 */
export declare const CommandArgumentSchema: z.ZodString;
/**
 * Path schema
 */
export declare const PathSchema: z.ZodString;
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
}, z.core.$strip>;
/**
 * Executor configuration schema
 */
export declare const ExecutorConfigSchema: z.ZodObject<{
    allowedCommands: z.ZodArray<z.ZodString>;
    blockedPatterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    timeout: z.ZodDefault<z.ZodNumber>;
    maxBuffer: z.ZodDefault<z.ZodNumber>;
    cwd: z.ZodOptional<z.ZodString>;
    allowSudo: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
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
/**
 * Validates content sourced externally (tool results, web pages, user-provided files)
 * for potential prompt injection attempts.
 *
 * Applies structural pattern matching; for semantic analysis use aidefence_is_safe.
 */
export declare function validateExternalContent(content: string, source?: string): Promise<{
    safe: boolean;
    reason?: string;
}>;
export { z, PATTERNS, LIMITS, };
//# sourceMappingURL=input-validator.d.ts.map