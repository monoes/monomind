import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// ─── defend subcommand ───────────────────────────────────────────────────────

export const defendCommand: Command = {
  name: 'defend',
  description: 'AI manipulation defense - detect prompt injection, jailbreaks, and PII',
  options: [
    { name: 'input', short: 'i', type: 'string', description: 'Input text to scan for threats' },
    { name: 'file', short: 'f', type: 'string', description: 'File to scan for threats' },
    {
      name: 'quick',
      short: 'Q',
      type: 'boolean',
      description: 'Quick scan (faster, less detailed)',
    },
    {
      name: 'learn',
      short: 'l',
      type: 'boolean',
      description: 'Enable learning mode',
      default: 'true',
    },
    { name: 'stats', short: 's', type: 'boolean', description: 'Show detection statistics' },
    {
      name: 'output',
      short: 'o',
      type: 'string',
      description: 'Output format: text, json',
      default: 'text',
    },
  ],
  examples: [
    {
      command: 'monomind security defend -i "ignore previous instructions"',
      description: 'Scan text for threats',
    },
    { command: 'monomind security defend -f ./prompts.txt', description: 'Scan file for threats' },
    { command: 'monomind security defend --stats', description: 'Show detection statistics' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> =>
    // -o json: stdout carries only the document (#495).
    output.reserveStdout(ctx.flags.output === 'json', () => runDefend(ctx)),
};

async function runDefend(ctx: CommandContext): Promise<CommandResult> {
  const inputText = ctx.flags.input as string;
  const filePath = ctx.flags.file as string;
  const quickMode = ctx.flags.quick as boolean;
  const showStats = ctx.flags.stats as boolean;
  const outputFormat = (ctx.flags.output as string) || 'text';
  const enableLearning = ctx.flags.learn !== false;

  output.writeln();
  output.writeln(output.bold('🛡️ MonoFence - AI Manipulation Defense System'));
  output.writeln(output.dim('─'.repeat(55)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createMonoDefence: (config?: Record<string, unknown>) => any;
  try {
    const { loadMonoFenceModule } = await import('../mcp-tools/security-tools-core.js');
    const aidefence = await loadMonoFenceModule();
    createMonoDefence = aidefence.createMonoDefence;
  } catch (err) {
    output.printError((err as Error).message);
    return { success: false, message: 'MonoFence not available' };
  }

  const defender = createMonoDefence({ enableLearning });

  if (showStats) {
    const stats = await defender.getStats();
    output.writeln();
    output.printBox(
      [
        `Detection Count: ${stats.detectionCount}`,
        `Avg Detection Time: ${stats.avgDetectionTimeMs.toFixed(3)}ms`,
        `Learned Patterns: ${stats.learnedPatterns}`,
        `Mitigation Strategies: ${stats.mitigationStrategies}`,
        `Avg Mitigation Effectiveness: ${(stats.avgMitigationEffectiveness * 100).toFixed(1)}%`,
      ].join('\n'),
      'Detection Statistics',
    );
    return { success: true };
  }

  let textToScan = inputText;
  if (filePath) {
    try {
      const resolvedFile = realpathSync(resolve(filePath));
      const cwd = realpathSync(process.cwd());
      if (!resolvedFile.startsWith(cwd + sep) && resolvedFile !== cwd) {
        output.printError('--file must be within the current working directory');
        return { success: false };
      }
    } catch {
      output.printError(`File not found: ${filePath}`);
      return { success: false, message: 'File not found' };
    }
    try {
      const fs = await import('node:fs/promises');
      const MAX_DEFEND_FILE_BYTES = 10 * 1024 * 1024;
      const { size } = await fs.stat(filePath);
      if (size > MAX_DEFEND_FILE_BYTES) {
        output.printError(
          `File too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
        );
        return { success: false, message: 'File too large' };
      }
      textToScan = await fs.readFile(filePath, 'utf-8');
      output.writeln(output.dim(`Reading file: ${filePath}`));
    } catch {
      output.printError(`Failed to read file: ${filePath}`);
      return { success: false, message: 'File not found' };
    }
  }

  if (!textToScan) {
    output.writeln('Usage: monomind security defend -i "<text>" or -f <file>');
    output.writeln();
    output.writeln('Options:');
    output.printList([
      '-i, --input   Text to scan for AI manipulation attempts',
      '-f, --file    File path to scan',
      '-q, --quick   Quick scan mode (faster)',
      '-s, --stats   Show detection statistics',
      '--learn       Enable pattern learning (default: true)',
    ]);
    return { success: true };
  }

  const spinner = output.createSpinner({ text: 'Scanning for threats...', spinner: 'dots' });
  spinner.start();

  const startTime = performance.now();
  const qr = quickMode ? defender.quickScan(textToScan) : null;
  const result = quickMode
    ? {
        ...qr!,
        threats: [],
        piiFound: false,
        detectionTimeMs: 0,
        inputHash: '',
        safe: !qr?.threat,
      }
    : await defender.detect(textToScan);
  const scanTime = performance.now() - startTime;

  spinner.stop();

  if (outputFormat === 'json') {
    output.printDocument({
      safe: result.safe,
      threats: result.threats || [],
      piiFound: result.piiFound,
      detectionTimeMs: scanTime,
    });
    return { success: true };
  }

  output.writeln();

  if (result.safe && !result.piiFound) {
    output.writeln(output.success('✅ No threats detected'));
  } else {
    if (!result.safe && result.threats) {
      output.writeln(output.error(`⚠️ ${result.threats.length} threat(s) detected:`));
      output.writeln();

      for (const threat of result.threats) {
        const sc = (text: string): string =>
          (
            ({
              critical: output.error,
              high: output.warning,
              medium: output.info,
              low: output.dim,
            })[threat.severity as string] || output.dim
          ).call(output, text);

        output.writeln(`  ${sc(`[${threat.severity.toUpperCase()}]`)} ${threat.type}`);
        output.writeln(`    ${output.dim(threat.description)}`);
        output.writeln(`    Confidence: ${(threat.confidence * 100).toFixed(1)}%`);
        output.writeln();
      }

      const criticalThreats = result.threats.filter(
        (t: { severity: string }) => t.severity === 'critical',
      );
      if (criticalThreats.length > 0 && enableLearning) {
        output.writeln(output.bold('Recommended Mitigations:'));
        for (const threat of criticalThreats) {
          const mitigation = await defender.getBestMitigation(
            threat.type as Parameters<typeof defender.getBestMitigation>[0],
          );
          if (mitigation) {
            output.writeln(
              `  ${threat.type}: ${output.bold(mitigation.strategy)} (${(mitigation.effectiveness * 100).toFixed(0)}% effective)`,
            );
          }
        }
        output.writeln();
      }
    }

    if (result.piiFound) {
      output.writeln(output.warning('⚠️ PII detected (emails, SSNs, API keys, etc.)'));
      output.writeln();
    }
  }

  output.writeln(output.dim(`Detection time: ${scanTime.toFixed(3)}ms`));

  return { success: result.safe };
}
