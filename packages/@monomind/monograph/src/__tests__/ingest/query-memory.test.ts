import { describe, it, expect, afterEach } from 'vitest';
import { saveQueryResult } from '../../ingest/query-memory.js';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'monograph-qmem-test-'));
}

describe('saveQueryResult', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try { rmSync(d, { recursive: true }); } catch { /* ignore */ }
    }
    dirs.length = 0;
  });

  it('creates the memory directory if it does not exist', () => {
    const memDir = join(makeTempDir(), 'sub', 'memory');
    dirs.push(memDir.split('/').slice(0, -2).join('/'));
    saveQueryResult({ question: 'What is X?', answer: 'X is Y.', memoryDir: memDir });
    const { existsSync } = require('fs');
    expect(existsSync(memDir)).toBe(true);
  });

  it('writes a Markdown file with YAML front-matter', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const result = saveQueryResult({ question: 'What is X?', answer: 'X is Y.', memoryDir: memDir });
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('type: "query"');
    expect(content).toContain('question: "What is X?"');
    expect(content).toContain('contributor: "monograph"');
    expect(content).toContain('# Q: What is X?');
    expect(content).toContain('X is Y.');
  });

  it('includes a date field in the front-matter', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const result = saveQueryResult({ question: 'Test?', answer: 'Yes.', memoryDir: memDir });
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toMatch(/date: "\d{4}-\d{2}-\d{2}/);
  });

  it('includes source_nodes in front-matter when provided', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const result = saveQueryResult({
      question: 'Who calls auth?',
      answer: 'login calls auth.',
      memoryDir: memDir,
      sourceNodes: ['login', 'auth'],
    });
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('source_nodes:');
    expect(content).toContain('"login"');
    expect(content).toContain('"auth"');
  });

  it('includes Source Nodes section in body when sourceNodes provided', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const result = saveQueryResult({
      question: 'Q',
      answer: 'A',
      memoryDir: memDir,
      sourceNodes: ['nodeA'],
    });
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('## Source Nodes');
    expect(content).toContain('- nodeA');
  });

  it('limits source_nodes to 10 entries in front-matter', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const manyNodes = Array.from({ length: 15 }, (_, i) => `node${i}`);
    const result = saveQueryResult({
      question: 'Q',
      answer: 'A',
      memoryDir: memDir,
      sourceNodes: manyNodes,
    });
    const content = readFileSync(result.filePath, 'utf-8');
    // front-matter line has at most 10 quoted node names
    const fmLine = content.split('\n').find(l => l.startsWith('source_nodes:'))!;
    const matches = fmLine.match(/"node\d+"/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(10);
  });

  it('uses custom queryType in front-matter', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const result = saveQueryResult({ question: 'Q', answer: 'A', memoryDir: memDir, queryType: 'impact' });
    const content = readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('type: "impact"');
  });

  it('returns the written file path and writtenAt timestamp', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const before = new Date().toISOString();
    const result = saveQueryResult({ question: 'Q', answer: 'A', memoryDir: memDir });
    const after = new Date().toISOString();
    expect(result.filePath).toContain(memDir);
    expect(result.filePath.endsWith('.md')).toBe(true);
    expect(result.writtenAt >= before).toBe(true);
    expect(result.writtenAt <= after).toBe(true);
  });

  it('escapes double quotes in the question', () => {
    const memDir = makeTempDir();
    dirs.push(memDir);
    const result = saveQueryResult({ question: 'Say "hello"?', answer: 'Hi.', memoryDir: memDir });
    const content = readFileSync(result.filePath, 'utf-8');
    // YAML value should escape the inner quotes
    expect(content).toContain('\\"hello\\"');
  });
});
