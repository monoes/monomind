import { timingSafeEqual } from 'crypto';
import type { AuthConfig } from './types.js';

export interface AuthInfo {
  method: 'token' | 'api-key';
  credentialIndex: number;
}

export interface AuthValidationResult {
  valid: boolean;
  error?: string;
  authInfo?: AuthInfo;
}

/**
 * SECURITY: Timing-safe token comparison to prevent timing attacks.
 * Mismatched lengths still run a constant-time compare (against itself)
 * before returning false, so length differences aren't observable via timing.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

function matchCredential(
  supplied: string,
  configured: string[] | undefined,
  method: 'token' | 'api-key',
): AuthValidationResult {
  if (!configured || configured.length === 0) {
    return { valid: false, error: `No ${method === 'token' ? 'tokens' : 'API keys'} configured for authentication` };
  }

  for (let i = 0; i < configured.length; i++) {
    if (timingSafeCompare(supplied, configured[i])) {
      return { valid: true, authInfo: { method, credentialIndex: i } };
    }
  }

  return { valid: false, error: method === 'token' ? 'Invalid token' : 'Invalid API key' };
}

export function validateCredential(
  authConfig: AuthConfig,
  authorizationHeader: string | undefined,
  apiKeyHeader: string | undefined,
): AuthValidationResult {
  if (!authConfig.enabled || authConfig.method === 'none') {
    return { valid: true };
  }

  if (authConfig.method === 'token') {
    if (!authorizationHeader) {
      return { valid: false, error: 'Authorization header required' };
    }
    const tokenMatch = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return { valid: false, error: 'Invalid authorization format' };
    }
    return matchCredential(tokenMatch[1], authConfig.tokens, 'token');
  }

  if (authConfig.method === 'api-key') {
    const bearerMatch = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
    const credential = bearerMatch?.[1] ?? apiKeyHeader;
    if (!credential) {
      return { valid: false, error: 'API key required (Authorization: Bearer <key> or X-API-Key header)' };
    }
    return matchCredential(credential, authConfig.apiKeys, 'api-key');
  }

  if (authConfig.method === 'oauth') {
    return { valid: false, error: 'OAuth inbound validation not implemented — use token or api-key method' };
  }

  return { valid: false, error: `Unsupported auth method: ${authConfig.method}` };
}

export function authMiddleware(authConfig: AuthConfig) {
  return (req: any, res: any, next: () => void) => {
    const result = validateCredential(
      authConfig,
      req.headers?.authorization,
      req.headers?.['x-api-key'],
    );

    if (!result.valid) {
      res.status(401).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: `Unauthorized - ${result.error}`,
        },
      });
      return;
    }

    req.authInfo = result.authInfo;
    next();
  };
}
