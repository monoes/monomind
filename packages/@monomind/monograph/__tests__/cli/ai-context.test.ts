import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { injectAiContext } from '../../src/cli/ai-context.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monograph-ai-context-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

describe('injectAiContext — CLAUDE.md', () => {
  it('creates CLAUDE.md when it does not exist', async () => {
    const result = await injectAiContext({ repoPath: tempDir, targets: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('monograph:context:start');
    expect(content).toContain('Monograph');
    expect(result.updated).toContain('CLAUDE.md');
    expect(result.errors).toHaveLength(0);
  });

  it('appends to existing CLAUDE.md without overwriting existing content', async () => {
    const existing = '# My Project\n\nSome instructions here.\n';
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), existing, 'utf-8');

    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some instructions here.');
    expect(content).toContain('monograph:context:start');
  });

  it('is idempotent — running twice does not duplicate the block', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });

    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    const occurrences = (content.match(/monograph:context:start/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('marks file as skipped on second run when content is unchanged', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    const result = await injectAiContext({ repoPath: tempDir, targets: ['claude'] });

    expect(result.skipped).toContain('CLAUDE.md');
    expect(result.updated).not.toContain('CLAUDE.md');
  });

  it('contains imperative rules (MUST/NEVER)', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('MUST');
    expect(content).toContain('NEVER');
  });

  it('contains start and end markers', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('<!-- monograph:context:start -->');
    expect(content).toContain('<!-- monograph:context:end -->');
  });

  it('contains tool usage guidance', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('monograph_impact');
    expect(content).toContain('monograph_query');
    expect(content).toContain('monograph_context');
  });
});

// ─── AGENTS.md ────────────────────────────────────────────────────────────────

describe('injectAiContext — AGENTS.md', () => {
  it('creates AGENTS.md when it does not exist', async () => {
    const result = await injectAiContext({ repoPath: tempDir, targets: ['agents-md'] });

    const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('monograph:context:start');
    expect(result.updated).toContain('AGENTS.md');
    expect(result.errors).toHaveLength(0);
  });

  it('appends to existing AGENTS.md without overwriting existing content', async () => {
    const existing = '# Agent Instructions\n\nExisting content.\n';
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), existing, 'utf-8');

    await injectAiContext({ repoPath: tempDir, targets: ['agents-md'] });

    const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Agent Instructions');
    expect(content).toContain('Existing content.');
    expect(content).toContain('monograph:context:start');
  });

  it('is idempotent — running twice does not duplicate the block', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['agents-md'] });
    await injectAiContext({ repoPath: tempDir, targets: ['agents-md'] });

    const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    const occurrences = (content.match(/monograph:context:start/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('marks file as skipped on second run', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['agents-md'] });
    const result = await injectAiContext({ repoPath: tempDir, targets: ['agents-md'] });

    expect(result.skipped).toContain('AGENTS.md');
    expect(result.updated).not.toContain('AGENTS.md');
  });
});

// ─── Both targets (default) ───────────────────────────────────────────────────

describe('injectAiContext — both targets (default)', () => {
  it('updates both files when no targets option is provided', async () => {
    const result = await injectAiContext({ repoPath: tempDir });

    expect(result.updated).toContain('CLAUDE.md');
    expect(result.updated).toContain('AGENTS.md');
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty updated array when all targets are already present', async () => {
    await injectAiContext({ repoPath: tempDir });
    const result = await injectAiContext({ repoPath: tempDir });

    expect(result.updated).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it('CLAUDE.md and AGENTS.md contain the same monograph block', async () => {
    await injectAiContext({ repoPath: tempDir });

    const claude = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    const agents = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');

    // Both must contain the start and end markers
    expect(claude).toContain('<!-- monograph:context:start -->');
    expect(agents).toContain('<!-- monograph:context:start -->');
    expect(claude).toContain('<!-- monograph:context:end -->');
    expect(agents).toContain('<!-- monograph:context:end -->');
  });
});

// ─── Natural-language content (not MCP config) ────────────────────────────────

describe('injectAiContext — content character', () => {
  it('does not inject a raw JSON MCP server config block', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    // setup.ts injects {"mcpServers": ...} JSON — ai-context.ts must NOT
    expect(content).not.toContain('"mcpServers"');
  });

  it('provides prose guidance aimed at AI agents', async () => {
    await injectAiContext({ repoPath: tempDir, targets: ['claude'] });
    const content = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    // Should have human-readable section heading
    expect(content).toContain('Monograph');
    // Should describe tool use in natural language
    expect(content).toContain('impact');
  });
});
