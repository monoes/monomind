export type LicenseTier = 'free' | 'trial' | 'pro' | 'enterprise';
export interface LicenseFeatures {
    cloudCoverage: boolean;
    mcp: boolean;
    customRules: boolean;
    ssoSaml: boolean;
}
export interface LicenseStatus {
    tier: LicenseTier;
    seats: number;
    features: LicenseFeatures;
    expiresAt?: Date;
    daysRemaining?: number;
    isExpired: boolean;
    isInWarningWindow: boolean;
    isWatermarked: boolean;
}
export interface ActivateOptions {
    email: string;
    apiBase?: string;
    licenseStorePath?: string;
}
export interface LicenseJwtPayload {
    sub: string;
    tier: LicenseTier;
    seats: number;
    features: string[];
    exp: number;
    iat: number;
}
export declare class LicenseError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** Parse a JWT payload without signature verification (use verifyLicenseJwt for full check). */
export declare function parseLicenseJwt(jwt: string): LicenseJwtPayload;
/** Derive LicenseStatus from a parsed JWT payload. */
export declare function licenseStatusFromPayload(payload: LicenseJwtPayload): LicenseStatus;
/** Activate a trial license via the cloud API. */
export declare function activateTrial(opts: ActivateOptions): Promise<string>;
/** Refresh an existing license JWT. */
export declare function refreshLicense(jwt: string, opts: Pick<ActivateOptions, 'apiBase'>): Promise<string>;
/** Get the free-tier license status (no JWT required). */
export declare function getFreeLicenseStatus(): LicenseStatus;
//# sourceMappingURL=manager.d.ts.map