/**
 * @monobrain/mcp - OAuth 2.1 Authentication
 *
 * MCP 2025-11-25 compliant OAuth 2.1 with PKCE
 */
import { EventEmitter } from 'events';
import type { ILogger } from './types.js';
/**
 * OAuth 2.1 configuration
 */
export interface OAuthConfig {
    /** Client ID */
    clientId: string;
    /** Client secret (for confidential clients) */
    clientSecret?: string;
    /** Authorization endpoint */
    authorizationEndpoint: string;
    /** Token endpoint */
    tokenEndpoint: string;
    /** Redirect URI */
    redirectUri: string;
    /** Scopes to request */
    scopes?: string[];
    /** Token storage adapter */
    tokenStorage?: TokenStorage;
    /** Enable PKCE (default: true) */
    usePKCE?: boolean;
    /** State parameter generator */
    stateGenerator?: () => string;
}
/**
 * OAuth tokens
 */
export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn?: number;
    expiresAt?: number;
    scope?: string;
}
/**
 * Token storage interface
 */
export interface TokenStorage {
    save(key: string, tokens: OAuthTokens): Promise<void>;
    load(key: string): Promise<OAuthTokens | null>;
    delete(key: string): Promise<void>;
}
/**
 * Authorization request
 */
export interface AuthorizationRequest {
    url: string;
    state: string;
    codeVerifier?: string;
}
/**
 * In-memory token storage (for development)
 */
export declare class InMemoryTokenStorage implements TokenStorage {
    private tokens;
    save(key: string, tokens: OAuthTokens): Promise<void>;
    load(key: string): Promise<OAuthTokens | null>;
    delete(key: string): Promise<void>;
}
/**
 * OAuth 2.1 Manager
 */
export declare class OAuthManager extends EventEmitter {
    private readonly logger;
    private readonly config;
    private readonly tokenStorage;
    private pendingRequests;
    private cleanupTimer?;
    constructor(logger: ILogger, config: OAuthConfig);
    /**
     * Generate authorization URL for OAuth flow
     */
    createAuthorizationRequest(): AuthorizationRequest;
    /**
     * Exchange authorization code for tokens
     */
    exchangeCode(code: string, state: string): Promise<OAuthTokens>;
    /**
     * Refresh access token using refresh token
     */
    refreshTokens(storageKey?: string): Promise<OAuthTokens>;
    /**
     * Get valid access token (auto-refresh if expired)
     */
    getAccessToken(storageKey?: string): Promise<string | null>;
    /**
     * Revoke tokens
     */
    revokeTokens(storageKey?: string): Promise<void>;
    /**
     * Check if authenticated
     */
    isAuthenticated(storageKey?: string): Promise<boolean>;
    /**
     * Destroy manager and cleanup
     */
    destroy(): void;
    /**
     * Parse token response
     */
    private parseTokenResponse;
    /**
     * Generate PKCE code verifier
     */
    private generateCodeVerifier;
    /**
     * Generate PKCE code challenge (S256)
     */
    private generateCodeChallenge;
    /**
     * Generate random string
     */
    private generateRandomString;
    /**
     * Base64 URL encode
     */
    private base64UrlEncode;
    /**
     * Start cleanup of expired pending requests
     */
    private startCleanup;
}
/**
 * Create OAuth manager
 */
export declare function createOAuthManager(logger: ILogger, config: OAuthConfig): OAuthManager;
/**
 * OAuth middleware for Express/Connect
 */
export declare function oauthMiddleware(oauthManager: OAuthManager, storageKey?: string): (req: any, res: any, next: () => void) => Promise<void>;
/**
 * Create GitHub OAuth provider config
 */
export declare function createGitHubOAuthConfig(clientId: string, clientSecret: string, redirectUri: string, scopes?: string[]): OAuthConfig;
/**
 * Create Google OAuth provider config
 */
export declare function createGoogleOAuthConfig(clientId: string, clientSecret: string, redirectUri: string, scopes?: string[]): OAuthConfig;
//# sourceMappingURL=oauth.d.ts.map