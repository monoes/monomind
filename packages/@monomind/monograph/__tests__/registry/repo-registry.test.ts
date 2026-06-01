/**
 * Tests for repo-registry.ts
 *
 * Uses MONOGRAPH_REGISTRY_PATH env var to point at a temp directory,
 * avoiding any writes to ~/.monograph/registry.json during tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getRegistryPath,
  loadRegistry,
  registerRepo,
  unregisterRepo,
  listRepos,
} from '../../src/registry/repo-registry.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'monograph-registry-test-'));
  vi.stubEnv('MONOGRAPH_REGISTRY_PATH', join(tempDir, 'registry.json'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('getRegistryPath', () => {
  it('returns the path set via env var', () => {
    const p = getRegistryPath();
    expect(p).toBe(join(tempDir, 'registry.json'));
  });
});

describe('loadRegistry', () => {
  it('returns empty registry when file does not exist', () => {
    const reg = loadRegistry();
    expect(reg).toEqual({ repos: [] });
  });
});

describe('registerRepo', () => {
  it('adds a new repo entry', () => {
    registerRepo('/projects/alpha', { nodeCount: 100, edgeCount: 200 });
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe('/projects/alpha');
    expect(repos[0].name).toBe('alpha');
    expect(repos[0].nodeCount).toBe(100);
    expect(repos[0].edgeCount).toBe(200);
    expect(repos[0].lastIndexed).toBeTruthy();
  });

  it('upserts an existing repo (updates timestamp and counts)', async () => {
    registerRepo('/projects/alpha', { nodeCount: 50 });
    const firstIndexed = listRepos()[0].lastIndexed;

    await new Promise((r) => setTimeout(r, 10));
    registerRepo('/projects/alpha', { nodeCount: 150, edgeCount: 300 });

    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].nodeCount).toBe(150);
    expect(repos[0].edgeCount).toBe(300);
    expect(repos[0].lastIndexed).not.toBe(firstIndexed);
  });

  it('handles multiple repos independently', () => {
    registerRepo('/projects/alpha');
    registerRepo('/projects/beta');
    registerRepo('/projects/gamma');
    const repos = listRepos();
    expect(repos).toHaveLength(3);
    const names = repos.map((r) => r.name).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('unregisterRepo', () => {
  it('removes a registered repo', () => {
    registerRepo('/projects/alpha');
    registerRepo('/projects/beta');
    unregisterRepo('/projects/alpha');
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe('/projects/beta');
  });

  it('is a no-op when path is not registered', () => {
    registerRepo('/projects/alpha');
    unregisterRepo('/projects/nonexistent');
    expect(listRepos()).toHaveLength(1);
  });
});

describe('listRepos', () => {
  it('returns repos sorted alphabetically by name', () => {
    registerRepo('/z/zebra');
    registerRepo('/a/ant');
    registerRepo('/m/monkey');
    const names = listRepos().map((r) => r.name);
    expect(names).toEqual(['ant', 'monkey', 'zebra']);
  });

  it('returns empty array when no repos are registered', () => {
    expect(listRepos()).toEqual([]);
  });
});

describe('saveRegistry / loadRegistry round-trip', () => {
  it('persists and reloads registry correctly', () => {
    registerRepo('/projects/alpha', { nodeCount: 42 });

    expect(existsSync(getRegistryPath())).toBe(true);

    const raw = JSON.parse(readFileSync(getRegistryPath(), 'utf8')) as { repos: unknown[] };
    expect(raw.repos).toHaveLength(1);

    const reloaded = loadRegistry();
    expect(reloaded.repos[0].path).toBe('/projects/alpha');
    expect((reloaded.repos[0] as { nodeCount: number }).nodeCount).toBe(42);
  });
});
