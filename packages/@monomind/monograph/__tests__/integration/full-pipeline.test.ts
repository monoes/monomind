import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../src/storage/db.js';
import { countNodes } from '../../src/storage/node-store.js';
import { countEdges } from '../../src/storage/edge-store.js';
import { ftsSearch } from '../../src/storage/fts-store.js';

const tmpRepo = join(tmpdir(), `monograph-integration-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(join(tmpRepo, 'src', 'auth.ts'), `
export interface AuthService {
  login(username: string, password: string): Promise<boolean>;
}
export class AuthServiceImpl implements AuthService {
  async login(username: string, password: string): Promise<boolean> {
    return username.length > 0;
  }
}
  `);
  writeFileSync(join(tmpRepo, 'src', 'user.ts'), `
import { AuthService } from './auth';
export class UserController {
  constructor(private auth: AuthService) {}
  async authenticate(u: string, p: string) {
    return this.auth.login(u, p);
  }
}
  `);
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('full pipeline integration', () => {
  it('builds without errors', async () => {
    await expect(buildAsync(tmpRepo)).resolves.not.toThrow();
  }, 30000);

  it('creates the SQLite database', () => {
    const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('indexes nodes and edges', () => {
    const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    const nodes = countNodes(db);
    const edges = countEdges(db);
    closeDb(db);
    expect(nodes).toBeGreaterThan(2);
    expect(edges).toBeGreaterThan(0);
  });

  it('FTS search finds AuthService', () => {
    const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    const results = ftsSearch(db, 'AuthService', 10);
    closeDb(db);
    expect(results.some(r => r.name === 'AuthService' || r.name === 'AuthServiceImpl')).toBe(true);
  });
}, 60000);
