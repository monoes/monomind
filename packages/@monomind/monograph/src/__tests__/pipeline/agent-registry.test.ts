import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';
import { parseDefinition } from '../../pipeline/phases/agent-registry.js';
import { searchGraph } from '../../search/hybrid-query.js';

describe('parseDefinition', () => {
  it('reads flat frontmatter and ignores nested blocks', () => {
    const def = parseDefinition(
      'Agent',
      '.claude/agents/core/coder.md',
      '---\nname: coder\ndescription: "Writes code, \\"fast\\""\ntags: [code, tdd]\ncategory: core\ncapability:\n  role: coder\n---\nBody text',
    );
    expect(def).toMatchObject({
      name: 'coder',
      tags: ['code', 'tdd'],
      category: 'core',
      body: 'Body text',
    });
    expect(def?.description).toBe('Writes code, "fast"');
  });

  it('rejects files without a name', () => {
    expect(parseDefinition('Skill', 'x/SKILL.md', '---\ndescription: nameless\n---\n')).toBeNull();
    expect(parseDefinition('Skill', 'x/SKILL.md', 'no frontmatter')).toBeNull();
  });
});

describe('agent registry in the graph', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-registry-'));
    mkdirSync(join(tmpDir, '.claude', 'agents', 'core'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'skills', 'invoicing'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'));
    writeFileSync(join(tmpDir, 'src', 'billing.ts'), 'export function charge() { return 1; }\n');
    writeFileSync(
      join(tmpDir, '.claude', 'agents', 'core', 'biller.md'),
      '---\nname: biller\ndescription: Handles customer payments and refunds\nwhen_to_use: Use for payment disputes\ntags: [payments]\ncategory: finance\n---\nWorks in src/billing.ts and never touches src/missing.ts.\n',
    );
    writeFileSync(
      join(tmpDir, '.claude', 'skills', 'invoicing', 'SKILL.md'),
      '---\nname: invoicing\ndescription: Create and send invoices\n---\nSteps.\n',
    );
    await buildAsync(tmpDir, { includeToolAssets: true });
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexes agents and skills as their own node labels', () => {
    const rows = db
      .prepare("SELECT label, name FROM nodes WHERE label IN ('Agent','Skill') ORDER BY name")
      .all();
    expect(rows).toEqual([
      { label: 'Agent', name: 'biller' },
      { label: 'Skill', name: 'invoicing' },
    ]);
  });

  it('links a definition to the repository files its text names, and only real ones', () => {
    const targets = db
      .prepare(
        "SELECT t.file_path AS p FROM edges e JOIN nodes s ON s.id = e.source_id JOIN nodes t ON t.id = e.target_id WHERE s.name = 'biller' AND e.relation = 'REFERENCES'",
      )
      .all();
    expect(targets).toEqual([{ p: 'src/billing.ts' }]);
  });

  it('finds the agent that handles a task described in plain words', () => {
    const hits = searchGraph(db, 'who handles customer refunds', { scope: 'agents', limit: 3 });
    expect(hits[0]?.name).toBe('biller');
  });

  it('puts agents first when the question asks for an agent', () => {
    const hits = searchGraph(db, 'which agent handles payment disputes', { limit: 4 });
    expect(hits[0]?.label).toBe('Agent');
  });

  it('survives a rebuild without duplicating definitions', async () => {
    await buildAsync(tmpDir, { force: true, includeToolAssets: true });
    const check = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
    const n = (
      check.prepare("SELECT COUNT(*) AS n FROM nodes WHERE label IN ('Agent','Skill')").get() as {
        n: number;
      }
    ).n;
    check.close();
    expect(n).toBe(2);
  }, 60_000);
});

describe('tool-managed assets are left out of the index by default', () => {
  let tmpDir: string;

  const nodeFiles = async (opts: { includeToolAssets?: boolean }): Promise<string[]> => {
    await buildAsync(tmpDir, { force: true, ...opts });
    const db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
    const rows = db.prepare('SELECT DISTINCT file_path AS p FROM nodes').all() as { p: string }[];
    db.close();
    return rows.map((r) => r.p);
  };

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tool-assets-'));
    mkdirSync(join(tmpDir, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(tmpDir, '.pi', 'extensions'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'));
    writeFileSync(join(tmpDir, 'src', 'app.ts'), 'export function run() { return 1; }\n');
    writeFileSync(join(tmpDir, '.pi', 'extensions', 'mesh.ts'), 'export function meshHook() {}\n');
    writeFileSync(
      join(tmpDir, '.claude', 'agents', 'coder.md'),
      '---\nname: coder\ndescription: Writes code\n---\nBody.\n',
    );
  });

  afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('skips .pi/ and .claude/ definitions by default', async () => {
    const files = await nodeFiles({});
    expect(files).toContain('src/app.ts');
    expect(files.filter((f) => f.startsWith('.pi/') || f.startsWith('.claude/'))).toEqual([]);
  }, 60_000);

  it('indexes them when includeToolAssets is set', async () => {
    const files = await nodeFiles({ includeToolAssets: true });
    expect(files).toContain('.pi/extensions/mesh.ts');
    expect(files).toContain('.claude/agents/coder.md');
  }, 60_000);
});
