import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CODE_SCOPE_LABELS } from '../../search/hybrid-query.js';
import { definitionText } from './agent-registry.js';
import type { PipelinePhase } from '../types.js';

const MAX_COMMENT_CHARS = 300;
const HEADER_SCAN_LINES = 40;

/** "pickAgents" / "pick_agents" / "pick-agents.ts" → "pick Agents" words. */
export function splitWords(identifier: string): string {
  return identifier
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .trim();
}

function cleanCommentLine(line: string): string {
  return line
    .trim()
    .replace(/^\/\*\*?|\*\/$/g, '')
    .replace(/^\/\/\/?!?|^#+|^\*+/g, '')
    .replace(/@\w+\s*(\{[^}]*\})?/g, ' ')
    .trim();
}

const isCommentLine = (l: string): boolean => /^(\/\/|\/\*|\*|#(?!\[)|--|""")/.test(l.trim());

/**
 * The comment block directly above a 1-based `startLine` (JSDoc, `//`, `///`,
 * `#`), skipping decorator/attribute lines; for a Python-style `def ...:` with
 * no comment above, the docstring that follows it.
 */
export function extractLeadingComment(lines: string[], startLine: number): string {
  let i = startLine - 2;
  while (i >= 0 && /^\s*(@|#\[)/.test(lines[i])) i--;
  const block: string[] = [];
  while (i >= 0 && lines[i].trim() !== '' && isCommentLine(lines[i])) {
    block.unshift(lines[i]);
    i--;
  }
  let text = block.map(cleanCommentLine).filter(Boolean).join(' ');
  if (!text) {
    const def = lines[startLine - 1] ?? '';
    const next = (lines[startLine] ?? '').trim();
    const m = def.trimEnd().endsWith(':') && /^[rRuU]?("""|''')/.exec(next);
    if (m) {
      const quote = m[1];
      const parts: string[] = [];
      for (let j = startLine; j < Math.min(lines.length, startLine + 8); j++) {
        const part = lines[j].trim().replace(/^[rRuU]?("""|''')/, '');
        const end = part.indexOf(quote);
        parts.push(end === -1 ? part : part.slice(0, end));
        if (end !== -1) break;
      }
      text = parts.join(' ');
    }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_CHARS);
}

/** The first comment block near the top of a file (its stated purpose). */
export function extractFileHeader(lines: string[]): string {
  const head = lines.slice(0, HEADER_SCAN_LINES);
  let i = 0;
  while (i < head.length && (head[i].trim() === '' || head[i].startsWith('#!'))) i++;
  const block: string[] = [];
  while (i < head.length && isCommentLine(head[i])) block.push(head[i++]);
  return block
    .map(cleanCommentLine)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COMMENT_CHARS);
}

/** Words a person would use to describe a symbol: its name, location and comment. */
export function buildSummaryText(name: string, filePath: string | null, comment: string): string {
  const where = filePath
    ? `${splitWords(basename(filePath))} ${splitWords(basename(dirname(filePath)))}`
    : '';
  return `${splitWords(name)} ${comment} ${where}`.replace(/\s+/g, ' ').trim();
}

/** Rebuilds `node_summaries_fts` for every code symbol and file in the graph. */
export const summariesPhase: PipelinePhase<{ summarized: number }> = {
  name: 'summaries',
  deps: ['stale-sweep', 'agent-registry'],
  async execute(ctx) {
    const db = ctx.db;
    const placeholders = CODE_SCOPE_LABELS.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, label, name, file_path, start_line FROM nodes
         WHERE label IN (${placeholders}) AND file_path IS NOT NULL ORDER BY file_path`,
      )
      .all(...CODE_SCOPE_LABELS) as {
      id: string;
      label: string;
      name: string;
      file_path: string;
      start_line: number | null;
    }[];

    db.exec('DELETE FROM node_summaries_fts');
    const insert = db.prepare('INSERT INTO node_summaries_fts (node_id, text) VALUES (?, ?)');
    let summarized = 0;

    // Agent and skill definitions describe themselves in frontmatter.
    const defs = db
      .prepare("SELECT id, name, properties FROM nodes WHERE label IN ('Agent', 'Skill')")
      .all() as { id: string; name: string; properties: string | null }[];
    for (const d of defs) {
      let props: Record<string, unknown> = {};
      try {
        props = d.properties ? (JSON.parse(d.properties) as Record<string, unknown>) : {};
      } catch {
        /* malformed properties: index the name alone */
      }
      insert.run(d.id, definitionText(props, splitWords(d.name)));
      summarized++;
    }

    let currentFile = '';
    let lines: string[] = [];
    for (const r of rows) {
      if (r.file_path !== currentFile) {
        currentFile = r.file_path;
        try {
          lines = readFileSync(join(ctx.repoPath, r.file_path), 'utf8').split('\n');
        } catch {
          lines = [];
        }
      }
      const comment =
        r.label === 'File'
          ? extractFileHeader(lines)
          : r.start_line
            ? extractLeadingComment(lines, r.start_line)
            : '';
      const text = buildSummaryText(
        r.label === 'File' ? basename(r.file_path) : r.name,
        r.file_path,
        comment,
      );
      if (text) {
        insert.run(r.id, text);
        summarized++;
      }
    }
    return { summarized };
  },
};
