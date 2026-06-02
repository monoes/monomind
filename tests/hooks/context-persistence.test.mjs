/**
 * Tests for .claude/helpers/context-persistence-hook.mjs
 * Focuses on pure exported utility functions (no SQLite / MonoVector needed).
 * Imports the ESM module directly — better-sqlite3 is only loaded lazily inside
 * SQLiteBackend.initialize() which is not called in these tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  hashContent,
  parseTranscript,
  extractTextContent,
  extractToolCalls,
  extractFilePaths,
  chunkTranscript,
  extractSummary,
  buildEntry,
  buildCompactInstructions,
  createHashEmbedding,
  formatTokens,
  buildProgressBar,
  computeImportance,
  getMonoVectorConfig,
  estimateContextTokens,
  NAMESPACE,
} from '../../.claude/helpers/context-persistence-hook.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cph-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── hashContent ──────────────────────────────────────────────────────────────

describe('context-persistence hashContent', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const h = hashContent('hello world');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashContent('test')).toBe(hashContent('test'));
  });

  it('different inputs produce different hashes', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

// ── createHashEmbedding ──────────────────────────────────────────────────────

describe('context-persistence createHashEmbedding', () => {
  it('returns a Float32Array of the requested size', () => {
    const emb = createHashEmbedding('hello', 16);
    expect(emb).toBeInstanceOf(Float32Array);
    expect(emb.length).toBe(16);
  });

  it('is deterministic for the same input', () => {
    const a = createHashEmbedding('consistent', 8);
    const b = createHashEmbedding('consistent', 8);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('different inputs produce different embeddings', () => {
    const a = createHashEmbedding('alpha', 8);
    const b = createHashEmbedding('beta', 8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('produces L2-normalised output (magnitude ≈ 1.0)', () => {
    const emb = createHashEmbedding('normalise test', 64);
    const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('defaults to 384 dimensions', () => {
    const emb = createHashEmbedding('test');
    expect(emb.length).toBe(384);
  });
});

// ── formatTokens ─────────────────────────────────────────────────────────────

describe('context-persistence formatTokens', () => {
  it('formats numbers < 1000 as plain integers', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1000)).toBe('1.0K');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(200000)).toBe('200.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(2500000)).toBe('2.5M');
  });
});

// ── buildProgressBar ─────────────────────────────────────────────────────────

describe('context-persistence buildProgressBar', () => {
  it('returns a string in bracket format', () => {
    const bar = buildProgressBar(0.5);
    expect(bar).toMatch(/^\[.{20}\]$/);
  });

  it('is 22 chars total (brackets + 20 fill)', () => {
    expect(buildProgressBar(0.0).length).toBe(22);
    expect(buildProgressBar(1.0).length).toBe(22);
  });

  it('uses "=" for normal usage (< 70%)', () => {
    const bar = buildProgressBar(0.5);
    expect(bar).toContain('=');
  });

  it('uses "#" for warning usage (70–84%)', () => {
    const bar = buildProgressBar(0.75);
    expect(bar).toContain('#');
  });

  it('uses "!" for critical usage (≥ 85%)', () => {
    const bar = buildProgressBar(0.9);
    expect(bar).toContain('!');
  });

  it('0% is all dashes', () => {
    expect(buildProgressBar(0)).toBe('[--------------------]');
  });

  it('100% is all fill characters', () => {
    const bar = buildProgressBar(1.0);
    expect(bar).not.toContain('-');
  });
});

// ── getMonoVectorConfig ────────────────────────────────────────────────────────

describe('context-persistence getMonoVectorConfig', () => {
  it('returns null when MONOVECTOR_HOST, PGHOST, etc. are not set', () => {
    const ALL_KEYS = ['MONOVECTOR_HOST', 'PGHOST', 'MONOVECTOR_DATABASE', 'PGDATABASE', 'MONOVECTOR_USER', 'PGUSER'];
    const saved = {};
    for (const k of ALL_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    expect(getMonoVectorConfig()).toBeNull();
    for (const k of ALL_KEYS) { if (saved[k] !== undefined) process.env[k] = saved[k]; }
  });
});

// ── extractTextContent ────────────────────────────────────────────────────────

describe('context-persistence extractTextContent', () => {
  it('returns empty string for null/undefined message', () => {
    expect(extractTextContent(null)).toBe('');
    expect(extractTextContent(undefined)).toBe('');
  });

  it('returns string content directly', () => {
    expect(extractTextContent({ content: 'hello world' })).toBe('hello world');
  });

  it('concatenates text blocks from array content', () => {
    const msg = { content: [
      { type: 'text', text: 'first' },
      { type: 'tool_result', content: 'ignored' },
      { type: 'text', text: 'second' },
    ]};
    expect(extractTextContent(msg)).toBe('first\nsecond');
  });

  it('falls back to message.text if no content field', () => {
    expect(extractTextContent({ text: 'from text field' })).toBe('from text field');
  });
});

// ── extractToolCalls ──────────────────────────────────────────────────────────

describe('context-persistence extractToolCalls', () => {
  it('returns [] for message with no content array', () => {
    expect(extractToolCalls({ content: 'string' })).toEqual([]);
    expect(extractToolCalls(null)).toEqual([]);
  });

  it('extracts tool_use blocks from content array', () => {
    const msg = { content: [
      { type: 'text', text: 'I will read a file' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/src/foo.ts' } },
    ]};
    const result = extractToolCalls(msg);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Read');
    expect(result[0].input.file_path).toBe('/src/foo.ts');
  });

  it('extracts multiple tool calls', () => {
    const msg = { content: [
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'tool_use', name: 'Write', input: {} },
    ]};
    expect(extractToolCalls(msg).length).toBe(2);
  });
});

// ── extractFilePaths ──────────────────────────────────────────────────────────

describe('context-persistence extractFilePaths', () => {
  it('returns [] for empty tool calls', () => {
    expect(extractFilePaths([])).toEqual([]);
  });

  it('extracts file_path from tool call inputs', () => {
    const paths = extractFilePaths([{ name: 'Read', input: { file_path: '/src/auth.ts' } }]);
    expect(paths).toContain('/src/auth.ts');
  });

  it('extracts path from tool call inputs', () => {
    const paths = extractFilePaths([{ name: 'Edit', input: { path: '/src/utils.ts' } }]);
    expect(paths).toContain('/src/utils.ts');
  });

  it('deduplicates paths', () => {
    const paths = extractFilePaths([
      { name: 'Read', input: { file_path: '/src/a.ts' } },
      { name: 'Edit', input: { file_path: '/src/a.ts' } },
    ]);
    expect(paths.length).toBe(1);
    expect(paths[0]).toBe('/src/a.ts');
  });

  it('extracts notebook_path from tool call inputs', () => {
    const paths = extractFilePaths([{ name: 'NotebookEdit', input: { notebook_path: '/notebooks/analysis.ipynb' } }]);
    expect(paths).toContain('/notebooks/analysis.ipynb');
  });
});

// ── parseTranscript ───────────────────────────────────────────────────────────

describe('context-persistence parseTranscript', () => {
  it('returns [] for non-existent file', () => {
    expect(parseTranscript(path.join(tmpDir, 'nonexistent.jsonl'))).toEqual([]);
  });

  it('parses SDK-wrapped messages (message.role format)', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi there' } }),
    ].join('\n');
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, lines + '\n');
    const msgs = parseTranscript(transcriptPath);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
  });

  it('parses flat message format (role at top level)', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: 'question' }),
      JSON.stringify({ role: 'assistant', content: 'answer' }),
    ].join('\n');
    const transcriptPath = path.join(tmpDir, 'flat.jsonl');
    fs.writeFileSync(transcriptPath, lines + '\n');
    const msgs = parseTranscript(transcriptPath);
    expect(msgs.length).toBe(2);
  });

  it('skips malformed lines', () => {
    const lines = ['not json', JSON.stringify({ role: 'user', content: 'ok' })].join('\n');
    const transcriptPath = path.join(tmpDir, 'mixed.jsonl');
    fs.writeFileSync(transcriptPath, lines + '\n');
    const msgs = parseTranscript(transcriptPath);
    expect(msgs.length).toBe(1);
  });

  it('skips non-message entries like progress and file-history-snapshot', () => {
    const lines = [
      JSON.stringify({ type: 'progress', value: 50 }),
      JSON.stringify({ type: 'file-history-snapshot', files: [] }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'real message' } }),
    ].join('\n');
    const transcriptPath = path.join(tmpDir, 'with-meta.jsonl');
    fs.writeFileSync(transcriptPath, lines + '\n');
    const msgs = parseTranscript(transcriptPath);
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('user');
  });
});

// ── chunkTranscript ───────────────────────────────────────────────────────────

describe('context-persistence chunkTranscript', () => {
  it('returns [] for empty messages', () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it('groups user+assistant pairs into chunks', () => {
    const messages = [
      { role: 'user', content: 'question 1' },
      { role: 'assistant', content: 'answer 1' },
      { role: 'user', content: 'question 2' },
      { role: 'assistant', content: 'answer 2' },
    ];
    const chunks = chunkTranscript(messages);
    expect(chunks.length).toBe(2);
    expect(chunks[0].turnIndex).toBe(0);
    expect(chunks[1].turnIndex).toBe(1);
  });

  it('each chunk has userMessage, assistantMessage, toolCalls', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const [chunk] = chunkTranscript(messages);
    expect(chunk).toHaveProperty('userMessage');
    expect(chunk).toHaveProperty('assistantMessage');
    expect(chunk).toHaveProperty('toolCalls');
    expect(Array.isArray(chunk.toolCalls)).toBe(true);
  });

  it('skips synthetic user messages (all tool_result blocks) mid-stream', () => {
    const messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'result' }] }, // synthetic
      { role: 'user', content: 'real question 2' },
      { role: 'assistant', content: 'answer 2' },
    ];
    const chunks = chunkTranscript(messages);
    expect(chunks.length).toBe(2);
  });

  it('treats empty content array as synthetic (vacuous every) and skips it', () => {
    const messages = [
      { role: 'user', content: [] },            // [].every(...) === true → synthetic
      { role: 'user', content: 'real question' },
      { role: 'assistant', content: 'answer' },
    ];
    const chunks = chunkTranscript(messages);
    expect(chunks.length).toBe(1);
    expect(extractTextContent(chunks[0].userMessage)).toContain('real question');
  });

  it('skips a synthetic user message that arrives first (no prior chunk)', () => {
    const messages = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'result' }] }, // synthetic, first
      { role: 'user', content: 'real question' },
      { role: 'assistant', content: 'real answer' },
    ];
    const chunks = chunkTranscript(messages);
    expect(chunks.length).toBe(1);
    expect(extractTextContent(chunks[0].userMessage)).toContain('real question');
  });
});

// ── extractSummary ────────────────────────────────────────────────────────────

describe('context-persistence extractSummary', () => {
  it('returns a string', () => {
    const chunk = {
      userMessage: { content: 'What is the best approach?' },
      assistantMessage: { content: 'I recommend using functional components.' },
      toolCalls: [],
      turnIndex: 0,
    };
    expect(typeof extractSummary(chunk)).toBe('string');
  });

  it('includes first user line in summary', () => {
    const chunk = {
      userMessage: { content: 'Implement authentication module' },
      assistantMessage: { content: 'I will add JWT support.' },
      toolCalls: [],
      turnIndex: 0,
    };
    const summary = extractSummary(chunk);
    expect(summary).toContain('Implement authentication module');
  });

  it('includes tool names when present', () => {
    const chunk = {
      userMessage: { content: 'fix the bug' },
      assistantMessage: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/src/bug.ts' } }] },
      toolCalls: [{ name: 'Edit', input: { file_path: '/src/bug.ts' } }],
      turnIndex: 0,
    };
    const summary = extractSummary(chunk);
    expect(summary).toContain('Edit');
  });

  it('is capped at 300 chars', () => {
    const longText = 'x'.repeat(500);
    const chunk = {
      userMessage: { content: longText },
      assistantMessage: { content: longText },
      toolCalls: [],
      turnIndex: 0,
    };
    expect(extractSummary(chunk).length).toBeLessThanOrEqual(300);
  });
});

// ── buildEntry ────────────────────────────────────────────────────────────────

describe('context-persistence buildEntry', () => {
  const makeChunk = () => ({
    userMessage: { content: 'Implement the login feature' },
    assistantMessage: { content: 'I will add the login logic.' },
    toolCalls: [],
    turnIndex: 3,
  });

  it('returns an entry with required fields', () => {
    const entry = buildEntry(makeChunk(), 'sess-123', 'pre-compact', new Date().toISOString());
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('key');
    expect(entry).toHaveProperty('content');
    expect(entry).toHaveProperty('type', 'episodic');
    expect(entry).toHaveProperty('namespace', NAMESPACE);
    expect(entry).toHaveProperty('metadata');
    expect(entry).toHaveProperty('createdAt');
  });

  it('key includes session ID and turn index', () => {
    const entry = buildEntry(makeChunk(), 'sess-abc', 'pre-compact', '2024-01-01');
    expect(entry.key).toContain('sess-abc');
    expect(entry.key).toMatch(/:3:/);
  });

  it('content includes both user and assistant text', () => {
    const entry = buildEntry(makeChunk(), 'sess-1', 'test', '2024-01-01');
    expect(entry.content).toContain('Implement the login feature');
    expect(entry.content).toContain('I will add the login logic.');
  });

  it('metadata.contentHash is a SHA256 hex string', () => {
    const entry = buildEntry(makeChunk(), 'sess-1', 'test', '2024-01-01');
    expect(entry.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── buildCompactInstructions ──────────────────────────────────────────────────

describe('context-persistence buildCompactInstructions', () => {
  const makeChunks = (n = 2) => Array.from({ length: n }, (_, i) => ({
    userMessage: { content: `question ${i}` },
    assistantMessage: { content: `answer ${i}` },
    toolCalls: [],
    turnIndex: i,
  }));

  it('returns a non-empty string', () => {
    const result = buildCompactInstructions(makeChunks(), 'sess-1', { stored: 2, deduped: 0 });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains COMPACTION GUIDANCE header', () => {
    const result = buildCompactInstructions(makeChunks(), 'sess-1', { stored: 2, deduped: 0 });
    expect(result).toContain('COMPACTION GUIDANCE');
  });

  it('mentions the session ID', () => {
    const result = buildCompactInstructions(makeChunks(), 'test-session-id', { stored: 1, deduped: 0 });
    expect(result).toContain('test-session-id');
  });

  it('is capped at COMPACT_INSTRUCTION_BUDGET (default 2000)', () => {
    const manyChunks = makeChunks(50);
    const result = buildCompactInstructions(manyChunks, 'sess', { stored: 50, deduped: 0 });
    expect(result.length).toBeLessThanOrEqual(2000);
  });
});

// ── computeImportance ────────────────────────────────────────────────────────

describe('context-persistence computeImportance', () => {
  it('returns a positive number', () => {
    const entry = { accessCount: 1, createdAt: Date.now() - 1000, metadata: { toolNames: ['Read'], filePaths: ['/src/a.ts'] } };
    expect(computeImportance(entry, Date.now())).toBeGreaterThan(0);
  });

  it('newer entries score higher than older (same access count)', () => {
    const now = Date.now();
    const newEntry = { accessCount: 0, createdAt: now - 1000, metadata: {} };
    const oldEntry = { accessCount: 0, createdAt: now - 30 * 24 * 60 * 60 * 1000, metadata: {} };
    expect(computeImportance(newEntry, now)).toBeGreaterThan(computeImportance(oldEntry, now));
  });

  it('entries with tool calls score higher (richness bonus)', () => {
    const now = Date.now();
    const rich = { accessCount: 0, createdAt: now - 1000, metadata: { toolNames: ['Edit', 'Read'], filePaths: ['/src/a.ts'] } };
    const plain = { accessCount: 0, createdAt: now - 1000, metadata: {} };
    expect(computeImportance(rich, now)).toBeGreaterThan(computeImportance(plain, now));
  });
});

// ── estimateContextTokens ────────────────────────────────────────────────────

describe('context-persistence estimateContextTokens', () => {
  it('returns {tokens:0, turns:0, method:"none"} for non-existent file', () => {
    const result = estimateContextTokens(path.join(tmpDir, 'nope.jsonl'));
    expect(result.tokens).toBe(0);
    expect(result.turns).toBe(0);
    expect(result.method).toBe('none');
  });

  it('returns char-based estimate for transcript without API usage data', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ role: 'user', content: 'hello world' }),
      JSON.stringify({ role: 'assistant', content: 'hi there friend' }),
    ].join('\n') + '\n');
    const result = estimateContextTokens(transcriptPath);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.method).toBe('char-estimate');
    expect(result.turns).toBe(1);
  });

  it('uses API usage data when present in assistant messages', () => {
    const transcriptPath = path.join(tmpDir, 'api-usage.jsonl');
    const line = JSON.stringify({ role: 'assistant', content: 'answer', usage: { input_tokens: 5000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } });
    fs.writeFileSync(transcriptPath, line + '\n');
    const result = estimateContextTokens(transcriptPath);
    expect(result.tokens).toBe(6500);
    expect(result.method).toBe('api-usage');
  });

  it('uses API usage from SDK-wrapped assistant message (message.usage shape)', () => {
    const transcriptPath = path.join(tmpDir, 'sdk-usage.jsonl');
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'reply', usage: { input_tokens: 8000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } },
    });
    fs.writeFileSync(transcriptPath, line + '\n');
    const result = estimateContextTokens(transcriptPath);
    expect(result.tokens).toBe(10000);
    expect(result.method).toBe('api-usage');
  });
});
