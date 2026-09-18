/**
 * `monomind crash-reporting` — opt-out switch for the crash reporter used by
 * monomind, mono-agent, monotask, and mono-clip. You're asked once, on the
 * first interactive crash. Until then, a non-interactive crash (CI, agents)
 * never asks and only saves locally.
 */

import { output } from '../output.js';
import { getConsentState, setEnabled } from '../services/crash-reporter.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

/** Renders the tri-state consent as a line, so a user who was never asked
 * can't be told "enabled" — a boolean can't distinguish "explicitly on"
 * from "never chosen". */
function renderState(): { state: ReturnType<typeof getConsentState>; line: string } {
  const state = getConsentState();
  if (state === 'enabled') return { state, line: `Crash reporting: ${output.success('enabled')}` };
  if (state === 'disabled')
    return { state, line: `Crash reporting: ${output.warning('disabled')}` };
  return {
    state,
    line: `Crash reporting: ${output.dim('unanswered')} (asked once on your next interactive crash; non-interactive crashes always save locally)`,
  };
}

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
    output.printSuccess(
      'Crash reporting disabled. No crash reports will be filed until you run "monomind crash-reporting enable".',
    );
    return { success: true };
  },
};

const statusCommand: Command = {
  name: 'status',
  description: 'Show whether crash reporting is on, off, or unanswered',
  action: async (): Promise<CommandResult> => {
    const { state, line } = renderState();
    output.writeln(line);
    return { success: true, data: { state, enabled: state === 'enabled' } };
  },
};

export const crashReportingCommand: Command = {
  name: 'crash-reporting',
  description:
    "Enable/disable automatic crash reporting. When a monoes tool crashes interactively, it asks once whether to file a GitHub issue on the tool's own repo — redacted, deduplicated, and skipped entirely if disabled. Until answered, a non-interactive crash (CI, agents) never asks and only saves locally.",
  subcommands: [enableCommand, disableCommand, statusCommand],
  examples: [
    {
      command: 'monomind crash-reporting status',
      description: 'Check whether crash reporting is on',
    },
    {
      command: 'monomind crash-reporting disable',
      description: 'Opt out of automatic crash reporting',
    },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    const { state, line } = renderState();
    output.writeln(line);
    output.writeln(output.dim('Use "monomind crash-reporting enable|disable" to change this.'));
    return { success: true, data: { state, enabled: state === 'enabled' } };
  },
};

export default crashReportingCommand;
