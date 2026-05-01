import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../../src/storage/db.js';

// ── TypeORM ───────────────────────────────────────────────────────────────────

describe('orm phase — TypeORM @Entity()', () => {
  const base = join(tmpdir(), `monograph-orm-typeorm-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'user.entity.ts'),
      [
        `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';`,
        ``,
        `@Entity()`,
        `export class User {`,
        `  @PrimaryGeneratedColumn()`,
        `  id: number;`,
        ``,
        `  @Column()`,
        `  name: string;`,
        ``,
        `  @Column()`,
        `  email: string;`,
        `}`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates an Entity node for the User class', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Entity' AND name = 'User'`)
        .get() as { name: string; file_path: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('User');
    } finally {
      closeDb(db);
    }
  });

  it('creates Field nodes for decorated columns', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Field'`)
        .all() as { name: string }[];
      const names = rows.map(r => r.name);
      // At least some column fields should be detected
      expect(names.length).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });

  it('creates HAS_FIELD edges from Entity to Field nodes', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM edges WHERE relation = 'HAS_FIELD' LIMIT 1`)
        .get() as { relation: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      closeDb(db);
    }
  });
});

// ── Prisma ────────────────────────────────────────────────────────────────────

describe('orm phase — Prisma schema.prisma', () => {
  const base = join(tmpdir(), `monograph-orm-prisma-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(base, { recursive: true });

    writeFileSync(
      join(base, 'schema.prisma'),
      [
        `datasource db {`,
        `  provider = "postgresql"`,
        `  url      = env("DATABASE_URL")`,
        `}`,
        ``,
        `model Post {`,
        `  id        Int     @id @default(autoincrement())`,
        `  title     String`,
        `  content   String?`,
        `  published Boolean @default(false)`,
        `}`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates an Entity node for the Prisma model', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Entity' AND name = 'Post'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('Post');
    } finally {
      closeDb(db);
    }
  });

  it('creates Field nodes for Prisma model fields', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Field'`)
        .all() as { name: string }[];
      const names = rows.map(r => r.name);
      expect(names).toContain('title');
    } finally {
      closeDb(db);
    }
  });
});

// ── Mongoose ──────────────────────────────────────────────────────────────────

describe('orm phase — Mongoose new Schema()', () => {
  const base = join(tmpdir(), `monograph-orm-mongoose-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'product.model.js'),
      [
        `const mongoose = require('mongoose');`,
        `const { Schema } = mongoose;`,
        ``,
        `const productSchema = new Schema({`,
        `  title: { type: String, required: true },`,
        `  price: { type: Number },`,
        `  inStock: Boolean,`,
        `});`,
        ``,
        `module.exports = mongoose.model('Product', productSchema);`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates an Entity node from the Mongoose schema variable', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Entity' AND name = 'product'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      closeDb(db);
    }
  });
});

// ── Sequelize ─────────────────────────────────────────────────────────────────

describe('orm phase — Sequelize Model.init()', () => {
  const base = join(tmpdir(), `monograph-orm-sequelize-init-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'order.model.ts'),
      [
        `import { Model, DataTypes, Sequelize } from 'sequelize';`,
        ``,
        `class Order extends Model {}`,
        ``,
        `Order.init(`,
        `  {`,
        `    id: { type: DataTypes.INTEGER, primaryKey: true },`,
        `    total: { type: DataTypes.DECIMAL },`,
        `    status: DataTypes.STRING,`,
        `  },`,
        `  { sequelize, tableName: 'orders' },`,
        `);`,
        ``,
        `export { Order };`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates an Entity node for the Sequelize Model subclass', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Entity' AND name = 'Order'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('Order');
    } finally {
      closeDb(db);
    }
  });

  it('creates Field nodes for Sequelize columns', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Field'`)
        .all() as { name: string }[];
      const names = rows.map(r => r.name);
      expect(names.length).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });
});

describe('orm phase — Sequelize sequelize.define()', () => {
  const base = join(tmpdir(), `monograph-orm-sequelize-define-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'product.js'),
      [
        `const { DataTypes } = require('sequelize');`,
        ``,
        `const Product = sequelize.define('Product', {`,
        `  name: DataTypes.STRING,`,
        `  price: { type: DataTypes.FLOAT },`,
        `  sku: DataTypes.STRING,`,
        `});`,
        ``,
        `module.exports = Product;`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates an Entity node from sequelize.define()', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Entity' AND name = 'Product'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      closeDb(db);
    }
  });
});

// ── MikroORM ──────────────────────────────────────────────────────────────────

describe('orm phase — MikroORM @Entity() with @Property()', () => {
  const base = join(tmpdir(), `monograph-orm-mikro-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'book.entity.ts'),
      [
        `import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';`,
        ``,
        `@Entity()`,
        `export class Book {`,
        `  @PrimaryKey()`,
        `  id!: number;`,
        ``,
        `  @Property()`,
        `  title!: string;`,
        ``,
        `  @Property()`,
        `  isbn!: string;`,
        `}`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates an Entity node for the MikroORM entity class', () => {
    const db = openDb(dbPath);
    try {
      const row = db
        .prepare(`SELECT * FROM nodes WHERE label = 'Entity' AND name = 'Book'`)
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('Book');
    } finally {
      closeDb(db);
    }
  });

  it('creates Field nodes for @Property() decorated fields', () => {
    const db = openDb(dbPath);
    try {
      const rows = db
        .prepare(`SELECT name FROM nodes WHERE label = 'Field'`)
        .all() as { name: string }[];
      const names = rows.map(r => r.name);
      expect(names.length).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });
});

// ── No ORM patterns ───────────────────────────────────────────────────────────

describe('orm phase — no ORM patterns', () => {
  it('does not crash when no ORM patterns are detected', async () => {
    const noOrmDir = join(tmpdir(), `monograph-no-orm-${Date.now()}`);
    mkdirSync(join(noOrmDir, 'src'), { recursive: true });
    writeFileSync(join(noOrmDir, 'src', 'index.ts'), 'export const x = 42;\n');
    try {
      await expect(buildAsync(noOrmDir)).resolves.not.toThrow();
    } finally {
      rmSync(noOrmDir, { recursive: true, force: true });
    }
  }, 60000);
});
