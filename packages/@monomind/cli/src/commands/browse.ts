import browseBase from '@monoes/monobrowse/cli/commands';
import { browseActionCommand } from './browse-action.js';
import { browsePlatformCommand } from './browse-platform.js';
import { browseWorkflowCommand } from './browse-workflow.js';

const REPLACED = new Set(['workflow', 'action', 'platform']);

// Augment the base browse command with workflow/action/platform subcommands
const browseCommand = {
  ...browseBase,
  subcommands: [
    ...(browseBase.subcommands ?? []).filter((s) => !REPLACED.has(s.name)),
    browseWorkflowCommand,
    browseActionCommand,
    browsePlatformCommand,
  ],
};

export default browseCommand;
