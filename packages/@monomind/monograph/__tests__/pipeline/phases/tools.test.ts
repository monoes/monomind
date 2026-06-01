import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../../src/storage/db.js';

// ── Integration tests via buildAsync ─────────────────────────────────────────

describe('tools phase — server.tool() pattern', () => {
  const base = join(tmpdir(), `monograph-tools-server-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'mcp-server.ts'),
      [
        `import { Server } from '@modelcontextprotocol/sdk/server/index.js';`,
        `const server = new Server({ name: 'example', version: '1.0.0' });`,
        ``,
        `async function greetHandler(args: { name: string }) {`,
        `  return { greeting: \`Hello, \${args.name}!\` };`,
        `}`,
        ``,
        `server.tool('greet', { name: { type: 'string' } }, greetHandler);`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates a Tool node with name "greet"', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Tool' AND name = 'greet'`)
        .get() as { name: string; file_path: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('greet');
    } finally {
      closeDb(db);
    }
  });

  it('Tool node has the correct filePath', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Tool' AND name = 'greet'`)
        .get() as { file_path: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.file_path).toContain('mcp-server.ts');
    } finally {
      closeDb(db);
    }
  });
});

describe('tools phase — no tool definitions', () => {
  it('does not crash when no tool definitions exist', async () => {
    const noToolDir = join(tmpdir(), `monograph-notool-${Date.now()}`);
    mkdirSync(join(noToolDir, 'src'), { recursive: true });
    writeFileSync(join(noToolDir, 'src', 'index.ts'), 'export const x = 1;\n');
    try {
      await expect(buildAsync(noToolDir)).resolves.not.toThrow();
    } finally {
      rmSync(noToolDir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('tools phase — TOOLS array pattern', () => {
  const base = join(tmpdir(), `monograph-tools-array-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'tools.ts'),
      [
        `export const TOOLS = [`,
        `  {`,
        `    name: 'search',`,
        `    description: 'Searches the knowledge base for relevant content',`,
        `    inputSchema: { query: { type: 'string' } },`,
        `  },`,
        `  {`,
        `    name: 'summarize',`,
        `    description: 'Summarizes the given text',`,
        `    inputSchema: { text: { type: 'string' } },`,
        `  },`,
        `];`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates Tool nodes from TOOLS array', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Tool'`)
        .all() as { name: string }[];
      const names = rows.map(r => r.name);
      expect(names).toContain('search');
      expect(names).toContain('summarize');
    } finally {
      closeDb(db);
    }
  });
});

describe('tools phase — exported constant tool pattern', () => {
  const base = join(tmpdir(), `monograph-tools-const-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'my-tool.ts'),
      [
        `export const MY_TOOL = {`,
        `  name: 'my-tool',`,
        `  description: 'A useful tool',`,
        `};`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates a Tool node from exported constant pattern', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Tool' AND name = 'my-tool'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      closeDb(db);
    }
  });
});
