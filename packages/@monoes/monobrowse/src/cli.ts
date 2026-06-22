#!/usr/bin/env node
/**
 * monobrowse — standalone CLI entry point
 * Dispatches to the same command tree used by `monomind browse`
 */

import { createRequire } from 'module';
import browseCommand from './cli/commands.js';
import { output } from './cli/output.js';
import type { Command, CommandContext, CommandOption, ParsedFlags } from './cli/types.js';

const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Subcommand lookup (supports aliases)
// ---------------------------------------------------------------------------

function findSub(name: string, subs: Command[]): Command | undefined {
  return subs.find(s => s.name === name || s.aliases?.includes(name));
}

// ---------------------------------------------------------------------------
// Minimal argv parser — resolves short flags from the target subcommand's opts
// ---------------------------------------------------------------------------

function buildShortMap(cmd: Command | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  if (!cmd?.options) return m;
  for (const opt of cmd.options) {
    if (opt.short) m[opt.short] = opt.name;
  }
  return m;
}

function isBooleanOpt(name: string, cmd: Command | undefined): boolean {
  const opt = cmd?.options?.find(o => o.name === name);
  return opt?.type === 'boolean';
}

function parseArgv(argv: string[], sub: Command | undefined): { args: string[]; flags: ParsedFlags } {
  const shortMap = buildShortMap(sub);
  const flags: ParsedFlags = { _: [] };
  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const raw = arg.slice(2);
      if (raw.startsWith('no-')) {
        flags[raw.slice(3)] = false;
      } else if (raw.includes('=')) {
        const eq = raw.indexOf('=');
        flags[raw.slice(0, eq)] = raw.slice(eq + 1);
      } else if (isBooleanOpt(raw, sub) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        flags[raw] = true;
      } else {
        flags[raw] = argv[++i];
      }
    } else if (arg.startsWith('-') && arg.length >= 2) {
      const short = arg[1];
      const long = shortMap[short] ?? short;
      if (arg.length > 2) {
        flags[long] = arg.slice(2);
      } else if (isBooleanOpt(long, sub) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        flags[long] = true;
      } else {
        flags[long] = argv[++i];
      }
    } else {
      positional.push(arg);
    }

    i++;
  }

  // Coerce number options
  for (const opt of (sub?.options ?? [])) {
    if (opt.type === 'number' && typeof flags[opt.name] === 'string') {
      flags[opt.name] = Number(flags[opt.name]);
    }
  }

  return { args: positional, flags };
}

// ---------------------------------------------------------------------------
// Help printer
// ---------------------------------------------------------------------------

function printHelp(cmd: Command, prefix = 'monobrowse'): void {
  const usage = cmd.name === 'browse'
    ? `${prefix} <subcommand> [options]`
    : `${prefix} ${cmd.name} [subcommand] [options]`;
  console.log(`\nUsage: ${usage}\n`);
  console.log(cmd.description + '\n');

  if (cmd.subcommands?.length) {
    console.log('Subcommands:');
    for (const s of cmd.subcommands) {
      if (!s.hidden) console.log(`  ${s.name.padEnd(20)} ${s.description}`);
    }
    console.log('');
  }

  if (cmd.options?.length) {
    console.log('Options:');
    for (const o of cmd.options) {
      const shortPart = o.short ? `-${o.short}, ` : '    ';
      const defaultPart = o.default !== undefined ? ` (default: ${o.default})` : '';
      console.log(`  ${shortPart}--${o.name.padEnd(18)} ${o.description}${defaultPart}`);
    }
    console.log('');
  }

  if (cmd.examples?.length) {
    console.log('Examples:');
    for (const ex of cmd.examples) {
      const adjusted = ex.command.replace(/^monomind browse/, prefix);
      console.log(`  ${adjusted}    ${ex.description}`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Dispatch: find action and build context
// ---------------------------------------------------------------------------

async function dispatch(cmd: Command, argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp(cmd);
    return;
  }

  const subName = argv[0];
  const rest = argv.slice(1);

  const sub = findSub(subName, cmd.subcommands ?? []);
  if (!sub) {
    output.printError(`Unknown subcommand: ${subName}`);
    output.printInfo('Run `monobrowse --help` to see available subcommands.');
    process.exitCode = 1;
    return;
  }

  if (rest[0] === '--help' || rest[0] === '-h') {
    printHelp(sub, 'monobrowse');
    return;
  }

  // Check if first remaining arg matches a nested subcommand
  if (sub.subcommands?.length && rest.length > 0 && !rest[0].startsWith('-')) {
    const nested = findSub(rest[0], sub.subcommands);
    if (nested?.action) {
      const { args, flags } = parseArgv(rest.slice(1), nested);
      const ctx: CommandContext = { args, flags, cwd: process.cwd(), interactive: !!process.stdout.isTTY };
      const result = await nested.action(ctx);
      if (result && !result.success) process.exitCode = result.exitCode ?? 1;
      return;
    }
  }

  // No nested match — invoke the subcommand's own action
  if (!sub.action) {
    output.printInfo(`Run \`monobrowse ${subName} --help\` for usage.`);
    return;
  }

  const { args, flags } = parseArgv(rest, sub);
  const ctx: CommandContext = { args, flags, cwd: process.cwd(), interactive: !!process.stdout.isTTY };
  const result = await sub.action(ctx);
  if (result && !result.success) process.exitCode = result.exitCode ?? 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);

  if (userArgs.length === 0 || userArgs[0] === '--help' || userArgs[0] === '-h') {
    printHelp(browseCommand);
    return;
  }

  if (userArgs[0] === '--version' || userArgs[0] === '-V') {
    const pkg = _require('../package.json') as { version: string };
    console.log(pkg.version);
    return;
  }

  await dispatch(browseCommand, userArgs);
}

main().catch(err => {
  output.printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
