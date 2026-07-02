/**
 * Memory Transfer Commands
 * compressCommand, exportCommand, importCommand
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

// Compress command
export const compressCommand: Command = {
  name: 'compress',
  description: 'Compress and optimize memory storage',
  options: [
    {
      name: 'level',
      short: 'l',
      description: 'Compression level (fast, balanced, max)',
      type: 'string',
      choices: ['fast', 'balanced', 'max'],
      default: 'balanced'
    },
    {
      name: 'target',
      short: 't',
      description: 'Target (vectors, text, patterns, all)',
      type: 'string',
      choices: ['vectors', 'text', 'patterns', 'all'],
      default: 'all'
    },
    {
      name: 'quantize',
      short: 'z',
      description: 'Enable vector quantization (reduces memory 4-32x)',
      type: 'boolean',
      default: false
    },
    {
      name: 'bits',
      description: 'Quantization bits (4, 8, 16)',
      type: 'number',
      default: 8
    },
    {
      name: 'rebuild-index',
      short: 'r',
      description: 'Rebuild HNSW index after compression',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'monomind memory compress', description: 'Balanced compression' },
    { command: 'monomind memory compress --quantize --bits 4', description: '4-bit quantization (32x reduction)' },
    { command: 'monomind memory compress -l max -t vectors', description: 'Max compression on vectors' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const level = ctx.flags.level as string || 'balanced';
    const target = ctx.flags.target as string || 'all';
    const quantize = ctx.flags.quantize as boolean;
    const bits = ctx.flags.bits as number || 8;
    const rebuildIndex = ctx.flags.rebuildIndex as boolean ?? true;

    output.writeln();
    output.writeln(output.bold('Memory Compression'));
    output.writeln(output.dim(`Level: ${level}, Target: ${target}, Quantize: ${quantize ? `${bits}-bit` : 'no'}`));
    output.writeln();

    const spinner = output.createSpinner({ text: 'Analyzing current storage...', spinner: 'dots' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        before: {
          totalSize: string;
          vectorsSize: string;
          textSize: string;
          patternsSize: string;
          indexSize: string;
        };
        after: {
          totalSize: string;
          vectorsSize: string;
          textSize: string;
          patternsSize: string;
          indexSize: string;
        };
        compression: {
          ratio: number;
          bytesSaved: number;
          formattedSaved: string;
          quantizationApplied: boolean;
          indexRebuilt: boolean;
        };
        performance: {
          searchLatencyBefore: number;
          searchLatencyAfter: number;
          searchSpeedup: string;
        };
        duration: number;
      }>('memory_compress', {
        level,
        target,
        quantize,
        bits,
        rebuildIndex,
      });

      spinner.succeed('Compression complete');

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Storage Comparison'));
      output.printTable({
        columns: [
          { key: 'category', header: 'Category', width: 15 },
          { key: 'before', header: 'Before', width: 12, align: 'right' },
          { key: 'after', header: 'After', width: 12, align: 'right' },
          { key: 'saved', header: 'Saved', width: 12, align: 'right' }
        ],
        data: [
          { category: 'Vectors', before: result.before.vectorsSize, after: result.after.vectorsSize, saved: '-' },
          { category: 'Text', before: result.before.textSize, after: result.after.textSize, saved: '-' },
          { category: 'Patterns', before: result.before.patternsSize, after: result.after.patternsSize, saved: '-' },
          { category: 'Index', before: result.before.indexSize, after: result.after.indexSize, saved: '-' },
          { category: output.bold('Total'), before: result.before.totalSize, after: result.after.totalSize, saved: output.success(result.compression.formattedSaved) }
        ]
      });

      output.writeln();
      output.printBox(
        [
          `Compression Ratio: ${result.compression.ratio.toFixed(2)}x`,
          `Space Saved: ${result.compression.formattedSaved}`,
          `Quantization: ${result.compression.quantizationApplied ? `Yes (${bits}-bit)` : 'No'}`,
          `Index Rebuilt: ${result.compression.indexRebuilt ? 'Yes' : 'No'}`,
          `Duration: ${(result.duration / 1000).toFixed(1)}s`
        ].join('\n'),
        'Results'
      );

      if (result.performance) {
        output.writeln();
        output.writeln(output.bold('Performance Impact'));
        output.printList([
          `Search latency: ${result.performance.searchLatencyBefore.toFixed(2)}ms → ${result.performance.searchLatencyAfter.toFixed(2)}ms`,
          `Speedup: ${output.success(result.performance.searchSpeedup)}`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Compression failed');
      if (error instanceof MCPClientError) {
        output.printError(`Compression error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Export command
export const exportCommand: Command = {
  name: 'export',
  description: 'Export memory to file',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
      required: true
    },
    {
      name: 'format',
      short: 'f',
      description: 'Export format (json, csv, binary, okf)',
      type: 'string',
      choices: ['json', 'csv', 'binary', 'okf'],
      default: 'json'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Export specific namespace',
      type: 'string'
    },
    {
      name: 'include-vectors',
      description: 'Include vector embeddings',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'monomind memory export -o ./backup.json', description: 'Export all to JSON' },
    { command: 'monomind memory export -o ./data.csv -f csv', description: 'Export to CSV' },
    { command: 'monomind memory export -o ./knowledge -f okf', description: 'Export as OKF bundle (directory of .md files)' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const outputPath = ctx.flags.output as string;
    const format = ctx.flags.format as string || 'json';

    if (!outputPath) {
      output.printError('Output path is required. Use --output or -o');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Exporting memory to ${outputPath}...`);

    // OKF bundle: native export — directory of .md files with YAML frontmatter
    if (format === 'okf') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { listEntries, getEntry } = await import('../memory/memory-initializer.js');

        const namespace = ctx.flags.namespace as string | undefined;
        const listed = await listEntries({ namespace, limit: 10000 });
        if (!listed.success) {
          output.printError(`Failed to list entries: ${listed.error}`);
          return { success: false, exitCode: 1 };
        }

        let written = 0;
        for (const entry of listed.entries) {
          const got = await getEntry({ key: entry.key, namespace: entry.namespace });
          if (!got.found || !got.entry) continue;
          const { key, namespace: ns, content, tags, createdAt } = got.entry;
          const safeKey = key.replace(/[/\\:*?"<>|]/g, '-');
          const dir = path.join(outputPath, ns);
          fs.mkdirSync(dir, { recursive: true });
          const yamlEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const tagsLine = tags.length > 0 ? `tags: [${tags.join(', ')}]\n` : '';
          const md = `---\ntype: Memory\nkey: "${yamlEscape(key)}"\nnamespace: "${yamlEscape(ns)}"\n${tagsLine}timestamp: ${createdAt}\n---\n\n${content}`;
          fs.writeFileSync(path.join(dir, `${safeKey}.md`), md, 'utf-8');
          written++;
        }

        output.printSuccess(`Exported ${written} entries to ${outputPath}`);
        if (listed.total > 10000) {
          output.printInfo(`Note: only first 10000 of ${listed.total} entries exported`);
        }
        return { success: true, data: { written, outputPath } };
      } catch (error) {
        output.printError(`OKF export error: ${String(error)}`);
        return { success: false, exitCode: 1 };
      }
    }

    try {
      const result = await callMCPTool<{
        outputPath: string;
        format: string;
        exported: {
          entries: number;
          vectors: number;
          patterns: number;
        };
        fileSize: string;
      }>('memory_export', {
        outputPath,
        format,
        namespace: ctx.flags.namespace,
        includeVectors: ctx.flags.includeVectors ?? true,
      });

      output.printSuccess(`Exported to ${result.outputPath}`);
      output.printList([
        `Entries: ${result.exported.entries}`,
        `Vectors: ${result.exported.vectors}`,
        `Patterns: ${result.exported.patterns}`,
        `File size: ${result.fileSize}`
      ]);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Export error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Import command
export const importCommand: Command = {
  name: 'import',
  description: 'Import memory from file',
  options: [
    {
      name: 'input',
      short: 'i',
      description: 'Input file path',
      type: 'string',
      required: true
    },
    {
      name: 'merge',
      short: 'm',
      description: 'Merge with existing (skip duplicates)',
      type: 'boolean',
      default: true
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Import into specific namespace',
      type: 'string'
    }
  ],
  examples: [
    { command: 'monomind memory import -i ./backup.json', description: 'Import from file' },
    { command: 'monomind memory import -i ./data.json -n archive', description: 'Import to namespace' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const inputPath = ctx.flags.input as string || ctx.args[0];

    if (!inputPath) {
      output.printError('Input path is required. Use --input or -i');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Importing memory from ${inputPath}...`);

    // OKF bundle: native import — detect directory of .md files with YAML frontmatter
    const fsCheck = await import('fs');
    const isDir = fsCheck.existsSync(inputPath) && fsCheck.statSync(inputPath).isDirectory();
    if (isDir) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { storeEntry } = await import('../memory/memory-initializer.js');

        function parseOkfFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
          if (!raw.startsWith('---\n')) return { meta: {}, body: raw };
          const end = raw.indexOf('\n---\n', 4);
          if (end === -1) return { meta: {}, body: raw };
          const meta: Record<string, string | string[]> = {};
          for (const line of raw.slice(4, end).split('\n')) {
            const colon = line.indexOf(':');
            if (colon <= 0) continue;
            const k = line.slice(0, colon).trim();
            const rawV = line.slice(colon + 1).trim();
            const isQuoted = rawV.startsWith('"') && rawV.endsWith('"') && rawV.length >= 2;
            const v = isQuoted ? rawV.slice(1, -1).replace(/\\(["\\])/g, '$1') : rawV;
            if (v.startsWith('[') && v.endsWith(']')) {
              meta[k] = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
            } else {
              meta[k] = v;
            }
          }
          return { meta, body: raw.slice(end + 5) };
        }

        function findMdFiles(dir: string): string[] {
          const results: string[] = [];
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) results.push(...findMdFiles(full));
            else if (entry.name.endsWith('.md')) results.push(full);
          }
          return results;
        }

        const overrideNs = ctx.flags.namespace as string | undefined;
        const merge = ctx.flags.merge ?? true;
        const files = findMdFiles(inputPath);
        let imported = 0, skipped = 0;
        const start = Date.now();

        for (const file of files) {
          const raw = fs.readFileSync(file, 'utf-8');
          const { meta, body } = parseOkfFrontmatter(raw);
          const key = (meta['key'] as string) || path.basename(file, '.md');
          const ns = overrideNs || (meta['namespace'] as string) || path.basename(path.dirname(file));
          const tags = Array.isArray(meta['tags']) ? meta['tags'] as string[] : meta['tags'] ? [meta['tags'] as string] : [];

          const result = await storeEntry({ key, value: body.trim(), namespace: ns, tags, upsert: !merge });
          if (result.success) imported++;
          else skipped++;
        }

        output.printSuccess(`Imported ${imported} entries from ${inputPath}`);
        if (skipped > 0) output.printInfo(`Skipped ${skipped} entries (duplicates or errors)`);
        output.printInfo(`Duration: ${Date.now() - start}ms`);
        return { success: true, data: { imported, skipped } };
      } catch (error) {
        output.printError(`OKF import error: ${String(error)}`);
        return { success: false, exitCode: 1 };
      }
    }

    try {
      const result = await callMCPTool<{
        inputPath: string;
        imported: {
          entries: number;
          vectors: number;
          patterns: number;
        };
        skipped: number;
        duration: number;
      }>('memory_import', {
        inputPath,
        merge: ctx.flags.merge ?? true,
        namespace: ctx.flags.namespace,
      });

      output.printSuccess(`Imported from ${result.inputPath}`);
      output.printList([
        `Entries: ${result.imported.entries}`,
        `Vectors: ${result.imported.vectors}`,
        `Patterns: ${result.imported.patterns}`,
        `Skipped (duplicates): ${result.skipped}`,
        `Duration: ${result.duration}ms`
      ]);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Import error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
