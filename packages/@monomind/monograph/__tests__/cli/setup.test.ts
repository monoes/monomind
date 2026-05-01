import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { setupMonograph } from '../../src/cli/setup.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monograph-setup-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

describe('setupMonograph — CLAUDE.md', () => {
  it('creates CLAUDE.md when it does not exist', async () => {
    const result = await setupMonograph({ repoPath: tempDir, tools: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('@monoes/monograph');
    expect(content).toContain('mcpServers');
    expect(result.configured).toContain('CLAUDE.md');
    expect(result.errors).toHaveLength(0);
  });

  it('appends to existing CLAUDE.md without overwriting existing content', async () => {
    const existing = '# My Project\n\nSome instructions here.\n';
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), existing, 'utf-8');

    await setupMonograph({ repoPath: tempDir, tools: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some instructions here.');
    expect(content).toContain('@monoes/monograph');
  });

  it('is idempotent — running twice does not duplicate the block', async () => {
    await setupMonograph({ repoPath: tempDir, tools: ['claude'] });
    await setupMonograph({ repoPath: tempDir, tools: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    const occurrences = (content.match(/@monoes\/monograph/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('marks file as skipped on second run', async () => {
    await setupMonograph({ repoPath: tempDir, tools: ['claude'] });
    const result = await setupMonograph({ repoPath: tempDir, tools: ['claude'] });

    expect(result.skipped).toContain('CLAUDE.md');
    expect(result.configured).not.toContain('CLAUDE.md');
  });

  it('injects valid JSON in a fenced code block', async () => {
    await setupMonograph({ repoPath: tempDir, tools: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    const match = content.match(/```json\n([\s\S]*?)```/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.mcpServers.monograph.command).toBe('npx');
    expect(parsed.mcpServers.monograph.args).toEqual(['@monoes/monograph', 'mcp']);
  });
});

// ─── .cursor/mcp.json ────────────────────────────────────────────────────────

describe('setupMonograph — .cursor/mcp.json', () => {
  it('creates .cursor/mcp.json when the directory does not exist', async () => {
    const result = await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });

    const filePath = path.join(tempDir, '.cursor', 'mcp.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.mcpServers.monograph.command).toBe('npx');
    expect(parsed.mcpServers.monograph.args).toEqual(['@monoes/monograph', 'mcp']);
    expect(result.configured).toContain('.cursor/mcp.json');
    expect(result.errors).toHaveLength(0);
  });

  it('preserves existing mcpServers when merging', async () => {
    const cursorDir = path.join(tempDir, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'keep-me' } } }, null, 2),
      'utf-8',
    );

    await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });

    const content = await fs.readFile(path.join(cursorDir, 'mcp.json'), 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.mcpServers.other).toEqual({ command: 'keep-me' });
    expect(parsed.mcpServers.monograph).toBeDefined();
  });

  it('is idempotent — running twice does not duplicate the entry', async () => {
    await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });
    await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });

    const content = await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf-8');
    const parsed = JSON.parse(content);
    const monographEntries = Object.keys(parsed.mcpServers).filter((k) => k === 'monograph');
    expect(monographEntries).toHaveLength(1);
  });

  it('marks file as skipped on second run', async () => {
    await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });
    const result = await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });

    expect(result.skipped).toContain('.cursor/mcp.json');
    expect(result.configured).not.toContain('.cursor/mcp.json');
  });

  it('leaves a corrupt JSON file untouched and reports an error', async () => {
    const cursorDir = path.join(tempDir, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    const corrupt = '{ "mcpServers": broken !!!';
    await fs.writeFile(path.join(cursorDir, 'mcp.json'), corrupt, 'utf-8');

    const result = await setupMonograph({ repoPath: tempDir, tools: ['cursor'] });

    const content = await fs.readFile(path.join(cursorDir, 'mcp.json'), 'utf-8');
    expect(content).toBe(corrupt);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('.cursor/mcp.json');
  });
});

// ─── AGENTS.md ────────────────────────────────────────────────────────────────

describe('setupMonograph — AGENTS.md', () => {
  it('creates AGENTS.md when it does not exist', async () => {
    const result = await setupMonograph({ repoPath: tempDir, tools: ['agents-md'] });

    const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('@monoes/monograph');
    expect(result.configured).toContain('AGENTS.md');
  });

  it('is idempotent — running twice does not duplicate the block', async () => {
    await setupMonograph({ repoPath: tempDir, tools: ['agents-md'] });
    await setupMonograph({ repoPath: tempDir, tools: ['agents-md'] });

    const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    const occurrences = (content.match(/@monoes\/monograph/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

// ─── All tools together ───────────────────────────────────────────────────────

describe('setupMonograph — all tools (default)', () => {
  it('configures all three targets when no tools option is provided', async () => {
    const result = await setupMonograph({ repoPath: tempDir });

    expect(result.configured).toContain('CLAUDE.md');
    expect(result.configured).toContain('.cursor/mcp.json');
    expect(result.configured).toContain('AGENTS.md');
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty configured array when all targets are already present', async () => {
    await setupMonograph({ repoPath: tempDir });
    const result = await setupMonograph({ repoPath: tempDir });

    expect(result.configured).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });
});
