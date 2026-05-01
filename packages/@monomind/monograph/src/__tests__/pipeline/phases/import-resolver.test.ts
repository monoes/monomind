import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectWorkspacePackages, resolveWorkspaceImport, type WorkspacePackage } from '../../../pipeline/phases/import-resolver.js';

describe('detectWorkspacePackages', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'monorepo-test-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects npm workspace packages', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      workspaces: ['packages/*'],
    }));
    mkdirSync(join(tmpDir, 'packages', 'core'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages', 'utils'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@myapp/core' }));
    writeFileSync(join(tmpDir, 'packages', 'utils', 'package.json'), JSON.stringify({ name: '@myapp/utils' }));

    const packages = detectWorkspacePackages(tmpDir);
    const names = packages.map(p => p.name);
    expect(names).toContain('@myapp/core');
    expect(names).toContain('@myapp/utils');
  });

  it('returns empty array when no workspace config', () => {
    const packages = detectWorkspacePackages(tmpDir);
    expect(packages).toEqual([]);
  });
});

describe('resolveWorkspaceImport', () => {
  it('resolves a workspace package name to its local path', () => {
    const packages: WorkspacePackage[] = [
      { name: '@myapp/core', path: '/repo/packages/core' },
      { name: '@myapp/utils', path: '/repo/packages/utils' },
    ];
    const result = resolveWorkspaceImport('@myapp/core', packages);
    expect(result).toBe('/repo/packages/core');
  });

  it('returns null for a non-workspace import', () => {
    const packages: WorkspacePackage[] = [
      { name: '@myapp/core', path: '/repo/packages/core' },
    ];
    const result = resolveWorkspaceImport('lodash', packages);
    expect(result).toBeNull();
  });

  it('returns null for empty packages list', () => {
    const result = resolveWorkspaceImport('@myapp/core', []);
    expect(result).toBeNull();
  });

  it('handles scoped packages with subpath (@scope/pkg/subpath)', () => {
    const packages: WorkspacePackage[] = [
      { name: '@myapp/core', path: '/repo/packages/core' },
    ];
    const result = resolveWorkspaceImport('@myapp/core/utils', packages);
    expect(result).toBe('/repo/packages/core');
  });
});
