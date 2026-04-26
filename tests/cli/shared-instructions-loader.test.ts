import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SharedInstructionsLoader } from '../../packages/@monomind/cli/src/agents/shared-instructions-loader.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SharedInstructionsLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'shared-instr-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads shared instructions from file', () => {
    const agentsDir = join(tempDir, '.agents');
    mkdirSync(agentsDir);
    writeFileSync(join(agentsDir, 'shared_instructions.md'), '# Instructions\nBe helpful.');
    const loader = new SharedInstructionsLoader('.agents/shared_instructions.md');
    const result = loader.load(tempDir);
    expect(result).toContain('Be helpful');
  });

  it('returns empty string when file is absent', () => {
    const loader = new SharedInstructionsLoader('.agents/shared_instructions.md');
    const result = loader.load(tempDir);
    expect(result).toBe('');
  });

  it('caches content after first load', () => {
    const agentsDir = join(tempDir, '.agents');
    mkdirSync(agentsDir);
    writeFileSync(join(agentsDir, 'shared_instructions.md'), 'cached content');
    const loader = new SharedInstructionsLoader('.agents/shared_instructions.md');
    loader.load(tempDir);
    expect(loader.isLoaded()).toBe(true);
    expect(loader.getSharedInstructions(tempDir)).toBe('cached content');
  });

  it('reload clears cache and reloads', () => {
    const agentsDir = join(tempDir, '.agents');
    mkdirSync(agentsDir);
    writeFileSync(join(agentsDir, 'shared_instructions.md'), 'v1');
    const loader = new SharedInstructionsLoader('.agents/shared_instructions.md');
    loader.load(tempDir);
    writeFileSync(join(agentsDir, 'shared_instructions.md'), 'v2');
    const result = loader.reload(tempDir);
    expect(result).toBe('v2');
  });

  it('prependToPrompt adds shared instructions before agent prompt', () => {
    const agentsDir = join(tempDir, '.agents');
    mkdirSync(agentsDir);
    writeFileSync(join(agentsDir, 'shared_instructions.md'), '# Shared');
    const loader = new SharedInstructionsLoader('.agents/shared_instructions.md');
    loader.load(tempDir);
    const result = loader.prependToPrompt('Agent-specific prompt');
    expect(result).toContain('# Shared');
    expect(result).toContain('Agent-specific prompt');
    expect(result.indexOf('# Shared')).toBeLessThan(result.indexOf('Agent-specific prompt'));
  });

  it('prependToPrompt returns agent prompt only when shared is empty', () => {
    const loader = new SharedInstructionsLoader('.agents/nonexistent.md');
    loader.load(tempDir);
    const result = loader.prependToPrompt('Agent prompt');
    expect(result).toBe('Agent prompt');
  });
});
