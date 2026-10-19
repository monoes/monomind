/**
 * Monograph CLI Command
 * Knowledge graph for code and documents — build, search, inspect.
 */

import { output } from '../output.js';
import type { Command, CommandResult } from '../types.js';
import { buildCommand } from './monograph-build.js';
import { embedCommand } from './monograph-embed.js';
import { lspCommand } from './monograph-lsp.js';
import { searchCommand } from './monograph-search.js';
import { statsCommand } from './monograph-stats.js';
import { watchCommand } from './monograph-watch.js';
import { wikiCommand } from './monograph-wiki.js';

// ── root command ──────────────────────────────────────────────────────────────

export const monographCommand: Command = {
  name: 'monograph',
  description: 'Knowledge graph for code and documents — build, search, explore',
  aliases: ['kg'],
  subcommands: [
    buildCommand,
    embedCommand,
    wikiCommand,
    searchCommand,
    statsCommand,
    watchCommand,
    lspCommand,
  ],
  examples: [
    { command: 'monomind monograph wiki', description: 'Build KG from all docs and PDFs' },
    {
      command: 'monomind monograph wiki --llm',
      description: 'Build KG with Claude semantic extraction',
    },
    { command: 'monomind monograph build', description: 'Build KG from code + docs' },
    {
      command: 'monomind monograph search -q "authentication"',
      description: 'Search the knowledge graph',
    },
    { command: 'monomind monograph stats', description: 'Show graph statistics' },
    { command: 'monomind monograph watch', description: 'Watch for changes and rebuild' },
    { command: 'monomind monograph lsp', description: 'Start LSP server for editor integration' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Monograph — Knowledge Graph'));
    output.writeln(output.dim('Code intelligence + Document wiki in one unified graph'));
    output.writeln();
    output.writeln('Commands:');
    output.printList([
      'wiki      — Scan all docs & PDFs → searchable knowledge graph',
      'build     — Full build (code + docs + PDFs)',
      'search    — Search across code, sections, and concepts',
      'stats     — Node/edge counts, top concepts',
      'watch     — Auto-rebuild on file changes',
      'lsp       — Start LSP server over stdio (editor integration)',
    ]);
    output.writeln();
    output.writeln('Examples:');
    output.printList([
      'monomind monograph wiki',
      'monomind monograph wiki --llm',
      'monomind monograph search -q "pipeline architecture"',
    ]);
    output.writeln();
    output.writeln(
      output.dim('Add --llm to any build command to extract semantic relationships with Claude'),
    );
    return { success: true };
  },
};

export default monographCommand;
