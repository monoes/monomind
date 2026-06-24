import browseBase from '@monoes/monobrowse/cli/commands';
import { browseWorkflowCommand } from './browse-workflow.js';
import { browseActionCommand } from './browse-action.js';
import { browsePlatformCommand } from './browse-platform.js';
const REPLACED = new Set(['workflow', 'action', 'platform']);
// Augment the base browse command with workflow/action/platform subcommands
const browseCommand = {
    ...browseBase,
    subcommands: [
        ...(browseBase.subcommands ?? []).filter(s => !REPLACED.has(s.name)),
        browseWorkflowCommand,
        browseActionCommand,
        browsePlatformCommand,
    ],
};
export default browseCommand;
//# sourceMappingURL=browse.js.map