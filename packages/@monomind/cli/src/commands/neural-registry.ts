/**
 * Neural registry commands — import pattern sets from a local file
 */

import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { mergeRecordsById } from '../utils/json-file.js';

// ─── import subcommand ───────────────────────────────────────────────────────

export const importCommand: Command = {
  name: 'import',
  description: 'Import pattern sets from a local file, with signature verification',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Local file to import' },
    {
      name: 'verify',
      short: 'v',
      type: 'boolean',
      description: 'Verify Ed25519 signature',
      default: 'true',
    },
    {
      name: 'merge',
      type: 'boolean',
      description: 'Merge with existing patterns (vs replace)',
      default: 'true',
    },
    {
      name: 'category',
      type: 'string',
      description: 'Only import patterns from specific category',
    },
  ],
  examples: [
    {
      command: 'monomind hooks intelligence import -f ./patterns.json --verify',
      description: 'Import from file',
    },
    {
      command: 'monomind hooks intelligence import -f ./patterns.json --category security',
      description: 'Import only security patterns',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    const verifySignature = ctx.flags.verify !== false;
    const merge = ctx.flags.merge !== false;
    const categoryFilter = ctx.flags.category as string | undefined;

    if (!file) {
      output.writeln(output.error('--file is required'));
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Secure Pattern Import'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Reading import file...', spinner: 'dots' });
    spinner.start();

    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const crypto = await import('node:crypto');

      type PatternType = {
        id: string;
        trigger: string;
        action: string;
        confidence: number;
        usageCount: number;
        category?: string;
      };
      type ModelType = { id: string; category: string; patterns: PatternType[] };
      // Mirrors exportCommand's exportData shape (neural-optimize.ts) — the
      // signature covers everything except itself and publicKey.
      type ImportDataType = {
        patterns?: PatternType[];
        models?: ModelType[];
        signature?: string;
        publicKey?: string;
        [key: string]: unknown;
      };

      if (!fs.existsSync(file)) {
        spinner.fail(`File not found: ${file}`);
        return { success: false, exitCode: 1 };
      }
      const stat = fs.statSync(file);
      const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
      if (stat.size > MAX_IMPORT_BYTES) {
        spinner.fail(`Import file too large: ${stat.size} bytes (max ${MAX_IMPORT_BYTES})`);
        return { success: false, exitCode: 1 };
      }
      const importData = JSON.parse(fs.readFileSync(file, 'utf8')) as ImportDataType;

      // SECURITY: Verify signature — fail-CLOSED (no bypass if missing or malformed)
      if (verifySignature) {
        if (!importData.signature || !importData.publicKey) {
          spinner.fail(
            'SECURITY: --verify requested but payload is unsigned. Aborting (use --no-verify to override).',
          );
          return { success: false, exitCode: 1 };
        }
        spinner.setText('Verifying Ed25519 signature...');

        try {
          const { webcrypto } = crypto;
          const publicKeyHex = importData.publicKey.replace('ed25519:', '');
          const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
          const signatureBytes = Buffer.from(importData.signature, 'hex');

          const publicKey = await webcrypto.subtle.importKey(
            'raw',
            publicKeyBytes,
            { name: 'Ed25519' },
            false,
            ['verify'],
          );
          const { signature: _sig, publicKey: _pk, ...signedContent } = importData;
          const dataBytes = new TextEncoder().encode(JSON.stringify(signedContent));
          const valid = await webcrypto.subtle.verify(
            'Ed25519',
            publicKey,
            signatureBytes,
            dataBytes,
          );

          if (!valid) {
            spinner.fail('Signature verification FAILED - data may be tampered');
            return { success: false, exitCode: 1 };
          }
          output.writeln(output.success('Signature verified'));
        } catch (err) {
          // FAIL-CLOSED: any error during verification must reject the import
          spinner.fail(
            `SECURITY: Signature verification error: ${err instanceof Error ? err.message : String(err)}. Aborting.`,
          );
          return { success: false, exitCode: 1 };
        }
      }

      spinner.setText('Importing patterns...');

      let patterns: PatternType[] = [];

      const registry = importData as { models?: ModelType[] };
      if (registry.models && Array.isArray(registry.models)) {
        for (const model of registry.models) {
          if (
            !categoryFilter ||
            model.category === categoryFilter ||
            model.id.includes(categoryFilter)
          ) {
            for (const pattern of model.patterns || []) {
              patterns.push({ ...pattern, category: model.category });
            }
          }
        }
      } else {
        patterns = importData.patterns || [];
      }

      if (categoryFilter && patterns.length > 0) {
        patterns = patterns.filter(
          (p) => p.category === categoryFilter || p.trigger.includes(categoryFilter),
        );
      }

      // Validate patterns (security check)
      const suspicious = [
        'eval(',
        'Function(',
        'exec(',
        'spawn(',
        'child_process',
        'rm -rf',
        'sudo',
        '<script>',
        'javascript:',
        'data:',
      ];
      const validPatterns = patterns.filter((p) => {
        const c = JSON.stringify(p);
        return !suspicious.some((s) => c.includes(s));
      });

      if (validPatterns.length < patterns.length) {
        output.writeln(
          output.warning(`Filtered ${patterns.length - validPatterns.length} suspicious patterns`),
        );
      }

      const memoryDir = path.join(process.cwd(), '.monomind', 'neural');
      if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

      const patternsFile = path.join(memoryDir, 'patterns.json');
      let existingPatterns: Array<{ id: string }> = [];

      if (
        merge &&
        fs.existsSync(patternsFile) &&
        fs.statSync(patternsFile).size <= 50 * 1024 * 1024
      ) {
        existingPatterns = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
      }

      const { merged: mergedPatterns, added: newPatterns } = mergeRecordsById(
        existingPatterns,
        validPatterns,
      );
      const finalPatterns = merge ? mergedPatterns : validPatterns;

      const tmpPatterns = `${patternsFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPatterns, JSON.stringify(finalPatterns, null, 2), { flag: 'wx' });
      fs.renameSync(tmpPatterns, patternsFile);

      spinner.succeed('Import complete');

      output.writeln();
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 20 },
        ],
        data: [
          { metric: 'Patterns Imported', value: String(validPatterns.length) },
          { metric: 'New Patterns', value: String(newPatterns.length) },
          { metric: 'Total Patterns', value: String(finalPatterns.length) },
          { metric: 'Signature Verified', value: importData.signature ? 'Yes' : 'N/A' },
          { metric: 'Merge Mode', value: merge ? 'Yes' : 'Replace' },
        ],
      });

      output.writeln();
      output.writeln(output.success('Patterns imported and ready to use'));
      output.writeln(
        output.dim(
          'Run "monomind hooks intelligence patterns --action list" to see imported patterns',
        ),
      );

      return { success: true };
    } catch (error) {
      spinner.fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};
