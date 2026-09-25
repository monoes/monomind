/**
 * Regression tests: `monomind init --force` run twice must not dirty the repo.
 *
 * .monomind/config.yaml and .monomind/CAPABILITIES.md each embed a
 * `Generated: <ISO timestamp>` line. Rewriting them unconditionally on every
 * --force made two consecutive inits leave exactly those two files modified,
 * differing only in that timestamp — diff noise nobody can act on.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeRuntimeConfig } from '../init/write-runtime-config.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

const GENERATED_LINE = /Generated:\s*(\S+)/;

function generatedStamp(content: string): string {
  const match = GENERATED_LINE.exec(content);
  if (!match) throw new Error('no Generated: line in content');
  return match[1];
}

function mtimeNs(file: string): bigint {
  return statSync(file, { bigint: true }).mtimeNs;
}

describe('init --force is byte-stable for timestamped generated files', () => {
  let targetDir: string;
  let configPath: string;
  let capabilitiesPath: string;

  beforeEach(() => {
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-init-stamp-'));
    // writeRuntimeConfig writes into an existing .monomind/ (the init
    // executor creates the directory tree before calling it).
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    configPath = join(targetDir, '.monomind', 'config.yaml');
    capabilitiesPath = join(targetDir, '.monomind', 'CAPABILITIES.md');
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  function run(overrides: Partial<(typeof DEFAULT_INIT_OPTIONS)['runtime']> = {}) {
    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir,
      force: true,
      interactive: false,
      runtime: { ...DEFAULT_INIT_OPTIONS.runtime, ...overrides },
    };
    return writeRuntimeConfig(targetDir, options, freshResult());
  }

  it('leaves both files untouched when nothing but the timestamp would change', async () => {
    await run();
    const firstConfig = readFileSync(configPath, 'utf-8');
    const firstCapabilities = readFileSync(capabilitiesPath, 'utf-8');
    const firstConfigMtime = mtimeNs(configPath);
    const firstCapabilitiesMtime = mtimeNs(capabilitiesPath);

    await run();

    expect(readFileSync(configPath, 'utf-8')).toBe(firstConfig);
    expect(readFileSync(capabilitiesPath, 'utf-8')).toBe(firstCapabilities);
    expect(mtimeNs(configPath)).toBe(firstConfigMtime);
    expect(mtimeNs(capabilitiesPath)).toBe(firstCapabilitiesMtime);
  });

  it('writes a real content change and refreshes the timestamp with it', async () => {
    await run();
    const firstConfig = readFileSync(configPath, 'utf-8');
    const firstCapabilities = readFileSync(capabilitiesPath, 'utf-8');

    // config.yaml is merged, not regenerated: --force keeps the values on
    // disk and only adds defaults the file lacks. So the real change here is
    // a default an older config.yaml never had.
    writeFileSync(configPath, firstConfig.replace(/^ {2}port: .*\n/m, ''));
    await run({ maxAgents: DEFAULT_INIT_OPTIONS.runtime.maxAgents + 1 });

    const secondConfig = readFileSync(configPath, 'utf-8');
    const secondCapabilities = readFileSync(capabilitiesPath, 'utf-8');

    expect(secondConfig).toMatch(/^ {2}port: \d+$/m);
    expect(secondConfig).toContain(`maxAgents: ${DEFAULT_INIT_OPTIONS.runtime.maxAgents}\n`);
    expect(secondConfig).not.toBe(firstConfig);
    expect(secondCapabilities).not.toBe(firstCapabilities);
    expect(generatedStamp(secondConfig) >= generatedStamp(firstConfig)).toBe(true);
  });
});
