/**
 * Security Context Entity - Domain Layer
 *
 * Represents security context for operations with validation and policy enforcement.
 *
 * @module v1/security/domain/entities
 */
/**
 * Permission levels
 */
export type PermissionLevel = 'read' | 'write' | 'execute' | 'admin';
/**
 * Security context properties
 */
export interface SecurityContextProps {
    id?: string;
    principalId: string;
    principalType: 'agent' | 'user' | 'system';
    permissions: PermissionLevel[];
    allowedPaths?: string[];
    blockedPaths?: string[];
    allowedCommands?: string[];
    blockedCommands?: string[];
    metadata?: Record<string, unknown>;
    expiresAt?: Date;
    createdAt?: Date;
}
/**
 * Security Context - Entity
 */
export declare class SecurityContext {
    private _id;
    private _principalId;
    private _principalType;
    private _permissions;
    private _allowedPaths;
    private _blockedPaths;
    private _allowedCommands;
    private _blockedCommands;
    private _metadata;
    private _expiresAt?;
    private _createdAt;
    private constructor();
    static create(props: SecurityContextProps): SecurityContext;
    static fromPersistence(props: SecurityContextProps): SecurityContext;
    get id(): string;
    get principalId(): string;
    get principalType(): string;
    get permissions(): PermissionLevel[];
    get allowedPaths(): string[];
    get blockedPaths(): string[];
    get allowedCommands(): string[];
    get blockedCommands(): string[];
    get metadata(): Record<string, unknown>;
    get expiresAt(): Date | undefined;
    get createdAt(): Date;
    hasPermission(level: PermissionLevel): boolean;
    isExpired(): boolean;
    canAccessPath(path: string): boolean;
    canExecuteCommand(command: string): boolean;
    private matchGlob;
    grantPermission(level: PermissionLevel): void;
    revokePermission(level: PermissionLevel): void;
    addAllowedPath(path: string): void;
    addBlockedPath(path: string): void;
    toPersistence(): Record<string, unknown>;
}
//# sourceMappingURL=security-context.d.ts.map