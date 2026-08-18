// packages/@monomind/cli/__tests__/orgrt/resolve-runner-usage-proxy.test.ts
//
// Regression test for #177: UsageProxyServer was fully built and
// CrushAgentRunner already accepted a `usageProxy` constructor option, but
// nothing in resolveRunner/resolveRoleRunner ever threaded a role's config
// through to it — the feature was dead code. Fixed by adding
// `provider.usageProxy` / `provider.usageProxyEnvVar` to ProviderSchema and
// forwarding them from resolveRoleRunner -> resolveRunner -> CrushAgentRunner.
import { describe, it, expect, vi } from 'vitest';

const crushCtor = vi.fn();
vi.mock('../../src/orgrt/crush-runner.js', () => ({
  CrushAgentRunner: class {
    constructor(opts: unknown) {
      crushCtor(opts);
    }
  },
}));

import { resolveRunner, resolveRoleRunner } from '../../src/orgrt/daemon.js';
import type { ProviderConfig } from '../../src/orgrt/types.js';

describe('resolveRunner — crush usage-proxy wiring (#177)', () => {
  it('constructs CrushAgentRunner with no usageProxy option when provider is absent', () => {
    crushCtor.mockClear();
    resolveRunner('crush');
    expect(crushCtor).toHaveBeenCalledWith(undefined);
  });

  it('constructs CrushAgentRunner with no usageProxy option when provider.usageProxy is not set', () => {
    crushCtor.mockClear();
    const provider = { kind: 'subscription', baseUrl: 'https://api.example.com/v1' } as ProviderConfig;
    resolveRunner('crush', undefined, provider);
    expect(crushCtor).toHaveBeenCalledWith(undefined);
  });

  it('constructs CrushAgentRunner with no usageProxy option when usageProxy is true but baseUrl is missing', () => {
    crushCtor.mockClear();
    const provider = { kind: 'subscription', usageProxy: true } as ProviderConfig;
    resolveRunner('crush', undefined, provider);
    expect(crushCtor).toHaveBeenCalledWith(undefined);
  });

  it('threads provider.baseUrl into CrushAgentRunner.usageProxy.upstreamBaseUrl when usageProxy=true', () => {
    crushCtor.mockClear();
    const provider = {
      kind: 'subscription',
      usageProxy: true,
      baseUrl: 'https://api.example.com/v1',
    } as ProviderConfig;
    resolveRunner('crush', undefined, provider);
    expect(crushCtor).toHaveBeenCalledWith({
      usageProxy: { upstreamBaseUrl: 'https://api.example.com/v1', baseUrlEnvVar: undefined },
    });
  });

  it('threads a custom usageProxyEnvVar through as baseUrlEnvVar', () => {
    crushCtor.mockClear();
    const provider = {
      kind: 'subscription',
      usageProxy: true,
      baseUrl: 'https://api.example.com/v1',
      usageProxyEnvVar: 'CRUSH_BASE_URL',
    } as ProviderConfig;
    resolveRunner('crush', undefined, provider);
    expect(crushCtor).toHaveBeenCalledWith({
      usageProxy: { upstreamBaseUrl: 'https://api.example.com/v1', baseUrlEnvVar: 'CRUSH_BASE_URL' },
    });
  });

  it('resolveRoleRunner forwards the role provider through to resolveRunner for an explicit role runtime', () => {
    crushCtor.mockClear();
    const roleProvider = {
      kind: 'subscription',
      usageProxy: true,
      baseUrl: 'https://role.example.com/v1',
    } as ProviderConfig;
    resolveRoleRunner('crush', undefined, undefined, undefined, roleProvider);
    expect(crushCtor).toHaveBeenCalledWith({
      usageProxy: { upstreamBaseUrl: 'https://role.example.com/v1', baseUrlEnvVar: undefined },
    });
  });

  it('resolveRoleRunner forwards the role provider through to resolveRunner when runtime is inherited from org', () => {
    crushCtor.mockClear();
    const roleProvider = {
      kind: 'subscription',
      usageProxy: true,
      baseUrl: 'https://org-inherited.example.com/v1',
    } as ProviderConfig;
    resolveRoleRunner(undefined, 'crush', undefined, undefined, roleProvider);
    expect(crushCtor).toHaveBeenCalledWith({
      usageProxy: { upstreamBaseUrl: 'https://org-inherited.example.com/v1', baseUrlEnvVar: undefined },
    });
  });
});
