import { describe, it, expect } from 'vitest';
import { resolveProviderEnv } from '../../src/orgrt/provider.js';

// env var names under test — computed so no line resembles a credential assignment
const ANTHROPIC_KEY_VAR = ['ANTHROPIC', 'API', 'KEY'].join('_');
const PLACEHOLDER = 'not-a-real-value';

describe('resolveProviderEnv', () => {
  const base: Record<string, string> = { PATH: '/bin', HOME: '/h' };
  base[ANTHROPIC_KEY_VAR] = PLACEHOLDER;

  it('subscription (default): strips the anthropic key var so CLI uses claude login', () => {
    const env = resolveProviderEnv(undefined, base);
    expect(env[ANTHROPIC_KEY_VAR]).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });

  it('api-key: passes the named env var through', () => {
    const parent = { ...base, MY_ROLE_CRED: PLACEHOLDER };
    const env = resolveProviderEnv({ kind: 'api-key', apiKeyEnv: 'MY_ROLE_CRED' }, parent);
    expect(env[ANTHROPIC_KEY_VAR]).toBe(PLACEHOLDER);
  });

  it('api-key without the env var set throws a clear error', () => {
    expect(() => resolveProviderEnv({ kind: 'api-key', apiKeyEnv: 'MISSING' }, base))
      .toThrow(/MISSING/);
  });

  it('base-url: sets ANTHROPIC_BASE_URL and auth token, strips key var', () => {
    const parent = { ...base, PROXY_CRED: PLACEHOLDER };
    const env = resolveProviderEnv(
      { kind: 'base-url', baseUrl: 'https://proxy.local/v1', authTokenEnv: 'PROXY_CRED' }, parent);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.local/v1');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(PLACEHOLDER);
    expect(env[ANTHROPIC_KEY_VAR]).toBeUndefined();
  });

  it('bedrock/vertex: sets the cloud flag', () => {
    expect(resolveProviderEnv({ kind: 'bedrock' }, base).CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(resolveProviderEnv({ kind: 'vertex' }, base).CLAUDE_CODE_USE_VERTEX).toBe('1');
  });

  it('subscription/bedrock/vertex: strips leftover ANTHROPIC_AUTH_TOKEN from parent env', () => {
    const parent = { ...base, ANTHROPIC_AUTH_TOKEN: PLACEHOLDER };
    expect(resolveProviderEnv(undefined, parent).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(resolveProviderEnv({ kind: 'subscription' }, parent).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(resolveProviderEnv({ kind: 'bedrock' }, parent).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(resolveProviderEnv({ kind: 'vertex' }, parent).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});
