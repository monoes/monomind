/**
 * Per-Agent Runtime Sandboxing Tests
 *
 * Tests for WasmSandbox, DockerSandbox, SandboxProvisioner, and SandboxRegistry.
 * Docker tests use mocks; WasmSandbox tests use the real Node vm module.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import * as WasmSandbox from '../../packages/@monomind/security/src/sandbox/wasm-sandbox.js';
import * as DockerSandbox from '../../packages/@monomind/security/src/sandbox/docker-sandbox.js';
import * as SandboxRegistry from '../../packages/@monomind/security/src/sandbox/sandbox-registry.js';
import { provision } from '../../packages/@monomind/security/src/sandbox/sandbox-provisioner.js';
import { validateSandboxConfig } from '../../packages/@monomind/security/src/sandbox/types.js';
import type { SandboxConfig } from '../../packages/@monomind/security/src/sandbox/types.js';

// ---------------------------------------------------------------------------
// WasmSandbox
// ---------------------------------------------------------------------------
describe('WasmSandbox', () => {
  it('executes simple JS and captures stdout', async () => {
    const sandbox = WasmSandbox.create('agent-1', { type: 'wasm' });
    const result = await sandbox.execute('console.log("hello world")');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
    expect(result.timedOut).toBe(false);
  });

  it('captures errors in stderr', async () => {
    const sandbox = WasmSandbox.create('agent-2', { type: 'wasm' });
    const result = await sandbox.execute('throw new Error("boom")');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('boom');
    expect(result.timedOut).toBe(false);
  });

  it('times out long-running scripts', async () => {
    const sandbox = WasmSandbox.create('agent-3', { type: 'wasm' });
    const result = await sandbox.execute('while(true) {}', 50);
    expect(result.code).toBe(124);
    expect(result.timedOut).toBe(true);
  });

  it('prevents access to require (sandboxed)', async () => {
    const sandbox = WasmSandbox.create('agent-4', { type: 'wasm' });
    const result = await sandbox.execute('const fs = require("fs")');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('require is not');
  });

  it('prevents access to process.exit', async () => {
    const sandbox = WasmSandbox.create('agent-5', { type: 'wasm' });
    const result = await sandbox.execute('process.exit(1)');
    expect(result.code).toBe(1);
    // process is undefined in sandbox, so accessing .exit throws
    expect(result.stderr).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SandboxRegistry
// ---------------------------------------------------------------------------
describe('SandboxRegistry', () => {
  afterEach(async () => {
    await SandboxRegistry.cleanupAll();
  });

  it('registers and retrieves runtime', () => {
    const runtime = WasmSandbox.create('reg-1', { type: 'wasm' });
    SandboxRegistry.register('reg-1', runtime);
    expect(SandboxRegistry.get('reg-1')).toBe(runtime);
  });

  it('cleanup calls destroy and removes entry', async () => {
    const destroyFn = vi.fn().mockResolvedValue(undefined);
    const runtime = WasmSandbox.create('reg-2', { type: 'wasm' });
    runtime.destroy = destroyFn;
    SandboxRegistry.register('reg-2', runtime);

    await SandboxRegistry.cleanup('reg-2');

    expect(destroyFn).toHaveBeenCalled();
    expect(SandboxRegistry.get('reg-2')).toBeUndefined();
  });

  it('listActive returns all registered', () => {
    const r1 = WasmSandbox.create('reg-a', { type: 'wasm' });
    const r2 = WasmSandbox.create('reg-b', { type: 'wasm' });
    SandboxRegistry.register('reg-a', r1);
    SandboxRegistry.register('reg-b', r2);

    const active = SandboxRegistry.listActive();
    expect(active).toContain('reg-a');
    expect(active).toContain('reg-b');
    expect(active).toHaveLength(2);
  });

  it('cleanupAll cleans all', async () => {
    const d1 = vi.fn().mockResolvedValue(undefined);
    const d2 = vi.fn().mockResolvedValue(undefined);

    const r1 = WasmSandbox.create('all-1', { type: 'wasm' });
    r1.destroy = d1;
    const r2 = WasmSandbox.create('all-2', { type: 'wasm' });
    r2.destroy = d2;

    SandboxRegistry.register('all-1', r1);
    SandboxRegistry.register('all-2', r2);

    await SandboxRegistry.cleanupAll();

    expect(d1).toHaveBeenCalled();
    expect(d2).toHaveBeenCalled();
    expect(SandboxRegistry.listActive()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SandboxProvisioner
// ---------------------------------------------------------------------------
describe('SandboxProvisioner', () => {
  it('returns WasmSandbox for type=wasm', () => {
    const runtime = provision('prov-1', { type: 'wasm' });
    expect(runtime.type).toBe('wasm');
    expect(runtime.agentId).toBe('prov-1');
  });

  it('returns passthrough for type=none', async () => {
    const runtime = provision('prov-2', { type: 'none' });
    expect(runtime.type).toBe('none');
    const result = await runtime.execute('echo hi');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('passthrough');
  });
});

// ---------------------------------------------------------------------------
// DockerSandbox
// ---------------------------------------------------------------------------
describe('DockerSandbox', () => {
  describe('buildDockerArgs', () => {
    it('generates correct flags', () => {
      const config: SandboxConfig = {
        type: 'docker',
        cpu_limit: '0.5',
        memory_limit: '256m',
        network: 'bridge',
        env_vars: { NODE_ENV: 'production' },
        allowed_paths: ['/tmp/work'],
        auto_cleanup: true,
      };

      const args = DockerSandbox.buildDockerArgs('dock-1', config);

      expect(args).toContain('--cpus');
      expect(args).toContain('0.5');
      expect(args).toContain('--memory');
      expect(args).toContain('256m');
      expect(args).toContain('--network');
      expect(args).toContain('bridge');
      expect(args).toContain('--rm');
      expect(args.join(' ')).toContain('NODE_ENV=production');
      expect(args.join(' ')).toContain('/tmp/work:/tmp/work:rw');
    });

    it('applies security options (--read-only, --no-new-privileges)', () => {
      const config: SandboxConfig = { type: 'docker' };
      const args = DockerSandbox.buildDockerArgs('dock-2', config);

      expect(args).toContain('--read-only');
      expect(args).toContain('--security-opt');
      expect(args).toContain('no-new-privileges');
    });
  });
});

// ---------------------------------------------------------------------------
// SandboxConfig validation
// ---------------------------------------------------------------------------
describe('SandboxConfig validation', () => {
  it('validates type field', () => {
    expect(validateSandboxConfig({ type: 'wasm' })).toBe(true);
    expect(validateSandboxConfig({ type: 'docker' })).toBe(true);
    expect(validateSandboxConfig({ type: 'none' })).toBe(true);
    expect(validateSandboxConfig({ type: 'invalid' as any })).toBe(false);
  });
});
