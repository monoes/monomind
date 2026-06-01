import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getToolMap } from '../../src/mcp-tools/tool-map.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

/**
 * Graph:
 *   Tool node: "auth_login"   → HANDLES_TOOL → handler function "handleAuthLogin"
 *   Tool node: "list_users"   (no handler)
 */

const dbPath = join(tmpdir(), `monograph-tool-map-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const toolAuthLogin: MonographNode = {
  id: 'tool_auth_login',
  label: 'Tool',
  name: 'auth_login',
  normLabel: 'auth_login',
  filePath: 'src/tools/auth.ts',
  startLine: 0,
  isExported: false,
};

const toolListUsers: MonographNode = {
  id: 'tool_list_users',
  label: 'Tool',
  name: 'list_users',
  normLabel: 'list_users',
  filePath: 'src/tools/users.ts',
  startLine: 0,
  isExported: false,
};

const handlerAuthLogin: MonographNode = {
  id: 'fn_handle_auth_login',
  label: 'Function',
  name: 'handleAuthLogin',
  normLabel: 'handleauthlogin',
  filePath: 'src/handlers/auth-handler.ts',
  startLine: 12,
  isExported: true,
};

const handlesToolEdge: MonographEdge = {
  id: 'e_tool_handler',
  sourceId: 'tool_auth_login',
  targetId: 'fn_handle_auth_login',
  relation: 'HANDLES_TOOL',
  confidence: 'EXTRACTED',
  confidenceScore: 0.9,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, toolAuthLogin);
  insertNode(db, toolListUsers);
  insertNode(db, handlerAuthLogin);
  insertEdge(db, handlesToolEdge);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('getToolMap', () => {
  it('returns both tools when no filter is given', () => {
    const result = getToolMap(db);
    expect(result).toHaveLength(2);
  });

  it('returns tools sorted by name', () => {
    const result = getToolMap(db);
    const names = result.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it('attaches handler info when HANDLES_TOOL edge exists', () => {
    const result = getToolMap(db);
    const authTool = result.find((t) => t.name === 'auth_login');
    expect(authTool).toBeDefined();
    expect(authTool!.handlerName).toBe('handleAuthLogin');
    expect(authTool!.handlerFile).toBe('src/handlers/auth-handler.ts');
    expect(authTool!.handlerLine).toBe(12);
  });

  it('handler fields are null when no HANDLES_TOOL edge exists', () => {
    const result = getToolMap(db);
    const usersTool = result.find((t) => t.name === 'list_users');
    expect(usersTool).toBeDefined();
    expect(usersTool!.handlerName).toBeNull();
    expect(usersTool!.handlerFile).toBeNull();
    expect(usersTool!.handlerLine).toBeNull();
  });

  it('filters by tool name substring', () => {
    const result = getToolMap(db, { tool: 'auth' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('auth_login');
  });

  it('filter with no match returns empty array', () => {
    const result = getToolMap(db, { tool: 'nonexistent' });
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no Tool nodes exist', () => {
    const emptyDbPath = join(tmpdir(), `monograph-tool-map-empty-${Date.now()}.db`);
    const emptyDb = openDb(emptyDbPath);
    try {
      const result = getToolMap(emptyDb);
      expect(result).toHaveLength(0);
    } finally {
      closeDb(emptyDb);
      for (const p of [emptyDbPath, emptyDbPath + '-wal', emptyDbPath + '-shm']) {
        if (existsSync(p)) unlinkSync(p);
      }
    }
  });

  it('result entries include id and filePath fields', () => {
    const result = getToolMap(db);
    const authTool = result.find((t) => t.name === 'auth_login');
    expect(authTool).toBeDefined();
    expect(authTool!.id).toBe('tool_auth_login');
    expect(authTool!.filePath).toBe('src/tools/auth.ts');
  });
});
