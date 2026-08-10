import { describe, it, expect, vi } from 'vitest';
import { timingSafeCompare, validateCredential, authMiddleware } from '../src/auth.js';
import type { AuthConfig } from '../src/types.js';

describe('timingSafeCompare', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeCompare('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeCompare('abc123', 'xyz789')).toBe(false);
  });

  it('returns false for different strings of different lengths', () => {
    expect(timingSafeCompare('short', 'muchlongerstring')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });
});

describe('validateCredential', () => {
  const tokenConfig: AuthConfig = {
    enabled: true,
    method: 'token',
    tokens: ['tok-aaa', 'tok-bbb'],
  };

  const apiKeyConfig: AuthConfig = {
    enabled: true,
    method: 'api-key',
    apiKeys: ['key-111', 'key-222'],
  };

  it('passes when auth is disabled', () => {
    const r = validateCredential({ enabled: false, method: 'token' }, undefined, undefined);
    expect(r.valid).toBe(true);
  });

  it('passes when method is none', () => {
    const r = validateCredential({ enabled: true, method: 'none' }, undefined, undefined);
    expect(r.valid).toBe(true);
  });

  it('rejects when Authorization header is missing (token method)', () => {
    const r = validateCredential(tokenConfig, undefined, undefined);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Authorization header required/);
  });

  it('rejects a malformed Authorization header', () => {
    const r = validateCredential(tokenConfig, 'Basic dXNlcjpwYXNz', undefined);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid authorization format/);
  });

  it('accepts a valid Bearer token', () => {
    const r = validateCredential(tokenConfig, 'Bearer tok-aaa', undefined);
    expect(r.valid).toBe(true);
    expect(r.authInfo).toEqual({ method: 'token', credentialIndex: 0 });
  });

  it('accepts the second configured token', () => {
    const r = validateCredential(tokenConfig, 'Bearer tok-bbb', undefined);
    expect(r.valid).toBe(true);
    expect(r.authInfo).toEqual({ method: 'token', credentialIndex: 1 });
  });

  it('rejects an invalid Bearer token', () => {
    const r = validateCredential(tokenConfig, 'Bearer tok-bad', undefined);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid token/);
  });

  it('rejects when token list is empty', () => {
    const r = validateCredential(
      { enabled: true, method: 'token', tokens: [] },
      'Bearer anything',
      undefined,
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/No tokens configured/);
  });

  it('accepts an API key via X-API-Key header', () => {
    const r = validateCredential(apiKeyConfig, undefined, 'key-222');
    expect(r.valid).toBe(true);
    expect(r.authInfo).toEqual({ method: 'api-key', credentialIndex: 1 });
  });

  it('accepts an API key via Bearer header (api-key method)', () => {
    const r = validateCredential(apiKeyConfig, 'Bearer key-111', undefined);
    expect(r.valid).toBe(true);
    expect(r.authInfo).toEqual({ method: 'api-key', credentialIndex: 0 });
  });

  it('rejects when no API key credential is provided', () => {
    const r = validateCredential(apiKeyConfig, undefined, undefined);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/API key required/);
  });

  it('rejects when apiKeys list is empty', () => {
    const r = validateCredential(
      { enabled: true, method: 'api-key', apiKeys: [] },
      undefined,
      'key-any',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/No.*API keys configured/);
  });

  it('rejects oauth method with explanation', () => {
    const r = validateCredential(
      { enabled: true, method: 'oauth' },
      'Bearer something',
      undefined,
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/OAuth inbound validation not implemented/);
  });
});

describe('authMiddleware', () => {
  const config: AuthConfig = {
    enabled: true,
    method: 'token',
    tokens: ['secret-tok'],
  };

  function mockReqRes(authorization?: string) {
    const req: any = { headers: { authorization } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    return { req, res, next };
  }

  it('calls next and sets authInfo on valid auth', () => {
    const mw = authMiddleware(config);
    const { req, res, next } = mockReqRes('Bearer secret-tok');
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.authInfo).toEqual({ method: 'token', credentialIndex: 0 });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 JSON-RPC error on invalid auth', () => {
    const mw = authMiddleware(config);
    const { req, res, next } = mockReqRes('Bearer wrong');
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: '2.0',
        error: expect.objectContaining({ code: -32001 }),
      }),
    );
  });

  it('returns 401 when no Authorization header is sent', () => {
    const mw = authMiddleware(config);
    const { req, res, next } = mockReqRes(undefined);
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
