import type { MonographNode, SymbolCandidate } from '@monoes/monograph';
import type { MCPToolResult } from '../types.js';
import { text } from './shared.js';

/**
 * Human-readable text plus the machine-readable result it was rendered from.
 *
 * The adapters below used to `as any`-cast library results and read fields
 * that did not exist on them (`rn.occurrences`, `rn.references`), so a valid
 * result rendered as "Occurrences: 0". Typing the boundary against the real
 * library types turns that class of drift into a compile error; emitting the
 * structured payload alongside the prose means callers never have to re-parse
 * the prose to recover counts, locations, risk level, or error state.
 */
export function textWithData(readable: string, data: unknown, isError = false): MCPToolResult {
  return {
    content: [
      { type: 'text', text: readable },
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

/** Location suffix for a graph node: `file:line`, `file`, or empty. */
export function nodeLocation(node: Pick<MonographNode, 'filePath' | 'startLine'>): string {
  if (!node.filePath) return '';
  return node.startLine != null ? `${node.filePath}:${node.startLine}` : node.filePath;
}

/**
 * A name that matched several definitions: list them (non-test first, as the
 * library ranks them) instead of answering about one. A confident verdict on
 * the wrong definition — say, a test mock with 0 callers — is worse than asking.
 */
export function ambiguityResult(name: string, candidates: SymbolCandidate[]): MCPToolResult {
  // Prose only: the candidates are already listed line by line, a JSON copy repeats them.
  return text(
    [
      `"${name}" matches ${candidates.length} definitions — re-run with nodeId (or filePath) to pick one:`,
      ...candidates.map(
        (c) =>
          `  nodeId=${c.id}  [${c.label}] ${c.name}  ${c.filePath ?? '(no path)'}${
            c.startLine != null ? `:${c.startLine}` : ''
          }`,
      ),
    ].join('\n'),
  );
}
