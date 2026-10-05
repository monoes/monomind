/**
 * CLI Deps Command
 * Installs the heavy dependencies monomind otherwise installs on first use
 * (#428), for the operator to run outside any org role (#559): inside a
 * role ~/.monomind/deps is read-only.
 */

import { loadClaudeSdk } from '../orgrt/claude-sdk.js';
import { roleContextMarker } from '../orgrt/org-signature.js';
import { output } from '../output.js';
import type { Command, CommandResult } from '../types.js';
import { depsRoot, OPTIONAL_DEPENDENCIES } from '../utils/optional-deps.js';

const SDK = '@anthropic-ai/claude-agent-sdk';

const installCommand: Command = {
  name: 'install',
  description: `Install the pinned Claude Agent SDK into ${depsRoot()} (run outside any org role)`,
  action: async (): Promise<CommandResult> => {
    const marker = roleContextMarker(process.env);
    if (marker) {
      output.printError(
        `This runs inside an org role (${marker} is set), where ${depsRoot()} is read-only. ` +
          'Run `monomind deps install` in your own terminal, outside the org.',
      );
      return { success: false, exitCode: 1 };
    }
    try {
      // An explicit request: MONOMIND_NO_AUTO_INSTALL only stops automatic installs.
      await loadClaudeSdk(undefined, { requested: true, intoCache: true });
    } catch (e) {
      output.printError(e instanceof Error ? e.message : String(e));
      return { success: false, exitCode: 1 };
    }
    output.printSuccess(
      `${SDK}@${OPTIONAL_DEPENDENCIES[SDK].version} is installed and verified in ${depsRoot()}.`,
    );
    return { success: true };
  },
};

export const depsCommand: Command = {
  name: 'deps',
  description: 'Install the heavy dependencies monomind otherwise installs on first use',
  subcommands: [installCommand],
  examples: [
    {
      command: 'monomind deps install',
      description:
        'Install the Claude Agent SDK that org roles and `agent exec --runtime claude` use',
    },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Subcommands:');
    output.printList([`install - ${installCommand.description}`]);
    return { success: true };
  },
};

export default depsCommand;
