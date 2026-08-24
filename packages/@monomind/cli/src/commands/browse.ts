import browseBase from '@monoes/monobrowse/cli/commands';
import type { Command } from '../types.js';
import { browseActionCommand } from './browse-action.js';
import { browsePlatformCommand } from './browse-platform.js';
import { browseWorkflowCommand } from './browse-workflow.js';

const REPLACED = new Set(['workflow', 'action', 'platform']);

// @monoes/monobrowse permits commands that return void after writing output,
// whereas Monomind's dispatcher requires CommandResult | undefined. Keep that
// third-party variance at this integration boundary instead of weakening the
// CLI-wide command contract.
const monobrowseCommand = browseBase as unknown as Command;

// Augment the base browse command with workflow/action/platform subcommands
const browseCommand: Command = {
  ...monobrowseCommand,
  subcommands: [
    ...(monobrowseCommand.subcommands ?? []).filter((s) => !REPLACED.has(s.name)),
    browseWorkflowCommand,
    browseActionCommand,
    browsePlatformCommand,
  ],
};

export default browseCommand;
