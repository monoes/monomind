import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';
import {
  buildSummaryText,
  extractFileHeader,
  extractLeadingComment,
  splitWords,
} from '../../pipeline/phases/summaries.js';
import { searchGraph } from '../../search/hybrid-query.js';
import { contentWords, summarySearch } from '../../storage/summary-search.js';

describe('summary text', () => {
  it('splits identifiers into words', () => {
    expect(splitWords('pickAgents')).toBe('pick Agents');
    expect(splitWords('HTTPServer_start')).toBe('HTTP Server start');
    expect(splitWords('agent-pick.ts')).toBe('agent pick');
  });

  it('reads a JSDoc block above a symbol and skips decorators', () => {
    const lines = ['/**', ' * Rank agents for a task.', ' * @param task the task', ' */', '@Cached()', 'export function pickAgents() {}'];
    expect(extractLeadingComment(lines, 6)).toBe('Rank agents for a task. task the task');
  });

  it('reads line comments and python docstrings', () => {
    expect(extractLeadingComment(['// Find stale nodes', 'function stale() {}'], 2)).toBe('Find stale nodes');
    expect(extractLeadingComment(['def stale():', '    """Find stale nodes."""', '    pass'], 1)).toBe('Find stale nodes.');
  });

  it('returns nothing for an undocumented symbol', () => {
    expect(extractLeadingComment(['const x = 1;', 'function f() {}'], 2)).toBe('');
  });

  it('reads the file header past a shebang', () => {
    expect(extractFileHeader(['#!/usr/bin/env node', '// Builds the release notes', '', 'import x']).length).toBeGreaterThan(0);
  });

  it('combines name, comment and location', () => {
    expect(buildSummaryText('pickAgents', 'src/routing/agent-pick.ts', 'Rank agents')).toBe(
      'pick Agents Rank agents agent pick routing',
    );
  });

  it('keeps content words and drops filler', () => {
    expect(contentWords('which agent should handle a task')).toEqual(['agent', 'task']);
  });
});

describe('summary search end to end', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'summaries-'));
    writeFileSync(
      join(tmpDir, 'router.ts'),
      '/** Decide which worker takes an incoming job. */\nexport function dispatchJob() { return 1; }\n',
    );
    writeFileSync(join(tmpDir, 'other.ts'), 'export function unrelatedThing() { return 2; }\n');
    await buildAsync(tmpDir, { codeOnly: true });
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds a symbol by what its comment says, not its name', () => {
    const hits = searchGraph(db, 'which worker takes a job', { limit: 3 });
    expect(hits[0]?.name).toBe('dispatchJob');
  });

  it('matches across word forms (stemming)', () => {
    expect(summarySearch(db, 'deciding workers', 5).map((h) => h.name)).toContain('dispatchJob');
  });

  it('returns nothing for a single-word query', () => {
    expect(summarySearch(db, 'worker', 5)).toEqual([]);
  });
});
