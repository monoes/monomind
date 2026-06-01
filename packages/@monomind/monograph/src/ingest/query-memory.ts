/**
 * Q&A memory feedback loop.
 *
 * Mirrors graphify's `save_query_result`: saves question/answer pairs as
 * Markdown files with YAML front-matter into a memory directory.  On the next
 * rebuild those files are treated as document nodes, so the graph grows smarter
 * from both what you add AND what you ask.
 *
 * Intended for use after `monographQuery` / `monographExplain` calls so that
 * insights are persisted and available during future pipeline runs.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SaveQueryResultOptions {
  /** Question / query string. */
  question: string;
  /** Answer produced by the graph query. */
  answer: string;
  /**
   * Directory where memory files are written.
   * Defaults to `<cwd>/monograph-out/memory`.
   */
  memoryDir?: string;
  /** Free-form query type label (e.g. "query", "explain", "impact"). Default: "query". */
  queryType?: string;
  /**
   * Up to 10 node ids / names that were the primary sources for the answer.
   * These are stored in front-matter so a future extraction pass can wire up
   * edges to the originating nodes.
   */
  sourceNodes?: string[];
}

export interface SaveQueryResultOutput {
  /** Absolute path of the written Markdown file. */
  filePath: string;
  /** ISO-8601 timestamp of when the file was written. */
  writtenAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function yamlStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');
}

function slug(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w]/g, '_')
    .slice(0, 50)
    .replace(/^_+|_+$/g, '');
}

function isoNow(): string {
  return new Date().toISOString();
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').slice(0, 15);
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Save a Q&A query result as a Markdown file in the memory directory.
 *
 * The file has YAML front-matter that monograph's document extractor reads
 * as node metadata.  The body contains the question and answer in a
 * human-readable format.
 *
 * @param options - Query options including question, answer, and target dir.
 * @returns The file path and write timestamp.
 */
export function saveQueryResult(options: SaveQueryResultOptions): SaveQueryResultOutput {
  const {
    question,
    answer,
    memoryDir = join(process.cwd(), 'monograph-out', 'memory'),
    queryType = 'query',
    sourceNodes,
  } = options;

  mkdirSync(memoryDir, { recursive: true });

  const now = isoNow();
  const ts = timestamp();
  const s = slug(question);
  const filename = `query_${ts}_${s}.md`;
  const filePath = join(memoryDir, filename);

  const frontmatterLines = [
    '---',
    `type: "${queryType}"`,
    `date: "${now}"`,
    `question: "${yamlStr(question)}"`,
    'contributor: "monograph"',
  ];

  if (sourceNodes && sourceNodes.length > 0) {
    const limited = sourceNodes.slice(0, 10);
    const nodesStr = limited.map(n => `"${yamlStr(n)}"`).join(', ');
    frontmatterLines.push(`source_nodes: [${nodesStr}]`);
  }

  frontmatterLines.push('---');

  const bodyLines = [
    '',
    `# Q: ${question}`,
    '',
    '## Answer',
    '',
    answer,
  ];

  if (sourceNodes && sourceNodes.length > 0) {
    bodyLines.push('', '## Source Nodes', '');
    for (const n of sourceNodes) {
      bodyLines.push(`- ${n}`);
    }
  }

  const content = [...frontmatterLines, ...bodyLines].join('\n');
  writeFileSync(filePath, content, 'utf-8');

  return { filePath, writtenAt: now };
}
