/**
 * `monomind crash-reporting` — opt-out switch for the crash reporter used by
 * monomind, mono-agent, monotask, and mono-clip. On by default.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { isEnabled, setEnabled } from '../services/crash-reporter.js';

const enableCommand: Command = {
  name: 'enable',
  description: 'Turn crash reporting back on',
  action: async (): Promise<CommandResult> => {
    setEnabled(true);
    output.printSuccess('Crash reporting enabled.');
    return { success: true };
  },
};

const disableCommand: Command = {
  name: 'disable',
  description: 'Turn off automatic crash reporting to GitHub',
  action: async (): Promise<CommandResult> => {
    setEnabled(false);
    output.printSuccess('Crash reporting disabled. No crash reports will be filed until you run "monomind crash-reporting enable".');
    return { success: true };
  },
};

const statusCommand: Command = {
  name: 'status',
  description: 'Show whether crash reporting is on or off',
  action: async (): Promise<CommandResult> => {
    const enabled = isEnabled();
    output.writeln(`Crash reporting: ${enabled ? output.success('enabled') : output.warning('disabled')}`);
    return { success: true, data: { enabled } };
  },
};

export const crashReportingCommand: Command = {
  name: 'crash-reporting',
  description: 'Enable/disable automatic crash reporting (on by default). When a monoes tool crashes, it files a GitHub issue on the tool\'s own repo — redacted, deduplicated, and skipped entirely if disabled.',
  subcommands: [enableCommand, disableCommand, statusCommand],
  examples: [
    { command: 'monomind crash-reporting status', description: 'Check whether crash reporting is on' },
    { command: 'monomind crash-reporting disable', description: 'Opt out of automatic crash reporting' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const enabled = isEnabled();
    output.writeln(`Crash reporting: ${enabled ? output.success('enabled') : output.warning('disabled')}`);
    output.writeln(output.dim('Use "monomind crash-reporting enable|disable" to change this.'));
    return { success: true, data: { enabled } };
  },
};

export default crashReportingCommand;
