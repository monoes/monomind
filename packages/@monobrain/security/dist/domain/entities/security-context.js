/**
 * Security Context Entity - Domain Layer
 *
 * Represents security context for operations with validation and policy enforcement.
 *
 * @module v1/security/domain/entities
 */
import { randomUUID } from 'crypto';
/**
 * Security Context - Entity
 */
export class SecurityContext {
    _id;
    _principalId;
    _principalType;
    _permissions;
    _allowedPaths;
    _blockedPaths;
    _allowedCommands;
    _blockedCommands;
    _metadata;
    _expiresAt;
    _createdAt;
    constructor(props) {
        this._id = props.id ?? randomUUID();
        this._principalId = props.principalId;
        this._principalType = props.principalType;
        this._permissions = new Set(props.permissions);
        this._allowedPaths = new Set(props.allowedPaths ?? []);
        this._blockedPaths = new Set(props.blockedPaths ?? []);
        this._allowedCommands = new Set(props.allowedCommands ?? []);
        this._blockedCommands = new Set(props.blockedCommands ?? []);
        this._metadata = props.metadata ?? {};
        this._expiresAt = props.expiresAt;
        this._createdAt = props.createdAt ?? new Date();
    }
    static create(props) {
        return new SecurityContext(props);
    }
    static fromPersistence(props) {
        return new SecurityContext(props);
    }
    get id() { return this._id; }
    get principalId() { return this._principalId; }
    get principalType() { return this._principalType; }
    get permissions() { return Array.from(this._permissions); }
    get allowedPaths() { return Array.from(this._allowedPaths); }
    get blockedPaths() { return Array.from(this._blockedPaths); }
    get allowedCommands() { return Array.from(this._allowedCommands); }
    get blockedCommands() { return Array.from(this._blockedCommands); }
    get metadata() { return { ...this._metadata }; }
    get expiresAt() { return this._expiresAt; }
    get createdAt() { return new Date(this._createdAt); }
    // Business Logic
    hasPermission(level) {
        return this._permissions.has(level) || this._permissions.has('admin');
    }
    isExpired() {
        if (!this._expiresAt)
            return false;
        return Date.now() > this._expiresAt.getTime();
    }
    canAccessPath(path) {
        if (this.isExpired())
            return false;
        // Check blocked paths first
        for (const blocked of this._blockedPaths) {
            if (path.startsWith(blocked) || this.matchGlob(path, blocked)) {
                return false;
            }
        }
        // If no allowed paths specified, allow all non-blocked
        if (this._allowedPaths.size === 0)
            return true;
        // Check allowed paths
        for (const allowed of this._allowedPaths) {
            if (path.startsWith(allowed) || this.matchGlob(path, allowed)) {
                return true;
            }
        }
        return false;
    }
    canExecuteCommand(command) {
        if (this.isExpired())
            return false;
        const cmdBase = command.split(' ')[0];
        // Check blocked commands first
        if (this._blockedCommands.has(cmdBase) || this._blockedCommands.has(command)) {
            return false;
        }
        // If no allowed commands specified, allow all non-blocked
        if (this._allowedCommands.size === 0)
            return true;
        // Check allowed commands
        return this._allowedCommands.has(cmdBase) || this._allowedCommands.has(command);
    }
    matchGlob(path, pattern) {
        const regex = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');
        return new RegExp(`^${regex}$`).test(path);
    }
    grantPermission(level) {
        this._permissions.add(level);
    }
    revokePermission(level) {
        this._permissions.delete(level);
    }
    addAllowedPath(path) {
        this._allowedPaths.add(path);
    }
    addBlockedPath(path) {
        this._blockedPaths.add(path);
    }
    toPersistence() {
        return {
            id: this._id,
            principalId: this._principalId,
            principalType: this._principalType,
            permissions: Array.from(this._permissions),
            allowedPaths: Array.from(this._allowedPaths),
            blockedPaths: Array.from(this._blockedPaths),
            allowedCommands: Array.from(this._allowedCommands),
            blockedCommands: Array.from(this._blockedCommands),
            metadata: this._metadata,
            expiresAt: this._expiresAt?.toISOString(),
            createdAt: this._createdAt.toISOString(),
        };
    }
}
//# sourceMappingURL=security-context.js.map