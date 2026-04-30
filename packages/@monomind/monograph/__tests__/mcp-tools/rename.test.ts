import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getMonographRename } from '../../src/mcp-tools/rename.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

// Build a small repo:
// auth.ts exports authenticate()
// api.ts imports authenticate() and calls it

const repoDir = join(tmpdir(), `monograph-rename-repo-${Date.now()}`);
const dbPath = join(tmpdir(), `monograph-rename-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const authFilePath = join(repoDir, 'auth.ts');
const apiFilePath = join(repoDir, 'api.ts');

const nodeAuthenticate: MonographNode = {
  id: 'ren_auth',
  label: 'Function',
  name: 'authenticate',
  normLabel: 'authenticate',
  filePath: authFilePath,
  startLine: 1,
  isExported: true,
};

const nodeApiHandler: MonographNode = {
  id: 'ren_api',
  label: 'Function',
  name: 'handleRequest',
  normLabel: 'handlerequest',
  filePath: apiFilePath,
  startLine: 4, // line 4: "  return authenticate(user);" — contains the reference
  isExported: true,
};

// api calls authenticate
const edgeApiCallsAuth: MonographEdge = {
  id: 'e_api_auth_calls',
  sourceId: 'ren_api',
  targetId: 'ren_auth',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeAll(() => {
  mkdirSync(repoDir, { recursive: true });

  // Write source files with the symbol name on the relevant lines
  writeFileSync(authFilePath, `export function authenticate(user: string): boolean {\n  return user.length > 0;\n}\n`);
  writeFileSync(apiFilePath, `import { authenticate } from './auth';\n\nexport function handleRequest(user: string) {\n  return authenticate(user);\n}\n`);

  db = openDb(dbPath);
  insertNode(db, nodeAuthenticate);
  insertNode(db, nodeApiHandler);
  insertEdge(db, edgeApiCallsAuth);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
  // Cleanup temp files
  for (const f of [authFilePath, apiFilePath]) {
    if (existsSync(f)) unlinkSync(f);
  }
  if (existsSync(repoDir)) rmdirSync(repoDir);
});

describe('getMonographRename', () => {
  it('returns null symbol for unknown name', () => {
    const result = getMonographRename(db, { oldName: 'nonexistent', newName: 'newName' });
    expect(result.symbol).toBeNull();
    expect(result.referencingFiles).toHaveLength(0);
    expect(result.changes).toHaveLength(0);
  });

  it('finds the canonical symbol', () => {
    const result = getMonographRename(db, { oldName: 'authenticate', newName: 'login' });
    expect(result.symbol).not.toBeNull();
    expect(result.symbol?.id).toBe('ren_auth');
  });

  it('referencingFiles includes api.ts', () => {
    const result = getMonographRename(db, { oldName: 'authenticate', newName: 'login' });
    expect(result.referencingFiles).toContain(apiFilePath);
  });

  it('changes array has before/after entries', () => {
    const result = getMonographRename(db, { oldName: 'authenticate', newName: 'login' });
    expect(result.changes.length).toBeGreaterThan(0);
    const change = result.changes[0];
    expect(change.before).toContain('authenticate');
    expect(change.after).toContain('login');
    expect(change.after).not.toContain('authenticate');
  });

  it('does NOT write files (dry run always)', async () => {
    const result = getMonographRename(db, { oldName: 'authenticate', newName: 'login', dryRun: false });
    // File should still contain the old name
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(apiFilePath, 'utf-8');
    expect(content).toContain('authenticate');
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('disambiguates by filePath', () => {
    const result = getMonographRename(db, { oldName: 'authenticate', newName: 'login', filePath: authFilePath });
    expect(result.symbol?.filePath).toBe(authFilePath);
  });
});
