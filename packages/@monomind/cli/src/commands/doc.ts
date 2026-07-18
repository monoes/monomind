/**
 * CLI Document Command — Second Brain document management
 */

import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { getGlobalBrainDir } from '../memory/memory-bridge.js';

const ingestCommand: Command = {
  name: 'ingest',
  description: 'Ingest documents into the knowledge base',
  options: [
    // No `default` on scope: the auto-global routing below must be able to
    // tell "user typed --scope shared" apart from "user typed nothing" — a
    // parser-injected default makes them indistinguishable.
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared; auto-routes to global for paths outside the project)', type: 'string' },
    { name: 'global', short: 'g', description: 'Ingest into the personal cross-project global brain (~/.monomind/global-brain)', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind doc ingest ./docs', description: 'Ingest all docs in a directory' },
    { command: 'monomind doc ingest ~/notes --global', description: 'Ingest into the global brain (auto-detected for paths outside the project)' },
    { command: 'monomind doc ingest report.pdf', description: 'Ingest a single file' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0] || '.';

    const { ingestDocument, ingestDirectory } = await import('../knowledge/document-pipeline.js');
    const fs = await import('node:fs');
    const resolved = path.resolve(target);

    // Zero-decision routing: an explicit --global wins; otherwise paths OUTSIDE
    // the current project belong to the personal brain (a project store keyed
    // to this cwd would never see them again from another project).
    let scope = String(ctx.flags.scope || 'shared');
    if (ctx.flags.global === true) {
      scope = 'global';
    } else if (!ctx.flags.scope) {
      const relToCwd = path.relative(process.cwd(), resolved);
      if (relToCwd.startsWith('..') || path.isAbsolute(relToCwd)) {
        scope = 'global';
        output.writeln(output.dim(`  ${target} is outside this project — ingesting into the global brain (use --scope shared to force project scope)`));
      }
    }

    const spinner = output.createSpinner({ text: 'Indexing documents...' });
    spinner.start();

    try {
      const stat = fs.statSync(resolved);

      if (stat.isDirectory()) {
        const result = await ingestDirectory(resolved, scope, {
          rootDir: ctx.cwd || process.cwd(),
          onProgress: (file, done, total) => {
            spinner.setText(`[${done + 1}/${total}] ${path.basename(file)}`);
          },
        });
        spinner.succeed(`Indexed ${result.totalChunks} chunks from ${result.filesProcessed} files (${result.filesSkipped} skipped)`);
        if (result.errors.length) {
          output.writeln(output.dim(`  Errors: ${result.errors.length}`));
          for (const err of result.errors.slice(0, 5)) {
            output.writeln(output.dim(`    ${err}`));
          }
        }
        return { success: true, data: result };
      } else {
        const result = await ingestDocument(resolved, scope);
        if (result.skipped && !result.error) {
          spinner.succeed(`Already indexed: ${path.basename(resolved)} (${result.chunksIndexed} chunks)`);
        } else if (result.error) {
          spinner.fail(result.error);
          return { success: false };
        } else {
          spinner.succeed(`Indexed ${result.chunksIndexed} chunks from ${path.basename(resolved)}`);
        }
        return { success: true, data: result };
      }
    } catch (err) {
      spinner.fail(String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

const searchDocCommand: Command = {
  name: 'search',
  description: 'Semantic search over indexed documents',
  options: [
    { name: 'query', short: 'q', description: 'Search query', type: 'string', required: true },
    { name: 'limit', short: 'l', description: 'Max results (default: 10)', type: 'number', default: 10 },
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'min-score', description: 'Minimum similarity (default: 0.3)', type: 'number', default: 0.3 },
    { name: 'store', description: 'Which store(s): project | global | all (default: all — project results win ties)', type: 'string', default: 'all' },
  ],
  examples: [
    { command: 'monomind doc search -q "authentication flow"', description: 'Search project + global brain' },
    { command: 'monomind doc search -q "pricing notes" --store global', description: 'Search only the personal global brain' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = String(ctx.flags.query || ctx.args[0] || '');
    if (!query) {
      output.printError('Query required: monomind doc search -q "your query"');
      return { success: false, exitCode: 1 };
    }

    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const storeFlag = String(ctx.flags.store || 'all');
    const excerpts = await searchKnowledge(query, {
      scope: String(ctx.flags.scope || 'shared'),
      limit: Number(ctx.flags.limit || 10),
      minScore: Number(ctx.flags['min-score'] || 0.3),
      store: storeFlag === 'project' || storeFlag === 'global' ? storeFlag : 'all',
    });

    if (!excerpts.length) {
      output.writeln(output.dim('No results found.'));
      return { success: true, data: [] };
    }

    output.writeln(output.bold(`${excerpts.length} results:`));
    output.writeln();

    for (let i = 0; i < excerpts.length; i++) {
      const ex = excerpts[i];
      const origin = ex.scope === 'global' ? ` ${output.dim('[global]')}` : '';
      output.writeln(`${output.highlight(`${i + 1}.`)} ${output.dim(`(${ex.similarity.toFixed(3)})`)} ${ex.filePath || 'unknown'}${origin}`);
      const preview = ex.text.length > 200 ? ex.text.slice(0, 200) + '...' : ex.text;
      output.writeln(`   ${output.dim(preview)}`);
      output.writeln();
    }

    return { success: true, data: excerpts };
  },
};

const listDocCommand: Command = {
  name: 'list',
  description: 'List indexed documents',
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope', type: 'string' },
    { name: 'global', short: 'g', description: 'List the personal cross-project global brain', type: 'boolean' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { listDocuments } = await import('../knowledge/document-pipeline.js');
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : ctx.flags.scope ? String(ctx.flags.scope) : undefined;
    const docs = listDocuments(isGlobal ? getGlobalBrainDir() : process.cwd(), scope);

    if (!docs.length) {
      output.writeln(output.dim('No documents indexed. Run: monomind doc ingest <path>'));
      return { success: true, data: [] };
    }

    output.writeln(output.bold(`${docs.length} documents indexed:`));
    output.writeln();

    for (const doc of docs) {
      const name = path.basename(doc.filePath);
      const size = doc.size > 1024 * 1024
        ? `${(doc.size / 1024 / 1024).toFixed(1)}MB`
        : `${(doc.size / 1024).toFixed(0)}KB`;
      const date = doc.indexedAt.slice(0, 10);
      output.writeln(`  ${output.highlight(name)} ${output.dim(`${doc.chunkCount} chunks · ${size} · ${date} · ${doc.scope}`)}`);
    }

    return { success: true, data: docs };
  },
};

const exportDocCommand: Command = {
  name: 'export',
  description: 'Export knowledge base as OKF bundle (markdown + frontmatter)',
  options: [
    { name: 'output', short: 'o', description: 'Output directory', type: 'string', default: '.monomind/knowledge-export' },
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'global', short: 'g', description: 'Export the personal cross-project global brain (portable between machines)', type: 'boolean' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { exportToOKF } = await import('../knowledge/document-pipeline.js');
    const outDir = path.resolve(String(ctx.flags.output || '.monomind/knowledge-export'));
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : String(ctx.flags.scope || 'shared');

    const spinner = output.createSpinner({ text: 'Exporting to OKF...' });
    spinner.start();

    try {
      const result = await exportToOKF(outDir, isGlobal ? getGlobalBrainDir() : process.cwd(), scope);
      spinner.succeed(`Exported ${result.exported} documents to ${result.outputDir}`);
      return { success: true, data: result };
    } catch (err) {
      spinner.fail(String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

export const docCommand: Command = {
  name: 'doc',
  description: 'Second Brain — document knowledge management',
  aliases: ['docs', 'knowledge'],
  subcommands: [ingestCommand, searchDocCommand, listDocCommand, exportDocCommand],
  options: [],
  examples: [
    { command: 'monomind doc ingest ./docs', description: 'Index documents' },
    { command: 'monomind doc search -q "auth flow"', description: 'Semantic search' },
    { command: 'monomind doc list', description: 'List indexed docs' },
    { command: 'monomind doc export', description: 'Export as OKF bundle' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Second Brain — Document Knowledge Management'));
    output.writeln();
    output.writeln('Usage: monomind doc <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('ingest')}  - Ingest documents into the knowledge base`,
      `${output.highlight('search')}  - Semantic search over indexed documents`,
      `${output.highlight('list')}    - List indexed documents`,
      `${output.highlight('export')}  - Export as OKF bundle (markdown + frontmatter)`,
    ]);
    return { success: true };
  },
};

export default docCommand;
