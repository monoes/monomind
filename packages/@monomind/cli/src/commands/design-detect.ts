/**
 * CLI Design Detect Command
 * Thin wrapper around the bundled @monoes/monodesign anti-pattern detector
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { paletteSubcommand } from './design-palette.js';

// ─── Result Types ────────────────────────────────────────────────────────────

export interface DesignAntiPattern {
  id: string;
  name: string;
  category: string;
  file?: string;
  line?: number;
}

export interface DesignDetectResult {
  patterns: DesignAntiPattern[];
  count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the bundled monodesign CLI entry (cli/bin/cli.js) from the
 * @monoes/monodesign package. Falls back to the monorepo sibling layout when
 * running from a source checkout without installed workspace links.
 */
export function resolveMonodesignCli(): string | null {
  // 1. Normal resolution through the package's "./engine" export.
  try {
    const require = createRequire(import.meta.url);
    const enginePath = require.resolve('@monoes/monodesign/engine');
    const binPath = join(dirname(enginePath), '..', 'bin', 'cli.js');
    if (existsSync(binPath)) return binPath;
  } catch {
    // fall through to monorepo-relative lookup
  }

  // 2. Monorepo layout: packages/@monomind/cli/{src|dist/src}/commands/ → packages/@monoes/monodesign
  const here = dirname(fileURLToPath(import.meta.url));
  for (const toCliRoot of ['../..', '../../..']) {
    // <cli root>/../../@monoes/monodesign = packages/@monoes/monodesign
    const candidate = join(here, toCliRoot, '..', '..', '@monoes', 'monodesign', 'cli', 'bin', 'cli.js');
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function runMonodesign(cliPath: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', (err) => {
      output.printError(`Failed to run the monodesign detector: ${err.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      resolve(code ?? 0);
    });
  });
}

function printEngineMissing(): void {
  output.writeln();
  output.writeln(output.warning('The bundled monodesign detection engine could not be found.'));
  output.writeln();
  output.writeln('The detector ships with @monoes/monodesign. Reinstall monomind to restore it:');
  output.writeln(output.dim('  npm install -g monomind   # or: pnpm install (in a monomind checkout)'));
  output.writeln();
}

// ─── detect subcommand ────────────────────────────────────────────────────────

const detectSubcommand: Command = {
  name: 'detect',
  description: 'Detect design anti-patterns in HTML/CSS files using the bundled monodesign engine',
  options: [
    {
      name: 'target',
      short: 't',
      type: 'string',
      description: 'File or directory to scan',
      default: '.',
    },
    {
      name: 'json',
      type: 'boolean',
      description: 'Output results as JSON',
    },
  ],
  examples: [
    { command: 'monomind design detect', description: 'Detect anti-patterns in current directory' },
    { command: 'monomind design detect -t ./src', description: 'Detect anti-patterns in ./src' },
    { command: 'monomind design detect --json', description: 'Machine-readable JSON output' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.flags.target as string || ctx.args[0] || '.';
    const jsonOutput = ctx.flags.json as boolean;

    output.writeln();
    output.writeln(output.bold('Design Anti-Pattern Detection'));
    output.writeln(output.dim('─'.repeat(50)));

    const cliPath = resolveMonodesignCli();
    if (!cliPath) {
      printEngineMissing();
      return { success: false, message: 'monodesign detection engine not found' };
    }

    output.writeln(output.dim(`Scanning: ${target}`));
    output.writeln();

    const forwardArgs: string[] = ['detect', target];
    if (jsonOutput) forwardArgs.push('--json');

    const exitCode = await runMonodesign(cliPath, forwardArgs);

    return { success: exitCode === 0, exitCode };
  },
};

// ─── ignores subcommand ───────────────────────────────────────────────────────

const ignoresSubcommand: Command = {
  name: 'ignores',
  description: 'Manage monodesign detector ignore rules, files, and values',
  examples: [
    { command: 'monomind design ignores list', description: 'Show current ignore configuration' },
    { command: 'monomind design ignores add-rule <rule-id>', description: 'Ignore a detector rule project-wide' },
    { command: 'monomind design ignores add-file <path>', description: 'Exclude a file from detection' },
    { command: 'monomind design ignores remove-rule <rule-id>', description: 'Re-enable an ignored rule' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cliPath = resolveMonodesignCli();
    if (!cliPath) {
      printEngineMissing();
      return { success: false, message: 'monodesign detection engine not found' };
    }

    const exitCode = await runMonodesign(cliPath, ['ignores', ...ctx.args]);
    return { success: exitCode === 0, exitCode };
  },
};

// ─── Main design command ──────────────────────────────────────────────────────

export const designCommand: Command = {
  name: 'design',
  description: 'Design tooling: anti-pattern detection, OKLCH palette seeding, and design quality checks',
  subcommands: [detectSubcommand, ignoresSubcommand, paletteSubcommand],
  examples: [
    { command: 'monomind design detect', description: 'Detect design anti-patterns' },
    { command: 'monomind design detect -t ./src --json', description: 'JSON output for CI' },
    { command: 'monomind design ignores list', description: 'Manage detector ignore rules' },
    { command: 'monomind design palette', description: 'Pick an OKLCH brand seed color' },
    { command: 'monomind design palette --from "my-product"', description: 'Deterministic seed from product name' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Monomind Design Tools'));
    output.writeln(output.dim('Anti-pattern detection, OKLCH palette seeding, and design quality checks'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'detect   - Detect design anti-patterns (bundled monodesign engine)',
      'ignores  - Manage detector ignore rules, files, and values',
      'palette  - OKLCH brand seed — returns anchor color + mood + composition strategy',
    ]);
    output.writeln();
    output.writeln('Use --help with subcommands for more info');
    output.writeln();
    output.writeln(output.dim('github.com/monoes/monomind'));
    return { success: true };
  },
};

export default designCommand;
