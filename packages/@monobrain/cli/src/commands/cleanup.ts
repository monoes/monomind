/**
 * CLI Cleanup Command
 * Removes project artifacts created by monobrain/monobrain
 *
 * github.com/nokhodian/monobrain
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, statSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Artifact directories and files that monobrain/monobrain may create
 */
const ARTIFACT_DIRS = [
  { path: '.claude', description: 'Claude settings, helpers, agents' },
  { path: '.monobrain', description: 'Capabilities and configuration' },
  { path: 'data', description: 'Memory databases' },
  { path: '.swarm', description: 'Swarm state' },
  { path: '.hive-mind', description: 'Consensus state' },
  { path: 'coordination', description: 'Coordination data' },
  { path: 'memory', description: 'Memory storage' },
];

const ARTIFACT_FILES = [
  { path: 'monobrain.config.json', description: 'Monobrain configuration' },
];

/**
 * Paths to preserve when --keep-config is set
 */
const KEEP_CONFIG_PATHS = [
  'monobrain.config.json',
  join('.claude', 'settings.json'),
];

/**
 * Calculate the total size of a path (file or directory) in bytes
 */
function getSize(fullPath: string): number {
  try {
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      return stat.size;
    }
    if (stat.isDirectory()) {
      let total = 0;
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        total += getSize(join(fullPath, entry.name));
      }
      return total;
    }
  } catch {
    // Permission errors, broken symlinks, etc.
  }
  return 0;
}

/**
 * Format bytes into a human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Cleanup command definition
 */
export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Remove project artifacts created by monobrain/monobrain',
  aliases: ['clean'],
  options: [
    {
      name: 'dry-run',
      short: 'n',
      description: 'Show what would be removed without deleting (default behavior)',
      type: 'boolean',
      default: true,
    },
    {
      name: 'force',
      short: 'f',
      description: 'Actually delete the artifacts',
      type: 'boolean',
      default: false,
    },
    {
      name: 'keep-config',
      short: 'k',
      description: 'Preserve monobrain.config.json and .claude/settings.json',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'cleanup',
      description: 'Show what would be removed (dry run)',
    },
    {
      command: 'cleanup --force',
      description: 'Remove all monobrain artifacts',
    },
    {
      command: 'cleanup --force --keep-config',
      description: 'Remove artifacts but keep configuration files',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force === true;
    const keepConfig = ctx.flags['keep-config'] === true;
    const cwd = ctx.cwd;

    const dryRun = !force;

    output.writeln();
    output.writeln(output.bold(dryRun
      ? 'Monobrain Cleanup (dry run)'
      : 'Monobrain Cleanup'));
    output.writeln();

    const found: { path: string; description: string; size: number; type: 'dir' | 'file'; skipped?: boolean }[] = [];
    let totalSize = 0;

    // Scan directories
    for (const artifact of ARTIFACT_DIRS) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'dir' });
        totalSize += size;
      }
    }

    // Scan files
    for (const artifact of ARTIFACT_FILES) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'file' });
        totalSize += size;
      }
    }

    if (found.length === 0) {
      output.writeln(output.info('No monobrain artifacts found in the current directory.'));
      return { success: true, message: 'Nothing to clean' };
    }

    // Mark items that would be skipped due to --keep-config
    if (keepConfig) {
      for (const item of found) {
        if (KEEP_CONFIG_PATHS.includes(item.path)) {
          item.skipped = true;
        }
      }
    }

    // Display what was found
    output.writeln(output.bold('Artifacts found:'));
    output.writeln();

    let removedCount = 0;
    let removedSize = 0;
    let skippedCount = 0;

    for (const item of found) {
      const sizeStr = formatSize(item.size);
      const typeLabel = item.type === 'dir' ? 'dir ' : 'file';

      if (item.skipped) {
        output.writeln(output.dim(`  [skip] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
        skippedCount++;
        continue;
      }

      if (dryRun) {
        output.writeln(output.warning(`  [would remove] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
      } else {
        // Actually delete
        try {
          const fullPath = join(cwd, item.path);
          if (item.type === 'dir') {
            rmSync(fullPath, { recursive: true, force: true });
          } else {
            rmSync(fullPath, { force: true });
          }
          output.writeln(output.success(`  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
          removedCount++;
          removedSize += item.size;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output.writeln(output.error(`  [failed] ${typeLabel}  ${item.path}  - ${msg}`));
        }
      }
    }

    // Summary
    output.writeln();
    output.writeln(output.bold('Summary:'));

    if (dryRun) {
      const actionable = found.filter(f => !f.skipped);
      output.writeln(`  Found ${actionable.length} artifact(s) totaling ${formatSize(totalSize)}`);
      if (skippedCount > 0) {
        output.writeln(`  ${skippedCount} item(s) would be preserved (--keep-config)`);
      }
      output.writeln();
      output.writeln(output.dim('  This was a dry run. Use --force to actually remove artifacts.'));
    } else {
      output.writeln(`  Removed ${removedCount} artifact(s) totaling ${formatSize(removedSize)}`);
      if (skippedCount > 0) {
        output.writeln(`  Preserved ${skippedCount} item(s) (--keep-config)`);
      }
    }

    output.writeln();

    return {
      success: true,
      message: dryRun
        ? `Dry run: ${found.length} artifact(s) found`
        : `Removed ${removedCount} artifact(s)`,
      data: { found, removedCount, removedSize, dryRun },
    };
  },
};

export default cleanupCommand;
