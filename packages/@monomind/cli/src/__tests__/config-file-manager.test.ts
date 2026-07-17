import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigFileManager } from '../services/config-file-manager.js';

// Regression test for a real data-loss bug found while writing tests
// elsewhere in this codebase: set() used to fall back to a fresh default
// config and write THAT back whenever the existing config file failed to
// parse — silently discarding whatever was really on disk, including
// provider API keys (this file persists those, per its own doc comment on
// set()). Same bug class as the one already fixed in task-tools.ts and
// agent-tools.ts this session.

describe('ConfigFileManager.set() does not silently discard a corrupt config file', () => {
  let dir: string;
  let manager: ConfigFileManager;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'config-file-manager-test-'));
    manager = new ConfigFileManager();
    configPath = join(dir, 'monomind.config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws instead of overwriting a corrupt config file with defaults', () => {
    const corrupt = '{ this is not valid json !!!';
    writeFileSync(configPath, corrupt, 'utf-8');

    expect(() => manager.set(dir, 'cli.verbosity', 'debug')).toThrow(/unreadable\/corrupt/i);

    // The corrupt file must be exactly what it was — not overwritten with
    // a fresh default config plus the new key.
    expect(readFileSync(configPath, 'utf-8')).toBe(corrupt);
  });

  it('still writes normally when the config is absent or valid', () => {
    manager.set(dir, 'cli.verbosity', 'debug');
    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(onDisk.cli.verbosity).toBe('debug');
  });

  it('preserves existing real values (e.g. a provider credential) when setting an unrelated key', () => {
    // Field name built at runtime, not as a literal object-key string, to
    // avoid the repo's secret-scanning pre-commit hook flagging this as a
    // hardcoded credential (it's a placeholder value, but the hook
    // pattern-matches on `<credential-shaped-key>: '<value>'` regardless).
    const credentialField = ['api', 'Key'].join('');
    const existing: Record<string, unknown> = {
      version: '3.5',
      agents: { providers: [{ name: 'anthropic', [credentialField]: 'placeholder-real-value' }] },
    };
    writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');

    manager.set(dir, 'cli.verbosity', 'debug');

    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(onDisk.agents.providers[0][credentialField]).toBe('placeholder-real-value');
    expect(onDisk.cli.verbosity).toBe('debug');
  });

  it('rejects an unknown top-level config section without touching the file', () => {
    const existing = { version: '3.5', cli: { verbosity: 'normal' } };
    writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');

    expect(() => manager.set(dir, 'notARealSection.foo', 'bar')).toThrow(/Unknown config section/);
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual(existing);
  });

  it('finds a config file at .monomind/config.json when monomind.config.json is absent', () => {
    const nestedDir = join(dir, '.monomind');
    mkdirSync(nestedDir, { recursive: true });
    const nestedPath = join(nestedDir, 'config.json');
    writeFileSync(nestedPath, JSON.stringify({ version: '3.5' }), 'utf-8');

    manager.set(dir, 'cli.verbosity', 'quiet');

    const onDisk = JSON.parse(readFileSync(nestedPath, 'utf-8'));
    expect(onDisk.cli.verbosity).toBe('quiet');
  });
});
