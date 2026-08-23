import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getHookStatus, installGitHooks } from '../../cli/hooks-install.js';

describe('getHookStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hook-status-'));
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns installed=false when no hooks present', () => {
    const status = getHookStatus(tmpDir);
    expect(status.installed).toBe(false);
    expect(status.hooks).toEqual([]);
  });

  it('returns installed=true when hooks are present', () => {
    installGitHooks(tmpDir, ['pre-commit', 'post-merge']);
    const status = getHookStatus(tmpDir);
    expect(status.installed).toBe(true);
    expect(status.hooks).toContain('pre-commit');
    expect(status.hooks).toContain('post-merge');
  });

  it('returns hooksDir path', () => {
    const status = getHookStatus(tmpDir);
    expect(status.hooksDir).toContain('.git/hooks');
  });

  it('returns installed=false when .git dir missing', () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'no-git-'));
    const status = getHookStatus(noGitDir);
    expect(status.installed).toBe(false);
    rmSync(noGitDir, { recursive: true, force: true });
  });
});
