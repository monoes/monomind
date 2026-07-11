/**
 * CLI Guidance Command
 *
 * Wires the enforcement gates (destructive-ops + secrets) into Claude Code hooks.
 * The gates themselves live in .claude/helpers/handlers/gates-handler.cjs — a
 * self-contained regex table that runs on every PreToolUse. This command only
 * registers the hook entries in .claude/settings.json.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

// setup subcommand
const setupCommand: Command = {
  name: 'setup',
  description: 'Wire enforcement gates into Claude Code hooks (destructive-ops + secrets)',
  options: [
    { name: 'dry-run', type: 'boolean', description: 'Show what would change without writing', default: 'false' },
    { name: 'force', type: 'boolean', description: 'Overwrite existing gate hooks', default: 'false' },
    { name: 'project-dir', short: 'p', type: 'string', description: 'Project directory (default: cwd)' },
  ],
  examples: [
    { command: 'monomind guidance setup', description: 'Wire gates into .claude/settings.json' },
    { command: 'monomind guidance setup --dry-run', description: 'Preview changes without writing' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dryRun = ctx.flags['dry-run'] === true;
    const force = ctx.flags.force === true;
    const projectDir = (ctx.flags['project-dir'] as string | undefined) || ctx.cwd;

    output.writeln();
    output.writeln(output.bold('Guidance Gates Setup'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const { readFileSync, writeFileSync, existsSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const settingsPath = join(projectDir, '.claude', 'settings.json');
    const gatesHandlerPath = join(projectDir, '.claude', 'helpers', 'handlers', 'gates-handler.cjs');

    // Verify the gate handler exists
    if (!existsSync(gatesHandlerPath)) {
      output.writeln(output.error('gates-handler.cjs not found. Run `monomind init` first to set up the helpers directory.'));
      return { success: false, message: 'gates-handler.cjs missing' };
    }

    // Load or create settings.json
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath) && statSync(settingsPath).size <= 1024 * 1024) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        output.writeln(output.error(`Could not parse ${settingsPath}`));
        return { success: false, message: 'settings.json parse error' };
      }
    }

    const hooks = (settings.hooks || {}) as Record<string, unknown[]>;
    const preToolUse: Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }> =
      (hooks.PreToolUse as typeof preToolUse) || [];

    const PRE_BASH_MATCHER = 'Bash';
    const PRE_BASH_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-bash';
    const PRE_WRITE_MATCHER = 'Write|Edit|MultiEdit';
    const PRE_WRITE_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-write';

    // Find any existing Bash/Write entry (may have different hooks from other tools)
    const existingBashEntry = preToolUse.find(e => e.matcher === PRE_BASH_MATCHER);
    const alreadyHasPreBash = existingBashEntry?.hooks.some(h => h.command.includes('pre-bash')) ?? false;
    const existingWriteEntry = preToolUse.find(e => e.matcher === PRE_WRITE_MATCHER);
    const alreadyHasPreWrite = existingWriteEntry?.hooks.some(h => h.command.includes('pre-write')) ?? false;

    const changes: string[] = [];

    // Register pre-bash (destructive-ops gate)
    if (alreadyHasPreBash && !force) {
      output.writeln(output.dim(`  ✓ PreToolUse[${PRE_BASH_MATCHER}]              → pre-bash   (already registered)`));
    } else {
      if (force && existingBashEntry) {
        // Remove only the old pre-bash hook from an existing Bash entry (preserve other hooks)
        existingBashEntry.hooks = existingBashEntry.hooks.filter(h => !h.command.includes('pre-bash'));
      }
      const newHook = { type: 'command', command: PRE_BASH_COMMAND, timeout: 5000 };
      if (existingBashEntry) {
        // Merge into existing Bash entry — avoids creating a duplicate top-level Bash matcher
        existingBashEntry.hooks.push(newHook);
      } else {
        preToolUse.push({ matcher: PRE_BASH_MATCHER, hooks: [newHook] });
      }
      changes.push(`PreToolUse[${PRE_BASH_MATCHER}] → pre-bash (destructive-ops gate)`);
      output.writeln(output.success(`  + PreToolUse[${PRE_BASH_MATCHER}]              → pre-bash   (destructive-ops gate)`));
    }

    // Register pre-write (secrets gate)
    if (alreadyHasPreWrite && !force) {
      output.writeln(output.dim(`  ✓ PreToolUse[${PRE_WRITE_MATCHER}] → pre-write  (already registered)`));
    } else {
      if (force && existingWriteEntry) {
        // Remove only the old pre-write hook from an existing Write entry (preserve other hooks)
        existingWriteEntry.hooks = existingWriteEntry.hooks.filter(h => !h.command.includes('pre-write'));
      }
      const newWriteHook = { type: 'command', command: PRE_WRITE_COMMAND, timeout: 3000 };
      if (existingWriteEntry) {
        // Merge into existing Write entry — avoids creating a duplicate top-level Write|Edit|MultiEdit matcher
        existingWriteEntry.hooks.push(newWriteHook);
      } else {
        preToolUse.push({ matcher: PRE_WRITE_MATCHER, hooks: [newWriteHook] });
      }
      changes.push(`PreToolUse[${PRE_WRITE_MATCHER}] → pre-write (secrets detection)`);
      output.writeln(output.success(`  + PreToolUse[${PRE_WRITE_MATCHER}] → pre-write  (secrets gate)`));
    }

    if (changes.length === 0) {
      output.writeln();
      output.writeln(output.dim('Nothing to change.'));
      return { success: true, data: { changes: [] } };
    }

    if (dryRun) {
      output.writeln();
      output.writeln(output.dim(`Dry run — would write ${settingsPath}`));
      return { success: true, data: { changes, dryRun: true } };
    }

    // Write back
    hooks.PreToolUse = preToolUse;
    settings.hooks = hooks;
    try {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to write ${settingsPath}: ${msg}` };
    }

    output.writeln();
    output.writeln(output.success(`Wrote ${settingsPath}`));
    output.writeln();
    output.writeln(output.dim('Gates active on next Claude Code session:'));
    output.writeln(output.dim('  • Bash commands checked for destructive operations (rm -rf, DROP TABLE, git push --force …)'));
    output.writeln(output.dim('  • Write/Edit/MultiEdit checked for secrets (API keys, tokens, private keys …)'));

    return { success: true, data: { changes } };
  },
};

// Main guidance command
export const guidanceCommand: Command = {
  name: 'guidance',
  description: 'Wire enforcement gates (destructive-ops + secrets) into Claude Code hooks',
  aliases: ['guide', 'policy'],
  subcommands: [setupCommand],
  options: [],
  examples: [
    { command: 'monomind guidance setup', description: 'Wire enforcement gates into Claude Code hooks' },
    { command: 'monomind guidance setup --dry-run', description: 'Preview changes without writing' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Guidance Gates'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();
    output.writeln('Available subcommands:');
    output.writeln(`  ${output.bold('setup')}     Wire enforcement gates into Claude Code hooks`);
    output.writeln();
    output.writeln(output.dim('Gate enforcement runs in .claude/helpers/handlers/gates-handler.cjs on every PreToolUse.'));
    output.writeln(output.dim('Use monomind guidance setup --help for details'));

    return { success: true };
  },
};

export default guidanceCommand;
