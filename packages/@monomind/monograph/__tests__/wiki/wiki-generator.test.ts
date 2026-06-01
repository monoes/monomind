import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { generateWikiPage, generateAllWikiPages } from '../../src/wiki/wiki-generator.js';
import { upsertWikiPage, getWikiPage, listWikiPages } from '../../src/wiki/wiki-store.js';
import { buildWikiPrompt } from '../../src/wiki/prompt-builder.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

const dbPath = join(tmpdir(), `monograph-wiki-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const mockLlmClient = {
  generate: async (prompt: string): Promise<string> => {
    return `# Mock Wiki Page\n\nThis is a generated wiki page.\n\nPrompt length: ${prompt.length}`;
  },
};

const nodeA: MonographNode = {
  id: 'wiki_a',
  label: 'Function',
  name: 'doSomething',
  normLabel: 'dosomething',
  filePath: 'src/a.ts',
  startLine: 1,
  isExported: true,
  communityId: 1,
};

const nodeB: MonographNode = {
  id: 'wiki_b',
  label: 'Class',
  name: 'MyService',
  normLabel: 'myservice',
  filePath: 'src/b.ts',
  startLine: 10,
  isExported: true,
  communityId: 1,
};

const nodeC: MonographNode = {
  id: 'wiki_c',
  label: 'Function',
  name: 'helperFn',
  normLabel: 'helperfn',
  filePath: 'src/c.ts',
  startLine: 5,
  isExported: false,
  communityId: 2,
};

const edgeAB: MonographEdge = {
  id: 'e_ab',
  sourceId: 'wiki_a',
  targetId: 'wiki_b',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

const edgeBC: MonographEdge = {
  id: 'e_bc',
  sourceId: 'wiki_b',
  targetId: 'wiki_c',
  relation: 'IMPORTS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeEach(() => {
  db = openDb(dbPath);
  // Insert community records
  db.prepare('INSERT OR IGNORE INTO communities (id, label, size) VALUES (?, ?, ?)').run(1, 'Core Module', 2);
  db.prepare('INSERT OR IGNORE INTO communities (id, label, size) VALUES (?, ?, ?)').run(2, 'Utilities', 1);
  // Insert nodes
  insertNode(db, nodeA);
  insertNode(db, nodeB);
  insertNode(db, nodeC);
  // Insert edges
  insertEdge(db, edgeAB);
  insertEdge(db, edgeBC);
});

afterEach(() => {
  closeDb(db);
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('wiki-store', () => {
  it('upsertWikiPage stores and retrieves a wiki page', () => {
    upsertWikiPage(db, '1', '# Core Module\n\nThis is the core module.');
    const page = getWikiPage(db, '1');
    expect(page).not.toBeNull();
    expect(page!.communityId).toBe('1');
    expect(page!.content).toContain('Core Module');
    expect(page!.generatedAt).toBeTruthy();
  });

  it('upsertWikiPage updates existing page on conflict', () => {
    upsertWikiPage(db, '1', 'first content');
    upsertWikiPage(db, '1', 'updated content');
    const page = getWikiPage(db, '1');
    expect(page!.content).toBe('updated content');
  });

  it('getWikiPage returns null for non-existent community', () => {
    const page = getWikiPage(db, '999');
    expect(page).toBeNull();
  });

  it('listWikiPages returns all stored pages', () => {
    upsertWikiPage(db, '1', 'page 1');
    upsertWikiPage(db, '2', 'page 2');
    const pages = listWikiPages(db);
    expect(pages).toHaveLength(2);
    expect(pages.map(p => p.communityId)).toEqual(['1', '2']);
  });

  it('listWikiPages returns empty array when no pages stored', () => {
    const pages = listWikiPages(db);
    expect(pages).toHaveLength(0);
  });
});

describe('prompt-builder', () => {
  it('buildWikiPrompt includes community label and symbols', () => {
    const prompt = buildWikiPrompt({
      communityId: '1',
      label: 'Core Module',
      topSymbols: [
        { name: 'doSomething', label: 'Function', filePath: 'src/a.ts' },
        { name: 'MyService', label: 'Class', filePath: 'src/b.ts' },
      ],
      incomingCount: 5,
      outgoingCount: 3,
    });

    expect(prompt).toContain('Core Module');
    expect(prompt).toContain('doSomething');
    expect(prompt).toContain('MyService');
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('5');
    expect(prompt).toContain('3');
  });

  it('buildWikiPrompt handles empty symbols', () => {
    const prompt = buildWikiPrompt({
      communityId: '42',
      label: 'Community 42',
      topSymbols: [],
      incomingCount: 0,
      outgoingCount: 0,
    });
    expect(prompt).toContain('(none)');
  });
});

describe('generateWikiPage', () => {
  it('calls the llmClient and returns generated content', async () => {
    const content = await generateWikiPage(db, '1', { llmClient: mockLlmClient });
    expect(content).toContain('Mock Wiki Page');
    expect(content).toContain('generated wiki page');
  });

  it('persists generated content to the DB', async () => {
    await generateWikiPage(db, '1', { llmClient: mockLlmClient });
    const page = getWikiPage(db, '1');
    expect(page).not.toBeNull();
    expect(page!.content).toContain('Mock Wiki Page');
  });

  it('passes a non-empty prompt to llmClient', async () => {
    let capturedPrompt = '';
    const capturingClient = {
      generate: async (prompt: string): Promise<string> => {
        capturedPrompt = prompt;
        return '# Generated';
      },
    };
    await generateWikiPage(db, '1', { llmClient: capturingClient });
    expect(capturedPrompt.length).toBeGreaterThan(50);
    expect(capturedPrompt).toContain('Core Module');
  });

  it('throws ANTHROPIC_API_KEY not set error when no key and no client', async () => {
    const origKey = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      await expect(generateWikiPage(db, '1')).rejects.toThrow('ANTHROPIC_API_KEY not set');
    } finally {
      if (origKey !== undefined) process.env['ANTHROPIC_API_KEY'] = origKey;
    }
  });
});

describe('generateAllWikiPages', () => {
  it('generates pages for all communities', async () => {
    const result = await generateAllWikiPages(db, { llmClient: mockLlmClient });
    expect(result.generated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('skips already-generated communities when force=false', async () => {
    // Pre-generate community 1
    upsertWikiPage(db, '1', 'existing page');

    const result = await generateAllWikiPages(db, { llmClient: mockLlmClient, force: false });
    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(1);

    // Existing page should remain unchanged
    const page = getWikiPage(db, '1');
    expect(page!.content).toBe('existing page');
  });

  it('regenerates all when force=true', async () => {
    upsertWikiPage(db, '1', 'old content');
    const result = await generateAllWikiPages(db, { llmClient: mockLlmClient, force: true });
    expect(result.generated).toBe(2);
    expect(result.skipped).toBe(0);

    // Should have new content
    const page = getWikiPage(db, '1');
    expect(page!.content).toContain('Mock Wiki Page');
  });

  it('filters by communityId when provided', async () => {
    const result = await generateAllWikiPages(db, { llmClient: mockLlmClient, communityId: '1' });
    expect(result.generated).toBe(1);
    const page1 = getWikiPage(db, '1');
    const page2 = getWikiPage(db, '2');
    expect(page1).not.toBeNull();
    expect(page2).toBeNull();
  });

  it('counts errors for failed generations', async () => {
    const failingClient = {
      generate: async (): Promise<string> => {
        throw new Error('LLM failure');
      },
    };
    const result = await generateAllWikiPages(db, { llmClient: failingClient });
    expect(result.errors).toBe(2);
    expect(result.generated).toBe(0);
  });
});
