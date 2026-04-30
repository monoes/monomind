import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../../src/storage/db.js';
import { pagesPathToRoute, appPathToRoute, extractExpressRoutes, extractNestRoutes, extractDefaultExportName } from '../../../src/pipeline/phases/routes.js';

// ── Unit tests for pure helpers ───────────────────────────────────────────────

describe('pagesPathToRoute', () => {
  it('converts pages/index.ts to /', () => {
    expect(pagesPathToRoute('pages/index.ts')).toBe('/');
  });
  it('converts pages/about.ts to /about', () => {
    expect(pagesPathToRoute('pages/about.ts')).toBe('/about');
  });
  it('converts pages/api/users.ts to /api/users', () => {
    expect(pagesPathToRoute('pages/api/users.ts')).toBe('/api/users');
  });
  it('converts dynamic segment [id] to :id', () => {
    expect(pagesPathToRoute('pages/api/users/[id].ts')).toBe('/api/users/:id');
  });
  it('converts catch-all [...slug].ts to *', () => {
    expect(pagesPathToRoute('pages/[...slug].ts')).toBe('/*');
  });
  it('converts optional catch-all [[...slug]].ts to *', () => {
    expect(pagesPathToRoute('pages/[[...slug]].ts')).toBe('/*');
  });
});

describe('appPathToRoute', () => {
  it('converts app/route.ts to /', () => {
    expect(appPathToRoute('app/route.ts')).toBe('/');
  });
  it('converts app/users/route.ts to /users', () => {
    expect(appPathToRoute('app/users/route.ts')).toBe('/users');
  });
  it('converts app/users/[id]/route.ts to /users/:id', () => {
    expect(appPathToRoute('app/users/[id]/route.ts')).toBe('/users/:id');
  });
});

describe('extractDefaultExportName', () => {
  it('finds export default function handler', () => {
    expect(extractDefaultExportName('export default function handler(req, res) {}')).toBe('handler');
  });
  it('finds export default async function myFn', () => {
    expect(extractDefaultExportName('export default async function myFn(req, res) {}')).toBe('myFn');
  });
  it('returns undefined when no default export', () => {
    expect(extractDefaultExportName('export function helper() {}')).toBeUndefined();
  });
});

describe('extractExpressRoutes', () => {
  it('finds app.get() routes', () => {
    const src = `app.get('/users', getUsers);\napp.post('/users', createUser);`;
    const routes = extractExpressRoutes(src, 'src/routes.ts', '.ts');
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ method: 'GET', path: '/users', handlerName: 'getUsers' });
    expect(routes[1]).toMatchObject({ method: 'POST', path: '/users', handlerName: 'createUser' });
  });
  it('finds router.delete() routes', () => {
    const src = `router.delete('/items/:id', removeItem);`;
    const routes = extractExpressRoutes(src, 'src/routes.ts', '.ts');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: 'DELETE', path: '/items/:id', handlerName: 'removeItem' });
  });
  it('returns empty array for files with no express routes', () => {
    const routes = extractExpressRoutes('const x = 1;', 'src/util.ts', '.ts');
    expect(routes).toHaveLength(0);
  });
});

describe('extractNestRoutes', () => {
  it('finds NestJS controller + method decorators', () => {
    const src = `
@Controller('users')
export class UsersController {
  @Get('/')
  findAll() {}

  @Post('/')
  create() {}
}
`;
    const routes = extractNestRoutes(src, 'src/users.controller.ts', '.ts');
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const methods = routes.map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });
});

// ── Integration tests via buildAsync ─────────────────────────────────────────

describe('routes phase — Next.js pages', () => {
  const base = join(tmpdir(), `monograph-routes-pages-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'pages', 'api', 'users'), { recursive: true });

    // Next.js page: default export handler
    writeFileSync(
      join(base, 'pages', 'api', 'users.ts'),
      `export default function handler(req: any, res: any) { res.json([]); }\n`,
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates a Route node for the Next.js page file', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Route'`)
        .all() as { name: string; file_path: string }[];
      const route = rows.find(r => r.name.includes('/api/users'));
      expect(route).toBeDefined();
    } finally {
      closeDb(db);
    }
  });

  it('Route node name contains the correct path', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Route' AND name LIKE '%/api/users%'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toContain('/api/users');
    } finally {
      closeDb(db);
    }
  });
});

describe('routes phase — no route files', () => {
  it('does not crash when no route files exist', async () => {
    const noRouteDir = join(tmpdir(), `monograph-noroute-${Date.now()}`);
    mkdirSync(join(noRouteDir, 'src'), { recursive: true });
    writeFileSync(join(noRouteDir, 'src', 'index.ts'), 'export const x = 1;\n');
    try {
      await expect(buildAsync(noRouteDir)).resolves.not.toThrow();
    } finally {
      rmSync(noRouteDir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('routes phase — Express-style routes', () => {
  const base = join(tmpdir(), `monograph-routes-express-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'server.ts'),
      [
        `import express from 'express';`,
        `const app = express();`,
        `function getUsers(req: any, res: any) { res.json([]); }`,
        `app.get('/api/items', getUsers);`,
        `app.post('/api/items', getUsers);`,
        `app.listen(3000);`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates Route nodes for Express routes', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Route'`)
        .all() as { name: string }[];
      const getRoute = rows.find(r => r.name.includes('GET') && r.name.includes('/api/items'));
      expect(getRoute).toBeDefined();
    } finally {
      closeDb(db);
    }
  });
});
