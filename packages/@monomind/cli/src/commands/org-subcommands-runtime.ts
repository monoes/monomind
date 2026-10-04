import { claudePathOption } from '../orgrt/claude-selection.js';
// packages/@monomind/cli/src/commands/org-subcommands-runtime.ts
//
// `monomind org` runtime subcommands: run, stop, pause, resume, reload,
// status, serve, supervisor, test-loop, plus the skills library browser.

import type { Command, CommandContext, CommandResult } from '../types.js';
import {
  pauseAction,
  reloadAction,
  resumeAction,
  statusAction,
  stopAction,
} from './org-lifecycle.js';
import { testLoopAction } from './org-manage.js';
import { runAction } from './org-run.js';
import { serveAction, supervisorAction } from './org-serve.js';

export const skillsSubcommand: Command = {
  name: 'skills',
  description: 'Browse the org skill library and import skills (MIT/Apache-2.0) from other repos',
  options: [
    { name: 'tag', description: 'Filter by tag (list, search)', type: 'string' },
    { name: 'limit', description: 'Max search results (default 10)', type: 'number' },
    {
      name: 'global',
      description: 'import: into ~/.monomind/org-skills instead of this project',
      type: 'boolean',
    },
    { name: 'into', description: 'import: into this library directory', type: 'string' },
    { name: 'only', description: 'import: comma-separated skill names', type: 'string' },
    {
      name: 'tags',
      description: 'import: comma-separated tags to give imported skills',
      type: 'string',
    },
    {
      name: 'overwrite',
      description: 'import: replace skills already in the library',
      type: 'boolean',
    },
  ],
  examples: [
    {
      command: 'monomind org skills search "backend api reviewer"',
      description: 'Find skills for a role',
    },
    { command: 'monomind org skills show systematic-debugging', description: 'Read one skill' },
    {
      command: 'monomind org skills import obra/superpowers --global',
      description: "Import a repo's skills",
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { orgSkillsAction } = await import('./org-skills.js');
    return orgSkillsAction(ctx);
  },
};

export const runSubcommand: Command = {
  name: 'run',
  description: 'Start an org (foreground daemon)',
  options: [
    claudePathOption,
    { name: 'task', description: 'Override the org goal for this run', type: 'string' },
    {
      name: 'resume',
      description: 'Resume an org run from its persisted checkpoint instead of starting fresh',
      type: 'boolean',
    },
    {
      name: 'cross-process',
      description:
        'Discover and message orgs hosted by other monomind processes on this machine (default true)',
      type: 'boolean',
      default: true,
    },
    {
      name: 'dry-run',
      description: "Validate and print each role's briefing without starting any agent sessions",
      type: 'boolean',
    },
    {
      name: 'budget-usd',
      description:
        'Hard-stop the run if the upfront cost estimate exceeds this USD value (e.g. --budget-usd 5)',
      type: 'number',
    },
    {
      name: 'yes',
      short: 'y',
      description: 'Skip the interactive cost-estimate confirmation prompt',
      type: 'boolean',
    },
    {
      name: 'auto-approve',
      description:
        'Comma-separated gated tools every role may call without human approval for this run (e.g. org_complete). -y alone approves nothing',
      type: 'string',
    },
  ],
  examples: [
    {
      command: 'monomind org run growth --task "weekly report"',
      description: 'Run the growth org once with a task',
    },
    {
      command: 'monomind org run growth --task "weekly report" -y --auto-approve org_complete',
      description:
        'Unattended one-shot run that may end itself without a human approving org_complete',
    },
  ],
  action: runAction,
};

export const stopSubcommand: Command = {
  name: 'stop',
  description: 'Request a running org daemon to stop',
  action: stopAction,
};

export const pauseSubcommand: Command = {
  name: 'pause',
  description: 'Pause an org — current turns finish, no new cycles start',
  action: pauseAction,
};

export const resumeSubcommand: Command = {
  name: 'resume',
  description: 'Resume a paused org',
  action: resumeAction,
};

export const reloadSubcommand: Command = {
  name: 'reload',
  description: 'Hot-reload an org definition without stopping sessions',
  action: reloadAction,
};

export const statusSubcommand: Command = {
  name: 'status',
  description: 'Show runtime state of orgs',
  action: statusAction,
};

export const serveSubcommand: Command = {
  name: 'serve',
  description: 'Start the daemon server only (hosts scheduled orgs)',
  options: [
    claudePathOption,
    {
      name: 'cross-process',
      description:
        'Discover and message orgs hosted by other monomind processes on this machine (default true)',
      type: 'boolean',
      default: true,
    },
  ],
  action: serveAction,
};

export const supervisorSubcommand: Command = {
  name: 'supervisor',
  description: 'Print (or --install) a launchd/systemd unit that keeps `org serve` running',
  options: [
    { name: 'format', description: 'launchd or systemd (default: platform)', type: 'string' },
    {
      name: 'install',
      description: 'Write the unit into the per-user location',
      type: 'boolean',
    },
  ],
  action: supervisorAction,
};

export const testLoopSubcommand: Command = {
  name: 'test-loop',
  description: 'Run the org e2e verification loop N times',
  options: [
    { name: 'times', short: 'n', description: 'Iterations', type: 'number', default: 5 },
    {
      name: 'scenario',
      description:
        'Run a declarative scenario file (.monomind/scenarios/<file>) instead of the built-in fixture — structural dry-run only',
      type: 'string',
    },
  ],
  action: testLoopAction,
};
