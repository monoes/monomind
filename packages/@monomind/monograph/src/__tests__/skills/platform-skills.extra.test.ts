import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPlatformSkill, SUPPORTED_PLATFORMS } from '../../skills/platform-skills.js';

describe('additional platform skills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skills-extra-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('SUPPORTED_PLATFORMS includes codex, gemini, aider, copilot, kiro', () => {
    expect(SUPPORTED_PLATFORMS).toContain('codex');
    expect(SUPPORTED_PLATFORMS).toContain('gemini');
    expect(SUPPORTED_PLATFORMS).toContain('aider');
    expect(SUPPORTED_PLATFORMS).toContain('copilot');
    expect(SUPPORTED_PLATFORMS).toContain('kiro');
  });

  it('installs codex skill file', () => {
    const result = installPlatformSkill(tmpDir, 'codex', []);
    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(result.filesWritten.some((f) => existsSync(f))).toBe(true);
  });

  it('installs gemini skill file', () => {
    const result = installPlatformSkill(tmpDir, 'gemini', []);
    expect(result.filesWritten.length).toBeGreaterThan(0);
  });

  it('installs kiro skill file', () => {
    const result = installPlatformSkill(tmpDir, 'kiro', []);
    expect(result.filesWritten.length).toBeGreaterThan(0);
  });
});
