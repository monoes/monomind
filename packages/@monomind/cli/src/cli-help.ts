/**
 * CLI help/version output
 *
 * Split out of index.ts (file-size sweep). Pure move: the method bodies are
 * unchanged; state previously reached via `this` (name/version/description,
 * the parser, the output formatter) is now passed in explicitly by the caller.
 */

import { HELP_SUMMARIES } from './commands/help-summaries.js';
import { getCommand, getCommandAsync, hasCommand } from './commands/index.js';
import type { OutputFormatter } from './output.js';
import type { CommandParser } from './parser.js';
import { versionJsonPayload } from './protocol-capabilities.js';
import type { Command } from './types.js';
import { getUpdateTagline } from './update/index.js';

/**
 * Show main help
 */
export async function printMainHelp(
  name: string,
  version: string,
  description: string,
  parser: CommandParser,
  output: OutputFormatter,
): Promise<void> {
  const commandsByCategory = HELP_SUMMARIES;

  output.writeln();
  const tagline = getUpdateTagline(version);
  output.writeln(output.bold(`${name} v${version}`) + output.dim(tagline));
  output.writeln(output.dim(description));
  output.writeln();

  output.writeln(output.bold('USAGE:'));
  output.writeln(`  ${name} <command> [subcommand] [options]`);
  output.writeln();

  // Primary Commands
  output.writeln(output.bold('PRIMARY COMMANDS:'));
  for (const cmd of commandsByCategory.primary) {
    const cmdName = cmd.name.padEnd(12);
    output.writeln(`  ${output.highlight(cmdName)} ${cmd.description}`);
  }
  output.writeln();

  // Advanced Commands
  output.writeln(output.bold('ADVANCED COMMANDS:'));
  for (const cmd of commandsByCategory.advanced) {
    const cmdName = cmd.name.padEnd(12);
    output.writeln(`  ${output.highlight(cmdName)} ${cmd.description}`);
  }
  output.writeln();

  // Utility Commands
  output.writeln(output.bold('UTILITY COMMANDS:'));
  for (const cmd of commandsByCategory.utility) {
    const cmdName = cmd.name.padEnd(12);
    output.writeln(`  ${output.highlight(cmdName)} ${cmd.description}`);
  }
  output.writeln();

  // Analysis Commands
  output.writeln(output.bold('ANALYSIS COMMANDS:'));
  for (const cmd of commandsByCategory.analysis) {
    const cmdName = cmd.name.padEnd(12);
    output.writeln(`  ${output.highlight(cmdName)} ${cmd.description}`);
  }
  output.writeln();

  // Management Commands
  output.writeln(output.bold('MANAGEMENT COMMANDS:'));
  for (const cmd of commandsByCategory.management) {
    const cmdName = cmd.name.padEnd(12);
    output.writeln(`  ${output.highlight(cmdName)} ${cmd.description}`);
  }
  output.writeln();

  output.writeln(output.bold('GLOBAL OPTIONS:'));
  for (const opt of parser.getGlobalOptions()) {
    const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
    output.writeln(`  ${flags.padEnd(25)} ${opt.description}`);
  }
  output.writeln();

  output.writeln(output.bold('FEATURES:'));
  output.printList([
    'Local SQLite memory with on-device embeddings (HNSW ANN index above 100,000 entries)',
    'Monograph codebase knowledge graph (tree-sitter + SQLite)',
    'Org runtime daemon with per-role policy gates (monomind org run)',
    'Keyword routing + route-outcome measurement',
  ]);
  output.writeln();

  output.writeln(output.bold('EXAMPLES:'));
  output.writeln(`  ${name} agent spawn -t coder              # Record a coder agent`);
  output.writeln(`  ${name} org run <org> --task "..."      # Run an agent org`);
  output.writeln(`  ${name} memory search -q "auth patterns"  # Semantic search`);
  output.writeln(`  ${name} mcp start                         # Start MCP server`);
  output.writeln();

  output.writeln(output.dim(`Run "${name} <command> --help" for command help`));
  output.writeln();
  output.writeln(output.dim('github.com/monoes/monomind'));
  output.writeln();
}

/**
 * Show command-specific help
 */
export async function printCommandHelp(
  name: string,
  output: OutputFormatter,
  commandPath: string | string[],
): Promise<void> {
  const path = Array.isArray(commandPath) ? commandPath : [commandPath];
  const topName = path[0];

  // Try sync first, then lazy load
  let command = getCommand(topName);
  if (!command && hasCommand(topName)) {
    command = await getCommandAsync(topName);
  }

  if (!command) {
    output.printError(`Unknown command: ${topName}`);
    return;
  }

  // Walk the remaining path segments through subcommands/nested
  // subcommands — mirrors the resolution the dispatcher uses in run() —
  // so `monomind <command> <subcommand> --help` shows the actual target
  // (sub)command's own options and examples, not just the parent's list
  // of subcommands.
  let target: Command = command;
  const resolvedNames = [command.name];
  for (const segment of path.slice(1)) {
    const next = target.subcommands?.find(
      (sc) => sc.name === segment || sc.aliases?.includes(segment),
    );
    if (!next) break;
    target = next;
    resolvedNames.push(next.name);
  }

  output.writeln();
  output.writeln(output.bold(`${name} ${resolvedNames.join(' ')}`));
  output.writeln(target.description);
  output.writeln();

  // Subcommands
  if (target.subcommands && target.subcommands.length > 0) {
    output.writeln(output.bold('SUBCOMMANDS:'));
    for (const sub of target.subcommands) {
      if (sub.hidden) continue;
      const subName = sub.name.padEnd(15);
      const aliases = sub.aliases ? output.dim(` (${sub.aliases.join(', ')})`) : '';
      output.writeln(`  ${output.highlight(subName)} ${sub.description}${aliases}`);
    }
    output.writeln();
  }

  // Options
  if (target.options && target.options.length > 0) {
    output.writeln(output.bold('OPTIONS:'));
    for (const opt of target.options) {
      if (opt.hidden) continue;
      const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
      const required = opt.required ? output.error(' (required)') : '';
      const defaultVal = opt.default !== undefined ? output.dim(` [default: ${opt.default}]`) : '';
      output.writeln(`  ${flags.padEnd(25)} ${opt.description}${required}${defaultVal}`);
    }
    output.writeln();
  }

  // Examples
  if (target.examples && target.examples.length > 0) {
    output.writeln(output.bold('EXAMPLES:'));
    for (const example of target.examples) {
      output.writeln(`  ${output.dim('$')} ${example.command}`);
      output.writeln(`    ${output.dim(example.description)}`);
    }
    output.writeln();
  }
}

/**
 * Show version. `--version --json` emits the Agent Exec Protocol
 * capability handshake (doc/agent-exec-protocol.md §2) — machine callers
 * handshake before using `agent exec`/`agent scan`/org `--json`.
 */
export function printVersionInfo(
  name: string,
  version: string,
  output: OutputFormatter,
  json = false,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(versionJsonPayload(version))}\n`);
    return;
  }
  const tagline = getUpdateTagline(version);
  output.writeln(`${name} v${version}${tagline}`);
}
