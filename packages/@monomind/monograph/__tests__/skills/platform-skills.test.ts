import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installSkillsForPlatform } from '../../src/skills/platform-skills.js';

let tempDir: string;
beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'monograph-skills-')); });
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

const COMMUNITIES = [
  { name: 'auth', symbols: ['AuthService', 'loginUser', 'logoutUser'] },
  { name: 'api', symbols: ['ApiRouter', 'handleRequest'] },
];

describe('installSkillsForPlatform', () => {
  it('writes .md files for claude platform', async () => {
    const result = await installSkillsForPlatform(tempDir, COMMUNITIES, { platform: 'claude' });
    expect(result.platform).toBe('claude');
    expect(result.filesWritten).toHaveLength(2);
    const content = readFileSync(result.filesWritten[0], 'utf8');
    expect(content).toContain('# auth Skills');
    expect(content).toContain('AuthService');
  });

  it('uses .claude/skills/ output dir for claude', async () => {
    const result = await installSkillsForPlatform(tempDir, COMMUNITIES, { platform: 'claude' });
    expect(result.outputDir).toBe(join(tempDir, '.claude', 'skills'));
    expect(existsSync(result.outputDir)).toBe(true);
  });

  it('writes .md files for cursor platform in .cursor/rules/', async () => {
    const result = await installSkillsForPlatform(tempDir, COMMUNITIES, { platform: 'cursor' });
    expect(result.outputDir).toBe(join(tempDir, '.cursor', 'rules'));
    expect(result.filesWritten[0]).toMatch(/\.md$/);
  });

  it('writes .json snippets for vscode platform', async () => {
    const result = await installSkillsForPlatform(tempDir, COMMUNITIES, { platform: 'vscode' });
    expect(result.filesWritten[0]).toMatch(/\.json$/);
    const parsed = JSON.parse(readFileSync(result.filesWritten[0], 'utf8')) as Record<string, { prefix: string }>;
    const first = Object.values(parsed)[0];
    expect(first.prefix).toBe('auth');
  });

  it('writes .md files for zed platform in .zed/', async () => {
    const result = await installSkillsForPlatform(tempDir, COMMUNITIES, { platform: 'zed' });
    expect(result.outputDir).toBe(join(tempDir, '.zed'));
    expect(result.filesWritten[0]).toMatch(/\.md$/);
  });

  it('respects custom outputDir override', async () => {
    const custom = join(tempDir, 'custom-out');
    const result = await installSkillsForPlatform(tempDir, COMMUNITIES, { platform: 'claude', outputDir: custom });
    expect(result.outputDir).toBe(custom);
    expect(existsSync(custom)).toBe(true);
  });

  it('returns empty filesWritten for empty communities', async () => {
    const result = await installSkillsForPlatform(tempDir, [], { platform: 'claude' });
    expect(result.filesWritten).toHaveLength(0);
  });
});
