import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// ─── train subcommand ───────────────────────────────────────────────────────

export const trainCommand: Command = {
  name: 'train',
  description: 'Ingest outcome and edit history into the pattern store for routing optimization',
  options: [
    {
      name: 'pattern-type',
      short: 't',
      type: 'string',
      description: 'Pattern type label (e.g. general, security, refactor)',
      default: 'general',
    },
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Show each ingested pattern' },
  ],
  examples: [
    {
      command: 'monomind hooks intelligence train',
      description: 'Ingest outcomes and edits into pattern store',
    },
    {
      command: 'monomind hooks intelligence train -t security -v',
      description: 'Ingest with type label, verbose',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const patternType = (ctx.flags['pattern-type'] as string) || 'general';
    const verbose = ctx.flags.verbose === true;

    output.writeln();
    output.writeln(output.bold('Pattern Store — Train'));
    output.writeln(output.dim('Reads outcome/edit history and stores patterns for routing'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({
      text: 'Initializing intelligence layer...',
      spinner: 'dots',
    });
    spinner.start();

    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const crypto = await import('node:crypto');

      const { initializeIntelligence, getReasoningBank, flushPatterns, getIntelligenceStats } =
        await import('../memory/intelligence.js');

      await initializeIntelligence();
      const bank = getReasoningBank();
      if (!bank) {
        spinner.fail('ReasoningBank not available');
        return { success: false, exitCode: 1 };
      }

      const dataDir = path.join(process.cwd(), '.monomind', 'data');
      const outcomesFile = path.join(dataDir, 'intelligence-outcomes.jsonl');
      const editsFile = path.join(dataDir, 'recent-edits.jsonl');

      let stored = 0;
      const MAX_FILE_BYTES = 50 * 1024 * 1024;

      // Helper: read a JSONL file safely, return parsed lines
      const readJsonl = (filePath: string): Array<Record<string, unknown>> => {
        if (!fs.existsSync(filePath)) return [];
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_BYTES) {
          output.writeln(
            output.warning(`Skipping ${path.basename(filePath)}: too large (${stat.size} bytes)`),
          );
          return [];
        }
        const lines = fs
          .readFileSync(filePath, 'utf-8')
          .split('\n')
          .filter((l) => l.trim());
        const results: Array<Record<string, unknown>> = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj && typeof obj === 'object' && !('__proto__' in obj)) {
              results.push(obj as Record<string, unknown>);
            }
          } catch {
            // skip malformed lines
          }
        }
        return results;
      };

      // --- 1. Ingest intelligence-outcomes.jsonl (successful outcomes) ---
      spinner.setText('Reading intelligence outcomes...');
      const outcomes = readJsonl(outcomesFile);
      const successOutcomes = outcomes.filter((o) => o.success === true || o.verdict === 'success');

      for (const outcome of successOutcomes) {
        const content = (outcome.description ||
          outcome.task ||
          outcome.content ||
          outcome.command ||
          '') as string;
        if (!content || typeof content !== 'string' || content.length > 4096) continue;

        const id = `outcome_${crypto.createHash('sha256').update(content).digest('hex').substring(0, 16)}`;
        bank.store({
          id,
          type: patternType,
          content,
          confidence: typeof outcome.confidence === 'number' ? outcome.confidence : 0.8,
          embedding: [],
          metadata: { source: 'intelligence-outcomes', originalType: outcome.type },
        });
        stored++;
        if (verbose) output.writeln(output.dim(`  + ${id}: ${content.substring(0, 60)}`));
      }

      // --- 2. Ingest recent-edits.jsonl (edit history) ---
      spinner.setText('Reading edit history...');
      const edits = readJsonl(editsFile);

      for (const edit of edits) {
        const file = (edit.file || edit.path || '') as string;
        const operation = (edit.operation || edit.action || 'edit') as string;
        if (!file || typeof file !== 'string') continue;

        const content = `${operation}: ${file}`;
        const id = `edit_${crypto
          .createHash('sha256')
          .update(content + String(edit.timestamp || ''))
          .digest('hex')
          .substring(0, 16)}`;
        bank.store({
          id,
          type: patternType,
          content,
          confidence: 0.7,
          embedding: [],
          metadata: { source: 'recent-edits', file, operation },
        });
        stored++;
        if (verbose) output.writeln(output.dim(`  + ${id}: ${content.substring(0, 60)}`));
      }

      // --- 3. Flush to disk ---
      spinner.setText('Persisting patterns...');
      flushPatterns();

      const stats = getIntelligenceStats();
      spinner.succeed(`Stored ${stored} patterns from outcome/edit history`);

      output.writeln();
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 28 },
          { key: 'value', header: 'Value', width: 20 },
        ],
        data: [
          { metric: 'Outcomes Ingested', value: String(successOutcomes.length) },
          { metric: 'Edits Ingested', value: String(edits.length) },
          { metric: 'Patterns Stored', value: String(stored) },
          { metric: 'Total Patterns (bank)', value: String(stats.patternsLearned) },
          { metric: 'Pattern Type', value: patternType },
        ],
      });

      if (stored === 0) {
        output.writeln();
        output.writeln(
          output.dim(
            'No data found to ingest. train reads two files that no hook writes, so it stores',
          ),
        );
        output.writeln(output.dim('nothing unless you create them yourself:'));
        output.writeln(output.dim('  - Outcomes: .monomind/data/intelligence-outcomes.jsonl'));
        output.writeln(output.dim('  - Edits:    .monomind/data/recent-edits.jsonl'));
      }

      return {
        success: true,
        data: { stored, outcomes: successOutcomes.length, edits: edits.length },
      };
    } catch (error) {
      spinner.fail('Training failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};
