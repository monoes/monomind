/**
 * Tests for _autoIndexKnowledge in .claude/helpers/utils/micro-agents.cjs
 * Uses CLAUDE_PROJECT_DIR injection + require-cache invalidation.
 * All writes land in tmpDir; no project files are touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const TELE_PATH  = path.resolve(__dirname, '../../.claude/helpers/utils/telemetry.cjs');
const MONO_PATH  = path.resolve(__dirname, '../../.claude/helpers/utils/monograph.cjs');
const MICRO_PATH = path.resolve(__dirname, '../../.claude/helpers/utils/micro-agents.cjs');

function loadMicroAgents(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  delete require.cache[TELE_PATH];
  delete require.cache[MONO_PATH];
  delete require.cache[MICRO_PATH];
  return require(MICRO_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aik-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_PROJECT_DIR;
});

const KNOWLEDGE_DIR = () => path.join(tmpDir, '.monomind', 'knowledge');
const CHUNKS_FILE   = () => path.join(KNOWLEDGE_DIR(), 'chunks.jsonl');
const HASH_FILE     = () => path.join(KNOWLEDGE_DIR(), '.index-hash');

// ── no source files ───────────────────────────────────────────────────────────

describe('_autoIndexKnowledge — no source files', () => {
  it('returns 0 when CLAUDE.md, docs/todo.md, CLAUDE.local.md are all absent', () => {
    const ma = loadMicroAgents(tmpDir);
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(count).toBe(0);
  });

  it('still writes chunks.jsonl (empty) and .index-hash', () => {
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(fs.existsSync(CHUNKS_FILE())).toBe(true);
    expect(fs.existsSync(HASH_FILE())).toBe(true);
  });
});

// ── section chunking ──────────────────────────────────────────────────────────

describe('_autoIndexKnowledge — section chunking', () => {
  it('indexes a valid CLAUDE.md section and returns chunk count > 0', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, 'This is a valid section with enough content to be indexed properly by the system.');
    const ma = loadMicroAgents(tmpDir);
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(count).toBeGreaterThan(0);
  });

  it('skips sections shorter than 40 chars', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    // One short section (< 40) and one valid one
    fs.writeFileSync(claudeMd, 'Too short\n\n' + 'x'.repeat(50));
    const ma = loadMicroAgents(tmpDir);
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    // Only the 50-char section should pass
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(count);
    lines.forEach(line => {
      const chunk = JSON.parse(line);
      expect(chunk.text.length).toBeGreaterThanOrEqual(40);
    });
  });

  it('skips sections longer than 3000 chars', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    const longSection = 'x'.repeat(3001);
    const validSection = 'y'.repeat(100);
    fs.writeFileSync(claudeMd, longSection + '\n\n' + validSection);
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    lines.forEach(line => {
      const chunk = JSON.parse(line);
      expect(chunk.text.length).toBeLessThanOrEqual(3000);
    });
  });

  it('each chunk has chunkId, namespace, text, metadata fields', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, 'A properly-sized section that will be indexed as a knowledge chunk for testing.');
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const chunk = JSON.parse(lines[0]);
    expect(chunk).toHaveProperty('chunkId');
    expect(chunk).toHaveProperty('namespace', 'knowledge:shared');
    expect(chunk).toHaveProperty('text');
    expect(chunk).toHaveProperty('metadata');
    expect(chunk.metadata).toHaveProperty('filePath');
    expect(chunk.metadata).toHaveProperty('label', 'project-instructions');
  });

  it('indexes docs/todo.md when present', () => {
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'todo.md'),
      'A valid todo section that is long enough to pass the minimum length filter check here.');
    const ma = loadMicroAgents(tmpDir);
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(count).toBeGreaterThan(0);
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    const hasTodo = lines.some(l => JSON.parse(l).metadata.label === 'project-todo');
    expect(hasTodo).toBe(true);
  });

  it('splits on double-newlines to produce multiple chunks from one file', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    const sectionA = 'First section content that is definitely more than forty characters long.';
    const sectionB = 'Second section content that is also definitely more than forty characters long.';
    fs.writeFileSync(claudeMd, sectionA + '\n\n' + sectionB);
    const ma = loadMicroAgents(tmpDir);
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ── hash-based early exit ─────────────────────────────────────────────────────

describe('_autoIndexKnowledge — hash-based early exit', () => {
  it('returns 0 on second call when file has not changed', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, 'Stable content that will not change between the two indexing calls made here.');
    const ma = loadMicroAgents(tmpDir);
    const firstCount = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(firstCount).toBeGreaterThan(0);
    // Second call: same file, same hash → early exit
    const secondCount = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(secondCount).toBe(0);
  });

  it('re-indexes when .index-hash does not match current content hash', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, 'Original content that will be changed to force a re-index of the knowledge base.');
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    // Invalidate by writing a stale hash
    fs.writeFileSync(HASH_FILE(), 'stale-hash-value-that-does-not-match');
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(count).toBeGreaterThan(0);
  });

  it('re-indexes when chunks.jsonl is empty even if hash matches', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, 'Content for testing the empty-chunks re-index path in auto index knowledge.');
    const ma = loadMicroAgents(tmpDir);
    // First index to get the real hash
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    const realHash = fs.readFileSync(HASH_FILE(), 'utf-8').trim();
    // Wipe chunks but keep the correct hash
    fs.writeFileSync(CHUNKS_FILE(), '');
    fs.writeFileSync(HASH_FILE(), realHash);
    const count = ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    expect(count).toBeGreaterThan(0);
  });
});

// ── legacy graph.json injection ───────────────────────────────────────────────

describe('_autoIndexKnowledge — legacy graph.json injection', () => {
  it('injects a monograph summary chunk when legacy stats.json + graph.json exist', () => {
    const claudeMd = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, 'Section to ensure at least one source chunk is produced by the indexer.');
    const graphDir = path.join(tmpDir, '.monomind', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(path.join(graphDir, 'stats.json'), JSON.stringify({ nodes: 42, edges: 100, builtAt: '2025-01-01' }));
    fs.writeFileSync(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    const hasSummary = lines.some(l => JSON.parse(l).metadata?.label === 'monograph-graph-summary');
    expect(hasSummary).toBe(true);
  });

  it('legacy summary text contains node/edge counts from stats.json', () => {
    const graphDir = path.join(tmpDir, '.monomind', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(path.join(graphDir, 'stats.json'), JSON.stringify({ nodes: 77, edges: 200 }));
    fs.writeFileSync(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [] }));
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    const summary = lines.map(l => JSON.parse(l)).find(c => c.metadata?.label === 'monograph-graph-summary');
    expect(summary).toBeDefined();
    expect(summary.text).toContain('77');
    expect(summary.text).toContain('200');
  });

  it('skips legacy injection when graph.json exceeds 10 MB', () => {
    const graphDir = path.join(tmpDir, '.monomind', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(path.join(graphDir, 'stats.json'), JSON.stringify({ nodes: 10, edges: 20 }));
    // Write a file larger than 10 MB
    const bigContent = Buffer.alloc(11 * 1024 * 1024, 'x');
    fs.writeFileSync(path.join(graphDir, 'graph.json'), bigContent);
    const ma = loadMicroAgents(tmpDir);
    ma._autoIndexKnowledge(KNOWLEDGE_DIR());
    const lines = fs.readFileSync(CHUNKS_FILE(), 'utf-8').trim().split('\n').filter(Boolean);
    const hasSummary = lines.some(l => {
      try { return JSON.parse(l).metadata?.label === 'monograph-graph-summary'; } catch { return false; }
    });
    expect(hasSummary).toBe(false);
  });
});
