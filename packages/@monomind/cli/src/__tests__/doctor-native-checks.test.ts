import { beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => vi.fn());
vi.mock('../utils/native-binding.js', () => ({ probeMonographSqliteBinding: probe }));

const { checkNativeBindings } = await import('../commands/doctor-native-checks.js');

describe('checkNativeBindings', () => {
  beforeEach(() => probe.mockReset());

  it('passes and names the Node/ABI pair it verified against', async () => {
    probe.mockReturnValue({
      status: 'ok',
      module: 'better-sqlite3',
      nodeVersion: 'v26.5.0',
      runtimeAbi: '147',
      summary: 'ok',
    });
    const check = await checkNativeBindings();
    expect(check.status).toBe('pass');
    expect(check.message).toContain('v26.5.0');
    expect(check.message).toContain('147');
  });

  it('fails hard on an ABI mismatch and carries the exact fix command — doctor is where users look, and without a binding every graph feature is dead', async () => {
    probe.mockReturnValue({
      status: 'abi-mismatch',
      module: 'better-sqlite3',
      nodeVersion: 'v26.5.0',
      runtimeAbi: '147',
      builtForAbi: '141',
      binaryPath: '/g/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      summary: '`better-sqlite3` built for ABI 141 but this process is Node v26.5.0 (ABI 147)',
      fix: 'cd /g && npm rebuild better-sqlite3 --build-from-source',
    });
    const check = await checkNativeBindings();
    expect(check.status).toBe('fail');
    expect(check.message).toContain('ABI 141');
    expect(check.message).toContain('/g/node_modules/better-sqlite3');
    expect(check.fix).toBe('cd /g && npm rebuild better-sqlite3 --build-from-source');
  });

  it('reports a never-built binary as a failure too, not as "no graph yet"', async () => {
    probe.mockReturnValue({
      status: 'missing-binary',
      module: 'better-sqlite3',
      nodeVersion: 'v26.5.0',
      runtimeAbi: '147',
      summary: "`better-sqlite3`'s native binary was never built for this platform",
      fix: 'cd /g && npm rebuild better-sqlite3',
    });
    const check = await checkNativeBindings();
    expect(check.status).toBe('fail');
    expect(check.message).toContain('never built');
  });
});
