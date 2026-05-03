// Offline + online license lifecycle: activate trial, refresh, status, verify JWT.

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

export class LicenseError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

const WARNING_WINDOW_DAYS = 14;
const FREE_FEATURES: LicenseFeatures = { cloudCoverage: false, mcp: false, customRules: false, ssoSaml: false };

/** Parse a JWT payload without signature verification (use verifyLicenseJwt for full check). */
export function parseLicenseJwt(jwt: string): LicenseJwtPayload {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new LicenseError('Malformed JWT', 'MALFORMED_JWT');
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload as LicenseJwtPayload;
  } catch {
    throw new LicenseError('Failed to decode JWT payload', 'DECODE_ERROR');
  }
}

/** Derive LicenseStatus from a parsed JWT payload. */
export function licenseStatusFromPayload(payload: LicenseJwtPayload): LicenseStatus {
  const expiresAt = new Date(payload.exp * 1000);
  const now = Date.now();
  const daysRemaining = Math.ceil((expiresAt.getTime() - now) / 86_400_000);
  const isExpired = daysRemaining <= 0;
  const isInWarningWindow = !isExpired && daysRemaining <= WARNING_WINDOW_DAYS;
  const featureSet = new Set(payload.features ?? []);
  return {
    tier: payload.tier,
    seats: payload.seats ?? 1,
    features: {
      cloudCoverage: featureSet.has('cloud_coverage'),
      mcp: featureSet.has('mcp'),
      customRules: featureSet.has('custom_rules'),
      ssoSaml: featureSet.has('sso_saml'),
    },
    expiresAt,
    daysRemaining: Math.max(daysRemaining, 0),
    isExpired,
    isInWarningWindow,
    isWatermarked: isExpired || payload.tier === 'free',
  };
}

/** Activate a trial license via the cloud API. */
export async function activateTrial(opts: ActivateOptions): Promise<string> {
  const base = opts.apiBase ?? 'https://api.fallow.cloud/v1';
  const res = await fetch(`${base}/license/trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: opts.email }),
  });
  if (!res.ok) throw new LicenseError(`Activation failed: HTTP ${res.status}`, 'ACTIVATION_FAILED');
  const data = await res.json() as { jwt: string };
  return data.jwt;
}

/** Refresh an existing license JWT. */
export async function refreshLicense(jwt: string, opts: Pick<ActivateOptions, 'apiBase'>): Promise<string> {
  const base = opts.apiBase ?? 'https://api.fallow.cloud/v1';
  const res = await fetch(`${base}/license/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new LicenseError(`Refresh failed: HTTP ${res.status}`, 'REFRESH_FAILED');
  const data = await res.json() as { jwt: string };
  return data.jwt;
}

/** Get the free-tier license status (no JWT required). */
export function getFreeLicenseStatus(): LicenseStatus {
  return {
    tier: 'free',
    seats: 1,
    features: FREE_FEATURES,
    isExpired: false,
    isInWarningWindow: false,
    isWatermarked: false,
  };
}
