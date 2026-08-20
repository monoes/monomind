// packages/@monomind/cli/src/__tests__/orgrt-policy-glob-separator.test.ts
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../orgrt/policy.js';
import type { OrgBus } from '../orgrt/bus.js';

const fakeBus = { emit: () => {} } as unknown as OrgBus;

describe('PolicyEngine — fileWrite/fileRead globs use \'/\' separators regardless of host OS', () => {
  it('allows a Write inside a nested fileWrite scope (path.relative returns \'\\\\\'-joined paths on Windows)', async () => {
    const policy = new PolicyEngine('area-x', { fileWrite: ['app/src/areas/x/**'], fileRead: ['**'] }, fakeBus, process.cwd());
    const decision = await policy.decide('Write', { file_path: 'app/src/areas/x/server/index.ts', content: 'x' });
    expect(decision.behavior).toBe('allow');
  });

  it('denies a Write outside the scoped fileWrite glob', async () => {
    const policy = new PolicyEngine('area-x', { fileWrite: ['app/src/areas/x/**'], fileRead: ['**'] }, fakeBus, process.cwd());
    const decision = await policy.decide('Write', { file_path: 'app/src/areas/y/server/index.ts', content: 'x' });
    expect(decision.behavior).toBe('deny');
  });

  it('allows a Write matching a literal (non-wildcard) fileWrite entry, e.g. a root config file', async () => {
    const policy = new PolicyEngine('foundation', { fileWrite: ['app/package.json', 'app/tsconfig.json'], fileRead: ['**'] }, fakeBus, process.cwd());
    const pkg = await policy.decide('Write', { file_path: 'app/package.json', content: '{}' });
    const ts = await policy.decide('Write', { file_path: 'app/tsconfig.json', content: '{}' });
    expect(pkg.behavior).toBe('allow');
    expect(ts.behavior).toBe('allow');
  });
});
