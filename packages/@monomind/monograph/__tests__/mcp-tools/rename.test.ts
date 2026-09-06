import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync, rmSync, existsSync } from 'fs';
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

// Regression: node rows hold repo-RELATIVE paths, but rename read them straight
// off the row, so every filesystem access resolved against process.cwd(). That is
// the indexed repo only by accident — the MCP server finds the DB via
// MONOMIND_CWD / the git root — so in production a real rename reported
// "Changes: 0". These tests therefore never chdir into the fixture repo: run from
// the package directory, they fail before the fix and pass after it.
describe('getMonographRename with repo-relative rows, run outside the repo', () => {
  const relRepo = join(tmpdir(), `monograph-rename-relrepo-${Date.now()}`);
  const relDbPath = join(relRepo, '.monomind', 'monograph.db');
  let relDb: ReturnType<typeof openDb>;

  beforeAll(() => {
    mkdirSync(join(relRepo, 'src'), { recursive: true });
    writeFileSync(
      join(relRepo, 'src', 'auth.ts'),
      `export function authenticate(user: string): boolean {\n  return user.length > 0;\n}\n`,
    );
    writeFileSync(
      join(relRepo, 'src', 'api.ts'),
      `import { authenticate } from './auth';\n\nexport function handleRequest(user: string) {\n  return authenticate(user);\n}\n`,
    );

    // openDb creates the .monomind directory, so the DB sits where a real build
    // would put it: <repoRoot>/.monomind/monograph.db.
    relDb = openDb(relDbPath);
    insertNode(relDb, {
      id: 'rel_auth',
      label: 'Function',
      name: 'authenticate',
      normLabel: 'authenticate',
      filePath: 'src/auth.ts',
      startLine: 1,
      isExported: true,
    });
    insertNode(relDb, {
      id: 'rel_api',
      label: 'Function',
      name: 'handleRequest',
      normLabel: 'handlerequest',
      filePath: 'src/api.ts',
      startLine: 4,
      isExported: true,
    });
    // Recorded in the graph but deleted from disk since the last build.
    insertNode(relDb, {
      id: 'rel_ghost',
      label: 'Function',
      name: 'staleCaller',
      normLabel: 'stalecaller',
      filePath: 'src/deleted.ts',
      startLine: 2,
      isExported: true,
    });
    for (const [id, sourceId] of [
      ['e_rel_api_calls', 'rel_api'],
      ['e_rel_ghost_calls', 'rel_ghost'],
    ] as const) {
      insertEdge(relDb, {
        id,
        sourceId,
        targetId: 'rel_auth',
        relation: 'CALLS',
        confidence: 'EXTRACTED',
        confidenceScore: 1.0,
      });
    }
  });

  afterAll(() => {
    closeDb(relDb);
    rmSync(relRepo, { recursive: true, force: true });
  });

  it('finds real changes when cwd is not the indexed repo', () => {
    expect(process.cwd()).not.toBe(relRepo);

    const result = getMonographRename(relDb, { oldName: 'authenticate', newName: 'login' });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].file).toBe('src/api.ts');
    expect(result.changes[0].line).toBe(4);
    expect(result.changes[0].before).toContain('authenticate');
    expect(result.changes[0].after).toContain('login');
    expect(result.changes[0].after).not.toContain('authenticate');
  });

  it('skips graph files missing from disk without throwing', () => {
    const result = getMonographRename(relDb, { oldName: 'authenticate', newName: 'login' });

    // The deleted file is still a referencing file per the graph, but it can
    // contribute no diff.
    expect(result.referencingFiles).toContain('src/deleted.ts');
    expect(result.changes.map((c) => c.file)).not.toContain('src/deleted.ts');
  });
});
