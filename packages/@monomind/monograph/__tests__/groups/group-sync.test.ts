/**
 * Tests for group-sync.ts and contract-registry.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

import { syncGroup } from '../../src/groups/group-sync.js';
import {
  extractHttpContracts,
  buildContractLinks,
  loadContractRegistry,
  type HttpContract,
} from '../../src/groups/contract-registry.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a minimal monograph-compatible SQLite DB with Route nodes (and
 * optional handler nodes + HANDLES_ROUTE edges).
 */
function createRepoDb(
  dbPath: string,
  routes: Array<{
    id: string;
    /** "METHOD /path" — matches how routes.ts constructs node names */
    name: string;
    filePath?: string;
    handlerName?: string;
    handlerFile?: string;
  }>,
): void {
  mkdirSync(join(dbPath, '..'), { recursive: true });
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      name TEXT NOT NULL,
      norm_label TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      community_id INTEGER,
      is_exported INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      properties TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'EXTRACTED',
      confidence_score REAL NOT NULL DEFAULT 1.0
    );
  `);

  const insertNode = db.prepare(
    `INSERT INTO nodes (id, label, name, norm_label, file_path) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO edges (id, source_id, target_id, relation) VALUES (?, ?, ?, ?)`,
  );

  for (const r of routes) {
    insertNode.run(r.id, 'Route', r.name, r.name.toLowerCase(), r.filePath ?? null);

    if (r.handlerName) {
      const handlerId = `handler-${r.id}`;
      insertNode.run(
        handlerId,
        'Function',
        r.handlerName,
        r.handlerName.toLowerCase(),
        r.handlerFile ?? null,
      );
      // Route is SOURCE of HANDLES_ROUTE edge (matches routes.ts L93-98)
      insertEdge.run(`edge-${r.id}`, r.id, handlerId, 'HANDLES_ROUTE');
    }
  }

  db.close();
}

/**
 * Creates a group.yaml file pointing to the given repo paths.
 */
function createGroupYaml(
  dir: string,
  groupName: string,
  repos: Record<string, string>,
): string {
  const yamlPath = join(dir, 'group.yaml');
  const repoLines = Object.entries(repos)
    .map(([name, path]) => `  ${name}: ${path}`)
    .join('\n');
  writeFileSync(yamlPath, `name: ${groupName}\nrepos:\n${repoLines}\n`);
  return yamlPath;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'monograph-group-sync-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeRepo(
  repoName: string,
  routes: Parameters<typeof createRepoDb>[1],
): string {
  const repoPath = join(tmpDir, repoName);
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  mkdirSync(join(repoPath, '.monomind'), { recursive: true });
  createRepoDb(dbPath, routes);
  return repoPath;
}

// ── extractHttpContracts ──────────────────────────────────────────────────────

describe('extractHttpContracts', () => {
  it('returns Route nodes with parsed method and path', () => {
    const repoPath = makeRepo('repo-extract', [
      { id: 'r1', name: 'GET /api/users', filePath: 'src/users.ts' },
      { id: 'r2', name: 'POST /api/users', filePath: 'src/users.ts' },
    ]);

    const db = new Database(join(repoPath, '.monomind', 'monograph.db'), { readonly: true });
    try {
      const contracts = extractHttpContracts(db, 'myRepo');
      expect(contracts).toHaveLength(2);

      const get = contracts.find((c) => c.method === 'GET');
      expect(get).toBeDefined();
      expect(get!.path).toBe('/api/users');
      expect(get!.repo).toBe('myRepo');
    } finally {
      db.close();
    }
  });

  it('includes handler info when HANDLES_ROUTE edge is present', () => {
    const repoPath = makeRepo('repo-handler', [
      {
        id: 'r1',
        name: 'GET /health',
        filePath: 'src/health.ts',
        handlerName: 'getHealth',
        handlerFile: 'src/health.ts',
      },
    ]);

    const db = new Database(join(repoPath, '.monomind', 'monograph.db'), { readonly: true });
    try {
      const contracts = extractHttpContracts(db, 'svc');
      expect(contracts).toHaveLength(1);
      expect(contracts[0].handlerName).toBe('getHealth');
      expect(contracts[0].handlerFile).toBe('src/health.ts');
    } finally {
      db.close();
    }
  });

  it('returns empty array when there are no Route nodes', () => {
    const repoPath = makeRepo('repo-empty', []);
    const db = new Database(join(repoPath, '.monomind', 'monograph.db'), { readonly: true });
    try {
      const contracts = extractHttpContracts(db, 'empty');
      expect(contracts).toEqual([]);
    } finally {
      db.close();
    }
  });
});

// ── buildContractLinks ────────────────────────────────────────────────────────

describe('buildContractLinks', () => {
  it('returns a link when 2 repos share the same method + path', () => {
    const contracts: HttpContract[] = [
      { method: 'GET', path: '/api/users', handlerName: null, handlerFile: null, repo: 'backend' },
      { method: 'GET', path: '/api/users', handlerName: null, handlerFile: null, repo: 'frontend' },
      { method: 'GET', path: '/unique',    handlerName: null, handlerFile: null, repo: 'backend' },
    ];

    const links = buildContractLinks(contracts);
    expect(links).toHaveLength(1);
    expect(links[0].path).toBe('/api/users');
    expect(links[0].method).toBe('GET');
    expect(links[0].producerRepo).toBe('backend');
    expect(links[0].consumerRepos).toContain('frontend');
  });

  it('deduplicates the same repo appearing multiple times for one route', () => {
    // A repo that registers the same route in two files should appear only once
    const contracts: HttpContract[] = [
      { method: 'POST', path: '/orders', handlerName: 'h1', handlerFile: 'a.ts', repo: 'svc-a' },
      { method: 'POST', path: '/orders', handlerName: 'h2', handlerFile: 'b.ts', repo: 'svc-a' },
      { method: 'POST', path: '/orders', handlerName: null,  handlerFile: null,  repo: 'svc-b' },
    ];

    const links = buildContractLinks(contracts);
    expect(links).toHaveLength(1);
    // svc-a is producer (first seen), svc-b is consumer
    expect(links[0].producerRepo).toBe('svc-a');
    expect(links[0].consumerRepos).toEqual(['svc-b']);
  });

  it('returns empty when no routes are shared across repos', () => {
    const contracts: HttpContract[] = [
      { method: 'GET', path: '/a', handlerName: null, handlerFile: null, repo: 'repo1' },
      { method: 'GET', path: '/b', handlerName: null, handlerFile: null, repo: 'repo2' },
    ];
    expect(buildContractLinks(contracts)).toEqual([]);
  });

  it('treats different methods on the same path as distinct links', () => {
    const contracts: HttpContract[] = [
      { method: 'GET',  path: '/items', handlerName: null, handlerFile: null, repo: 'a' },
      { method: 'GET',  path: '/items', handlerName: null, handlerFile: null, repo: 'b' },
      { method: 'POST', path: '/items', handlerName: null, handlerFile: null, repo: 'a' },
      { method: 'POST', path: '/items', handlerName: null, handlerFile: null, repo: 'b' },
    ];
    const links = buildContractLinks(contracts);
    expect(links).toHaveLength(2);
    const methods = links.map((l) => l.method).sort();
    expect(methods).toEqual(['GET', 'POST']);
  });
});

// ── syncGroup ─────────────────────────────────────────────────────────────────

describe('syncGroup', () => {
  it('finds a cross-repo link when two repos share the same route', async () => {
    const repoAPath = makeRepo('serviceA', [
      { id: 'r1', name: 'GET /api/users', filePath: 'src/users.ts' },
    ]);
    const repoBPath = makeRepo('serviceB', [
      { id: 'r2', name: 'GET /api/users', filePath: 'src/proxy.ts' },
    ]);

    const configPath = createGroupYaml(tmpDir, 'test-group', {
      serviceA: repoAPath,
      serviceB: repoBPath,
    });

    const result = await syncGroup(configPath);

    expect(result.group).toBe('test-group');
    expect(result.reposScanned).toBe(2);
    expect(result.contractsFound).toBe(2);
    expect(result.crossRepoLinks).toBeGreaterThanOrEqual(1);
    expect(result.registryPath).toContain('test-group.contracts.db');
  });

  it('skips a repo whose DB does not exist', async () => {
    const repoAPath = makeRepo('svcA', [
      { id: 'r1', name: 'GET /ping' },
    ]);

    // svcB directory exists (parseGroupConfig checks path), but no DB inside
    const svcBPath = join(tmpDir, 'svcB');
    mkdirSync(svcBPath, { recursive: true });

    const configPath = createGroupYaml(tmpDir, 'skip-group', {
      svcA: repoAPath,
      svcB: svcBPath,
    });

    const result = await syncGroup(configPath);
    expect(result.reposScanned).toBe(1);
  });

  it('throws a descriptive error when config file is missing', async () => {
    const missing = join(tmpDir, 'does-not-exist.yaml');
    await expect(syncGroup(missing)).rejects.toThrow(/Group config not found/);
  });

  it('persists the registry so loadContractRegistry can read it back', async () => {
    const repoAPath = makeRepo('alpha', [
      { id: 'r1', name: 'DELETE /api/items/:id', filePath: 'src/items.ts' },
    ]);
    const repoBPath = makeRepo('beta', [
      { id: 'r2', name: 'DELETE /api/items/:id', filePath: 'src/items-proxy.ts' },
    ]);

    const configPath = createGroupYaml(tmpDir, 'persist-group', {
      alpha: repoAPath,
      beta: repoBPath,
    });

    const result = await syncGroup(configPath);
    const loaded = loadContractRegistry(result.registryPath);

    expect(loaded).not.toBeNull();
    expect(loaded!.contracts.length).toBe(2);
    expect(loaded!.links.length).toBeGreaterThanOrEqual(1);
    expect(loaded!.links[0].path).toBe('/api/items/:id');
  });

  it('returns zero cross-repo links when routes are unique per repo', async () => {
    const repoAPath = makeRepo('repoX', [
      { id: 'r1', name: 'GET /only-in-x' },
    ]);
    const repoBPath = makeRepo('repoY', [
      { id: 'r2', name: 'GET /only-in-y' },
    ]);

    const configPath = createGroupYaml(tmpDir, 'no-links-group', {
      repoX: repoAPath,
      repoY: repoBPath,
    });

    const result = await syncGroup(configPath);
    expect(result.crossRepoLinks).toBe(0);
  });
});

// ── loadContractRegistry ──────────────────────────────────────────────────────

describe('loadContractRegistry', () => {
  it('returns null when the registry file does not exist', () => {
    const missing = join(tmpDir, 'nonexistent.contracts.db');
    expect(loadContractRegistry(missing)).toBeNull();
  });
});
